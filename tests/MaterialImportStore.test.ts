import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Collection, type Document, type Filter, MongoError } from "mongodb";
import {
  ImportAlreadySaved, ImportNotRetryable, ImportProgressConflict, ImportRequestConflict, InvalidImportRequest, MaterialImportStore,
  type ImportFailure, type ImportIdentity, type ImportOperation, type ImportRequest,
} from "../src/storage/MaterialImportStore.ts";
import type { MediaValue } from "../src/media.ts";
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
/** What a separate process reads back: dates arrive as text. */
const json = <T>(value: T): T => JSON.parse(JSON.stringify(value));

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
  expect((await recoverInNewProcess(name, input)).retried).toEqual(json(complete));
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
    expect(saved).toEqual({ ...input, kind: "MATERIAL_IMPORT", importKey: expect.any(String), createdAt: expect.any(Date), stage: "CREATED", revision: 0 });
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
    expect(await recoverInNewProcess(name, input)).toEqual(json({ found: saved, retried: saved }));
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
    expect(await recoverInNewProcess(name, input)).toEqual(json({ found: saved, retried: saved }));
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

// ---------------------------------------------------------------------------------------------
// Transcription progress

const MINUTE = 60_000;
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 23, 12, 0) + minutes * MINUTE);
const busy: ImportFailure = { reason: "BUSY", sentence: "The AI service is busy. Try again in a few minutes.", retryable: true };
const unreadable: ImportFailure = { reason: "UNREADABLE", sentence: "The AI service could not read this recording.", retryable: false };
const segments = [{ start: 0, end: 21, text: "Today we find eigenvalues." }, { start: 21, end: 50, text: "First solve det(A − λI) = 0." }];

function transcriptionFixture() {
  let now = at(0);
  const name = `MaterialImport_${randomUUID()}`;
  const store = new MaterialImportStore(connection!.db, name, () => now);
  return { name, store, setNow: (time: Date) => { now = time; } };
}

/** Saves an import with one document and `count` recordings through SOURCES_SAVED to TRANSCRIBING. */
async function transcribing(store: MaterialImportStore, owner: string, requestId: string, { count = 2, course = "course-linear-algebra" } = {}) {
  const key = randomUUID(), file = (n: number, ext: string): MediaValue => ({ file: `${key}/${String(n).repeat(64)}.${ext}`, name: `file-${n}.${ext}`,
    mediaType: ext === "md" ? "text/markdown" : "audio/wav", renditions: [], limitations: [] });
  const files = [file(0, "md"), ...Array.from({ length: count }, (_, i) => file(i + 1, "wav"))];
  const request: ImportRequest = { scope: course, title: `Lecture ${requestId}`, origin: "COURSE",
    sources: files.map((item, i) => ({ kind: "UPLOAD", name: item.name, size: 10, sha256: String(i).repeat(64) })) };
  await store.getOrCreate({ owner, requestId, request });
  await store.saveSources({ owner, requestId, revision: 0, sources: files });
  const partial = [{ ...files[0]!, renditions: [{ kind: "TEXT" as const, location: "k/lines/1-1", text: "Notes" }] }, ...files.slice(1)];
  const operation = await store.startTranscription({ owner, requestId, revision: 1, partial, recordings: files.slice(1).map((item) => item.file) });
  return { operation, files, partial, recordings: files.slice(1).map((item) => item.file) };
}

describe("Transcription progress", () => {
  test("startTranscription saves the documents as read and one waiting entry per recording", async () => {
    const { store } = transcriptionFixture();
    const { operation, partial, recordings } = await transcribing(store, "sam", "r1");
    expect(operation).toMatchObject({ stage: "TRANSCRIBING", revision: 2, partial,
      recordings: recordings.map((file) => ({ file, status: "WAITING", attempts: 0 })) });
    expect(operation.createdAt).toEqual(at(0));
    // An exact replay returns current progress; a stale or changed one conflicts.
    expect(await store.startTranscription({ owner: "sam", requestId: "r1", revision: 1, partial, recordings })).toEqual(operation);
    await expect(store.startTranscription({ owner: "sam", requestId: "r1", revision: 1, partial, recordings: recordings.slice(0, 1) })).rejects.toBeInstanceOf(ImportProgressConflict);
  });

  test("startTranscription refuses partial lists that do not match the saved sources", async () => {
    const { store } = transcriptionFixture();
    const key = randomUUID(), file = (n: number): MediaValue => ({ file: `${key}/${String(n).repeat(64)}.wav`, name: `f${n}.wav`, mediaType: "audio/wav", renditions: [], limitations: [] });
    const request: ImportRequest = { scope: "c", title: "T", origin: "COURSE", sources: [1, 2].map((n) => ({ kind: "UPLOAD", name: `f${n}.wav`, size: 1, sha256: String(n).repeat(64) })) };
    await store.getOrCreate({ owner: "sam", requestId: "r", request });
    await store.saveSources({ owner: "sam", requestId: "r", revision: 0, sources: [file(1), file(2)] });
    const conflict = ImportProgressConflict;
    await expect(store.startTranscription({ owner: "sam", requestId: "r", revision: 1, partial: [file(2), file(1)], recordings: [file(1).file] })).rejects.toBeInstanceOf(conflict);
    await expect(store.startTranscription({ owner: "sam", requestId: "r", revision: 1, partial: [file(1), file(2)], recordings: ["missing"] })).rejects.toBeInstanceOf(conflict);
    const transcribed = { ...file(1), renditions: [{ kind: "TEXT" as const, location: "k/time/00:00-00:10", text: "Hi" }] };
    await expect(store.startTranscription({ owner: "sam", requestId: "r", revision: 1, partial: [transcribed, file(2)], recordings: [file(1).file] })).rejects.toBeInstanceOf(conflict);
    await expect(store.startTranscription({ owner: "sam", requestId: "r", revision: 1, partial: [file(1), file(2)], recordings: [] })).rejects.toBeInstanceOf(InvalidImportRequest);
    await expect(store.startTranscription({ owner: "sam", requestId: "r", revision: 0, partial: [file(1), file(2)], recordings: [file(1).file] })).rejects.toBeInstanceOf(conflict);
    expect((await store.get({ owner: "sam", requestId: "r" }))?.stage).toBe("SOURCES_SAVED");
  });

  test("two workers never claim the same recording, and a claim leaves the revision unchanged", async () => {
    const { store, name } = transcriptionFixture();
    const { operation, recordings } = await transcribing(store, "sam", "r1");
    const second = new MaterialImportStore(connection!.db, name);
    const claims = await Promise.all([store.claim({ now: at(0), token: "a", until: at(5) }), second.claim({ now: at(0), token: "b", until: at(5) })]);
    expect(claims.map((claim) => claim?.file).sort()).toEqual([...recordings].sort());
    expect(await store.claim({ now: at(1), token: "c", until: at(6) })).toBeNull();
    const saved = await store.get({ owner: "sam", requestId: "r1" });
    expect(saved?.revision).toBe(operation.revision);
    expect(saved?.recordings?.map((item) => item.claim?.token).sort()).toEqual(["a", "b"]);
  });

  test("claims alternate between learners, wrapping around, and take each learner's oldest import first", async () => {
    const { store, setNow } = transcriptionFixture();
    await transcribing(store, "learner-b", "b-old", { count: 2 });
    setNow(at(1));
    await transcribing(store, "learner-a", "a-only", { count: 2 });
    setNow(at(2));
    await transcribing(store, "learner-b", "b-new", { count: 1 });
    const order: string[] = [];
    let previous: string | undefined;
    for (let i = 0; i < 5; i++) {
      const claim = await store.claim({ now: at(3), token: `t${i}`, until: at(8), previous });
      expect(claim).not.toBeNull();
      order.push(`${claim!.owner}:${claim!.requestId}`);
      previous = claim!.owner;
    }
    expect(order).toEqual(["learner-a:a-only", "learner-b:b-old", "learner-a:a-only", "learner-b:b-old", "learner-b:b-new"]);
    expect(await store.claim({ now: at(3), token: "t5", until: at(8), previous })).toBeNull();
  });

  test("a claim that ended while its worker was stopped can be claimed again, and the old worker can no longer renew or save", async () => {
    const { store } = transcriptionFixture();
    await transcribing(store, "sam", "r1", { count: 1 });
    const first = await store.claim({ now: at(0), token: "old", until: at(5) });
    expect(await store.renew({ ...first!, token: "old", until: at(6) })).toBe(true);
    expect(await store.claim({ now: at(5), token: "new", until: at(10) })).toBeNull();
    const second = await store.claim({ now: at(7), token: "new", until: at(12) });
    expect(second).toEqual(first);
    expect(await store.renew({ ...first!, token: "old", until: at(13) })).toBe(false);
    await expect(store.saveTranscript({ ...first!, token: "old", segments })).rejects.toBeInstanceOf(ImportProgressConflict);
    const done = await store.saveTranscript({ ...second!, token: "new", segments });
    expect(done.recordings![0]).toEqual({ file: first!.file, status: "DONE", attempts: 0, segments });
  });

  test("transcript saves replay, check their segments, and require the claim", async () => {
    const { store } = transcriptionFixture();
    await transcribing(store, "sam", "r1", { count: 1 });
    const claim = (await store.claim({ now: at(0), token: "w", until: at(5) }))!;
    for (const bad of [[], [{ start: 0, end: 0, text: "x" }], [{ start: 0, end: 10, text: " " }], [{ start: 5, end: 10, text: "a" }, { start: 4, end: 12, text: "b" }],
      [{ start: 0.5, end: 10, text: "a" }], [{ start: 0, end: 10, text: "a", extra: 1 }]]) {
      await expect(store.saveTranscript({ ...claim, token: "w", segments: bad as typeof segments })).rejects.toBeInstanceOf(InvalidImportRequest);
    }
    await expect(store.saveTranscript({ ...claim, token: "other", segments })).rejects.toBeInstanceOf(ImportProgressConflict);
    const saved = await store.saveTranscript({ ...claim, token: "w", segments });
    expect(await store.saveTranscript({ ...claim, token: "w", segments })).toEqual(saved);
    await expect(store.saveTranscript({ ...claim, token: "w", segments: segments.slice(0, 1) })).rejects.toBeInstanceOf(ImportProgressConflict);
  });

  test("automatic retries wait, count attempts, and are not claimed early; a final failure stops the import's claims", async () => {
    const { store } = transcriptionFixture();
    const { recordings } = await transcribing(store, "sam", "r1", { count: 2 });
    const first = (await store.claim({ now: at(0), token: "w1", until: at(5) }))!;
    const waiting = await store.failTranscript({ ...first, token: "w1", failure: busy, retryAt: at(1) });
    expect(waiting.recordings!.find((item) => item.file === first.file)).toEqual({ file: first.file, status: "WAITING", attempts: 1, retryAt: at(1) });
    const second = (await store.claim({ now: at(0), token: "w2", until: at(5) }))!;
    expect(second.file).not.toBe(first.file);
    expect(await store.claim({ now: at(0.5), token: "w3", until: at(5) })).toBeNull();
    expect((await store.claim({ now: at(1), token: "w3", until: at(6) }))?.file).toBe(first.file);
    // The other recording cannot be retried, so the waiting one is no longer claimed.
    const failed = await store.failTranscript({ ...second, token: "w2", failure: unreadable });
    expect(failed.recordings!.find((item) => item.file === second.file)).toEqual({ file: second.file, status: "FAILED", attempts: 0, failure: unreadable });
    await store.failTranscript({ ...first, token: "w3", failure: busy, retryAt: at(2) });
    expect(await store.claim({ now: at(10), token: "w4", until: at(15) })).toBeNull();
    expect(recordings).toContain(first.file);
  });

  test("the learner's retry resets retryable failures and is refused for a failure that cannot be retried, even while another recording waits", async () => {
    const { store } = transcriptionFixture();
    await transcribing(store, "sam", "r1", { count: 2 });
    const first = (await store.claim({ now: at(0), token: "w1", until: at(5) }))!;
    await store.failTranscript({ ...first, token: "w1", failure: { ...busy, reason: "TIMEOUT" } });
    const failed = (await store.get({ owner: "sam", requestId: "r1" }))!;
    const retried = (await store.retry({ owner: "sam", requestId: "r1" }))!;
    expect(retried.revision).toBe(failed.revision + 1);
    expect(retried.recordings!.find((item) => item.file === first.file)).toEqual({ file: first.file, status: "WAITING", attempts: 0 });
    // No failure: unchanged.
    expect(await store.retry({ owner: "sam", requestId: "r1" })).toEqual(retried);
    const again = (await store.claim({ now: at(1), token: "w2", until: at(6) }))!;
    await store.failTranscript({ ...again, token: "w2", failure: unreadable });
    await expect(store.retry({ owner: "sam", requestId: "r1" })).rejects.toBeInstanceOf(ImportNotRetryable);
    expect(await store.retry({ owner: "sam", requestId: "missing" })).toBeNull();
  });

  test("imports whose recordings are all done are preparable after a stop, oldest first, until a preparation failure or READY", async () => {
    const { store, name, setNow } = transcriptionFixture();
    for (const [minute, requestId] of [[0, "older"], [1, "newer"]] as const) {
      setNow(at(minute));
      await transcribing(store, "sam", requestId, { count: 1 });
      const claim = (await store.claim({ now: at(minute), token: requestId, until: at(minute + 5) }))!;
      await store.saveTranscript({ ...claim, token: requestId, segments });
    }
    // A new store instance stands in for a restarted process.
    const restarted = new MaterialImportStore(connection!.db, name);
    const ready = await restarted.preparable();
    expect(ready.map((item) => item.requestId)).toEqual(["older", "newer"]);
    const limit: ImportFailure = { reason: "TEXT_LIMIT", sentence: "This material contains too much text. Remove this import and import a smaller unit.", retryable: false };
    const failed = await restarted.failPreparation({ owner: "sam", requestId: "older", revision: ready[0]!.revision, failure: limit });
    expect(failed.failure).toEqual(limit);
    await expect(restarted.retry({ owner: "sam", requestId: "older" })).rejects.toBeInstanceOf(ImportNotRetryable);
    const newer = ready[1]!;
    const prepared = { owner: "sam", importKey: newer.importKey, scope: newer.request.scope, title: newer.request.title, locator: `upload:${newer.importKey}`,
      content: "[k/lines/1-1]\nNotes", originals: newer.partial!, origin: "COURSE" as const };
    expect((await restarted.savePrepared({ owner: "sam", requestId: "newer", revision: newer.revision, prepared })).stage).toBe("READY");
    expect(await restarted.preparable()).toEqual([]);
    // A waiting import cannot be prepared.
    await transcribing(store, "sam", "waiting", { count: 1 });
    const waiting = (await store.get({ owner: "sam", requestId: "waiting" }))!;
    await expect(store.savePrepared({ owner: "sam", requestId: "waiting", revision: waiting.revision, prepared: { ...prepared, importKey: waiting.importKey, title: waiting.request.title } }))
      .rejects.toBeInstanceOf(ImportProgressConflict);
  });

  test("removing an import during a claim drops the worker's save, and its files are listed for deletion until recorded", async () => {
    const { store, name } = transcriptionFixture();
    await transcribing(store, "sam", "r1", { count: 1 });
    const claim = (await store.claim({ now: at(0), token: "w", until: at(5) }))!;
    const discarded = (await store.discard({ owner: "sam", requestId: "r1" }))!;
    expect(discarded).toMatchObject({ stage: "DISCARDED", filesDeleted: false });
    expect(discarded.recordings![0]!.claim).toBeUndefined();
    await expect(store.saveTranscript({ ...claim, token: "w", segments })).rejects.toBeInstanceOf(ImportProgressConflict);
    expect(await store.renew({ ...claim, token: "w", until: at(6) })).toBe(false);
    expect(await store.discard({ owner: "sam", requestId: "r1" })).toEqual(discarded);
    const restarted = new MaterialImportStore(connection!.db, name);
    expect((await restarted.deletable()).map((item) => item.requestId)).toEqual(["r1"]);
    const deleted = await restarted.markFilesDeleted({ owner: "sam", requestId: "r1" });
    expect(deleted.filesDeleted).toBe(true);
    expect(await restarted.markFilesDeleted({ owner: "sam", requestId: "r1" })).toEqual(deleted);
    expect(await restarted.deletable()).toEqual([]);
    expect(await store.discard({ owner: "sam", requestId: "missing" })).toBeNull();
  });

  test("a READY import is discarded only with the host's invalid-input report; COMPLETE imports are never discarded", async () => {
    const { store } = transcriptionFixture();
    const input = start(), id = identity(input), created = await store.getOrCreate(input);
    const source = [{ file: `${created.importKey}/${"a".repeat(64)}.pdf`, name: "lesson.pdf", mediaType: "application/pdf", renditions: [], limitations: [] }];
    const saved = await store.saveSources({ ...id, revision: 0, sources: source });
    const prepared = { owner: input.owner, importKey: created.importKey, scope: input.request.scope, title: input.request.title,
      locator: `upload:${created.importKey}`, content: "Matrix multiplication", originals: source, origin: input.request.origin };
    const ready = await store.savePrepared({ ...id, revision: saved.revision, prepared });
    await expect(store.discard(id)).rejects.toBeInstanceOf(ImportAlreadySaved);
    await expect(store.markFilesDeleted(id)).rejects.toBeInstanceOf(ImportProgressConflict);
    expect(await store.discard({ ...id, invalidInput: true })).toMatchObject({ stage: "DISCARDED", filesDeleted: false, revision: ready.revision + 1 });
    const other = { ...input, requestId: "complete" }, made = await store.getOrCreate(other);
    const otherSaved = await store.saveSources({ ...identity(other), revision: 0, sources: source });
    const otherReady = await store.savePrepared({ ...identity(other), revision: otherSaved.revision, prepared: { ...prepared, importKey: made.importKey, locator: `upload:${made.importKey}` } });
    await store.complete({ ...identity(other), revision: otherReady.revision, material: "m1" });
    await expect(store.discard({ ...identity(other), invalidInput: true })).rejects.toBeInstanceOf(ImportAlreadySaved);
  });

  test("the pending list holds one learner's TRANSCRIBING and READY imports in one course, oldest first, and reads create nothing", async () => {
    const { store, setNow } = transcriptionFixture();
    const freshName = `MaterialImport_${randomUUID()}`, fresh = new MaterialImportStore(connection!.db, freshName);
    expect(await fresh.pending({ owner: "sam", course: "c" })).toEqual([]);
    expect(await fresh.preparable()).toEqual([]);
    expect(await fresh.deletable()).toEqual([]);
    expect(await connection!.db.listCollections({ name: `${freshName.toLowerCase()}.operations` }).toArray()).toEqual([]);
    await expect(store.pending({ owner: " ", course: "c" })).rejects.toBeInstanceOf(InvalidImportRequest);
    setNow(at(2)); await transcribing(store, "sam", "b-later");
    setNow(at(1)); await transcribing(store, "sam", "z-earlier");
    setNow(at(2)); await transcribing(store, "sam", "a-later");
    await transcribing(store, "leo", "leo");
    await transcribing(store, "sam", "other-course", { course: "course-physics" });
    await transcribing(store, "sam", "removed");
    await store.discard({ owner: "sam", requestId: "removed" });
    expect((await store.pending({ owner: "sam", course: "course-linear-algebra" })).map((item) => item.requestId)).toEqual(["z-earlier", "a-later", "b-later"]);
  });
});
