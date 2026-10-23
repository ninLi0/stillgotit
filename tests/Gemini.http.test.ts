import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { Gemini } from "../src/host/gemini.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { SESSION_COOKIE } from "../src/host/http-policy.ts";
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

/** The real tutor and HTTP host, with Google's endpoint replaced by `reply`. */
async function setup(key = "test-key-not-real") {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), requests: Record<string, any>[] = [], urls: string[] = [];
  let reply: () => Response = () => Response.json({});
  const fetch = (async (url: unknown, init: RequestInit) => { urls.push(String(url)); requests.push(JSON.parse(String(init.body))); return reply(); }) as typeof globalThis.fetch;
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, gemini: new Gemini({ key, fetch }) });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });
  const jar = new Map<string, string>();
  async function post(path: string, body: Record<string, unknown> | FormData = {}) {
    const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
      Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      body: body instanceof FormData ? body : JSON.stringify(body) }));
    for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
    return { status: response.status, body: await response.json() };
  }
  // Start a session directly. Commons sign-in has its own tests and needs a replica set for its transaction.
  const user = crypto.randomUUID() as User, signedIn = await runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in signedIn) throw new Error("Test session was refused");
  jar.set(SESSION_COOKIE, signedIn.session);
  const { body: { course } } = await post("/courses/create", { title: "Linear algebra" });
  const { material } = await runtime.application.concepts.GroundedTutoring.addMaterial({ owner: user, importKey: crypto.randomUUID(), scope: course,
    title: "Matrix multiplication", locator: "upload:test", content: "Multiply rows by columns. Inner dimensions must match.", originals: [], origin: "COURSE" });
  return { runtime, post, material, requests, urls, respond: (next: () => Response) => { reply = next; } };
}
const answer = (value: unknown) => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] }, finishReason: "STOP" }] });

test("AI status, explained generation failures, and recovery through HTTP", async () => {
  const app = await setup();
  expect(await app.post("/ai/status")).toEqual({ status: 200, body: { available: true, reason: "" } });
  app.respond(() => Response.json({ error: { code: 429, status: "RESOURCE_EXHAUSTED", message: "Resource has been exhausted." } }, { status: 429 }));
  const busy = await app.post("/courses/skills/suggest", { material: app.material });
  expect(busy.status).toBe(400);
  expect(busy.body).toEqual({ error: "INVALID_REQUEST", detail: "The tutor is busy right now. Wait a minute and try again. Your saved work is still available." });
  // An admission refusal keeps its own explanation and never repeats an older provider failure.
  expect((await app.post("/courses/skills/suggest", { material: "missing" })).body).toEqual({ error: "INVALID_REQUEST", detail: "Choose a source from your own course." });
  app.respond(() => answer({ unitTitle: "Products", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products and explain why order matters." }] }));
  const suggested = await app.post("/courses/skills/suggest", { material: app.material });
  expect(suggested).toMatchObject({ status: 200, body: { suggestions: { unitTitle: "Products", skills: [{ title: "Multiply matrices" }] } } });
  expect(JSON.parse(app.requests.at(-1)!.contents[0].parts[0].text)).toMatchObject({ material: app.material, content: expect.stringContaining("rows by columns") });
  app.respond(() => answer({ unitTitle: "Products", skills: [] }));
  expect((await app.post("/courses/skills/suggest", { material: app.material })).body.detail).toBe("The tutor could not produce a usable answer. Try again. Your saved work is still available.");
  expect((await app.post("/ai/connect/start")).status).toBe(404);
  const callback = await app.runtime.handle(new Request(`${ORIGIN}/auth/chatgpt/return?state=x&code=y`));
  expect(callback.status).toBe(405);
}, 15_000);

test("dictation goes to Gemini and reports provider problems in plain words", async () => {
  const app = await setup();
  const form = () => { const data = new FormData(); data.append("recording", new File([new Uint8Array([1, 2, 3])], "answer.webm", { type: "audio/webm;codecs=opus" })); return data; };
  app.respond(() => answer({ text: "x² + 3" }));
  expect(await app.post("/learning/transcribe", form())).toEqual({ status: 200, body: { text: "x² + 3" } });
  expect(app.requests.at(-1)!.contents[0].parts[0].inlineData.mimeType).toBe("audio/webm");
  app.respond(() => Response.json({ error: { code: 403, status: "PERMISSION_DENIED", message: "Permission denied." } }, { status: 403 }));
  const denied = await app.post("/learning/transcribe", form());
  expect(denied).toMatchObject({ status: 400, body: { detail: expect.stringContaining("isn't set up correctly") } });
  expect(JSON.stringify(denied.body)).not.toContain("test-key-not-real");
}, 15_000);

test("without a Gemini key the status explains why and AI requests fail without a provider call", async () => {
  const app = await setup("");
  expect(await app.post("/ai/status")).toEqual({ status: 200, body: { available: false, reason: "The AI tutor is not set up on this server. Ask the app owner to add a Gemini API key." } });
  const refused = await app.post("/courses/skills/suggest", { material: app.material });
  expect(refused).toMatchObject({ status: 400, body: { detail: expect.stringContaining("not set up on this server") } });
  expect(app.requests).toHaveLength(0);
}, 15_000);

test("a tutor request reaches Google with the learner's choice, and a refusal naming that model sends the learner to the Tutor panel", async () => {
  const app = await setup();
  const suggestions = { unitTitle: "Products", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products and explain why order matters." }] };
  expect((await app.post("/settings/tutor/choose", { model: "gemini-3.1-pro-preview", level: "LOW" })).body.settings.status).toBe("SAVED");
  app.respond(() => answer(suggestions));
  expect(await app.post("/courses/skills/suggest", { material: app.material })).toEqual({ status: 200,
    body: { suggestions, tutor: { model: "gemini-3.1-pro-preview", level: "LOW" } } });
  expect(app.urls.at(-1)).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent");
  expect(app.requests.at(-1)!.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });

  // The 404 Google returns for a model it cannot find names that model (live probe, 2026-10-23).
  app.respond(() => Response.json({ error: { code: 404, status: "NOT_FOUND", message: "models/gemini-3.1-pro-preview is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods." } }, { status: 404 }));
  expect((await app.post("/courses/skills/suggest", { material: app.material })).body).toEqual({ error: "INVALID_REQUEST",
    detail: "Gemini 3.1 Pro (preview) isn't available to this app right now. Choose another model in the Tutor panel and try again. Your saved work is still available." });
  // A refusal about the key keeps the setup sentence, and an unclear refusal keeps the current sentence. The server never retries another model.
  app.respond(() => Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "API key not valid. Please pass a valid API key.", details: [{ reason: "API_KEY_INVALID" }] } }, { status: 400 }));
  expect((await app.post("/courses/skills/suggest", { material: app.material })).body.detail).toBe("The AI service isn't set up correctly, so the tutor can't answer. Ask the app owner to check the Gemini API key. Your saved work is still available.");
  app.respond(() => Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Request contains an invalid argument." } }, { status: 400 }));
  expect((await app.post("/courses/skills/suggest", { material: app.material })).body.detail).toBe("The AI service could not accept this request. Try again. If it keeps failing, use fewer or smaller course files. Your saved work is still available.");
  expect(app.urls.filter((url) => !url.includes("gemini-3.1-pro-preview"))).toEqual([]);

  // After choosing another model, the next request uses it.
  await app.post("/settings/tutor/choose", { model: "gemini-3.5-flash-lite", level: "MINIMAL" });
  app.respond(() => answer(suggestions));
  expect((await app.post("/courses/skills/suggest", { material: app.material })).body.tutor).toEqual({ model: "gemini-3.5-flash-lite", level: "MINIMAL" });
  expect(app.urls.at(-1)).toEndWith("/models/gemini-3.5-flash-lite:generateContent");
  expect(app.requests.at(-1)!.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "minimal" });
}, 15_000);
