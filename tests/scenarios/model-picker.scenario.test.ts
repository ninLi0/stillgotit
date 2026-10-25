import { afterAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { createRuntime } from "../../src/host/runtime.ts";
import { Gemini } from "../../src/host/gemini.ts";
import { MemoryProvider } from "../../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";
import { SESSION_COOKIE } from "../../src/host/http-policy.ts";
import { configuredModelName } from "../../src/computations/tutor.ts";
import type { User } from "../../src/concepts/Registering/Registering.ts";
import type { TutorChoice, TutorModelOffer } from "../../src/tutor-types.ts";

// The model-picker journey, end to end through the HTTP host: two learners, the real tutor, and the real Gemini
// transport, with Google's endpoint replaced by a fake fetch. The tests run in order and share one database, because
// each step starts from the state the one before it left. Each test is named after the brief sentence it proves.

const ORIGIN = "http://localhost:5173", KEY = "test-key-not-real", ROOT = resolve(import.meta.dir, "../..");
const GOOGLE = "https://generativelanguage.googleapis.com/v1beta/models";

// The design's sentences (design/compositions/Settings.md).
const UNKNOWN_MODEL = "That model isn't offered. Choose one of the models in the Tutor panel.";
const UNSUPPORTED_LEVEL = "That model doesn't offer this thinking level. Choose one of the levels shown for it.";
const NO_LONGER_OFFERED = "The tutor model or thinking level you chose is no longer offered. Choose another one in the Tutor panel.";
// Sessioning's sentence for NOT_SIGNED_IN, which reaches the browser as the refusal's `detail`.
const SIGNED_OUT = "Your session has ended. Sign in again.";

// The catalog table from design/compositions/Settings.md, "The model catalog". The expected records are built from
// this table, not from the implementation's own catalog.
const TABLE: Omit<TutorModelOffer, "appDefault">[] = [
  { model: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", description: "The fastest and lowest-cost model offered.",
    levels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultLevel: "MINIMAL", slowLevels: [],
    tradeoff: "It answers quickly but can miss detail in long or difficult material." },
  { model: "gemini-3.8-flash", name: "Gemini 3.8 Flash", description: "A fast general model for lessons, practice, and feedback.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "MEDIUM", slowLevels: [],
    tradeoff: "It balances speed, cost, and care; raise the level for harder problems." },
  { model: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (preview)", description: "The most careful model offered, for difficult material and grading.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "HIGH", slowLevels: ["HIGH"],
    tradeoff: "It is slower and costs more, and as a preview Google may change or withdraw it." },
];
type Status = "SAVED" | "RETIRED" | "DEFAULT";
/** The offered models in table order, with the entry that GEMINI_MODEL names marked as the app default. */
const catalog = (configured: string, offered = TABLE) => offered.map((entry) => ({ ...entry, appDefault: entry.model === configured }));
/** The default model at that model's own default level. */
const defaultFor = (configured: string): TutorChoice => ({ model: configured, level: TABLE.find((entry) => entry.model === configured)!.defaultLevel });
// This test process reads GEMINI_MODEL like the server does; it is unset unless the environment sets it.
const CONFIGURED = configuredModelName(process.env.GEMINI_MODEL), DEFAULT = defaultFor(CONFIGURED);
/** The TutorSettings record every settings endpoint answers with, on this server. */
const record = (choice: TutorChoice, status: Status) => ({ settings: { models: catalog(CONFIGURED), choice, status, defaultChoice: DEFAULT } });

const PRO_LOW: TutorChoice = { model: "gemini-3.1-pro-preview", level: "LOW" }; // Maya's choice
const LITE_HIGH: TutorChoice = { model: "gemini-3.5-flash-lite", level: "HIGH" }; // Sam's choice
const FLASH_HIGH: TutorChoice = { model: "gemini-3.8-flash", level: "HIGH" }; // Maya's choice after Pro leaves the catalog
const LESSON_TEXT = "Match each row of the first matrix with a column of the second, then add the products.";

type GoogleCall = { url: string; method: string; headers: Record<string, string>; body: Record<string, any> };

/** Google's generateContent endpoint, faked. It answers a lesson request with a lesson that cites the material it was sent. */
function fakeGoogle() {
  const calls: GoogleCall[] = [];
  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit = {}) => {
    const call: GoogleCall = { url: String(input), method: init.method ?? "GET", headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : {} };
    calls.push(call);
    if (!call.body.generationConfig?.responseJsonSchema?.properties?.explanation) {
      return Response.json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "This fake answers lesson requests only." } }, { status: 400 });
    }
    const { material } = JSON.parse(call.body.contents[0].parts[0].text) as { material: string };
    const lesson = { explanation: LESSON_TEXT, citations: [{ material, location: "content" }] };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(lesson) }] }, finishReason: "STOP" }] });
  }) as typeof globalThis.fetch;
  return { calls, gemini: new Gemini({ key: KEY, fetch }) };
}

const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

/** One server, two learners with one confirmed skill each, and Sam's own saved choice. Built once and shared in order. */
async function startJourney() {
  const database = `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database });
  const google = fakeGoogle();
  const runtime = await createRuntime({ database: connection.db, provider: new MemoryProvider(), providerOrigin: "https://commons.example",
    publicOrigin: ORIGIN, gemini: google.gemini });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });

  /** A browser with its own session for `user`. Two browsers for one user stand in for two devices. */
  async function browser(user: User) {
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in signedIn) throw new Error("Test session was refused");
    const request = (path: string, body: object, withSession: boolean) => new Request(`${ORIGIN}/api${path}`, { method: "POST", body: JSON.stringify(body),
      headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(withSession ? { Cookie: `${SESSION_COOKIE}=${signedIn.session}` } : {}) } });
    async function post(path: string, body: object = {}, withSession = true) {
      const response = await runtime.handle(request(path, body, withSession));
      return { status: response.status, body: await response.json() };
    }
    async function ok(path: string, body: object = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    /** Sends a request and drops the reply unread, as when the connection breaks after the server has answered. */
    async function loseReply(path: string, body: object = {}) {
      const response = await runtime.handle(request(path, body, true));
      await response.body?.cancel();
    }
    return { user, session: signedIn.session, post, ok, loseReply };
  }

  /** A learner with one course source and one confirmed skill, signed in on a laptop and a phone. */
  async function learner() {
    const user = crypto.randomUUID() as User, laptop = await browser(user);
    const { course } = await laptop.ok("/courses/create", { title: "Linear algebra" });
    const { material } = await runtime.application.concepts.Library.add({ owner: user, importKey: crypto.randomUUID(), scope: course,
      title: "Matrix multiplication", locator: "upload:test", content: "Multiply rows by columns. Inner dimensions must match.", originals: [], origin: "COURSE" });
    const { unit } = await laptop.ok("/courses/units/add", { course, title: "Products" });
    const { skill } = await laptop.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products",
      outcome: "Multiply matrices", gate: "Two products and why" });
    await laptop.ok("/courses/skills/confirm", { skill });
    await laptop.ok("/learning/confidence", { skill, confidence: 50 });
    return { ...laptop, skill: skill as string, material: material as string, phone: await browser(user) };
  }

  const maya = await learner(), sam = await learner();
  expect(await sam.ok("/settings/tutor/choose", LITE_HIGH)).toEqual(record(LITE_HIGH, "SAVED"));

  /** Asks for a lesson and returns the reply with the Google calls it caused. */
  async function lesson(who: typeof maya, extra: Record<string, unknown> = {}) {
    const before = google.calls.length;
    const reply = await who.post("/learning/lesson", { skill: who.skill, request: "Explain matrix products.", ...extra });
    return { reply, sent: google.calls.slice(before) };
  }
  /** What Sam's settings show after one of Maya's changes. */
  const samSaw: { after: string; seen: unknown }[] = [];
  async function samLooks(after: string) { samSaw.push({ after, seen: await sam.ok("/settings/tutor") }); }
  await samLooks("Sam chose Flash-Lite at High");
  return { database, runtime, google, maya, sam, lesson, samSaw, samLooks, preferring: runtime.application.concepts.TutorPreferring };
}
let started: ReturnType<typeof startJourney> | undefined;
const journey = () => (started ??= startJourney());

/** The model and level a Google call carried: the model from the address, the level from generationConfig.thinkingConfig. */
const carried = (call: GoogleCall) => [call.url, call.body.generationConfig?.thinkingConfig];
const address = (model: string) => `${GOOGLE}/${model}:generateContent`;

/**
 * Stands in for a server restart: a new server process on the same database, because the catalog is fixed once per
 * process. The first server stays idle meanwhile, so it changes nothing during the restart.
 * At startup it does what src/main.ts does: it reads Gemini's model list (faked to list only `listed`), withdraws the
 * offered models the list lacks, and fixes the catalog. Then it sends Maya's and Sam's requests below and prints the replies.
 * GEMINI_MODEL is unset in that process, so its default is gemini-3.8-flash at Medium.
 */
async function restartServer(input: { database: string; listed: string[]; maya: { session: string; skill: string }; sam: { session: string }; again: TutorChoice }) {
  const script = `
    const input = ${JSON.stringify({ ...input, origin: ORIGIN, key: KEY, lesson: LESSON_TEXT })};
    const at = (path) => ${JSON.stringify(ROOT)} + "/" + path;
    const { connectMongo, localMongoUri } = await import(at("src/storage/mongo.ts"));
    const { createRuntime } = await import(at("src/host/runtime.ts"));
    const { Gemini } = await import(at("src/host/gemini.ts"));
    const { MemoryProvider } = await import(at("src/concepts/Federating/provider.ts"));
    const { SESSION_COOKIE } = await import(at("src/host/http-policy.ts"));
    const { checkModelList } = await import(at("src/host/tutor-catalog.ts"));
    const { configuredModelName, withdrawTutorModels } = await import(at("src/computations/tutor.ts"));
    const calls = [], logs = [];
    const fetch = async (url, init = {}) => {
      const call = { url: String(url), method: init.method ?? "GET", headers: init.headers, body: init.body ? JSON.parse(String(init.body)) : {} };
      calls.push(call);
      if (call.url.endsWith("?pageSize=200")) {
        return Response.json({ models: input.listed.map((name) => ({ name: "models/" + name, supportedGenerationMethods: ["generateContent", "countTokens"] })) });
      }
      const { material } = JSON.parse(call.body.contents[0].parts[0].text);
      const lesson = { explanation: input.lesson, citations: [{ material, location: "content" }] };
      return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(lesson) }] }, finishReason: "STOP" }] });
    };
    const gemini = new Gemini({ key: input.key, fetch });
    const log = { log: (line) => logs.push(line), warn: (line) => logs.push(line) };
    withdrawTutorModels(await checkModelList({ gemini, defaultModel: configuredModelName(process.env.GEMINI_MODEL), log }));
    const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: input.database });
    const runtime = await createRuntime({ database: connection.db, provider: new MemoryProvider(), providerOrigin: "https://commons.example", publicOrigin: input.origin, gemini });
    const post = async (session, path, body = {}) => {
      const response = await runtime.handle(new Request(input.origin + "/api" + path, { method: "POST", body: JSON.stringify(body),
        headers: { Origin: input.origin, "Content-Type": "application/json", Cookie: SESSION_COOKIE + "=" + session } }));
      return { status: response.status, body: await response.json() };
    };
    const generated = () => calls.filter((call) => call.url.endsWith(":generateContent")).map((call) => [call.url, call.body.generationConfig.thinkingConfig]);
    // Saved records only: the mastery estimate itself changes with elapsed time.
    const study = async () => {
      const { data } = (await post(input.maya.session, "/learning/read", { skill: input.maya.skill })).body;
      return JSON.stringify({ sessions: data.sessions, cases: data.cases, inputs: data.track.inputs });
    };
    const out = { logs, list: calls.map((call) => ({ url: call.url, method: call.method, headers: call.headers })) };
    out.retired = await post(input.maya.session, "/settings/tutor");
    const before = await study();
    out.declined = await post(input.maya.session, "/learning/lesson", { skill: input.maya.skill, request: "Explain matrix products." });
    out.studyUnchanged = (await study()) === before;
    out.sentWhileRetired = generated();
    out.samSees = await post(input.sam.session, "/settings/tutor");
    out.chosen = await post(input.maya.session, "/settings/tutor/choose", input.again);
    out.lesson = await post(input.maya.session, "/learning/lesson", { skill: input.maya.skill, request: "Explain matrix products." });
    out.sent = generated();
    await runtime.gateway.beginDrain();
    await connection.client.close();
    console.log("SCENARIO_RESULT " + JSON.stringify(out));
  `;
  // No real key reaches the restarted server, and every Gemini call it makes goes to the fake above.
  const child = Bun.spawn(["bun", "-e", script], { cwd: ROOT, stdout: "pipe", stderr: "pipe", env: { ...process.env, GEMINI_MODEL: "", GEMINI_API_KEY: "" } });
  const timer = setTimeout(() => child.kill(), 40_000);
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  clearTimeout(timer);
  const line = stdout.split("\n").find((text) => text.startsWith("SCENARIO_RESULT "));
  if (code !== 0 || !line) throw new Error(`The restarted server failed with exit code ${code}: ${stderr.slice(-2000)}`);
  return JSON.parse(line.slice("SCENARIO_RESULT ".length));
}

describe("model-picker: one learner's journey through HTTP, a second learner beside them, and Google replaced by a fake fetch", () => {
  test("The model catalog: which models the app offers and which levels each supports, with a one-line description and the trade-off.", async () => {
    const { maya } = await journey();
    const { settings } = await maya.ok("/settings/tutor");
    // Every offered model, in table order, with its shown name, description, levels, default level, slow levels, and trade-off.
    expect(settings.models).toEqual(catalog(CONFIGURED));
    expect(settings.models.filter((entry: TutorModelOffer) => entry.appDefault).map((entry: TutorModelOffer) => entry.model)).toEqual([CONFIGURED]);
  }, 30_000);

  test("The default when the learner has chosen nothing is the server's configured model at its default level.", async () => {
    const { maya, lesson } = await journey();
    expect(await maya.ok("/settings/tutor")).toEqual(record(DEFAULT, "DEFAULT"));
    expect(await maya.phone.ok("/settings/tutor")).toEqual(record(DEFAULT, "DEFAULT"));
    // A lesson asked with nothing chosen goes to the default model at its default level.
    const { reply, sent } = await lesson(maya);
    expect(reply).toEqual({ status: 200, body: { lesson: expect.any(String), tutor: DEFAULT } });
    expect(sent.map(carried)).toEqual([[address(DEFAULT.model), { thinkingLevel: DEFAULT.level.toLowerCase() }]]);
  }, 30_000);

  test("Every tutor request reads the learner's choice on the server and sends the model and the thinking level in the request.", async () => {
    const { maya, lesson, samLooks } = await journey();
    expect(await maya.ok("/settings/tutor/choose", PRO_LOW)).toEqual(record(PRO_LOW, "SAVED"));
    await samLooks("Maya chose Pro at Low");
    const { reply, sent } = await lesson(maya);
    expect(reply.status).toBe(200);
    expect(sent).toHaveLength(1);
    const [call] = sent;
    // The chosen model is in the address, the key only in a header, and the level, in lowercase, in thinkingConfig beside the JSON schema.
    expect(call!.url).toBe(address("gemini-3.1-pro-preview"));
    expect(call!.url).not.toContain(KEY);
    expect(call!.method).toBe("POST");
    expect(call!.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": KEY });
    expect(call!.body.generationConfig).toEqual({ responseMimeType: "application/json",
      responseJsonSchema: expect.objectContaining({ properties: expect.objectContaining({ explanation: { type: "string" } }) }), thinkingConfig: { thinkingLevel: "low" } });
    // The request carries the learner's own material.
    expect(JSON.parse(call!.body.contents[0].parts[0].text)).toMatchObject({ material: maya.material, content: expect.stringContaining("rows by columns") });
  }, 30_000);

  test("Each answer carries which model and level produced it, shown beside the answer where that is cheap (the lesson, the assessment, the suggestions).", async () => {
    const { maya, lesson } = await journey();
    const { reply, sent } = await lesson(maya);
    // The answer names the pair that Google was asked with, which is the learner's saved choice.
    expect(reply).toEqual({ status: 200, body: { lesson: expect.any(String), tutor: PRO_LOW } });
    expect(sent.map(carried)).toEqual([[address(reply.body.tutor.model), { thinkingLevel: reply.body.tutor.level.toLowerCase() }]]);
    // The lesson it labels is the one saved for the learner, with the text Google wrote.
    const { data } = await maya.ok("/learning/read", { skill: maya.skill });
    const saved = data.sessions.find((session: { session: string }) => session.session === reply.body.lesson);
    expect(JSON.stringify(saved)).toContain(LESSON_TEXT);
  }, 30_000);

  test("No request trusts a model name or level from the browser without validating it against the catalog on the server.", async () => {
    const { maya, google, lesson, samLooks } = await journey();
    const calls = google.calls.length;
    // A model the catalog does not list is refused with the design's sentence, matched exactly including case.
    for (const model of ["gemini-9.9-nonexistent", "GEMINI-3.1-PRO-PREVIEW", "models/gemini-3.1-pro-preview"]) {
      expect(await maya.post("/settings/tutor/choose", { model, level: "LOW" }), model).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: UNKNOWN_MODEL } });
    }
    // The refusals saved nothing: both devices still show the earlier choice, and Google was not asked.
    expect(await maya.ok("/settings/tutor")).toEqual(record(PRO_LOW, "SAVED"));
    expect(await maya.phone.ok("/settings/tutor")).toEqual(record(PRO_LOW, "SAVED"));
    expect(google.calls).toHaveLength(calls);
    await samLooks("Maya's unknown model was refused");
    // A tutor request that names its own model and level still goes to the learner's saved pair.
    const { reply, sent } = await lesson(maya, { model: "gemini-9.9-nonexistent", level: "ULTRA" });
    expect(reply).toEqual({ status: 200, body: { lesson: expect.any(String), tutor: PRO_LOW } });
    expect(sent.map(carried)).toEqual([[address("gemini-3.1-pro-preview"), { thinkingLevel: "low" }]]);
  }, 30_000);

  test("A level the chosen model does not support is refused with a plain sentence and never offered in the UI.", async () => {
    const { maya, google, samLooks } = await journey();
    const calls = google.calls.length;
    for (const choice of [{ model: "gemini-3.8-flash", level: "MINIMAL" }, { model: "gemini-3.1-pro-preview", level: "MINIMAL" },
      { model: "gemini-3.1-pro-preview", level: "low" }, { model: "gemini-3.5-flash-lite", level: "ULTRA" }]) {
      expect(await maya.post("/settings/tutor/choose", choice), JSON.stringify(choice)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: UNSUPPORTED_LEVEL } });
    }
    const { settings } = await maya.ok("/settings/tutor");
    expect(settings).toEqual(record(PRO_LOW, "SAVED").settings);
    expect(google.calls).toHaveLength(calls);
    // The record the Tutor panel draws from lists only the levels each model accepts.
    expect(settings.models.map((entry: TutorModelOffer) => [entry.model, entry.levels])).toEqual([
      ["gemini-3.5-flash-lite", ["MINIMAL", "LOW", "MEDIUM", "HIGH"]], ["gemini-3.8-flash", ["LOW", "MEDIUM", "HIGH"]], ["gemini-3.1-pro-preview", ["LOW", "MEDIUM", "HIGH"]]]);
    await samLooks("Maya's unsupported level was refused");
  }, 30_000);

  test("Option A: a small reusable concept, for example `Preferring [User]`, whose purpose is to remember a user's choice among offered options (set, clear, read), with the application validating the choice against the model catalog.", async () => {
    const { maya, lesson, preferring, samLooks } = await journey();
    // Set: the saved choice is one record keyed by the learner.
    expect(await preferring._choice({ user: maya.user })).toEqual([{ option: PRO_LOW }]);
    // Clear: the learner is back on the default, on every device.
    expect(await maya.ok("/settings/tutor/clear")).toEqual(record(DEFAULT, "DEFAULT"));
    expect(await maya.phone.ok("/settings/tutor")).toEqual(record(DEFAULT, "DEFAULT"));
    expect(await preferring._choice({ user: maya.user })).toEqual([]);
    await samLooks("Maya cleared her choice");
    // Read: the next tutor request uses the default again.
    const { reply, sent } = await lesson(maya);
    expect(reply.body.tutor).toEqual(DEFAULT);
    expect(sent.map(carried)).toEqual([[address(DEFAULT.model), { thinkingLevel: DEFAULT.level.toLowerCase() }]]);
  }, 30_000);

  // The brief has no sentence for a lost reply; this name is the design's sentence (design/compositions/Settings.md).
  test("If the reply is lost, sending the same choice again, or clearing again, gives the same result.", async () => {
    const { maya, preferring, samLooks } = await journey();
    // The laptop's choice reaches the server, but its reply never arrives. The phone shows that the choice was saved.
    await maya.loseReply("/settings/tutor/choose", PRO_LOW);
    expect(await maya.phone.ok("/settings/tutor")).toEqual(record(PRO_LOW, "SAVED"));
    // Sending the same choice again gives the same result and still leaves one saved choice.
    expect(await maya.ok("/settings/tutor/choose", PRO_LOW)).toEqual(record(PRO_LOW, "SAVED"));
    expect(await preferring._choice({ user: maya.user })).toEqual([{ option: PRO_LOW }]);
    // The same holds for clearing.
    await maya.loseReply("/settings/tutor/clear");
    expect(await maya.phone.ok("/settings/tutor")).toEqual(record(DEFAULT, "DEFAULT"));
    expect(await maya.ok("/settings/tutor/clear")).toEqual(record(DEFAULT, "DEFAULT"));
    expect(await preferring._choice({ user: maya.user })).toEqual([]);
    await samLooks("Maya's lost replies were retried");
  }, 30_000);

  test("When the chosen model is unavailable (removed, not permitted for the key, quota), the request is refused with a sentence that tells the learner to pick another model.", async () => {
    const { database, maya, sam, samLooks } = await journey();
    expect(await maya.ok("/settings/tutor/choose", PRO_LOW)).toEqual(record(PRO_LOW, "SAVED"));
    // The server restarts, and Gemini's model list no longer has Pro, so the startup check withdraws it from the offer.
    const restarted = await restartServer({ database, listed: ["gemini-3.5-flash-lite", "gemini-3.8-flash"],
      maya: { session: maya.session, skill: maya.skill }, sam: { session: sam.session }, again: FLASH_HIGH });
    expect(restarted.list).toEqual([{ url: `${GOOGLE}?pageSize=200`, method: "GET", headers: { "x-goog-api-key": KEY } }]);
    expect(restarted.logs).toEqual(["Tutor models withdrawn because Gemini's model list lacks them: gemini-3.1-pro-preview."]);
    const offered = catalog("gemini-3.8-flash", TABLE.filter((entry) => entry.model !== "gemini-3.1-pro-preview")), fallback = defaultFor("gemini-3.8-flash");
    // Maya's saved choice is still hers, but it is RETIRED: Pro is no longer among the offered models.
    expect(restarted.retired).toEqual({ status: 200, body: { settings: { models: offered, choice: PRO_LOW, status: "RETIRED", defaultChoice: fallback } } });
    // Her lesson is declined at admission with the design's sentence. Nothing was saved, and there is no silent fallback:
    // Google was not asked at all, neither with Pro nor with the default model.
    expect(restarted.declined).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: NO_LONGER_OFFERED } });
    expect(restarted.studyUnchanged).toBe(true);
    expect(restarted.sentWhileRetired).toEqual([]);
    // RETIRED belongs to Maya alone: Sam's choice on the restarted server is still SAVED.
    expect(restarted.samSees).toEqual({ status: 200, body: { settings: { models: offered, choice: LITE_HIGH, status: "SAVED", defaultChoice: fallback } } });
    // Choosing another model replaces the RETIRED choice, and the next lesson goes to it.
    expect(restarted.chosen).toEqual({ status: 200, body: { settings: { models: offered, choice: FLASH_HIGH, status: "SAVED", defaultChoice: fallback } } });
    expect(restarted.lesson).toEqual({ status: 200, body: { lesson: expect.any(String), tutor: FLASH_HIGH } });
    expect(restarted.sent).toEqual([[address("gemini-3.8-flash"), { thinkingLevel: "high" }]]);
    await samLooks("Maya chose again on the restarted server");
  }, 60_000);

  test("Another learner cannot read or change the learner's choice; the settings endpoints check the session like every other endpoint.", async () => {
    const { maya, sam, lesson, preferring, samSaw } = await journey();
    // Sam looked after each of Maya's changes, and each time saw only his own choice.
    expect(samSaw.map(({ after }) => after)).toEqual(["Sam chose Flash-Lite at High", "Maya chose Pro at Low", "Maya's unknown model was refused",
      "Maya's unsupported level was refused", "Maya cleared her choice", "Maya's lost replies were retried", "Maya chose again on the restarted server"]);
    for (const { after, seen } of samSaw) expect(seen, after).toEqual(record(LITE_HIGH, "SAVED"));
    // Fields that name Maya change nothing: the session decides whose choice is read, and a choice accepts no such field.
    expect(await sam.ok("/settings/tutor", { user: maya.user, owner: maya.user })).toEqual(record(LITE_HIGH, "SAVED"));
    expect((await sam.post("/settings/tutor/choose", { ...PRO_LOW, user: maya.user })).status).toBe(400);
    expect(await preferring._choice({ user: maya.user })).toEqual([{ option: FLASH_HIGH }]);
    expect(await preferring._choice({ user: sam.user })).toEqual([{ option: LITE_HIGH }]);
    // Sam's tutor requests still use his own model and level.
    const { reply, sent } = await lesson(sam);
    expect(reply).toEqual({ status: 200, body: { lesson: expect.any(String), tutor: LITE_HIGH } });
    expect(sent.map(carried)).toEqual([[address("gemini-3.5-flash-lite"), { thinkingLevel: "high" }]]);
    // Without a session, every settings endpoint is refused.
    for (const path of ["/settings/tutor", "/settings/tutor/choose", "/settings/tutor/clear"]) {
      expect(await sam.post(path, path.endsWith("choose") ? LITE_HIGH : {}, false), path).toEqual({ status: 401, body: { error: "UNAUTHORIZED", detail: SIGNED_OUT } });
    }
  }, 30_000);
});
