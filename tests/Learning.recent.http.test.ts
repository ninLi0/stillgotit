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

// The harness of Learning.continue.http.test.ts.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.explanation) return { explanation: "Match a row to a column.", citations: [{ material, location }] };
      if (properties.question) return { question: "Compute [[1,2],[3,4]] × [[2,0],[1,2]]. Why does order matter?", citations: [{ material, location }] };
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
  return { browser, native };
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
type Row = { studySession: string; skill: string; skillTitle: string; kind: string; status: string; title: string; startedAt: string | null; lastActivity: string | null };
const ids = (rows: Row[]) => rows.map((row) => row.studySession);

test("Recent lists every lesson and practice session in the course, newest activity first, closed ones included", async () => {
  const app = await setup(), { learner, course, skill, confirmed } = await learningFixture(app, "recent-learner");
  expect(await learner.ok("/learning/recent", { course })).toEqual({ sessions: [] });

  const request = "Explain why the inner dimensions must match when two matrices are multiplied together.";
  const before = Date.now();
  const { lesson } = await learner.ok("/learning/lesson", { skill, request });
  const after = Date.now();
  let { sessions } = await learner.ok("/learning/recent", { course }) as { sessions: Row[] };
  // A lesson is titled by its request, cut at a word near 60 characters. Before any turn its activity is its start.
  expect(sessions).toEqual([{ studySession: lesson, skill, skillTitle: "Products", kind: "LESSON", status: "OPEN",
    title: "Explain why the inner dimensions must match when two…", startedAt: sessions[0]!.startedAt, lastActivity: sessions[0]!.startedAt }]);
  expect(Date.parse(sessions[0]!.startedAt!)).toBeGreaterThanOrEqual(before - 1000);
  expect(Date.parse(sessions[0]!.startedAt!)).toBeLessThanOrEqual(after + 1000);

  // A submitted practice attempt is closed and still listed, titled by its skill; it started after the lesson.
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task: submitted } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: submitted, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: submitted, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  ({ sessions } = await learner.ok("/learning/recent", { course }));
  expect(sessions.map((row) => [row.studySession, row.kind, row.status, row.title])).toEqual([[submitted, "PRACTICE", "CLOSED", "Practice · Products"], [lesson, "LESSON", "OPEN", "Explain why the inner dimensions must match when two…"]]);
  // The practice session's last activity is its latest turn, after its start.
  expect(Date.parse(sessions[0]!.lastActivity!)).toBeGreaterThan(Date.parse(sessions[0]!.startedAt!));

  // A lesson in another skill starts newest; a turn in the first lesson then moves it to the top.
  const other = await confirmed("Transposes");
  const { lesson: transposes } = await learner.ok("/learning/lesson", { skill: other, request: "Explain transposes." });
  ({ sessions } = await learner.ok("/learning/recent", { course }));
  expect(ids(sessions)).toEqual([transposes, submitted, lesson]);
  expect(sessions[0]).toMatchObject({ skill: other, skillTitle: "Transposes", title: "Explain transposes." });
  await learner.ok("/learning/respond", { studySession: lesson, text: "So a 2×3 matrix times a 3×2 matrix works?", dialogueLength: 0 });
  ({ sessions } = await learner.ok("/learning/recent", { course }));
  expect(ids(sessions)).toEqual([lesson, transposes, submitted]);
  expect(Date.parse(sessions[0]!.lastActivity!)).toBeGreaterThan(Date.parse(sessions[0]!.startedAt!));

  // A finished lesson stays listed as closed. An archived skill has no study page, so its conversations leave the list.
  await learner.ok("/learning/finish", { studySession: lesson });
  expect((await learner.ok("/learning/recent", { course })).sessions.map((row: Row) => [row.studySession, row.status])).toEqual([[lesson, "CLOSED"], [transposes, "OPEN"], [submitted, "CLOSED"]]);
  await learner.ok("/courses/skills/archive", { skill: other });
  expect(ids((await learner.ok("/learning/recent", { course })).sessions)).toEqual([lesson, submitted]);
}, 60_000);

test("Recent answers at most 40 sessions, the most recently active ones", async () => {
  const app = await setup(), { learner, course, skill } = await learningFixture(app, "recent-many");
  const lessons: string[] = [];
  for (let n = 1; n <= 42; n++) lessons.push((await learner.ok("/learning/lesson", { skill, request: `Question ${n}` })).lesson);
  let { sessions } = await learner.ok("/learning/recent", { course }) as { sessions: Row[] };
  expect(sessions).toHaveLength(40);
  // The two oldest lessons are left out.
  expect(ids(sessions)).toEqual(lessons.slice(2).reverse());
  // A new turn in the oldest lesson brings it back at the top, and the oldest of the rest leaves.
  await learner.ok("/learning/respond", { studySession: lessons[0], text: "One more question.", dialogueLength: 0 });
  ({ sessions } = await learner.ok("/learning/recent", { course }));
  expect(sessions).toHaveLength(40);
  expect(ids(sessions)).toEqual([lessons[0]!, ...lessons.slice(3).reverse()]);
}, 120_000);

test("Recent refuses a course the learner does not own and shows nothing of it", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "recent-owner");
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  const other = app.browser(), outsider = await other.signIn("recent-outsider");
  const { course: ownCourse } = await other.ok("/courses/create", { title: "Statistics" });

  for (const target of [course, "missing-course"]) {
    const answer = await other.post("/learning/recent", { course: target });
    expect(answer).toMatchObject({ status: 403, body: { error: "FORBIDDEN" } });
    expect(JSON.stringify(answer.body)).not.toContain(lesson);
    const foreign = await app.native(outsider.user);
    expect(await foreign.gateway("/learning/recent", { course: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
    expect(await foreign.raw("/learning/recent", { course: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
  }
  // The outsider's own course lists only the outsider's sessions, which are none.
  expect(await other.ok("/learning/recent", { course: ownCourse })).toEqual({ sessions: [] });
  // The owner still sees the lesson through the gateway and the raw invoker, and a request without a session is refused.
  const owner = await app.native(user);
  expect(await owner.gateway("/learning/recent", { course })).toMatchObject({ ok: true, value: { sessions: [{ studySession: lesson, kind: "LESSON", title: "Explain products." }] } });
  expect(await owner.raw("/learning/recent", { course })).toMatchObject({ ok: true, value: { sessions: [{ studySession: lesson, kind: "LESSON" }] } });
  expect((await app.browser().post("/learning/recent", { course })).status).toBe(401);
}, 60_000);
