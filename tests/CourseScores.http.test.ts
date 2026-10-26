import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { averageEstimate } from "../src/computations/course-score.ts";
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
  let questions = 0;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
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
  async function native(user: string) {
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user as never });
    if ("error" in signedIn) throw new Error("Test session was refused");
    return (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 });
  }
  return { browser, native };
}
type Learner = ReturnType<Awaited<ReturnType<typeof setup>>["browser"]>;
function upload(course: string, name = "lesson.md", text = "# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match.") {
  const form = new FormData(); form.set("course", course); form.set("title", name); form.set("requestId", crypto.randomUUID());
  form.append("files", new File([text], name, { type: "text/markdown" })); return form;
}
async function courseWithSkills(learner: Learner, title: string, skills: string[]) {
  const { course } = await learner.ok("/courses/create", { title });
  const { material } = await learner.ok("/courses/materials/add", upload(course));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const ids: string[] = [];
  for (const name of skills) {
    const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: name, outcome: `Work with ${name.toLowerCase()}`, gate: "Two worked examples and why" });
    await learner.ok("/courses/skills/confirm", { skill });
    ids.push(skill);
  }
  return { course: course as string, unit: unit as string, material: material as string, skills: ids };
}
async function practise(learner: Learner, skill: string) {
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
}

test("Scores answers each active course's confidence, the Forest view's average, for the signed-in learner only", async () => {
  const app = await setup(), ada = app.browser(), { user } = await ada.signIn("scores-ada");
  expect(await ada.ok("/courses/scores")).toEqual({ courses: [] });

  // Linear algebra: one skill at 50%, one lifted to 95% by an assessment, one with no starting point, and a draft.
  const algebra = await courseWithSkills(ada, "Linear algebra", ["Products", "Transposes", "Inverses"]);
  const [products, transposes] = algebra.skills as [string, string, string];
  await ada.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit: algebra.unit, material: algebra.material, title: "Determinants", outcome: "Find determinants", gate: "One determinant and why" });
  await ada.ok("/learning/confidence", { skill: products, confidence: 50 });
  await ada.ok("/learning/confidence", { skill: transposes, confidence: 50 });
  await practise(ada, transposes);
  // Statistics has no skill yet, and Geometry is archived.
  const { course: statistics } = await ada.ok("/courses/create", { title: "Statistics" });
  const geometry = await courseWithSkills(ada, "Geometry", ["Angles"]);
  await ada.ok("/learning/confidence", { skill: geometry.skills[0], confidence: 90 });
  await ada.ok("/courses/archive", { course: geometry.course });

  const { courses } = await ada.ok("/courses/scores");
  // The skill without a starting point is left out of the average, not counted as 0, and the draft is not a skill yet.
  expect(courses).toEqual([
    { course: algebra.course, score: 72, skills: 3, estimated: 2 },
    { course: statistics, score: null, skills: 0, estimated: 0 },
  ].sort((a, b) => (a.course < b.course ? -1 : 1)));
  // The score is the Forest view's average of the same course's estimates.
  const { estimates } = await ada.ok("/learning/progress", { course: algebra.course });
  expect(averageEstimate(estimates.map((row: { estimate: { value: number } | null }) => row.estimate?.value ?? null))).toBe(72);
  // The runtime gateway answers the same rows.
  expect(await (await app.native(user))("/courses/scores", {})).toEqual({ ok: true, value: { courses } });

  // Another learner sees only their own courses, never Ada's.
  const bea = app.browser();
  await bea.signIn("scores-bea");
  expect(await bea.ok("/courses/scores")).toEqual({ courses: [] });
  const own = await courseWithSkills(bea, "Physics", ["Vectors"]);
  await bea.ok("/learning/confidence", { skill: own.skills[0], confidence: 40 });
  const theirs = await bea.ok("/courses/scores");
  expect(theirs).toEqual({ courses: [{ course: own.course, score: 40, skills: 1, estimated: 1 }] });
  expect(JSON.stringify(theirs)).not.toContain(algebra.course);
  // Without a session the read is refused before anything is read.
  expect((await app.browser().post("/courses/scores")).status).toBe(401);
}, 60_000);
