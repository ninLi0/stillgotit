import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { DiskStore, type FileStore, type StoreCall } from "../src/host/file-store.ts";
import { Gemini } from "../src/host/gemini.ts";
import { MaterialFiles, RECORDINGS_NEED_TUTOR, TOO_LARGE_UPLOAD, TOO_MANY_FILES } from "../src/host/material-files.ts";
import { IMPORT_ALREADY_SAVED, IMPORT_NOT_RETRYABLE, IMPORT_REMOVED, IMPORT_REQUEST_CONFLICT, IMPORT_UNAVAILABLE, SAVE_INVALID, SAVE_STUCK } from "../src/host/material-routes.ts";
import { createRuntime } from "../src/host/runtime.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { UPLOAD_BUSY, UPLOAD_TIMEOUT } from "../src/host/upload-queue.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { answer, fakeGemini } from "./fixtures/fake-gemini.ts";
import { heif, scannedPdf, wav } from "./fixtures/media.ts";

const ORIGIN = "http://localhost:5173", MB = 1024 * 1024;
let directory: string;
const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), "stillgotit-import-http-")); });
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

/** A disk store whose writes can be held open, standing in for a slow file store. */
class GatedStore implements FileStore {
  gate: Promise<void> | null = null;
  constructor(private readonly inner: FileStore) {}
  async put(key: string, data: Uint8Array | Blob, options?: StoreCall) {
    if (this.gate) await this.gate;
    return this.inner.put(key, data, options);
  }
  get(key: string, options?: StoreCall) { return this.inner.get(key, options); }
  size(key: string, options?: StoreCall) { return this.inner.size(key, options); }
  stream(key: string) { return this.inner.stream(key); }
  exists(key: string, options?: StoreCall) { return this.inner.exists(key, options); }
  delete(key: string, options?: StoreCall) { return this.inner.delete(key, options); }
}

async function setup({ key = "test-key-not-real", limits, transcript = '{"segments":[{"start":0,"end":2,"text":"Today we find eigenvalues."}]}' }: {
  key?: string; limits?: Parameters<typeof createRuntime>[0]["limits"]; transcript?: string;
} = {}) {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), google = fakeGemini({ generate: () => answer(transcript) });
  const gemini = new Gemini({ key, fetch: google.fetch, pollMs: 1 });
  const storeDirectory = resolve(directory, randomUUID()), store = new GatedStore(new DiskStore(storeDirectory));
  const files = new MaterialFiles(store);
  let suggestGate: Promise<void> | null = null;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => { if (suggestGate) await suggestGate; return { unitTitle: "Eigenvalues", skills: [{ title: "Find eigenvalues", outcome: "Find them.", gate: "Solve two problems." }] }; },
    generate: async () => ({}),
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, gemini, files, limits, tutor });
  cleanups.push(async () => { await runtime.worker.stop(); await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });

  function browser() {
    const jar = new Map<string, string>();
    const cookies = () => [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    async function send(path: string, body: Record<string, unknown> | FormData | ReadableStream = {}, headers: Record<string, string> = {}) {
      const json = !(body instanceof FormData) && !(body instanceof ReadableStream);
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookies(),
        ...(json ? { "Content-Type": "application/json" } : {}), ...headers }, body: json ? JSON.stringify(body) : body, ...(body instanceof ReadableStream ? { duplex: "half" } : {}) } as RequestInit));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      return response;
    }
    async function post(path: string, body: Record<string, unknown> | FormData | ReadableStream = {}, headers: Record<string, string> = {}) {
      const response = await send(path, body, headers);
      return { status: response.status, body: await response.json() as Record<string, any> };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    async function signIn(name: string) {
      const start = await ok("/auth/commons/start");
      await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
      const identity = await ok("/auth/commons/resume");
      const { course } = await ok("/courses/create", { title: "Linear algebra" });
      return { user: identity.user as string, course: course as string };
    }
    return { send, post, ok, signIn, signOut: () => jar.clear() };
  }
  return { runtime, google, store, storeDirectory, files, connection, browser, holdSuggestions: (gate: Promise<void> | null) => { suggestGate = gate; } };
}

const notes = (text = "Eigenvalues solve det(A − λI) = 0.", name = "notes.md") => new File([text], name, { type: "text/markdown" });
function form(course: string, files: File[], { requestId = randomUUID(), title = "Eigenvalues" } = {}) {
  const body = new FormData();
  body.set("course", course); body.set("title", title); body.set("requestId", requestId);
  for (const file of files) body.append("files", file);
  return body;
}
const operations = (app: Awaited<ReturnType<typeof setup>>) => app.connection.db.collection("materialimport.operations");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("Uploading", () => {
  test("an import without recordings answers its material, and a repeated request answers the same material", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const requestId = randomUUID();
    const first = await learner.ok("/courses/materials/add", form(course, [notes()], { requestId }));
    expect(first).toEqual({ material: expect.any(String) });
    expect(await learner.ok("/courses/materials/add", form(course, [notes()], { requestId }))).toEqual(first);
    expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
  });

  test("scanned PDFs and HEIC photos become materials with page and image locations", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const { material } = await learner.ok("/courses/materials/add", form(course, [new File([scannedPdf([null, null])], "scan.pdf"), new File([heif()], "board.heic")]));
    const read = await learner.ok("/courses/materials/read", { material });
    expect(read.content).toBe("");
    expect(read.originals.map((file: { mediaType: string; renditions: { kind: string }[]; limitations: string[] }) => [file.mediaType, file.renditions.map((part) => part.kind), file.limitations])).toEqual([
      ["application/pdf", ["PAGE", "PAGE"], ["This PDF has no selectable text. The tutor reads its pages as images."]],
      ["image/heic", ["IMAGE"], []],
    ]);
  });

  test("an import with a recording answers TRANSCRIBING, is listed, and becomes a material after the worker and the next listing", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const requestId = randomUUID();
    const started = await learner.ok("/courses/materials/add", form(course, [notes(), new File([wav(2)], "lecture.wav")], { requestId, title: "Lecture 1" }));
    expect(started).toEqual({ requestId, state: "TRANSCRIBING" });
    expect(await learner.ok("/courses/materials/add", form(course, [notes(), new File([wav(2)], "lecture.wav")], { requestId, title: "Lecture 1" }))).toEqual(started);
    expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ saved: [], imports: [{ requestId, title: "Lecture 1", state: "TRANSCRIBING",
      files: [{ name: "notes.md", state: "DONE" }, { name: "lecture.wav", state: "WAITING" }], canRetry: false, canRemove: true }] });
    await app.runtime.worker.turn();
    await app.runtime.worker.turn();
    const listed = await learner.ok("/courses/materials/imports", { course });
    expect(listed).toEqual({ imports: [], saved: [expect.any(String)] });
    expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
    const read = await learner.ok("/courses/materials/read", { material: listed.saved[0] });
    expect(read.originals[1]).toMatchObject({ name: "lecture.wav", mediaType: "audio/wav",
      renditions: [{ kind: "TEXT", location: expect.stringMatching(/^[0-9a-f]{16}\/time\/00:00-00:02$/), text: "Today we find eigenvalues." }] });
    expect(read.content).toContain("Today we find eigenvalues.");
    // A repeated upload of a finished import answers its material.
    expect(await learner.ok("/courses/materials/add", form(course, [notes(), new File([wav(2)], "lecture.wav")], { requestId, title: "Lecture 1" }))).toEqual({ material: listed.saved[0] });
  });

  test("two identical recordings and a distinct one import cleanly, and each distinct file is transcribed once", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const requestId = randomUUID(), lecture = wav(2), review = wav(3);
    const upload = () => form(course, [new File([lecture], "lecture.wav"), new File([lecture], "lecture copy.wav"), new File([review], "review.wav")],
      { requestId, title: "Lecture 2" });
    expect(await learner.ok("/courses/materials/add", upload())).toEqual({ requestId, state: "TRANSCRIBING" });
    expect(await learner.ok("/courses/materials/add", upload())).toEqual({ requestId, state: "TRANSCRIBING" });
    // Identical files share one retained reference, and that reference has one recording entry.
    const saved = await operations(app).findOne({ requestId });
    const [first, copy, distinct] = (saved!.partial as { file: string }[]).map((file) => file.file);
    expect(copy).toBe(first!);
    expect(distinct).not.toBe(first!);
    expect((saved!.recordings as { file: string; status: string }[]).map((item) => [item.file, item.status])).toEqual([[first, "WAITING"], [distinct, "WAITING"]]);
    expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ saved: [], imports: [{ requestId, title: "Lecture 2", state: "TRANSCRIBING",
      files: [{ name: "lecture.wav", state: "WAITING" }, { name: "lecture copy.wav", state: "WAITING" }, { name: "review.wav", state: "WAITING" }],
      canRetry: false, canRemove: true }] });

    for (let turns = 0; turns < 10 && await app.runtime.worker.turn(); turns++) { /* until nothing is left to do */ }
    const sent = app.google.generations().map((call) => call.body!.contents[0].parts[0].inlineData.data as string);
    expect(sent).toEqual([Buffer.from(lecture).toString("base64"), Buffer.from(review).toString("base64")]);

    const listed = await learner.ok("/courses/materials/imports", { course });
    expect(listed).toEqual({ imports: [], saved: [expect.any(String)] });
    const read = await learner.ok("/courses/materials/read", { material: listed.saved[0] });
    type Original = { file: string; name: string; renditions: { kind: string; location: string; text: string }[]; limitations: string[] };
    const originals = read.originals as Original[];
    expect(originals.map((file) => file.name)).toEqual(["lecture.wav", "lecture copy.wav", "review.wav"]);
    expect(originals[1]!.file).toBe(originals[0]!.file);
    // The one transcript serves both originals that share the file.
    expect(originals[1]!.renditions).toEqual(originals[0]!.renditions);
    expect(originals[1]!.limitations).toEqual(originals[0]!.limitations);
    for (const file of originals) {
      expect(file.renditions).toEqual([{ kind: "TEXT", location: expect.stringMatching(/^[0-9a-f]{16}\/time\/00:00-00:02$/), text: "Today we find eigenvalues." }]);
      expect(file.limitations).toHaveLength(1);
    }
    expect(originals[2]!.renditions[0]!.location).not.toBe(originals[0]!.renditions[0]!.location);
  });

  test("refusals before saving answer their sentence and save nothing", async () => {
    const app = await setup({ key: "" }), learner = app.browser(), { course } = await learner.signIn("maya");
    const refused = async (files: File[], sentence: string) => {
      expect(await learner.post("/courses/materials/add", form(course, files))).toEqual({ status: 400, body: { error: "OPERATION_FAILED", detail: sentence } });
    };
    await refused(Array.from({ length: 13 }, (_, i) => notes(`Note ${i}`, `n${i}.md`)), TOO_MANY_FILES);
    await refused([notes(), new File([wav(2)], "lecture.wav")], RECORDINGS_NEED_TUTOR);
    await refused([new File(["PK"], "lesson.zip")], "ZIP and other archive files can't be imported. Unzip them and choose the files inside.");
    expect(await operations(app).countDocuments()).toBe(0);
    await expect(readdir(app.storeDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  test("a recording longer than two hours is refused before saving", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    expect(await learner.post("/courses/materials/add", form(course, [new File([wav(7201, { rate: 1, bits: 8 })], "long.wav")]))).toEqual({ status: 400,
      body: { error: "OPERATION_FAILED", detail: "Recordings and videos can be at most 2 hours long. Split the recording and import each part." } });
    expect(await operations(app).countDocuments()).toBe(0);
  });

  test("a removed import and a changed request answer their own codes", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const requestId = randomUUID(), files = [notes(), new File([wav(2)], "lecture.wav")];
    await learner.ok("/courses/materials/add", form(course, files, { requestId }));
    expect(await learner.post("/courses/materials/add", form(course, [notes("Different")], { requestId }))).toEqual({ status: 409,
      body: { error: "IMPORT_REQUEST_CONFLICT", detail: IMPORT_REQUEST_CONFLICT } });
    expect(await learner.post("/courses/materials/add", form(course, files, { requestId, title: "Another title" }))).toMatchObject({ status: 409, body: { error: "IMPORT_REQUEST_CONFLICT" } });
    expect(await learner.ok("/courses/materials/imports/remove", { requestId })).toEqual({});
    expect(await learner.post("/courses/materials/add", form(course, files, { requestId }))).toEqual({ status: 409, body: { error: "IMPORT_REMOVED", detail: IMPORT_REMOVED } });
  });

  test("a third upload is busy at once, a waiting upload is busy after its wait, and the first upload continues", async () => {
    const app = await setup({ limits: { queueWaitMs: 200 } }), learner = app.browser(), { course } = await learner.signIn("maya");
    const gate = Promise.withResolvers<void>();
    app.store.gate = gate.promise;
    const first = learner.post("/courses/materials/add", form(course, [notes()]));
    await Bun.sleep(50);
    const second = learner.post("/courses/materials/add", form(course, [notes("Second")]));
    await Bun.sleep(20);
    expect(await learner.post("/courses/materials/add", form(course, [notes("Third")]))).toEqual({ status: 429, body: { error: "UPLOAD_BUSY", detail: UPLOAD_BUSY } });
    const started = performance.now();
    expect(await second).toEqual({ status: 429, body: { error: "UPLOAD_BUSY", detail: UPLOAD_BUSY } });
    expect(performance.now() - started).toBeGreaterThan(100);
    app.store.gate = null;
    gate.resolve();
    expect(await first).toMatchObject({ status: 200, body: { material: expect.any(String) } });
    // The queue is free again.
    expect(await learner.post("/courses/materials/add", form(course, [notes("Fourth")]))).toMatchObject({ status: 200 });
  });

  test("an upload that runs out of time answers UPLOAD_TIMEOUT, and a retry continues from saved progress", async () => {
    const app = await setup({ limits: { uploadBudgetMs: 1500 } }), learner = app.browser(), { course } = await learner.signIn("maya");
    const gate = Promise.withResolvers<void>(), requestId = randomUUID();
    app.store.gate = gate.promise;
    expect(await learner.post("/courses/materials/add", form(course, [notes()], { requestId }))).toEqual({ status: 400, body: { error: "UPLOAD_TIMEOUT", detail: UPLOAD_TIMEOUT } });
    expect((await operations(app).findOne({ requestId }))?.stage).toBe("CREATED");
    app.store.gate = null;
    gate.resolve();
    await Bun.sleep(50);
    expect(await learner.ok("/courses/materials/add", form(course, [notes()], { requestId }))).toEqual({ material: expect.any(String) });
  });

  test("an upload whose learner is busy answers SAVING, and the next listing saves the material once", async () => {
    const app = await setup({ limits: { uploadBudgetMs: 1500 } }), learner = app.browser(), { course } = await learner.signIn("maya");
    const { material: first } = await learner.ok("/courses/materials/add", form(course, [notes()]));
    const gate = Promise.withResolvers<void>();
    app.holdSuggestions(gate.promise);
    const suggestion = learner.post("/courses/skills/suggest", { material: first });
    await Bun.sleep(50);
    const requestId = randomUUID();
    expect(await learner.post("/courses/materials/add", form(course, [notes("Second notes")], { requestId, title: "Second" }))).toEqual({ status: 200, body: { requestId, state: "SAVING" } });
    gate.resolve();
    expect((await suggestion).status).toBe(200);
    const listed = await learner.ok("/courses/materials/imports", { course });
    expect(listed).toEqual({ imports: [], saved: [expect.any(String)] });
    const { materials } = await learner.ok("/courses/read", { course });
    expect(materials.map((item: { title: string }) => item.title).sort()).toEqual(["Eigenvalues", "Second"]);
  });

  test("a stop between the material save and COMPLETE is recovered by the next listing with the same material", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const complete = spyOn(app.runtime.imports, "complete").mockImplementationOnce(async () => { throw new Error("Process stopped"); });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const requestId = randomUUID();
      expect(await learner.ok("/courses/materials/add", form(course, [notes()], { requestId }))).toEqual({ requestId, state: "SAVING" });
      const { materials: before } = await learner.ok("/courses/read", { course });
      expect(before).toHaveLength(1);
      expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [before[0].material] });
      expect((await learner.ok("/courses/read", { course })).materials).toHaveLength(1);
      expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
    } finally { complete.mockRestore(); warn.mockRestore(); }
  });

  test("the upload, listing, retry, and remove routes need a session and the learner's own course", async () => {
    const app = await setup(), learner = app.browser(), other = app.browser(), { course } = await learner.signIn("maya");
    await other.signIn("leo");
    const anonymous = app.browser();
    expect((await anonymous.post("/courses/materials/add", form(course, [notes()]))).status).toBe(401);
    for (const path of ["/courses/materials/imports", "/courses/materials/imports/retry", "/courses/materials/imports/remove"]) {
      expect((await anonymous.post(path, { course, requestId: "x" })).status).toBe(401);
    }
    expect(await other.post("/courses/materials/add", form(course, [notes()]))).toMatchObject({ status: 403, body: { error: "FORBIDDEN" } });
    expect(await other.post("/courses/materials/imports", { course })).toMatchObject({ status: 403 });
    const requestId = randomUUID();
    await learner.ok("/courses/materials/add", form(course, [notes(), new File([wav(2)], "lecture.wav")], { requestId }));
    // Another learner's request ID never reaches this learner's import.
    expect(await other.post("/courses/materials/imports/retry", { requestId })).toEqual({ status: 404, body: { error: "IMPORT_UNAVAILABLE", detail: IMPORT_UNAVAILABLE } });
    expect(await other.post("/courses/materials/imports/remove", { requestId })).toEqual({ status: 404, body: { error: "IMPORT_UNAVAILABLE", detail: IMPORT_UNAVAILABLE } });
    expect((await learner.ok("/courses/materials/imports", { course })).imports).toHaveLength(1);
  });

  test("a body over 96 MB is refused as soon as it passes the limit", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    let sent = 0;
    const boundary = "----stillgotit-test";
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="course"\r\n\r\n${course}\r\n--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="big.md"\r\nContent-Type: text/markdown\r\n\r\n`);
    const chunk = new Uint8Array(MB).fill(0x61);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) { sent += head.length; controller.enqueue(head); return; }
        if (sent > 200 * MB) { controller.close(); return; }
        sent += chunk.length; controller.enqueue(chunk);
      },
    });
    const result = await learner.post("/courses/materials/add", body, { "Content-Type": `multipart/form-data; boundary=${boundary}` });
    expect(result).toEqual({ status: 400, body: { error: "OPERATION_FAILED", detail: TOO_LARGE_UPLOAD } });
    expect(sent).toBeLessThan(100 * MB);
    expect(sent).toBeGreaterThan(96 * MB);
  });
});

describe("Unfinished imports", () => {
  test("failed transcriptions are listed with their state and sentence, can be retried, and finish afterwards", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const requestId = randomUUID();
    await learner.ok("/courses/materials/add", form(course, [new File([wav(2)], "talk.wav")], { requestId, title: "Talk" }));
    const failing = spyOn(app.runtime.gemini, "json").mockImplementation(async () => { throw new (await import("../src/host/gemini.ts")).GeminiError("TIMEOUT"); });
    await app.runtime.worker.turn();
    failing.mockRestore();
    const failed = await learner.ok("/courses/materials/imports", { course });
    expect(failed.imports).toEqual([{ requestId, title: "Talk", state: "FAILED", files: [{ name: "talk.wav", state: "FAILED" }],
      detail: "Transcribing took too long. Try again, or split the recording into shorter parts.", canRetry: true, canRemove: true }]);
    const wake = spyOn(app.runtime.worker, "wake");
    expect(await learner.ok("/courses/materials/imports/retry", { requestId })).toEqual({ requestId, title: "Talk", state: "TRANSCRIBING",
      files: [{ name: "talk.wav", state: "WAITING" }], canRetry: false, canRemove: true });
    expect(wake).toHaveBeenCalled();
    wake.mockRestore();
    await app.runtime.worker.turn(); await app.runtime.worker.turn();
    const listed = await learner.ok("/courses/materials/imports", { course });
    expect(listed.saved).toHaveLength(1);
    expect(await learner.post("/courses/materials/imports/retry", { requestId })).toEqual({ status: 409, body: { error: "IMPORT_ALREADY_SAVED", detail: IMPORT_ALREADY_SAVED } });
    expect(await learner.post("/courses/materials/imports/remove", { requestId })).toEqual({ status: 409, body: { error: "IMPORT_ALREADY_SAVED", detail: IMPORT_ALREADY_SAVED } });
    expect(await learner.post("/courses/materials/imports/retry", { requestId: "unknown" })).toMatchObject({ status: 404, body: { error: "IMPORT_UNAVAILABLE" } });
  });

  test("a failure that cannot be retried is FAILED without retry, and removing the import deletes its files", async () => {
    const app = await setup({ transcript: '{"segments":[]}' }), learner = app.browser(), { course, user } = await learner.signIn("maya");
    const requestId = randomUUID();
    await learner.ok("/courses/materials/add", form(course, [notes(), new File([wav(2)], "silent.wav")], { requestId, title: "Silent" }));
    await app.runtime.worker.turn();
    const [entry] = (await learner.ok("/courses/materials/imports", { course })).imports;
    expect(entry).toMatchObject({ state: "FAILED", canRetry: false, canRemove: true, files: [{ name: "notes.md", state: "DONE" }, { name: "silent.wav", state: "FAILED" }],
      detail: "No speech or on-screen text was found. Remove this import, then upload the other files again without it." });
    expect(await learner.post("/courses/materials/imports/retry", { requestId })).toEqual({ status: 409, body: { error: "IMPORT_NOT_RETRYABLE", detail: IMPORT_NOT_RETRYABLE } });
    const saved = await operations(app).findOne({ requestId });
    const keys = (saved!.sources as { file: string }[]).map((file) => `${sha(user)}/${file.file}`);
    for (const key of keys) expect(await app.store.exists(key)).toBe(true);
    expect(await learner.ok("/courses/materials/imports/remove", { requestId })).toEqual({});
    for (const key of keys) expect(await app.store.exists(key)).toBe(false);
    expect(await operations(app).findOne({ requestId })).toMatchObject({ stage: "DISCARDED", filesDeleted: true });
    expect(await learner.ok("/courses/materials/imports/remove", { requestId })).toEqual({});
    expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
  });

  test("a READY import that AddMaterial refuses as invalid is shown as removable, logged, and then removed", async () => {
    const app = await setup(), learner = app.browser(), { course, user } = await learner.signIn("maya");
    const requestId = randomUUID();
    await learner.ok("/courses/materials/add", form(course, [notes(), new File([wav(2)], "lecture.wav")], { requestId }));
    await app.runtime.worker.turn(); await app.runtime.worker.turn();
    // The frozen input no longer passes AddMaterial's own checks.
    await operations(app).updateOne({ requestId }, { $set: { "prepared.content": "x".repeat(500_001) } });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const listed = await learner.ok("/courses/materials/imports", { course });
      expect(listed).toEqual({ saved: [], imports: [{ requestId, title: "Eigenvalues", state: "FAILED", detail: SAVE_INVALID, canRetry: false, canRemove: true,
        files: [{ name: "notes.md", state: "DONE" }, { name: "lecture.wav", state: "DONE" }] }] });
      const { importKey } = (await operations(app).findOne({ requestId }))!;
      expect(warn.mock.calls.map((call) => String(call[0])).find((line) => line.includes(requestId))).toContain(importKey);
      expect(warn.mock.calls.flat().join(" ")).not.toContain("xxxxxxxx");
    } finally { warn.mockRestore(); }
    expect(await learner.ok("/courses/materials/imports/remove", { requestId })).toEqual({});
    expect(await operations(app).findOne({ requestId })).toMatchObject({ stage: "DISCARDED", filesDeleted: true });
    expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
    for (const file of (await operations(app).findOne({ requestId }))!.sources as { file: string }[]) expect(await app.store.exists(`${sha(user)}/${file.file}`)).toBe(false);
  });

  test("a READY import whose key already holds a different material stays SAVING with its own sentence", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const requestId = randomUUID();
    await learner.ok("/courses/materials/add", form(course, [notes()], { requestId }));
    await operations(app).updateOne({ requestId }, { $set: { stage: "READY", "prepared.content": "Changed after saving" }, $unset: { material: "" } });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ saved: [], imports: [{ requestId, title: "Eigenvalues", state: "SAVING", detail: SAVE_STUCK,
        canRetry: false, canRemove: false, files: [{ name: "notes.md", state: "DONE" }] }] });
      expect(warn.mock.calls.map((call) => String(call[0])).join("\n")).toContain("MATERIAL_IMPORT_CONFLICT");
      expect(await learner.post("/courses/materials/imports/remove", { requestId })).toEqual({ status: 400,
        body: { error: "OPERATION_FAILED", detail: "This import could not be removed. Ask the app owner for help." } });
    } finally { warn.mockRestore(); }
  });
});

describe("Files and dictation", () => {
  test("the file route checks access and streams the saved bytes with their length", async () => {
    const app = await setup(), learner = app.browser(), other = app.browser(), { course } = await learner.signIn("maya");
    await other.signIn("leo");
    const pdf = scannedPdf(["Page one", null]);
    const { material } = await learner.ok("/courses/materials/add", form(course, [new File([pdf], "lesson.pdf")]));
    const { originals } = await learner.ok("/courses/materials/read", { material });
    const response = await learner.send("/courses/materials/file", { material, file: originals[0].file });
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject({ "content-type": "application/octet-stream", "content-length": String(pdf.length),
      "content-disposition": "attachment", "x-content-type-options": "nosniff" });
    expect(response.body).toBeInstanceOf(ReadableStream);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(pdf);
    expect((await other.send("/courses/materials/file", { material, file: originals[0].file })).status).toBe(403);
    expect((await learner.send("/courses/materials/file", { material, file: "../other.pdf" })).status).toBe(403);
  });

  test("dictation refuses a body over 16 MB while reading it", async () => {
    const app = await setup(), learner = app.browser();
    await learner.signIn("maya");
    let sent = 0;
    const boundary = "----stillgotit-dictation";
    const head = new TextEncoder().encode(`--${boundary}\r\nContent-Disposition: form-data; name="recording"; filename="answer.webm"\r\nContent-Type: audio/webm\r\n\r\n`);
    const chunk = new Uint8Array(MB);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent === 0) { sent += head.length; controller.enqueue(head); return; }
        if (sent > 40 * MB) { controller.close(); return; }
        sent += chunk.length; controller.enqueue(chunk);
      },
    });
    expect(await learner.post("/learning/transcribe", body, { "Content-Type": `multipart/form-data; boundary=${boundary}` })).toEqual({ status: 400,
      body: { error: "OPERATION_FAILED", detail: "Use an audio recording under 15 MB." } });
    expect(sent).toBeLessThan(20 * MB);
    const declared = await learner.post("/learning/transcribe", new FormData(), { "Content-Length": String(17 * MB) });
    expect(declared).toMatchObject({ status: 400, body: { detail: "Use an audio recording under 15 MB." } });
  });
});
