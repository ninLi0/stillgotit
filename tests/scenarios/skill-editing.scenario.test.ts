import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { MemoryProvider } from "../../src/concepts/Federating/provider.ts";
import { createRuntime } from "../../src/host/runtime.ts";
import * as mapping from "../../src/concepts/SkillMapping.ts";
import type { CourseTutor } from "../../src/host/tutor.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";
import { R, daysBetween, gradeOf, review, seed } from "../fixtures/fsrs.ts";

/*
 * The skill-editing brief, walked through HTTP as a learner's browser would. Each test is named with the brief
 * sentence it proves. The tests in each group run in order and share one learner's course.
 */

const ORIGIN = "http://localhost:5173", MINUTE = 60_000, DAY = 86_400_000, cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });
// The sentence a SkillMapping refusal carries, which reaches the learner as the answer's `detail`.
const message = (Refusal: new () => Error) => new Refusal().message;

// Responses are JSON, so their rows are untyped here.
type Data = any;

/** The harness from tests/Learning.http.test.ts, with a clock the scenario moves by hand. */
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), runtimes: Awaited<ReturnType<typeof createRuntime>>[] = [], owners: string[] = [];
  let now = new Date(), generated = 0;
  const clock = () => new Date(now);
  // A canned tutor: a new practice question each time, and a grade of independent work that meets the full gate.
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => { throw new Error("This scenario does not request suggestions."); },
    generate: async (_owner, sources, _instruction, context, schema) => {
      generated++;
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.question) return { question: `Question ${generated}: compute [[1,2],[3,4]] × [[2,0],[1,2]], and [[2,1],[0,3]] × [[1,2],[4,0]]. Why does order matter?`, citations: [{ material, location }] };
      if (properties.rationale) {
        const help = (context as { help: string }).help;
        return { result: help === "HINT" ? "SUPPORTED" : "INDEPENDENT", gateMet: help === "NONE", rationale: "Both results and the explanation meet the saved gate." };
      }
      return { text: "Start by checking the dimensions.", citations: [{ material, location }] };
    },
  };
  const open = async () => {
    const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock });
    runtimes.push(runtime); return runtime;
  };
  let runtime = await open();
  cleanups.push(async () => {
    for (const r of runtimes) await r.gateway.beginDrain();
    await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });

  /** A browser with its own cookie jar. `cookies` starts it with another browser's cookies. */
  function browser(cookies: Map<string, string> = new Map()) {
    const jar = new Map(cookies);
    let user = "";
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachments: [], ...body };
      if (path === "/planning/configure" && !(body instanceof FormData)) body = { focusNote: "", ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: (payload.data ?? payload) as Data };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}): Promise<Data> {
      const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body;
    }
    async function signIn(name: string) {
      const start = await ok("/auth/commons/start");
      await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
      user = (await ok("/auth/commons/resume")).user; owners.push(user);
      return user;
    }
    return { post, ok, signIn, cookies: () => new Map(jar), get user() { return user; } };
  }

  return {
    browser,
    get runtime() { return runtime; },
    get concepts() { return runtime.application.concepts; },
    get generated() { return generated; },
    get now() { return new Date(now); },
    advance(ms: number) { now = new Date(now.getTime() + ms); },
    /** Stops the server and starts it again on the same database, as after a crash or a deploy. */
    async restart() { await runtime.gateway.beginDrain(); runtime = await open(); },
  };
}
type App = Awaited<ReturnType<typeof setup>>;
type Learner = ReturnType<App["browser"]>;

function once<T>(make: () => Promise<T>) { let value: Promise<T> | undefined; return () => (value ??= make()); }
// One application and one database for the whole file.
const application = once(setup);

function upload(course: string, title: string) {
  const form = new FormData(); form.set("course", course); form.set("title", title); form.set("requestId", crypto.randomUUID());
  form.append("files", new File([`# ${title}\nMultiply rows by columns. Inner dimensions must match. Matrix multiplication is not commutative.`], "notes.md", { type: "text/markdown" }));
  return form;
}

const FIRST = { outcome: "Compute matrix products.", gate: "Compute two new products and explain why order matters." };
const REVISED = { outcome: "Compute matrix products and explain why order matters.",
  gate: "Compute two new products, including one where reversing the order changes the result, and explain why." };

/** One learner, one course with a unit called Products and one material, and two confirmed skills. */
async function startCourse(app: App, name: string) {
  const learner = app.browser(); await learner.signIn(name);
  const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
  const { material: notes } = await learner.ok("/courses/materials/add", upload(course, "Matrix notes"));
  const { unit: products } = await learner.ok("/courses/units/add", { course, title: "Products" });
  async function confirmed(title: string, outcome: string, gate: string, unit = products): Promise<string> {
    const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: notes, title, outcome, gate });
    expect(await learner.ok("/courses/skills/confirm", { skill })).toEqual({});
    return skill;
  }
  const multiply = await confirmed("Multiply matrices", FIRST.outcome, FIRST.gate);
  const dimensions = await confirmed("Check dimensions", "Decide whether a matrix product is defined.", "Judge three new pairs of matrices and explain each.");
  return { learner, course: course as string, notes: notes as string, products: products as string, multiply, dimensions, confirmed };
}

const skillRow = (read: Data, skill: string) => read.skills.find((row: Data) => row.skill === skill);
const sessionOf = (study: Data, session: string) => study.sessions.find((row: Data) => row.session === session);

/** One fresh practice attempt, answered and assessed through HTTP. The canned tutor grades it independent with the full gate. */
async function practise(app: App, learner: Learner, skill: string): Promise<string> {
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Second [[6,4],[12,0]]. A row meets a column, so changing order changes the pairing.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, reviewed: true, unseen: true, outsideHelp: false, dialogueLength: 1 });
  await app.runtime.gateway.whenIdle();
  return task;
}

/** Everything the learner can read about the course, plus each skill's mastery tracks, for "nothing changed" checks. */
async function snapshot(app: App, learner: Learner, course: string) {
  const read = await learner.ok("/courses/read", { course });
  const study = await Promise.all(read.skills.map((row: Data) => learner.ok("/learning/read", { skill: row.skill })));
  const tracks = await Promise.all(read.skills.map((row: Data) => app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: row.skill })));
  return { read, study, tracks };
}

/** Proposes a plan and returns the parts that depend only on the plan's inputs (not the new plan's identity). */
async function proposePlan(learner: Learner, course: string) {
  await learner.ok("/planning/propose", { course });
  const { plan } = await learner.ok("/planning/read", { course });
  return { basis: plan.basis, horizonEnd: plan.horizonEnd, deferred: plan.deferred,
    items: plan.items.map(({ candidate, day, status }: Data) => ({ candidate, day, status })) };
}
/** The skills the plan's candidates are for, scheduled or deferred, after a fresh proposal. */
async function planSubjects(learner: Learner, course: string) {
  const plan = await proposePlan(learner, course);
  return [...new Set([...plan.items.map((item: Data) => item.candidate.subject), ...plan.deferred.map((row: Data) => row.candidate.subject)])].sort();
}

describe("After confirming a skill, a learner can keep it accurate", () => {
  const journey = once(async () => {
    const fixture = await startCourse(await application(), "maya");
    const read = await fixture.learner.ok("/courses/read", { course: fixture.course });
    expect(read.skills.map((row: Data) => row.status)).toEqual(["CONFIRMED", "CONFIRMED"]);
    return fixture;
  });
  // What earlier steps hand to later ones.
  const saved = {} as { inverses: string; v1: string; v2: string; assessed: string; open: string; study: Data; tracks: Data[]; inputs: Data[]; oldEstimate: Data; readAt: Date };

  test("rename it or move it to another unit", async () => {
    const { learner, course, products, multiply } = await journey();
    const { unit: inverses } = await learner.ok("/courses/units/add", { course, title: "Inverses" });
    saved.inverses = inverses;
    const before = await learner.ok("/courses/read", { course });
    // Rename only.
    expect(await learner.ok("/courses/skills/details", { skill: multiply, unit: products, title: "Multiply two matrices" })).toEqual({});
    const renamed = await learner.ok("/courses/read", { course });
    expect(skillRow(renamed, multiply)).toEqual({ ...skillRow(before, multiply), title: "Multiply two matrices" });
    // Move only.
    expect(await learner.ok("/courses/skills/details", { skill: multiply, unit: inverses, title: "Multiply two matrices" })).toEqual({});
    const moved = await learner.ok("/courses/read", { course });
    expect(skillRow(moved, multiply)).toEqual({ ...skillRow(before, multiply), title: "Multiply two matrices", unit: inverses });
    // The skill keeps its identity, status, and requirements version; its sources, prerequisites, and versions are unchanged, and so is the other skill.
    expect({ ...moved, skills: [] }).toEqual({ ...before, skills: [] });
    expect(moved.skills.filter((row: Data) => row.skill !== multiply)).toEqual(before.skills.filter((row: Data) => row.skill !== multiply));
  }, 60_000);

  test("revise its outcome and demonstration requirements while the earlier version stays readable", async () => {
    const app = await application(), { learner, course, multiply } = await journey();
    const before = await learner.ok("/courses/read", { course });
    const v1: string = skillRow(before, multiply).current;
    // Earlier work on the first version: a starting confidence, one assessed attempt, and one attempt left open.
    await learner.ok("/learning/confidence", { skill: multiply, confidence: 50 });
    app.advance(MINUTE);
    const assessed = await practise(app, learner, multiply);
    app.advance(MINUTE);
    // Practice is admitted here: the skill has no prerequisites yet.
    const { task: open } = await learner.ok("/learning/task", { skill: multiply });
    // Six days pass without practice, so the first version's estimate decays before the revision.
    app.advance(6 * DAY);
    const readAt = app.now, study = await learner.ok("/learning/read", { skill: multiply });
    const tracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: multiply });
    const inputs = await app.concepts.MasteryEstimating._inputs({ track: tracks[0]!.track });
    const oldEstimate = await app.concepts.MasteryEstimating._estimate({ learner: learner.user, subject: multiply, definition: v1, at: app.now });
    Object.assign(saved, { v1, assessed, open, study, tracks, inputs, oldEstimate, readAt });

    const revised = await learner.ok("/courses/skills/revise", { skill: multiply, ...REVISED });
    expect(revised).toEqual({ previous: v1, version: expect.any(String) });
    expect(revised.version).not.toBe(v1);
    saved.v2 = revised.version;
    const read = await learner.ok("/courses/read", { course });
    expect(skillRow(read, multiply)).toEqual({ ...skillRow(before, multiply), current: revised.version, ...REVISED });
    // The course read lists the history newest first. The second row is the earlier version, still readable;
    // the Manage panel labels it "Previous definition".
    expect(read.versions.filter((row: Data) => row.skill === multiply)).toEqual([
      { skill: multiply, version: revised.version, ...REVISED },
      { skill: multiply, version: v1, ...FIRST },
    ]);
    expect({ ...read, skills: [], versions: [] }).toEqual({ ...before, skills: [], versions: [] });
  }, 60_000);

  test("Revising requirements creates a new version and keeps the old one readable; sessions and cases that used the old version keep it.", async () => {
    const { learner, multiply } = await journey();
    const after = await learner.ok("/learning/read", { skill: multiply });
    expect(after.skill).toMatchObject({ skill: multiply, current: saved.v2, ...REVISED });
    // The sessions and the assessment case are exactly as they were before the revision, on the first version.
    expect(after.sessions).toEqual(saved.study.sessions);
    expect(after.cases).toEqual(saved.study.cases);
    expect(sessionOf(after, saved.assessed)).toMatchObject({ definition: saved.v1 });
    expect(sessionOf(after, saved.open)).toMatchObject({ definition: saved.v1, status: "OPEN" });
    expect(after.cases).toEqual([expect.objectContaining({ task: saved.assessed, definition: saved.v1,
      judgment: expect.objectContaining({ result: "INDEPENDENT", gateMet: true }) })]);
    // The attempt that was open on the first version stays open, and the learner can still answer it.
    await learner.ok("/learning/respond", { studySession: saved.open, text: "Both products are defined because the inner dimensions match.", dialogueLength: 0 });
    const answered = sessionOf(await learner.ok("/learning/read", { skill: multiply }), saved.open);
    expect(answered).toMatchObject({ definition: saved.v1, status: "OPEN" });
    expect(answered.dialogue).toHaveLength(1);
  }, 60_000);

  test("The mastery track for the new version starts from the previous estimate and says a new check is needed.", async () => {
    const { learner, multiply } = await journey();
    const before = saved.study, after = await learner.ok("/learning/read", { skill: multiply });
    // Before the revision the skill showed the first version's estimate: ready, and lowered by six days without practice.
    expect(before.track).toMatchObject({ definition: saved.v1, startingBasis: "SELF_REPORTED" });
    expect(before.estimate.ready).toBe(true);
    // The confidence of 50 seeded the memory. The assessed attempt a minute later met the gate, so it raised the
    // estimate to 95 and counted as a same-day Good review. The 95 then fades with that review's stability until the read.
    const [track] = saved.tracks, [input] = saved.inputs;
    const memory = review(seed(50), gradeOf("INDEPENDENT"), daysBetween(input.performedAt, track.initializedAt));
    expect(before.estimate.value).toBeCloseTo(95 * R(daysBetween(saved.readAt, input.performedAt), memory.stability), 9);
    expect(before.estimate.value).toBeLessThan(95);
    // The new version's track starts from that value, has no evidence, and is not ready.
    expect(after.track).toMatchObject({ definition: saved.v2, startingBasis: "PREVIOUS_DEFINITION", inputs: [] });
    expect(after.track.initialConfidence).toBeCloseTo(before.estimate.value, 9);
    expect(after.estimate.value).toBeCloseTo(before.estimate.value, 9);
    expect(after.estimate.ready).toBe(false);
    expect(after.estimate.basis).toContain("Started from an earlier definition; these requirements need a new check.");
  }, 30_000);

  test("The old track stays unchanged.", async () => {
    const app = await application(), { learner, multiply } = await journey();
    const tracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: multiply });
    expect(tracks).toEqual([saved.tracks[0], expect.objectContaining({ definition: saved.v2, startingBasis: "PREVIOUS_DEFINITION" })]);
    expect(await app.concepts.MasteryEstimating._inputs({ track: saved.tracks[0].track })).toEqual(saved.inputs);
    expect(saved.inputs).toHaveLength(1);
    expect(await app.concepts.MasteryEstimating._estimate({ learner: learner.user, subject: multiply, definition: saved.v1, at: app.now })).toEqual(saved.oldEstimate);
    // Evidence is not copied to the new track.
    expect(await app.concepts.MasteryEstimating._inputs({ track: tracks[1]!.track })).toEqual([]);
  }, 30_000);

  test("attach another source", async () => {
    const { learner, course, notes, multiply } = await journey();
    const { material: inverseNotes } = await learner.ok("/courses/materials/add", upload(course, "Inverse notes"));
    const before = await learner.ok("/courses/read", { course });
    expect(await learner.ok("/courses/skills/sources/add", { skill: multiply, material: inverseNotes })).toEqual({});
    const after = await learner.ok("/courses/read", { course });
    expect(after.skillSources.filter((row: Data) => row.skill === multiply)).toEqual([notes, inverseNotes].sort().map((material) => ({ skill: multiply, material })));
    expect(after.skillSources.filter((row: Data) => row.skill !== multiply)).toEqual(before.skillSources.filter((row: Data) => row.skill !== multiply));
    // The skill keeps its current version, and nothing else changed.
    expect(skillRow(after, multiply).current).toBe(saved.v2);
    expect({ ...after, skillSources: [] }).toEqual({ ...before, skillSources: [] });
  }, 60_000);

  test("set prerequisites among the course's confirmed skills", async () => {
    const { learner, course, multiply, dimensions } = await journey();
    const before = await learner.ok("/courses/read", { course });
    expect(before.prerequisites).toEqual([]);
    expect(await learner.ok("/courses/skills/prerequisites", { skill: multiply, prerequisites: [dimensions] })).toEqual({});
    const after = await learner.ok("/courses/read", { course });
    expect(after.prerequisites).toEqual([{ skill: multiply, prerequisite: dimensions }]);
    expect({ ...after, prerequisites: [] }).toEqual({ ...before, prerequisites: [] });
  }, 30_000);

  test("The practice admission (`prerequisitesReady`) starts to matter once prerequisites exist; its refusal text must tell the learner which prerequisite to work on first.", async () => {
    const app = await application(), { learner, multiply, dimensions } = await journey();
    // Practice on this skill was admitted before it had a prerequisite (the open attempt above). Its prerequisite has no ready estimate yet.
    const generated = app.generated, sessions = (await learner.ok("/learning/read", { skill: multiply })).sessions;
    const refused = await learner.post("/learning/task", { skill: multiply });
    expect(refused.status).toBe(400);
    // The refusal comes before any generation and opens no session.
    expect(app.generated).toBe(generated);
    expect((await learner.ok("/learning/read", { skill: multiply })).sessions).toEqual(sessions);
    // The learner works on the named prerequisite until it is ready.
    await learner.ok("/learning/confidence", { skill: dimensions, confidence: 50 });
    app.advance(MINUTE);
    await practise(app, learner, dimensions);
    expect((await learner.ok("/learning/read", { skill: dimensions })).estimate.ready).toBe(true);
    // Now practice is admitted again, and the new attempt uses the skill's current, revised version.
    app.advance(MINUTE);
    const { task } = await learner.ok("/learning/task", { skill: multiply });
    expect(sessionOf(await learner.ok("/learning/read", { skill: multiply }), task)).toMatchObject({ definition: saved.v2, status: "OPEN" });
    // The refusal's text named the prerequisite to work on first. It is checked at the end of this test, after the
    // prerequisite work above, so a wrong text does not leave the course in another state for the tests that follow.
    expect(refused.body).toEqual({ error: "INVALID_REQUEST", detail: "Work on “Check dimensions” first. This skill builds on it." });
  }, 60_000);

  test("The learner can also mark the units the professor emphasized.", async () => {
    const { learner, course, products } = await journey();
    const before = await learner.ok("/courses/read", { course });
    expect(before.units.map((row: Data) => row.emphasized)).toEqual([false, false]);
    expect(await learner.ok("/courses/units/emphasis", { unit: products, emphasized: true })).toEqual({});
    const after = await learner.ok("/courses/read", { course });
    expect(after.units).toEqual(before.units.map((row: Data) => row.unit === products ? { ...row, emphasized: true } : row));
    expect({ ...after, units: [] }).toEqual({ ...before, units: [] });
  }, 30_000);

  test("The emphasized flag is visible on the course page and returned by the read; nothing else uses it yet.", async () => {
    const { learner, course, products } = await journey();
    // The read returns the flag for every unit. (The course page's badge and switch are checked in the browser.)
    expect((await learner.ok("/courses/read", { course })).units).toEqual(expect.arrayContaining([
      { unit: products, title: "Products", emphasized: true }, { unit: saved.inverses, title: "Inverses", emphasized: false }]));
    // Planning and progress give the same answers whichever units are emphasized.
    await learner.ok("/planning/configure", { course, dailyMinutes: 60 });
    const plan = await proposePlan(learner, course), progress = await learner.ok("/learning/progress", { course });
    expect(plan.items.length + plan.deferred.length).toBeGreaterThan(0);
    expect(await learner.ok("/courses/units/emphasis", { unit: saved.inverses, emphasized: true })).toEqual({});
    expect(await proposePlan(learner, course)).toEqual(plan);
    expect(await learner.ok("/learning/progress", { course })).toEqual(progress);
    expect(await learner.ok("/courses/units/emphasis", { unit: saved.inverses, emphasized: false })).toEqual({});
  }, 60_000);

  test("Refusals reach the learner with the concept's own message: a cycle or self-dependency in prerequisites, archiving a skill another active skill requires, restoring a skill whose prerequisites are archived, unchanged requirements, blank titles.", async () => {
    const { learner, course, multiply, dimensions } = await journey();
    const start = await learner.ok("/courses/read", { course });
    expect(start.prerequisites).toEqual([{ skill: multiply, prerequisite: dimensions }]);
    // Over HTTP each refusal carries its public error kind and the action's own sentence as `detail`, which the page
    // shows (frontend/src/ManageSkills.vue); that text is checked in the browser.
    const refusals: [string, Record<string, unknown>, number, string, string][] = [
      ["/courses/skills/details", { skill: multiply, unit: saved.inverses, title: "   " }, 400, "INVALID_REQUEST", message(mapping.InvalidSkillTitleError)],
      ["/courses/skills/revise", { skill: multiply, ...REVISED }, 409, "CONFLICT", message(mapping.SkillDefinitionUnchangedError)],
      ["/courses/skills/prerequisites", { skill: multiply, prerequisites: [multiply] }, 400, "INVALID_REQUEST", message(mapping.InvalidSkillPrerequisitesError)],
      ["/courses/skills/prerequisites", { skill: dimensions, prerequisites: [multiply] }, 400, "INVALID_REQUEST", message(mapping.InvalidSkillPrerequisitesError)],
      ["/courses/skills/archive", { skill: dimensions }, 409, "CONFLICT", message(mapping.SkillStillRequiredError)],
    ];
    for (const [path, input, status, error, detail] of refusals) {
      expect(await learner.post(path, input), path).toEqual({ status, body: { error, detail } });
      expect(await learner.ok("/courses/read", { course }), path).toEqual(start);
    }
    // Restoring a skill whose prerequisite is archived: archive the skill, then its prerequisite, then try to restore the skill first.
    expect(await learner.ok("/courses/skills/archive", { skill: multiply })).toEqual({});
    expect(await learner.ok("/courses/skills/archive", { skill: dimensions })).toEqual({});
    const archived = await learner.ok("/courses/read", { course });
    expect(await learner.post("/courses/skills/restore", { skill: multiply })).toEqual({ status: 409, body: { error: "CONFLICT", detail: message(mapping.SkillRestorePrerequisitesError) } });
    expect(await learner.ok("/courses/read", { course })).toEqual(archived);
    expect(skillRow(archived, multiply).status).toBe("ARCHIVED");
    // Restoring the prerequisite first lets the skill come back, and the course is as it was.
    expect(await learner.ok("/courses/skills/restore", { skill: dimensions })).toEqual({});
    expect(await learner.ok("/courses/skills/restore", { skill: multiply })).toEqual({});
    expect(await learner.ok("/courses/read", { course })).toEqual(start);
  }, 60_000);

  test("Setting prerequisites replaces the whole set; clearing it is allowed.", async () => {
    const { learner, course, multiply, dimensions } = await journey();
    const before = await learner.ok("/courses/read", { course });
    expect(before.prerequisites).toEqual([{ skill: multiply, prerequisite: dimensions }]);
    expect(await learner.ok("/courses/skills/prerequisites", { skill: multiply, prerequisites: [] })).toEqual({});
    const after = await learner.ok("/courses/read", { course });
    expect(after.prerequisites).toEqual([]);
    expect({ ...after, prerequisites: [] }).toEqual({ ...before, prerequisites: [] });
  }, 30_000);

  test("Archived skills disappear from the active lists and the plan's candidates, and keep their history; restore brings them back.", async () => {
    const app = await application(), { learner, course, multiply, dimensions } = await journey();
    expect(await planSubjects(learner, course)).toEqual([multiply, dimensions].sort());
    const before = await learner.ok("/courses/read", { course });
    const history = async () => {
      const { sessions, cases, track, estimate } = await learner.ok("/learning/read", { skill: dimensions });
      return { sessions, cases, track, estimate, tracks: await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: dimensions }) };
    };
    const kept = await history();
    expect(kept.sessions).toHaveLength(1);
    expect(kept.cases).toHaveLength(1);

    // Archiving is allowed now that no confirmed skill requires it.
    expect(await learner.ok("/courses/skills/archive", { skill: dimensions })).toEqual({});
    const archived = await learner.ok("/courses/read", { course });
    // It is marked archived, so the page lists it under "Archived" instead of with the active skills.
    expect(skillRow(archived, dimensions)).toEqual({ ...skillRow(before, dimensions), status: "ARCHIVED" });
    expect(skillRow(archived, multiply)).toEqual(skillRow(before, multiply));
    // Its versions, sources, and prerequisite links are kept.
    expect({ ...archived, skills: [] }).toEqual({ ...before, skills: [] });
    // The next plan proposal leaves it out, and practice on it is refused.
    expect(await planSubjects(learner, course)).toEqual([multiply]);
    expect((await learner.post("/learning/task", { skill: dimensions })).status).toBe(400);
    // Its sessions, assessment case, and mastery tracks are kept.
    expect(await history()).toEqual(kept);

    expect(await learner.ok("/courses/skills/restore", { skill: dimensions })).toEqual({});
    expect(await learner.ok("/courses/read", { course })).toEqual(before);
    expect(await planSubjects(learner, course)).toEqual([multiply, dimensions].sort());
    expect(await history()).toEqual(kept);
  }, 60_000);
});

describe("Every endpoint checks the session and ownership.", () => {
  // The owner's records are in states where each request below would succeed for the owner.
  const records = once(async () => {
    const app = await application(), fixture = await startCourse(app, "owner");
    const { learner, course, products, multiply, dimensions } = fixture;
    const { unit: inverses } = await learner.ok("/courses/units/add", { course, title: "Inverses" });
    const { material: inverseNotes } = await learner.ok("/courses/materials/add", upload(course, "Inverse notes"));
    const invert = await fixture.confirmed("Invert matrices", "Find the inverse of a 2 × 2 matrix.", "Invert two new matrices and check each product.");
    expect(await learner.ok("/courses/skills/archive", { skill: invert })).toEqual({});
    // A starting confidence, so a revision would also start a track.
    await learner.ok("/learning/confidence", { skill: multiply, confidence: 40 });
    const requests: [string, Record<string, unknown>][] = [
      ["/courses/skills/details", { skill: multiply, unit: inverses, title: "Multiply two matrices" }],
      ["/courses/skills/revise", { skill: multiply, ...REVISED }],
      ["/courses/skills/sources/add", { skill: multiply, material: inverseNotes }],
      ["/courses/skills/prerequisites", { skill: multiply, prerequisites: [dimensions] }],
      ["/courses/skills/archive", { skill: multiply }],
      ["/courses/skills/restore", { skill: invert }],
      ["/courses/units/emphasis", { unit: products, emphasized: true }],
    ];
    return { ...fixture, inverses, inverseNotes, invert, requests, start: await snapshot(app, learner, course) };
  });

  test("Every endpoint checks the session and ownership.", async () => {
    const app = await application(), { learner, course, requests, start } = await records();
    // A browser with no session.
    const anonymous = app.browser();
    // The owner's own session, after signing out of it.
    const second = app.browser();
    expect(await second.signIn("owner")).toBe(learner.user);
    const cookies = second.cookies();
    expect(await second.ok("/auth/logout")).toEqual({});
    const ended = app.browser(cookies);
    for (const [path, input] of requests) {
      expect(await anonymous.post(path, input), path).toMatchObject({ status: 401, body: { error: "UNAUTHORIZED" } });
      expect(await ended.post(path, input), path).toMatchObject({ status: 401, body: { error: "UNAUTHORIZED" } });
    }
    expect(await snapshot(app, learner, course)).toEqual(start);
  }, 60_000);

  test("Another learner cannot change these records.", async () => {
    const app = await application(), { learner, course, products, multiply, dimensions, notes, inverses, inverseNotes, invert, requests, start } = await records();
    const outsider = app.browser(); await outsider.signIn("outsider");
    for (const [path, input] of requests) {
      expect(await outsider.post(path, input), path).toMatchObject({ status: 403, body: { error: "FORBIDDEN" } });
    }
    expect(await snapshot(app, learner, course)).toEqual(start);
    // The same requests from the owner succeed, so the refusals were about who asked.
    for (const [path, input] of requests) await learner.ok(path, input);
    const read = await learner.ok("/courses/read", { course });
    expect(skillRow(read, multiply)).toMatchObject({ unit: inverses, title: "Multiply two matrices", status: "ARCHIVED", ...REVISED });
    expect(skillRow(read, invert).status).toBe("CONFIRMED");
    expect(read.versions.filter((row: Data) => row.skill === multiply)).toHaveLength(2);
    expect(read.skillSources.filter((row: Data) => row.skill === multiply)).toEqual([notes, inverseNotes].sort().map((material) => ({ skill: multiply, material })));
    expect(read.prerequisites).toEqual([{ skill: multiply, prerequisite: dimensions }]);
    expect(read.units.find((row: Data) => row.unit === products).emphasized).toBe(true);
  }, 60_000);
});

describe("If a reply is lost, the change stays saved, and the page's next course read shows it.", () => {
  const retrying = once(async () => {
    const app = await application(), fixture = await startCourse(app, "retry");
    const { learner, course } = fixture;
    const { unit: inverses } = await learner.ok("/courses/units/add", { course, title: "Inverses" });
    const { material: inverseNotes } = await learner.ok("/courses/materials/add", upload(course, "Inverse notes"));
    await learner.ok("/learning/confidence", { skill: fixture.multiply, confidence: 70 });
    return { ...fixture, inverses, inverseNotes };
  });

  /**
   * Sends a request whose answer never reaches the page, restarts the server, reads the course as the page would,
   * and sends the same request again. Returns what the page read and the retry's answer, and checks the retry
   * changed nothing.
   */
  async function lostReply(path: string, input: Record<string, unknown>) {
    const app = await application(), { learner, course } = await retrying();
    expect((await learner.post(path, input)).status, path).toBe(200);
    await app.restart();
    const shown = await snapshot(app, learner, course);
    const retry = await learner.post(path, input);
    expect(await snapshot(app, learner, course), path).toEqual(shown);
    return { read: shown.read, tracks: shown.tracks, retry };
  }

  test("Sending the saved unit and title again succeeds and changes nothing.", async () => {
    const { multiply, inverses } = await retrying();
    const { read, retry } = await lostReply("/courses/skills/details", { skill: multiply, unit: inverses, title: "Multiply two matrices" });
    expect(skillRow(read, multiply)).toMatchObject({ unit: inverses, title: "Multiply two matrices" });
    expect(retry).toEqual({ status: 200, body: {} });
  }, 60_000);

  test("Repeating a saved revision is refused as unchanged; the next course read shows the saved version.", async () => {
    const app = await application(), { learner, multiply } = await retrying();
    const [first] = await app.concepts.SkillMapping._versions({ skill: multiply });
    const { read, retry } = await lostReply("/courses/skills/revise", { skill: multiply, ...REVISED });
    expect(skillRow(read, multiply)).toMatchObject(REVISED);
    expect(read.versions.filter((row: Data) => row.skill === multiply)).toEqual([
      { skill: multiply, version: skillRow(read, multiply).current, ...REVISED }, { skill: multiply, ...first }]);
    // One new version and one new track, both saved before the lost answer. Both tracks start at the same
    // instant here, so their order is not fixed.
    const tracks = await app.concepts.MasteryEstimating._tracks({ learner: learner.user, subject: multiply });
    expect(tracks).toHaveLength(2);
    expect(tracks).toEqual(expect.arrayContaining([
      expect.objectContaining({ definition: first!.version, startingBasis: "SELF_REPORTED" }),
      expect.objectContaining({ definition: skillRow(read, multiply).current, startingBasis: "PREVIOUS_DEFINITION" })]));
    expect(retry).toEqual({ status: 409, body: { error: "CONFLICT", detail: message(mapping.SkillDefinitionUnchangedError) } });
  }, 60_000);

  test("Attaching a material the skill already has succeeds and changes nothing.", async () => {
    const { multiply, notes, inverseNotes } = await retrying();
    const { read, retry } = await lostReply("/courses/skills/sources/add", { skill: multiply, material: inverseNotes });
    expect(read.skillSources.filter((row: Data) => row.skill === multiply)).toEqual([notes, inverseNotes].sort().map((material) => ({ skill: multiply, material })));
    expect(retry).toEqual({ status: 200, body: {} });
  }, 60_000);

  test("Sending the saved set again succeeds and changes nothing.", async () => {
    const { multiply, dimensions } = await retrying();
    const { read, retry } = await lostReply("/courses/skills/prerequisites", { skill: multiply, prerequisites: [dimensions] });
    expect(read.prerequisites).toEqual([{ skill: multiply, prerequisite: dimensions }]);
    expect(retry).toEqual({ status: 200, body: {} });
  }, 60_000);

  test("The action refuses a skill that is not confirmed, including one already archived.", async () => {
    const { multiply } = await retrying();
    const { read, retry } = await lostReply("/courses/skills/archive", { skill: multiply });
    expect(skillRow(read, multiply).status).toBe("ARCHIVED");
    expect(retry).toEqual({ status: 409, body: { error: "CONFLICT", detail: message(mapping.SkillArchiveUnavailableError) } });
  }, 60_000);

  test("The action refuses a skill that is not archived, including one already restored.", async () => {
    const { multiply } = await retrying();
    const { read, retry } = await lostReply("/courses/skills/restore", { skill: multiply });
    expect(skillRow(read, multiply).status).toBe("CONFIRMED");
    expect(retry).toEqual({ status: 409, body: { error: "CONFLICT", detail: message(mapping.SkillRestoreUnavailableError) } });
  }, 60_000);

  test("Setting the saved value again succeeds and changes nothing.", async () => {
    const { products } = await retrying();
    const { read, retry } = await lostReply("/courses/units/emphasis", { unit: products, emphasized: true });
    expect(read.units.find((row: Data) => row.unit === products).emphasized).toBe(true);
    expect(retry).toEqual({ status: 200, body: {} });
  }, 60_000);
});
