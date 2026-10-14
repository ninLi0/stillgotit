import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Collection, type Document, type Filter, MongoError } from "mongodb";
import {
  ImportRequestConflict, InvalidImportRequest, MaterialImportStore,
  type ImportIdentity, type ImportOperation, type ImportRequest,
} from "../src/storage/MaterialImportStore.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

type Start = ImportIdentity & { request: ImportRequest };
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

beforeAll(async () => { connection = await connectMongo({ uri, database }); });
afterAll(async () => {
  if (!connection) return;
  try { await connection.db.dropDatabase(); }
  finally { await connection.client.close(); }
});

function setup() {
  const name = `MaterialImport_${randomUUID()}`;
  return {
    name, store: new MaterialImportStore(connection!.db, name),
    records: connection!.db.collection<ImportOperation>(`${name.toLowerCase()}.operations`),
  };
}

// Declared metadata only; no file upload or hash verification is performed in these tests.
function start(): Start {
  return {
    owner: "learner-sam", requestId: "request-lesson-1",
    request: {
      scope: "course-linear-algebra", title: "Matrix multiplication", origin: "COURSE",
      sources: [
        { kind: "UPLOAD", name: "lesson.pdf", size: 1024, sha256: "a".repeat(64) },
        { kind: "REFERENCE", locator: "https://example.test/matrix-lesson" },
      ],
    },
  };
}

function identity({ owner, requestId }: Start): ImportIdentity { return { owner, requestId }; }

test("import checkpoints freeze preparation and survive a lost reply and restart", async () => {
  const { store, name, records } = setup(), input = start(), id = identity(input);
  const created = await store.getOrCreate(input);
  const source = [{ file: "retained/source.pdf", name: "lesson.pdf", mediaType: "application/pdf", renditions: [], limitations: [] }];
  const retained = await store.saveSources({ ...id, revision: 0, sources: source });
  expect(retained.stage).toBe("SOURCES_SAVED");
  const prepared = { owner: input.owner, importKey: created.importKey, scope: input.request.scope, title: input.request.title,
    locator: `upload:${created.importKey}`, content: "Matrix multiplication", originals: source, origin: input.request.origin };
  const original = Collection.prototype.updateOne;
  const write = spyOn(Collection.prototype, "updateOne").mockImplementation(async function(this: Collection, ...args: Parameters<typeof original>) {
    const result = await original.apply(this, args);
    if (this.dbName === database && this.collectionName === records.collectionName) throw new Error("Lost prepared reply");
    return result;
  });
  try { await expect(store.savePrepared({ ...id, revision: retained.revision, prepared })).rejects.toThrow("Lost prepared reply"); }
  finally { write.mockRestore(); }
  const restarted = new MaterialImportStore(connection!.db, name), recovered = await restarted.getOrCreate(input);
  expect(recovered.stage).toBe("READY"); expect(recovered.prepared).toEqual(prepared);
  expect(await restarted.savePrepared({ ...id, revision: retained.revision, prepared })).toEqual(recovered);
  await expect(restarted.savePrepared({ ...id, revision: recovered.revision, prepared: { ...prepared, content: "Changed" } })).rejects.toMatchObject({ code: "IMPORT_PROGRESS_CONFLICT" });
  const complete = await restarted.complete({ ...id, revision: recovered.revision, material: "saved-material" });
  expect(complete.stage).toBe("COMPLETE");
  expect(await restarted.complete({ ...id, revision: recovered.revision, material: "saved-material" })).toEqual(complete);
  expect((await recoverInNewProcess(name, input)).retried).toEqual(complete);
  expect(await restarted.get({ ...id, owner: "other" })).toBeNull();
});

test("competing progress writes keep one complete source snapshot", async () => {
  const { store, name } = setup(), input = start(), id = identity(input);
  await store.getOrCreate(input);
  const second = new MaterialImportStore(connection!.db, name);
  const sources = ["a", "b"].map((name) => [{ file: name, name, mediaType: "text/plain", renditions: [], limitations: [] }]);
  const results = await Promise.allSettled([store.saveSources({ ...id, revision: 0, sources: sources[0]! }), second.saveSources({ ...id, revision: 0, sources: sources[1]! })]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const saved = await store.get(id); expect(saved?.revision).toBe(1); expect(sources.some((source) => JSON.stringify(source) === JSON.stringify(saved?.sources))).toBe(true);
});

async function race(fixture: ReturnType<typeof setup>, inputs: [Start, Start]) {
  const other = await connectMongo({ uri, database });
  const second = new MaterialImportStore(other.db, fixture.name);
  const original = Collection.prototype.findOne;
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(() => ready.reject(new Error("Both initial import reads must arrive.")), 5_000);
  let reads = 0;
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const found = await original.call(this, filter, options);
      if (this.dbName === database && this.collectionName === fixture.records.collectionName && reads < 2) {
        expect(found).toBeNull();
        reads += 1;
        if (reads === 2) ready.resolve();
        await ready.promise;
      }
      return found as T | null;
    },
  );
  try {
    const outcomes = await Promise.allSettled([fixture.store.getOrCreate(inputs[0]), second.getOrCreate(inputs[1])]);
    expect(reads).toBe(2);
    return outcomes;
  } finally {
    clearTimeout(timeout);
    read.mockRestore();
    await other.client.close();
  }
}

async function recoverInNewProcess(name: string, input: Start) {
  const child = Bun.spawn([
    process.execPath, fileURLToPath(new URL("./fixtures/get-import-operation.ts", import.meta.url)), database, name,
  ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  const timeout = setTimeout(() => child.kill(), 10_000);
  try {
    child.stdin.write(JSON.stringify(input));
    await child.stdin.end();
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exitCode, errors }).toEqual({ exitCode: 0, errors: "" });
    return JSON.parse(output) as { found: ImportOperation; retried: ImportOperation };
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
}

describe("MaterialImportStore", () => {
  test("saves a complete CREATED operation and matching retries preserve it", async () => {
    const { store, records } = setup();
    const input = start();
    const saved = await store.getOrCreate(input);
    expect(saved).toEqual({ ...input, kind: "MATERIAL_IMPORT", importKey: expect.any(String), stage: "CREATED", revision: 0 });
    expect(saved.importKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const before = await records.find().toArray();
    expect(before).toEqual([{ _id: expect.anything(), ...saved }]);
    expect(await store.getOrCreate(structuredClone(input))).toEqual(saved);
    const { scope, title, origin, sources } = input.request;
    expect(await store.getOrCreate({ ...input, request: { sources, origin, title, scope } })).toEqual(saved);
    expect(await store.get(identity(input))).toEqual(saved);
    expect(await records.find().toArray()).toEqual(before);
  });

  test("changed requests conflict without altering the key, request, or progress", async () => {
    const { store, records } = setup();
    const input = start();
    const saved = await store.getOrCreate(input);
    const before = await records.find().toArray();
    const file = input.request.sources[0]!;
    const changes: Partial<ImportRequest>[] = [
      { scope: "course-physics" }, { title: "Different lesson" }, { origin: "REFERENCE" },
      { sources: [...input.request.sources].reverse() },
      { sources: [{ ...file, kind: "UPLOAD", name: "lesson.pdf", size: 1024, sha256: "b".repeat(64) }] },
      { sources: [{ kind: "REFERENCE", locator: "https://example.test/other-lesson" }] },
    ];
    for (const change of changes) {
      const result = store.getOrCreate({ ...input, request: { ...input.request, ...change } });
      await expect(result).rejects.toBeInstanceOf(ImportRequestConflict);
      await expect(result).rejects.toMatchObject({ code: "IMPORT_REQUEST_CONFLICT" });
      expect(await records.find().toArray()).toEqual(before);
    }
    expect(await store.get(identity(input))).toEqual(saved);
  });

  test("get uses both owner and request ID; another learner can start a separate operation", async () => {
    const { store, records } = setup();
    const input = start();
    const saved = await store.getOrCreate(input);
    expect(await store.get({ owner: "learner-leo", requestId: input.requestId })).toBeNull();
    expect(await store.get({ owner: input.owner, requestId: "missing" })).toBeNull();
    const otherInput = { ...input, owner: "learner-leo" };
    const other = await store.getOrCreate(otherInput);
    expect(other.importKey).not.toBe(saved.importKey);
    expect(await store.get(identity(input))).toEqual(saved);
    expect(await store.get(identity(otherInput))).toEqual(other);
    expect(await records.countDocuments()).toBe(2);
  });

  test("new request IDs start new imports and identities compare exactly", async () => {
    const { store, records } = setup();
    const input = start();
    const inputs = [input, { ...input, requestId: input.requestId.toUpperCase() },
      { ...input, requestId: ` ${input.requestId} ` }, { ...input, owner: input.owner.toUpperCase() }];
    const saved = await Promise.all(inputs.map((item) => store.getOrCreate(item)));
    expect(new Set(saved.map(({ importKey }) => importKey)).size).toBe(inputs.length);
    expect(await records.countDocuments()).toBe(inputs.length);
    for (let index = 0; index < inputs.length; index++) expect(await store.getOrCreate(inputs[index]!)).toEqual(saved[index]);
  });

  test("empty reads and malformed identities create no collection", async () => {
    const { store, records } = setup();
    expect(await store.get(identity(start()))).toBeNull();
    for (const input of [null, [], {}, { owner: "sam" }, { owner: "sam", requestId: " " },
      { owner: { $ne: "" }, requestId: "x" }, { owner: "sam", requestId: ["x"] }]) {
      await expect(store.get(input as ImportIdentity)).rejects.toBeInstanceOf(InvalidImportRequest);
    }
    expect(await connection!.db.listCollections({ name: records.collectionName }).toArray()).toEqual([]);
  });

  test("invalid request data is refused before saving an operation or key", async () => {
    const { store, records } = setup();
    const input = start();
    const invalid = [null, [], undefined, { ...input, owner: "" }, { ...input, requestId: { $ne: "" } },
      { ...input, importKey: "browser-chosen" }, ...[
        { ...input.request, title: " " }, { ...input.request, scope: "" }, { ...input.request, origin: "UNKNOWN" },
        { ...input.request, sources: [] }, { ...input.request, sources: new Array(1) },
        { ...input.request, sources: [{ kind: "REFERENCE", locator: " " }] },
        { ...input.request, sources: [{ kind: "UPLOAD", name: "lesson.pdf", size: -1, sha256: "a".repeat(64) }] },
        { ...input.request, sources: [{ kind: "UPLOAD", name: "lesson.pdf", size: 1024, sha256: "not-a-digest" }] },
      ].map((request) => ({ ...input, request }))];
    for (const value of invalid) await expect(store.getOrCreate(value as Start)).rejects.toMatchObject({ code: "INVALID_IMPORT_REQUEST" });
    expect(await connection!.db.listCollections({ name: records.collectionName }).toArray()).toEqual([]);
  });

  test("snapshots inputs before waiting and returned objects cannot mutate storage", async () => {
    const { store } = setup();
    const input = start();
    const expected = structuredClone(input);
    const pending = store.getOrCreate(input);
    input.requestId = "changed-during-wait";
    input.request.title = "Changed title";
    (input.request.sources[0] as { name: string }).name = "changed.pdf";
    const saved = await pending;
    expect(saved.request).toEqual(expected.request);
    expect(saved.requestId).toBe(expected.requestId);
    const original = structuredClone(saved);
    saved.request.title = "Changed result";
    saved.importKey = "Changed key";
    expect(await store.get(identity(expected))).toEqual(original);
    expect(await store.getOrCreate(expected)).toEqual(original);
  });

  test("two clients that both see no operation converge on one saved key", async () => {
    const fixture = setup();
    const input = start();
    const outcomes = await race(fixture, [input, structuredClone(input)]);
    const saved = await fixture.store.get(identity(input));
    expect(saved).not.toBeNull();
    expect(outcomes).toEqual([{ status: "fulfilled", value: saved! }, { status: "fulfilled", value: saved! }]);
    expect(await fixture.records.countDocuments()).toBe(1);
  });

  test("concurrent conflicting starts save one complete request and refuse the other", async () => {
    const fixture = setup();
    const first = start();
    const inputs: [Start, Start] = [first, { ...first, request: { ...first.request, title: "A different lesson" } }];
    const outcomes = await race(fixture, inputs);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const losers = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reason).toBeInstanceOf(ImportRequestConflict);
    const winnerIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    expect(winners[0]!.value.request).toEqual(inputs[winnerIndex]!.request);
    expect(await fixture.store.get(identity(first))).toEqual(winners[0]!.value);
    expect(await fixture.records.countDocuments()).toBe(1);
  });

  test("a lost reply after a real save recovers the same operation in a fresh process", async () => {
    const { name, records } = setup();
    const writer = await connectMongo({ uri, database });
    const input = start();
    const lostReply = new Error("Simulated lost import-operation reply.");
    const original = Collection.prototype.insertOne;
    let intercepted = false;
    const insert = spyOn(Collection.prototype, "insertOne").mockImplementation(
      async function(this: Collection, document, options) {
        const result = await original.call(this, document, options);
        if (this.dbName === database && this.collectionName === records.collectionName && !intercepted) {
          intercepted = true;
          throw lostReply;
        }
        return result;
      },
    );
    try {
      await expect(new MaterialImportStore(writer.db, name).getOrCreate(input)).rejects.toBe(lostReply);
      expect(intercepted).toBe(true);
    } finally {
      insert.mockRestore();
      await writer.client.close();
    }
    const before = await records.find().toArray();
    expect(before).toHaveLength(1);
    const { _id: _, ...saved } = before[0]!;
    expect(await recoverInNewProcess(name, input)).toEqual({ found: saved, retried: saved });
    expect(await records.find().toArray()).toEqual(before);
  });

  test("a restarted process reads and retries the operation after its writer closes", async () => {
    const { name, records } = setup();
    const writer = await connectMongo({ uri, database });
    const input = start();
    let saved: ImportOperation;
    try { saved = await new MaterialImportStore(writer.db, name).getOrCreate(input); }
    finally { await writer.client.close(); }
    const before = await records.find().toArray();
    expect(await recoverInNewProcess(name, input)).toEqual({ found: saved, retried: saved });
    expect(await records.find().toArray()).toEqual(before);
  });

  test("a rejected insert returns no key and the same request can succeed later", async () => {
    const { store, records } = setup();
    const input = start();
    await connection!.db.createCollection(records.collectionName, { validator: { requestId: { $ne: input.requestId } } });
    await expect(store.getOrCreate(input)).rejects.toMatchObject({ code: 121 });
    expect(await store.get(identity(input))).toBeNull();
    expect(await records.countDocuments()).toBe(0);
    await connection!.db.command({ collMod: records.collectionName, validator: {} });
    const saved = await store.getOrCreate(input);
    expect(await store.getOrCreate(input)).toEqual(saved);
    expect(await records.countDocuments()).toBe(1);
  });

  test("unrelated database constraints remain errors and cannot recover another operation", async () => {
    const { store, records } = setup();
    await records.createIndex({ testConstraint: 1 }, { unique: true });
    const input = start();
    const saved = await store.getOrCreate(input);
    await expect(store.getOrCreate({ ...input, requestId: "another-request" })).rejects.toMatchObject({
      code: 11000, keyPattern: { testConstraint: 1 },
    });
    expect(await records.countDocuments()).toBe(1);
    expect(await store.get(identity(input))).toEqual(saved);
  });

  test("database read failures remain errors rather than reporting a missing operation", async () => {
    const { name } = setup();
    const reader = await connectMongo({ uri, database });
    const store = new MaterialImportStore(reader.db, name);
    await reader.client.close();
    await expect(store.get(identity(start()))).rejects.toBeInstanceOf(MongoError);
    await expect(store.getOrCreate(start())).rejects.toBeInstanceOf(MongoError);
  });
});
