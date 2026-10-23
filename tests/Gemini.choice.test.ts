import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Gemini, GeminiError, objectSchema } from "../src/host/gemini.ts";
import { CourseTutor } from "../src/host/tutor.ts";
import { tutorGenerator, TutorFailures } from "../src/host/tutor-generation.ts";
import { checkConfiguredModel, checkModelList } from "../src/host/tutor-catalog.ts";
import { TUTOR_MODELS } from "../src/computations/tutor.ts";
import type { Material, MaterialData } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import type { TutorChoice } from "../src/tutor-types.ts";

const KEY = "test-key-not-real";
const API = "https://generativelanguage.googleapis.com/v1beta/models";
const schema = objectSchema({ answer: { type: "string" } });
const FLASH: TutorChoice = { model: "gemini-3.8-flash", level: "LOW" };
const PRO: TutorChoice = { model: "gemini-3.1-pro-preview", level: "HIGH" };
type Call = { url: string; init: RequestInit; body?: Record<string, any> };

/** A fake Google endpoint. `reply` answers each call. */
function fake(reply: (call: Call) => Response | Promise<Response> = () => answer('{"answer":"grounded"}')) {
  const calls: Call[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit = {}) => {
    const call = { url: String(input), init, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    return reply(call);
  }) as typeof globalThis.fetch;
  return { calls, gemini: (options: ConstructorParameters<typeof Gemini>[0] = {}) => new Gemini({ key: KEY, fetch, ...options }) };
}
const answer = (text: string) => Response.json({ candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] });
const googleError = (status: number, error: Record<string, unknown>) => Response.json({ error: { code: status, ...error } }, { status });
async function failure(work: Promise<unknown>) {
  const error = await work.then(() => { throw new Error("Expected a failure"); }, (problem) => problem);
  expect(String(error)).not.toContain(KEY);
  return error as Error;
}
const data: MaterialData<string, string> = { owner: "sam", scope: "course", title: "Matrices", locator: "upload:1", content: "Rows times columns.", origin: "COURSE", originals: [] };
const source = { material: "m1" as Material, data };

describe("a tutor request carries the learner's validated model and thinking level", () => {
  test("it goes to models/<model>:generateContent with the lowercase level in thinkingConfig beside the JSON schema", async () => {
    for (const entry of TUTOR_MODELS) for (const level of entry.levels) {
      const { calls, gemini } = fake();
      await new CourseTutor(gemini(), { read: async () => Buffer.from("") }).generate("sam", [source], "Explain.", {}, schema, [], { model: entry.model, level });
      const [call] = calls;
      expect(call!.url).toBe(`${API}/${entry.model}:generateContent`);
      expect(call!.url).not.toContain(KEY);
      expect(call!.init.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": KEY });
      expect(call!.body!.generationConfig).toEqual({ responseMimeType: "application/json", responseJsonSchema: schema, thinkingConfig: { thinkingLevel: level.toLowerCase() } });
    }
  });

  test("skill suggestions carry the pair too", async () => {
    const { calls, gemini } = fake(() => answer(JSON.stringify({ unitTitle: "Products", skills: [{ title: "Multiply", outcome: "Compute products.", gate: "Solve two products." }] })));
    await new CourseTutor(gemini(), { read: async () => Buffer.from("") }).suggest("sam", source, PRO);
    expect(calls[0]!.url).toBe(`${API}/gemini-3.1-pro-preview:generateContent`);
    expect(calls[0]!.body!.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "high" });
  });

  test("a tutor request or a suggestion request without a pair is refused before any file is read or Google is contacted", async () => {
    const { calls, gemini } = fake();
    const reads: string[] = [];
    const tutor = new CourseTutor(gemini(), { read: async (_owner, file) => { reads.push(file); return Buffer.from(""); } });
    for (const choice of [undefined, { model: "", level: "LOW" }, { model: "gemini-3.8-flash", level: "low" }, { model: "gemini-3.8-flash" }, null]) {
      expect((await failure(tutor.generate("sam", [source], "Explain.", {}, schema, [], choice as TutorChoice))).message).toBe("A tutor request needs a validated model and thinking level.");
      expect((await failure(tutor.suggest("sam", source, choice as TutorChoice))).message).toBe("A tutor request needs a validated model and thinking level.");
    }
    // The provider adapter that TutorGenerating calls passes the request's pair through, so a request without one is refused the same way.
    const failures = new TutorFailures(), generate = tutorGenerator(tutor, failures);
    await failure(generate("sam", { kind: "SUGGEST", sources: [source], context: {}, work: [] }));
    expect(failures.take("sam")).toBe("The tutor could not produce a usable answer. Try again. Your saved work is still available.");
    await failure(generate("sam", { kind: "LESSON", sources: [source], context: {}, work: [] }));
    expect(calls).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });
});

describe("refusals name the chosen model or level only when Google's response identifies it", () => {
  const unavailable = (name: string) => `${name} isn't available to this app right now. Choose another model in the Tutor panel and try again.`;
  const quota = (name: string) => `${name} has used up its quota for now. Choose another model in the Tutor panel, or try again later.`;
  const SETUP = "The AI service isn't set up correctly, so the tutor can't answer. Ask the app owner to check the Gemini API key.";
  const QUOTA = "The tutor has used up its AI quota or billing for now. Try again later, or ask the app owner to check the Gemini plan.";
  const BUSY = "The tutor is busy right now. Wait a minute and try again.";
  const REJECTED = "The AI service could not accept this request. Try again. If it keeps failing, use fewer or smaller course files.";
  // Response bodies follow the live probes of 2026-10-23 (.sync-engine/work/model-picker/inputs/gemini-probes.md).
  const notFound = (model: string) => googleError(404, { status: "NOT_FOUND",
    message: `models/${model} is not found for API version v1beta, or is not supported for generateContent. Call ModelService.ListModels to see the list of available models and their supported methods.` });
  const levelRefused = (level: string) => googleError(400, { status: "INVALID_ARGUMENT", message: `Thinking level ${level} is not supported for this model. Please retry with other thinking level.` });
  const dailyQuota = (model?: string) => googleError(429, { status: "RESOURCE_EXHAUSTED", message: "You exceeded your current quota, please check your plan and billing details.",
    details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests",
      quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", ...(model ? { quotaDimensions: { location: "global", model } } : {}) }] }] });
  const cases: [string, TutorChoice, () => Response, string][] = [
    ["an unknown chosen model", PRO, () => notFound("gemini-3.1-pro-preview"), unavailable("Gemini 3.1 Pro (preview)")],
    ["a 404 that names a different model", FLASH, () => notFound("gemini-9.9-nonexistent"), SETUP],
    ["a 404 that names a longer model name", FLASH, () => notFound("gemini-3.8-flash-lite"), SETUP],
    ["a permission limit that names the chosen model", PRO, () => googleError(403, { status: "PERMISSION_DENIED", message: "Permission denied on resource models/gemini-3.1-pro-preview." }), unavailable("Gemini 3.1 Pro (preview)")],
    ["a permission refusal for the project", PRO, () => googleError(403, { status: "PERMISSION_DENIED", message: "Method doesn't allow unregistered callers." }), SETUP],
    ["an invalid key, even when it names the model", PRO, () => googleError(400, { status: "INVALID_ARGUMENT", message: "API key not valid for models/gemini-3.1-pro-preview.", details: [{ reason: "API_KEY_INVALID" }] }), SETUP],
    ["a level the model refuses", { model: "gemini-3.8-flash", level: "MINIMAL" }, () => levelRefused("MINIMAL"), "Gemini 3.8 Flash doesn't accept Minimal thinking. Choose another level in the Tutor panel."],
    ["a level refusal naming another level", FLASH, () => levelRefused("MINIMAL"), REJECTED],
    ["a value that is not a level at all", FLASH, () => googleError(400, { status: "INVALID_ARGUMENT",
      message: "Invalid value at 'generation_config.thinking_config.thinking_level' (type.googleapis.com/google.ai.generativelanguage.v1beta.ThinkingConfig.ThinkingLevel), \"ultra\"" }), REJECTED],
    ["a daily quota for the chosen model", PRO, () => dailyQuota("gemini-3.1-pro-preview"), quota("Gemini 3.1 Pro (preview)")],
    ["a zero quota for the chosen model", PRO, () => googleError(429, { status: "RESOURCE_EXHAUSTED",
      message: "Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_input_token_count, limit: 0, model: gemini-3.1-pro-preview" }), quota("Gemini 3.1 Pro (preview)")],
    ["a daily quota that names no model", PRO, () => dailyQuota(), QUOTA],
    ["a daily quota for another model", FLASH, () => dailyQuota("gemini-3.1-pro-preview"), QUOTA],
    ["a per-minute limit for the chosen model", PRO, () => googleError(429, { status: "RESOURCE_EXHAUSTED", message: "Rate limit for model gemini-3.1-pro-preview. Retry in 20s." }), BUSY],
    ["billing for the whole project", PRO, () => googleError(400, { status: "FAILED_PRECONDITION", message: "Please enable billing on your project." }), QUOTA],
    ["a busy service", PRO, () => googleError(503, { status: "UNAVAILABLE", message: "The model gemini-3.1-pro-preview is overloaded." }), BUSY],
    ["a safety block", PRO, () => Response.json({ promptFeedback: { blockReason: "SAFETY" } }), "The AI service declined to answer because of its safety rules. Rephrase your request or choose different material."],
  ];
  for (const [name, choice, reply, message] of cases) {
    test(name, async () => {
      const { calls, gemini } = fake(reply);
      const error = await failure(gemini().json("Rules", [{ text: "Hi" }], schema, choice));
      expect(error).toBeInstanceOf(GeminiError);
      expect(error.message).toBe(message);
      expect(error.message).not.toMatch(/not found for API|Permission denied|Quota exceeded|Invalid value|Rate limit|overloaded/);
      expect(calls).toHaveLength(1);
    });
  }

  test("a slow tutor request suggests a lower thinking level", async () => {
    const slow = fake(({ init }) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    expect((await failure(slow.gemini({ timeoutMs: 30 }).json("Rules", [{ text: "Hi" }], schema, PRO))).message)
      .toBe("The tutor took too long to answer. Try again with a shorter request, less material, or a lower thinking level.");
  });
});

describe("dictation keeps the configured model and its current sentences", () => {
  const recording = () => new File([new Uint8Array([26, 69, 223, 163])], "answer.webm", { type: "audio/webm" });
  test("it sends to the configured model with no thinking level", async () => {
    const { calls, gemini } = fake(() => answer('{"text":"x² + 3"}'));
    expect(await gemini({ model: "models/gemini-dictation-model" }).transcribe(recording())).toEqual({ text: "x² + 3" });
    expect(calls[0]!.url).toBe(`${API}/gemini-dictation-model:generateContent`);
    expect(calls[0]!.body!.generationConfig).not.toHaveProperty("thinkingConfig");
  });

  test("a dictation timeout gives no thinking-level advice, and a model problem is a setup problem", async () => {
    const slow = fake(({ init }) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    expect((await failure(slow.gemini({ timeoutMs: 30 }).transcribe(recording()))).message)
      .toBe("The tutor took too long to answer. Try again with a shorter request or less material.");
    const missing = fake(() => googleError(404, { status: "NOT_FOUND", message: "models/gemini-dictation-model is not found for API version v1beta." }));
    expect((await failure(missing.gemini({ model: "gemini-dictation-model" }).transcribe(recording()))).message)
      .toBe("The AI service isn't set up correctly, so the tutor can't answer. Ask the app owner to check the Gemini API key.");
    const quota = fake(() => googleError(429, { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for metric: x, limit: 0, model: gemini-dictation-model" }));
    expect((await failure(quota.gemini({ model: "gemini-dictation-model" }).transcribe(recording()))).message)
      .toBe("The tutor has used up its AI quota or billing for now. Try again later, or ask the app owner to check the Gemini plan.");
  });
});

describe("startup checks", () => {
  test("GEMINI_MODEL must be unset or an offered model, matched exactly after trimming and removing models/", () => {
    for (const [value, model] of [[undefined, "gemini-3.8-flash"], ["", "gemini-3.8-flash"], ["  ", "gemini-3.8-flash"], ["gemini-3.8-flash", "gemini-3.8-flash"],
      ["models/gemini-3.1-pro-preview", "gemini-3.1-pro-preview"], [" gemini-3.5-flash-lite ", "gemini-3.5-flash-lite"]] as const) {
      expect(checkConfiguredModel(value), String(value)).toEqual({ ok: true, model });
    }
    for (const value of ["gemini-9.9-nonexistent", "GEMINI-3.8-FLASH", "gemini-3.8"]) {
      const result = checkConfiguredModel(value);
      expect(result.ok, value).toBe(false);
      const message = (result as { message: string }).message;
      expect(message).toContain(JSON.stringify(value));
      for (const entry of TUTOR_MODELS) expect(message).toContain(entry.model);
      expect(message).not.toContain("\n");
    }
  });

  test("the server stops before connecting or listening when GEMINI_MODEL names a model outside the table", async () => {
    const root = resolve(import.meta.dir, "..");
    const child = Bun.spawn(["bun", resolve(root, "src/main.ts")], { cwd: root, stdout: "pipe", stderr: "pipe",
      env: { ...process.env, GEMINI_MODEL: "gemini-9.9-nonexistent", GEMINI_API_KEY: "", PORT: "0", MONGODB_URI: "mongodb://127.0.0.1:9/never-used" } });
    const timer = setTimeout(() => child.kill(), 10_000);
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    clearTimeout(timer);
    expect(code).toBe(1);
    expect(stderr.trim()).toBe((checkConfiguredModel("gemini-9.9-nonexistent") as { message: string }).message);
    expect(stdout).not.toContain("ready");
  }, 15_000);

  const listed = (...models: [string, string[]?][]) => () => Response.json({ models: models.map(([name, methods = ["generateContent", "countTokens"]]) =>
    ({ name: `models/${name}`, supportedGenerationMethods: methods })) });
  const log = () => { const lines: string[] = []; return { lines, log: { log: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) } }; };

  test("the model-list check withdraws a missing or non-generating model, reads one page with the key in a header, and never withdraws the default", async () => {
    const { calls, gemini } = fake(listed(["gemini-3.5-flash-lite"], ["gemini-3.8-flash"], ["gemini-2.0-embedding", ["embedContent"]]));
    const output = log();
    expect(await checkModelList({ gemini: gemini(), defaultModel: "gemini-3.8-flash", log: output.log })).toEqual(["gemini-3.1-pro-preview"]);
    expect(calls[0]!.url).toBe(`${API}?pageSize=200`);
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.headers).toEqual({ "x-goog-api-key": KEY });
    expect(output.lines).toEqual(["Tutor models withdrawn because Gemini's model list lacks them: gemini-3.1-pro-preview."]);

    const noGenerate = fake(listed(["gemini-3.5-flash-lite"], ["gemini-3.8-flash"], ["gemini-3.1-pro-preview", ["countTokens"]]));
    expect(await checkModelList({ gemini: noGenerate.gemini(), defaultModel: "gemini-3.8-flash", log: log().log })).toEqual(["gemini-3.1-pro-preview"]);

    // A list without the default keeps it offered and warns; requests that use it meet the provider refusal.
    const noDefault = fake(listed(["gemini-3.5-flash-lite"], ["gemini-3.1-pro-preview"])), warned = log();
    expect(await checkModelList({ gemini: noDefault.gemini(), defaultModel: "gemini-3.8-flash", log: warned.log })).toEqual([]);
    expect(warned.lines).toEqual([expect.stringContaining("lacks the default tutor model gemini-3.8-flash")]);
  });

  test("a failed, slow, malformed, or incomplete list withdraws nothing, and without a key the list is not read", async () => {
    const replies: [string, (call: Call) => Response | Promise<Response>][] = [
      ["failed", () => googleError(500, { status: "INTERNAL", message: "Internal error." })],
      ["denied", () => googleError(403, { status: "PERMISSION_DENIED", message: "Denied." })],
      ["slow", ({ init }) => new Promise<Response>((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason)))],
      ["unreachable", () => { throw new TypeError("fetch failed"); }],
      ["not JSON", () => new Response("<html>gateway</html>", { status: 200 })],
      ["no list", () => Response.json({})],
      ["entry without a name", () => Response.json({ models: [{ supportedGenerationMethods: ["generateContent"] }] })],
      ["entry without methods", () => Response.json({ models: [{ name: "models/gemini-3.8-flash" }] })],
      ["more pages", () => Response.json({ models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }], nextPageToken: "next" })],
    ];
    for (const [name, reply] of replies) {
      const { calls, gemini } = fake(reply), output = log();
      const started = performance.now();
      expect(await checkModelList({ gemini: gemini(), defaultModel: "gemini-3.8-flash", timeoutMs: 30, log: output.log }), name).toEqual([]);
      expect(performance.now() - started, name).toBeLessThan(2000);
      expect(calls, name).toHaveLength(1);
      expect(output.lines, name).toEqual(["Gemini's model list could not be read completely at startup, so every tutor model stays offered."]);
    }
    const { calls, gemini } = fake(listed());
    expect(await checkModelList({ gemini: gemini({ key: "" }), defaultModel: "gemini-3.8-flash", log: log().log })).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  test("a withdrawn model leaves the offer for this server process, a saved choice of it becomes RETIRED, and the default stays", () => {
    // A separate process, because the catalog can be fixed only once per process.
    const script = `const T = await import(${JSON.stringify(resolve(import.meta.dir, "../src/computations/tutor.ts"))});
      T.withdrawTutorModels(["gemini-3.1-pro-preview", "gemini-3.8-flash"]);
      let fixed = false; try { T.withdrawTutorModels([]); } catch { fixed = true; }
      console.log(JSON.stringify({ models: T.tutorCatalog({}).map((entry) => entry.model), pro: T.modelOffered({ model: "gemini-3.1-pro-preview" }),
        saved: T.choiceOffered({ choice: { model: "gemini-3.1-pro-preview", level: "HIGH" } }), fallback: T.defaultChoice({}), fixed }));`;
    const result = Bun.spawnSync(["bun", "-e", script], { cwd: resolve(import.meta.dir, ".."), env: { ...process.env, GEMINI_MODEL: "" } });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout.toString())).toEqual({ models: ["gemini-3.5-flash-lite", "gemini-3.8-flash"], pro: false, saved: false,
      fallback: { model: "gemini-3.8-flash", level: "MEDIUM" }, fixed: true });
  });
});
