// Adapts ConceptBox's finish scenarios. See THIRD_PARTY_NOTICES.md.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  type Attempt,
  FederatingConcept,
  SignInExpired,
  SignInRefused,
} from "../src/concepts/Federating/Federating.ts";
import { type Identity, MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const SAM = { subject: "u7f3", username: "sam" };
const LEO = { subject: "u2b9", username: "leo" };
const EXPIRED = "This sign-in has expired. Start again.";
const REFUSED = "The other site didn't confirm this sign-in. Start again.";
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
  // Advance only the concept's clock. MongoDB keeps the records, so the tests
  // check the action's expiry rules before background cleanup can help.
  let now = new Date();
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const provider = new MemoryProvider();
  const redeemCode = provider.redeem.bind(provider);
  const redeem = spyOn(provider, "redeem");
  const federating = new FederatingConcept<User>(connection!.db, provider, name, clock);
  const collectionName = `${name.toLowerCase()}.attempts`;

  async function approved(identity: Identity = SAM) {
    const { attempt, address } = await federating.start({});
    const { code, state } = provider.approve(address, identity);
    return { attempt, nonce: state, code };
  }

  return {
    name, clock, advance, provider, redeemCode, redeem, federating, approved, collectionName,
    attempts: connection!.db.collection<StoredAttempt>(collectionName),
    links: connection!.db.collection(`${name.toLowerCase()}.links`),
  };
}

// Capture rejections immediately while a test controls when the provider replies.
function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  return operation.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

function expectRefusal(
  outcome: PromiseSettledResult<unknown>,
  error: typeof SignInExpired | typeof SignInRefused,
  message: string,
) {
  expect(outcome.status).toBe("rejected");
  if (outcome.status === "rejected") {
    expect(outcome.reason).toBeInstanceOf(error);
    expect(outcome.reason.message).toBe(message);
  }
}

function holdReplies(fixture: ReturnType<typeof setup>, count = 1) {
  const arrived = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const timeout = setTimeout(() => arrived.reject(new Error("Expected provider requests did not arrive.")), 5_000);
  let calls = 0;
  fixture.redeem.mockImplementation(async (request) => {
    const identity = await fixture.redeemCode(request);
    calls += 1;
    if (calls === count) {
      clearTimeout(timeout);
      arrived.resolve();
    }
    await released.promise;
    return identity;
  });
  return {
    arrived: arrived.promise,
    release() {
      clearTimeout(timeout);
      released.resolve();
    },
  };
}

describe("CommonsFederating.finish", () => {
  test("saves the confirmed subject and username together and persists after the finishing client closes", async () => {
    const { name, provider, clock, approved, attempts, links, redeem } = setup();
    const request = await approved();
    await approved(LEO);
    const before = await attempts.find().sort({ _id: 1 }).toArray();
    const original = before.find((record) => record._id === request.attempt)!;
    const writer = await connectMongo({ uri, database });
    try {
      const finishing = new FederatingConcept<User>(writer.db, provider, name, clock);
      expect(await finishing.finish(request)).toEqual({ username: SAM.username });
    } finally {
      await writer.client.close();
    }

    const reader = await connectMongo({ uri, database });
    try {
      expect(await reader.db.collection<StoredAttempt>(attempts.collectionName).find().sort({ _id: 1 }).toArray())
        .toEqual(before.map((record) => record._id === request.attempt ? { ...record, ...SAM } : record));
      const restored = new FederatingConcept<User>(reader.db, new MemoryProvider(), name, clock);
      expect(await restored._identity({ attempt: request.attempt }))
        .toEqual([{ ...SAM, expiresAt: original.expiresAt }]);
    } finally {
      await reader.client.close();
    }
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(redeem).toHaveBeenCalledWith({ code: request.code, verifier: original.verifier });
    expect(await links.countDocuments()).toBe(0);
  });

  test.each(["unknown attempt", "wrong nonce", "already confirmed"] as const)(
    "refuses %s before contacting the provider and preserves state",
    async (condition) => {
      const { federating, approved, attempts, links, redeem } = setup();
      const request = await approved();
      if (condition === "already confirmed") await federating.finish(request);
      const input = condition === "unknown attempt"
        ? { ...request, attempt: "unknown-attempt" as Attempt }
        : condition === "wrong nonce" ? { ...request, nonce: "another-nonce" } : request;
      const before = await attempts.find().toArray();
      redeem.mockClear();

      expectRefusal(await settle(federating.finish(input)), SignInExpired, EXPIRED);
      expect(redeem).not.toHaveBeenCalled();
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
    },
  );

  test.each([
    { label: "accepts one millisecond before expiry", elapsed: 10 * MINUTE - 1, accepted: true },
    { label: "refuses exactly at expiry", elapsed: 10 * MINUTE, accepted: false },
    { label: "refuses after expiry", elapsed: 10 * MINUTE + 1, accepted: false },
  ])("$label at the initial check", async ({ elapsed, accepted }) => {
    const { federating, approved, attempts, redeem, advance } = setup();
    const request = await approved();
    const before = await attempts.findOne({ _id: request.attempt });
    if (before === null) throw new Error("The started attempt was not saved.");
    advance(elapsed);
    const outcome = await settle(federating.finish(request));
    if (accepted) {
      expect(outcome).toEqual({ status: "fulfilled", value: { username: SAM.username } });
      expect(await attempts.findOne({ _id: request.attempt })).toEqual({ ...before, ...SAM });
      expect(redeem).toHaveBeenCalledTimes(1);
    } else {
      expectRefusal(outcome, SignInExpired, EXPIRED);
      expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
      expect(redeem).not.toHaveBeenCalled();
    }
  });

  test("unknown codes and codes from another attempt cannot confirm a sign-in", async () => {
    const { federating, approved, attempts, links, redeem } = setup();
    const sam = await approved();
    const leo = await approved(LEO);
    const before = await attempts.find().sort({ _id: 1 }).toArray();
    for (const code of ["unknown-code", leo.code]) {
      expectRefusal(await settle(federating.finish({ ...sam, code })), SignInRefused, REFUSED);
      expect(await attempts.find().sort({ _id: 1 }).toArray()).toEqual(before);
    }
    expect(redeem).toHaveBeenCalledTimes(2);
    expect(await federating.finish(sam)).toEqual({ username: SAM.username });
    expect(await attempts.findOne({ _id: leo.attempt })).toEqual(before.find((record) => record._id === leo.attempt)!);
    expect(await links.countDocuments()).toBe(0);
  });

  test("a provider that reports no answer causes SIGN_IN_REFUSED without confirmation or an automatic retry", async () => {
    const { federating, approved, attempts, redeem, advance } = setup();
    const request = await approved();
    const before = await attempts.findOne({ _id: request.attempt });
    // Simulate a provider timeout. Actual HTTP timeout tests are a later step.
    redeem.mockImplementation(async () => {
      advance(10_000);
      return undefined;
    });
    expectRefusal(await settle(federating.finish(request)), SignInRefused, REFUSED);
    expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
    expect(redeem).toHaveBeenCalledTimes(1);
  });

  test.each([
    { label: "accepts a reply just before expiry", waited: 9_999, accepted: true },
    { label: "refuses a reply exactly at expiry", waited: 10_000, accepted: false },
    { label: "refuses a reply after expiry", waited: 10_001, accepted: false },
  ])("$label after waiting for Commons", async ({ waited, accepted }) => {
    const fixture = setup();
    const { federating, approved, attempts, links, redeem, advance } = fixture;
    const request = await approved();
    const before = await attempts.findOne({ _id: request.attempt });
    if (before === null) throw new Error("The started attempt was not saved.");
    advance(10 * MINUTE - 10_000);
    const replies = holdReplies(fixture);
    const pending = settle(federating.finish(request));
    try {
      await replies.arrived;
      expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
      advance(waited);
    } finally {
      replies.release();
    }
    const outcome = await pending;
    if (accepted) {
      expect(outcome).toEqual({ status: "fulfilled", value: { username: SAM.username } });
      expect(await attempts.findOne({ _id: request.attempt })).toEqual({ ...before, ...SAM });
    } else {
      expectRefusal(outcome, SignInExpired, EXPIRED);
      expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
    }
    expect(redeem).toHaveBeenCalledTimes(1);
    expect(await links.countDocuments()).toBe(0);
  });

  test("a late provider reply cannot recreate an attempt removed during the wait", async () => {
    const fixture = setup();
    const { federating, approved, attempts, advance } = fixture;
    const request = await approved();
    const other = await approved(LEO);
    const otherBefore = await attempts.findOne({ _id: other.attempt });
    const replies = holdReplies(fixture);
    const pending = settle(federating.finish(request));
    try {
      await replies.arrived;
      advance(10 * MINUTE);
      // Model expiry cleanup while the provider's reply is still pending.
      await attempts.deleteOne({ _id: request.attempt });
    } finally {
      replies.release();
    }
    expectRefusal(await pending, SignInExpired, EXPIRED);
    expect(await attempts.findOne({ _id: request.attempt })).toBeNull();
    expect(await attempts.findOne({ _id: other.attempt })).toEqual(otherBefore);
  });

  test("two clients finishing one attempt cannot replace each other's confirmation", async () => {
    const fixture = setup();
    const { federating, provider, name, clock, attempts, links, redeem } = fixture;
    const { attempt, address } = await federating.start({});
    const sam = provider.approve(address, SAM);
    const leo = provider.approve(address, LEO);
    const before = await attempts.findOne({ _id: attempt });
    if (before === null) throw new Error("The started attempt was not saved.");
    const secondConnection = await connectMongo({ uri, database });
    try {
      const second = new FederatingConcept<User>(secondConnection.db, provider, name, clock);
      const replies = holdReplies(fixture, 2);
      const pending = Promise.allSettled([
        federating.finish({ attempt, nonce: sam.state, code: sam.code }),
        second.finish({ attempt, nonce: leo.state, code: leo.code }),
      ]);
      try {
        await replies.arrived;
        expect(await attempts.findOne({ _id: attempt })).toEqual(before);
      } finally {
        replies.release();
      }
      const outcomes = await pending;
      const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const losers = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expectRefusal(losers[0]!, SignInExpired, EXPIRED);
      const winner = outcomes[0]!.status === "fulfilled" ? SAM : LEO;
      expect(winners[0]!.value).toEqual({ username: winner.username });
      expect(await attempts.findOne({ _id: attempt })).toEqual({ ...before, ...winner });
      expect(redeem).toHaveBeenCalledTimes(2);
      expect(await links.countDocuments()).toBe(0);
    } finally {
      await secondConnection.client.close();
    }
  });

  test("a rejected confirmation stays a database error; the spent code cannot be reused, and a fresh attempt succeeds", async () => {
    const { federating, approved, attempts, links, redeem, collectionName } = setup();
    const request = await approved();
    const before = await attempts.findOne({ _id: request.attempt });
    await connection!.db.command({
      collMod: collectionName,
      // Reject the username field to prove the subject is not saved separately.
      validator: { username: { $exists: false } },
      validationLevel: "strict", validationAction: "error",
    });
    try {
      await expect(federating.finish(request)).rejects.toMatchObject({ code: 121 });
      expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
      expect(redeem).toHaveBeenCalledTimes(1);
    } finally {
      await connection!.db.command({ collMod: collectionName, validator: {} });
    }
    expectRefusal(await settle(federating.finish(request)), SignInRefused, REFUSED);
    expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
    const fresh = await approved();
    expect(await federating.finish(fresh)).toEqual({ username: SAM.username });
    expect(await attempts.findOne({ _id: fresh.attempt })).toMatchObject(SAM);
    expect(await attempts.findOne({ _id: request.attempt })).toEqual(before);
    expect(redeem).toHaveBeenCalledTimes(3);
    expect(await links.countDocuments()).toBe(0);
  });
});
