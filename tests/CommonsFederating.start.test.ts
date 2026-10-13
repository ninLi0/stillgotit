// Adapts ConceptBox's start and address tests. See THIRD_PARTY_NOTICES.md.
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { type Attempt, FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { CommonsProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const COMMONS = "https://class.mit-sdg.dev";
const APP = "http://localhost:5173"; // Test fixture; the frontend is not configured yet.
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
  // Fix the clock near real time so MongoDB cleanup cannot remove the fixture.
  const started = new Date();
  const provider = new CommonsProvider({ origin: COMMONS, app: APP });
  // start only builds an address. Block redemption so these tests cannot contact Commons.
  const redeem = spyOn(provider, "redeem").mockRejectedValue(new Error("start must not redeem a code."));
  const collectionName = `${name.toLowerCase()}.attempts`;
  return {
    name, started, provider, redeem, collectionName,
    federating: new FederatingConcept<User>(connection!.db, provider, name, () => started),
    attempts: connection!.db.collection<StoredAttempt>(collectionName),
    links: connection!.db.collection(`${name.toLowerCase()}.links`),
  };
}

describe("CommonsFederating.start", () => {
  test("saves an unconfirmed ten-minute attempt and returns a Commons address without its verifier", async () => {
    const { federating, attempts, links, started, redeem } = setup();
    const result = await federating.start({});
    const expiresAt = new Date(started.getTime() + 10 * MINUTE);
    expect(result).toEqual({ attempt: expect.any(String), expiresAt, address: expect.any(String) });
    const record = await attempts.findOne({ _id: result.attempt });
    expect(record).toEqual({
      _id: result.attempt, nonce: expect.any(String), verifier: expect.any(String), expiresAt,
    });
    expect(await attempts.countDocuments()).toBe(1);
    expect(await links.countDocuments()).toBe(0);

    const address = new URL(result.address);
    expect(address.origin).toBe(COMMONS);
    expect(address.pathname).toBe("/connect");
    expect(Object.fromEntries(address.searchParams)).toEqual({
      app: APP,
      state: record!.nonce,
      code_challenge: createHash("sha256").update(record!.verifier).digest("base64url"),
      code_challenge_method: "S256",
    });
    expect(result.address).not.toContain(record!.verifier);
    expect(result.address).not.toContain(result.attempt);
    expect(redeem).not.toHaveBeenCalled();
    expect(await attempts.indexes()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 60 }),
    ]));
    expect(await links.indexes()).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: { subject: 1 }, unique: true }),
    ]));
  });

  test("the Commons address uses the published S256 challenge and preserves the app's local port", () => {
    // RFC 7636, appendix B, also used by ConceptBox's CommonsProvider tests.
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    const challenge = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
    const provider = new CommonsProvider({ origin: `${COMMONS}/`, app: `${APP}/` });
    const address = new URL(provider.address({ nonce: "test-sign-in-nonce", verifier }));
    expect(address.origin).toBe(COMMONS);
    expect(address.pathname).toBe("/connect");
    expect(Object.fromEntries(address.searchParams)).toEqual({
      app: APP, state: "test-sign-in-nonce", code_challenge: challenge, code_challenge_method: "S256",
    });
  });

  test("simultaneous starts save separate 32-byte attempts, nonces, and verifiers", async () => {
    const { federating, attempts, links, started, redeem } = setup();
    const results = await Promise.all([federating.start({}), federating.start({}), federating.start({})]);
    const tokens: string[] = [];
    for (const result of results) {
      const record = await attempts.findOne({ _id: result.attempt });
      expect(record).not.toBeNull();
      expect(record!.expiresAt).toEqual(new Date(started.getTime() + 10 * MINUTE));
      expect(record!.subject).toBeUndefined();
      expect(new URL(result.address).searchParams.get("state")).toBe(record!.nonce);
      for (const token of [record!._id, record!.nonce, record!.verifier]) {
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(Buffer.from(token, "base64url")).toHaveLength(32);
        tokens.push(token);
      }
    }
    expect(new Set(tokens).size).toBe(9);
    expect(await attempts.countDocuments()).toBe(3);
    expect(await links.countDocuments()).toBe(0);
    expect(redeem).not.toHaveBeenCalled();
  });

  test("a fresh database client reads the complete attempt after the writer closes", async () => {
    const { name, provider, redeem, collectionName } = setup();
    const writer = await connectMongo({ uri, database });
    const before = new Date();
    let saved: Awaited<ReturnType<FederatingConcept<User>["start"]>>;
    let expected: StoredAttempt | null;
    try {
      // Use the production clock to check expiry against the actual start time.
      saved = await new FederatingConcept<User>(writer.db, provider, name).start({});
      expected = await writer.db.collection<StoredAttempt>(collectionName).findOne({ _id: saved.attempt });
      expect(expected).not.toBeNull();
    } finally {
      await writer.client.close();
    }
    const after = new Date();

    const reader = await connectMongo({ uri, database });
    try {
      const record = await reader.db.collection<StoredAttempt>(collectionName).findOne({ _id: saved.attempt });
      expect(record).toEqual(expected);
      expect(record!.expiresAt).toEqual(saved.expiresAt);
      expect(record!.expiresAt.getTime()).toBeGreaterThanOrEqual(before.getTime() + 10 * MINUTE);
      expect(record!.expiresAt.getTime()).toBeLessThanOrEqual(after.getTime() + 10 * MINUTE);
      expect(new URL(saved.address).searchParams.get("state")).toBe(record!.nonce);
      expect(redeem).not.toHaveBeenCalled();
    } finally {
      await reader.client.close();
    }
  });

  test("a rejected insert leaves no attempt and returns no address, and a later start succeeds", async () => {
    const { federating, attempts, links, provider, redeem, collectionName } = setup();
    await connection!.db.createCollection(collectionName, {
      validator: { blockedTestField: { $exists: true } },
      validationLevel: "strict", validationAction: "error",
    });
    const address = spyOn(provider, "address");
    try {
      await expect(federating.start({})).rejects.toMatchObject({ code: 121 });
      expect(await attempts.countDocuments()).toBe(0);
      expect(await links.countDocuments()).toBe(0);
      expect(address).not.toHaveBeenCalled();
      expect(redeem).not.toHaveBeenCalled();
    } finally {
      await connection!.db.command({ collMod: collectionName, validator: {} });
      address.mockRestore();
    }

    const result = await federating.start({});
    expect(await attempts.findOne({ _id: result.attempt })).toMatchObject({ expiresAt: result.expiresAt });
    expect(await attempts.countDocuments()).toBe(1);
    expect(await links.countDocuments()).toBe(0);
    expect(new URL(result.address).origin).toBe(COMMONS);
    expect(redeem).not.toHaveBeenCalled();
  });
});
