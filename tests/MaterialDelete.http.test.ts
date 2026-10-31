import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { composition as Access, admissions } from "../src/compositions/access.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { DiskStore } from "../src/host/file-store.ts";
import { Gemini } from "../src/host/gemini.ts";
import { MATERIAL_DELETED_READ } from "../src/host/http-policy.ts";
import { MaterialFiles } from "../src/host/material-files.ts";
import { IMPORT_REMOVED, MATERIAL_DELETE_UNAVAILABLE } from "../src/host/material-routes.ts";
import { createRuntime } from "../src/host/runtime.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import type { MediaValue } from "../src/media.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { answer, fakeGemini } from "./fixtures/fake-gemini.ts";
import { wav } from "./fixtures/media.ts";
import { openLesson } from "./fixtures/open-lesson.ts";

const ORIGIN = "http://localhost:5173";
let directory: string;
const cleanups: (() => Promise<void>)[] = [];
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), "stillgotit-delete-http-")); });
afterAll(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  if (directory) await rm(directory, { recursive: true, force: true });
});

// The request admission sentences for a skill or a session whose every source was deleted (access.ts).
const SKILL_SOURCES_DELETED = admissions["/learning/lesson"][1].detail;
const SESSION_SOURCES_DELETED = admissions["/learning/question"][1].detail;

/** A runtime with retained files in a temporary disk store and a tutor that cites the first source it is sent. */
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), google = fakeGemini({ generate: () => answer('{"segments":[{"start":0,"end":2,"text":"Today we find eigenvalues."}]}') });
  const gemini = new Gemini({ key: "test-key-not-real", fetch: google.fetch, pollMs: 1 });
  const store = new DiskStore(resolve(directory, randomUUID())), files = new MaterialFiles(store);
  // Each tutor request's kind and the materials it was sent, so a test can check that a deleted material is never sent.
  const sent: { kind: string; materials: string[] }[] = [];
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrices", skills: [{ title: "Multiply matrices", outcome: "Compute products.", gate: "Solve two new products." }] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      const kind = properties.explanation ? "LESSON" : properties.question ? "TASK" : properties.rationale ? "GRADE" : properties.citations ? "REPLY" : "HINT";
      sent.push({ kind, materials: sources.map((source) => source.material) });
      if (kind === "GRADE") {
        const help = (context as { help: string }).help;
        return { result: help === "NONE" ? "INDEPENDENT" : "SUPPORTED", gateMet: help === "NONE", rationale: "Both products are right, and the order is explained." };
      }
      const citations = [{ material: sources[0]!.material, location: sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content" }];
      if (kind === "LESSON") return { explanation: "Match each row with a column.", citations };
      if (kind === "TASK") return { question: "Multiply [[1,2],[3,4]] by [[2,0],[1,2]]. Why does order matter?", citations };
      return { text: kind === "REPLY" ? "Changing the order pairs different rows and columns." : "Check the dimensions first.", citations };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, gemini, files, tutor });
  cleanups.push(async () => { await runtime.worker.stop(); await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });

  function browser() {
    const jar = new Map<string, string>();
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
      const { course } = await ok("/courses/create", { title: "Linear algebra" });
      return { user: identity.user as string, course: course as string };
    }
    return { post, ok, signIn };
  }

  /** Whether every retained file of these originals is still in the store. */
  async function stored(owner: string, originals: MediaValue[]) {
    const found = await Promise.all(originals.map((item) => store.exists(files.storeKey(owner, item.file))));
    return found.every(Boolean) ? "all" : found.some(Boolean) ? "some" : "none";
  }
  const operations = () => connection.db.collection("materialimport.operations");
  const library = () => connection.db.collection("library.materials");
  return { runtime, connection, browser, stored, operations, library, sent };
}

function upload(course: string, { requestId = randomUUID(), title = "Matrix notes", files = [notes()] }: { requestId?: string; title?: string; files?: File[] } = {}) {
  const body = new FormData();
  body.set("course", course); body.set("title", title); body.set("requestId", requestId);
  for (const file of files) body.append("files", file);
  return body;
}
const notes = (text = "# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match.", name = "notes.md") => new File([text], name, { type: "text/markdown" });

/** Uploads one material and reads it back with its retained files. */
async function material(learner: ReturnType<Awaited<ReturnType<typeof setup>>["browser"]>, course: string, title = "Matrix notes", text?: string) {
  const requestId = randomUUID();
  const { material } = await learner.ok("/courses/materials/add", upload(course, { requestId, title, files: [notes(text ?? `# ${title}\nMultiply rows by columns.`)] }));
  const { originals } = await learner.ok("/courses/materials/read", { material });
  return { material: material as string, requestId, originals: originals as MediaValue[] };
}

/** A confirmed skill taught from the given materials, with a starting confidence. */
async function confirmedSkill(learner: ReturnType<Awaited<ReturnType<typeof setup>>["browser"]>, course: string, title: string, sources: string[]) {
  const { unit } = await learner.ok("/courses/units/add", { course, title: `${title} unit` });
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: randomUUID(), unit, material: sources[0], title, outcome: "Compute products.", gate: "Solve two new products." });
  await learner.ok("/courses/skills/confirm", { skill });
  for (const source of sources.slice(1)) await learner.ok("/courses/skills/sources/add", { skill, material: source });
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  return skill as string;
}

describe("Deleting a material", () => {
  test("the owner deletes a material: it leaves the library, its text and files are removed, and deleting again answers the same", async () => {
    const app = await setup(), learner = app.browser(), { user, course } = await learner.signIn("maya");
    const first = await material(learner, course, "Week 3 notes"), second = await material(learner, course, "Week 4 notes");
    expect(await app.stored(user, first.originals)).toBe("all");

    expect(await learner.post("/courses/materials/delete", { material: first.material })).toEqual({ status: 200, body: {} });

    // The library lists only the other material, and names the deleted one so citations of it can say so.
    const read = await learner.ok("/courses/read", { course });
    expect(read.materials.map((row: { material: string }) => row.material)).toEqual([second.material]);
    expect(read.deletedMaterials).toEqual([{ material: first.material }]);
    // Reading it answers that it was deleted, with a sentence, and its files can no longer be downloaded.
    expect(await learner.post("/courses/materials/read", { material: first.material })).toEqual({ status: 404, body: { error: "NOT_FOUND", detail: MATERIAL_DELETED_READ } });
    expect((await learner.post("/courses/materials/file", { material: first.material, file: first.originals[0]!.file })).status).toBe(403);
    // Its retained files are gone from the store, and the other material's files stay.
    expect(await app.stored(user, first.originals)).toBe("none");
    expect(await app.stored(user, second.originals)).toBe("all");
    // Only the identity, owner, course, and import key remain of the material, and its import keeps no text read from it.
    const tombstone = await app.library().findOne({ _id: first.material as never });
    expect(Object.keys(tombstone!).sort()).toEqual(["_id", "deleted", "importKey", "owner", "scope"]);
    const operation = await app.operations().findOne({ requestId: first.requestId });
    expect(operation).toMatchObject({ stage: "DISCARDED", filesDeleted: true, material: first.material });
    expect(operation!.prepared).toBeUndefined();
    expect(JSON.stringify(operation)).not.toContain("Multiply rows by columns");

    // Deleting again, as after a lost answer, answers the same and changes nothing.
    expect(await learner.post("/courses/materials/delete", { material: first.material })).toEqual({ status: 200, body: {} });
    expect((await learner.ok("/courses/read", { course })).deletedMaterials).toEqual([{ material: first.material }]);
    // The original upload, sent again, does not bring the material back.
    expect(await learner.post("/courses/materials/add", upload(course, { requestId: first.requestId, title: "Week 3 notes", files: [notes("# Week 3 notes\nMultiply rows by columns.")] })))
      .toEqual({ status: 409, body: { error: "IMPORT_REMOVED", detail: IMPORT_REMOVED } });
    // Skills cannot be suggested from it any more.
    expect(await learner.post("/courses/skills/suggest", { material: first.material })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Choose a source from your own course." } });
    // Importing the same file again makes a new material.
    const again = await material(learner, course, "Week 3 notes");
    expect(again.material).not.toBe(first.material);
  });

  test("only the owner can delete; another learner, an unknown identity, and an upload still importing are refused with a code and a sentence", async () => {
    const app = await setup(), learner = app.browser(), other = app.browser(), anonymous = app.browser();
    const { user, course } = await learner.signIn("maya");
    await other.signIn("leo");
    const saved = await material(learner, course);
    const unavailable = { status: 404, body: { error: "MATERIAL_UNAVAILABLE", detail: MATERIAL_DELETE_UNAVAILABLE } };

    expect((await anonymous.post("/courses/materials/delete", { material: saved.material })).status).toBe(401);
    expect(await other.post("/courses/materials/delete", { material: saved.material })).toEqual(unavailable);
    expect(await learner.post("/courses/materials/delete", { material: randomUUID() })).toEqual(unavailable);
    for (const body of [{}, { material: 5 }, { material: " " }, { material: "x".repeat(101) }]) {
      expect(await learner.post("/courses/materials/delete", body), JSON.stringify(body)).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
    }
    // Browsers cannot reach the private endpoint.
    expect((await learner.post("/internal/materials/delete", { material: saved.material })).status).toBe(403);
    // Nothing changed for the owner.
    expect((await learner.ok("/courses/materials/read", { material: saved.material })).originals).toEqual(saved.originals);
    expect(await app.stored(user, saved.originals)).toBe("all");

    // An upload still being transcribed is an import, not a material: it is refused here and is left as it was.
    const requestId = randomUUID();
    expect(await learner.ok("/courses/materials/add", upload(course, { requestId, title: "Lecture", files: [notes(), new File([wav(2)], "lecture.wav")] })))
      .toEqual({ requestId, state: "TRANSCRIBING" });
    const before = await app.operations().findOne({ requestId });
    expect(await learner.post("/courses/materials/delete", { material: requestId })).toEqual(unavailable);
    expect(await learner.post("/courses/materials/delete", { material: before!.importKey })).toEqual(unavailable);
    expect(await app.operations().findOne({ requestId })).toEqual(before);
    expect((await learner.ok("/courses/materials/imports", { course })).imports).toMatchObject([{ requestId, state: "TRANSCRIBING" }]);

    // After the owner deletes it, another learner still learns nothing about it.
    await learner.ok("/courses/materials/delete", { material: saved.material });
    expect(await other.post("/courses/materials/delete", { material: saved.material })).toEqual(unavailable);
    expect(await other.post("/courses/materials/read", { material: saved.material })).toMatchObject({ status: 403, body: { error: "FORBIDDEN" } });
  });

  test("request admission admits only the owner's kept material in a course they own", async () => {
    const app = await setup(), learner = app.browser(), other = app.browser();
    const { user, course } = await learner.signIn("maya"), { user: leo } = await other.signIn("leo");
    const saved = await material(learner, course);
    const form = (owner: string, id: string) => app.runtime.application.form(Access.DeleteReady({ owner, material: id }));
    expect(await form(user, saved.material)).toEqual({ allowed: true });
    expect(await form(leo, saved.material)).toBeNull();
    expect(await form(user, randomUUID())).toBeNull();
    await learner.ok("/courses/materials/delete", { material: saved.material });
    expect(await form(user, saved.material)).toBeNull();
  });

  test("a deletion stopped before its import was removed is finished by the next listing of the course", async () => {
    const app = await setup(), learner = app.browser(), { user, course } = await learner.signIn("maya");
    const saved = await material(learner, course);
    const discard = spyOn(app.runtime.imports, "discardSaved").mockImplementationOnce(async () => { throw new Error("Process stopped"); });
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      // The material is deleted, and its files are deleted from its own references.
      expect(await learner.post("/courses/materials/delete", { material: saved.material })).toEqual({ status: 200, body: {} });
      expect(await app.stored(user, saved.originals)).toBe("none");
      expect(await app.operations().findOne({ requestId: saved.requestId })).toMatchObject({ stage: "COMPLETE" });
      // The next listing removes the import and its text.
      expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
      const operation = await app.operations().findOne({ requestId: saved.requestId });
      expect(operation).toMatchObject({ stage: "DISCARDED", filesDeleted: true });
      expect(operation!.prepared).toBeUndefined();
    } finally { discard.mockRestore(); warn.mockRestore(); }
  });

  test("a material saved before imports were recorded has its files deleted from its own references", async () => {
    const app = await setup(), learner = app.browser(), { user, course } = await learner.signIn("maya");
    const legacy = await material(learner, course, "Old notes"), other = await material(learner, course, "New notes");
    // Materials saved before the import store existed have no import record.
    await app.operations().deleteOne({ requestId: legacy.requestId });
    expect(await learner.post("/courses/materials/delete", { material: legacy.material })).toEqual({ status: 200, body: {} });
    expect(await app.stored(user, legacy.originals)).toBe("none");
    expect(await app.stored(user, other.originals)).toBe("all");
    expect(await app.operations().findOne({ requestId: other.requestId })).toMatchObject({ stage: "COMPLETE" });
  });

  test("a material deleted before its import recorded it is not saved again by the listing or by a repeated upload", async () => {
    const app = await setup(), learner = app.browser(), { user, course } = await learner.signIn("maya");
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      for (const retry of ["listing", "upload"] as const) {
        const requestId = randomUUID(), title = `Saved during a stop (${retry})`;
        const files = () => [notes(`# ${title}\nMultiply rows by columns.`)];
        const complete = spyOn(app.runtime.imports, "complete").mockImplementationOnce(async () => { throw new Error("Process stopped"); });
        try { expect(await learner.ok("/courses/materials/add", upload(course, { requestId, title, files: files() }))).toEqual({ requestId, state: "SAVING" }); }
        finally { complete.mockRestore(); }
        // The material was saved, but its import is still READY.
        const listed = (await learner.ok("/courses/read", { course })).materials.find((row: { title: string }) => row.title === title);
        const { originals } = await learner.ok("/courses/materials/read", { material: listed.material });
        expect(await learner.post("/courses/materials/delete", { material: listed.material })).toEqual({ status: 200, body: {} });
        expect(await app.stored(user, originals)).toBe("none");
        expect(await app.operations().findOne({ requestId })).toMatchObject({ stage: "READY" });

        if (retry === "listing") expect(await learner.ok("/courses/materials/imports", { course })).toEqual({ imports: [], saved: [] });
        else expect(await learner.post("/courses/materials/add", upload(course, { requestId, title, files: files() }))).toEqual({ status: 409, body: { error: "IMPORT_REMOVED", detail: IMPORT_REMOVED } });
        const operation = await app.operations().findOne({ requestId });
        expect(operation).toMatchObject({ stage: "DISCARDED", filesDeleted: true });
        expect(operation!.prepared).toBeUndefined();
        const read = await learner.ok("/courses/read", { course });
        expect(read.materials.some((row: { title: string }) => row.title === title)).toBe(false);
        expect(read.deletedMaterials).toContainEqual({ material: listed.material });
      }
    } finally { warn.mockRestore(); }
  });
});

describe("After a material is deleted", () => {
  test("past lessons keep their citations, drafts from it are discarded, and lessons use only the sources that remain", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const week3 = await material(learner, course, "Week 3 notes"), week4 = await material(learner, course, "Week 4 notes");
    // One skill taught only from week 3, one from both weeks, a draft from each week, and a lesson citing week 3.
    const only = await confirmedSkill(learner, course, "Multiply matrices", [week3.material]);
    const both = await confirmedSkill(learner, course, "Check dimensions", [week3.material, week4.material]);
    const { unit } = await learner.ok("/courses/units/add", { course, title: "Drafts" });
    const { skill: draft3 } = await learner.ok("/courses/skills/propose", { proposalKey: randomUUID(), unit, material: week3.material, title: "Draft from week 3", outcome: "Do it.", gate: "Twice." });
    const { skill: draft4 } = await learner.ok("/courses/skills/propose", { proposalKey: randomUUID(), unit, material: week4.material, title: "Draft from week 4", outcome: "Do it.", gate: "Twice." });
    const { lesson } = await openLesson(learner.ok, { skill: only, request: "Why must the inner dimensions match?" });
    const cited = (await learner.ok("/learning/read", { skill: only })).sessions.find((row: { session: string }) => row.session === lesson);
    expect(cited.citations).toEqual([{ material: week3.material, location: expect.any(String) }]);

    await learner.ok("/courses/materials/delete", { material: week3.material });

    // The draft saved from week 3 is discarded; the other draft and both confirmed skills stay, with their sources.
    const read = await learner.ok("/courses/read", { course });
    expect(read.skills.map((row: { skill: string }) => row.skill).sort()).toEqual([only, both, draft4].sort());
    expect(read.skills.find((row: { skill: string }) => row.skill === draft3)).toBeUndefined();
    expect(read.skillSources.filter((row: { skill: string }) => row.skill === only)).toEqual([{ skill: only, material: week3.material }]);
    // The past lesson still has its explanation and its citation, and the citation's material reads as deleted.
    const kept = (await learner.ok("/learning/read", { skill: only })).sessions.find((row: { session: string }) => row.session === lesson);
    expect(kept).toMatchObject({ citations: cited.citations, lesson: { explanation: "Match each row with a column." }, status: "OPEN" });
    expect(await learner.post("/courses/materials/read", { material: week3.material })).toEqual({ status: 404, body: { error: "NOT_FOUND", detail: MATERIAL_DELETED_READ } });

    // The open lesson cannot ask the tutor any more, and says why; nothing is saved, and the lesson can still be finished.
    app.sent.length = 0;
    expect(await learner.post("/learning/question", { studySession: lesson, text: "And for 3 × 3?", dialogueLength: 0 }))
      .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SESSION_SOURCES_DELETED } });
    expect(await learner.post("/learning/reply", { studySession: lesson })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SESSION_SOURCES_DELETED } });
    expect((await learner.ok("/learning/read", { skill: only })).sessions.find((row: { session: string }) => row.session === lesson).dialogue).toEqual([]);
    expect(app.sent).toEqual([]);
    expect(await learner.ok("/learning/finish", { studySession: lesson })).toEqual({});

    // A skill taught only from week 3 cannot start a lesson or practice, and says what to do.
    for (const path of ["/learning/lesson", "/learning/task"]) {
      expect(await learner.post(path, { skill: only, request: "Teach me again" }), path).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SKILL_SOURCES_DELETED } });
    }
    // A skill with another source keeps working, grounded only in what remains.
    const { lesson: next } = await openLesson(learner.ok, { skill: both, request: "Teach me dimensions." });
    const nextRead = (await learner.ok("/learning/read", { skill: both })).sessions.find((row: { session: string }) => row.session === next);
    expect(nextRead.materials).toEqual([week4.material]);
    expect(nextRead.citations).toEqual([{ material: week4.material, location: expect.any(String) }]);
    // Once another source is added, the first skill can be studied again.
    await learner.ok("/courses/skills/sources/add", { skill: only, material: week4.material });
    const { lesson: resumed } = await openLesson(learner.ok, { skill: only, request: "Teach me again." });
    expect((await learner.ok("/learning/read", { skill: only })).sessions.find((row: { session: string }) => row.session === resumed).materials).toEqual([week4.material]);
    expect(app.sent.every((request) => !request.materials.includes(week3.material))).toBe(true);
  });

  test("an open lesson grounded in two materials keeps answering from the one that remains", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const week3 = await material(learner, course, "Week 3 notes"), week4 = await material(learner, course, "Week 4 notes");
    const skill = await confirmedSkill(learner, course, "Multiply matrices", [week3.material, week4.material]);
    const { lesson } = await openLesson(learner.ok, { skill, request: "Teach me." });
    await learner.ok("/courses/materials/delete", { material: week3.material });
    app.sent.length = 0;
    await learner.ok("/learning/question", { studySession: lesson, text: "Why does order matter?", dialogueLength: 0 });
    expect(app.sent).toEqual([{ kind: "REPLY", materials: [week4.material] }]);
    const saved = (await learner.ok("/learning/read", { skill })).sessions.find((row: { session: string }) => row.session === lesson);
    expect(saved.dialogue.at(-1).turn).toMatchObject({ speaker: "TUTOR", citations: [{ material: week4.material, location: expect.any(String) }] });
  });

  test("a practice attempt whose every source was deleted can still be answered and graded, but asks for no hint", async () => {
    const app = await setup(), learner = app.browser(), { course } = await learner.signIn("maya");
    const week3 = await material(learner, course, "Week 3 notes");
    const skill = await confirmedSkill(learner, course, "Multiply matrices", [week3.material]);
    const { task } = await learner.ok("/learning/task", { skill });
    await learner.ok("/courses/materials/delete", { material: week3.material });

    expect(await learner.post("/learning/hint", { studySession: task })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SESSION_SOURCES_DELETED } });
    await learner.ok("/learning/respond", { studySession: task, text: "[[4,4],[10,8]]. A row meets a column, so order changes the pairs.", dialogueLength: 0 });
    app.sent.length = 0;
    await learner.ok("/learning/assess", { studySession: task, reviewed: true, unseen: true, outsideHelp: false, dialogueLength: 1 });
    expect(app.sent).toEqual([{ kind: "GRADE", materials: [] }]);
    const read = await learner.ok("/learning/read", { skill });
    expect(read.cases[0].judgment).toMatchObject({ result: "INDEPENDENT" });
  });

  test("request admission explains a skill or a session left without sources, and admits one with a source left", async () => {
    const app = await setup(), learner = app.browser(), other = app.browser();
    const { user, course } = await learner.signIn("maya"), { user: leo } = await other.signIn("leo");
    const week3 = await material(learner, course, "Week 3 notes"), week4 = await material(learner, course, "Week 4 notes");
    const only = await confirmedSkill(learner, course, "Multiply matrices", [week3.material]);
    const both = await confirmedSkill(learner, course, "Check dimensions", [week3.material, week4.material]);
    const { lesson } = await openLesson(learner.ok, { skill: only, request: "Teach me." });
    const form = (check: Parameters<typeof app.runtime.application.form>[0]) => app.runtime.application.form(check);
    expect(await form(Access.SkillSourcesLeft({ owner: user, skill: only }))).toEqual({ allowed: true });
    expect(await form(Access.SessionSourcesLeft({ owner: user, studySession: lesson }))).toEqual({ allowed: true });
    await learner.ok("/courses/materials/delete", { material: week3.material });
    expect(await form(Access.SkillSourcesLeft({ owner: user, skill: only }))).toBeNull();
    expect(await form(Access.SkillSourcesLeft({ owner: user, skill: both }))).toEqual({ allowed: true });
    expect(await form(Access.SessionSourcesLeft({ owner: user, studySession: lesson }))).toBeNull();
    // Another learner's skill or session is not explained here; the general checks that follow decline it.
    expect(await form(Access.SkillSourcesLeft({ owner: leo, skill: only }))).toEqual({ allowed: true });
    expect(await form(Access.SessionSourcesLeft({ owner: leo, studySession: lesson }))).toEqual({ allowed: true });
    expect(await other.post("/learning/lesson", { skill: only, request: "Teach me" })).toEqual({ status: 400,
      body: { error: "INVALID_REQUEST", detail: admissions["/learning/lesson"].at(-1)!.detail } });
  });
});
