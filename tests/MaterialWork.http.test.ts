import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { composition as Access, admissions } from "../src/compositions/access.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { DiskStore } from "../src/host/file-store.ts";
import { Gemini } from "../src/host/gemini.ts";
import { refusalDetails } from "../src/host/http-policy.ts";
import { MaterialFiles } from "../src/host/material-files.ts";
import { IMPORT_REQUEST_CONFLICT } from "../src/host/material-routes.ts";
import { createRuntime } from "../src/host/runtime.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { answer, fakeGemini } from "./fixtures/fake-gemini.ts";
import { wav } from "./fixtures/media.ts";
import { openLesson } from "./fixtures/open-lesson.ts";

// The learner's own work, such as a photo attached to an answer, is saved with purpose WORK. It is listed apart from the
// course's sources, is never a teaching source, and still reaches the grader with the answer (Courses.md, "The learner's
// own work"; Materials.md, "The learner's own work"; Learning.md).

const ORIGIN = "http://localhost:5173";
let directory: string;
const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), "stillgotit-work-http-")); });
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

const WORK_NOT_SOURCE = refusalDetails.WORK_MATERIAL_NOT_SOURCE!;
const SUGGESTION_DECLINED = admissions["/courses/skills/suggest"].at(-1)!.detail;

/** A runtime with retained files in a temporary disk store, and a tutor that records what each request was sent. */
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), google = fakeGemini({ generate: () => answer('{"segments":[{"start":0,"end":2,"text":"I multiplied each row by each column."}]}') });
  const gemini = new Gemini({ key: "test-key-not-real", fetch: google.fetch, pollMs: 1 });
  const store = new DiskStore(resolve(directory, randomUUID())), files = new MaterialFiles(store);
  // Each tutor request's kind, the sources it was sent, and the names of the work files it was sent to read.
  const sent: { kind: string; materials: string[]; work: string[] }[] = [];
  let suggestions = 0;
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => { suggestions++; return { unitTitle: "Matrices", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products." }] }; },
    generate: async (_owner, sources, _instruction, context, schema, work) => {
      const properties = schema.properties as Record<string, unknown>;
      const kind = properties.explanation ? "LESSON" : properties.question ? "TASK" : properties.rationale ? "GRADE" : properties.citations ? "REPLY" : "HINT";
      sent.push({ kind, materials: sources.map((source) => source.material), work: work.map((file) => file.name) });
      if (kind === "GRADE") return { result: "INDEPENDENT", gateMet: true, rationale: "Both products are right, and the order is explained." };
      const citations = [{ material: sources[0]!.material, location: sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content" }];
      if (kind === "LESSON") return { explanation: "Match each row with a column.", citations };
      if (kind === "TASK") return { question: "Multiply [[1,2],[3,4]] by [[2,0],[1,2]]. Why does order matter?", citations };
      return { text: kind === "REPLY" ? "Your rows meet the right columns." : "Check the dimensions first.", citations };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, gemini, files, tutor });
  cleanups.push(async () => { await runtime.worker.stop(); await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });

  function browser() {
    const jar = new Map<string, string>();
    let session = "";
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachments: [], ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([name, value]) => `${name}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json() as Record<string, any>;
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    async function signIn(name: string) {
      const start = await ok("/auth/commons/start");
      await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
      const identity = await ok("/auth/commons/resume");
      const started = await runtime.application.concepts.Sessioning.start({ subject: identity.user as never });
      if ("error" in started) throw new Error("Test session was refused");
      session = started.session;
      const { course } = await ok("/courses/create", { title: "Linear algebra" });
      return { user: identity.user as string, course: course as string };
    }
    /** Native callers: `gateway` applies request admission, `raw` is the assembled invoker that skips it. */
    const gateway = (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { ...input, session }, { timeoutMs: 5000 });
    const raw = (path: string, input: Record<string, unknown>) => runtime.application.invoker.invoke(path, { ...input, session }, { timeoutMs: 5000 });
    return { post, ok, signIn, gateway, raw };
  }
  const Library = runtime.application.concepts.Library;
  return { runtime, connection, browser, sent, Library, suggestions: () => suggestions };
}
type Learner = ReturnType<Awaited<ReturnType<typeof setup>>["browser"]>;

/** The upload form the attach control sends for work (purpose WORK), or the Materials page sends for a source. */
function upload(course: string, { requestId = randomUUID(), title, files, purpose }: { requestId?: string; title: string; files: File[]; purpose?: string }) {
  const body = new FormData();
  body.set("course", course); body.set("title", title); body.set("requestId", requestId);
  if (purpose !== undefined) body.set("purpose", purpose);
  for (const file of files) body.append("files", file);
  return body;
}
const notesFile = () => new File(["# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match."], "notes.md", { type: "text/markdown" });
const answerFile = () => new File(["Row 1 times column 1 is 4, so the product is [[4,4],[10,8]]."], "answer.md", { type: "text/markdown" });

/** The course notes, a source, and a confirmed skill taught from them. */
async function course(learner: Learner, course: string) {
  const { material: notes } = await learner.ok("/courses/materials/add", upload(course, { title: "Week 3 notes", files: [notesFile()] }));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Matrices" });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: randomUUID(), unit, material: notes, title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products." });
  await learner.ok("/courses/skills/confirm", { skill });
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  return { notes: notes as string, unit: unit as string, skill: skill as string };
}
/** Attaches one file as the attach control does, and returns the saved material. */
async function attach(learner: Learner, course: string, file = answerFile()) {
  return (await learner.ok("/courses/materials/add", upload(course, { title: `My work: ${file.name}`, files: [file], purpose: "WORK" }))).material as string;
}

describe("The learner's own work", () => {
  test("a file attached to a practice answer is saved as work: listed apart from the sources, never sent as one, and read by the grader with the answer", async () => {
    const app = await setup(), learner = app.browser(), { user, course: courseId } = await learner.signIn("maya");
    const { notes, skill } = await course(learner, courseId);
    const work = await attach(learner, courseId);

    // The course read lists the work apart from the sources, and the work alone is in the work list.
    const read = await learner.ok("/courses/read", { course: courseId });
    expect(read.materials).toEqual([{ material: notes, title: "Week 3 notes", locator: expect.any(String), origin: "COURSE" }]);
    expect(read.work).toEqual([{ material: work, title: "My work: answer.md", locator: expect.any(String) }]);
    // The library keeps its purpose; only the notes are in the source set, and only the work is in the work set.
    expect(await app.Library._material({ material: work as never })).toEqual([expect.objectContaining({ title: "My work: answer.md", purpose: "WORK" })]);
    expect((await app.Library._sourceSet({ owner: user as never, scope: courseId as never })).sources.map((row) => row.material as string)).toEqual([notes]);
    expect((await app.Library._workSet({ owner: user as never, scope: courseId as never })).work.map((row) => row.material as string)).toEqual([work]);
    // The learner can still open it, like any of their materials.
    expect(await learner.ok("/courses/materials/read", { material: work })).toMatchObject({ title: "My work: answer.md", content: expect.stringContaining("[[4,4],[10,8]]") });

    // Practice is taught from the notes only. The answer carries the work, and the grader reads it with the answer.
    const { task } = await learner.ok("/learning/task", { skill });
    await learner.ok("/learning/respond", { studySession: task, text: "My working is attached.", attachments: [work], dialogueLength: 0 });
    await learner.ok("/learning/assess", { studySession: task, reviewed: true, unseen: true, outsideHelp: false, dialogueLength: 1 });
    expect(app.sent).toEqual([
      { kind: "TASK", materials: [notes], work: [] },
      { kind: "GRADE", materials: [notes], work: ["answer.md"] },
    ]);
    const after = await learner.ok("/learning/read", { skill });
    const saved = after.sessions.find((row: { session: string }) => row.session === task);
    expect(saved.dialogue[0].turn.media.map((file: { name: string }) => file.name)).toEqual(["answer.md"]);
    expect(after.cases[0].judgment).toMatchObject({ result: "INDEPENDENT" });
    const [{ response }] = await app.runtime.application.concepts.AssessmentReviewing._work({ case: after.cases[0].case });
    expect((response as unknown as { attachments: { name: string }[] }).attachments.map((file) => file.name)).toEqual(["answer.md"]);

    // Deleting the work removes it from the work list; the answer keeps its text and the file's name.
    expect(await learner.post("/courses/materials/delete", { material: work })).toEqual({ status: 200, body: {} });
    const emptied = await learner.ok("/courses/read", { course: courseId });
    expect(emptied.work).toEqual([]);
    expect(emptied.materials.map((row: { material: string }) => row.material)).toEqual([notes]);
    expect(emptied.deletedMaterials).toEqual([{ material: work }]);
    expect((await app.Library._workSet({ owner: user as never, scope: courseId as never })).work).toEqual([]);
    const kept = (await learner.ok("/learning/read", { skill })).sessions.find((row: { session: string }) => row.session === task);
    expect(kept.dialogue[0].turn).toMatchObject({ text: "My working is attached.", media: [expect.objectContaining({ name: "answer.md" })] });
  }, 60_000);

  test("a lesson question can carry the learner's work: the tutor reads it with the question and teaches from the notes alone", async () => {
    const app = await setup(), learner = app.browser(), { course: courseId } = await learner.signIn("maya");
    const { notes, skill } = await course(learner, courseId);
    const work = await attach(learner, courseId);
    const { lesson } = await openLesson(learner.ok, { skill, request: "Teach me." });
    await learner.ok("/learning/question", { studySession: lesson, text: "Is my working right?", attachments: [work], dialogueLength: 0 });
    expect(app.sent).toEqual([
      { kind: "LESSON", materials: [notes], work: [] },
      { kind: "REPLY", materials: [notes], work: ["answer.md"] },
    ]);
    // The session is grounded in the notes only, and every citation names the notes.
    const saved = (await learner.ok("/learning/read", { skill })).sessions.find((row: { session: string }) => row.session === lesson);
    expect(saved.materials).toEqual([notes]);
    expect(saved.dialogue.map((row: { turn: { speaker: string; media?: { name: string }[] } }) => [row.turn.speaker, (row.turn.media ?? []).map((file) => file.name)]))
      .toEqual([["LEARNER", ["answer.md"]], ["TUTOR", []]]);
    expect(saved.dialogue[1].turn.citations.map((row: { material: string }) => row.material)).toEqual([notes]);
  }, 60_000);

  test("Find skills and every way of making the work a skill source are refused before the tutor is asked, and nothing changes", async () => {
    const app = await setup(), learner = app.browser(), { user, course: courseId } = await learner.signIn("maya");
    const { notes, unit, skill } = await course(learner, courseId);
    const work = await attach(learner, courseId);
    const before = await learner.ok("/courses/read", { course: courseId });

    // Find skills is not admitted for work, with the same sentence as for any material that is not one of the learner's
    // sources; a caller that skips admission gets the specific refusal.
    expect(await app.runtime.application.form(Access.SuggestionReady({ owner: user, material: work }))).toBeNull();
    expect(await app.runtime.application.form(Access.SuggestionReady({ owner: user, material: notes }))).toEqual({ allowed: true });
    expect(await learner.post("/courses/skills/suggest", { material: work })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SUGGESTION_DECLINED } });
    expect(await learner.gateway("/courses/skills/suggest", { material: work })).toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: SUGGESTION_DECLINED } });
    expect(await learner.raw("/courses/skills/suggest", { material: work })).toMatchObject({ ok: false, error: { kind: "domain", value: "WORK_MATERIAL_NOT_SOURCE" } });

    // Proposing a skill from the work, moving a draft onto it, and adding it to a skill are refused with a sentence.
    const declined = { status: 400, body: { error: "INVALID_REQUEST", detail: WORK_NOT_SOURCE } };
    const draft = { title: "Order of factors", outcome: "Explain why AB and BA differ.", gate: "Two pairs and why." };
    expect(await learner.post("/courses/skills/propose", { proposalKey: randomUUID(), unit, material: work, ...draft })).toEqual(declined);
    const { skill: drafted } = await learner.ok("/courses/skills/propose", { proposalKey: randomUUID(), unit, material: notes, ...draft });
    expect(await learner.post("/courses/skills/edit", { skill: drafted, unit, material: work, ...draft, title: "Order matters" })).toEqual(declined);
    expect(await learner.post("/courses/skills/sources/add", { skill, material: work })).toEqual(declined);
    expect(await learner.gateway("/courses/skills/sources/add", { skill, material: work })).toEqual({ ok: false, error: { kind: "domain", value: "WORK_MATERIAL_NOT_SOURCE", detail: WORK_NOT_SOURCE } });

    // Nothing changed: the skills keep their sources and the draft its title, and the tutor was never asked.
    const concepts = app.runtime.application.concepts;
    expect(await concepts.SkillMapping._materials({ skill: skill as never })).toEqual([{ material: notes }]);
    expect(await concepts.SkillMapping._materials({ skill: drafted })).toEqual([{ material: notes }]);
    const after = await learner.ok("/courses/read", { course: courseId });
    expect(after.skills.find((row: { skill: string }) => row.skill === drafted).title).toBe(draft.title);
    expect(after.skillSources).toEqual([...before.skillSources, { skill: drafted, material: notes }].sort((x, y) => (x.skill < y.skill ? -1 : 1)));
    expect(app.sent).toEqual([]);
    expect(app.suggestions()).toBe(0);
    // Find skills on the notes still works.
    expect((await learner.ok("/courses/skills/suggest", { material: notes })).suggestions.skills).toHaveLength(1);
  }, 60_000);

  test("the upload refuses an unknown purpose, and a retry must keep the purpose its import started with", async () => {
    const app = await setup(), learner = app.browser(), { course: courseId } = await learner.signIn("maya");
    for (const purpose of ["work", "GRADED", ""]) {
      expect(await learner.post("/courses/materials/add", upload(courseId, { title: "My work: answer.md", files: [answerFile()], purpose })), purpose)
        .toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    }
    expect(await learner.ok("/courses/read", { course: courseId })).toMatchObject({ materials: [], work: [] });
    expect(await learner.ok("/courses/materials/imports", { course: courseId })).toEqual({ imports: [], saved: [] });

    // A retry under the same request answers the same material only with the same purpose.
    const asWork = randomUUID(), asSource = randomUUID();
    const { material: work } = await learner.ok("/courses/materials/add", upload(courseId, { requestId: asWork, title: "My work: answer.md", files: [answerFile()], purpose: "WORK" }));
    expect(await learner.ok("/courses/materials/add", upload(courseId, { requestId: asWork, title: "My work: answer.md", files: [answerFile()], purpose: "WORK" }))).toEqual({ material: work });
    const conflict = { status: 409, body: { error: "IMPORT_REQUEST_CONFLICT", detail: IMPORT_REQUEST_CONFLICT } };
    expect(await learner.post("/courses/materials/add", upload(courseId, { requestId: asWork, title: "My work: answer.md", files: [answerFile()] }))).toEqual(conflict);
    const { material: source } = await learner.ok("/courses/materials/add", upload(courseId, { requestId: asSource, title: "Week 3 notes", files: [notesFile()] }));
    // Naming the default purpose is the same request as leaving it out.
    expect(await learner.ok("/courses/materials/add", upload(courseId, { requestId: asSource, title: "Week 3 notes", files: [notesFile()], purpose: "SOURCE" }))).toEqual({ material: source });
    expect(await learner.post("/courses/materials/add", upload(courseId, { requestId: asSource, title: "Week 3 notes", files: [notesFile()], purpose: "WORK" }))).toEqual(conflict);
    const read = await learner.ok("/courses/read", { course: courseId });
    expect(read.materials.map((row: { material: string }) => row.material)).toEqual([source]);
    expect(read.work.map((row: { material: string }) => row.material)).toEqual([work]);
  }, 60_000);

  test("a recording attached as work is transcribed and stays work", async () => {
    const app = await setup(), learner = app.browser(), { course: courseId } = await learner.signIn("maya");
    const requestId = randomUUID();
    const started = await learner.ok("/courses/materials/add", upload(courseId, { requestId, title: "My work: explanation.wav", files: [new File([wav(2)], "explanation.wav")], purpose: "WORK" }));
    expect(started).toEqual({ requestId, state: "TRANSCRIBING" });
    await app.runtime.worker.turn();
    await app.runtime.worker.turn();
    const { saved } = await learner.ok("/courses/materials/imports", { course: courseId });
    expect(saved).toEqual([expect.any(String)]);
    const read = await learner.ok("/courses/read", { course: courseId });
    expect(read.materials).toEqual([]);
    expect(read.work).toEqual([{ material: saved[0], title: "My work: explanation.wav", locator: expect.any(String) }]);
    expect(await learner.ok("/courses/materials/read", { material: saved[0] })).toMatchObject({ content: expect.stringContaining("I multiplied each row by each column.") });
  }, 60_000);

  test("a material saved before purposes were recorded is listed and taught from as a source", async () => {
    const app = await setup(), learner = app.browser(), { user, course: courseId } = await learner.signIn("maya");
    const { notes, skill } = await course(learner, courseId);
    // An attached photo saved before this change was an ordinary material, with no purpose stored.
    const { material: legacy } = await learner.ok("/courses/materials/add", upload(courseId, { title: "My work: old-answer.md", files: [answerFile()] }));
    await app.connection.db.collection("library.materials").updateOne({ _id: legacy } as never, { $unset: { purpose: "" } });
    expect(await app.connection.db.collection("library.materials").findOne({ _id: legacy } as never)).not.toHaveProperty("purpose");

    const read = await learner.ok("/courses/read", { course: courseId });
    expect(read.materials.map((row: { material: string }) => row.material).sort()).toEqual([notes, legacy].sort());
    expect(read.work).toEqual([]);
    expect(await app.Library._material({ material: legacy as never })).toEqual([expect.objectContaining({ purpose: "SOURCE" })]);
    expect((await app.Library._sourceSet({ owner: user as never, scope: courseId as never })).sources.map((row) => row.material as string).sort()).toEqual([notes, legacy].sort());
    // It can still be added to a skill, as before.
    expect(await learner.ok("/courses/skills/sources/add", { skill, material: legacy })).toEqual({});
  }, 60_000);
});
