import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Session, SessioningConcept } from "../src/concepts/Sessioning/Sessioning.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const DAY = 24 * 60 * 60 * 1000;
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
  // Keep time fixed within each test, but start at real time so MongoDB's
  // expiry cleanup cannot remove these sessions during the test.
  const started = new Date();
  const collectionName = `${name.toLowerCase()}.sessions`;
  return {
    started,
    collectionName,
    sessioning: new SessioningConcept<string>(connection!.db, name, () => started),
    records: connection!.db.collection<StoredSession>(collectionName),
  };
}

describe("Sessioning.start", () => {
  test("saves the subject, creation time, and a fixed 90-day expiry before returning", async () => {
    const { sessioning, records, started } = setup();
    const result = await sessioning.start({ subject: "maya-user-id" });
    const expiry = new Date(started.getTime() + 90 * DAY);

    expect(result).toEqual({ session: expect.any(String), expiresAt: expiry });
    expect(await records.findOne({ _id: result.session })).toEqual({
      _id: result.session,
      subject: "maya-user-id",
      lastUsed: started,
      expiresAt: expiry,
    });
    expect(await records.countDocuments()).toBe(1);
  });

  // Extends ConceptBox's token-format test. See THIRD_PARTY_NOTICES.md.
  test("simultaneous starts create separate 32-byte session IDs, even for the same subject", async () => {
    const { sessioning, records, started } = setup();
    const subjects = ["maya-user-id", "maya-user-id", "sam-user-id"];
    const results = await Promise.all(subjects.map((subject) => sessioning.start({ subject })));

    expect(new Set(results.map(({ session }) => session)).size).toBe(3);
    for (const [index, result] of results.entries()) {
      expect(result.session).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(result.session, "base64url")).toHaveLength(32);
      expect(await records.findOne({ _id: result.session })).toEqual({
        _id: result.session,
        subject: subjects[index],
        lastUsed: started,
        expiresAt: new Date(started.getTime() + 90 * DAY),
      });
    }
    expect(await records.countDocuments()).toBe(3);
  });

  test("a fresh database client reads the session after the writer closes", async () => {
    const name = `Sessioning_${randomUUID()}`;
    const writer = await connectMongo({ uri, database });
    const before = new Date();
    let saved: { session: Session; expiresAt: Date };
    try {
      // Use the production clock here; the other tests inject a fixed clock.
      saved = await new SessioningConcept<string>(writer.db, name).start({ subject: "maya-user-id" });
    } finally {
      await writer.client.close();
    }
    const after = new Date();

    const reader = await connectMongo({ uri, database });
    try {
      const records = reader.db.collection<StoredSession>(`${name.toLowerCase()}.sessions`);
      const record = await records.findOne({ _id: saved.session });
      expect(record).not.toBeNull();
      expect(record!.subject).toBe("maya-user-id");
      expect(record!.lastUsed.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(record!.lastUsed.getTime()).toBeLessThanOrEqual(after.getTime());
      expect(record!.expiresAt).toEqual(saved.expiresAt);
      expect(record!.expiresAt.getTime() - record!.lastUsed.getTime()).toBe(90 * DAY);
    } finally {
      await reader.client.close();
    }
  });

  test("a rejected database write saves no session and a later valid start succeeds", async () => {
    const { sessioning, records, collectionName } = setup();
    // Refuse one fixture value in this test's collection. Do not alter the concept.
    await connection!.db.createCollection(collectionName, {
      validator: { subject: { $ne: "blocked-test-subject" } },
      validationLevel: "strict",
      validationAction: "error",
    });

    await expect(sessioning.start({ subject: "blocked-test-subject" }))
      .rejects.toMatchObject({ code: 121 });
    expect(await records.countDocuments()).toBe(0);

    const result = await sessioning.start({ subject: "maya-user-id" });
    expect(await records.findOne({ _id: result.session })).toMatchObject({
      subject: "maya-user-id", expiresAt: result.expiresAt,
    });
    expect(await records.countDocuments()).toBe(1);
  });
});
