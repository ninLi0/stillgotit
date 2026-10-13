// Adapts ConceptBox's clock, refusal, and concurrent-end tests. See THIRD_PARTY_NOTICES.md.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { MongoServerError } from "mongodb";
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
  // Keep MongoDB's real clock before expiry while advancing the concept's clock.
  // This checks end's own rules before background cleanup removes any record.
  let now = new Date();
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const collectionName = `${name.toLowerCase()}.sessions`;
  return {
    name, clock, advance, collectionName,
    sessioning: new SessioningConcept<string>(connection!.db, name, clock),
    records: connection!.db.collection<StoredSession>(collectionName),
  };
}

async function expectNotSignedIn(attempt: Promise<unknown>) {
  await expect(attempt).rejects.toBeInstanceOf(NotSignedIn);
  await expect(attempt).rejects.toThrow("Your session has ended. Sign in again.");
}

describe("Sessioning.end", () => {
  test("ends only the chosen session and keeps it ended after the ending client closes", async () => {
    const { sessioning, records, name, clock, advance } = setup();
    const laptop = await sessioning.start({ subject: "maya-user-id" });
    const phone = await sessioning.start({ subject: "maya-user-id" });
    const otherUser = await sessioning.start({ subject: "sam-user-id" });
    const before = await records.find().sort({ _id: 1 }).toArray();
    advance(MINUTE);

    const endingConnection = await connectMongo({ uri, database });
    try {
      const ending = new SessioningConcept<string>(endingConnection.db, name, clock);
      expect(await ending.end({ session: laptop.session })).toEqual({ session: laptop.session });
    } finally {
      await endingConnection.client.close();
    }
    const remaining = before.filter((record) => record._id !== laptop.session);
    expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(remaining);
    await expectNotSignedIn(sessioning.end({ session: laptop.session }));
    expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(remaining);

    const readerConnection = await connectMongo({ uri, database });
    try {
      const reader = new SessioningConcept<string>(readerConnection.db, name, clock);
      await expectNotSignedIn(reader.use({ session: laptop.session }));
      expect(await reader.use({ session: phone.session })).toEqual({ subject: "maya-user-id" });
      expect(await reader.use({ session: otherUser.session })).toEqual({ subject: "sam-user-id" });
    } finally {
      await readerConnection.client.close();
    }
    expect(await records.findOne({ _id: laptop.session })).toBeNull();
  });

  test("an unknown session is refused without changing any records", async () => {
    const { sessioning, records } = setup();
    await sessioning.start({ subject: "maya-user-id" });
    const before = await records.find().toArray();

    await expectNotSignedIn(sessioning.end({ session: "unknown-session" as Session }));
    expect(await records.find().toArray()).toEqual(before);
  });

  test.each([
    { label: "ends one millisecond before seven idle days", elapsed: 7 * DAY - 1, accepted: true },
    { label: "refuses exactly seven idle days", elapsed: 7 * DAY, accepted: false },
    { label: "refuses after seven idle days", elapsed: 7 * DAY + 1, accepted: false },
  ])("$label and preserves other records", async ({ elapsed, accepted }) => {
    const { sessioning, records, advance } = setup();
    const { session } = await sessioning.start({ subject: "maya-user-id" });
    await sessioning.start({ subject: "sam-user-id" });
    const before = await records.find().sort({ _id: 1 }).toArray();
    advance(elapsed);

    if (accepted) {
      expect(await sessioning.end({ session })).toEqual({ session });
      expect(await records.find().sort({ _id: 1 }).toArray())
        .toEqual(before.filter((record) => record._id !== session));
    } else {
      await expectNotSignedIn(sessioning.end({ session }));
      expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(before);
    }
  });

  test.each([
    { label: "ends one millisecond before 90 days", offset: -1, accepted: true },
    { label: "refuses exactly at the 90-day expiry", offset: 0, accepted: false },
    { label: "refuses after the 90-day expiry", offset: 1, accepted: false },
  ])("$label despite recent activity", async ({ offset, accepted }) => {
    const { sessioning, records, clock, advance } = setup();
    const { session, expiresAt } = await sessioning.start({ subject: "maya-user-id" });
    // Keep activity recent so only the fixed lifetime determines the result.
    for (let day = 6; day <= 84; day += 6) {
      advance(6 * DAY);
      expect(await sessioning.use({ session })).toEqual({ subject: "maya-user-id" });
    }
    await sessioning.start({ subject: "sam-user-id" });
    const before = await records.find().sort({ _id: 1 }).toArray();
    advance(6 * DAY + offset);
    expect(clock().getTime()).toBe(expiresAt.getTime() + offset);

    if (accepted) {
      expect(await sessioning.end({ session })).toEqual({ session });
      expect(await records.find().sort({ _id: 1 }).toArray())
        .toEqual(before.filter((record) => record._id !== session));
    } else {
      await expectNotSignedIn(sessioning.end({ session }));
      expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(before);
    }
  });

  test("two clients ending one session together produce one success and one refusal", async () => {
    const { sessioning, records, name, clock } = setup();
    const { session } = await sessioning.start({ subject: "maya-user-id" });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const second = new SessioningConcept<string>(secondConnection.db, name, clock);
      const outcomes = await Promise.allSettled([
        sessioning.end({ session }),
        second.end({ session }),
      ]);
      const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const losers = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(winners[0]!.value).toEqual({ session });
      expect(losers).toHaveLength(1);
      expect(losers[0]!.reason).toBeInstanceOf(NotSignedIn);
      expect(losers[0]!.reason.message).toBe("Your session has ended. Sign in again.");
      expect(await records.findOne({ _id: session })).toBeNull();
      await expectNotSignedIn(sessioning.use({ session }));
      await expectNotSignedIn(second.use({ session }));
    } finally {
      await secondConnection.client.close();
    }
  });

  test("a rejected deletion stays a database error, preserves state, and allows retry", async () => {
    const { sessioning, records, collectionName } = setup();
    const { session } = await sessioning.start({ subject: "maya-user-id" });
    await sessioning.start({ subject: "sam-user-id" });
    const before = await records.find().sort({ _id: 1 }).toArray();
    const backing = `${collectionName}_backing`;

    // A read-only view rejects deletion without changing the concept or its data.
    // Both names belong only to this test's generated database and namespace.
    await records.rename(backing);
    await connection!.db.createCollection(collectionName, { viewOn: backing });
    try {
      const attempt = sessioning.end({ session });
      await expect(attempt).rejects.toBeInstanceOf(MongoServerError);
      await expect(attempt).rejects.toMatchObject({ code: 166 });
      expect(await records.find().sort({ _id: 1 }).toArray()).toEqual(before);
    } finally {
      await connection!.db.collection(collectionName).drop();
      await connection!.db.collection(backing).rename(collectionName);
    }

    expect(await sessioning.end({ session })).toEqual({ session });
    expect(await records.find().sort({ _id: 1 }).toArray())
      .toEqual(before.filter((record) => record._id !== session));
    await expectNotSignedIn(sessioning.use({ session }));
  });
});
