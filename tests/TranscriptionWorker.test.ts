import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DiskStore } from "../src/host/file-store.ts";
import { AUDIO_LIMITATION, locationKey, MAX_TEXT, VIDEO_LIMITATION } from "../src/host/extract.ts";
import { FilesApiError, Gemini, GeminiError, type GeminiPart, type Reason } from "../src/host/gemini.ts";
import { MaterialFiles } from "../src/host/material-files.ts";
import { ProviderFiles } from "../src/host/provider-files.ts";
import {
  formatTime, normalizeSegments, RETRY_DELAYS, SEGMENTS_SCHEMA, TEXT_LIMIT_FAILURE, TRANSCRIBE_INSTRUCTIONS, TRANSCRIPTION_FAILURES, TranscriptionWorker,
  type TranscriptionFailure,
} from "../src/host/transcription-worker.ts";
import { MaterialImportStore, type ImportOperation } from "../src/storage/MaterialImportStore.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { answer, fakeGemini, googleError } from "./fixtures/fake-gemini.ts";
import { mp4, wav } from "./fixtures/media.ts";

const MINUTE = 60_000, MB = 1024 * 1024;
let connection: Awaited<ReturnType<typeof connectMongo>>, directory: string;
beforeAll(async () => {
  connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${randomUUID().replaceAll("-", "")}` });
  directory = await mkdtemp(resolve(tmpdir(), "stillgotit-worker-"));
});
afterAll(async () => {
  await connection?.db.dropDatabase(); await connection?.client.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

type Json = (instructions: string, parts: GeminiPart[], schema: Record<string, unknown>, options?: { signal?: AbortSignal; model?: string; generationConfig?: Record<string, unknown> }) => Promise<unknown>;
const segments = (...items: [number, number, string][]) => ({ segments: items.map(([start, end, text]) => ({ start, end, text })) });

/** One app: an import store, retained files on disk, and a worker with a scripted Gemini. */
function setup({ json, model, providers }: { json?: Json; model?: string; providers?: ProviderFiles } = {}) {
  let now = new Date(Date.UTC(2026, 9, 23, 12));
  const clock = () => now, logs: string[] = [];
  const imports = new MaterialImportStore(connection.db, `MaterialImport_${randomUUID()}`, clock);
  const store = new DiskStore(resolve(directory, randomUUID())), files = new MaterialFiles(store);
  const calls: { instructions: string; parts: GeminiPart[]; options: Parameters<Json>[3] }[] = [];
  const answers: (unknown | Error | ((signal?: AbortSignal) => Promise<unknown>))[] = [];
  const gemini = {
    json: json ?? (async (instructions: string, parts: GeminiPart[], _schema: Record<string, unknown>, options?: Parameters<Json>[3]) => {
      calls.push({ instructions, parts, options });
      const next = answers.shift();
      if (next instanceof Error) throw next;
      if (typeof next === "function") return (next as (signal?: AbortSignal) => Promise<unknown>)(options?.signal);
      return next;
    }),
    outputLimit: async () => 65_536,
  };
  const worker = (extra: Partial<ConstructorParameters<typeof TranscriptionWorker>[0]> = {}) =>
    new TranscriptionWorker({ imports, files, gemini, providers, model, clock, log: (message) => logs.push(message), ...extra });

  /** Runs the upload route's steps for a learner: one document and the given recordings, saved TRANSCRIBING. */
  async function upload(owner: string, recordings: { name: string; bytes: Uint8Array<ArrayBuffer> }[], { doc = "Notes on eigenvalues.", course = "course-1" } = {}) {
    const requestId = randomUUID();
    const received = [new File([doc], "notes.md", { type: "text/markdown" }), ...recordings.map((item) => new File([item.bytes], item.name))];
    const inspected = await files.inspect(received, { recordings: true });
    let operation = await imports.getOrCreate({ owner, requestId, request: { scope: course, title: `Lecture ${requestId.slice(0, 4)}`, origin: "COURSE", sources: inspected.sources } });
    operation = await imports.saveSources({ owner, requestId, revision: 0, sources: await files.retain(operation, received, inspected) });
    const read = await files.readUpload(operation, received, inspected.detected);
    return imports.startTranscription({ owner, requestId, revision: operation.revision, partial: read.originals, recordings: read.recordings });
  }
  const reload = async ({ owner, requestId }: ImportOperation) => (await imports.get({ owner, requestId }))!;
  return { imports, files, store, worker, upload, reload, calls, answers, logs, advance: (ms: number) => { now = new Date(now.getTime() + ms); }, now: () => now };
}

describe("Segments and times", () => {
  test("times are MM:SS under an hour and H:MM:SS from one hour on", () => {
    expect([0, 21, 59 * 60 + 48, 3600, 3621, 2 * 3600 + 2 * 60 + 5].map(formatTime)).toEqual(["00:00", "00:21", "59:48", "1:00:00", "1:00:21", "2:02:05"]);
  });

  test("segments are ordered, overlaps move, timeless segments join the previous one, times stay within the length, and blanks are dropped", () => {
    expect(normalizeSegments(segments([30, 50, "Second."], [0, 30, "First."]), 60)).toEqual(segments([0, 30, "First."], [30, 50, "Second."]).segments);
    expect(normalizeSegments(segments([0, 30, "A."], [25, 40, "B."]), 60)).toEqual(segments([0, 30, "A."], [30, 40, "B."]).segments);
    expect(normalizeSegments(segments([0, 30, "A."], [10, 20, "inside."], [30, 30, "zero."]), 60)).toEqual(segments([0, 30, "A. inside. zero."]).segments);
    expect(normalizeSegments(segments([5, 5, "Lead."], [5, 20, "Body."]), 60)).toEqual(segments([5, 20, "Lead. Body."]).segments);
    expect(normalizeSegments(segments([0, 40, "A."], [40, 99, "B."], [120, 130, "past."]), 50)).toEqual(segments([0, 40, "A."], [40, 50, "B. past."]).segments);
    expect(normalizeSegments(segments([0, 10, "  "], [10.4, 19.6, " Rounded. "]), 60)).toEqual(segments([10, 20, "Rounded."]).segments);
    expect(normalizeSegments(segments([0, 0, "Only."], [0, 0, "Timeless."]), 42)).toEqual(segments([0, 42, "Only. Timeless."]).segments);
    expect(normalizeSegments({ segments: [] }, 10)).toEqual([]);
    for (const bad of [null, {}, { segments: "no" }, { segments: [{ start: "0", end: 1, text: "x" }] }, { segments: [{ start: 0, end: Infinity, text: "x" }] }]) {
      expect(normalizeSegments(bad, 10)).toBeNull();
    }
  });
});

describe("Transcription worker", () => {
  test("a recording is transcribed with the fixed request, saved, and finished as READY with time locations", async () => {
    const google = fakeGemini({ generate: () => answer(JSON.stringify(segments([0, 21, "Today we find the eigenvalues of a 2 × 2 matrix."], [21, 50, "First solve det(A − λI) = 0."]))) });
    const gemini = new Gemini({ key: "test-key-not-real", fetch: google.fetch, model: "gemini-tutor" });
    const app = setup({ json: gemini.json.bind(gemini) });
    const worker = app.worker({ gemini, model: "gemini-transcribe" });
    const operation = await app.upload("sam", [{ name: "Private lecture name.wav", bytes: wav(50) }]);
    expect(await worker.turn()).toBe(true);
    const [request] = google.generations();
    expect(request!.url).toEndWith("/models/gemini-transcribe:generateContent");
    expect(request!.body).toEqual({
      systemInstruction: { parts: [{ text: TRANSCRIBE_INSTRUCTIONS }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: "audio/wav", data: Buffer.from(wav(50)).toString("base64") } }, { text: "Transcribe this recording." }] }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: SEGMENTS_SCHEMA, thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 65_536 },
    });
    // The request carries no learner file names.
    expect(JSON.stringify(request!.body)).not.toContain("Private lecture name");
    expect(TRANSCRIBE_INSTRUCTIONS).toContain("[On screen: …]");
    const done = await app.reload(operation);
    expect(done.recordings![0]).toMatchObject({ status: "DONE", segments: segments([0, 21, "Today we find the eigenvalues of a 2 × 2 matrix."], [21, 50, "First solve det(A − λI) = 0."]).segments });
    expect(done.recordings![0]!.claim).toBeUndefined();
    // The next turn finishes the import from saved progress.
    expect(await worker.turn()).toBe(true);
    const ready = await app.reload(operation), recording = ready.prepared!.originals[1]!, key = locationKey(recording.file);
    expect(ready.stage).toBe("READY");
    expect(recording.renditions).toEqual([
      { kind: "TEXT", location: `${key}/time/00:00-00:21`, text: "Today we find the eigenvalues of a 2 × 2 matrix." },
      { kind: "TEXT", location: `${key}/time/00:21-00:50`, text: "First solve det(A − λI) = 0." },
    ]);
    expect(recording.limitations).toEqual([AUDIO_LIMITATION]);
    const doc = ready.prepared!.originals[0]!;
    expect(ready.prepared).toMatchObject({ owner: "sam", scope: "course-1", importKey: operation.importKey, title: operation.request.title, locator: `upload:${operation.importKey}`, origin: "COURSE",
      content: `[${locationKey(doc.file)}/lines/1-1]\nNotes on eigenvalues.\n\n[${key}/time/00:00-00:21]\nToday we find the eigenvalues of a 2 × 2 matrix.\n\n[${key}/time/00:21-00:50]\nFirst solve det(A − λI) = 0.` });
    expect(await worker.turn()).toBe(false);
  });

  test("a video asks for low media resolution and gets the video limitation; the tutor model is used without a transcription model", async () => {
    const google = fakeGemini({ generate: () => answer(JSON.stringify(segments([0, 9, "The determinant is zero here. [On screen: det [[2, 4], [1, 2]] = 0]"]))) });
    const gemini = new Gemini({ key: "test-key-not-real", fetch: google.fetch, model: "gemini-tutor" });
    const app = setup();
    const worker = app.worker({ gemini, model: undefined });
    const operation = await app.upload("sam", [{ name: "board.mp4", bytes: mp4({ seconds: 9 }) }]);
    await worker.turn(); await worker.turn();
    const [request] = google.generations();
    expect(request!.url).toEndWith("/models/gemini-tutor:generateContent");
    expect(request!.body!.generationConfig).toMatchObject({ mediaResolution: "MEDIA_RESOLUTION_LOW", thinkingConfig: { thinkingLevel: "low" } });
    expect(request!.body!.contents[0].parts[0].inlineData.mimeType).toBe("video/mp4");
    const ready = await app.reload(operation);
    expect(ready.prepared!.originals[1]!.limitations).toEqual([VIDEO_LIMITATION]);
    expect(ready.prepared!.originals[1]!.renditions[0]).toMatchObject({ text: "The determinant is zero here. [On screen: det [[2, 4], [1, 2]] = 0]" });
  });

  test("segment times past the recording's own length are set to that length", async () => {
    const app = setup(), worker = app.worker();
    const operation = await app.upload("sam", [{ name: "short.wav", bytes: wav(12) }]);
    app.answers.push(segments([0, 10, "Start."], [10, 95, "The model guessed a long end."]));
    await worker.turn();
    expect((await app.reload(operation)).recordings![0]!.segments).toEqual(segments([0, 10, "Start."], [10, 12, "The model guessed a long end."]).segments);
  });

  const reasons: [Reason, TranscriptionFailure][] = [
    ["BUSY", "BUSY"], ["NETWORK", "NETWORK"], ["EMPTY", "INCOMPLETE"], ["FORMAT", "INCOMPLETE"], ["TIMEOUT", "TIMEOUT"], ["QUOTA", "QUOTA"],
    ["UNAVAILABLE", "NO_KEY"], ["SETUP", "WRONG_KEY"], ["REJECTED", "NOT_ACCEPTED"], ["TOO_LARGE", "NOT_ACCEPTED"], ["FILE_UNREADABLE", "UNREADABLE"],
    ["BLOCKED", "SAFETY"], ["TOO_LONG", "TRANSCRIPT_TOO_LONG"], ["FILE_EXPIRED", "UPLOAD_FAILED"],
  ];
  test.each(reasons)("a %s answer is saved as %s with its sentence, retry rule, and automatic retries", async (reason, expected) => {
    const app = setup(), worker = app.worker(), entry = TRANSCRIPTION_FAILURES[expected];
    const operation = await app.upload("sam", [{ name: "talk.wav", bytes: wav(3) }]);
    const attempts = entry.auto ? RETRY_DELAYS.length + 1 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      app.answers.push(new GeminiError(reason));
      expect(await worker.turn()).toBe(true);
      const recording = (await app.reload(operation)).recordings![0]!;
      if (attempt < attempts - 1) {
        // Retried automatically one minute later, then five minutes after that.
        expect(recording).toMatchObject({ status: "WAITING", attempts: attempt + 1, retryAt: new Date(app.now().getTime() + RETRY_DELAYS[attempt]!) });
        expect(await worker.turn()).toBe(false);
        app.advance(RETRY_DELAYS[attempt]!);
      } else {
        expect(recording).toMatchObject({ status: "FAILED", failure: { reason: expected, sentence: entry.sentence, retryable: entry.retryable } });
      }
    }
    expect(app.logs.at(-1)).toContain(expected);
  });

  test("an answer with no segments, a malformed answer, and an unreadable saved file each fail with their own reason", async () => {
    const app = setup(), worker = app.worker();
    const silent = await app.upload("sam", [{ name: "silent.wav", bytes: wav(3) }]);
    app.answers.push({ segments: [] });
    await worker.turn();
    expect((await app.reload(silent)).recordings![0]).toMatchObject({ status: "FAILED", failure: { reason: "NO_SPEECH", retryable: false,
      sentence: "No speech or on-screen text was found. Remove this import, then upload the other files again without it." } });
    const odd = await app.upload("sam", [{ name: "odd.wav", bytes: wav(3) }]);
    app.answers.push({ text: "not segments" });
    await worker.turn();
    expect((await app.reload(odd)).recordings![0]).toMatchObject({ status: "WAITING", attempts: 1 });
    const damaged = await app.upload("leo", [{ name: "damaged.wav", bytes: wav(3) }]);
    const file = damaged.partial![1]!.file;
    await app.store.put(app.files.storeKey("leo", file), new TextEncoder().encode("no longer a recording"));
    await worker.turn();
    expect((await app.reload(damaged)).recordings![0]).toMatchObject({ status: "FAILED", failure: { reason: "UNREADABLE", retryable: false } });
    const missing = await app.upload("max", [{ name: "missing.wav", bytes: wav(3) }]);
    await app.store.delete(app.files.storeKey("max", missing.partial![1]!.file));
    app.advance(10 * MINUTE);
    app.answers.push(segments([0, 3, "unused"]));
    // The missing file is reported as an unavailable store and waits for an automatic retry; the odd recording then succeeds.
    await worker.turn(); await worker.turn();
    expect((await app.reload(missing)).recordings![0]).toMatchObject({ status: "WAITING", attempts: 1 });
    expect(TRANSCRIPTION_FAILURES.STORE_UNAVAILABLE.sentence).toBe("Saved files are unavailable right now. Try again later.");
  });

  test("a failure that cannot be retried stops claims for the import's other recordings", async () => {
    const app = setup(), worker = app.worker();
    const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }, { name: "b.wav", bytes: wav(4) }]);
    app.answers.push(new GeminiError("BLOCKED"));
    await worker.turn();
    expect(await worker.turn()).toBe(false);
    expect((await app.reload(operation)).recordings!.map((item) => item.status)).toEqual(["FAILED", "WAITING"]);
    expect(app.calls).toHaveLength(1);
  });

  test("after the learner retries, finished transcripts are kept and the failed recording is transcribed again", async () => {
    const app = setup(), worker = app.worker();
    const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }, { name: "b.wav", bytes: wav(4) }]);
    app.answers.push(segments([0, 3, "First."]), new GeminiError("TIMEOUT"));
    await worker.turn(); await worker.turn();
    expect((await app.reload(operation)).recordings!.map((item) => item.status)).toEqual(["DONE", "FAILED"]);
    await app.imports.retry(operation);
    app.answers.push(segments([0, 4, "Second."]));
    await worker.turn();
    await worker.turn();
    const ready = await app.reload(operation);
    expect(ready.stage).toBe("READY");
    expect(ready.prepared!.originals.slice(1).map((file) => file.renditions.map((part) => part.kind === "TEXT" && part.text))).toEqual([["First."], ["Second."]]);
    expect(app.calls).toHaveLength(3);
  });

  test("a removal during a call drops the worker's result, and the worker deletes the removed import's files", async () => {
    const app = setup(), worker = app.worker();
    const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }]);
    const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    app.answers.push(async () => { started.resolve(); await release.promise; return segments([0, 3, "Too late."]); });
    const turn = worker.turn();
    await started.promise;
    await app.imports.discard(operation);
    release.resolve();
    expect(await turn).toBe(false);
    const removed = await app.reload(operation);
    expect(removed).toMatchObject({ stage: "DISCARDED", filesDeleted: false });
    expect(removed.recordings![0]).toMatchObject({ status: "WAITING", attempts: 0 });
    expect(await worker.turn()).toBe(true);
    expect((await app.reload(operation)).filesDeleted).toBe(true);
    for (const file of operation.partial!) expect(await app.store.exists(app.files.storeKey("sam", file.file))).toBe(false);
  });

  test("a new process resumes after a stopped worker's claim ends, finishes saved transcripts, and finishes deletions", async () => {
    const app = setup();
    // A worker that stopped mid-call left its claim behind.
    const abandoned = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }]);
    await app.imports.claim({ now: app.now(), token: "stopped-worker", until: new Date(app.now().getTime() + 5 * MINUTE) });
    // Another import's last transcript was saved just before a stop.
    const saved = await app.upload("leo", [{ name: "b.wav", bytes: wav(3) }]);
    const claim = (await app.imports.claim({ now: app.now(), token: "finished-worker", until: new Date(app.now().getTime() + 5 * MINUTE) }))!;
    expect(claim.requestId).toBe(saved.requestId);
    await app.imports.saveTranscript({ ...claim, token: "finished-worker", segments: [{ start: 0, end: 3, text: "Saved." }] });
    // A third import was removed but its files were not yet deleted.
    const removed = await app.upload("max", [{ name: "c.wav", bytes: wav(3) }]);
    await app.imports.discard(removed);

    const restarted = app.worker();
    expect(await restarted.turn()).toBe(true);
    expect((await app.reload(saved)).stage).toBe("READY");
    expect((await app.reload(removed)).filesDeleted).toBe(true);
    expect(app.calls).toHaveLength(0);
    app.advance(5 * MINUTE + 1);
    app.answers.push(segments([0, 3, "Resumed."]));
    expect(await restarted.turn()).toBe(true);
    expect((await app.reload(abandoned)).recordings![0]).toMatchObject({ status: "DONE", segments: [{ start: 0, end: 3, text: "Resumed." }] });
  });

  test("turns alternate between learners", async () => {
    const app = setup(), worker = app.worker();
    // Learner B started first, with two recordings; learner A has two as well.
    await app.upload("learner-b", [{ name: "b1.wav", bytes: wav(1) }, { name: "b2.wav", bytes: wav(2) }]);
    await app.upload("learner-a", [{ name: "a1.wav", bytes: wav(3) }, { name: "a2.wav", bytes: wav(4) }]);
    const names = new Map([[wav(1).length, "b1"], [wav(2).length, "b2"], [wav(3).length, "a1"], [wav(4).length, "a2"]]);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      app.answers.push(segments([0, 1, `turn ${i}`]));
      await worker.turn();
      const data = (app.calls.at(-1)!.parts[0] as { inlineData: { data: string } }).inlineData.data;
      order.push(names.get(Buffer.from(data, "base64").length)!);
    }
    expect(order).toEqual(["a1", "b1", "a2", "b2"]);
  });

  test("the combined text is checked again after transcription, and the failure cannot be retried", async () => {
    const app = setup(), worker = app.worker();
    const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }], { doc: "x".repeat(MAX_TEXT - 100) });
    app.answers.push(segments([0, 3, "y".repeat(200)]));
    await worker.turn(); await worker.turn();
    const failed = await app.reload(operation);
    expect(failed).toMatchObject({ stage: "TRANSCRIBING", failure: TEXT_LIMIT_FAILURE });
    expect(TEXT_LIMIT_FAILURE.sentence).toBe("This material contains too much text. Remove this import and import a smaller unit.");
    await expect(app.imports.retry(operation)).rejects.toMatchObject({ code: "IMPORT_NOT_RETRYABLE" });
    expect(await worker.turn()).toBe(false);
  });

  test("the claim is renewed while the call runs, and a lost claim drops the result", async () => {
    const app = setup();
    const worker = app.worker({ renewMs: 10 });
    const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }]);
    const renew = spyOn(app.imports, "renew");
    app.answers.push(async () => { await Bun.sleep(60); return segments([0, 3, "Kept."]); });
    await worker.turn();
    expect(renew.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect((await app.reload(operation)).recordings![0]!.status).toBe("DONE");
    // Finish that import, so the next turn has only the new recording to work on.
    expect(await worker.turn()).toBe(true);
    const lost = await app.upload("leo", [{ name: "b.wav", bytes: wav(3) }]);
    renew.mockImplementation(async () => false);
    app.answers.push(async (signal?: AbortSignal) => {
      await new Promise((resolve) => { signal?.addEventListener("abort", resolve); setTimeout(resolve, 500); });
      return segments([0, 3, "Dropped."]);
    });
    expect(await worker.turn()).toBe(false);
    expect((await app.reload(lost)).recordings![0]).toMatchObject({ status: "WAITING", attempts: 0 });
    renew.mockRestore();
  });

  test("stopping the worker stops the call in progress and starts no new work", async () => {
    const app = setup();
    const worker = app.worker({ intervalMs: 10 });
    const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }]);
    const started = Promise.withResolvers<void>();
    app.answers.push(async (signal?: AbortSignal) => {
      started.resolve();
      await new Promise((resolve) => signal?.addEventListener("abort", resolve));
      throw new GeminiError("TIMEOUT");
    });
    worker.start();
    await started.promise;
    await worker.stop();
    const after = await app.reload(operation);
    expect(after.recordings![0]).toMatchObject({ status: "WAITING", attempts: 0, claim: { token: expect.any(String) } });
    await Bun.sleep(50);
    expect(app.calls).toHaveLength(1);
    worker.wake();
    await Bun.sleep(20);
    expect(app.calls).toHaveLength(1);
  });

  test("a started worker picks up new uploads when woken", async () => {
    const app = setup(), worker = app.worker();
    worker.start();
    try {
      const operation = await app.upload("sam", [{ name: "a.wav", bytes: wav(3) }]);
      app.answers.push(segments([0, 3, "Woken."]));
      worker.wake();
      for (let i = 0; i < 100 && (await app.reload(operation)).stage !== "READY"; i++) await Bun.sleep(10);
      expect((await app.reload(operation)).stage).toBe("READY");
    } finally { await worker.stop(); }
  });

  test("a recording larger than 15 MB goes through the Files API and is referenced by URI", async () => {
    const google = fakeGemini({ processing: 1, generate: () => answer(JSON.stringify(segments([0, 400, "Long lecture."]))) });
    const gemini = new Gemini({ key: "test-key-not-real", fetch: google.fetch, pollMs: 1 });
    const app = setup({ json: gemini.json.bind(gemini) });
    const providers = new ProviderFiles(connection.db, gemini, app.files, app.now, `ProviderFiles_${randomUUID()}`);
    const worker = app.worker({ gemini, providers });
    const big = wav(1000, { rate: 16000 });
    expect(big.length).toBeGreaterThan(15 * MB);
    const operation = await app.upload("sam", [{ name: "Long lecture.wav", bytes: big }]);
    await worker.turn();
    expect(google.uploads).toHaveLength(1);
    expect(google.uploads[0]).toMatchObject({ mimeType: "audio/wav", size: big.length });
    expect(google.uploads[0]!.displayName).not.toContain("Long lecture");
    expect(google.generations()[0]!.body!.contents[0].parts[0]).toEqual({ fileData: { mimeType: "audio/wav", fileUri: google.uploads[0]!.uri } });
    expect((await app.reload(operation)).recordings![0]!.status).toBe("DONE");
  });

  test("a failed Files API upload is retried automatically; a refused key is not", async () => {
    const app = setup();
    const failing = { reference: async () => { throw new FilesApiError("BUSY"); }, forget: async () => undefined };
    const refused = { reference: async () => { throw new FilesApiError("SETUP"); }, forget: async () => undefined };
    const big = wav(1000, { rate: 16000 });
    const first = await app.upload("sam", [{ name: "a.wav", bytes: big }]);
    await app.worker({ providers: failing as never }).turn();
    expect((await app.reload(first)).recordings![0]).toMatchObject({ status: "WAITING", attempts: 1 });
    const second = await app.upload("leo", [{ name: "b.wav", bytes: big }]);
    await app.worker({ providers: refused as never }).turn();
    expect((await app.reload(second)).recordings![0]).toMatchObject({ status: "FAILED", failure: { reason: "WRONG_KEY", retryable: true } });
  });
});

void googleError;
