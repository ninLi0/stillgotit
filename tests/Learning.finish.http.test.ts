import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// LearningAccess.md: FinishReady's sentence, for a session that is not one of the learner's open lessons.
const FINISH_DECLINED = "Choose one of your open lessons. A practice task closes when you submit it for assessment.";
const QUESTION_DECLINED = "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once.";

// The harness of Learning.continue.http.test.ts.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
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
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  function browser() {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachments: [], ...body };
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
  return { browser, native, concepts: runtime.application.concepts };
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
  return { learner, user, course, skill: skill as string };
}
type Session = { session: string; status: string; dialogue: unknown[] };
const statuses = (read: { sessions: Session[] }) => read.sessions.map((session) => [session.session, session.status]);
const listed = (answer: { sessions: { studySession: string }[] }) => answer.sessions.map((row) => row.studySession);

test("the owner finishes an open lesson: it reads as closed with its dialogue, leaves Continue, and cannot be finished or used again", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "finisher");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain why the inner dimensions must match." });
  await learner.ok("/learning/question", { studySession: lesson, text: "So a 2×3 matrix times a 3×2 matrix works?", dialogueLength: 0 });
  const { lesson: other } = await learner.ok("/learning/lesson", { skill, request: "Explain why order matters." });
  expect(listed(await learner.ok("/learning/continue", { course }))).toEqual([lesson, other]);
  const before = await learner.ok("/learning/read", { skill });
  const tracks = () => app.concepts.MasteryEstimating._tracks({ learner: user, subject: skill } as never), savedTracks = await tracks();

  expect(await learner.ok("/learning/finish", { studySession: lesson })).toEqual({});

  // The finished lesson keeps its request, explanation, and dialogue; only its status changes.
  const after = await learner.ok("/learning/read", { skill });
  expect(statuses(after)).toEqual([[lesson, "CLOSED"], [other, "OPEN"]]);
  const finished = after.sessions.find((session: Session) => session.session === lesson);
  expect(finished).toEqual({ ...before.sessions.find((session: Session) => session.session === lesson), status: "CLOSED" });
  expect(finished.dialogue).toHaveLength(2);
  // Nothing reacts to closing a lesson: no case, and the saved mastery tracks are unchanged.
  expect(after.cases).toEqual([]);
  expect(await tracks()).toEqual(savedTracks);
  // Continue lists only the lesson that is still open.
  expect(await learner.ok("/learning/continue", { course })).toEqual({ sessions: [{ studySession: other, skill, title: "Products", kind: "LESSON", lastActive: null }] });

  // A second finish is refused on every path, as is any further work in the finished lesson.
  expect(await learner.post("/learning/finish", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: FINISH_DECLINED } });
  const owner = await app.native(user);
  expect(await owner.gateway("/learning/finish", { studySession: lesson })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: FINISH_DECLINED } });
  expect(await owner.raw("/learning/finish", { studySession: lesson })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  expect(await learner.post("/learning/question", { studySession: lesson, text: "One more question?", dialogueLength: 2 })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: QUESTION_DECLINED } });
  expect(await owner.raw("/learning/respond", { studySession: lesson, text: "One more note.", channel: "TEXT", attachments: [], dialogueLength: 2 }))
    .toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  expect(await owner.raw("/learning/reply", { studySession: lesson })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  expect((await learner.ok("/learning/read", { skill })).sessions).toEqual(after.sessions);

  // The other lesson can still be finished through the native gateway, and then nothing is left to continue.
  expect(await owner.gateway("/learning/finish", { studySession: other })).toEqual({ ok: true, value: {} });
  expect(await learner.ok("/learning/continue", { course })).toEqual({ sessions: [] });
  expect(statuses(await learner.ok("/learning/read", { skill }))).toEqual([[lesson, "CLOSED"], [other, "CLOSED"]]);
}, 60_000);

test("a practice task cannot be finished on any path; it stays open until its attempt is submitted", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "practice-finisher");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  const before = await learner.ok("/learning/read", { skill });

  const owner = await app.native(user);
  expect(await learner.post("/learning/finish", { studySession: task })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: FINISH_DECLINED } });
  expect(await owner.gateway("/learning/finish", { studySession: task })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: FINISH_DECLINED } });
  // Without admission, the endpoint's "practice" branch answers instead of leaving the request unanswered.
  expect(await owner.raw("/learning/finish", { studySession: task })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  const read = await learner.ok("/learning/read", { skill });
  expect(read.sessions).toEqual(before.sessions);
  expect(read.cases).toEqual([]);
  expect(statuses(read)).toEqual([[task, "OPEN"]]);
  expect(await learner.ok("/learning/continue", { course })).toMatchObject({ sessions: [{ studySession: task, kind: "PRACTICE" }] });

  // Submitting is how a task closes. Once it is submitted, finishing it is refused as a session that is not open.
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  expect(statuses(await learner.ok("/learning/read", { skill }))).toEqual([[task, "CLOSED"]]);
  expect(await learner.post("/learning/finish", { studySession: task })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: FINISH_DECLINED } });
  expect(await owner.raw("/learning/finish", { studySession: task })).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
}, 60_000);

test("another learner cannot finish the owner's lesson on any path, and the lesson stays open", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "finish-owner");
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  const other = app.browser(), outsider = await other.signIn("finish-outsider");
  const foreign = await app.native(outsider.user);

  for (const studySession of [lesson, "missing-session"]) {
    expect(await other.post("/learning/finish", { studySession }), studySession).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: FINISH_DECLINED } });
    expect(await foreign.gateway("/learning/finish", { studySession }), studySession).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: FINISH_DECLINED } });
    expect(await foreign.raw("/learning/finish", { studySession }), studySession).toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  }
  // A request without a session is refused before any read.
  expect((await app.browser().post("/learning/finish", { studySession: lesson })).status).toBe(401);

  expect(await app.concepts.GroundedTutoring._session({ session: lesson } as never)).toMatchObject([{ owner: user, status: "OPEN" }]);
  expect(statuses(await learner.ok("/learning/read", { skill }))).toEqual([[lesson, "OPEN"]]);
  expect(listed(await learner.ok("/learning/continue", { course }))).toEqual([lesson]);
  // The owner can still finish it.
  expect(await learner.ok("/learning/finish", { studySession: lesson })).toEqual({});
  expect(await app.concepts.GroundedTutoring._session({ session: lesson } as never)).toMatchObject([{ owner: user, status: "CLOSED" }]);
}, 60_000);
