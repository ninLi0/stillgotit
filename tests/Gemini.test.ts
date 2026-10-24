import { expect, test } from "bun:test";
import { DEFAULT_MODEL, FALLBACK_OUTPUT_LIMIT, FilesApiError, Gemini, GeminiError, objectSchema } from "../src/host/gemini.ts";
import { fakeGemini, googleError as filesError } from "./fixtures/fake-gemini.ts";
import { CourseTutor } from "../src/host/tutor.ts";
import type { Material, MaterialData } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";

const KEY = "test-key-not-real";
const schema = objectSchema({ answer: { type: "string" } });
type Call = { url: string; init: RequestInit; body: Record<string, any> };

/** A fake Gemini endpoint. `reply` returns the HTTP response for each call. */
function fake(reply: (call: Call) => Response | Promise<Response> = () => answer('{"answer":"grounded"}')) {
  const calls: Call[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit = {}) => {
    const call = { url: String(input), init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return reply(call);
  }) as typeof globalThis.fetch;
  return { calls, gemini: (options: ConstructorParameters<typeof Gemini>[0] = {}) => new Gemini({ key: KEY, fetch, ...options }) };
}
const answer = (text: string, extra: Record<string, unknown> = {}) => Response.json({
  candidates: [{ content: { role: "model", parts: [{ text: "Planning the answer.", thought: true }, { text }] }, finishReason: "STOP", ...extra }],
  modelVersion: DEFAULT_MODEL,
});
const googleError = (status: number, error: Record<string, unknown>) => Response.json({ error: { code: status, ...error } }, { status });
async function failure(work: Promise<unknown>) {
  const error = await work.then(() => { throw new Error("Expected a failure"); }, (problem) => problem);
  expect(String(error)).not.toContain(KEY);
  return error as Error;
}

test("a structured request uses generateContent, the key header, the model, and a JSON schema", async () => {
  const saved = process.env.GEMINI_MODEL;
  delete process.env.GEMINI_MODEL;
  try {
    const { calls, gemini } = fake();
    const parts = [{ text: "Source text" }, { inlineData: { mimeType: "application/pdf", data: "JVBERi0=" } }];
    expect(await gemini().json("Follow these rules.", parts, schema)).toEqual({ answer: "grounded" });
    expect(DEFAULT_MODEL).toBe("gemini-3.8-flash");
    const [call] = calls;
    expect(call!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    expect(call!.url).not.toContain(KEY);
    expect(call!.init.method).toBe("POST");
    expect(call!.init.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": KEY });
    expect(call!.init.signal).toBeInstanceOf(AbortSignal);
    expect(call!.body).toEqual({
      systemInstruction: { parts: [{ text: "Follow these rules." }] },
      contents: [{ role: "user", parts }],
      generationConfig: { responseMimeType: "application/json", responseJsonSchema: schema },
    });
    await gemini({ model: "models/gemini-test-model" }).json("Rules", [{ text: "Hi" }], schema);
    expect(calls[1]!.url).toEndWith("/v1beta/models/gemini-test-model:generateContent");
    expect(gemini().status()).toEqual({ available: true, reason: "" });
  } finally { if (saved !== undefined) process.env.GEMINI_MODEL = saved; }
});

test("without a key the client reports why and never calls Google", async () => {
  const { calls, gemini } = fake();
  const client = gemini({ key: "  " });
  expect(client.status()).toEqual({ available: false, reason: expect.stringContaining("Gemini API key") });
  expect((await failure(client.json("Rules", [{ text: "Hi" }], schema))).message).toContain("not set up on this server");
  expect(calls).toHaveLength(0);
});

test("provider errors become plain, retryable messages without provider text", async () => {
  const cases: [Response | (() => Response), RegExp][] = [
    [googleError(429, { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details.",
      details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerMinutePerProjectPerModel-FreeTier" }] }] }), /busy right now\. Wait a minute/],
    [googleError(429, { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded.",
      details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] }), /quota or billing/],
    [googleError(400, { status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] }), /isn't set up correctly/],
    [googleError(403, { status: "PERMISSION_DENIED", message: "Method doesn't allow unregistered callers." }), /isn't set up correctly/],
    [googleError(404, { status: "NOT_FOUND", message: "models/unknown is not found." }), /isn't set up correctly/],
    [googleError(400, { status: "FAILED_PRECONDITION", message: "Please enable billing on your project." }), /quota or billing/],
    [googleError(400, { status: "INVALID_ARGUMENT", message: "Request contains an invalid argument." }), /could not accept this request/],
    [googleError(503, { status: "UNAVAILABLE", message: "The model is overloaded." }), /busy right now/],
    [() => Response.json({ promptFeedback: { blockReason: "SAFETY" } }), /safety rules/],
    [() => answer("", { finishReason: "SAFETY" }), /safety rules/],
    [() => answer('{"answer":"cut', { finishReason: "MAX_TOKENS" }), /too long to finish/],
    [() => answer("   "), /empty answer/],
    [() => Response.json({ candidates: [] }), /empty answer/],
    [() => answer("Here is the answer: grounded"), /wrong format/],
    [() => new Response("<html>gateway</html>", { status: 200 }), /wrong format/],
  ];
  for (const [response, message] of cases) {
    const { gemini } = fake(() => typeof response === "function" ? response() : response.clone());
    const error = await failure(gemini().json("Rules", [{ text: "Hi" }], schema));
    expect(error, message.source).toBeInstanceOf(GeminiError);
    expect(error.message).toMatch(message);
    expect(error.message).not.toMatch(/quota exceeded|invalid argument|overloaded|unregistered/i);
  }
});

test("a slow or unreachable provider times out or reports the connection problem", async () => {
  const slow = fake(({ init }) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
  const started = performance.now();
  expect((await failure(slow.gemini({ timeoutMs: 30 }).json("Rules", [{ text: "Hi" }], schema))).message).toContain("took too long");
  expect(performance.now() - started).toBeLessThan(2000);
  const offline = fake(() => { throw new TypeError("fetch failed"); });
  expect((await failure(offline.gemini().json("Rules", [{ text: "Hi" }], schema))).message).toContain("could not reach the AI service");
});

test("dictation sends the recording inline with its audio type and returns the transcript", async () => {
  const { calls, gemini } = fake(() => answer('{"text":"  The determinant is ad − bc.  "}'));
  const client = gemini();
  const recording = new File([new Uint8Array([26, 69, 223, 163])], "answer.webm", { type: "audio/webm;codecs=opus" });
  expect(await client.transcribe(recording)).toEqual({ text: "The determinant is ad − bc." });
  const body = calls[0]!.body;
  expect(body.systemInstruction.parts[0].text).toContain("Write exactly what was said");
  expect(body.systemInstruction.parts[0].text).toContain("Write spoken math the way it would be written");
  expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "audio/webm", data: Buffer.from([26, 69, 223, 163]).toString("base64") } });
  expect(body.generationConfig.responseJsonSchema).toEqual(objectSchema({ text: { type: "string" } }));
  await client.transcribe(new File([new Uint8Array([1])], "answer.m4a", { type: "" }));
  expect(calls[1]!.body.contents[0].parts[0].inlineData.mimeType).toBe("audio/mp4");
  await expect(client.transcribe(new File([], "answer.webm", { type: "audio/webm" }))).rejects.toThrow("audio recording under 15 MB");
  await expect(client.transcribe(new File(["notes"], "notes.txt", { type: "text/plain" }))).rejects.toThrow("audio recording under 15 MB");
  expect(calls).toHaveLength(2);
  const silent = fake(() => answer('{"text":"  "}'));
  await expect(silent.gemini().transcribe(recording)).rejects.toThrow("No speech was detected");
});

test("the tutor sends each source's text and how its files were sent, with small PDFs and images inline", async () => {
  const { calls, gemini } = fake(() => answer('{"explanation":"Rows meet columns.","citations":[]}'));
  const stored: Record<string, Buffer> = {
    "lesson.pdf": Buffer.from("%PDF-1.7 small"), "scan.pdf": Buffer.from("%PDF-1.7 scan"), "photo.heic": Buffer.from("heic-bytes"),
    "photo.jpg": Buffer.from("jpeg-bytes"), "work.png": Buffer.from("work-bytes"), "lecture.mp4": Buffer.from("video-bytes"),
  };
  const reads: string[] = [];
  const files = { read: async (owner: string, file: string) => { expect(owner).toBe("sam"); reads.push(file); return stored[file]!; },
    size: async (_owner: string, file: string) => stored[file]!.length };
  const tutor = new CourseTutor(gemini(), files);
  const data: MaterialData<string, string> = { owner: "sam", scope: "course", title: "Matrices", locator: "upload:1", content: "Rows times columns.", origin: "COURSE", originals: [
    { file: "lesson.pdf", name: "Lesson.pdf", mediaType: "application/pdf", limitations: [], renditions: [{ kind: "TEXT", location: "k1/page/1", text: "Rows times columns." }] },
    { file: "scan.pdf", name: "Scan.pdf", mediaType: "application/pdf", limitations: ["This PDF has no selectable text. The tutor reads its pages as images."],
      renditions: [{ kind: "PAGE", location: "k2/page/1", page: 1 }] },
    { file: "photo.heic", name: "Board.heic", mediaType: "image/heic", limitations: [], renditions: [{ kind: "IMAGE", location: "k3/image", file: "photo.heic", mediaType: "image/heic" }] },
    { file: "photo.jpg", name: "Board.jpg", mediaType: "image/jpeg", limitations: [], renditions: [] },
    { file: "lecture.mp4", name: "Lecture.mp4", mediaType: "video/mp4", limitations: ["This transcript was written by the AI tutor from the video."],
      renditions: [{ kind: "TEXT", location: "k5/time/00:00-00:21", text: "Today we multiply." }] },
    { file: "notes.md", name: "Notes.md", mediaType: "text/markdown", limitations: [], renditions: [{ kind: "TEXT", location: "k6/lines/1-1", text: "Notes" }] },
  ] };
  const work = [{ file: "work.png", name: "My work.png", mediaType: "image/png", limitations: [], renditions: [] }];
  await tutor.generate("sam", [{ material: "m1" as Material, data }], "Explain.", { request: "Teach me" }, schema, work);
  const { systemInstruction, contents: [{ parts }] } = calls[0]!.body;
  expect(systemInstruction.parts[0].text).toContain("careful course tutor");
  expect(systemInstruction.parts[0].text).toEndWith("Explain.");
  const source = JSON.parse(parts[0].text);
  expect(source).toMatchObject({ material: "m1", title: "Matrices", locator: "upload:1", content: "Rows times columns." });
  expect(source.sources.map((item: { name: string; mediaType: string; locations: string[]; sent: string }) => [item.name, item.mediaType, item.locations, item.sent])).toEqual([
    ["Lesson.pdf", "application/pdf", ["k1/page/1"], "The original PDF is attached inline, so pages without selectable text can be read from it."],
    ["Scan.pdf", "application/pdf", ["k2/page/1"], "The original PDF is attached inline, so pages without selectable text can be read from it."],
    ["Board.heic", "image/heic", ["k3/image"], "The image is attached inline."],
    ["Board.jpg", "image/jpeg", [], "The image is attached inline."],
    ["Lecture.mp4", "video/mp4", ["k5/time/00:00-00:21"], "Sent as its transcript, which is in the content and locations. The recording itself is not attached."],
    ["Notes.md", "text/markdown", ["k6/lines/1-1"], "Sent as text only."],
  ]);
  expect(source.sources[1].limitations).toEqual(["This PDF has no selectable text. The tutor reads its pages as images."]);
  const inline = parts.filter((part: { inlineData?: unknown }) => part.inlineData).map((part: { inlineData: { mimeType: string; data: string } }) => part.inlineData);
  expect(inline).toEqual([
    { mimeType: "application/pdf", data: stored["lesson.pdf"]!.toString("base64") },
    { mimeType: "application/pdf", data: stored["scan.pdf"]!.toString("base64") },
    { mimeType: "image/heic", data: stored["photo.heic"]!.toString("base64") },
    { mimeType: "image/jpeg", data: stored["photo.jpg"]!.toString("base64") },
    { mimeType: "image/png", data: stored["work.png"]!.toString("base64") },
  ]);
  expect(parts.some((part: { text?: string }) => part.text?.includes("the original PDF Scan.pdf"))).toBe(true);
  expect(parts.at(-1)).toEqual({ text: JSON.stringify({ request: "Teach me" }) });
  // The recording is never read: its transcript is already text.
  expect(reads.sort()).toEqual(["lesson.pdf", "photo.heic", "photo.jpg", "scan.pdf", "work.png"]);
  await expect(tutor.generate("leo", [{ material: "m1" as Material, data }], "Explain.", {}, schema)).rejects.toThrow("Choose one of your materials.");
});

test("a request carries at most 40 images and notes the ones left out", async () => {
  const { calls, gemini } = fake(() => answer('{"explanation":"Rows meet columns.","citations":[]}'));
  const tutor = new CourseTutor(gemini(), { read: async () => Buffer.from("png"), size: async () => 3 });
  const originals = Array.from({ length: 41 }, (_, i) => ({ file: `p${i}.png`, name: `Page ${i + 1}.png`, mediaType: "image/png", limitations: [],
    renditions: [{ kind: "IMAGE" as const, location: `k${i}/image`, file: `p${i}.png`, mediaType: "image/png" as const }] }));
  const data: MaterialData<string, string> = { owner: "sam", scope: "course", title: "Photos", locator: "upload:1", content: "", origin: "COURSE", originals };
  await tutor.generate("sam", [{ material: "m1" as Material, data }], "Explain.", {}, schema);
  const { parts } = calls[0]!.body.contents[0];
  expect(parts.filter((part: { inlineData?: unknown }) => part.inlineData)).toHaveLength(40);
  expect(JSON.parse(parts[0].text).sources[40].sent).toBe("An image was left out because one request carries at most 40 images.");
});

test("generation settings, the model, and the time limit can be set per call", async () => {
  const { calls, gemini } = fake();
  await gemini().json("Rules", [{ text: "Hi" }], schema, { model: "gemini-transcribe", timeoutMs: 600_000,
    generationConfig: { thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 65536, mediaResolution: "MEDIA_RESOLUTION_LOW" } });
  expect(calls[0]!.url).toEndWith("/models/gemini-transcribe:generateContent");
  expect(calls[0]!.body.generationConfig).toEqual({ responseMimeType: "application/json", responseJsonSchema: schema,
    thinkingConfig: { thinkingLevel: "low" }, maxOutputTokens: 65536, mediaResolution: "MEDIA_RESOLUTION_LOW" });
  const stop = new AbortController();
  const slow = fake(({ init }) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
  const pending = slow.gemini().json("Rules", [{ text: "Hi" }], schema, { signal: stop.signal });
  stop.abort();
  expect((await failure(pending)).message).toContain("took too long");
});

test("the largest output size is read once from the model list, with a fallback", async () => {
  const google = fakeGemini({ outputTokenLimit: 131_072 });
  const client = new Gemini({ key: KEY, fetch: google.fetch, model: "gemini-test" });
  expect(await client.outputLimit()).toBe(131_072);
  expect(await client.outputLimit("models/gemini-test")).toBe(131_072);
  expect(google.calls).toHaveLength(1);
  expect(google.calls[0]!.url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test");
  expect(google.calls[0]!.headers.get("x-goog-api-key")).toBe(KEY);
  const down = fakeGemini({ outputTokenLimit: null });
  expect(await new Gemini({ key: KEY, fetch: down.fetch }).outputLimit()).toBe(FALLBACK_OUTPUT_LIMIT);
  const none = fakeGemini();
  expect(await new Gemini({ key: "", fetch: none.fetch }).outputLimit()).toBe(FALLBACK_OUTPUT_LIMIT);
  expect(none.calls).toHaveLength(0);
});

test("a Files API upload starts with the key in a header, sends raw bytes to Google's upload address, and waits for ACTIVE", async () => {
  const google = fakeGemini({ processing: 2 });
  const client = new Gemini({ key: KEY, fetch: google.fetch, pollMs: 1 });
  const bytes = new Uint8Array(1000).fill(7);
  const uploaded = await client.uploadFile(bytes, { mimeType: "application/pdf", displayName: "a".repeat(64) });
  expect(uploaded).toMatchObject({ name: "files/file2", state: "PROCESSING", mimeType: "application/pdf", uri: "https://generativelanguage.googleapis.com/v1beta/files/file2" });
  const [start, finish] = google.calls;
  expect(start!.url).toBe("https://generativelanguage.googleapis.com/upload/v1beta/files");
  expect(Object.fromEntries(start!.headers)).toMatchObject({ "x-goog-api-key": KEY, "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start",
    "x-goog-upload-header-content-length": "1000", "x-goog-upload-header-content-type": "application/pdf", "content-type": "application/json" });
  expect(start!.body).toEqual({ file: { display_name: "a".repeat(64) } });
  expect(finish!.url).toStartWith("https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=");
  expect(finish!.headers.get("x-goog-api-key")).toBeNull();
  expect(Object.fromEntries(finish!.headers)).toMatchObject({ "x-goog-upload-offset": "0", "x-goog-upload-command": "upload, finalize" });
  expect(finish!.bytes).toBe(1000);
  const active = await client.waitForActive(uploaded);
  expect(active.state).toBe("ACTIVE");
  expect(google.calls.slice(2).map((call) => [call.method, call.url])).toEqual([
    ["GET", "https://generativelanguage.googleapis.com/v1beta/files/file2"], ["GET", "https://generativelanguage.googleapis.com/v1beta/files/file2"]]);
  expect(active.expirationTime).toEqual(expect.any(String));
});

test("Files API failures are classified without exposing Google's text", async () => {
  const failed = fakeGemini({ failProcessing: true });
  const client = new Gemini({ key: KEY, fetch: failed.fetch, pollMs: 1 });
  const file = await client.uploadFile(new Uint8Array(10), { mimeType: "video/mp4", displayName: "digest" });
  await expect(client.waitForActive(file)).rejects.toMatchObject({ reason: "FILE_UNREADABLE" });
  const cases: [Response, FilesApiError["reason"]][] = [
    [filesError(429, { status: "RESOURCE_EXHAUSTED", message: "Too many requests." }), "BUSY"],
    [filesError(400, { status: "INVALID_ARGUMENT", message: "API key not valid.", details: [{ reason: "API_KEY_INVALID" }] }), "SETUP"],
    [filesError(413, { status: "INVALID_ARGUMENT", message: "Request payload size exceeds the limit." }), "TOO_LARGE"],
    [filesError(500, { status: "INTERNAL", message: "Internal error." }), "BUSY"],
  ];
  for (const [response, reason] of cases) {
    const google = fakeGemini({ startUpload: () => response.clone() });
    const error = await failure(new Gemini({ key: KEY, fetch: google.fetch }).uploadFile(new Uint8Array(1), { mimeType: "application/pdf", displayName: "d" }));
    expect(error).toBeInstanceOf(FilesApiError);
    expect((error as FilesApiError).reason).toBe(reason);
  }
  // An upload address that is not Google's is never sent the bytes.
  const elsewhere = fakeGemini({ startUpload: () => new Response(null, { headers: { "x-goog-upload-url": "https://attacker.example/upload" } }) });
  await expect(new Gemini({ key: KEY, fetch: elsewhere.fetch }).uploadFile(new Uint8Array(1), { mimeType: "application/pdf", displayName: "d" }))
    .rejects.toMatchObject({ reason: "REJECTED" });
  expect(elsewhere.calls).toHaveLength(1);
  await expect(new Gemini({ key: "", fetch: elsewhere.fetch }).uploadFile(new Uint8Array(1), { mimeType: "application/pdf", displayName: "d" }))
    .rejects.toMatchObject({ reason: "UNAVAILABLE" });
});

test("a request whose stored file is gone, too large, or unreadable gets its own explanation", async () => {
  const cases: [Response, RegExp][] = [
    [googleError(403, { status: "PERMISSION_DENIED", message: "You do not have permission to access the File abc123 or it may not exist." }), /copy of a course file had expired/],
    [googleError(400, { status: "INVALID_ARGUMENT", message: "The File abc123 is not in an ACTIVE state and usage is not allowed." }), /copy of a course file had expired/],
    [googleError(400, { status: "INVALID_ARGUMENT", message: "The input token count (1500000) exceeds the maximum number of tokens allowed (1048576)." }), /too large for the tutor to read at once/],
    [googleError(400, { status: "INVALID_ARGUMENT", message: "Unable to process input image. Please retry or report in https://developers.generativeai.google/guide/troubleshooting" }), /could not read one of this skill's course files/],
  ];
  for (const [response, message] of cases) {
    const { gemini } = fake(() => response.clone());
    const error = await failure(gemini().json("Rules", [{ fileData: { mimeType: "application/pdf", fileUri: "https://generativelanguage.googleapis.com/v1beta/files/abc123" } }], schema));
    expect(error.message, message.source).toMatch(message);
  }
  expect(new GeminiError("FILE_UPLOAD", "Lecture 3.pdf").message).toBe("The tutor could not receive the course file “Lecture 3.pdf”. Try again in a minute.");
  expect(new GeminiError("FILE_EXPIRED").message).toBe("The tutor's copy of a course file had expired. Try again.");
  expect(new GeminiError("TOO_LARGE").message).toBe("This skill's course files are too large for the tutor to read at once. Import the material again in smaller parts and find skills in each part, or ask the app owner for help.");
  expect(new GeminiError("FILE_UNREADABLE").message).toBe("The AI service could not read one of this skill's course files. Ask the app owner for help.");
});
