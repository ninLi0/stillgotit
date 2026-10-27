import { afterAll, expect, spyOn, test } from "bun:test";
import { Collection, FindCursor } from "mongodb";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { composition as Access, admissions, prerequisiteDetail } from "../src/compositions/access.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { createRuntime } from "../src/host/runtime.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { R, daysBetween, gradeOf, leftAlone, review, seed } from "./fixtures/fsrs.ts";

const ORIGIN = "http://localhost:5173", DAY = 86_400_000, cleanups: (() => Promise<void>)[] = [];
// Learning.md, "Refusal sentences": a material that is not the learner's own in this course.
const MATERIAL_UNAVAILABLE = "This material is not available in this course. Reload the page to see its materials.";
// Courses.md, "Course and skill refusals": a course, unit, or skill that is unknown or another learner's.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// The sentences SkillMapping states for each refusal these endpoints pass through.
const SENTENCES: Record<string, string> = {
  SKILL_DETAILS_UNAVAILABLE: "Choose one of your confirmed skills.",
  SKILL_UNIT_MISMATCH: "Choose a unit in the skill's course.",
  INVALID_SKILL_TITLE: "Enter a skill title.",
  SKILL_DEFINITION_UNAVAILABLE: "Choose one of your confirmed skills.",
  INVALID_SKILL_DEFINITION: "Enter an outcome and demonstration requirements.",
  SKILL_DEFINITION_UNCHANGED: "Change the outcome or requirements to create a new version.",
  SKILL_MATERIAL_UNAVAILABLE: "Choose one of your confirmed skills.",
  SKILL_PREREQUISITES_UNAVAILABLE: "Choose one of your confirmed skills.",
  INVALID_SKILL_PREREQUISITES: "Use confirmed skills from this course, without self-dependencies or cycles.",
  SKILL_ARCHIVE_UNAVAILABLE: "Choose one of your confirmed skills.",
  SKILL_STILL_REQUIRED: "Remove this skill from other active skills' prerequisites first.",
  SKILL_RESTORE_UNAVAILABLE: "Choose one of your archived skills.",
  SKILL_RESTORE_PREREQUISITES: "Restore this skill's prerequisites before restoring the skill.",
  DRAFT_DISCARD_UNAVAILABLE: "Only your draft skills can be discarded.",
};
// The HTTP error each refusal maps to in the host's public error policy, and its status.
const HTTP: Record<string, { status: number; error: string }> = {
  SKILL_DETAILS_UNAVAILABLE: { status: 409, error: "CONFLICT" }, SKILL_UNIT_MISMATCH: { status: 400, error: "INVALID_REQUEST" },
  INVALID_SKILL_TITLE: { status: 400, error: "INVALID_REQUEST" }, SKILL_DEFINITION_UNAVAILABLE: { status: 409, error: "CONFLICT" },
  INVALID_SKILL_DEFINITION: { status: 400, error: "INVALID_REQUEST" }, SKILL_DEFINITION_UNCHANGED: { status: 409, error: "CONFLICT" },
  SKILL_MATERIAL_UNAVAILABLE: { status: 409, error: "CONFLICT" }, SKILL_PREREQUISITES_UNAVAILABLE: { status: 409, error: "CONFLICT" },
  INVALID_SKILL_PREREQUISITES: { status: 400, error: "INVALID_REQUEST" }, SKILL_ARCHIVE_UNAVAILABLE: { status: 409, error: "CONFLICT" },
  SKILL_STILL_REQUIRED: { status: 409, error: "CONFLICT" }, SKILL_RESTORE_UNAVAILABLE: { status: 409, error: "CONFLICT" },
  SKILL_RESTORE_PREREQUISITES: { status: 409, error: "CONFLICT" }, DRAFT_DISCARD_UNAVAILABLE: { status: 409, error: "CONFLICT" },
};
// Each endpoint calls exactly one SkillMapping action.
const ACTIONS = {
  "/courses/skills/details": "editDetails", "/courses/skills/revise": "reviseDefinition", "/courses/skills/sources/add": "attachMaterial",
  "/courses/skills/prerequisites": "setPrerequisites", "/courses/skills/archive": "archive", "/courses/skills/restore": "restore",
  "/courses/skills/discard": "discardDraft",
} as const;

async function setup({ clock, tutor = {
  // Course editing never asks the tutor; a call would mean a flow reached generation by mistake.
  suggest: async () => { throw new Error("The course editing tests do not request suggestions."); },
  generate: async () => { throw new Error("The course editing tests do not generate tutoring."); },
} }: { clock?: () => Date; tutor?: Pick<CourseTutor, "generate" | "suggest"> } = {}) {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), runtimes: Awaited<ReturnType<typeof createRuntime>>[] = [], owners: string[] = [];
  const open = async () => {
    const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, ...(clock ? { clock } : {}) });
    runtimes.push(runtime); return runtime;
  };
  const runtime = await open();
  cleanups.push(async () => {
    for (const r of runtimes) await r.gateway.beginDrain();
    await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });
  const { concepts } = runtime.application;

  function browser() {
    const jar = new Map<string, string>();
    let user = "", session = "";
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body;
    }
    async function signIn(name: string) {
      const start = await ok("/auth/commons/start");
      await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
      user = (await ok("/auth/commons/resume")).user; owners.push(user);
      // A second session for the same learner drives the exported runtime gateway.
      const started = await concepts.Sessioning.start({ subject: user as never });
      if ("error" in started) throw new Error("The test session was refused.");
      session = started.session;
      return user;
    }
    /** Calls a path through the native gateway as this learner. */
    async function invoke(path: string, input: Record<string, unknown>) {
      return runtime.gateway.invoke(path, { ...input, session }, { timeoutMs: 5000 });
    }
    return { post, ok, signIn, invoke, get user() { return user; } };
  }

  /** Imports one text material into a course and returns its identity. */
  async function material(learner: ReturnType<typeof browser>, course: string, title = "Matrix notes") {
    const form = new FormData(); form.set("course", course); form.set("title", title); form.set("requestId", crypto.randomUUID());
    form.append("files", new File([`# ${title}\nMultiply rows by columns. Inner dimensions must match.`], "notes.md", { type: "text/markdown" }));
    return (await learner.ok("/courses/materials/add", form)).material as string;
  }
  /** Saves and confirms one skill. */
  async function skill(learner: ReturnType<typeof browser>, unit: string, source: string, title: string, confirm = true) {
    const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: source, title,
      outcome: `Outcome for ${title}`, gate: `Gate for ${title}` });
    if (confirm) await learner.ok("/courses/skills/confirm", { skill });
    return skill as string;
  }
  /** One learner, one course with two units and a material, and confirmed skills named by the caller. */
  async function course(name: string, titles: string[] = ["Products"]) {
    const learner = browser(); await learner.signIn(name);
    const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
    const source = await material(learner, course);
    const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
    const { unit: other } = await learner.ok("/courses/units/add", { course, title: "Inverses" });
    const skills: string[] = [];
    for (const title of titles) skills.push(await skill(learner, unit, source, title));
    return { learner, course, source, unit, other, skills };
  }
  return { connection, runtime, concepts, browser, material, skill, course };
}

type App = Awaited<ReturnType<typeof setup>>;
type Learner = ReturnType<App["browser"]>;

/** Everything a course read shows plus the learner's tracks, for "nothing changed" checks. */
async function snapshot(app: App, learner: Learner, course: string) {
  const read = await learner.ok("/courses/read", { course });
  const tracks = (await Promise.all(read.skills.map((row: { skill: string }) => app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: row.skill })))).flat();
  return { read, tracks };
}

/**
 * Checks that an owned request is refused with the action's own refusal: the native gateway answers with the
 * action's code, and SkillMapping states that code with the design's sentence. Over HTTP the body carries the
 * public error the host maps the code to, with the same sentence as `detail`; the code does not reach the browser.
 */
async function expectActionRefusal(app: App, learner: Learner, path: keyof typeof ACTIONS, input: Record<string, unknown>, code: string) {
  expect(await learner.invoke(path, input), path).toEqual({ ok: false, error: { kind: "domain", value: code, detail: SENTENCES[code] } });
  expect(await learner.post(path, input), path).toEqual({ status: HTTP[code]!.status, body: { error: HTTP[code]!.error, detail: SENTENCES[code] } });
  // The same input sent to the action itself is refused with that code and the design's sentence, changing nothing.
  const direct = (app.concepts.SkillMapping[ACTIONS[path]] as (input: Record<string, unknown>) => Promise<unknown>);
  const actionInput = path === "/courses/skills/prerequisites" ? { ...input, prerequisites: [...new Set(input.prerequisites as string[])] } : input;
  expect(await direct({ ...actionInput, owner: learner.user }), path).toEqual({ error: code, detail: SENTENCES[code] });
}

test("each new endpoint refuses an unknown or another learner's record with COURSE_UNAVAILABLE and changes nothing", async () => {
  const app = await setup(), { learner, course, source, unit, other, skills: [skill, second] } = await app.course("owner", ["Products", "Inverses"]);
  const outsider = app.browser(); await outsider.signIn("outsider");
  const { course: outsiderCourse } = await outsider.ok("/courses/create", { title: "Outsider course" });
  const outsiderSource = await app.material(outsider, outsiderCourse);
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await learner.ok("/courses/skills/prerequisites", { skill: second, prerequisites: [skill] });
  const draft = await app.skill(learner, unit, source, "A draft", false);
  const before = await snapshot(app, learner, course);
  const requests: [string, Record<string, unknown>][] = [
    ["/courses/skills/details", { skill, unit: other, title: "Renamed by someone else" }],
    ["/courses/skills/revise", { skill, outcome: "A forged outcome", gate: "A forged gate" }],
    ["/courses/skills/sources/add", { skill, material: outsiderSource }],
    ["/courses/skills/sources/add", { skill, material: source }],
    ["/courses/skills/prerequisites", { skill: second, prerequisites: [] }],
    ["/courses/skills/archive", { skill: second }],
    ["/courses/skills/restore", { skill }],
    ["/courses/skills/discard", { skill: draft }],
    ["/courses/units/emphasis", { unit, emphasized: true }],
  ];
  for (const [path, input] of requests) {
    // Another learner's record and an unknown record get the same answer.
    expect(await outsider.post(path, input), path).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(await outsider.invoke(path, input), path).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    const unknown = { ...input, ...("skill" in input ? { skill: crypto.randomUUID() } : { unit: crypto.randomUUID() }) };
    expect(await learner.post(path, unknown), path).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(await learner.invoke(path, unknown), path).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    // No request field names an owner: a forged owner field never acts as the record's owner.
    expect((await outsider.post(path, { ...input, owner: learner.user })).status, path).toBeGreaterThanOrEqual(400);
  }
  expect(await snapshot(app, learner, course)).toEqual(before);
}, 60_000);

test("DiscardDraft removes a saved draft with its versions and refuses any other skill with the concept's code and sentence", async () => {
  const app = await setup(), { learner, course, unit, source, skills: [skill, archived] } = await app.course("discard", ["Products", "Set aside"]);
  await learner.ok("/courses/skills/archive", { skill: archived });
  const draft = await app.skill(learner, unit, source, "A draft", false), other = await app.skill(learner, unit, source, "Another draft", false);
  // Editing the draft's requirements saves a second version, so both of its versions must go.
  const mapping = app.concepts.SkillMapping, current = async () => (await mapping._skill({ skill: draft }))[0]!.current;
  const first = await current();
  await learner.ok("/courses/skills/edit", { skill: draft, unit, material: source, title: "A draft", outcome: "A changed outcome", gate: "A changed gate" });
  const versions = [first, await current()];
  expect(versions[1]).not.toBe(first);
  for (const version of versions) expect(await mapping._version({ version })).toEqual([expect.objectContaining({ skill: draft })]);
  const before = await learner.ok("/courses/read", { course });

  expect(await learner.ok("/courses/skills/discard", { skill: draft })).toEqual({});
  // The course read loses the draft's rows and nothing else.
  const without = <T extends { skill: string }>(rows: T[]) => rows.filter((row) => row.skill !== draft);
  const after = await learner.ok("/courses/read", { course });
  expect(after).toEqual({ ...before, skills: without(before.skills), skillSources: without(before.skillSources), versions: without(before.versions),
    prerequisites: without(before.prerequisites) });
  expect(after.skills.map((row: { skill: string }) => row.skill)).toEqual(expect.arrayContaining([skill, archived, other]));
  // SkillMapping no longer has the skill or any of its versions.
  expect(await mapping._skill({ skill: draft })).toEqual([]);
  expect((await mapping._skills({ unit })).map((row) => row.skill)).not.toContain(draft);
  for (const version of versions) expect(await mapping._version({ version })).toEqual([]);
  // Repeating the request finds no skill, so it gets the answer for an unknown record.
  expect(await learner.post("/courses/skills/discard", { skill: draft })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
  expect(await learner.invoke("/courses/skills/discard", { skill: draft })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });

  // A confirmed skill and an archived skill are refused with the concept's code and sentence, and nothing changes.
  await expectActionRefusal(app, learner, "/courses/skills/discard", { skill }, "DRAFT_DISCARD_UNAVAILABLE");
  await expectActionRefusal(app, learner, "/courses/skills/discard", { skill: archived }, "DRAFT_DISCARD_UNAVAILABLE");
  // Another learner is refused as for an unknown skill, and nothing changes.
  const outsider = app.browser(); await outsider.signIn("discard-outsider");
  expect(await outsider.post("/courses/skills/discard", { skill: other })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
  expect(await outsider.invoke("/courses/skills/discard", { skill: other })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
  expect(await learner.ok("/courses/read", { course })).toEqual(after);

  // The native gateway discards a draft the same way.
  expect(await learner.invoke("/courses/skills/discard", { skill: other })).toEqual({ ok: true, value: {} });
  expect((await learner.ok("/courses/read", { course })).skills.map((row: { skill: string }) => row.skill)).not.toContain(other);
}, 60_000);

test("EditSkillDetails renames and moves a confirmed skill within its course and passes SkillMapping refusals through", async () => {
  const app = await setup(), { learner, course, unit, other, source, skills: [skill] } = await app.course("details");
  const before = await learner.ok("/courses/read", { course });
  expect(await learner.ok("/courses/skills/details", { skill, unit: other, title: "Multiply matrices" })).toEqual({});
  const after = await learner.ok("/courses/read", { course });
  const [row] = after.skills;
  expect(row).toMatchObject({ skill, unit: other, title: "Multiply matrices", current: before.skills[0].current, status: "CONFIRMED" });
  // The skill keeps its requirements version, sources, prerequisites, and history.
  expect({ ...after, skills: [] }).toEqual({ ...before, skills: [] });
  // Sending the saved unit and title again succeeds and changes nothing.
  expect(await learner.ok("/courses/skills/details", { skill, unit: other, title: "Multiply matrices" })).toEqual({});
  expect(await learner.ok("/courses/read", { course })).toEqual(after);

  const { course: secondCourse } = await learner.ok("/courses/create", { title: "Another course" });
  const { unit: foreignUnit } = await learner.ok("/courses/units/add", { course: secondCourse, title: "Elsewhere" });
  const draft = await app.skill(learner, unit, source, "A draft", false);
  await expectActionRefusal(app, learner, "/courses/skills/details", { skill, unit: other, title: "   " }, "INVALID_SKILL_TITLE");
  await expectActionRefusal(app, learner, "/courses/skills/details", { skill, unit: foreignUnit, title: "Moved away" }, "SKILL_UNIT_MISMATCH");
  await expectActionRefusal(app, learner, "/courses/skills/details", { skill: draft, unit, title: "Not yet confirmed" }, "SKILL_DETAILS_UNAVAILABLE");
  const unchanged = await learner.ok("/courses/read", { course });
  expect(unchanged.skills.find((r: { skill: string }) => r.skill === skill)).toEqual(row);
}, 60_000);

test("ReviseSkill saves a new version, keeps the old one readable, and starts its track from the previous estimate", async () => {
  let now = new Date();
  const app = await setup({ clock: () => new Date(now) }), { learner, course, unit, source, skills: [skill] } = await app.course("revise");
  const [{ current: first }] = (await learner.ok("/courses/read", { course })).skills;
  const { track: original } = await learner.ok("/learning/confidence", { skill, confidence: 60 });
  const startedAt = new Date(now);
  // One small slip on the earlier version: its estimate drops from 60 to 55, and the evidence stays on that track.
  const evidence = crypto.randomUUID();
  expect(await app.concepts.MasteryEstimating.acceptEvidence({ learner: learner.user, subject: skill, definition: first, evidence, revision: 1,
    performedAt: startedAt, signal: "SLIP", fresh: true, gateMet: false, attribution: "Staged small slip" })).not.toHaveProperty("error");
  await app.runtime.gateway.whenIdle();
  // Six days without practice lower the earlier estimate; the new track starts from that lowered value.
  now = new Date(now.getTime() + 6 * DAY);
  const revisedAt = new Date(now);
  const revised = await learner.ok("/courses/skills/revise", { skill, outcome: "Multiply and explain non-commutativity", gate: "Two fresh products with reasons" });
  expect(revised).toEqual({ previous: first, version: expect.any(String) });
  expect(revised.version).not.toBe(first);

  // Read the tracks before any course read, so the track is RevisedTrack's and not the read's repair.
  const tracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill });
  expect(tracks).toEqual([
    { track: original, definition: first, initialConfidence: 60, startingBasis: "SELF_REPORTED", initializedAt: startedAt },
    { track: expect.any(String), definition: revised.version, initialConfidence: expect.any(Number), startingBasis: "PREVIOUS_DEFINITION", initializedAt: revisedAt },
  ]);
  // The slip came at the start, so it was a same-day review of the memory that 60 seeds. From there the 55 fades
  // with the stability that review left, over the six days to the revision.
  const slipped = review(seed(60), gradeOf("SLIP"), 0);
  expect(tracks[1]!.initialConfidence).toBeCloseTo(55 * R(daysBetween(revisedAt, startedAt), slipped.stability), 9);
  expect(tracks[1]!.initialConfidence).toBeLessThan(55);
  // Evidence is not copied: the earlier track keeps its input, and the new track has none.
  expect((await app.concepts.MasteryEstimating._inputs({ track: original })).map((input) => input.evidence)).toEqual([evidence]);
  expect(await app.concepts.MasteryEstimating._inputs({ track: tracks[1]!.track })).toEqual([]);

  // Move the clock before the course read. A repair at this point would start a track later and from a more
  // decayed value, so finding the same track shows the read added none.
  now = new Date(now.getTime() + DAY / 2);
  const read = await learner.ok("/courses/read", { course });
  expect(read.skills).toEqual([expect.objectContaining({ skill, current: revised.version, status: "CONFIRMED",
    outcome: "Multiply and explain non-commutativity", gate: "Two fresh products with reasons" })]);
  expect(read.versions).toEqual([
    { skill, version: revised.version, outcome: "Multiply and explain non-commutativity", gate: "Two fresh products with reasons" },
    { skill, version: first, outcome: "Outcome for Products", gate: "Gate for Products" },
  ]);
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toEqual(tracks);
  // The new track has no evidence, so its explanation says a new check is needed.
  const [estimate] = await app.concepts.MasteryEstimating._estimate({ learner: learner.user, subject: skill, definition: revised.version, at: now });
  expect(estimate!.basis).toContain("these requirements need a new check");

  // Repeating a saved revision is refused as unchanged and adds no version or track.
  await expectActionRefusal(app, learner, "/courses/skills/revise", { skill, outcome: "Multiply and explain non-commutativity", gate: "Two fresh products with reasons" }, "SKILL_DEFINITION_UNCHANGED");
  await expectActionRefusal(app, learner, "/courses/skills/revise", { skill, outcome: "A new outcome", gate: " " }, "INVALID_SKILL_DEFINITION");
  const draft = await app.skill(learner, unit, source, "A draft", false);
  await expectActionRefusal(app, learner, "/courses/skills/revise", { skill: draft, outcome: "Changed", gate: "Changed" }, "SKILL_DEFINITION_UNAVAILABLE");
  expect((await learner.ok("/courses/read", { course })).versions.filter((r: { skill: string }) => r.skill === skill)).toHaveLength(2);
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toEqual(tracks);
}, 60_000);

/** Records "write started" and "write finished" around each PREVIOUS_DEFINITION track insert, holding it for a while. */
function delayRevisedTrackWrites(log: string[]) {
  const original = Collection.prototype.insertOne as (...args: unknown[]) => Promise<unknown>;
  return spyOn(Collection.prototype, "insertOne").mockImplementation(async function (this: Collection, ...args: unknown[]) {
    if (this.collectionName !== "masteryestimating.tracks" || (args[0] as { startingBasis?: string }).startingBasis !== "PREVIOUS_DEFINITION") {
      return original.apply(this, args);
    }
    log.push("write started");
    // Long enough that an answer which did not wait for this write would arrive first.
    await Bun.sleep(500);
    const result = await original.apply(this, args);
    log.push("write finished");
    return result;
  } as never);
}

test("ReviseSkill answers over HTTP and the native gateway only after RevisedTrack has saved the new track", async () => {
  const app = await setup(), { learner, skills: [skill] } = await app.course("ordering");
  await learner.ok("/learning/confidence", { skill, confidence: 60 });
  const log: string[] = [];
  const delayed = delayRevisedTrackWrites(log);
  try {
    const http = await learner.post("/courses/skills/revise", { skill, outcome: "Second outcome", gate: "Second gate" });
    log.push("answer received");
    expect(http.status).toBe(200);
    expect(log).toEqual(["write started", "write finished", "answer received"]);
    // No course read has run in this test, so the track can only be RevisedTrack's.
    expect(await app.concepts.MasteryEstimating._track({ learner: learner.user, subject: skill, definition: http.body.version }))
      .toEqual([expect.objectContaining({ startingBasis: "PREVIOUS_DEFINITION" })]);

    // The second revision's previous version is the first revision, whose track RevisedTrack just saved.
    log.length = 0;
    const native = await learner.invoke("/courses/skills/revise", { skill, outcome: "Third outcome", gate: "Third gate" });
    log.push("answer received");
    expect(native).toEqual({ ok: true, value: { previous: http.body.version, version: expect.any(String) } });
    expect(log).toEqual(["write started", "write finished", "answer received"]);
    const { version } = (native as { value: { version: string } }).value;
    expect(await app.concepts.MasteryEstimating._track({ learner: learner.user, subject: skill, definition: version }))
      .toEqual([expect.objectContaining({ startingBasis: "PREVIOUS_DEFINITION" })]);
  } finally { delayed.mockRestore(); }
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toHaveLength(3);
}, 30_000);

test("a revision whose previous version has no track starts none, and the course read adds none", async () => {
  const app = await setup(), { learner, course, skills: [skill] } = await app.course("no-track");
  const { version } = await learner.ok("/courses/skills/revise", { skill, outcome: "A revised outcome", gate: "A revised gate" });
  expect(version).toEqual(expect.any(String));
  await learner.ok("/courses/read", { course });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toEqual([]);
  // The learner sets a starting confidence for the new version as for any confirmed skill.
  await learner.ok("/learning/confidence", { skill, confidence: 40 });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill }))
    .toEqual([expect.objectContaining({ definition: version, initialConfidence: 40, startingBasis: "SELF_REPORTED" })]);
}, 30_000);

/** Makes every MasteryEstimating track insert fail until the returned spy is restored. */
function failTrackWrites() {
  const original = Collection.prototype.insertOne as (...args: unknown[]) => Promise<unknown>;
  return spyOn(Collection.prototype, "insertOne").mockImplementation(async function (this: Collection, ...args: unknown[]) {
    if (this.collectionName === "masteryestimating.tracks") throw new Error("Stopped before the track write.");
    return original.apply(this, args);
  } as never);
}

test("RepairRevisedTrack starts a missing track on the next course read, and repeated reads add no track", async () => {
  let now = new Date();
  const app = await setup({ clock: () => new Date(now) }), { learner, course, skills: [skill] } = await app.course("repair");
  const { track: original } = await learner.ok("/learning/confidence", { skill, confidence: 80 });
  now = new Date(now.getTime() + 2 * DAY);
  const failing = failTrackWrites();
  let revised: { previous: string; version: string };
  try {
    // The revision is saved before the track write fails. See the report: the answer is still a success.
    const answer = await learner.post("/courses/skills/revise", { skill, outcome: "Revised outcome", gate: "Revised gate" });
    revised = answer.body;
    expect((await app.concepts.SkillMapping._skill({ skill }))[0]!.current).toBe(revised.version);
  } finally { failing.mockRestore(); }
  await app.runtime.gateway.whenIdle();
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toEqual([expect.objectContaining({ track: original })]);

  // Other reads that check the session do not repair; only the course read does.
  await learner.ok("/courses", {});
  await learner.ok("/learning/read", { skill });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toHaveLength(1);

  now = new Date(now.getTime() + 3 * DAY);
  await learner.ok("/courses/read", { course });
  const repaired = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill });
  expect(repaired).toEqual([
    expect.objectContaining({ track: original, initialConfidence: 80, startingBasis: "SELF_REPORTED" }),
    expect.objectContaining({ definition: revised!.version, startingBasis: "PREVIOUS_DEFINITION", initializedAt: now }),
  ]);
  // The carried value is the earlier track's estimate measured at that read, five days after it started.
  expect(repaired[1]!.initialConfidence).toBeCloseTo(leftAlone(80, 5), 9);
  for (let read = 0; read < 3; read++) await learner.ok("/courses/read", { course });
  await Promise.all([learner.ok("/courses/read", { course }), learner.ok("/courses/read", { course })]);
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toEqual(repaired);
}, 60_000);

test("the repair leaves a confidence the learner reported after a failed track write, and carries the latest earlier track after two revisions", async () => {
  const app = await setup(), { learner, course, skills: [kept, twice] } = await app.course("repair-cases", ["Kept", "Twice"]);
  await learner.ok("/learning/confidence", { skill: kept, confidence: 70 });
  const { track: firstTwice } = await learner.ok("/learning/confidence", { skill: twice, confidence: 30 });
  const failing = failTrackWrites();
  let keptVersion: string, secondVersion: string;
  try {
    keptVersion = (await learner.post("/courses/skills/revise", { skill: kept, outcome: "New kept outcome", gate: "New kept gate" })).body.version;
    await learner.post("/courses/skills/revise", { skill: twice, outcome: "Second outcome", gate: "Second gate" });
    // A second revision before any course read finds no track for its previous version and does nothing.
    secondVersion = (await learner.post("/courses/skills/revise", { skill: twice, outcome: "Third outcome", gate: "Third gate" })).body.version;
  } finally { failing.mockRestore(); }
  await app.runtime.gateway.whenIdle();
  // A starting confidence reported before the next course read is kept; the repair leaves it alone.
  await learner.ok("/learning/confidence", { skill: kept, confidence: 15 });
  await learner.ok("/courses/read", { course });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: kept })).toEqual([
    expect.objectContaining({ initialConfidence: 70, startingBasis: "SELF_REPORTED" }),
    expect.objectContaining({ definition: keptVersion!, initialConfidence: 15, startingBasis: "SELF_REPORTED" }),
  ]);
  const twiceTracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: twice });
  expect(twiceTracks).toEqual([
    expect.objectContaining({ track: firstTwice, initialConfidence: 30 }),
    expect.objectContaining({ definition: secondVersion!, startingBasis: "PREVIOUS_DEFINITION" }),
  ]);
  expect(twiceTracks[1]!.initialConfidence).toBeCloseTo(30, 3);
}, 60_000);

test("RevisedTrack treats an existing track for the new version as done, and ReviseSkill still succeeds", async () => {
  const app = await setup(), { learner, course, skills: [skill] } = await app.course("existing-track");
  await learner.ok("/learning/confidence", { skill, confidence: 55 });
  // Save a track for the new version as soon as its version record exists, before RevisedTrack can look,
  // and record every attempt to save a PREVIOUS_DEFINITION track.
  const raw = new MasteryEstimating(app.connection.db), attempts: string[] = [];
  const original = Collection.prototype.insertOne as (...args: unknown[]) => Promise<unknown>;
  const early = spyOn(Collection.prototype, "insertOne").mockImplementation(async function (this: Collection, ...args: unknown[]) {
    const record = args[0] as { _id: string; previous?: string; startingBasis?: string; definition?: string };
    if (this.collectionName === "masteryestimating.tracks" && record.startingBasis === "PREVIOUS_DEFINITION") attempts.push(record.definition!);
    const result = await original.apply(this, args);
    if (this.collectionName === "SkillMapping.versions" && record.previous) {
      await raw.initialize({ learner: learner.user, subject: skill, definition: record._id, confidence: 20, basis: "SELF_REPORTED" });
    }
    return result;
  } as never);
  let revised: { version: string };
  try { revised = await learner.ok("/courses/skills/revise", { skill, outcome: "Changed outcome", gate: "Changed gate" }); }
  finally { early.mockRestore(); }
  // RevisedTrack found the existing track and did not try to save another. Check before any course read.
  expect(attempts).toEqual([]);
  const tracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill });
  expect(tracks).toEqual([
    expect.objectContaining({ initialConfidence: 55, startingBasis: "SELF_REPORTED" }),
    expect.objectContaining({ definition: revised!.version, initialConfidence: 20, startingBasis: "SELF_REPORTED" }),
  ]);
  // The course read's repair also treats that track as done.
  await learner.ok("/courses/read", { course });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: skill })).toEqual(tracks);
}, 30_000);

test("AddSkillSource attaches an owned material from the skill's course and refuses any other material", async () => {
  const app = await setup(), { learner, course, unit, source, skills: [skill] } = await app.course("sources");
  const second = await app.material(learner, course, "Inverse notes");
  const [{ current }] = (await learner.ok("/courses/read", { course })).skills;
  expect(await learner.ok("/courses/skills/sources/add", { skill, material: second })).toEqual({});
  const read = await learner.ok("/courses/read", { course });
  expect(read.skillSources).toEqual([source, second].sort().map((material) => ({ skill, material })));
  expect(read.skills[0].current).toBe(current);
  // Attaching a material the skill already has succeeds and changes nothing.
  expect(await learner.ok("/courses/skills/sources/add", { skill, material: second })).toEqual({});
  expect(await learner.ok("/courses/read", { course })).toEqual(read);

  const { course: otherCourse } = await learner.ok("/courses/create", { title: "Another course" });
  const otherCourseMaterial = await app.material(learner, otherCourse, "Other course notes");
  const outsider = app.browser(); await outsider.signIn("source-outsider");
  const { course: outsiderCourse } = await outsider.ok("/courses/create", { title: "Outsider" });
  const outsiderMaterial = await app.material(outsider, outsiderCourse, "Outsider notes");
  for (const material of [otherCourseMaterial, outsiderMaterial, crypto.randomUUID()]) {
    expect(await learner.post("/courses/skills/sources/add", { skill, material })).toMatchObject({ status: 403, body: { error: "FORBIDDEN" } });
    expect(await learner.invoke("/courses/skills/sources/add", { skill, material })).toEqual({ ok: false, error: { kind: "domain", value: "MATERIAL_UNAVAILABLE", detail: MATERIAL_UNAVAILABLE } });
  }
  expect(await learner.ok("/courses/read", { course })).toEqual(read);
  const draft = await app.skill(learner, unit, source, "A draft", false);
  await expectActionRefusal(app, learner, "/courses/skills/sources/add", { skill: draft, material: second }, "SKILL_MATERIAL_UNAVAILABLE");
}, 60_000);

test("SetSkillPrerequisites replaces the whole set from a list and passes prerequisite rule refusals through", async () => {
  const app = await setup(), { learner, course, unit, source, skills: [a, b, c] } = await app.course("prerequisites", ["A", "B", "C"]);
  const links = async () => (await learner.ok("/courses/read", { course })).prerequisites;
  // A repeated identity counts once.
  expect(await learner.ok("/courses/skills/prerequisites", { skill: a, prerequisites: [c, b, c] })).toEqual({});
  expect(await links()).toEqual([b, c].sort().map((prerequisite) => ({ skill: a, prerequisite })));
  // Sending the saved set again succeeds and changes nothing; a new set replaces the old one.
  expect(await learner.ok("/courses/skills/prerequisites", { skill: a, prerequisites: [b, c] })).toEqual({});
  expect(await links()).toEqual([b, c].sort().map((prerequisite) => ({ skill: a, prerequisite })));
  expect(await learner.ok("/courses/skills/prerequisites", { skill: a, prerequisites: [b] })).toEqual({});
  expect(await links()).toEqual([{ skill: a, prerequisite: b }]);

  const { course: otherCourse } = await learner.ok("/courses/create", { title: "Another course" });
  const otherSource = await app.material(learner, otherCourse);
  const { unit: otherUnit } = await learner.ok("/courses/units/add", { course: otherCourse, title: "Elsewhere" });
  const foreign = await app.skill(learner, otherUnit, otherSource, "Foreign");
  const draft = await app.skill(learner, unit, source, "A draft", false);
  await expectActionRefusal(app, learner, "/courses/skills/prerequisites", { skill: a, prerequisites: [a] }, "INVALID_SKILL_PREREQUISITES");
  await expectActionRefusal(app, learner, "/courses/skills/prerequisites", { skill: b, prerequisites: [a] }, "INVALID_SKILL_PREREQUISITES");
  await expectActionRefusal(app, learner, "/courses/skills/prerequisites", { skill: a, prerequisites: [foreign] }, "INVALID_SKILL_PREREQUISITES");
  await expectActionRefusal(app, learner, "/courses/skills/prerequisites", { skill: a, prerequisites: [draft] }, "INVALID_SKILL_PREREQUISITES");
  await expectActionRefusal(app, learner, "/courses/skills/prerequisites", { skill: draft, prerequisites: [] }, "SKILL_PREREQUISITES_UNAVAILABLE");
  // The list must be a list of identities; anything else is refused as invalid input before any action runs.
  for (const prerequisites of ["B", [1], null]) {
    expect(await learner.post("/courses/skills/prerequisites", { skill: a, prerequisites })).toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
  }
  expect(await learner.post("/courses/skills/prerequisites", { skill: a })).toMatchObject({ status: 400 });
  expect(await links()).toEqual([{ skill: a, prerequisite: b }]);
  // The empty list clears the set.
  expect(await learner.ok("/courses/skills/prerequisites", { skill: a, prerequisites: [] })).toEqual({});
  expect(await links()).toEqual([]);
}, 60_000);

test("ArchiveSkill and RestoreSkill keep a skill's history and pass their status and prerequisite refusals through", async () => {
  const app = await setup(), { learner, course, unit, source, skills: [a, b] } = await app.course("archive", ["A", "B"]);
  await learner.ok("/learning/confidence", { skill: a, confidence: 50 });
  await learner.ok("/courses/skills/prerequisites", { skill: a, prerequisites: [b] });
  const { version } = await learner.ok("/courses/skills/revise", { skill: a, outcome: "Revised A", gate: "Revised A gate" });
  // RevisedTrack saved the new version's track before the answer; no course read has run yet.
  const tracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: a });
  expect(tracks).toEqual([expect.objectContaining({ startingBasis: "SELF_REPORTED" }), expect.objectContaining({ definition: version, startingBasis: "PREVIOUS_DEFINITION" })]);
  // B is still required by the confirmed skill A.
  await expectActionRefusal(app, learner, "/courses/skills/archive", { skill: b }, "SKILL_STILL_REQUIRED");
  const before = await learner.ok("/courses/read", { course });
  expect(await learner.ok("/courses/skills/archive", { skill: a })).toEqual({});
  const archived = await learner.ok("/courses/read", { course });
  expect(archived.skills.find((row: { skill: string }) => row.skill === a)).toEqual({ ...before.skills.find((row: { skill: string }) => row.skill === a), status: "ARCHIVED" });
  // The archived skill keeps its versions, sources, prerequisites, and mastery tracks.
  expect({ ...archived, skills: [] }).toEqual({ ...before, skills: [] });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: a })).toEqual(tracks);
  // Practice requires a confirmed skill, so it is refused while the skill is archived.
  expect((await learner.post("/learning/task", { skill: a })).status).toBe(400);
  await expectActionRefusal(app, learner, "/courses/skills/archive", { skill: a }, "SKILL_ARCHIVE_UNAVAILABLE");

  // With A archived, B may be archived too; restoring A first is refused while its prerequisite is archived.
  expect(await learner.ok("/courses/skills/archive", { skill: b })).toEqual({});
  await expectActionRefusal(app, learner, "/courses/skills/restore", { skill: a }, "SKILL_RESTORE_PREREQUISITES");
  expect(await learner.ok("/courses/skills/restore", { skill: b })).toEqual({});
  expect(await learner.ok("/courses/skills/restore", { skill: a })).toEqual({});
  expect(await learner.ok("/courses/read", { course })).toEqual(before);
  await expectActionRefusal(app, learner, "/courses/skills/restore", { skill: a }, "SKILL_RESTORE_UNAVAILABLE");
  const draft = await app.skill(learner, unit, source, "A draft", false);
  await expectActionRefusal(app, learner, "/courses/skills/archive", { skill: draft }, "SKILL_ARCHIVE_UNAVAILABLE");
  await expectActionRefusal(app, learner, "/courses/skills/restore", { skill: draft }, "SKILL_RESTORE_UNAVAILABLE");
  expect(await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: a })).toEqual(tracks);
}, 60_000);

test("SetUnitEmphasis sets the flag, repeats without change, and refuses a value that is not true or false", async () => {
  const app = await setup(), { learner, course, unit, other } = await app.course("emphasis");
  const units = async () => (await learner.ok("/courses/read", { course })).units;
  expect(await units()).toEqual(expect.arrayContaining([{ unit, title: "Products", emphasized: false }, { unit: other, title: "Inverses", emphasized: false }]));
  expect(await learner.ok("/courses/units/emphasis", { unit, emphasized: true })).toEqual({});
  expect(await learner.ok("/courses/units/emphasis", { unit, emphasized: true })).toEqual({});
  expect(await units()).toEqual(expect.arrayContaining([{ unit, title: "Products", emphasized: true }, { unit: other, title: "Inverses", emphasized: false }]));
  for (const emphasized of ["true", 1, null, [true]]) {
    expect(await learner.post("/courses/units/emphasis", { unit, emphasized })).toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
    expect(await learner.invoke("/courses/units/emphasis", { unit, emphasized })).toEqual({ ok: false,
      error: { kind: "framework", code: "INVALID_INPUT", detail: "Choose whether your professor emphasized this unit." } });
  }
  expect(await learner.post("/courses/units/emphasis", { unit })).toMatchObject({ status: 400, body: { error: "INVALID_REQUEST" } });
  expect((await units()).find((row: { unit: string }) => row.unit === unit).emphasized).toBe(true);
  expect(await learner.ok("/courses/units/emphasis", { unit, emphasized: false })).toEqual({});
  expect((await units()).find((row: { unit: string }) => row.unit === unit).emphasized).toBe(false);
}, 30_000);

test("ReadCourse lists prerequisites, sources, and versions in the designed order, unchanged by database row order", async () => {
  const app = await setup(), { learner, course, unit, other, source, skills } = await app.course("read-order", ["One", "Two", "Three", "Four"]);
  const empty = await learner.ok("/courses/create", { title: "Empty course" });
  expect(await learner.ok("/courses/read", { course: empty.course })).toEqual({ materials: [], units: [], skills: [], prerequisites: [], skillSources: [], versions: [], looks: [] });
  const second = await app.material(learner, course, "Second notes");
  const [one, two, three, four] = skills as [string, string, string, string];
  // Spread the skills over both units so unit order and skill order disagree.
  await learner.ok("/courses/skills/details", { skill: two, unit: other, title: "Two" });
  await learner.ok("/courses/skills/details", { skill: four, unit: other, title: "Four" });
  await learner.ok("/courses/skills/prerequisites", { skill: one, prerequisites: [four, two, three] });
  await learner.ok("/courses/skills/prerequisites", { skill: three, prerequisites: [four, two] });
  await learner.ok("/courses/skills/sources/add", { skill: two, material: second });
  await learner.ok("/courses/skills/sources/add", { skill: four, material: second });
  const history: Record<string, { version: string; outcome: string; gate: string }[]> = {};
  for (const skill of skills) history[skill] = (await app.concepts.SkillMapping._versions({ skill }));
  for (const [skill, count] of [[one, 3], [two, 1], [three, 2]] as const) {
    for (let n = 1; n <= count; n++) {
      const outcome = `Outcome ${n} for ${skill}`, gate = `Gate ${n} for ${skill}`;
      const { version } = await learner.ok("/courses/skills/revise", { skill, outcome, gate });
      history[skill]!.unshift({ version, outcome, gate });
    }
  }
  await learner.ok("/courses/skills/archive", { skill: one });
  await learner.ok("/courses/units/emphasis", { unit: other, emphasized: true });
  const draft = await app.skill(learner, unit, source, "Draft", false);
  history[draft] = await app.concepts.SkillMapping._versions({ skill: draft });

  const all = [...skills, draft].sort();
  const read = await learner.ok("/courses/read", { course });
  expect(read.units).toEqual([{ unit, title: "Products", emphasized: false }, { unit: other, title: "Inverses", emphasized: true }]
    .sort((x, y) => (x.unit < y.unit ? -1 : 1)));
  expect(read.skills.map((row: { skill: string }) => row.skill)).toEqual(all);
  expect(read.skills.find((row: { skill: string }) => row.skill === one).status).toBe("ARCHIVED");
  expect(read.prerequisites).toEqual([
    ...[four, two, three].sort().map((prerequisite) => ({ skill: one, prerequisite })),
    ...[four, two].sort().map((prerequisite) => ({ skill: three, prerequisite })),
  ].sort((x, y) => (x.skill < y.skill ? -1 : x.skill > y.skill ? 1 : 0)));
  expect(read.skillSources).toEqual(all.flatMap((skill) =>
    (skill === two || skill === four ? [source, second].sort() : [source]).map((material) => ({ skill, material }))));
  // Versions sort by skill, and within each skill run newest first: the first row is the current version.
  expect(read.versions).toEqual(all.flatMap((skill) => history[skill]!.map((row) => ({ skill, ...row }))));
  for (const skill of all) expect(read.versions.find((row: { skill: string }) => row.skill === skill).version)
    .toBe(read.skills.find((row: { skill: string }) => row.skill === skill).current);

  // A changed database return order does not rearrange any list.
  const toArray = FindCursor.prototype.toArray;
  const reversed = spyOn(FindCursor.prototype, "toArray").mockImplementation(async function (this: FindCursor) {
    const rows = await toArray.call(this);
    return this.namespace.db === app.connection.db.databaseName ? rows.reverse() : rows;
  });
  try { expect(await learner.ok("/courses/read", { course })).toEqual(read); }
  finally { reversed.mockRestore(); }
}, 60_000);

test("practice admission names the prerequisite to work on first, and keeps its explanation when every prerequisite is ready", async () => {
  const app = await setup(), { learner, course, skills: [target, middle, base, other] } = await app.course("practice", ["Target", "Middle", "Base", "Other"]);
  const owner = learner.user, form = app.runtime.application.form;
  const titles = Object.fromEntries((await learner.ok("/courses/read", { course })).skills.map((row: { skill: string; title: string }) => [row.skill, row.title]));
  await learner.ok("/learning/confidence", { skill: target, confidence: 50 });
  await learner.ok("/courses/skills/prerequisites", { skill: target, prerequisites: [middle, other] });
  await learner.ok("/courses/skills/prerequisites", { skill: middle, prerequisites: [base] });
  // No prerequisite has a ready estimate. The lowest of the target's prerequisites is followed to a skill whose
  // own prerequisites are all ready.
  const lowest = [middle, other].sort()[0]!;
  const expected = lowest === middle ? base : other;
  expect(await form(Access.TaskReady({ owner, skill: target }))).toBeNull();
  expect(await form(Access.PracticePrerequisite({ owner, skill: target }))).toEqual({ title: titles[expected] });
  expect(prerequisiteDetail({ title: titles[expected] })).toBe(`Work on “${titles[expected]}” first. This skill builds on it.`);
  expect(admissions["/learning/task"][1].prerequisite.check).toBe(Access.PracticePrerequisite);
  // Over HTTP and the native gateway, the declined practice start carries that sentence in place of the general one.
  expect(await learner.post("/learning/task", { skill: target })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: prerequisiteDetail({ title: titles[expected] }) } });
  expect(await learner.invoke("/learning/task", { skill: target })).toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: prerequisiteDetail({ title: titles[expected] }) } });

  // Fresh independent work with the full gate makes a skill ready. Stage it directly through MasteryEstimating.
  const ready = async (skill: string) => {
    await learner.ok("/learning/confidence", { skill, confidence: 50 });
    const [row] = await app.concepts.SkillMapping._skill({ skill }), current = row!.current;
    const accepted = await app.concepts.MasteryEstimating.acceptEvidence({ learner: owner, subject: skill, definition: current, evidence: crypto.randomUUID(),
      revision: 1, performedAt: new Date(), signal: "INDEPENDENT", fresh: true, gateMet: true, attribution: "Staged independent work" });
    expect(accepted).not.toHaveProperty("error");
  };
  await ready(base);
  expect(await form(Access.PracticePrerequisite({ owner, skill: target }))).toEqual({ title: titles[lowest === middle ? middle : other] });
  await ready(middle); await ready(other);
  // Every prerequisite is ready: practice is admitted, and the former names nothing.
  expect(await form(Access.TaskReady({ owner, skill: target }))).toEqual({ allowed: true });
  expect(await form(Access.PracticePrerequisite({ owner, skill: target }))).toBeNull();
  // A skill without its own starting confidence is still declined, with the general explanation.
  await learner.ok("/courses/skills/prerequisites", { skill: other, prerequisites: [base] });
  const unstarted = await app.skill(learner, (await learner.ok("/courses/read", { course })).units[0].unit, (await learner.ok("/courses/read", { course })).materials[0].material, "Unstarted");
  await learner.ok("/courses/skills/prerequisites", { skill: unstarted, prerequisites: [base] });
  expect(await form(Access.PracticePrerequisite({ owner, skill: unstarted }))).toBeNull();
  expect(await learner.post("/learning/task", { skill: unstarted })).toMatchObject({ status: 400,
    body: { error: "INVALID_REQUEST", detail: "Set starting confidence and check the prerequisites before starting fresh practice." } });
}, 60_000);

test("the seven course changes wait for the learner's lock, over HTTP and through the native gateway", async () => {
  // A suggestion holds the learner's lock while the tutor works. This tutor works until the test lets it answer.
  let arrived = Promise.withResolvers<void>(), answer = Promise.withResolvers<void>();
  const app = await setup({ tutor: {
    suggest: async () => { arrived.resolve(); await answer.promise; return { unitTitle: "Products", skills: [] }; },
    generate: async () => { throw new Error("The lock test does not generate tutoring."); },
  } });
  const { learner, course, source, unit, skills: [a, b, c, d, e] } = await app.course("lock", ["A", "B", "C", "D", "E"]);
  const second = await app.material(learner, course, "Second notes");
  await learner.ok("/courses/skills/archive", { skill: d });

  /** Sends every change while the lock is held, checks that none ran, then lets the suggestion finish first. */
  async function whileLocked(send: (path: string, input: Record<string, unknown>) => Promise<unknown>, changes: [string, Record<string, unknown>][]) {
    const before = await snapshot(app, learner, course), done: string[] = [];
    arrived = Promise.withResolvers(); answer = Promise.withResolvers();
    const suggesting = learner.post("/courses/skills/suggest", { material: source }).then((result) => { done.push("/courses/skills/suggest"); return result; });
    await arrived.promise;
    const answers = changes.map(([path, input]) => send(path, input).then((result) => { done.push(path); return result; }));
    // The suggestion always gets its answer, so a failed check here cannot leave the lock held during cleanup.
    try {
      await Bun.sleep(300);
      expect(done).toEqual([]);
      expect(await snapshot(app, learner, course)).toEqual(before);
    } finally { answer.resolve(); }
    expect(await suggesting).toMatchObject({ status: 200 });
    const results = await Promise.all(answers);
    expect(done[0]).toBe("/courses/skills/suggest");
    expect(done.slice(1).sort()).toEqual(changes.map(([path]) => path).sort());
    return results;
  }

  const overHttp = await whileLocked(learner.post, [
    ["/courses/skills/details", { skill: a, unit, title: "Renamed over HTTP" }],
    ["/courses/skills/revise", { skill: b, outcome: "Outcome over HTTP", gate: "Gate over HTTP" }],
    ["/courses/skills/sources/add", { skill: c, material: second }],
    ["/courses/skills/prerequisites", { skill: b, prerequisites: [a] }],
    ["/courses/skills/archive", { skill: e }],
    ["/courses/skills/restore", { skill: d }],
    ["/courses/units/emphasis", { unit, emphasized: true }],
  ]);
  for (const result of overHttp) expect(result).toMatchObject({ status: 200 });
  let read = await learner.ok("/courses/read", { course });
  const row = (skill: string) => read.skills.find((r: { skill: string }) => r.skill === skill);
  expect([row(a).title, row(b).outcome, row(d).status, row(e).status]).toEqual(["Renamed over HTTP", "Outcome over HTTP", "CONFIRMED", "ARCHIVED"]);
  expect(read.skillSources).toContainEqual({ skill: c, material: second });
  expect(read.prerequisites).toEqual([{ skill: b, prerequisite: a }]);
  expect(read.units.find((r: { unit: string }) => r.unit === unit).emphasized).toBe(true);

  const natively = await whileLocked(learner.invoke, [
    ["/courses/skills/details", { skill: a, unit, title: "Renamed natively" }],
    ["/courses/skills/revise", { skill: b, outcome: "Outcome natively", gate: "Gate natively" }],
    ["/courses/skills/sources/add", { skill: c, material: second }],
    ["/courses/skills/prerequisites", { skill: b, prerequisites: [] }],
    ["/courses/skills/archive", { skill: d }],
    ["/courses/skills/restore", { skill: e }],
    ["/courses/units/emphasis", { unit, emphasized: false }],
  ]);
  for (const result of natively) expect(result).toMatchObject({ ok: true });
  read = await learner.ok("/courses/read", { course });
  expect([row(a).title, row(b).outcome, row(d).status, row(e).status]).toEqual(["Renamed natively", "Outcome natively", "ARCHIVED", "CONFIRMED"]);
  expect(read.prerequisites).toEqual([]);
  expect(read.units.find((r: { unit: string }) => r.unit === unit).emphasized).toBe(false);
}, 60_000);
