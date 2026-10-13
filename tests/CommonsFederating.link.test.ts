// Adapts ConceptBox's link scenarios. See THIRD_PARTY_NOTICES.md.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { Collection, type Document, type Filter, MongoServerError } from "mongodb";
import { randomUUID } from "node:crypto";
import {
  AlreadyLinked,
  type Attempt,
  FederatingConcept,
  NotConfirmed,
  SignInExpired,
} from "../src/concepts/Federating/Federating.ts";
import { type Identity, MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const SAM = { subject: "u7f3", username: "sam" };
const LEO = { subject: "u2b9", username: "leo" };
const SAM_USER = "sam-user" as User;
const LEO_USER = "leo-user" as User;
const EXPIRED = "This sign-in has expired. Start again.";
const UNCONFIRMED = "This sign-in hasn't been confirmed.";
const LINKED = "This account on the other site is already linked.";
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredAttempt {
  _id: Attempt;
  nonce: string;
  verifier: string;
  expiresAt: Date;
  subject?: string;
}

interface StoredLink {
  subject: string;
  user: User;
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
  // Keep MongoDB's real clock before cleanup. The action must enforce expiry.
  let now = new Date();
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const provider = new MemoryProvider();
  const federating = new FederatingConcept<User>(connection!.db, provider, name, clock);
  const attempts = connection!.db.collection<StoredAttempt>(`${name.toLowerCase()}.attempts`);
  const links = connection!.db.collection<StoredLink>(`${name.toLowerCase()}.links`);

  async function confirmed(identity: Identity = SAM) {
    const { attempt, address } = await federating.start({});
    const { code, state } = provider.approve(address, identity);
    await federating.finish({ attempt, nonce: state, code });
    return { attempt };
  }

  return { name, clock, advance, provider, federating, attempts, links, confirmed };
}

function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  return operation.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

function expectRefusal(
  outcome: PromiseSettledResult<unknown>,
  error: typeof NotConfirmed | typeof SignInExpired | typeof AlreadyLinked,
  message: string,
) {
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect(outcome.reason).toBeInstanceOf(error);
    expect(outcome.reason.message).toBe(message);
  }
}

// Pause after the real insert, before its promise resolves to the action.
// Another client can read while this write is still inside the transaction.
function holdInsertedLink(fixture: ReturnType<typeof setup>) {
  const original = Collection.prototype.insertOne;
  const arrived = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const timeout = setTimeout(() => arrived.reject(new Error("The link insert did not arrive.")), 5_000);
  const insert = spyOn(Collection.prototype, "insertOne").mockImplementation(
    async function(this: Collection, document, options) {
      const result = await original.call(this, document, options);
      if (this.dbName === database && this.collectionName === fixture.links.collectionName) {
        clearTimeout(timeout);
        arrived.resolve();
        await released.promise;
      }
      return result;
    },
  );
  return {
    arrived: arrived.promise,
    release() {
      clearTimeout(timeout);
      released.resolve();
    },
    restore() { insert.mockRestore(); },
  };
}

async function withOverlappingConfirmations<T>(fixture: ReturnType<typeof setup>, run: () => Promise<T>) {
  const original = Collection.prototype.findOne;
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(() => ready.reject(new Error("Both confirmation reads must arrive.")), 5_000);
  let reads = 0;
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const record = await original.call(this, filter, options);
      if (this.dbName === database && this.collectionName === fixture.attempts.collectionName
        && filter.subject !== undefined && reads < 2) {
        reads += 1;
        if (reads === 2) ready.resolve();
        await ready.promise;
      }
      return record as T | null;
    },
  );
  try {
    return await run();
  } finally {
    clearTimeout(timeout);
    read.mockRestore();
  }
}

describe("CommonsFederating.link", () => {
  test("persists one subject-to-user link and resolves it after a Commons username change", async () => {
    const fixture = setup();
    const { name, clock, provider, federating, attempts, links, confirmed } = fixture;
    const sam = await confirmed();
    const leo = await confirmed(LEO);
    await federating.link({ ...leo, user: LEO_USER });
    const before = await attempts.find().sort({ _id: 1 }).toArray();
    const existingLinks = await links.find().toArray();
    expect(await federating._user(sam)).toEqual([]);
    expect(await federating._linkable(sam)).toEqual({ linkable: true });

    const writer = await connectMongo({ uri, database });
    try {
      const linking = new FederatingConcept<User>(writer.db, provider, name, clock);
      expect(await linking.link({ ...sam, user: SAM_USER })).toEqual({ user: SAM_USER });
    } finally {
      await writer.client.close();
    }

    const reader = await connectMongo({ uri, database });
    try {
      const reading = new FederatingConcept<User>(reader.db, provider, name, clock);
      expect(await reading._user(sam)).toEqual([{ user: SAM_USER }]);
      expect(await reading._linkable(sam)).toEqual({ linkable: false });
      expect(await reading._user(leo)).toEqual([{ user: LEO_USER }]);
    } finally {
      await reader.client.close();
    }
    expect(await attempts.find().sort({ _id: 1 }).toArray()).toEqual(before);
    expect(await links.find({ subject: LEO.subject }).toArray()).toEqual(existingLinks);
    expect(await links.findOne<StoredLink>({ subject: SAM.subject }, { projection: { _id: 0 } }))
      .toEqual({ subject: SAM.subject, user: SAM_USER });
    expect(await links.countDocuments()).toBe(2);

    const renamed = await confirmed({ ...SAM, username: "sam-renamed" });
    expect(await federating._user(renamed)).toEqual([{ user: SAM_USER }]);
    expect(await federating._linkable(renamed)).toEqual({ linkable: false });
  });

  test.each(["unknown", "unconfirmed", "expired unconfirmed"] as const)(
    "refuses an %s attempt without changing state",
    async (condition) => {
      const { federating, advance, attempts, links } = setup();
      const { attempt: started } = await federating.start({});
      const attempt = condition === "unknown" ? "unknown-attempt" as Attempt : started;
      if (condition === "expired unconfirmed") advance(10 * MINUTE);
      const before = await attempts.find().toArray();
      expectRefusal(await settle(federating.link({ attempt, user: SAM_USER })), NotConfirmed, UNCONFIRMED);
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
      expect(await federating._user({ attempt })).toEqual([]);
      expect(await federating._linkable({ attempt })).toEqual({ linkable: false });
    },
  );

  test.each([-1, 0, 1])("checks the initial deadline at expiry %i ms", async (offset) => {
    const { federating, confirmed, advance, attempts, links } = setup();
    const request = await confirmed();
    const before = await attempts.findOne({ _id: request.attempt });
    advance(10 * MINUTE + offset);
    const result = await settle(federating.link({ ...request, user: SAM_USER }));
    if (offset < 0) {
      expect(result).toEqual({ status: "fulfilled", value: { user: SAM_USER } });
      expect(await links.countDocuments()).toBe(1);
    } else {
      expectRefusal(result, SignInExpired, EXPIRED);
      expect(await links.countDocuments()).toBe(0);
      expect(await federating._linkable(request)).toEqual({ linkable: false });
    }
    expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
  });

  test.each([-1, 0, 1])("checks expiry after a delayed insert at expiry %i ms", async (offset) => {
    const fixture = setup();
    const { federating, confirmed, advance, attempts, links } = fixture;
    const request = await confirmed();
    const before = await attempts.find().toArray();
    const hold = holdInsertedLink(fixture);
    const pending = settle(federating.link({ ...request, user: SAM_USER }));
    try {
      await hold.arrived;
      advance(10 * MINUTE + offset);
      hold.release();
      const result = await pending;
      if (offset < 0) {
        expect(result).toEqual({ status: "fulfilled", value: { user: SAM_USER } });
        expect(await federating._user(request)).toEqual([{ user: SAM_USER }]);
      } else {
        expectRefusal(result, SignInExpired, EXPIRED);
        expect(await federating._user(request)).toEqual([]);
      }
      expect(await links.countDocuments()).toBe(offset < 0 ? 1 : 0);
      expect(await attempts.find().toArray()).toEqual(before);
    } finally {
      hold.release();
      await pending;
      hold.restore();
    }
  });

  test("does not expose an unfinished link, and rolls it back if the expired attempt is removed", async () => {
    const fixture = setup();
    const { federating, confirmed, advance, attempts, links } = fixture;
    const request = await confirmed();
    const hold = holdInsertedLink(fixture);
    const pending = settle(federating.link({ ...request, user: SAM_USER }));
    try {
      await hold.arrived;
      expect(await links.countDocuments()).toBe(0);
      expect(await federating._user(request)).toEqual([]);
      advance(11 * MINUTE);
      expect((await attempts.deleteOne({ _id: request.attempt })).deletedCount).toBe(1);
      hold.release();
      expectRefusal(await pending, SignInExpired, EXPIRED);
      expect(await links.countDocuments()).toBe(0);
      expect(await attempts.countDocuments()).toBe(0);
    } finally {
      hold.release();
      await pending;
      hold.restore();
    }
  });

  test("refuses duplicate links, preserves the original user, and gives expiry priority", async () => {
    const { federating, confirmed, advance, attempts, links } = setup();
    const first = await confirmed();
    const second = await confirmed();
    await federating.link({ ...first, user: SAM_USER });
    const savedAttempts = await attempts.find().sort({ _id: 1 }).toArray();
    const savedLinks = await links.find().toArray();
    expectRefusal(await settle(federating.link({ ...first, user: SAM_USER })), AlreadyLinked, LINKED);
    expectRefusal(await settle(federating.link({ ...second, user: LEO_USER })), AlreadyLinked, LINKED);
    advance(10 * MINUTE);
    expectRefusal(await settle(federating.link({ ...second, user: LEO_USER })), SignInExpired, EXPIRED);
    expect(await links.find().toArray()).toEqual(savedLinks);
    expect(await attempts.find().sort({ _id: 1 }).toArray()).toEqual(savedAttempts);
    expect(await federating._user(second)).toEqual([{ user: SAM_USER }]);
    expect(await federating._linkable(second)).toEqual({ linkable: false });
  });

  test.each(["same attempt", "different attempts"] as const)(
    "two clients linking the same subject from %s have one winner",
    async (condition) => {
      const fixture = setup();
      const { name, clock, provider, federating, confirmed, attempts, links } = fixture;
      const first = await confirmed();
      const second = condition === "same attempt" ? first : await confirmed();
      const before = await attempts.find().sort({ _id: 1 }).toArray();
      const other = await connectMongo({ uri, database });
      try {
        const contender = new FederatingConcept<User>(other.db, provider, name, clock);
        const outcomes = await withOverlappingConfirmations(fixture, () => Promise.allSettled([
          federating.link({ ...first, user: SAM_USER }),
          contender.link({ ...second, user: LEO_USER }),
        ]));
        const winners = outcomes.filter((result) => result.status === "fulfilled");
        const losers = outcomes.filter((result) => result.status === "rejected");
        expect(winners).toHaveLength(1);
        expect(losers).toHaveLength(1);
        expectRefusal(losers[0]!, AlreadyLinked, LINKED);
        const user = winners[0]!.value.user;
        expect(await links.find<StoredLink>({}, { projection: { _id: 0 } }).toArray())
          .toEqual([{ subject: SAM.subject, user }]);
        expect(await federating._user(first)).toEqual([{ user }]);
        expect(await contender._user(second)).toEqual([{ user }]);
        expect(await attempts.find().sort({ _id: 1 }).toArray()).toEqual(before);
      } finally {
        await other.client.close();
      }
    },
  );

  test("propagates a database failure without saving a link, then permits a valid retry", async () => {
    const { federating, confirmed, attempts, links } = setup();
    const request = await confirmed();
    const before = await attempts.find().toArray();
    await connection!.db.command({ collMod: links.collectionName, validator: { user: { $ne: SAM_USER } } });
    try {
      const result = await settle(federating.link({ ...request, user: SAM_USER }));
      expect(result.status).toBe("rejected");
      if (result.status === "rejected") {
        expect(result.reason).toBeInstanceOf(MongoServerError);
        expect(result.reason.code).toBe(121);
      }
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
      expect(await federating._linkable(request)).toEqual({ linkable: true });
    } finally {
      await connection!.db.command({ collMod: links.collectionName, validator: {} });
    }
    expect(await federating.link({ ...request, user: SAM_USER })).toEqual({ user: SAM_USER });
    expect(await federating._user(request)).toEqual([{ user: SAM_USER }]);
    expect(await links.countDocuments()).toBe(1);
  });
});
