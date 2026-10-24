import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { SESSION_COOKIE } from "../src/host/http-policy.ts";
import { defaultChoice, tutorCatalog } from "../src/computations/tutor.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import type { TutorChoice } from "../src/tutor-types.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// The design's sentences (design/compositions/Settings.md and LearningAccess.md).
const UNKNOWN_MODEL = "That model isn't offered. Choose one of the models in the Tutor panel.";
const UNSUPPORTED_LEVEL = "That model doesn't offer this thinking level. Choose one of the levels shown for it.";
const NO_LONGER_OFFERED = "The tutor model or thinking level you chose is no longer offered. Choose another one in the Tutor panel.";
// Sessioning's sentence for NOT_SIGNED_IN, which reaches the browser as the refusal's `detail`.
const SIGNED_OUT = "Your session has ended. Sign in again.";
const DEFAULT = defaultChoice({});
const LITE_HIGH: TutorChoice = { model: "gemini-3.5-flash-lite", level: "HIGH" };
const PRO_LOW: TutorChoice = { model: "gemini-3.1-pro-preview", level: "LOW" };
const settings = (choice: TutorChoice, status: string) => ({ settings: { models: tutorCatalog({}), choice, status, defaultChoice: DEFAULT } });

/** The real host and engine with a controlled tutor that records the model and level each request carried. */
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const sent: { kind: string; choice: TutorChoice | undefined }[] = [];
  let failNext: string | undefined, beforeGenerate: (() => Promise<void>) | undefined, questions = 0;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async (_owner, _source, choice) => {
      sent.push({ kind: "SUGGEST", choice });
      return { unitTitle: "Products", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products and explain why order matters." }] };
    },
    generate: async (_owner, sources, _instruction, context, schema, _work, choice) => {
      const properties = schema.properties as Record<string, unknown>;
      const kind = properties.explanation ? "LESSON" : properties.question ? "TASK" : properties.rationale ? "GRADE" : properties.citations ? "REPLY" : "HINT";
      sent.push({ kind, choice });
      if (beforeGenerate) { const work = beforeGenerate; beforeGenerate = undefined; await work(); }
      if (failNext === kind) { failNext = undefined; throw new Error("Fixture provider interruption"); }
      const citations = [{ material: sources[0]!.material, location: "content" }];
      if (kind === "LESSON") return { explanation: "Match a row to a column.", citations };
      if (kind === "TASK") return { question: `Compute product number ${++questions} and explain why order matters.`, citations };
      if (kind === "GRADE") return { result: (context as { help: string }).help === "NONE" ? "INDEPENDENT" : "SUPPORTED", gateMet: false, rationale: "The products are correct." };
      return kind === "REPLY" ? { text: "Order changes which rows meet which columns.", citations } : { text: "Start with the dimensions." };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider: new MemoryProvider(), providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });

  /** A browser with its own session for `user`. Two browsers for one user stand in for two devices. */
  async function browser(user: User = crypto.randomUUID() as User) {
    const started = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in started) throw new Error("Test session was refused");
    async function post(path: string, body: object = {}, signedIn = true) {
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", body: JSON.stringify(body),
        headers: { Origin: ORIGIN, "Content-Type": "application/json", ...(signedIn ? { Cookie: `${SESSION_COOKIE}=${started.session}` } : {}) } }));
      return { status: response.status, body: await response.json() };
    }
    async function ok(path: string, body: object = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    return { user, session: started.session, post, ok };
  }

  /** A learner with one course source and one confirmed skill with starting confidence. */
  async function learner() {
    const learner = await browser();
    const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
    const { material } = await runtime.application.concepts.GroundedTutoring.addMaterial({ owner: learner.user, importKey: crypto.randomUUID(), scope: course,
      title: "Matrix multiplication", locator: "upload:test", content: "Multiply rows by columns. Inner dimensions must match.", originals: [], origin: "COURSE" });
    const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
    const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" });
    await learner.ok("/courses/skills/confirm", { skill });
    await learner.ok("/learning/confidence", { skill, confidence: 50 });
    const read = async () => (await learner.ok("/learning/read", { skill })).data;
    const dialogueLength = async (studySession: string) => (await read()).sessions.find((item: { session: string }) => item.session === studySession).dialogue.length;
    return { ...learner, course, material, skill, read, dialogueLength };
  }
  return { runtime, sent, browser, learner, failNext: (kind: string) => { failNext = kind; }, duringGeneration: (work: () => Promise<void>) => { beforeGenerate = work; } };
}

test("the settings endpoints read, choose, and clear the signed-in learner's choice", async () => {
  const app = await setup(), laptop = await app.browser(), phone = await app.browser(laptop.user);
  expect(await laptop.ok("/settings/tutor")).toEqual(settings(DEFAULT, "DEFAULT"));
  expect(tutorCatalog({}).map((entry) => entry.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-pro-preview"]);

  // Saving answers the saved state, a repeated save changes nothing, and a second device sees the same choice.
  expect(await laptop.ok("/settings/tutor/choose", PRO_LOW)).toEqual(settings(PRO_LOW, "SAVED"));
  expect(await laptop.ok("/settings/tutor/choose", PRO_LOW)).toEqual(settings(PRO_LOW, "SAVED"));
  expect(await phone.ok("/settings/tutor")).toEqual(settings(PRO_LOW, "SAVED"));

  // Refusals use the design's sentences, match exactly including case, and save nothing.
  const refusals: [Record<string, unknown>, string][] = [
    [{ model: "gemini-9.9-nonexistent", level: "LOW" }, UNKNOWN_MODEL],
    [{ model: "GEMINI-3.8-FLASH", level: "LOW" }, UNKNOWN_MODEL],
    [{ model: "models/gemini-3.8-flash", level: "LOW" }, UNKNOWN_MODEL],
    [{ model: "x".repeat(100), level: "LOW" }, UNKNOWN_MODEL],
    [{ model: "gemini-3.8-flash", level: "MINIMAL" }, UNSUPPORTED_LEVEL],
    [{ model: "gemini-3.1-pro-preview", level: "low" }, UNSUPPORTED_LEVEL],
    [{ model: "gemini-3.5-flash-lite", level: "ULTRA" }, UNSUPPORTED_LEVEL],
  ];
  for (const [input, detail] of refusals) {
    expect(await laptop.post("/settings/tutor/choose", input), JSON.stringify(input)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail } });
  }
  // The boundary refuses other input as invalid before the flow starts, without a refusal sentence.
  for (const input of [{ model: "x".repeat(101), level: "LOW" }, { model: "gemini-3.8-flash", level: "L".repeat(101) }, { model: "gemini-3.8-flash" },
    { level: "LOW" }, { model: "gemini-3.8-flash", level: 3 }, { model: ["gemini-3.8-flash"], level: "LOW" }]) {
    expect(await laptop.post("/settings/tutor/choose", input), JSON.stringify(input).slice(0, 80)).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
  }
  expect(await laptop.ok("/settings/tutor")).toEqual(settings(PRO_LOW, "SAVED"));

  // Clearing returns to the default; clearing again succeeds and changes nothing.
  expect(await phone.ok("/settings/tutor/clear")).toEqual(settings(DEFAULT, "DEFAULT"));
  expect(await phone.ok("/settings/tutor/clear")).toEqual(settings(DEFAULT, "DEFAULT"));
  expect(await laptop.ok("/settings/tutor")).toEqual(settings(DEFAULT, "DEFAULT"));
  // A refusal with nothing saved leaves nothing saved.
  expect((await laptop.post("/settings/tutor/choose", { model: "gemini-3.8-flash", level: "MINIMAL" })).status).toBe(400);
  expect(await laptop.ok("/settings/tutor")).toEqual(settings(DEFAULT, "DEFAULT"));
  // Choosing the default model at its default level saves it as the learner's own choice.
  expect(await laptop.ok("/settings/tutor/choose", { ...DEFAULT })).toEqual(settings(DEFAULT, "SAVED"));

  // Without a session every settings endpoint is refused, and the native gateway reports the refusal codes with their sentences.
  for (const path of ["/settings/tutor", "/settings/tutor/choose", "/settings/tutor/clear"]) {
    expect(await laptop.post(path, path.endsWith("choose") ? PRO_LOW : {}, false), path).toEqual({ status: 401, body: { error: "UNAUTHORIZED", detail: SIGNED_OUT } });
  }
  expect(await app.runtime.gateway.invoke("/settings/tutor/choose", { session: laptop.session, model: "gemini-9.9-nonexistent", level: "LOW" }))
    .toEqual({ ok: false, error: { kind: "domain", value: "UNKNOWN_TUTOR_MODEL", detail: UNKNOWN_MODEL } });
  expect(await app.runtime.gateway.invoke("/settings/tutor/choose", { session: laptop.session, model: "gemini-3.8-flash", level: "MINIMAL" }))
    .toEqual({ ok: false, error: { kind: "domain", value: "UNSUPPORTED_THINKING_LEVEL", detail: UNSUPPORTED_LEVEL } });
  expect(await app.runtime.gateway.invoke("/settings/tutor", { session: laptop.session })).toEqual({ ok: true, value: settings(DEFAULT, "SAVED") });
}, 30_000);

test("another learner can neither read nor change the learner's choice", async () => {
  const app = await setup(), maya = await app.browser(), sam = await app.browser();
  await maya.ok("/settings/tutor/choose", PRO_LOW);
  expect(await sam.ok("/settings/tutor")).toEqual(settings(DEFAULT, "DEFAULT"));
  // Fields naming Maya are ignored on reads and clears and refused on a choice; the session decides whose choice it is.
  expect(await sam.ok("/settings/tutor", { owner: maya.user, user: maya.user, subject: maya.user })).toEqual(settings(DEFAULT, "DEFAULT"));
  expect((await sam.post("/settings/tutor/choose", { ...LITE_HIGH, user: maya.user })).status).toBe(400);
  expect(await sam.ok("/settings/tutor/choose", LITE_HIGH)).toEqual(settings(LITE_HIGH, "SAVED"));
  expect(await maya.ok("/settings/tutor")).toEqual(settings(PRO_LOW, "SAVED"));
  expect(await sam.ok("/settings/tutor/clear", { owner: maya.user, user: maya.user })).toEqual(settings(DEFAULT, "DEFAULT"));
  expect(await maya.ok("/settings/tutor")).toEqual(settings(PRO_LOW, "SAVED"));
  expect(await app.runtime.application.concepts.TutorPreferring._choice({ user: sam.user })).toEqual([]);
}, 15_000);

test("TutorStatus is SAVED, RETIRED when the saved model or level is no longer offered, or DEFAULT", async () => {
  const app = await setup(), learner = await app.browser(), { TutorPreferring } = app.runtime.application.concepts;
  const retiredModel = { model: "gemini-3.0-flash-retired", level: "LOW" } as TutorChoice;
  const retiredLevel = { model: "gemini-3.8-flash", level: "MINIMAL" } as TutorChoice;
  // A choice saved under an earlier catalog is no longer offered: its model was removed, or its model stopped listing the level.
  await TutorPreferring.set({ user: learner.user, option: retiredModel });
  expect(await learner.ok("/settings/tutor")).toEqual(settings(retiredModel, "RETIRED"));
  expect(await learner.ok("/settings/tutor/choose", LITE_HIGH)).toEqual(settings(LITE_HIGH, "SAVED"));
  await TutorPreferring.set({ user: learner.user, option: retiredLevel });
  expect(await learner.ok("/settings/tutor")).toEqual(settings(retiredLevel, "RETIRED"));
  // A refused choice leaves the RETIRED choice as it was.
  expect((await learner.post("/settings/tutor/choose", { model: "gemini-9.9-nonexistent", level: "LOW" })).body.detail).toBe(UNKNOWN_MODEL);
  expect(await learner.ok("/settings/tutor")).toEqual(settings(retiredLevel, "RETIRED"));
  expect(await learner.ok("/settings/tutor/clear")).toEqual(settings(DEFAULT, "DEFAULT"));
}, 15_000);

test("each of the nine tutor flows sends the learner's choice and returns it as tutor", async () => {
  const app = await setup(), learner = await app.learner();
  const sentLast = () => app.sent.at(-1)!.choice;
  // Nothing chosen: the default model at its default level.
  expect(await learner.ok("/courses/skills/suggest", { material: learner.material })).toEqual({ tutor: DEFAULT,
    suggestions: { unitTitle: "Products", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products and explain why order matters." }] } });
  expect(sentLast()).toEqual(DEFAULT);

  await learner.ok("/settings/tutor/choose", LITE_HIGH);
  expect(await learner.ok("/courses/skills/suggest", { material: learner.material })).toMatchObject({ tutor: LITE_HIGH });
  const lessonResult = await learner.ok("/learning/lesson", { skill: learner.skill, request: "Explain products." });
  expect(lessonResult).toEqual({ lesson: expect.any(String), tutor: LITE_HIGH });
  const { lesson } = lessonResult;
  expect(await learner.ok("/learning/question", { studySession: lesson, text: "Why does order matter?", channel: "TEXT", attachments: [], dialogueLength: 0 })).toEqual({ tutor: LITE_HIGH });
  // A failed reply keeps the saved question for Reply.
  app.failNext("REPLY");
  expect((await learner.post("/learning/question", { studySession: lesson, text: "And for vectors?", channel: "TEXT", attachments: [], dialogueLength: await learner.dialogueLength(lesson) })).status).toBe(400);

  await learner.ok("/settings/tutor/choose", PRO_LOW);
  expect(await learner.ok("/learning/reply", { studySession: lesson })).toEqual({ tutor: PRO_LOW });
  const taskResult = await learner.ok("/learning/task", { skill: learner.skill });
  expect(taskResult).toEqual({ task: expect.any(String), tutor: PRO_LOW });
  const { task } = taskResult;
  expect(await learner.ok("/learning/hint", { studySession: task })).toEqual({ tutor: PRO_LOW });
  await learner.ok("/learning/respond", { studySession: task, text: "My work", channel: "TEXT", attachments: [], dialogueLength: await learner.dialogueLength(task) });
  const review = { reviewed: true, unseen: true, outsideHelp: false };
  expect(await learner.ok("/learning/assess", { studySession: task, dialogueLength: await learner.dialogueLength(task), ...review })).toEqual({ studySession: task, tutor: PRO_LOW });

  // A failed grade leaves a closed, unjudged attempt for RetryAssessment.
  const { task: second } = await learner.ok("/learning/task", { skill: learner.skill });
  await learner.ok("/learning/respond", { studySession: second, text: "Second work", channel: "TEXT", attachments: [], dialogueLength: 0 });
  app.failNext("GRADE");
  expect((await learner.post("/learning/assess", { studySession: second, dialogueLength: 1, ...review })).status).toBe(400);
  await learner.ok("/settings/tutor/clear");
  expect(await learner.ok("/learning/retry", { studySession: second })).toEqual({ tutor: DEFAULT });

  await learner.ok("/settings/tutor/choose", LITE_HIGH);
  const judged = (await learner.read()).cases.find((item: { task: string }) => item.task === task);
  const regraded = await learner.ok("/learning/regrade", { case: judged.case, basedOn: judged.judgment.judgment, reason: "Check the second product." });
  expect(regraded).toEqual({ judgment: expect.any(String), tutor: LITE_HIGH });

  // Every provider request carried exactly the pair the learner's status allowed at the time it was prepared.
  expect(app.sent.map(({ kind, choice }) => [kind, choice])).toEqual([
    ["SUGGEST", DEFAULT], ["SUGGEST", LITE_HIGH], ["LESSON", LITE_HIGH], ["REPLY", LITE_HIGH], ["REPLY", LITE_HIGH],
    ["REPLY", PRO_LOW], ["TASK", PRO_LOW], ["HINT", PRO_LOW], ["GRADE", PRO_LOW], ["TASK", PRO_LOW], ["GRADE", PRO_LOW], ["GRADE", DEFAULT], ["GRADE", LITE_HIGH],
  ]);
}, 60_000);

test("a RETIRED choice is declined at admission, before the command's own check and before any write", async () => {
  const app = await setup(), learner = await app.learner(), review = { reviewed: true, unseen: true, outsideHelp: false };
  // Study state for every command: a lesson with an unanswered question, a judged attempt, a closed unjudged attempt, and an open task with work.
  const { lesson } = await learner.ok("/learning/lesson", { skill: learner.skill, request: "Explain products." });
  app.failNext("REPLY");
  await learner.post("/learning/question", { studySession: lesson, text: "Why?", channel: "TEXT", attachments: [], dialogueLength: 0 });
  const { task: judgedTask } = await learner.ok("/learning/task", { skill: learner.skill });
  await learner.ok("/learning/respond", { studySession: judgedTask, text: "Work", channel: "TEXT", attachments: [], dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: judgedTask, dialogueLength: 1, ...review });
  const { task: unjudged } = await learner.ok("/learning/task", { skill: learner.skill });
  await learner.ok("/learning/respond", { studySession: unjudged, text: "Work", channel: "TEXT", attachments: [], dialogueLength: 0 });
  app.failNext("GRADE");
  await learner.post("/learning/assess", { studySession: unjudged, dialogueLength: 1, ...review });
  const { task: open } = await learner.ok("/learning/task", { skill: learner.skill });
  await learner.ok("/learning/respond", { studySession: open, text: "Work", channel: "TEXT", attachments: [], dialogueLength: 0 });
  const judged = (await learner.read()).cases.find((item: { task: string }) => item.task === judgedTask);

  await app.runtime.application.concepts.TutorPreferring.set({ user: learner.user, option: { model: "gemini-3.0-flash-retired", level: "LOW" } as TutorChoice });
  // Saved records only: the mastery estimate itself decays with elapsed time.
  const saved = async () => { const data = await learner.read(); return { sessions: data.sessions, cases: data.cases, inputs: data.track.inputs }; };
  const before = await saved(), requests = app.sent.length;
  const commands: [string, Record<string, unknown>][] = [
    ["/learning/lesson", { skill: learner.skill, request: "Explain again." }],
    ["/learning/task", { skill: learner.skill }],
    ["/learning/question", { studySession: lesson, text: "Another question", channel: "TEXT", attachments: [], dialogueLength: await learner.dialogueLength(lesson) }],
    ["/learning/reply", { studySession: lesson }],
    ["/learning/hint", { studySession: open }],
    ["/learning/assess", { studySession: open, dialogueLength: 1, ...review }],
    ["/learning/retry", { studySession: unjudged }],
    ["/learning/regrade", { case: judged.case, basedOn: judged.judgment.judgment, reason: "Check my work." }],
    ["/courses/skills/suggest", { material: learner.material }],
  ];
  for (const [path, input] of commands) {
    expect(await learner.post(path, input), path).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: NO_LONGER_OFFERED } });
    expect(await app.runtime.gateway.invoke(path, { ...input, session: learner.session }, { timeoutMs: 3000 }), path)
      .toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: NO_LONGER_OFFERED } });
  }
  // TutorReady runs before the command's own former: a request that would also fail that former gets the tutor sentence.
  expect((await learner.post("/learning/lesson", { skill: "missing", request: "Explain." })).body.detail).toBe(NO_LONGER_OFFERED);
  expect((await learner.post("/learning/hint", { studySession: "missing" })).body.detail).toBe(NO_LONGER_OFFERED);
  // No hint was recorded, no question saved, no attempt closed, no clarification appended, and Google was never asked.
  expect(await saved()).toEqual(before);
  expect(app.sent).toHaveLength(requests);

  // Correcting makes no AI call, so it is not gated by the tutor choice.
  await learner.ok("/learning/correct", { case: judged.case, basedOn: judged.judgment.judgment, result: "SLIP", gateMet: false, reason: "A small slip." });
  // After choosing again, the same commands run.
  await learner.ok("/settings/tutor/choose", LITE_HIGH);
  expect(await learner.ok("/learning/hint", { studySession: open })).toEqual({ tutor: LITE_HIGH });
}, 60_000);

test("choosing does not wait for a running lesson, which keeps the pair it prepared; the next request uses the new choice", async () => {
  const app = await setup(), learner = await app.learner();
  await learner.ok("/settings/tutor/choose", PRO_LOW);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  app.duringGeneration(async () => { entered.resolve(); await release.promise; });
  const running = learner.post("/learning/lesson", { skill: learner.skill, request: "Explain products." });
  await entered.promise;
  // The learner lock is held by the lesson, but saving a choice does not take it.
  expect(await learner.ok("/settings/tutor/choose", LITE_HIGH)).toEqual(settings(LITE_HIGH, "SAVED"));
  release.resolve();
  expect(await running).toEqual({ status: 200, body: { lesson: expect.any(String), tutor: PRO_LOW } });
  expect(await learner.ok("/learning/lesson", { skill: learner.skill, request: "Again." })).toMatchObject({ tutor: LITE_HIGH });
  expect(app.sent.map(({ choice }) => choice)).toEqual([PRO_LOW, LITE_HIGH]);
}, 30_000);
