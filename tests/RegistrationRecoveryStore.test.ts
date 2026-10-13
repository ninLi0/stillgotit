import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Collection, type Document, type Filter } from "mongodb";
import { RegisteringConcept } from "../src/concepts/Registering/Registering.ts";
import { RegistrationRecoveryStore } from "../src/storage/RegistrationRecoveryStore.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const PROVIDER = "https://commons.example.test";
const SUBJECT = "u7f3";
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredKey {
  provider: string;
  subject: string;
  recoveryKey: string;
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

function setup(provider = PROVIDER, createKey?: () => string) {
  const name = `RegistrationRecovery_${randomUUID()}`;
  return {
    name,
    provider,
    store: new RegistrationRecoveryStore(connection!.db, provider, name, createKey),
    records: connection!.db.collection<StoredKey>(`${name.toLowerCase()}.keys`),
  };
}

// Both clients must see an absent identity before either can attempt its upsert.
async function overlapInitialReads<T>(fixture: ReturnType<typeof setup>, run: () => Promise<T>) {
  const original = Collection.prototype.findOne;
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(() => ready.reject(new Error("Both recovery reads must arrive.")), 5_000);
  let reads = 0;
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const record = await original.call(this, filter, options);
      if (this.dbName === database && this.collectionName === fixture.records.collectionName
        && filter.provider !== undefined && reads < 2) {
        expect(record).toBeNull();
        reads += 1;
        if (reads === 2) ready.resolve();
        await ready.promise;
      }
      return record as T | null;
    },
  );
  try {
    const result = await run();
    expect(reads).toBe(2);
    return result;
  } finally {
    clearTimeout(timeout);
    read.mockRestore();
  }
}

async function readFromNewProcess(name: string, provider: string, subject: string) {
  const child = Bun.spawn([
    process.execPath,
    fileURLToPath(new URL("./fixtures/get-recovery-key.ts", import.meta.url)),
    database, name, provider, subject,
  ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    return JSON.parse(stdout) as { recoveryKey: string };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
}

describe("RegistrationRecoveryStore.getOrCreate", () => {
  test("saves one random key, returns only that key, and leaves matching retries unchanged", async () => {
    const { store, records } = setup();
    const result = await store.getOrCreate({ subject: SUBJECT });
    expect(Object.keys(result)).toEqual(["recoveryKey"]);
    expect(result.recoveryKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await records.findOne<StoredKey>({}, { projection: { _id: 0 } }))
      .toEqual({ provider: PROVIDER, subject: SUBJECT, ...result });
    const before = await records.find().toArray();
    expect(await store.getOrCreate({ subject: SUBJECT })).toEqual(result);
    expect(await store.getOrCreate({ subject: SUBJECT })).toEqual(result);
    expect(await records.find().toArray()).toEqual(before);
    expect((await records.listIndexes().toArray()).every((index) => index.expireAfterSeconds === undefined)).toBe(true);
  });

  test("normalizes provider origins and separates the same subject on different providers", async () => {
    const { name, store, records } = setup();
    const original = await store.getOrCreate({ subject: SUBJECT });
    const equivalent = new RegistrationRecoveryStore(connection!.db, "https://COMMONS.EXAMPLE.TEST:443/connect", name);
    expect(await equivalent.getOrCreate({ subject: SUBJECT })).toEqual(original);
    const other = new RegistrationRecoveryStore(connection!.db, "https://other.example.test", name);
    const differentPort = new RegistrationRecoveryStore(connection!.db, "https://commons.example.test:444", name);
    const http = new RegistrationRecoveryStore(connection!.db, "http://commons.example.test", name);
    const results = await Promise.all([other, differentPort, http].map((instance) => instance.getOrCreate({ subject: SUBJECT })));
    expect(new Set([original.recoveryKey, ...results.map((result) => result.recoveryKey)]).size).toBe(4);
    expect(await records.countDocuments()).toBe(4);
    expect(await records.countDocuments({ provider: PROVIDER, subject: SUBJECT })).toBe(1);
  });

  test("compares subjects exactly without case folding or trimming", async () => {
    const { store, records } = setup();
    const subjects = [SUBJECT, SUBJECT.toUpperCase(), ` ${SUBJECT} `];
    const results = [];
    for (const subject of subjects) results.push(await store.getOrCreate({ subject }));
    expect(new Set(results.map((result) => result.recoveryKey)).size).toBe(3);
    for (let index = 0; index < subjects.length; index += 1) {
      expect(await store.getOrCreate({ subject: subjects[index]! })).toEqual(results[index]!);
    }
    expect(await records.countDocuments()).toBe(3);
  });

  test("refuses invalid provider configuration without creating records", async () => {
    const { name, records } = setup();
    for (const provider of ["", "not-a-url", "file:///tmp/commons", "memory://commons", undefined, null]) {
      expect(() => new RegistrationRecoveryStore(connection!.db, provider as string, name)).toThrow(TypeError);
    }
    expect(await records.countDocuments()).toBe(0);
  });

  test("refuses blank or non-string subjects without reserving a key", async () => {
    const { store, records } = setup();
    for (const subject of ["", " \t\n", "\u00a0", undefined, null, 42, { $ne: "" }]) {
      await expect(store.getOrCreate({ subject: subject as string })).rejects.toBeInstanceOf(TypeError);
      expect(await records.countDocuments()).toBe(0);
    }
    const saved = await store.getOrCreate({ subject: SUBJECT });
    expect(await records.findOne({ provider: PROVIDER, subject: SUBJECT }))
      .toMatchObject(saved);
  });

  test("two sign-in clients racing for one identity receive one key and register one local account", async () => {
    const fixture = setup(PROVIDER, () => "first-candidate");
    const secondConnection = await connectMongo({ uri, database });
    try {
      const second = new RegistrationRecoveryStore(secondConnection.db, PROVIDER, fixture.name, () => "second-candidate");
      const outcomes = await overlapInitialReads(fixture, () => Promise.allSettled([
        fixture.store.getOrCreate({ subject: SUBJECT }), second.getOrCreate({ subject: SUBJECT }),
      ]));
      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
      const saved = await fixture.records.findOne({ provider: PROVIDER, subject: SUBJECT });
      expect(saved).not.toBeNull();
      expect(["first-candidate", "second-candidate"]).toContain(saved!.recoveryKey);
      expect(outcomes).toEqual([
        { status: "fulfilled", value: { recoveryKey: saved!.recoveryKey } },
        { status: "fulfilled", value: { recoveryKey: saved!.recoveryKey } },
      ]);
      expect(await fixture.records.countDocuments()).toBe(1);

      // Explicit concept calls show why the shared key matters. Browser sign-in is not wired yet.
      const firstAccounts = new RegisteringConcept(connection!.db, fixture.name);
      const secondAccounts = new RegisteringConcept(secondConnection.db, fixture.name);
      const input = { username: "sam", recoveryKey: saved!.recoveryKey };
      const [first, next] = await Promise.all([firstAccounts.register(input), secondAccounts.register(input)]);
      expect(next).toEqual(first);
      expect(await connection!.db.collection(`${fixture.name.toLowerCase()}.users`).countDocuments()).toBe(1);
    } finally {
      await secondConnection.client.close();
    }
  });

  test("concurrent identities that generate the same candidate receive different saved keys", async () => {
    let firstCalls = 0;
    const fixture = setup(PROVIDER, () => ++firstCalls === 1 ? "shared-candidate" : "first-fallback");
    let secondCalls = 0;
    const secondConnection = await connectMongo({ uri, database });
    try {
      const second = new RegistrationRecoveryStore(
        secondConnection.db, PROVIDER, fixture.name,
        () => ++secondCalls === 1 ? "shared-candidate" : "second-fallback",
      );
      const outcomes = await overlapInitialReads(fixture, () => Promise.allSettled([
        fixture.store.getOrCreate({ subject: "first-account" }), second.getOrCreate({ subject: "second-account" }),
      ]));
      expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
      const first = await fixture.records.findOne({ provider: PROVIDER, subject: "first-account" });
      const next = await fixture.records.findOne({ provider: PROVIDER, subject: "second-account" });
      expect(first!.recoveryKey).not.toBe(next!.recoveryKey);
      expect([first!.recoveryKey, next!.recoveryKey]).toContain("shared-candidate");
      expect(outcomes).toEqual([
        { status: "fulfilled", value: { recoveryKey: first!.recoveryKey } },
        { status: "fulfilled", value: { recoveryKey: next!.recoveryKey } },
      ]);
      expect(firstCalls + secondCalls).toBe(3);
      expect(await fixture.records.countDocuments()).toBe(2);
    } finally {
      await secondConnection.client.close();
    }
  });

  test("a fresh Bun process returns the same key after the original client closes", async () => {
    const { name, records } = setup();
    const writer = await connectMongo({ uri, database });
    let saved: { recoveryKey: string };
    try {
      saved = await new RegistrationRecoveryStore(writer.db, PROVIDER, name).getOrCreate({ subject: SUBJECT });
    } finally {
      await writer.client.close();
    }
    const before = await records.find().toArray();
    expect(await readFromNewProcess(name, PROVIDER, SUBJECT)).toEqual(saved);
    expect(await records.find().toArray()).toEqual(before);
  });

  test("a committed upsert with a lost reply rejects, then a new process recovers the saved key", async () => {
    const { name, store, records } = setup();
    const lostReply = new Error("Simulated lost recovery-key reply.");
    const original = Collection.prototype.findOneAndUpdate;
    let intercepted = false;
    const write = spyOn(Collection.prototype, "findOneAndUpdate").mockImplementation(
      async function(this: Collection, ...args: Parameters<typeof original>) {
        const result = await original.apply(this, args);
        if (!intercepted && this.dbName === database && this.collectionName === records.collectionName) {
          intercepted = true;
          throw lostReply;
        }
        return result;
      },
    );
    try {
      await expect(store.getOrCreate({ subject: SUBJECT })).rejects.toBe(lostReply);
      expect(intercepted).toBe(true);
    } finally {
      write.mockRestore();
    }
    const before = await records.find().toArray();
    expect(before).toHaveLength(1);
    expect(await readFromNewProcess(name, PROVIDER, SUBJECT)).toEqual({ recoveryKey: before[0]!.recoveryKey });
    expect(await records.find().toArray()).toEqual(before);
  });

  test("a rejected write returns no candidate key and permits a later valid retry", async () => {
    const { store, records } = setup();
    await connection!.db.createCollection(records.collectionName, {
      validator: { subject: { $ne: SUBJECT } }, validationAction: "error",
    });
    await expect(store.getOrCreate({ subject: SUBJECT })).rejects.toMatchObject({ code: 121 });
    expect(await records.countDocuments()).toBe(0);
    await connection!.db.command({ collMod: records.collectionName, validator: {} });
    const saved = await store.getOrCreate({ subject: SUBJECT });
    expect(await records.findOne<StoredKey>({}, { projection: { _id: 0 } }))
      .toEqual({ provider: PROVIDER, subject: SUBJECT, ...saved });
  });

  test("repeated key collisions stop without claiming another identity and permit a later retry", async () => {
    const { name, store, records } = setup();
    const first = await store.getOrCreate({ subject: SUBJECT });
    const before = await records.find().toArray();
    let candidate = first.recoveryKey;
    let calls = 0;
    const colliding = new RegistrationRecoveryStore(connection!.db, PROVIDER, name, () => { calls += 1; return candidate; });
    await expect(colliding.getOrCreate({ subject: "other-account" }))
      .rejects.toThrow("Could not allocate a unique recovery key.");
    expect(calls).toBe(3);
    expect(await records.find().toArray()).toEqual(before);
    candidate = randomUUID();
    expect(await colliding.getOrCreate({ subject: "other-account" })).toEqual({ recoveryKey: candidate });
    expect(await store.getOrCreate({ subject: SUBJECT })).toEqual(first);
    expect(await records.countDocuments()).toBe(2);
  });

  test("missing or invalid stored keys cause an error without replacing the record", async () => {
    for (const recoveryKey of [undefined, null, "", " \t"]) {
      const { store, records } = setup();
      const raw: Document = { provider: PROVIDER, subject: SUBJECT };
      if (recoveryKey !== undefined) raw.recoveryKey = recoveryKey;
      // Model damaged storage. The normal helper never writes these values.
      await connection!.db.collection(records.collectionName).insertOne(raw);
      const before = await records.find().toArray();
      await expect(store.getOrCreate({ subject: SUBJECT }))
        .rejects.toThrow("The saved recovery key is missing or invalid.");
      expect(await records.find().toArray()).toEqual(before);
    }
  });

  test("an unrelated unique-index error remains a database error", async () => {
    const { store, records } = setup();
    await store.getOrCreate({ subject: SUBJECT });
    const before = await records.find().toArray();
    // This test-only constraint permits one record with the field missing.
    await records.createIndex({ unrelatedConstraint: 1 }, { unique: true });
    await expect(store.getOrCreate({ subject: "other-account" }))
      .rejects.toMatchObject({ code: 11000, keyPattern: { unrelatedConstraint: 1 } });
    expect(await records.find().toArray()).toEqual(before);
    await records.dropIndex("unrelatedConstraint_1");
    const saved = await store.getOrCreate({ subject: "other-account" });
    expect(saved.recoveryKey).not.toBe(before[0]!.recoveryKey);
  });

  test("failed index creation prevents use of duplicate identity records and can recover after repair", async () => {
    const { store, records } = setup();
    const inserted = await records.insertMany([
      { provider: PROVIDER, subject: SUBJECT, recoveryKey: "first-key" },
      { provider: PROVIDER, subject: SUBJECT, recoveryKey: "second-key" },
    ]);
    const before = await records.find().toArray();
    await expect(store.getOrCreate({ subject: SUBJECT })).rejects.toMatchObject({ code: 11000 });
    expect(await records.find().toArray()).toEqual(before);
    await records.deleteOne({ _id: inserted.insertedIds[1] });
    expect(await store.getOrCreate({ subject: SUBJECT })).toEqual({ recoveryKey: "first-key" });
    expect(await records.countDocuments()).toBe(1);
  });
});
