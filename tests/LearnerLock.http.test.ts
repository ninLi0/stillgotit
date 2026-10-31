import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { DiskStore } from "../src/host/file-store.ts";
import { SESSION_COOKIE } from "../src/host/http-policy.ts";
import { MaterialFiles } from "../src/host/material-files.ts";
import { createRuntime } from "../src/host/runtime.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// Reads and writes around the learner lock (design/runtime.md, "Accounts and requests"). A tutor request holds the lock
// while the tutor works. Plain reads answer meanwhile; writes, the skill read with its repairs, and an import listing that
// has a material to save still wait for it.
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const WAITED = Symbol("still waiting");
/** The promise's result, or WAITED when it has not settled after `ms`. */
async function within<T>(promise: Promise<T>, ms = 10_000): Promise<T | typeof WAITED> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { return await Promise.race([promise, new Promise<typeof WAITED>((settle) => { timer = setTimeout(() => settle(WAITED), ms); })]); }
  finally { clearTimeout(timer); }
}

/** The real host and engine, with a controlled tutor whose next request can be held open. */
async function setup({ limits }: { limits?: Parameters<typeof createRuntime>[0]["limits"] } = {}) {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const storeDirectory = await mkdtemp(resolve(tmpdir(), "stillgotit-learner-lock-"));
  let beforeGenerate: (() => Promise<void>) | undefined, questions = 0;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Products", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products." }] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      if (beforeGenerate) { const work = beforeGenerate; beforeGenerate = undefined; await work(); }
      const properties = schema.properties as Record<string, unknown>, citations = [{ material: sources[0]!.material, location: "content" }];
      if (properties.explanation) return { explanation: "Match a row to a column.", citations };
      if (properties.question) return { question: `Compute product number ${++questions} and explain why order matters.`, citations };
      if (properties.rationale) return { result: (context as { help: string }).help === "NONE" ? "INDEPENDENT" : "SUPPORTED", gateMet: false, rationale: "The products are correct." };
      return properties.citations ? { text: "Order changes which rows meet which columns.", citations } : { text: "Start with the dimensions." };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider: new MemoryProvider(), providerOrigin: "https://commons.example", publicOrigin: ORIGIN,
    tutor, files: new MaterialFiles(new DiskStore(storeDirectory)), limits });
  // A test that fails while it holds a tutor request open still lets that request finish, so the drain below can end.
  const holds: (() => void)[] = [];
  cleanups.push(async () => {
    for (const release of holds) release();
    await runtime.worker.stop(); await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    await rm(storeDirectory, { recursive: true, force: true });
  });

  /** A signed-in learner with one course, one source, and one confirmed skill with a starting confidence. */
  async function learner() {
    const user = crypto.randomUUID() as User, started = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in started) throw new Error("Test session was refused");
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      const form = body instanceof FormData;
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", body: form ? body : JSON.stringify(body),
        headers: { Origin: ORIGIN, Cookie: `${SESSION_COOKIE}=${started.session}`, ...(form ? {} : { "Content-Type": "application/json" }) } }));
      return { status: response.status, body: await response.json() };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    const { course } = await ok("/courses/create", { title: "Linear algebra" });
    const { material } = await runtime.application.concepts.Library.add({ owner: user, importKey: crypto.randomUUID(), scope: course,
      title: "Matrix multiplication", locator: "upload:test", content: "Multiply rows by columns. Inner dimensions must match.", originals: [], origin: "COURSE", purpose: "SOURCE" });
    const { unit } = await ok("/courses/units/add", { course, title: "Products" });
    const { skill } = await ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" });
    await ok("/courses/skills/confirm", { skill });
    await ok("/learning/confidence", { skill, confidence: 50 });
    return { user, session: started.session, course, unit, material, skill, post, ok };
  }

  /**
   * Saves a lesson and asks for its opening, holding that tutor request open until `release` is called. The request holds
   * the learner's lock all that time. `reply` settles with the opening's answer.
   */
  async function holdOpening(student: Awaited<ReturnType<typeof learner>>) {
    const { lesson } = await student.ok("/learning/lesson", { skill: student.skill, request: "Explain products." });
    const entered = Promise.withResolvers<void>(), released = Promise.withResolvers<void>();
    holds.push(() => released.resolve());
    beforeGenerate = async () => { entered.resolve(); await released.promise; };
    const reply = student.post("/learning/reply", { studySession: lesson });
    await entered.promise;
    return { lesson, reply, release: () => released.resolve() };
  }
  /** A request with no session cookie. */
  async function anonymous(path: string, body: Record<string, unknown>) {
    const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", body: JSON.stringify(body),
      headers: { Origin: ORIGIN, "Content-Type": "application/json" } }));
    return { status: response.status, body: await response.json() };
  }
  return { runtime, connection, learner, holdOpening, anonymous };
}

test("plain reads answer while a tutor request holds the learner's lock, from the records saved so far", async () => {
  const app = await setup(), learner = await app.learner(), { course, skill } = learner;
  await learner.ok("/planning/configure", { course, dailyMinutes: 30, focusNote: "" });
  const held = await app.holdOpening(learner);
  let replied = false;
  void held.reply.finally(() => { replied = true; });

  // The five learning and planning reads that used to wait behind the lock, the archived conversations, then the reads
  // that never took it.
  const reads: [string, Record<string, unknown>][] = [
    ["/learning/recent", { course }], ["/learning/continue", { course }], ["/learning/memory", { course }], ["/learning/progress", { course }],
    ["/planning/read", { course }], ["/learning/archived", { course }],
    ["/courses", {}], ["/courses/read", { course }], ["/courses/scores", {}], ["/courses/graded/read", { material: learner.material }],
    ["/courses/materials/read", { material: learner.material }], ["/courses/materials/imports", { course }], ["/settings/tutor", {}], ["/settings/view", {}],
  ];
  const answers: Record<string, { status: number; body: any }> = {};
  for (const [path, input] of reads) {
    const answer = await within(learner.post(path, input));
    if (answer === WAITED) throw new Error(`${path} waited for the tutor request.`);
    answers[path] = answer;
  }
  // Each read answered, the graded read with its usual refusal for an ungraded material.
  for (const [path, { status }] of Object.entries(answers)) expect(status, path).toBe(path === "/courses/graded/read" ? 403 : 200);
  expect(replied).toBe(false);

  // They show what is saved now: the lesson with its request, and the plan and estimate as they were.
  expect(answers["/learning/recent"]!.body.sessions).toEqual([expect.objectContaining({ studySession: held.lesson, kind: "LESSON", status: "OPEN", title: "Explain products." })]);
  expect(answers["/learning/continue"]!.body.sessions).toEqual([expect.objectContaining({ studySession: held.lesson, kind: "LESSON" })]);
  expect(answers["/learning/memory"]!.body.skills).toEqual([expect.objectContaining({ skill })]);
  expect(answers["/learning/progress"]!.body.data.estimates).toEqual([expect.objectContaining({ skill })]);
  expect(answers["/planning/read"]!.body.data.preferences).toMatchObject({ dailyMinutes: 30 });
  expect(answers["/learning/archived"]!.body.sessions).toEqual([]);

  // Native callers' plain reads do not wait either.
  const native = await within(app.runtime.gateway.invoke("/learning/recent", { session: learner.session, course }, { timeoutMs: 5000 }));
  expect(native).toMatchObject({ ok: true, value: { sessions: [expect.objectContaining({ studySession: held.lesson })] } });
  // Without a session, the six reads are refused with the same answer as when they took the lock.
  for (const [path, input] of reads.slice(0, 6)) expect(await app.anonymous(path, input), path).toEqual({ status: 401, body: { error: "UNAUTHORIZED" } });

  held.release();
  expect(await held.reply).toEqual({ status: 200, body: { tutor: expect.objectContaining({ model: expect.any(String) }) } });
  const explained = (await learner.ok("/learning/read", { skill })).data.sessions.find((item: { session: string }) => item.session === held.lesson);
  expect(explained.lesson.explanation).toBe("Match a row to a column.");
}, 60_000);

test("writes still wait for the learner's lock and run one after the other", async () => {
  const app = await setup(), learner = await app.learner(), { course } = learner, { StudyPlanning, SkillMapping } = app.runtime.application.concepts;
  await learner.ok("/planning/configure", { course, dailyMinutes: 30, focusNote: "" });
  const held = await app.holdOpening(learner), finished: string[] = [];
  const reply = held.reply.finally(() => finished.push("reply"));
  const configure = learner.post("/planning/configure", { course, dailyMinutes: 45, focusNote: "" }).finally(() => finished.push("configure"));
  await Bun.sleep(50);
  const unit = learner.post("/courses/units/add", { course, title: "Inverses" }).finally(() => finished.push("unit"));

  // Neither write runs while the tutor request holds the lock, and neither has changed anything.
  expect(await within(configure, 500)).toBe(WAITED);
  expect(await within(unit, 100)).toBe(WAITED);
  expect(await StudyPlanning._preferences({ owner: learner.user, scope: course })).toEqual([expect.objectContaining({ dailyMinutes: 30 })]);
  expect(await SkillMapping._units({ course })).toHaveLength(1);

  // Once the tutor request ends, the writes run in the order they arrived, each after the one before it.
  held.release();
  expect((await reply).status).toBe(200);
  expect((await configure).status).toBe(200);
  expect((await unit).status).toBe(200);
  expect(finished).toEqual(["reply", "configure", "unit"]);
  expect(await StudyPlanning._preferences({ owner: learner.user, scope: course })).toEqual([expect.objectContaining({ dailyMinutes: 45 })]);
  expect(await SkillMapping._units({ course })).toHaveLength(2);
}, 60_000);

test("the skill read keeps the lock, so its repair never runs beside a tutor request and still runs after it", async () => {
  const app = await setup(), learner = await app.learner(), { skill } = learner, { MasteryEstimating } = app.runtime.application.concepts;
  // A judged practice attempt.
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "My work", channel: "TEXT", attachments: [], dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  const { data } = await learner.ok("/learning/read", { skill }), [judged] = data.cases;
  const inputs = () => MasteryEstimating._inputs({ track: data.track.track });
  const applied = (await inputs())[0]!.revision;
  // A later judgment saved without its reactions, as when the process stops before the estimate is updated.
  const raw = new AssessmentReviewing(app.connection.db), [effective] = await raw._effectiveJudgment({ case: judged.case });
  await raw.revise({ author: learner.user, case: judged.case, basedOn: effective!.judgment, result: "SLIP", gateMet: false, rationale: "A small slip.", origin: "MANUAL" });

  const held = await app.holdOpening(learner);
  const read = learner.post("/learning/read", { skill });
  // The skill read waits for the tutor request, and its repair has not run.
  expect(await within(read, 500)).toBe(WAITED);
  expect((await inputs())[0]!.revision).toBe(applied);

  held.release();
  expect((await held.reply).status).toBe(200);
  const answered = await read;
  expect(answered.status).toBe(200);
  // It answered after the opening was saved, and its repair applied the later judgment once.
  expect(answered.body.data.sessions.find((item: { session: string }) => item.session === held.lesson).lesson.explanation).toBe("Match a row to a column.");
  const repaired = await inputs();
  expect(repaired).toHaveLength(1);
  expect(repaired[0]).toMatchObject({ signal: "SLIP" });
  expect(repaired[0]!.revision).toBeGreaterThan(applied);
}, 60_000);

test("an import listing waits for the lock only to save a finished import, and saves it once the tutor request ends", async () => {
  const app = await setup({ limits: { uploadBudgetMs: 1500 } }), learner = await app.learner(), { course } = learner;
  const held = await app.holdOpening(learner);
  // With nothing to save, the listing answers at once.
  expect(await within(learner.post("/courses/materials/imports", { course }))).toEqual({ status: 200, body: { imports: [], saved: [] } });

  // An upload that cannot take the lock within its budget answers SAVING. Its import is ready to be saved.
  const requestId = crypto.randomUUID(), form = new FormData();
  form.set("course", course); form.set("title", "Inverses"); form.set("requestId", requestId);
  form.append("files", new File(["# Inverses\nA matrix times its inverse is the identity."], "inverses.md", { type: "text/markdown" }));
  expect(await learner.post("/courses/materials/add", form)).toEqual({ status: 200, body: { requestId, state: "SAVING" } });

  // The listing that saves it waits for the lock, and nothing is saved meanwhile. The course read still answers.
  const listing = learner.post("/courses/materials/imports", { course });
  expect(await within(listing, 500)).toBe(WAITED);
  expect((await learner.ok("/courses/read", { course })).materials).toHaveLength(1);

  held.release();
  expect((await held.reply).status).toBe(200);
  expect(await listing).toEqual({ status: 200, body: { imports: [], saved: [expect.any(String)] } });
  expect((await learner.ok("/courses/read", { course })).materials.map((item: { title: string }) => item.title).sort()).toEqual(["Inverses", "Matrix multiplication"]);
}, 60_000);

test("a course read answers during a tutor request and repairs a missing track there, as it did before", async () => {
  const app = await setup(), learner = await app.learner(), { course, skill } = learner, { MasteryEstimating } = app.runtime.application.concepts;
  // A revision saved without its track, as when the track write fails after the revision.
  const raw = await createSkillMapping(app.connection.db);
  const revised = await raw.reviseDefinition({ owner: learner.user, skill, outcome: "Multiply matrices of any size", gate: "Two products and why" });
  expect(revised).toEqual({ previous: expect.any(String), version: expect.any(String) });
  expect(await MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toHaveLength(1);

  const held = await app.holdOpening(learner);
  // The course read takes no lock. Its repair starts the missing track while the tutor works.
  expect(await within(learner.post("/courses/read", { course }))).toMatchObject({ status: 200 });
  expect(await MasteryEstimating._tracks({ learner: learner.user, subject: skill }))
    .toEqual([expect.anything(), expect.objectContaining({ definition: revised.version, startingBasis: "PREVIOUS_DEFINITION" })]);

  // The tutor request is unaffected and saves its opening.
  held.release();
  expect((await held.reply).status).toBe(200);
  const lesson = (await learner.ok("/learning/read", { skill })).data.sessions.find((item: { session: string }) => item.session === held.lesson);
  expect(lesson.lesson.explanation).toBe("Match a row to a column.");
}, 60_000);
