import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { openLesson } from "./fixtures/open-lesson.ts";
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// LearningAccess.md: ReopenReady's sentence, for a session that is not one of the learner's finished lessons, or is archived.
const REOPEN_DECLINED = "Choose one of your finished lessons to continue. A practice task cannot be reopened, and an archived lesson must be restored first.";
const FINISH_DECLINED = "Choose one of your open lessons. A practice task closes when you submit it for assessment.";
const QUESTION_DECLINED = "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once.";
const SESSION_SOURCES_DELETED = "The materials this session was grounded in have been deleted, so the tutor can no longer answer here. Your saved work stays, and you can still finish the lesson or submit the task.";

// The harness of Learning.archive.http.test.ts, with a clock that can be held still and let go again.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  // Estimates decay with time, so a test that compares them before and after holds the clock still.
  const time: { frozen?: Date } = {};
  let questions = 0, replies = 0;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.explanation) return { explanation: "Match a row to a column.", citations: [{ material, location }] };
      if (properties.question) return { question: `Practice ${++questions}: compute [[1,2],[3,4]] × [[2,0],[1,2]]. Why does order matter?`, citations: [{ material, location }] };
      if (properties.rationale) {
        const { help, fresh } = context as { help: string; fresh: boolean };
        return { result: help === "HINT" ? "SUPPORTED" : "INDEPENDENT", gateMet: help === "NONE" && fresh, rationale: "Both results and the explanation meet the saved gate." };
      }
      return { text: `Reply ${++replies}: changing order pairs different rows and columns.`, citations: [{ material, location }] };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor,
    clock: () => new Date(time.frozen ?? Date.now()) });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  function browser() {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachments: [], ...body };
      if (path === "/planning/configure" && !(body instanceof FormData)) body = { focusNote: "", ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
    async function signIn(name: string) { const start = await ok("/auth/commons/start"); await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name })); const identity = await ok("/auth/commons/resume"); owners.push(identity.user); return identity; }
    return { post, ok, signIn };
  }
  /** A session for native callers: `gateway` applies admission, `raw` is the assembled invoker that bypasses it. */
  async function native(user: string) {
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user as never });
    if ("error" in signedIn) throw new Error("Test session was refused");
    return {
      gateway: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 3000 }),
      raw: (path: string, input: Record<string, unknown>) => runtime.application.invoker.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 3000 }),
    };
  }
  return { browser, native, concepts: runtime.application.concepts, freeze: () => { time.frozen = new Date(); }, release: () => { delete time.frozen; } };
}
type App = Awaited<ReturnType<typeof setup>>;
function upload(course: string, name = "lesson.md", text = "# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match.") {
  const form = new FormData(); form.set("course", course); form.set("title", name); form.set("requestId", crypto.randomUUID());
  form.append("files", new File([text], name, { type: "text/markdown" })); return form;
}
async function learningFixture(app: App, name: string) {
  const learner = app.browser(), { user } = await learner.signIn(name);
  const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
  const { material } = await learner.ok("/courses/materials/add", upload(course));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products", outcome: "Multiply matrices", gate: "Two worked examples and why" });
  await learner.ok("/courses/skills/confirm", { skill });
  return { learner, user, course, material: material as string, skill: skill as string };
}
type Session = { session: string; status: string; lesson: { request: string; explanation: string } | null; dialogue: { turn: { speaker: string; text: string } }[] };
const statuses = (read: { sessions: Session[] }) => read.sessions.map((session) => [session.session, session.status]);
const sessionIn = (read: { sessions: Session[] }, id: string) => read.sessions.find((session) => session.session === id)!;
const listed = (answer: { sessions: { studySession: string }[] }) => answer.sessions.map((row) => row.studySession);

test("a finished lesson is continued: it reopens unchanged, returns to Continue, answers the next question in the same conversation, and can be finished and continued again", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "continuer");
  await learner.ok("/planning/configure", { course, dailyMinutes: 20 });
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { lesson } = await openLesson(learner.ok, { skill, request: "Explain why the inner dimensions must match." });
  await learner.ok("/learning/question", { studySession: lesson, text: "So a 2×3 matrix times a 3×2 matrix works?", dialogueLength: 0 });

  // Everything the evidence and the plan show, read at one moment, before the lesson is finished.
  app.freeze();
  const evidence = async () => ({ read: await learner.ok("/learning/read", { skill }), progress: await learner.ok("/learning/progress", { course }),
    plan: await learner.ok("/planning/read", { course }), memory: await learner.ok("/learning/memory", { course }),
    tracks: await app.concepts.MasteryEstimating._tracks({ learner: user, subject: skill } as never) });
  const whileOpen = await evidence();
  expect(statuses(whileOpen.read)).toEqual([[lesson, "OPEN"]]);
  expect(sessionIn(whileOpen.read, lesson).dialogue).toHaveLength(2);

  expect(await learner.ok("/learning/finish", { studySession: lesson })).toEqual({});
  expect(await learner.ok("/learning/continue", { course })).toEqual({ sessions: [] });
  expect((await learner.ok("/learning/recent", { course })).sessions).toMatchObject([{ studySession: lesson, status: "CLOSED" }]);

  expect(await learner.ok("/learning/reopen", { studySession: lesson })).toEqual({});

  // Only the status changed back: the lesson, the estimates, the memory curves, and the plan read as they did while it was open.
  expect(await evidence()).toEqual(whileOpen);
  expect(whileOpen.read.cases).toEqual([]);
  // Continue lists it again, and the sidebar shows it as open.
  expect(listed(await learner.ok("/learning/continue", { course }))).toEqual([lesson]);
  expect((await learner.ok("/learning/recent", { course })).sessions).toMatchObject([{ studySession: lesson, status: "OPEN" }]);
  app.release();

  // A lesson that is open again cannot be reopened a second time, on any path.
  const owner = await app.native(user);
  expect(await learner.post("/learning/reopen", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: REOPEN_DECLINED } });
  expect(await owner.gateway("/learning/reopen", { studySession: lesson })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: REOPEN_DECLINED } });
  expect(await owner.raw("/learning/reopen", { studySession: lesson })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });

  // The next question is answered in the same conversation, after the earlier turns.
  await learner.ok("/learning/question", { studySession: lesson, text: "And a 3×2 matrix times a 2×3 one?", dialogueLength: 2 });
  const continued = sessionIn(await learner.ok("/learning/read", { skill }), lesson);
  expect(continued.dialogue.map((item) => [item.turn.speaker, item.turn.text])).toEqual([
    ["LEARNER", "So a 2×3 matrix times a 3×2 matrix works?"], ["TUTOR", "Reply 1: changing order pairs different rows and columns."],
    ["LEARNER", "And a 3×2 matrix times a 2×3 one?"], ["TUTOR", "Reply 2: changing order pairs different rows and columns."],
  ]);
  expect(continued).toMatchObject({ status: "OPEN", lesson: sessionIn(whileOpen.read, lesson).lesson });

  // It can be finished and continued again, through the native gateway too, and keeps going.
  expect(await owner.gateway("/learning/finish", { studySession: lesson })).toEqual({ ok: true, value: {} });
  expect(await learner.post("/learning/question", { studySession: lesson, text: "One more?", dialogueLength: 4 })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: QUESTION_DECLINED } });
  expect(await owner.gateway("/learning/reopen", { studySession: lesson })).toEqual({ ok: true, value: {} });
  await learner.ok("/learning/question", { studySession: lesson, text: "One more?", dialogueLength: 4 });
  expect(sessionIn(await learner.ok("/learning/read", { skill }), lesson).dialogue).toHaveLength(6);
  expect(await learner.ok("/learning/finish", { studySession: lesson })).toEqual({});
  expect(await owner.raw("/learning/reopen", { studySession: lesson })).toEqual({ ok: true, value: {} });
  expect(statuses(await learner.ok("/learning/read", { skill }))).toEqual([[lesson, "OPEN"]]);
}, 60_000);

test("a lesson finished before its opening explanation reopens waiting for it, and Reply then writes it", async () => {
  const app = await setup(), { learner, skill } = await learningFixture(app, "early-finisher");
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain why order matters." });
  await learner.ok("/learning/finish", { studySession: lesson });
  await learner.ok("/learning/reopen", { studySession: lesson });
  expect(sessionIn(await learner.ok("/learning/read", { skill }), lesson)).toMatchObject({ status: "OPEN", lesson: { request: "Explain why order matters.", explanation: "" } });
  await learner.ok("/learning/reply", { studySession: lesson });
  expect(sessionIn(await learner.ok("/learning/read", { skill }), lesson)).toMatchObject({ status: "OPEN", lesson: { explanation: "Match a row to a column." } });
}, 60_000);

test("a practice task cannot be continued on any path, while it is open or after it is submitted", async () => {
  const app = await setup(), { learner, user, skill } = await learningFixture(app, "practice-continuer");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  const owner = await app.native(user);
  const refusedEverywhere = async () => {
    expect(await learner.post("/learning/reopen", { studySession: task })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: REOPEN_DECLINED } });
    expect(await owner.gateway("/learning/reopen", { studySession: task })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: REOPEN_DECLINED } });
    // Without admission, the endpoint's "missing" branch answers instead of leaving the request unanswered.
    expect(await owner.raw("/learning/reopen", { studySession: task })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  };
  await refusedEverywhere();
  expect(statuses(await learner.ok("/learning/read", { skill }))).toEqual([[task, "OPEN"]]);

  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  const submitted = await learner.ok("/learning/read", { skill });
  expect(statuses(submitted)).toEqual([[task, "CLOSED"]]);
  await refusedEverywhere();
  // The submitted attempt and its judgment stay exactly as they were assessed.
  expect(await learner.ok("/learning/read", { skill })).toMatchObject({ sessions: submitted.sessions, cases: submitted.cases });
}, 60_000);

test("an archived finished lesson cannot be continued until it is restored, and the refusal says so", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "archived-continuer");
  const { lesson } = await openLesson(learner.ok, { skill, request: "Explain transposes of products." });
  await learner.ok("/learning/finish", { studySession: lesson });
  await learner.ok("/learning/archive", { studySession: lesson });
  const archived = await learner.ok("/learning/read", { skill });
  const owner = await app.native(user);

  expect(await learner.post("/learning/reopen", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: REOPEN_DECLINED } });
  expect(REOPEN_DECLINED).toContain("an archived lesson must be restored first");
  expect(await owner.gateway("/learning/reopen", { studySession: lesson })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: REOPEN_DECLINED } });
  expect(await owner.raw("/learning/reopen", { studySession: lesson })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  // It stays finished, archived, and read-only.
  expect(await learner.ok("/learning/read", { skill })).toEqual(archived);
  expect(archived.archived).toEqual([lesson]);
  expect(statuses(archived)).toEqual([[lesson, "CLOSED"]]);

  // Once it is restored, it can be continued.
  await learner.ok("/learning/restore", { studySession: lesson });
  expect(await learner.ok("/learning/reopen", { studySession: lesson })).toEqual({});
  expect(listed(await learner.ok("/learning/continue", { course }))).toEqual([lesson]);
  await learner.ok("/learning/question", { studySession: lesson, text: "Why does the order reverse?", dialogueLength: 0 });
  expect(sessionIn(await learner.ok("/learning/read", { skill }), lesson).dialogue).toHaveLength(2);
  // Archiving it again while it is open makes it read-only again, and a finished lesson in that state is refused the same way.
  await learner.ok("/learning/archive", { studySession: lesson });
  expect(await learner.post("/learning/finish", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: FINISH_DECLINED } });
  expect(await learner.post("/learning/reopen", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: REOPEN_DECLINED } });
}, 60_000);

test("another learner cannot continue the owner's finished lesson on any path, and a request without a session is refused", async () => {
  const app = await setup(), { learner, user, skill } = await learningFixture(app, "continue-owner");
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  await learner.ok("/learning/finish", { studySession: lesson });
  const other = app.browser(), outsider = await other.signIn("continue-outsider");
  const foreign = await app.native(outsider.user);

  for (const studySession of [lesson, "00000000-0000-7000-8000-000000000000", "missing-session"]) {
    expect(await other.post("/learning/reopen", { studySession }), studySession).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: REOPEN_DECLINED } });
    expect(await foreign.gateway("/learning/reopen", { studySession }), studySession).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: REOPEN_DECLINED } });
    expect(await foreign.raw("/learning/reopen", { studySession }), studySession).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  }
  // A request without a session is refused before any read, and one without a lesson is declined.
  expect((await app.browser().post("/learning/reopen", { studySession: lesson })).status).toBe(401);
  expect(await learner.post("/learning/reopen", {})).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: REOPEN_DECLINED } });

  expect(await app.concepts.GroundedTutoring._session({ session: lesson } as never)).toMatchObject([{ owner: user, status: "CLOSED" }]);
  // The owner can still continue it.
  expect(await learner.ok("/learning/reopen", { studySession: lesson })).toEqual({});
  expect(await app.concepts.GroundedTutoring._session({ session: lesson } as never)).toMatchObject([{ owner: user, status: "OPEN" }]);
}, 60_000);

test("a finished lesson whose every material was deleted still reopens, but the tutor cannot answer in it, and it can be finished again", async () => {
  const app = await setup(), { learner, material, skill } = await learningFixture(app, "deleted-continuer");
  const { lesson } = await openLesson(learner.ok, { skill, request: "Explain products." });
  await learner.ok("/learning/finish", { studySession: lesson });
  await learner.ok("/courses/materials/delete", { material });

  // Reopening needs no tutor source, so the server reopens the lesson; the lesson page does not offer it in this state.
  expect(await learner.ok("/learning/reopen", { studySession: lesson })).toEqual({});
  expect(await learner.post("/learning/question", { studySession: lesson, text: "And for 3 × 3?", dialogueLength: 0 }))
    .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SESSION_SOURCES_DELETED } });
  expect(sessionIn(await learner.ok("/learning/read", { skill }), lesson)).toMatchObject({ status: "OPEN", dialogue: [] });
  expect(await learner.ok("/learning/finish", { studySession: lesson })).toEqual({});
}, 60_000);
