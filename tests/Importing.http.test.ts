import { afterAll, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { CourseTutor } from "../src/host/tutor.ts";
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { executionLimits } from "../src/assembly.ts";
import { pdf, png } from "./fixtures/office.ts";
import type { ExtractContext } from "../src/tutor-types.ts";
import { refusalDetail } from "../src/host/http-policy.ts";
import type { Material } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import type { Result } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { admissions, composition as Access } from "../src/compositions/access.ts";

const ORIGIN = "http://localhost:5173", DAY = 86_400_000, MB = 1024 * 1024, ZONE = "America/New_York", cleanups: (() => Promise<void>)[] = [];
const SENTENCE = "Choose graded work that you imported into one of your courses.";
// Learning.md, "Refusal sentences": a material that is not the learner's own in this course.
const MATERIAL_UNAVAILABLE = "This material is not available in this course. Reload the page to see its materials.";
// Courses.md, "Course and skill refusals": a unit outside the learner's courses.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

/** The HTTP harness from Learning.http.test.ts, with a fake tutor unless the test supplies one. */
async function setup({ tutor: supplied }: { tutor?: Pick<CourseTutor, "generate" | "suggest"> } = {}) {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  let generated = 0, suggested = 0;
  let extraction: (context: ExtractContext) => unknown = () => ({ rows: [] });
  const requests: { sources: unknown; context: unknown; options: unknown }[] = [];
  let beforeGenerate: (() => Promise<void>) | undefined;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => (suggested++, { unitTitle: "Matrix multiplication", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products and explain why order matters." }] }),
    generate: async (_owner, sources, _instruction, context, schema, _work, _choice, options) => {
      generated++;
      requests.push({ sources, context, options });
      if (beforeGenerate) { const work = beforeGenerate; beforeGenerate = undefined; await work(); }
      const properties = schema.properties as Record<string, unknown>;
      if (properties.rows) return extraction(context as ExtractContext);
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.question) return { question: "Compute [[1,2],[3,4]] × [[2,0],[1,2]]. Why does order matter?", citations: [{ material, location }] };
      if (properties.rationale) {
        const help = (context as { help: string }).help;
        return { result: help === "HINT" ? "SUPPORTED" : "INDEPENDENT", gateMet: help === "NONE", rationale: "Both results and the explanation meet the saved gate." };
      }
      return { text: "Start by checking the dimensions.", citations: [{ material, location }] };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor: supplied ?? tutor });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  function browser() {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
    async function signIn(name: string) { const start = await ok("/auth/commons/start"); await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name })); const identity = await ok("/auth/commons/resume"); owners.push(identity.user); return identity as { user: User }; }
    return { post, ok, signIn };
  }
  // The application's own gateway, without the host's input check, admission, or lock, to show the endpoint's own refusals.
  let raw: ReturnType<typeof createGateway> | undefined;
  return { browser, runtime, connection, requests, get raw() { return raw ??= createGateway({ application: runtime.application, executionLimits }); },
    get generated() { return generated; }, get suggested() { return suggested; },
    extract: (answer: (context: ExtractContext) => unknown) => { extraction = answer; }, duringGeneration: (work: () => Promise<void>) => { beforeGenerate = work; } };
}

function upload(course: string, title = "Matrix multiplication") {
  const form = new FormData(); form.set("course", course); form.set("title", title); form.set("requestId", crypto.randomUUID());
  form.append("files", new File(["# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match."], "lesson.md", { type: "text/markdown" }));
  return form;
}

/** A learner with one confirmed skill and a native session for gateway calls. */
async function learnerWithSkill(app: Awaited<ReturnType<typeof setup>>, name: string) {
  const learner = app.browser(), { user } = await learner.signIn(name);
  const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
  const { material } = await learner.ok("/courses/materials/add", upload(course)) as { material: Material };
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" });
  await learner.ok("/courses/skills/confirm", { skill });
  const { skills } = await learner.ok("/courses/read", { course }) as { skills: { skill: string; current: string }[] };
  const signedIn = await app.runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in signedIn) throw new Error("Test session was refused");
  return { learner, user, course, material, skill: skill as string, definition: skills[0]!.current, session: signedIn.session };
}

/** Saves an imported case the way Confirm does, through the assembled concept so its progress reactions run. */
async function importCase(app: Awaited<ReturnType<typeof setup>>, fixture: Awaited<ReturnType<typeof learnerWithSkill>>, label: string, result: Result, performedAt: Date,
  { material = fixture.material, skill = fixture.skill, definition = fixture.definition }: { material?: Material; skill?: string; definition?: string } = {}) {
  const imported = await app.runtime.application.concepts.AssessmentReviewing.importGraded({
    author: fixture.user, subject: skill, definition, sourceKey: `graded${JSON.stringify([material, label, skill])}`,
    question: label, criteria: "Multiply matrices\nFull demonstration gate: Two products and why",
    response: { text: "My product was [[4,4],[10,8]].", attachments: [], conversation: [], citations: [{ material }], reviewedDialogueLength: 0 },
    help: "NONE", fresh: true, performedAt, mark: "8/10", feedback: "Check the last entry.", result, gateMet: false,
    rationale: `You kept the tutor's proposed result, Slip, when importing graded work. Tutor's reason: One entry is wrong.`,
  });
  if ("error" in imported) throw new Error("The imported case was refused");
  await app.runtime.gateway.whenIdle();
  return imported as { case: string; judgment: string };
}

test("Correct accepts an imported case and keeps its gate false; a gate claim is refused and changes nothing", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "imported-correct");
  await fixture.learner.ok("/learning/confidence", { skill: fixture.skill, confidence: 50 });
  const imported = await importCase(app, fixture, "Question 2", "SLIP", new Date(Date.now() - 3 * DAY));
  const gate = await app.runtime.gateway.invoke("/learning/correct", { session: fixture.session, case: imported.case, basedOn: imported.judgment,
    result: "INDEPENDENT", gateMet: true, reason: "The grader misread my last entry." }, { timeoutMs: 5000 });
  expect(gate).toEqual({ ok: false, error: { kind: "domain", value: "IMPORTED_GATE_UNAVAILABLE", detail: "Imported coursework cannot show the complete demonstration gate." } });
  expect(await fixture.learner.post("/learning/correct", { case: imported.case, basedOn: imported.judgment, result: "INDEPENDENT", gateMet: true,
    reason: "The grader misread my last entry." })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Imported coursework cannot show the complete demonstration gate." } });
  expect(await app.runtime.application.concepts.AssessmentReviewing._judgments({ case: imported.case })).toHaveLength(1);

  const corrected = await fixture.learner.ok("/learning/correct", { case: imported.case, basedOn: imported.judgment, result: "INDEPENDENT", gateMet: false,
    reason: "The grader misread my last entry." }) as { judgment: string };
  const history = await app.runtime.application.concepts.AssessmentReviewing._judgments({ case: imported.case });
  expect(history.map(({ revision, result, gateMet, origin }) => ({ revision, result, gateMet, origin }))).toEqual([
    { revision: 1, result: "SLIP", gateMet: false, origin: "AI" }, { revision: 2, result: "INDEPENDENT", gateMet: false, origin: "MANUAL" }]);
  expect(history[1]!.judgment).toBe(corrected.judgment);
  // The correction replaces the imported contribution on the skill's track instead of adding another.
  const read = await fixture.learner.ok("/learning/read", { skill: fixture.skill });
  expect(read.track.inputs).toMatchObject([{ evidence: imported.case, revision: 2, signal: "INDEPENDENT", gateMet: false }]);
  // A stale basis is declined at admission with its sentence.
  expect(await app.runtime.gateway.invoke("/learning/correct", { session: fixture.session, case: imported.case, basedOn: imported.judgment,
    result: "GAP", gateMet: false, reason: "Stale view" }, { timeoutMs: 5000 })).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT",
    detail: "Choose your own assessment and review its latest judgment before correcting it." } });
  // A concept refusal reaches callers with its code and the concept's own sentence: the gateway beside the code, and HTTP beside the public kind.
  const blank = { case: imported.case, basedOn: corrected.judgment, result: "GAP", gateMet: false, reason: "   " };
  expect(await app.runtime.gateway.invoke("/learning/correct", { session: fixture.session, ...blank }, { timeoutMs: 5000 }))
    .toEqual({ ok: false, error: { kind: "domain", value: "INVALID_REVISED_JUDGMENT", detail: "Provide an explanation and a result consistent with the saved work and assistance." } });
  expect(await fixture.learner.post("/learning/correct", blank)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Provide an explanation and a result consistent with the saved work and assistance." } });
}, 60_000);

test("Regrade refuses an imported case before saving a clarification or contacting the tutor", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "imported-regrade");
  const imported = await importCase(app, fixture, "Question 1", "SLIP", new Date(Date.now() - DAY));
  const before = app.generated;
  const refused = await app.runtime.gateway.invoke("/learning/regrade", { session: fixture.session, case: imported.case, basedOn: imported.judgment,
    reason: "Please look at my final entry again." }, { timeoutMs: 5000 });
  expect(refused).toEqual({ ok: false, error: { kind: "domain", value: "REGRADE_IMPORTED_UNAVAILABLE", detail: "Imported coursework has no practice task to regrade, so correct it manually instead." } });
  expect(await fixture.learner.post("/learning/regrade", { case: imported.case, basedOn: imported.judgment, reason: "Please look at my final entry again." }))
    .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Imported coursework has no practice task to regrade, so correct it manually instead." } });
  expect(app.generated).toBe(before);
  expect(await app.runtime.application.concepts.AssessmentReviewing._clarifications({ case: imported.case })).toEqual([]);
  expect(await app.runtime.application.concepts.AssessmentReviewing._judgments({ case: imported.case })).toHaveLength(1);
  // Another learner's imported case is still declined at admission, as before.
  const other = app.browser(); await other.signIn("imported-regrade-other");
  expect(await other.post("/learning/regrade", { case: imported.case, basedOn: imported.judgment, reason: "Not mine" }))
    .toMatchObject({ status: 400, body: { detail: "Choose your own assessment and review its latest judgment before requesting a regrade." } });
  expect(await other.post("/learning/correct", { case: imported.case, basedOn: imported.judgment, result: "GAP", gateMet: false, reason: "Not mine" }))
    .toMatchObject({ status: 400, body: { detail: "Choose your own assessment and review its latest judgment before correcting it." } });
}, 60_000);

test("a practice case can still be regraded and corrected", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "practice-regrade"), { learner, skill } = fixture;
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Rows meet columns.", channel: "TEXT", attachments: [], dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
  const assessed = (await learner.ok("/learning/read", { skill })).cases[0];
  const regraded = await learner.ok("/learning/regrade", { case: assessed.case, basedOn: assessed.judgment.judgment, reason: "The second entry is an 8, not a 3." }) as { judgment: string };
  const read = await learner.ok("/learning/read", { skill });
  expect(read.cases[0].clarifications).toHaveLength(1);
  expect(read.cases[0].history.map((judgment: { origin: string }) => judgment.origin)).toEqual(["AI", "AI"]);
  expect(read.cases[0].judgment.judgment).toBe(regraded.judgment);
  const corrected = await learner.ok("/learning/correct", { case: assessed.case, basedOn: regraded.judgment, result: "SLIP", gateMet: false, reason: "One sum is wrong." }) as { judgment: string };
  expect((await learner.ok("/learning/read", { skill })).cases[0].judgment).toMatchObject({ judgment: corrected.judgment, result: "SLIP", origin: "MANUAL" });
}, 60_000);

test("ReadImports lists this material's imported rows with their current result, and the server's date", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "read-imports"), { learner } = fixture;
  const graded = (await learner.ok("/courses/materials/add", upload(fixture.course, "Graded work: Midterm 1")) as { material: Material }).material;
  const otherGraded = (await learner.ok("/courses/materials/add", upload(fixture.course, "Graded work: Quiz 2")) as { material: Material }).material;
  const { unit } = await learner.ok("/courses/units/add", { course: fixture.course, title: "Dimensions" });
  const { skill: second } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: fixture.material, title: "Dimensions", outcome: "Check sizes", gate: "Three pairs" });
  await learner.ok("/courses/skills/confirm", { skill: second });
  const secondDefinition = ((await learner.ok("/courses/read", { course: fixture.course })).skills as { skill: string; current: string }[]).find((row) => row.skill === second)!.current;
  const before = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
  expect(await learner.ok("/courses/graded/read", { material: graded })).toEqual({ imported: [], today: before });

  const performedAt = new Date(Date.now() - 2 * DAY);
  const first = await importCase(app, fixture, "Question 1", "SLIP", performedAt, { material: graded });
  const other = await importCase(app, fixture, "Question 2", "GAP", performedAt, { material: graded, skill: second, definition: secondDefinition });
  await importCase(app, fixture, "Question 1", "UNCERTAIN", performedAt, { material: otherGraded });
  await learner.ok("/learning/correct", { case: first.case, basedOn: first.judgment, result: "INDEPENDENT", gateMet: false, reason: "The grader misread the last entry." });
  const read = await learner.ok("/courses/graded/read", { material: graded }) as { imported: Record<string, unknown>[]; today: string };
  const expected = [
    { case: first.case, skill: fixture.skill, label: "Question 1", mark: "8/10", feedback: "Check the last entry.", performedAt: performedAt.toISOString(), result: "INDEPENDENT" },
    { case: other.case, skill: second, label: "Question 2", mark: "8/10", feedback: "Check the last entry.", performedAt: performedAt.toISOString(), result: "GAP" },
  ].sort((a, b) => a.case < b.case ? -1 : 1);
  expect(read.imported).toEqual(expected);
  expect([before, new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })]).toContain(read.today);
  // Imported cases stay in the skill's study data with their imported flag, original mark, and feedback.
  const data = await learner.ok("/learning/read", { skill: fixture.skill });
  expect(data.cases.find((item: { case: string }) => item.case === first.case)).toMatchObject({ task: null, work: { originalMark: "8/10", originalFeedback: "Check the last entry." } });
}, 60_000);

test("graded endpoints and admission give one answer for missing, foreign, outside, and ungraded material", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "graded-owner"), outsider = await learnerWithSkill(app, "graded-outsider");
  const graded = (await fixture.learner.ok("/courses/materials/add", upload(fixture.course, "Graded work: Midterm 1")) as { material: Material }).material;
  const foreign = (await outsider.learner.ok("/courses/materials/add", upload(outsider.course, "Graded work: Their midterm")) as { material: Material }).material;
  await importCase(app, outsider, "Question 1", "SLIP", new Date(Date.now() - DAY), { material: foreign });
  const sentence = "Choose graded work that you imported into one of your courses.";
  expect(admissions["/courses/graded/extract"][1]).toMatchObject({ check: Access.GradedReady, fields: ["material"], detail: sentence });
  expect(admissions["/courses/graded/confirm"][0]).toMatchObject({ check: Access.GradedReady, fields: ["material"], detail: sentence });
  expect(await app.runtime.application.form(Access.GradedReady({ owner: fixture.user, material: graded }))).toEqual({ allowed: true });
  for (const material of [foreign, fixture.material, crypto.randomUUID() as Material]) {
    expect(await app.runtime.application.form(Access.GradedReady({ owner: fixture.user, material })), material).toBeNull();
    expect(await app.runtime.gateway.invoke("/courses/graded/read", { session: fixture.session, material }, { timeoutMs: 5000 }), material)
      .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_MATERIAL_UNAVAILABLE", detail: "Choose graded work that you imported into one of your courses." } });
    // HTTP presents the refusal as its public error kind only; another learner's imports are never shown.
    expect(await fixture.learner.post("/courses/graded/read", { material }), material).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: "Choose graded work that you imported into one of your courses." } });
  }
  expect((await fixture.learner.post("/courses/graded/read", { material: "" })).status).toBe(400);
  expect((await fixture.learner.post("/courses/graded/read", {})).status).toBe(400);
  // The owner still reads their own imports, and a signed-out caller reads nothing.
  expect((await outsider.learner.ok("/courses/graded/read", { material: foreign })).imported).toHaveLength(1);
  expect((await app.browser().post("/courses/graded/read", { material: foreign })).status).toBe(401);
}, 60_000);

test("graded work cannot become a skill source, but other materials keep their ownership refusals first", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "graded-source"), outsider = await learnerWithSkill(app, "graded-source-outsider");
  const { learner, course, session } = fixture;
  const graded = (await learner.ok("/courses/materials/add", upload(course, "Graded work: Midterm 1")) as { material: Material }).material;
  const { course: secondCourse } = await learner.ok("/courses/create", { title: "Physics" });
  const elsewhere = (await learner.ok("/courses/materials/add", upload(secondCourse, "Graded work: Physics quiz")) as { material: Material }).material;
  const foreign = (await outsider.learner.ok("/courses/materials/add", upload(outsider.course, "Graded work: Their quiz")) as { material: Material }).material;
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Graded unit" });
  const { unit: foreignUnit } = await outsider.learner.ok("/courses/units/add", { course: outsider.course, title: "Their unit" });
  const draft = { title: "From graded work", outcome: "Multiply", gate: "Two products" };
  const propose = (input: Record<string, unknown>) => app.runtime.gateway.invoke("/courses/skills/propose", { session, proposalKey: crypto.randomUUID(), ...draft, ...input }, { timeoutMs: 5000 });
  expect(await propose({ unit, material: graded })).toEqual({ ok: false, error: { kind: "domain", value: "GRADED_MATERIAL_NOT_SOURCE", detail: "Graded work is evidence, not a teaching source." } });
  expect(await propose({ unit, material: elsewhere })).toEqual({ ok: false, error: { kind: "domain", value: "MATERIAL_UNAVAILABLE", detail: MATERIAL_UNAVAILABLE } });
  expect(await propose({ unit, material: foreign })).toEqual({ ok: false, error: { kind: "domain", value: "MATERIAL_UNAVAILABLE", detail: MATERIAL_UNAVAILABLE } });
  expect(await propose({ unit: foreignUnit, material: graded })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
  expect(await learner.post("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: graded, ...draft })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Graded work is evidence, not a teaching source." } });

  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: fixture.material, ...draft });
  const edit = (input: Record<string, unknown>) => app.runtime.gateway.invoke("/courses/skills/edit", { session, skill, unit, ...draft, title: "Edited", ...input }, { timeoutMs: 5000 });
  expect(await edit({ material: graded })).toEqual({ ok: false, error: { kind: "domain", value: "GRADED_MATERIAL_NOT_SOURCE", detail: "Graded work is evidence, not a teaching source." } });
  expect(await learner.post("/courses/skills/edit", { skill, unit, ...draft, title: "Edited", material: graded })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Graded work is evidence, not a teaching source." } });
  expect(await edit({ material: foreign })).toEqual({ ok: false, error: { kind: "domain", value: "MATERIAL_UNAVAILABLE", detail: MATERIAL_UNAVAILABLE } });
  expect(await edit({ unit: foreignUnit, material: graded })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
  expect(await edit({ material: fixture.material })).toEqual({ ok: true, value: {} });
  const skills = (await learner.ok("/courses/read", { course })).skills as { skill: string; title: string }[];
  expect(skills.map((row) => row.title).sort()).toEqual(["Edited", "Products"]);
  expect(await app.runtime.application.concepts.SkillMapping._materials({ skill })).toEqual([{ material: fixture.material }]);
}, 60_000);

/** One tutor row for the first listed skill, or a chosen one. */
const extracted = (label: string, skill: string, extra: Record<string, unknown> = {}) => ({ label, mark: "4/5", feedback: "Check the last entry.", excerpt: "[[4,4],[10,8]]",
  skill, result: "SLIP", rationale: "The method is sound, but one entry is wrong.", ...extra });

test("Extract reads a graded material's marked questions through the tutor and saves nothing", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "extract-owner"), { learner, course, session } = fixture;
  const graded = (await learner.ok("/courses/materials/add", upload(course, "Graded work: Midterm 1")) as { material: Material }).material;
  // A draft skill is never offered to the tutor.
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Drafts" });
  await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: fixture.material, title: "Draft skill", outcome: "Later", gate: "Later" });
  app.extract((context) => ({ rows: [extracted("Question 1", context.skills[0]!.skill, { note: "dropped" }), extracted(" 2(b) ", "", { result: "INDEPENDENT", feedback: "" })] }));
  const { rows } = await learner.ok("/courses/graded/extract", { material: graded }) as { rows: unknown[] };
  expect(rows).toEqual([extracted("Question 1", fixture.skill), extracted(" 2(b) ", "", { result: "INDEPENDENT", feedback: "" })]);
  const request = app.requests.at(-1)!;
  expect(request.options).toEqual({ complete: true });
  expect((request.sources as { material: string }[]).map((source) => source.material)).toEqual([graded]);
  expect(request.context).toEqual({ skills: [{ skill: fixture.skill, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" }] });
  // Extraction saves nothing, and a repeated request asks the tutor again.
  expect(await app.runtime.application.concepts.AssessmentReviewing._cases({ author: fixture.user, subject: fixture.skill })).toEqual([]);
  const before = app.generated;
  expect(await app.runtime.gateway.invoke("/courses/graded/extract", { session, material: graded }, { timeoutMs: 5000 })).toMatchObject({ ok: true, value: { rows: [{ label: "Question 1" }, { label: " 2(b) " }] } });
  expect(app.generated).toBe(before + 1);
}, 60_000);

test("Extract refuses a total score, an invalid answer, and work it cannot use, before the tutor when it can", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "extract-refusals"), outsider = await learnerWithSkill(app, "extract-outsider");
  const { learner, course, session } = fixture;
  const graded = (await learner.ok("/courses/materials/add", upload(course, "Graded work: Midterm 1")) as { material: Material }).material;
  const invoke = (material: string) => app.runtime.gateway.invoke("/courses/graded/extract", { session, material }, { timeoutMs: 5000 });
  // Only a total score: no question marks were found.
  app.extract(() => ({ rows: [] }));
  expect(await invoke(graded)).toEqual({ ok: false, error: { kind: "domain", value: "GRADED_MARKS_MISSING", detail: "No question marks were found, and a total score alone cannot update individual skills." } });
  expect(await learner.post("/courses/graded/extract", { material: graded })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "No question marks were found, and a total score alone cannot update individual skills." } });
  // A row naming a skill outside the listed confirmed skills refuses the whole answer.
  app.extract(() => ({ rows: [extracted("Question 1", outsider.skill)] }));
  expect(await invoke(graded)).toEqual({ ok: false, error: { kind: "domain", value: "GENERATION_FAILED", detail: "The tutor could not finish. Check your connection and retry. Your saved work is still available." } });
  // Over HTTP the learner sees the recorded reason, as on the learning paths.
  expect(await learner.post("/courses/graded/extract", { material: graded })).toEqual({ status: 400,
    body: { error: "INVALID_REQUEST", detail: "The tutor could not produce a usable answer. Try again. Your saved work is still available." } });
  app.extract((context) => ({ rows: [extracted("Question 1", context.skills[0]!.skill, { mark: "" })] }));
  expect(await invoke(graded)).toEqual({ ok: false, error: { kind: "domain", value: "GENERATION_FAILED", detail: "The tutor could not finish. Check your connection and retry. Your saved work is still available." } });

  const asked = app.generated;
  const foreign = (await outsider.learner.ok("/courses/materials/add", upload(outsider.course, "Graded work: Their midterm")) as { material: Material }).material;
  for (const material of [foreign, fixture.material, crypto.randomUUID()]) {
    // Admission declines first, with its sentence; the endpoint's own refusal answers a caller that skips admission.
    expect(await invoke(material), material).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: SENTENCE } });
    expect(await learner.post("/courses/graded/extract", { material }), material).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SENTENCE } });
    expect(await app.raw.invoke("/courses/graded/extract", { session, material }, { timeoutMs: 5000 }), material)
      .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_MATERIAL_UNAVAILABLE" } });
  }
  // A course without a confirmed skill has nothing to map questions to.
  const { course: empty } = await learner.ok("/courses/create", { title: "No skills yet" });
  const unmapped = (await learner.ok("/courses/materials/add", upload(empty, "Graded work: Quiz")) as { material: Material }).material;
  expect(await invoke(unmapped)).toEqual({ ok: false, error: { kind: "domain", value: "GRADED_SKILLS_UNAVAILABLE", detail: "Confirm at least one skill in this course before importing graded work." } });
  expect(await learner.post("/courses/graded/extract", { material: unmapped })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Confirm at least one skill in this course before importing graded work." } });
  expect(app.generated).toBe(asked);
  // The session is checked again after the tutor answers.
  app.extract((context) => ({ rows: [extracted("Question 1", context.skills[0]!.skill)] }));
  app.duringGeneration(async () => { await app.connection.db.collection("sessioning.sessions").updateMany({}, { $set: { expiresAt: new Date(0) } }); });
  expect((await learner.post("/courses/graded/extract", { material: graded })).status).toBe(401);
  // A signed-out caller and a malformed body are refused before dispatch.
  expect(await app.browser().post("/courses/graded/extract", { material: graded })).toEqual({ status: 401, body: { error: "UNAUTHORIZED" } });
}, 60_000);

test("Suggest refuses graded work before contacting the tutor, after the ownership check", async () => {
  const app = await setup(), fixture = await learnerWithSkill(app, "suggest-graded"), outsider = await learnerWithSkill(app, "suggest-outsider");
  const { learner, course, session } = fixture;
  const graded = (await learner.ok("/courses/materials/add", upload(course, "Graded work: Midterm 1")) as { material: Material }).material;
  const foreign = (await outsider.learner.ok("/courses/materials/add", upload(outsider.course, "Graded work: Their midterm")) as { material: Material }).material;
  const asked = app.suggested;
  expect(await app.runtime.gateway.invoke("/courses/skills/suggest", { session, material: graded }, { timeoutMs: 5000 }))
    .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_MATERIAL_NOT_SOURCE", detail: "Graded work is evidence, not a teaching source." } });
  expect(await learner.post("/courses/skills/suggest", { material: graded })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Graded work is evidence, not a teaching source." } });
  // Another learner's material keeps the existing admission refusal, whatever its title.
  expect(await learner.post("/courses/skills/suggest", { material: foreign })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Choose a source from your own course." } });
  expect(app.suggested).toBe(asked);
  expect((await learner.ok("/courses/skills/suggest", { material: fixture.material })).suggestions.unitTitle).toBe("Matrix multiplication");
  expect(app.suggested).toBe(asked + 1);
}, 60_000);

/** A calendar date written YYYY-MM-DD, moved by whole days. */
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const newYorkDate = (at: Date | number | string) => new Date(at).toLocaleDateString("en-CA", { timeZone: ZONE });
/** One question as the import screen sends it: the extracted values, the tutor's proposal, and the learner's skill and result. */
const question = (skill: string, extra: Record<string, unknown> = {}) => ({ label: "Question 2", mark: "4/5", feedback: "Check the last entry.", excerpt: "[[4,4],[10,8]]",
  rationale: "The method is sound, but one entry is wrong.", proposedResult: "SLIP", skill, result: "SLIP", ...extra });

/** A learner with a second confirmed skill, a graded material, and the server's date. */
async function gradedFixture(app: Awaited<ReturnType<typeof setup>>, name: string) {
  const fixture = await learnerWithSkill(app, name), { learner, course } = fixture;
  const graded = (await learner.ok("/courses/materials/add", upload(course, "Graded work: Midterm 1")) as { material: Material }).material;
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Dimensions" });
  const { skill: second } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: fixture.material, title: "Dimensions", outcome: "Check sizes", gate: "Three pairs" });
  await learner.ok("/courses/skills/confirm", { skill: second });
  const { skill: draft } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: fixture.material, title: "Draft", outcome: "Later", gate: "Later" });
  const { today } = await learner.ok("/courses/graded/read", { material: graded }) as { today: string };
  return { ...fixture, graded, second: second as string, draft: draft as string, today };
}

test("Confirm imports one question and applies its judgment to mastery as of the performance date", async () => {
  const app = await setup(), fixture = await gradedFixture(app, "confirm-owner"), { learner, skill, second, graded, user, course } = fixture;
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const performedOn = shift(fixture.today, -3);
  const row = question(skill, { label: "  Question 2 ", result: "GAP" });
  const confirmed = await learner.ok("/courses/graded/confirm", { material: graded, performedOn, outsideHelp: false, row }) as { case: string };
  expect(Object.keys(confirmed)).toEqual(["case"]);

  // The case holds the stated inputs.
  const Assessment = app.runtime.application.concepts.AssessmentReviewing;
  const [saved] = await Assessment._case({ case: confirmed.case as never });
  const performedAt = saved!.performedAt;
  // The performance instant is the start of that date in New York.
  expect(newYorkDate(performedAt)).toBe(performedOn);
  expect(newYorkDate(performedAt.getTime() - 1)).toBe(shift(performedOn, -1));
  const definition = ((await learner.ok("/courses/read", { course })).skills as { skill: string; current: string }[]).find((item) => item.skill === skill)!.current;
  expect(saved).toEqual({ author: user, subject: skill, definition, sourceKey: `graded${JSON.stringify([graded, "Question 2", skill])}`, help: "NONE", fresh: true, performedAt, imported: true });
  const { originals } = await learner.ok("/courses/materials/read", { material: graded }) as { originals: unknown[] };
  expect(await Assessment._work({ case: confirmed.case as never }) as unknown).toEqual([{ question: "Question 2", criteria: "Multiply matrices\nFull demonstration gate: Two products and why",
    response: { text: "[[4,4],[10,8]]", attachments: originals, conversation: [], citations: [{ material: graded }], reviewedDialogueLength: 0 },
    originalMark: "4/5", originalFeedback: "Check the last entry." }]);
  expect((await Assessment._judgments({ case: confirmed.case as never })).map(({ revision, result, gateMet, rationale }) => ({ revision, result, gateMet, rationale }))).toEqual([{
    revision: 1, result: "GAP", gateMet: false,
    rationale: "You changed the tutor's proposed result from Slip to Gap when importing graded work. Tutor's reason for Slip: The method is sound, but one entry is wrong." }]);

  // By the answer, the judgment is on the skill's track as of the performance date, and the study data shows the grader's mark.
  const read = await learner.ok("/learning/read", { skill });
  expect(read.track.inputs).toMatchObject([{ evidence: confirmed.case, revision: 1, performedAt: performedAt.toISOString(), signal: "GAP", fresh: true, gateMet: false }]);
  expect(read.cases.find((item: { case: string }) => item.case === confirmed.case)).toMatchObject({ task: null, help: "NONE",
    work: { question: "Question 2", originalMark: "4/5", originalFeedback: "Check the last entry." } });
  const imports = await learner.ok("/courses/graded/read", { material: graded });
  expect(imports.imported).toEqual([{ case: confirmed.case, skill, label: "Question 2", mark: "4/5", feedback: "Check the last entry.",
    performedAt: performedAt.toISOString(), result: "GAP" }]);

  // With help declared, the case records a hint. A skill without a starting estimate keeps the case until confidence is set.
  const helped = await learner.ok("/courses/graded/confirm", { material: graded, performedOn, outsideHelp: true,
    row: question(second, { label: "Question 3", proposedResult: "INDEPENDENT", result: "SUPPORTED", rationale: "Every step is correct." }) }) as { case: string };
  expect((await Assessment._case({ case: helped.case as never }))[0]).toMatchObject({ subject: second, help: "HINT", imported: true });
  expect((await Assessment._judgments({ case: helped.case as never }))[0]).toMatchObject({ result: "SUPPORTED",
    rationale: "You changed the tutor's proposed result from Independent to Supported when importing graded work. Tutor's reason for Independent: Every step is correct." });
  expect((await learner.ok("/learning/read", { skill: second })).track).toBeNull();
  await learner.ok("/learning/confidence", { skill: second, confidence: 40 });
  expect((await learner.ok("/learning/read", { skill: second })).track.inputs).toMatchObject([{ evidence: helped.case, signal: "SUPPORTED", performedAt: performedAt.toISOString() }]);
  // Today is an accepted performance date.
  expect(await learner.post("/courses/graded/confirm", { material: graded, performedOn: fixture.today, outsideHelp: false, row: question(skill, { label: "Question 4" }) }))
    .toMatchObject({ status: 200 });
}, 60_000);

test("Confirm answers each failed check in the stated order and imports nothing", async () => {
  const app = await setup(), fixture = await gradedFixture(app, "confirm-order"), outsider = await learnerWithSkill(app, "confirm-order-outsider");
  const { learner, skill, draft, graded, session, today, user } = fixture;
  const Assessment = app.runtime.application.concepts.AssessmentReviewing;
  const saved = async () => (await Assessment._cases({ author: user, subject: skill })).length + (await Assessment._cases({ author: user, subject: draft })).length;
  const foreign = (await outsider.learner.ok("/courses/materials/add", upload(outsider.course, "Graded work: Their midterm")) as { material: Material }).material;
  // Each step fixes the check that answered before, so the next check answers.
  const steps: [string, Record<string, unknown>][] = [
    ["GRADED_MATERIAL_UNAVAILABLE", { material: foreign, performedOn: "2026-02-30", outsideHelp: true, row: question("", { mark: "", result: "INDEPENDENT" }) }],
    ["GRADED_DATE_INVALID", { material: graded, performedOn: "2026-02-30", outsideHelp: true, row: question("", { mark: "", result: "INDEPENDENT" }) }],
    ["GRADED_DATE_FUTURE", { material: graded, performedOn: shift(today, 1), outsideHelp: true, row: question("", { mark: "", result: "INDEPENDENT" }) }],
    ["GRADED_ROW_INVALID", { material: graded, performedOn: today, outsideHelp: true, row: question("", { mark: "", result: "INDEPENDENT" }) }],
    ["GRADED_ROW_UNMAPPED", { material: graded, performedOn: today, outsideHelp: true, row: question("", { result: "INDEPENDENT" }) }],
    ["GRADED_HELP_CONFLICT", { material: graded, performedOn: today, outsideHelp: true, row: question(draft, { result: "INDEPENDENT" }) }],
    ["GRADED_SKILL_UNAVAILABLE", { material: graded, performedOn: today, outsideHelp: true, row: question(draft, { result: "SUPPORTED" }) }],
  ];
  for (const [code, body] of steps) {
    // The endpoint's own answer, without the host's admission.
    expect(await app.raw.invoke("/courses/graded/confirm", { session, ...body }, { timeoutMs: 5000 }), code).toEqual({ ok: false, error: { kind: "domain", value: code } });
    if (code === "GRADED_MATERIAL_UNAVAILABLE") continue;
    // Through the host: the native gateway gives the code with its sentence, and the browser receives the public kind with the same sentence.
    const detail = refusalDetail("/courses/graded/confirm", code);
    expect(detail, code).toBeString();
    expect(await app.runtime.gateway.invoke("/courses/graded/confirm", { session, ...body }, { timeoutMs: 5000 }), code).toEqual({ ok: false, error: { kind: "domain", value: code, detail } });
    expect(await learner.post("/courses/graded/confirm", body), code).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail } });
  }
  // Every other way the row's content breaks the extraction's rules answers GRADED_ROW_INVALID.
  const { mark: _mark, ...withoutMark } = question(skill);
  for (const row of [question(skill, { label: "  " }), question(skill, { rationale: " " }), question(skill, { result: "PASS" }), question(skill, { proposedResult: "independent" })]) {
    expect(await app.runtime.gateway.invoke("/courses/graded/confirm", { session, material: graded, performedOn: today, outsideHelp: false, row }, { timeoutMs: 5000 }))
      .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_ROW_INVALID", detail: "Review the extracted rows again." } });
  }
  // A missing or non-string field is refused by the host first; the endpoint's own check still answers a caller that skips the host.
  for (const row of [withoutMark, { ...question(skill), mark: 4 }]) {
    expect(await app.raw.invoke("/courses/graded/confirm", { session, material: graded, performedOn: today, outsideHelp: false, row }, { timeoutMs: 5000 }))
      .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_ROW_INVALID" } });
  }
  for (const performedOn of ["", " ", "2026-13-01", "10/20/2026", "yesterday"]) {
    expect(await app.runtime.gateway.invoke("/courses/graded/confirm", { session, material: graded, performedOn, outsideHelp: false, row: question(skill) }, { timeoutMs: 5000 }), performedOn)
      .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_DATE_INVALID", detail: "Enter the date the work was performed." } });
  }
  // Another course's confirmed skill is not available either.
  expect(await app.runtime.gateway.invoke("/courses/graded/confirm", { session, material: graded, performedOn: today, outsideHelp: false, row: question(outsider.skill) }, { timeoutMs: 5000 }))
    .toEqual({ ok: false, error: { kind: "domain", value: "GRADED_SKILL_UNAVAILABLE", detail: "Map the question to a confirmed skill in this course." } });
  expect(await saved()).toBe(0);
  expect(await Assessment._cases({ author: outsider.user, subject: outsider.skill })).toEqual([]);

  // The same question and skill again is refused with the concept's code, even with other spacing, a new date, or a new result.
  const confirmed = await learner.ok("/courses/graded/confirm", { material: graded, performedOn: today, outsideHelp: false, row: question(skill) }) as { case: string };
  const repeat = { material: graded, performedOn: shift(today, -1), outsideHelp: false, row: question(skill, { label: " Question 2  ", result: "GAP" }) };
  const used = refusalDetail("/courses/graded/confirm", "GRADED_SOURCE_USED");
  expect(await app.runtime.gateway.invoke("/courses/graded/confirm", { session, ...repeat }, { timeoutMs: 5000 })).toEqual({ ok: false, error: { kind: "domain", value: "GRADED_SOURCE_USED", detail: used } });
  expect(await learner.post("/courses/graded/confirm", repeat)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: used } });
  expect((await Assessment._cases({ author: user, subject: skill })).map((row) => row.case)).toEqual([confirmed.case]);
  // The source key includes the skill, so the same label may be imported for another skill.
  expect(await learner.post("/courses/graded/confirm", { ...repeat, row: question(fixture.second) })).toMatchObject({ status: 200 });
}, 60_000);

test("Confirm refuses another learner's material, a malformed body, and a signed-out caller before dispatch", async () => {
  const app = await setup(), fixture = await gradedFixture(app, "confirm-access"), outsider = await learnerWithSkill(app, "confirm-access-outsider");
  const { learner, skill, graded, session, today, user } = fixture;
  const Assessment = app.runtime.application.concepts.AssessmentReviewing;
  const foreign = (await outsider.learner.ok("/courses/materials/add", upload(outsider.course, "Graded work: Their midterm")) as { material: Material }).material;
  const body = (extra: Record<string, unknown> = {}) => ({ material: graded, performedOn: today, outsideHelp: false, row: question(skill), ...extra });
  // Another learner's material, an ungraded material, and an unknown one get the admission sentence and nothing is saved.
  for (const material of [foreign, fixture.material, crypto.randomUUID()]) {
    expect(await learner.post("/courses/graded/confirm", body({ material, row: question(outsider.skill) })), material).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SENTENCE } });
    expect(await app.runtime.gateway.invoke("/courses/graded/confirm", { session, ...body({ material }) }, { timeoutMs: 5000 }), material)
      .toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: SENTENCE } });
  }
  expect(await Assessment._cases({ author: outsider.user, subject: outsider.skill })).toEqual([]);
  expect(await Assessment._cases({ author: user, subject: skill })).toEqual([]);
  // A signed-out caller.
  expect(await app.browser().post("/courses/graded/confirm", body())).toEqual({ status: 401, body: { error: "UNAUTHORIZED" } });
  // The host accepts only the four fields, with a row of exactly eight strings within the extraction's limits.
  const { mark: _mark, ...withoutMark } = question(skill);
  const malformed: [string, Record<string, unknown>][] = [
    ["missing row", { material: graded, performedOn: today, outsideHelp: false }], ["missing date", { material: graded, outsideHelp: false, row: question(skill) }],
    ["missing help", { material: graded, performedOn: today, row: question(skill) }], ["blank material", body({ material: " " })],
    ["extra field", body({ checked: true })], ["help as text", body({ outsideHelp: "false" })], ["date as number", body({ performedOn: 20261020 })],
    ["row list", body({ row: [question(skill)] })], ["row text", body({ row: "Question 2" })], ["row missing mark", body({ row: withoutMark })],
    ["row extra field", body({ row: { ...question(skill), checked: true } })], ["row number", body({ row: { ...question(skill), mark: 4 } })],
    ["long label", body({ row: question(skill, { label: "x".repeat(101) }) })], ["long mark", body({ row: question(skill, { mark: "1".repeat(51) }) })],
    ["long feedback", body({ row: question(skill, { feedback: "f".repeat(2001) }) })], ["long excerpt", body({ row: question(skill, { excerpt: "e".repeat(501) }) })],
    ["long rationale", body({ row: question(skill, { rationale: "r".repeat(501) }) })],
  ];
  for (const [name, value] of malformed) {
    expect(await learner.post("/courses/graded/confirm", value), name).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
    const native = await app.runtime.gateway.invoke("/courses/graded/confirm", { session, ...value }, { timeoutMs: 5000 });
    expect(native, name).toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT" } });
    // The gateway refuses a missing field itself, without a sentence. The host's check refuses everything else with its sentence.
    expect((native as { error: { detail?: string } }).error.detail, name)
      .toBe(name.startsWith("missing") ? undefined : "Send the performance date, the help declaration, and one question as it was extracted.");
  }
  expect(await Assessment._cases({ author: user, subject: skill })).toEqual([]);
  // A row at every limit, in three-byte characters, still fits in one request.
  const longest = question(skill, { label: "€".repeat(100), mark: "€".repeat(50), feedback: "€".repeat(2000), excerpt: "€".repeat(500), rationale: "€".repeat(500) });
  expect(new TextEncoder().encode(JSON.stringify(body({ row: longest }))).length).toBeGreaterThan(9000);
  expect(await learner.post("/courses/graded/confirm", body({ row: longest }))).toMatchObject({ status: 200 });
}, 60_000);

test("two confirms of the same question run one after the other, and the second is refused", async () => {
  const app = await setup(), fixture = await gradedFixture(app, "confirm-race"), { learner, skill, graded, session, today, user } = fixture;
  const body = { material: graded, performedOn: today, outsideHelp: false, row: question(skill) };
  const answers = await Promise.all([learner.post("/courses/graded/confirm", body), learner.post("/courses/graded/confirm", body),
    app.runtime.gateway.invoke("/courses/graded/confirm", { session, ...body }, { timeoutMs: 5000 })]);
  expect(answers.filter((answer) => "status" in answer ? answer.status === 200 : answer.ok)).toHaveLength(1);
  expect(answers.filter((answer) => "status" in answer ? answer.status === 400 : !answer.ok && answer.error.kind === "domain" && answer.error.value === "GRADED_SOURCE_USED")).toHaveLength(2);
  expect(await app.runtime.application.concepts.AssessmentReviewing._cases({ author: user, subject: skill })).toHaveLength(1);
  // Without the host's lock, the concept's unique author, skill, and source key rule still lets only one through.
  const unlocked = { ...body, row: question(skill, { label: "Question 3" }) };
  const raced = await Promise.all([1, 2, 3].map(() => app.raw.invoke("/courses/graded/confirm", { session, ...unlocked }, { timeoutMs: 30_000 })));
  expect(raced.filter((answer) => answer.ok)).toHaveLength(1);
  expect(raced.filter((answer) => !answer.ok)).toEqual([{ ok: false, error: { kind: "domain", value: "GRADED_SOURCE_USED" } }, { ok: false, error: { kind: "domain", value: "GRADED_SOURCE_USED" } }]);
  expect(await app.runtime.application.concepts.AssessmentReviewing._cases({ author: user, subject: skill })).toHaveLength(2);
}, 60_000);

test("Extract tells the learner when an original is too large to send in full, before contacting the tutor", async () => {
  let asked = 0;
  const tutor = new CourseTutor({ json: async () => { asked++; return { rows: [] }; } }, { read: async () => Buffer.alloc(15 * MB + 1, 1), size: async () => 15 * MB + 1 });
  const app = await setup({ tutor }), fixture = await learnerWithSkill(app, "extract-large"), { learner, course } = fixture;
  const scanned = new FormData(); scanned.set("course", course); scanned.set("title", "Graded work: Midterm 1"); scanned.set("requestId", crypto.randomUUID());
  scanned.append("files", new File([pdf(["Question 1 (4/5)"]) as Uint8Array<ArrayBuffer>], "midterm.pdf", { type: "application/pdf" }));
  const document = (await learner.ok("/courses/materials/add", scanned) as { material: Material }).material;
  expect(await learner.post("/courses/graded/extract", { material: document })).toEqual({ status: 400, body: { error: "INVALID_REQUEST",
    detail: "This PDF is larger than 15 MB, so the tutor cannot see its marks. Upload photos of its pages instead. Your saved work is still available." } });
  const photographed = new FormData(); photographed.set("course", course); photographed.set("title", "Graded work: Quiz 2"); photographed.set("requestId", crypto.randomUUID());
  photographed.append("files", new File([png as Uint8Array<ArrayBuffer>], "page.png", { type: "image/png" }));
  const photo = (await learner.ok("/courses/materials/add", photographed) as { material: Material }).material;
  expect(await learner.post("/courses/graded/extract", { material: photo })).toEqual({ status: 400, body: { error: "INVALID_REQUEST",
    detail: "This photo is larger than 15 MB, so the tutor cannot read it. Upload a smaller photo of the page. Your saved work is still available." } });
  expect(asked).toBe(0);
  // The reason is taken once: a later refusal that is not the tutor's carries no stale reason.
  const { course: empty } = await learner.ok("/courses/create", { title: "No skills yet" });
  const unmapped = (await learner.ok("/courses/materials/add", upload(empty, "Graded work: Quiz")) as { material: Material }).material;
  expect(await learner.post("/courses/graded/extract", { material: unmapped })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Confirm at least one skill in this course before importing graded work." } });
}, 60_000);
