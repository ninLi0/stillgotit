// Adapts ConceptBox's clock setup and use scenarios. See THIRD_PARTY_NOTICES.md.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  NotSignedIn,
  type Session,
  SessioningConcept,
} from "../src/concepts/Sessioning/Sessioning.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredSession {
  _id: Session;
  subject: string;
  lastUsed: Date;
  expiresAt: Date;
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
  const name = `Sessioning_${randomUUID()}`;
  // Advance only the concept's clock. MongoDB's real clock stays before expiry,
  // so refusals must come from use itself, not background deletion.
  const started = new Date();
  let now = started;
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const collectionName = `${name.toLowerCase()}.sessions`;
  return {
    name, started, clock, advance, collectionName,
    sessioning: new SessioningConcept<string>(connection!.db, name, clock),
    records: connection!.db.collection<StoredSession>(collectionName),
  };
}

async function expectNotSignedIn(attempt: Promise<unknown>) {
  await expect(attempt).rejects.toBeInstanceOf(NotSignedIn);
  await expect(attempt).rejects.toThrow("Your session has ended. Sign in again.");
}

describe("Sessioning.use", () => {
  test.each([
    { label: "accepts one millisecond before seven idle days", elapsed: 7 * DAY - 1, accepted: true },
    { label: "refuses exactly seven idle days", elapsed: 7 * DAY, accepted: false },
    { label: "refuses after seven idle days", elapsed: 7 * DAY + 1, accepted: false },
  ])("$label and preserves all other state", async ({ elapsed, accepted }) => {
    const { sessioning, records, clock, advance } = setup();
    const { session } = await sessioning.start({ subject: "maya-user-id" });
    await sessioning.start({ subject: "sam-user-id" });
    const before = await records.find().sort({ _id: 1 }).toArray();
    advance(elapsed);

    if (accepted) {
      expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
      expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(
        before.map((record) => record._id === session ? { ...record, lastUsed: clock() } : record),
      );
    } else {
      await expectNotSignedIn(sessioning.use({ session }));
      expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(before);
    }
  });

  test("the idle window starts from the latest successful use, without extending the fixed expiry", async () => {
    const { sessioning, records, started, clock, advance } = setup();
    const { session, expiresAt } = await sessioning.start({ subject: "maya-user-id" });

    for (let use = 0; use < 2; use += 1) {
      advance(6 * DAY);
      expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
      expect(await records.findOne({ _id: session })).toEqual({
        _id: session, subject: "maya-user-id", lastUsed: clock(), expiresAt,
      });
    }
    expect(clock()).toEqual(new Date(started.getTime() + 12 * DAY));
    expect(expiresAt).toEqual(new Date(started.getTime() + 90 * DAY));

    const beforeRefusal = await records.findOne({ _id: session });
    advance(7 * DAY);
    await expectNotSignedIn(sessioning.use({ session }));
    expect(await records.findOne({ _id: session })).toEqual(beforeRefusal);
  });

  test("accepts just before 90 days, then refuses at and after expiry despite recent use", async () => {
    const { sessioning, records, started, clock, advance } = setup();
    const { session, expiresAt } = await sessioning.start({ subject: "maya-user-id" });

    // Keep the session active through day 84 so only the lifetime limit can fail.
    for (let day = 6; day <= 84; day += 6) {
      advance(6 * DAY);
      expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
    }
    advance(6 * DAY - 1);
    expect(clock()).toEqual(new Date(started.getTime() + 90 * DAY - 1));
    expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
    const beforeRefusal = await records.findOne({ _id: session });
    expect(beforeRefusal).toEqual({
      _id: session, subject: "maya-user-id", lastUsed: clock(), expiresAt,
    });

    advance(1);
    expect(clock()).toEqual(expiresAt);
    await expectNotSignedIn(sessioning.use({ session }));
    advance(1);
    await expectNotSignedIn(sessioning.use({ session }));
    expect(await records.findOne({ _id: session })).toEqual(beforeRefusal);
  });

  test("an unknown session returns the declared refusal and changes no records", async () => {
    const { sessioning, records, advance } = setup();
    await sessioning.start({ subject: "maya-user-id" });
    const before = await records.find().toArray();
    advance(MINUTE);

    await expectNotSignedIn(sessioning.use({ session: "unknown-session" as Session }));
    expect(await records.find().toArray()).toEqual(before);
  });

  test("a second database client saves activity that later uses can read", async () => {
    const { sessioning, name, records, clock, advance } = setup();
    const { session, expiresAt } = await sessioning.start({ subject: "maya-user-id" });
    advance(DAY);

    const secondConnection = await connectMongo({ uri, database });
    try {
      const second = new SessioningConcept<string>(secondConnection.db, name, clock);
      expect(await second.use({ session })).toEqual({ subject: "maya-user-id" });
    } finally {
      await secondConnection.client.close();
    }
    expect(await records.findOne({ _id: session })).toEqual({
      _id: session, subject: "maya-user-id", lastUsed: clock(), expiresAt,
    });

    // Day 7 from creation is valid because the second client used it on day 1.
    advance(6 * DAY);
    expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
    expect(await records.findOne({ _id: session })).toEqual({
      _id: session, subject: "maya-user-id", lastUsed: clock(), expiresAt,
    });
  });

  test("a rejected activity update stays a database error, preserves state, and allows retry", async () => {
    const { sessioning, records, collectionName, started, clock, advance } = setup();
    const { session, expiresAt } = await sessioning.start({ subject: "maya-user-id" });
    const before = await records.findOne({ _id: session });
    // Allow the existing record but reject a changed lastUsed in this test collection.
    await connection!.db.command({
      collMod: collectionName,
      validator: { lastUsed: { $eq: started } },
      validationLevel: "strict", validationAction: "error",
    });
    advance(MINUTE);
    try {
      await expect(sessioning.use({ session })).rejects.toMatchObject({ code: 121 });
      expect(await records.findOne({ _id: session })).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: collectionName, validator: {} });
    }

    expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
    expect(await records.findOne({ _id: session })).toEqual({
      _id: session, subject: "maya-user-id", lastUsed: clock(), expiresAt,
    });
  });
});
