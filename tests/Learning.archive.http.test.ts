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

// LearningAccess.md: ConversationReady's sentences, and the sentences of the admission entries an archived conversation meets.
const ARCHIVE_DECLINED = "Choose one of your own conversations to archive.";
const RESTORE_DECLINED = "Choose one of your own conversations to restore.";
const FINISH_DECLINED = "Choose one of your open lessons. A practice task closes when you submit it for assessment.";
const QUESTION_DECLINED = "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once.";
const RESPONSE_DECLINED = "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once.";
const HINT_DECLINED = "Choose an open practice task to request a hint.";
const ASSESS_DECLINED = "Review your complete answer and transcripts. If it was already submitted, use its saved assessment or retry.";

// The harness of Learning.finish.http.test.ts.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  // Estimates decay with time, so a test that compares them before and after holds the clock still.
  const time: { frozen?: Date } = {};
  let questions = 0;
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
      return { text: "Changing order pairs different rows and columns.", citations: [{ material, location }] };
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
  return { browser, native, concepts: runtime.application.concepts, freeze: () => { time.frozen = new Date(); } };
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
  const confirmed = async (title: string) => {
    const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title, outcome: `Work with ${title.toLowerCase()}`, gate: "Two worked examples and why" });
    await learner.ok("/courses/skills/confirm", { skill });
    return skill as string;
  };
  return { learner, user, course, skill: await confirmed("Products"), confirmed };
}
type Row = { studySession: string; status: string; title: string; archivedAt?: string };
const listed = (answer: { sessions: Row[] }) => answer.sessions.map((row) => row.studySession);

test("an archived open lesson leaves the sidebar and Continue, stays unchanged and read-only, and restoring brings it back as it was", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "archiver");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { lesson } = await openLesson(learner.ok, { skill, request: "Explain why the inner dimensions must match." });
  await learner.ok("/learning/question", { studySession: lesson, text: "So a 2×3 matrix times a 3×2 matrix works?", dialogueLength: 0 });
  const { lesson: other } = await openLesson(learner.ok, { skill, request: "Explain why order matters." });
  expect(listed(await learner.ok("/learning/recent", { course }))).toEqual([other, lesson]);
  const before = await learner.ok("/learning/read", { skill });
  expect(before.archived).toEqual([]);
  expect(await learner.ok("/learning/archived", { course })).toEqual({ sessions: [] });

  const asked = Date.now();
  expect(await learner.ok("/learning/archive", { studySession: lesson })).toEqual({});

  // It leaves the sidebar and the Continue card. Read still returns it, unchanged, and names it as archived.
  expect(listed(await learner.ok("/learning/recent", { course }))).toEqual([other]);
  expect(listed(await learner.ok("/learning/continue", { course }))).toEqual([other]);
  const after = await learner.ok("/learning/read", { skill });
  expect(after.archived).toEqual([lesson]);
  expect(after.sessions).toEqual(before.sessions);
  // The archived list gives the sidebar's fields for it, with when it was archived.
  const archived = await learner.ok("/learning/archived", { course });
  const recentRow = (await learner.ok("/learning/recent", { course: course })).sessions[0];
  expect(archived.sessions).toEqual([{ studySession: lesson, skill, skillTitle: "Products", kind: "LESSON", status: "OPEN", title: "Explain why the inner dimensions must match.",
    startedAt: archived.sessions[0].startedAt, lastActivity: archived.sessions[0].lastActivity, archivedAt: archived.sessions[0].archivedAt }]);
  expect(Object.keys(recentRow).sort()).toEqual(Object.keys(archived.sessions[0]).filter((key) => key !== "archivedAt").sort());
  expect(Date.parse(archived.sessions[0].archivedAt)).toBeGreaterThanOrEqual(asked - 1000);

  // While it is archived it is read-only on every path: HTTP and the gateway decline with admission's sentence, and the
  // raw invoker gets the endpoint's own refusal.
  const owner = await app.native(user);
  expect(await learner.post("/learning/question", { studySession: lesson, text: "One more question?", dialogueLength: 2 })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: QUESTION_DECLINED } });
  expect(await learner.post("/learning/respond", { studySession: lesson, text: "A note.", dialogueLength: 2 })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: RESPONSE_DECLINED } });
  expect(await learner.post("/learning/finish", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: FINISH_DECLINED } });
  expect(await owner.gateway("/learning/finish", { studySession: lesson })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: FINISH_DECLINED } });
  for (const [path, input] of [["/learning/respond", { text: "A note.", channel: "TEXT", attachments: [], dialogueLength: 2 }], ["/learning/reply", {}], ["/learning/finish", {}],
    ["/learning/transcript", { turnIndex: 0, text: "So it works?" }]] as const) {
    expect(await owner.raw(path, { studySession: lesson, ...input }), path).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  }
  expect((await learner.ok("/learning/read", { skill })).sessions).toEqual(before.sessions);

  // Archiving it again changes nothing and keeps the time it was first archived.
  expect(await learner.ok("/learning/archive", { studySession: lesson })).toEqual({});
  expect(await learner.ok("/learning/archived", { course })).toEqual(archived);

  // Restoring puts it back at its place by last activity, open, in Continue, and it can be continued again.
  expect(await learner.ok("/learning/restore", { studySession: lesson })).toEqual({});
  expect(listed(await learner.ok("/learning/recent", { course }))).toEqual([other, lesson]);
  expect(listed(await learner.ok("/learning/continue", { course }))).toEqual([lesson, other]);
  expect(await learner.ok("/learning/archived", { course })).toEqual({ sessions: [] });
  const restored = await learner.ok("/learning/read", { skill });
  expect(restored.archived).toEqual([]);
  expect(restored.sessions).toEqual(before.sessions);
  await learner.ok("/learning/question", { studySession: lesson, text: "And a 3×2 matrix times a 2×3 one?", dialogueLength: 2 });
  expect((await learner.ok("/learning/read", { skill })).sessions.find((session: { session: string }) => session.session === lesson).dialogue).toHaveLength(4);
  expect(listed(await learner.ok("/learning/recent", { course }))).toEqual([lesson, other]);
  // Restoring again changes nothing; it can also be finished through the gateway as before.
  expect(await owner.gateway("/learning/restore", { studySession: lesson })).toEqual({ ok: true, value: {} });
  expect(await owner.gateway("/learning/finish", { studySession: lesson })).toEqual({ ok: true, value: {} });
}, 60_000);

test("finished and submitted conversations archive and restore too, and archiving changes no case, estimate, curve, or plan", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "evidence-keeper");
  await learner.ok("/planning/configure", { course, dailyMinutes: 20 });
  await learner.ok("/learning/confidence", { skill, confidence: 40 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  const { lesson } = await openLesson(learner.ok, { skill, request: "Explain transposes of products." });
  await learner.ok("/learning/finish", { studySession: lesson });

  // Everything the evidence and the plan show, read through the endpoints and the concepts' own queries, at one moment.
  app.freeze();
  const evidence = async () => {
    const { archived: _archived, ...read } = await learner.ok("/learning/read", { skill });
    return { read, progress: await learner.ok("/learning/progress", { course }), memory: await learner.ok("/learning/memory", { course }),
      plan: await learner.ok("/planning/read", { course }), tracks: await app.concepts.MasteryEstimating._tracks({ learner: user, subject: skill } as never),
      cases: await app.concepts.AssessmentReviewing._history({ author: user, subject: skill } as never) };
  };
  const saved = await evidence();
  expect(saved.read.estimate).not.toBeNull();
  expect(saved.read.cases).toHaveLength(1);
  expect(saved.read.cases[0].judgment).toMatchObject({ result: "INDEPENDENT" });
  expect(saved.tracks).not.toHaveLength(0);
  expect(saved.cases.cases).toHaveLength(1);
  expect(saved.memory.skills).toHaveLength(1);
  expect(saved.plan.next).toMatchObject({ candidate: { subject: skill } });
  expect(saved.plan.plan.items).not.toHaveLength(0);
  const statuses = (read: { sessions: { session: string; status: string }[] }) => read.sessions.map((session) => [session.session, session.status]);
  expect(statuses(saved.read)).toEqual([[task, "CLOSED"], [lesson, "CLOSED"]]);

  // The finished lesson and the submitted attempt both leave the sidebar; Read names both as archived.
  expect(await learner.ok("/learning/archive", { studySession: lesson })).toEqual({});
  expect(await learner.ok("/learning/archive", { studySession: task })).toEqual({});
  expect(listed(await learner.ok("/learning/archived", { course })).sort()).toEqual([task, lesson].sort());
  expect(await learner.ok("/learning/recent", { course })).toEqual({ sessions: [] });
  expect((await learner.ok("/learning/read", { skill })).archived.sort()).toEqual([task, lesson].sort());
  const whileArchived = await evidence();
  expect(whileArchived.read).toEqual(saved.read);
  expect(whileArchived.progress).toEqual(saved.progress);
  expect(whileArchived.memory).toEqual(saved.memory);
  expect(whileArchived.plan).toEqual(saved.plan);
  expect(whileArchived.tracks).toEqual(saved.tracks);
  expect(whileArchived.cases).toEqual(saved.cases);

  // Restoring both changes nothing either, and their statuses stay as they were.
  await learner.ok("/learning/restore", { studySession: task });
  await learner.ok("/learning/restore", { studySession: lesson });
  expect(listed(await learner.ok("/learning/recent", { course })).sort()).toEqual([task, lesson].sort());
  const afterRestore = await evidence();
  expect(afterRestore).toEqual(saved);
}, 60_000);

test("an archived open practice task refuses a hint and an assessment until it is restored", async () => {
  const app = await setup(), { learner, course, skill } = await learningFixture(app, "practice-archiver");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  expect(await learner.ok("/learning/archive", { studySession: task })).toEqual({});
  expect(await learner.ok("/learning/archived", { course })).toMatchObject({ sessions: [{ studySession: task, kind: "PRACTICE", status: "OPEN", title: "Practice · Products" }] });

  expect(await learner.post("/learning/hint", { studySession: task })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: HINT_DECLINED } });
  expect(await learner.post("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false }))
    .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: ASSESS_DECLINED } });
  const read = await learner.ok("/learning/read", { skill });
  expect(read.cases).toEqual([]);
  expect(read.sessions[0].dialogue).toHaveLength(1);

  await learner.ok("/learning/restore", { studySession: task });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  expect((await learner.ok("/learning/read", { skill })).cases).toMatchObject([{ task, judgment: { result: "INDEPENDENT" } }]);
}, 60_000);

test("only the owner archives or restores a conversation; another learner's and an unknown one are refused on every path", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "conversation-owner");
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  const outsider = app.browser(), { user: outsiderUser } = await outsider.signIn("conversation-outsider");
  const { course: ownCourse } = await outsider.ok("/courses/create", { title: "Statistics" });
  const foreign = await app.native(outsiderUser);

  for (const target of [lesson, "00000000-0000-7000-8000-000000000000", "missing-session"]) {
    expect(await outsider.post("/learning/archive", { studySession: target }), target).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: ARCHIVE_DECLINED } });
    expect(await outsider.post("/learning/restore", { studySession: target }), target).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: RESTORE_DECLINED } });
    expect(await foreign.gateway("/learning/archive", { studySession: target })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: ARCHIVE_DECLINED } });
    expect(await foreign.gateway("/learning/restore", { studySession: target })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: RESTORE_DECLINED } });
    // Without admission, each endpoint answers its own refusal instead of leaving the request unanswered.
    for (const path of ["/learning/archive", "/learning/restore"]) {
      expect(await foreign.raw(path, { studySession: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
    }
  }
  // Nothing was archived for anyone: the owner still lists the lesson, and the outsider has no archive at all.
  expect(listed(await learner.ok("/learning/recent", { course }))).toEqual([lesson]);
  expect((await learner.ok("/learning/read", { skill })).archived).toEqual([]);
  expect(await app.concepts.ConversationArchiving._itemSet({ owner: outsiderUser as never })).toEqual({ items: [] });
  expect(await app.concepts.ConversationArchiving._itemSet({ owner: user as never })).toEqual({ items: [] });

  // Once the owner archives it, the outsider still cannot restore it, and cannot read either archived list but their own.
  await learner.ok("/learning/archive", { studySession: lesson });
  expect(await outsider.post("/learning/restore", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: RESTORE_DECLINED } });
  expect(await foreign.raw("/learning/restore", { studySession: lesson })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  expect((await learner.ok("/learning/archived", { course })).sessions.map((row: Row) => row.studySession)).toEqual([lesson]);
  for (const target of [course, "missing-course"]) {
    const answer = await outsider.post("/learning/archived", { course: target });
    expect(answer).toMatchObject({ status: 403, body: { error: "FORBIDDEN" } });
    expect(JSON.stringify(answer.body)).not.toContain(lesson);
    expect(await foreign.raw("/learning/archived", { course: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
  }
  expect(await outsider.ok("/learning/archived", { course: ownCourse })).toEqual({ sessions: [] });
  // The owner's native calls work, and a request without a session is refused.
  const owner = await app.native(user);
  expect(await owner.gateway("/learning/restore", { studySession: lesson })).toEqual({ ok: true, value: {} });
  expect(await owner.raw("/learning/archive", { studySession: lesson })).toEqual({ ok: true, value: {} });
  for (const path of ["/learning/archive", "/learning/restore"]) expect((await app.browser().post(path, { studySession: lesson })).status).toBe(401);
  expect((await app.browser().post("/learning/archived", { course })).status).toBe(401);
}, 60_000);

test("the archived list shows the latest archived first and leaves out a conversation whose skill is archived until the skill is restored", async () => {
  const app = await setup(), { learner, course, skill, confirmed } = await learningFixture(app, "skill-archiver");
  const other = await confirmed("Transposes");
  const { lesson } = await learner.ok("/learning/lesson", { skill: other, request: "Explain transposes." });
  const { lesson: kept } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  await learner.ok("/learning/archive", { studySession: lesson });
  await Bun.sleep(5);
  await learner.ok("/learning/archive", { studySession: kept });
  expect(listed(await learner.ok("/learning/archived", { course }))).toEqual([kept, lesson]);
  // Archiving a conversation again does not move it to the top.
  await learner.ok("/learning/archive", { studySession: lesson });
  expect(listed(await learner.ok("/learning/archived", { course }))).toEqual([kept, lesson]);
  await learner.ok("/courses/skills/archive", { skill: other });
  expect(listed(await learner.ok("/learning/archived", { course }))).toEqual([kept]);
  await learner.ok("/courses/skills/restore", { skill: other });
  expect(listed(await learner.ok("/learning/archived", { course }))).toEqual([kept, lesson]);
  // Restoring a conversation brings it back to the sidebar, which never listed it while it was archived.
  expect(await learner.ok("/learning/recent", { course })).toEqual({ sessions: [] });
  await learner.ok("/learning/restore", { studySession: lesson });
  expect(listed(await learner.ok("/learning/recent", { course }))).toEqual([lesson]);
  expect(listed(await learner.ok("/learning/archived", { course }))).toEqual([kept]);
}, 60_000);
