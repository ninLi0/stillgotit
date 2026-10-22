import { afterAll, expect, spyOn, test } from "bun:test";
import { FindCursor } from "mongodb";
import { composition as Courses } from "../src/compositions/courses.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), sessions: Awaited<ReturnType<typeof createRuntime>>[] = [], owners: string[] = [];
  let failGrade = false, independent = true, generated = 0;
  let beforeGenerate: (() => Promise<void>) | undefined;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [{ title: "Multiply matrices", outcome: "Compute products and explain why order matters.", gate: "Solve two new products and explain why order matters." }] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      generated++;
      if (beforeGenerate) { const work = beforeGenerate; beforeGenerate = undefined; await work(); }
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.explanation) return { explanation: "Match a row to a column. The inner dimensions must match.", citations: [{ material, location }] };
      if (properties.question) return { question: "Compute [[1,2],[3,4]] × [[2,0],[1,2]], and [[2,1],[0,3]] × [[1,2],[4,0]]. Why does order matter?", citations: [{ material, location }] };
      if (properties.rationale) {
        if (failGrade) { failGrade = false; throw new Error("Fixture provider interruption"); }
        const help = (context as { help: string }).help;
        return { result: help === "HINT" ? "SUPPORTED" : independent ? "INDEPENDENT" : "SLIP", gateMet: help === "NONE" && independent,
          rationale: independent ? "Both results and the explanation meet the saved gate." : "One sum is wrong, but the method is sound." };
      }
      return { text: properties.citations ? "Changing order pairs different rows and columns." : "Start by checking the dimensions.", citations: [{ material, location }] };
    },
  };
  const open = async () => { const r = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor }); sessions.push(r); return r; };
  let runtime = await open();
  cleanups.push(async () => { for (const r of sessions) await r.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  function browser() {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachment: "", ...body };
      if (path === "/planning/configure" && !(body instanceof FormData)) body = { focusNote: "", ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload.suggestions ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
    async function signIn(name: string) { const start = await ok("/auth/commons/start"); await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name })); const identity = await ok("/auth/commons/resume"); owners.push(identity.user); return identity; }
    // Saved files come back as bytes, not JSON, so downloads read the raw response.
    async function download(body: Record<string, unknown>) {
      return runtime.handle(new Request(`${ORIGIN}/api/courses/materials/file`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json",
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") }, body: JSON.stringify(body) }));
    }
    return { post, ok, signIn, download };
  }
  return { browser, connection, get runtime() { return runtime; }, get generated() { return generated; }, duringGeneration: (work: () => Promise<void>) => { beforeGenerate = work; }, interruptGrade: () => { failGrade = true; }, slip: () => { independent = false; },
    restart: async () => { await runtime.gateway.beginDrain(); runtime = await open(); } };
}
function upload(course: string, requestId: string) { const form = new FormData(); form.set("course", course); form.set("title", "Matrix multiplication"); form.set("requestId", requestId);
  form.append("files", new File(["# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match. Matrix multiplication is not commutative."], "lesson.md", { type: "text/markdown" })); return form; }

test("P2 journey starts empty, imports, confirms, learns, reviews voice, assesses, replans, and survives restart", async () => {
  const app = await setup(), learner = app.browser(), other = app.browser();
  await learner.signIn("maya"); await other.signIn("leo");
  const { course } = await learner.ok("/courses/create", { title: "MIT 18.06SC Linear Algebra" });
  const requestId = crypto.randomUUID(), imported = await learner.ok("/courses/materials/add", upload(course, requestId));
  expect(await learner.ok("/courses/materials/add", upload(course, requestId))).toEqual(imported);
  expect((await other.post("/courses/materials/read", imported)).status).toBe(403);
  expect((await learner.post("/courses/materials/add", { course, content: "Forged preparation" })).status).toBe(400);
  const suggestion = await learner.ok("/courses/skills/suggest", imported), { unit } = await learner.ok("/courses/units/add", { course, title: suggestion.unitTitle });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, ...imported, ...suggestion.skills[0] });
  await learner.ok("/courses/skills/confirm", { skill });
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain why the dimensions matter." });
  await learner.ok("/learning/question", { studySession: lesson, text: "Why is order important?", channel: "TEXT", dialogueLength: 0 });
  const answered = await learner.ok("/learning/read", { skill });
  expect(answered.sessions[0].dialogue.at(-1).turn.speaker).toBe("TUTOR");
  const { task } = await learner.ok("/learning/task", { skill });
  expect((await other.post("/learning/respond", { studySession: task, text: "Changed work", dialogueLength: 0 })).status).toBe(400);
  expect((await learner.post("/internal/learning/assess", { case: "fake", result: "INDEPENDENT", gateMet: true })).status).toBe(403);
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Second [[6,4],[12,0]]. A row meets a column, so changing order changes the pairing.", channel: "VOICE", dialogueLength: 0 });
  expect((await learner.post("/learning/assess", { studySession: task, reviewed: false, unseen: true, outsideHelp: false, dialogueLength: 1 })).status).toBe(400);
  app.interruptGrade();
  const review = { studySession: task, reviewed: true, unseen: true, outsideHelp: false, dialogueLength: 1 };
  // A provider failure is explained and retryable, not "Check the field".
  expect(await learner.post("/learning/assess", review)).toMatchObject({ status: 400,
    body: { error: "INVALID_REQUEST", detail: "The tutor could not produce a usable answer. Try again. Your saved work is still available." } });
  await app.restart();
  await learner.ok("/learning/retry", { studySession: task });
  const result = await learner.ok("/learning/read", { skill });
  expect(result.cases).toHaveLength(1); expect(result.cases[0].history).toHaveLength(1);
  expect(result.cases[0].judgment.result).toBe("INDEPENDENT");
  expect(result.estimate.value).toBeGreaterThan(94.99); expect(result.estimate.ready).toBe(true);
  expect((await learner.ok("/learning/progress", { course })).estimates[0].estimate.value).toBeGreaterThan(94.99);
  await learner.ok("/planning/configure", { course, dailyMinutes: 30 });
  await learner.ok("/planning/propose", { course });
  const plan = await learner.ok("/planning/read", { course });
  expect(plan.next.candidate.subject).toBe(skill); expect(plan.next.day > plan.today).toBe(true);
  await app.restart();
  const saved = await learner.ok("/learning/read", { skill });
  expect(saved.sessions).toHaveLength(2); expect(saved.cases).toHaveLength(1);
  expect(saved.sessions.find((s: { session: string }) => s.session === task).voice[0].confirmed).toBe(true);
  expect((await learner.ok("/planning/read", { course })).next).toEqual(plan.next);
  const before = saved.cases[0].judgment.judgment;
  await learner.ok("/learning/correct", { case: saved.cases[0].case, basedOn: before, result: "SLIP", gateMet: false, reason: "The second multiplication has a small arithmetic error." });
  const revised = await learner.ok("/learning/read", { skill });
  expect(revised.cases[0].history).toHaveLength(2); expect(revised.estimate.value).toBeLessThan(45.01);
}, 60_000);

test("only the learner who uploaded a file can download it", async () => {
  const app = await setup(), learner = app.browser(), other = app.browser(), anonymous = app.browser();
  await learner.signIn("file-owner"); await other.signIn("file-outsider");
  const { course } = await learner.ok("/courses/create", { title: "Matrices" });
  const { material } = await learner.ok("/courses/materials/add", upload(course, crypto.randomUUID()));
  const { originals } = await learner.ok("/courses/materials/read", { material }), file = originals[0].file;

  const own = await learner.download({ material, file });
  expect(own.status).toBe(200);
  expect(own.headers.get("Content-Disposition")).toBe("attachment");
  expect(await own.text()).toContain("Matrix multiplication is not commutative.");

  // Knowing the exact material and file references is not enough for anyone else.
  expect((await other.download({ material, file })).status).toBe(403);
  expect((await anonymous.download({ material, file })).status).toBe(401);
  // The owner can only fetch files saved with this material, and only for a material that exists.
  expect((await learner.download({ material, file: "../other/notes.pdf" })).status).toBe(403);
  expect((await learner.download({ material: crypto.randomUUID(), file })).status).toBe(403);
  expect((await learner.download({ material })).status).toBe(403);
  // Refused attempts change nothing: the owner can still download the same bytes.
  expect(await (await learner.download({ material, file })).text()).toContain("Matrix multiplication is not commutative.");
});

test("skill draft saves recover lost replies through HTTP and preserve later edits", async () => {
  const app = await setup(), learner = app.browser(), other = app.browser();
  await learner.signIn("draft-owner"); await other.signIn("draft-other");
  const { course } = await learner.ok("/courses/create", { title: "Matrices" });
  const { material } = await learner.ok("/courses/materials/add", upload(course, crypto.randomUUID()));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const input = { unit, material, proposalKey: crypto.randomUUID(), title: "Multiply matrices", outcome: "Compute products", gate: "Explain two products" };
  // Discard the first successful response, as if it never reached the browser.
  await learner.ok("/courses/skills/propose", input);
  await app.restart();
  const recovered = await learner.ok("/courses/skills/propose", input);
  expect((await learner.ok("/courses/read", { course })).skills).toHaveLength(1);
  expect(await Promise.all(Array.from({ length: 4 }, () => learner.ok("/courses/skills/propose", input))))
    .toEqual(Array.from({ length: 4 }, () => recovered));
  const conflict = await learner.post("/courses/skills/propose", { ...input, gate: "Changed requirements" });
  expect(conflict.status).toBe(409); expect(conflict.body.error).toBe("CONFLICT");
  expect((await other.post("/courses/skills/propose", input)).status).toBe(403);
  const { proposalKey: _key, ...withoutKey } = input;
  expect((await learner.post("/courses/skills/propose", withoutKey)).status).toBe(400);
  await learner.ok("/courses/skills/edit", { ...withoutKey, ...recovered, title: "Revised title" });
  await learner.ok("/courses/skills/confirm", recovered);
  expect(await learner.ok("/courses/skills/propose", input)).toEqual(recovered);
  expect((await learner.ok("/courses/read", { course })).skills).toMatchObject([{ ...recovered, title: "Revised title", status: "CONFIRMED" }]);
}, 60_000);

test("a recorded hint prevents independent mastery even when the browser asks for it", async () => {
  const app = await setup(), learner = app.browser(); await learner.signIn("sam");
  const { course } = await learner.ok("/courses/create", { title: "Matrices" }), material = await learner.ok("/courses/materials/add", upload(course, crypto.randomUUID()));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, ...material, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" });
  await learner.ok("/courses/skills/confirm", { skill }); await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill }); await learner.ok("/learning/hint", { studySession: task });
  await learner.ok("/learning/respond", { studySession: task, text: "My work and reasoning", channel: "TEXT", dialogueLength: 1 });
  await learner.ok("/learning/assess", { studySession: task, reviewed: true, unseen: true, outsideHelp: false, dialogueLength: 2, help: "NONE", result: "INDEPENDENT", gateMet: true });
  const result = await learner.ok("/learning/read", { skill });
  expect(result.cases[0].judgment).toMatchObject({ result: "SUPPORTED", gateMet: false }); expect(result.estimate.ready).toBe(false);
  expect((await learner.post("/learning/correct", { case: result.cases[0].case, basedOn: result.cases[0].judgment.judgment, result: "INDEPENDENT", gateMet: true, reason: "Ignore hint" })).status).toBe(400);
}, 60_000);

async function learningFixture(app: Awaited<ReturnType<typeof setup>>, name: string) {
  const learner = app.browser(), { user } = await learner.signIn(name);
  const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
  const material = await learner.ok("/courses/materials/add", upload(course, crypto.randomUUID()));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, ...material, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" });
  await learner.ok("/courses/skills/confirm", { skill });
  return { learner, user, course, skill };
}

test("direct judgments trigger evidence and plans; a read repairs interrupted projection without duplicates", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "recovery");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await learner.ok("/planning/configure", { course, dailyMinutes: 30 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "My original work", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  const original = await learner.ok("/learning/read", { skill }), assessment = original.cases[0];
  const changed = await app.runtime.application.concepts.AssessmentReviewing.revise({ author: user, case: assessment.case,
    basedOn: assessment.judgment.judgment, result: "SLIP", gateMet: false, rationale: "A small arithmetic error", origin: "MANUAL" });
  expect(changed).not.toHaveProperty("error");
  await app.runtime.gateway.whenIdle();
  let inputs = await app.runtime.application.concepts.MasteryEstimating._inputs({ track: original.track.track });
  expect(inputs).toHaveLength(1); expect(inputs[0]!.revision).toBe(2); expect(inputs[0]!.signal).toBe("SLIP");
  const [next] = await app.runtime.application.concepts.StudyPlanning._next({ learner: user, scope: course });
  expect(next?.candidate.subject).toBe(skill);
  // Simulate process loss after a durable judgment but before its reactions ran.
  const { AssessmentReviewing } = await import("../src/concepts/AssessmentReviewing/AssessmentReviewing.ts");
  const raw = new AssessmentReviewing(app.connection.db), [effective] = await raw._effectiveJudgment({ case: assessment.case });
  await raw.revise({ author: user, case: assessment.case, basedOn: effective!.judgment, result: "INDEPENDENT", gateMet: true, rationale: "Original calculations verified", origin: "AI" });
  await app.connection.db.collection("groundedtutoring.sessions").updateOne({ _id: task }, { $set: { status: "OPEN" } });
  await app.restart();
  const repaired = await learner.ok("/learning/read", { skill });
  expect(repaired.cases[0].history).toHaveLength(3); expect(repaired.sessions[0].status).toBe("CLOSED");
  expect(repaired.estimate.value).toBeGreaterThan(94.99);
  inputs = await app.runtime.application.concepts.MasteryEstimating._inputs({ track: original.track.track });
  expect(inputs).toHaveLength(1); expect(inputs[0]!.revision).toBe(3);
  expect(inputs[0]!.performedAt.toISOString()).toBe(assessment.performedAt);
  const plans = await app.runtime.application.concepts.StudyPlanning._plans({ learner: user, scope: course });
  await learner.ok("/learning/read", { skill });
  expect(await app.runtime.application.concepts.MasteryEstimating._inputs({ track: original.track.track })).toEqual(inputs);
  expect(await app.runtime.application.concepts.StudyPlanning._plans({ learner: user, scope: course })).toEqual(plans);
}, 30_000);

test("readiness, ownership and stale dialogue are refused before generation or mutation", async () => {
  const app = await setup(), { learner, skill } = await learningFixture(app, "owner"), other = app.browser();
  await other.signIn("outsider");
  expect((await learner.post("/learning/task", { skill })).status).toBe(400);
  expect((await other.post("/learning/lesson", { skill, request: "Show the private lesson" })).status).toBe(400);
  expect(app.generated).toBe(0);
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  expect((await learner.post("/learning/respond", { studySession: task, text: "stale", dialogueLength: 7 })).status).toBe(400);
  expect((await other.post("/learning/respond", { studySession: task, text: "forged", dialogueLength: 0 })).status).toBe(400);
  expect((await learner.ok("/learning/read", { skill })).sessions[0].dialogue).toHaveLength(0);
}, 15_000);

test("provider work cannot save a lesson for changed requirements or an expired session", async () => {
  const app = await setup(), { learner, user, skill } = await learningFixture(app, "slow-provider");
  app.duringGeneration(async () => {
    const changed = await app.runtime.application.concepts.SkillMapping.reviseDefinition({ owner: user, skill, outcome: "A revised outcome", gate: "A revised gate" });
    expect(changed).not.toHaveProperty("error");
  });
  expect((await learner.post("/learning/lesson", { skill, request: "Teach me" })).status).toBe(409);
  expect((await learner.ok("/learning/read", { skill })).sessions).toHaveLength(0);
  app.duringGeneration(async () => {
    await app.connection.db.collection("sessioning.sessions").updateMany({}, { $set: { expiresAt: new Date(0) } });
  });
  expect((await learner.post("/learning/lesson", { skill, request: "Teach me again" })).status).toBe(401);
  expect(await app.runtime.application.concepts.GroundedTutoring._sessions({ owner: user, topic: skill })).toEqual([]);
}, 15_000);

test("a tutor response beyond the framework's default 30-second wait still saves and returns", async () => {
  const app = await setup(), { learner, skill } = await learningFixture(app, "delayed-provider");
  app.duringGeneration(() => new Promise((resolve) => setTimeout(resolve, 31_000)));
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Teach me" });
  const saved = await learner.ok("/learning/read", { skill });
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0].session).toBe(lesson);
}, 60_000);

test("engine callers receive a refusal when practice is not ready", async () => {
  const app = await setup(), { user, skill } = await learningFixture(app, "engine-readiness");
  const session = await app.runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in session) throw new Error("Test session was refused");
  const result = await app.runtime.gateway.invoke("/learning/task", { session: session.session, skill }, { timeoutMs: 1000 });
  expect(result).toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: expect.stringContaining("confidence") } });
  const other = app.browser(), outsider = await other.signIn("native-outsider");
  const foreign = await app.runtime.application.concepts.Sessioning.start({ subject: outsider.user });
  if ("error" in foreign) throw new Error("Test session was refused");
  expect(await app.runtime.gateway.invoke("/learning/lesson", { session: foreign.session, skill, owner: user, request: "Show another learner's lesson" }, { timeoutMs: 1000 }))
    .toMatchObject({ error: { kind: "framework", code: "INVALID_INPUT" } });
  expect(app.generated).toBe(0);
}, 15_000);

test("guarded learning and planning routes refuse missing state through HTTP and the native gateway", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "admission-cases");
  const signedIn = await app.runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in signedIn) throw new Error("Test session was refused");
  const cases: [string, Record<string, unknown>][] = [
    ["/learning/lesson", { skill: "missing", request: "Teach me" }],
    ["/learning/task", { skill }],
    ["/learning/respond", { studySession: "missing", text: "My work", channel: "TEXT", attachment: "", dialogueLength: 0 }],
    ["/learning/question", { studySession: "missing", text: "Why?", channel: "TEXT", attachment: "", dialogueLength: 0 }],
    ["/learning/reply", { studySession: "missing" }],
    ["/learning/hint", { studySession: "missing" }],
    ["/learning/transcript", { studySession: "missing", turnIndex: 0, text: "Corrected words" }],
    ["/learning/assess", { studySession: "missing", dialogueLength: 0, reviewed: true, unseen: true, outsideHelp: false }],
    ["/learning/retry", { studySession: "missing" }],
    ["/learning/regrade", { case: "missing", basedOn: "missing", reason: "Check my calculation" }],
    ["/learning/correct", { case: "missing", basedOn: "missing", result: "SLIP", gateMet: false, reason: "An arithmetic slip" }],
    ["/courses/skills/suggest", { material: "missing" }],
    ["/planning/configure", { course: "missing", dailyMinutes: 30, focusNote: "" }],
    ["/planning/propose", { course }],
    ["/planning/begin", { course, item: "missing" }],
    ["/planning/finish", { course, item: "missing", actualMinutes: 10 }],
    ["/planning/stop", { course, item: "missing", actualMinutes: 2 }],
    ["/planning/miss", { course, item: "missing" }],
  ];
  for (const [path, input] of cases) {
    const result = await app.runtime.gateway.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 1000 });
    expect(result, path).toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: expect.any(String) } });
    expect(await learner.post(path, input), path).toMatchObject({ status: 400, body: { detail: expect.any(String) } });
  }
  expect(app.generated).toBe(0);
  expect(await app.runtime.application.concepts.GroundedTutoring._sessions({ owner: user, topic: skill })).toEqual([]);
  expect(await app.runtime.application.concepts.MasteryEstimating._tracks({ learner: user, subject: skill })).toEqual([]);
}, 30_000);

test("HTTP and native learning requests share the learner lock without blocking settlement", async () => {
  const app = await setup(), { learner, user, skill } = await learningFixture(app, "mixed-requests");
  const signedIn = await app.runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in signedIn) throw new Error("Test session was refused");
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  app.duringGeneration(async () => { entered.resolve(); await release.promise; });
  const lesson = learner.post("/learning/lesson", { skill, request: "Teach me" });
  await entered.promise;
  const queued = app.runtime.gateway.invoke("/learning/confidence", { session: signedIn.session, skill, confidence: 50 }, { timeoutMs: 3000 });
  release.resolve();
  expect(await lesson).toMatchObject({ status: 200 });
  expect(await queued).toMatchObject({ ok: true });
  expect((await learner.ok("/learning/read", { skill })).sessions).toHaveLength(1);
}, 15_000);

test("native course creation preserves the single-course rule and rejects cancelled or expired requests", async () => {
  const app = await setup(), learner = app.browser(), { user } = await learner.signIn("native-course");
  const signedIn = await app.runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in signedIn) throw new Error("Test session was refused");
  const input = { session: signedIn.session, title: "Linear algebra" };
  const results = await Promise.all([app.runtime.gateway.invoke("/courses/create", input), app.runtime.gateway.invoke("/courses/create", input)]);
  expect(results.filter((result) => result.ok)).toHaveLength(1);
  expect(results.find((result) => !result.ok)).toMatchObject({ error: { kind: "domain", value: "COURSE_EXISTS" } });
  expect(await app.runtime.application.concepts.SkillMapping._courses({ owner: user })).toHaveLength(1);
  const controller = new AbortController(); controller.abort();
  expect(await app.runtime.gateway.invoke("/learning/task", { session: signedIn.session, skill: "missing" }, { signal: controller.signal }))
    .toMatchObject({ error: { kind: "framework", code: "ABORTED" } });
  await app.runtime.application.concepts.Sessioning.end({ session: signedIn.session });
  expect(await app.runtime.gateway.invoke("/learning/task", { session: signedIn.session, skill: "missing" }))
    .toMatchObject({ error: { kind: "domain", value: "NOT_SIGNED_IN" } });
}, 15_000);

test("course formers keep a stable identity order when database row order changes", async () => {
  const app = await setup(), { learner, user, course } = await learningFixture(app, "list-order");
  await app.runtime.application.concepts.SkillMapping.createCourse({ owner: user, title: "A second fixture course" });
  const material = await learner.ok("/courses/materials/add", upload(course, crypto.randomUUID()));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Another unit" });
  await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, ...material, title: "Another skill", outcome: "Explain products", gate: "Two fresh products" });
  const read = async () => ({
    courses: await app.runtime.application.form(Courses.CourseList({ owner: user })),
    materials: await app.runtime.application.form(Courses.Materials({ owner: user, course })),
    units: await app.runtime.application.form(Courses.Units({ course })),
    skills: await app.runtime.application.form(Courses.Skills({ course })),
  });
  const before = await read();
  const original = FindCursor.prototype.toArray;
  const reversed = spyOn(FindCursor.prototype, "toArray").mockImplementation(async function (this: FindCursor) {
    const rows = await original.call(this);
    return this.namespace.db === app.connection.db.databaseName ? rows.reverse() : rows;
  });
  try { expect(await read()).toEqual(before); }
  finally { reversed.mockRestore(); }
}, 15_000);
