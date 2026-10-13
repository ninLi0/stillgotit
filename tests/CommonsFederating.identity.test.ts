import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Collection, MongoNotConnectedError, type Document, type Filter } from "mongodb";
import { type Attempt, FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { type Identity, MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const SAM = { subject: "u7f3", username: "sam" };
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredAttempt {
  _id: Attempt;
  nonce: string;
  verifier: string;
  expiresAt: Date;
  subject?: string;
  username?: string;
}

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
});

afterAll(async () => {
  if (!connection) return;
  try {
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

function setup() {
  const name = `CommonsFederating_${randomUUID()}`;
  // Move only the concept's clock, so MongoDB cleanup cannot enforce expiry for it.
  let now = new Date();
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const provider = new MemoryProvider();
  const federating = new FederatingConcept<User>(connection!.db, provider, name, clock);
  const attempts = connection!.db.collection<StoredAttempt>(`${name.toLowerCase()}.attempts`);
  const links = connection!.db.collection(`${name.toLowerCase()}.links`);

  async function confirmed(identity: Identity = SAM) {
    const { attempt, address, expiresAt } = await federating.start({});
    const { code, state } = provider.approve(address, identity);
    await federating.finish({ attempt, nonce: state, code });
    return { attempt, expiresAt };
  }

  return { name, clock, advance, provider, federating, attempts, links, confirmed };
}

function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  return operation.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

// Delay delivery of one real MongoDB result to the query. The record was read
// before expiry, but the concept must use the time after the await completes.
function holdRead(fixture: ReturnType<typeof setup>, attempt: Attempt) {
  const original = Collection.prototype.findOne;
  const arrived = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const timeout = setTimeout(() => arrived.reject(new Error("The identity read did not arrive.")), 5_000);
  let held = false;
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const record = await original.call(this, filter, options);
      if (!held && this.dbName === database && this.collectionName === fixture.attempts.collectionName
        && filter._id === attempt) {
        held = true;
        clearTimeout(timeout);
        arrived.resolve();
        await released.promise;
      }
      return record as T | null;
    },
  );
  return {
    arrived: arrived.promise,
    release() {
      clearTimeout(timeout);
      released.resolve();
    },
    restore() { read.mockRestore(); },
  };
}

describe("CommonsFederating._identity", () => {
  test("returns only the saved identity and expiry without contacting Commons or changing state", async () => {
    const { federating, confirmed, provider, attempts, links } = setup();
    const request = await confirmed();
    const before = await attempts.find().toArray();
    const redeem = spyOn(provider, "redeem");
    const address = spyOn(provider, "address");
    try {
      const expected = [{ ...SAM, expiresAt: request.expiresAt }];
      expect(await federating._identity(request)).toEqual(expected);
      expect(await federating._identity(request)).toEqual(expected);
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
      expect(redeem).not.toHaveBeenCalled();
      expect(address).not.toHaveBeenCalled();
    } finally {
      redeem.mockRestore();
      address.mockRestore();
    }
  });

  test.each(["unknown", "unconfirmed", "removed"] as const)(
    "%s attempts return no row and leave other confirmations unchanged",
    async (condition) => {
      const { federating, confirmed, attempts } = setup();
      const other = await confirmed({ subject: "other-account", username: "maya" });
      let attempt = "unknown-attempt" as Attempt;
      if (condition === "unconfirmed") ({ attempt } = await federating.start({}));
      if (condition === "removed") {
        ({ attempt } = await confirmed());
        await attempts.deleteOne({ _id: attempt });
      }
      const before = await attempts.find().sort({ _id: 1 }).toArray();
      expect(await federating._identity({ attempt })).toEqual([]);
      expect(await federating._identity(other))
        .toEqual([{ subject: "other-account", username: "maya", expiresAt: other.expiresAt }]);
      expect(await attempts.find().sort({ _id: 1 }).toArray()).toEqual(before);
    },
  );

  test("an older confirmation without a username needs a fresh attempt and keeps its existing link", async () => {
    const { federating, confirmed, attempts, links } = setup();
    const old = await confirmed();
    const user = "sam-local-user" as User;
    await federating.link({ ...old, user });
    // Model an attempt saved by the previous implementation.
    await attempts.updateOne({ _id: old.attempt }, { $unset: { username: "" } });
    const before = await attempts.findOne({ _id: old.attempt });
    const linksBefore = await links.find().toArray();
    expect(await federating._identity(old)).toEqual([]);
    expect(await federating._user(old)).toEqual([{ user }]);
    expect(await attempts.findOne({ _id: old.attempt })).toEqual(before);
    expect(await links.find().toArray()).toEqual(linksBefore);
    const fresh = await confirmed();
    expect(await federating._identity(fresh)).toEqual([{ ...SAM, expiresAt: fresh.expiresAt }]);
    expect(await federating._user(fresh)).toEqual([{ user }]);
  });

  test.each([-1, 0, 1])("checks the deadline at expiry %d ms even while the record remains stored", async (offset) => {
    const { federating, confirmed, attempts, advance } = setup();
    const request = await confirmed();
    const before = await attempts.findOne({ _id: request.attempt });
    advance(10 * MINUTE + offset);
    expect(await federating._identity(request))
      .toEqual(offset < 0 ? [{ ...SAM, expiresAt: request.expiresAt }] : []);
    expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
  });

  test.each([-1, 0, 1])("uses the time after a delayed database read at expiry %d ms", async (offset) => {
    const fixture = setup();
    const { federating, confirmed, attempts, advance } = fixture;
    const request = await confirmed();
    const before = await attempts.findOne({ _id: request.attempt });
    advance(10 * MINUTE - 10_000);
    const gate = holdRead(fixture, request.attempt);
    const pending = settle(federating._identity(request));
    try {
      await gate.arrived;
      advance(10_000 + offset);
      gate.release();
      expect(await pending).toEqual({
        status: "fulfilled",
        value: offset < 0 ? [{ ...SAM, expiresAt: request.expiresAt }] : [],
      });
      expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
    } finally {
      gate.release();
      await pending;
      gate.restore();
    }
  });

  test("returns the same identity before and after linking to a local user", async () => {
    const { federating, confirmed, attempts, links } = setup();
    const request = await confirmed();
    const identity = [{ ...SAM, expiresAt: request.expiresAt }];
    expect(await federating._identity(request)).toEqual(identity);
    await federating.link({ ...request, user: "sam-local-user" as User });
    const before = await attempts.find().toArray();
    const linksBefore = await links.find().toArray();
    expect(await federating._identity(request)).toEqual(identity);
    expect(await attempts.find().toArray()).toEqual(before);
    expect(await links.find().toArray()).toEqual(linksBefore);
  });

  test("each confirmation keeps its reported username while the stable subject stays the same", async () => {
    const { federating, confirmed, advance } = setup();
    const first = await confirmed();
    advance(MINUTE);
    // This is a valid provider name even though Registering would require another local name.
    const renamed = { ...SAM, username: "Sam Learner" };
    const second = await confirmed(renamed);
    expect(await federating._identity(first)).toEqual([{ ...SAM, expiresAt: first.expiresAt }]);
    expect(await federating._identity(second)).toEqual([{ ...renamed, expiresAt: second.expiresAt }]);
  });

  test("recovers both identity fields after a committed finish loses its reply and the writer closes", async () => {
    const { name, clock, provider, attempts } = setup();
    const writer = await connectMongo({ uri, database });
    const finishing = new FederatingConcept<User>(writer.db, provider, name, clock);
    const lostReply = new Error("Simulated lost confirmation reply.");
    let request: { attempt: Attempt; expiresAt: Date };
    try {
      const started = await finishing.start({});
      request = { attempt: started.attempt, expiresAt: started.expiresAt };
      const { code, state } = provider.approve(started.address, SAM);
      const original = Collection.prototype.updateOne;
      let intercepted = false;
      const update = spyOn(Collection.prototype, "updateOne").mockImplementation(
        async function(this: Collection, filter, changes, options) {
          const result = await original.call(this, filter, changes, options);
          if (!intercepted && this.dbName === database && this.collectionName === attempts.collectionName) {
            intercepted = true;
            throw lostReply;
          }
          return result;
        },
      );
      try {
        await expect(finishing.finish({ attempt: started.attempt, nonce: state, code })).rejects.toBe(lostReply);
        expect(intercepted).toBe(true);
      } finally {
        update.mockRestore();
      }
    } finally {
      await writer.client.close();
    }

    const before = await attempts.find().toArray();
    expect(before).toHaveLength(1);
    expect(before[0]).toMatchObject({ ...SAM, expiresAt: request.expiresAt });
    const reader = await connectMongo({ uri, database });
    const freshProvider = new MemoryProvider();
    const redeem = spyOn(freshProvider, "redeem");
    try {
      const restored = new FederatingConcept<User>(reader.db, freshProvider, name, clock);
      expect(await restored._identity(request)).toEqual([{ ...SAM, expiresAt: request.expiresAt }]);
      expect(redeem).not.toHaveBeenCalled();
      expect(await attempts.find().toArray()).toEqual(before);
    } finally {
      redeem.mockRestore();
      await reader.client.close();
    }
  });

  test("a closed database client rejects lookup instead of reporting an expired identity", async () => {
    const { name, clock, federating, confirmed, attempts } = setup();
    const request = await confirmed();
    const before = await attempts.find().toArray();
    const disconnected = await connectMongo({ uri, database });
    const broken = new FederatingConcept<User>(disconnected.db, new MemoryProvider(), name, clock);
    await disconnected.client.close();
    await expect(broken._identity(request)).rejects.toBeInstanceOf(MongoNotConnectedError);
    expect(await federating._identity(request)).toEqual([{ ...SAM, expiresAt: request.expiresAt }]);
    expect(await attempts.find().toArray()).toEqual(before);
  });
});
