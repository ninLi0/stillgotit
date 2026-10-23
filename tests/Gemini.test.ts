import { expect, test } from "bun:test";
import { DEFAULT_MODEL, Gemini, GeminiError, objectSchema } from "../src/host/gemini.ts";
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

test("the tutor sends source text, original PDFs and images inline, and text only for large PDFs", async () => {
  const { calls, gemini } = fake(() => answer('{"explanation":"Rows meet columns.","citations":[]}'));
  const stored: Record<string, Buffer> = {
    "lesson.pdf": Buffer.from("%PDF-1.7 small"), "page.png": Buffer.from("png-bytes"),
    "photo.jpg": Buffer.from("jpeg-bytes"), "huge.pdf": Buffer.alloc(15 * 1024 * 1024 + 1, 1), "work.png": Buffer.from("work-bytes"),
  };
  const reads: string[] = [];
  const tutor = new CourseTutor(gemini(), { read: async (owner, file) => { expect(owner).toBe("sam"); reads.push(file); return stored[file]!; } });
  const data: MaterialData<string, string> = { owner: "sam", scope: "course", title: "Matrices", locator: "upload:1", content: "Rows times columns.", origin: "COURSE", originals: [
    { file: "lesson.pdf", name: "Lesson.pdf", mediaType: "application/pdf", limitations: [],
      renditions: [{ kind: "TEXT", location: "Lesson.pdf/page/1", text: "Rows times columns." }, { kind: "IMAGE", location: "Lesson.pdf/figure/1", file: "page.png", mediaType: "image/png" }] },
    { file: "photo.jpg", name: "Board.jpg", mediaType: "image/jpeg", limitations: [], renditions: [] },
    { file: "huge.pdf", name: "Huge.pdf", mediaType: "application/pdf", limitations: ["Page 9 had no text."], renditions: [{ kind: "TEXT", location: "Huge.pdf/page/1", text: "Long notes." }] },
  ] };
  const work = [{ file: "work.png", name: "My work.png", mediaType: "image/png", limitations: [], renditions: [] }];
  await tutor.generate("sam", [{ material: "m1" as Material, data }], "Explain.", { request: "Teach me" }, schema, work, { model: DEFAULT_MODEL, level: "MEDIUM" });
  const { systemInstruction, contents: [{ parts }] } = calls[0]!.body;
  expect(systemInstruction.parts[0].text).toContain("careful course tutor");
  expect(systemInstruction.parts[0].text).toEndWith("Explain.");
  const source = JSON.parse(parts[0].text);
  expect(source).toMatchObject({ material: "m1", title: "Matrices", content: "Rows times columns." });
  expect(source.sources[2].limitations).toEqual(["Page 9 had no text.", expect.stringContaining("larger than 15 MB, so only its extracted text was sent")]);
  expect(source.sources[2].limitations[1]).toContain("visuals were left out");
  const inline = parts.filter((part: { inlineData?: unknown }) => part.inlineData).map((part: { inlineData: { mimeType: string; data: string } }) => part.inlineData);
  expect(inline).toEqual([
    { mimeType: "application/pdf", data: stored["lesson.pdf"]!.toString("base64") },
    { mimeType: "image/png", data: stored["page.png"]!.toString("base64") },
    { mimeType: "image/jpeg", data: stored["photo.jpg"]!.toString("base64") },
    { mimeType: "image/png", data: stored["work.png"]!.toString("base64") },
  ]);
  expect(parts.some((part: { text?: string }) => part.text?.includes("the original PDF Lesson.pdf"))).toBe(true);
  expect(parts.some((part: { text?: string }) => part.text?.includes("Huge.pdf") && !part.text.startsWith("{"))).toBe(false);
  expect(parts.at(-1)).toEqual({ text: JSON.stringify({ request: "Teach me" }) });
  expect(reads.sort()).toEqual(["huge.pdf", "lesson.pdf", "page.png", "photo.jpg", "work.png"]);
  await expect(tutor.generate("leo", [{ material: "m1" as Material, data }], "Explain.", {}, schema, [], { model: DEFAULT_MODEL, level: "MEDIUM" })).rejects.toThrow("Choose one of your materials.");
});
