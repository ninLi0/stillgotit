import { afterAll, expect, test } from "bun:test";
import { admissions } from "../src/compositions/access.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import * as mastery from "../src/concepts/MasteryEstimating/refusals.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { R, daysBetween, gradeOf, leftAlone, review, seed } from "./fixtures/fsrs.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const ORIGIN = "http://localhost:5173", DAY = 86_400_000, cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const UNAVAILABLE_SKILL = "Choose one of your confirmed skills before adjusting its estimate.";
// Courses.md, "Course and skill refusals": the general sentences for a course or skill that is not the learner's.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";
const SKILL_UNAVAILABLE = "This skill is not available. Reload the page to see your skills.";
const RESPOND_DECLINED = "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once.";
const QUESTION_DECLINED = "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once.";
// A concept refusal reaches HTTP and the native gateway with the concept's message as `detail`.
const message = (Refusal: new () => Error) => new Refusal().message;
const studyDate = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// Calendar days, as the planner counts them (src/computations/learning.ts). Adding 24-hour spans to a clock instead lands two
// different spans on the same New York date when the span crosses the end of daylight saving time.
const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);

// The harness of Learning.http.test.ts, with a clock the test can move forward.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  let offset = 0, questions = 0;
  const clock = () => new Date(Date.now() + offset);
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.explanation) return { explanation: "Match a row to a column.", citations: [{ material, location }] };
      // Each task needs a question the learner has not seen.
      if (properties.question) return { question: `Practice ${++questions}: compute [[1,2],[3,4]] × [[2,0],[1,2]]. Why does order matter?`, citations: [{ material, location }] };
      if (properties.rationale) {
        const { help, fresh } = context as { help: string; fresh: boolean };
        return { result: help === "HINT" ? "SUPPORTED" : "INDEPENDENT", gateMet: help === "NONE" && fresh, rationale: "Both results and the explanation meet the saved gate." };
      }
      return { text: "Changing order pairs different rows and columns.", citations: [{ material, location }] };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock });
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
  return { browser, native, connection, runtime, concepts: runtime.application.concepts, advance: (days: number) => { offset += days * DAY; }, now: clock };
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
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products", outcome: "Multiply matrices", gate: "Two products and why" });
  await learner.ok("/courses/skills/confirm", { skill });
  return { learner, user, course, unit, skill, material };
}
/** One assessed practice attempt through the endpoints. */
async function practise(learner: ReturnType<App["browser"]>, skill: string, { unseen = true } = {}) {
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen, outsideHelp: false });
  return task as string;
}
const adjustments = async (app: App, track: string) => app.concepts.MasteryEstimating._adjustments({ track } as never);

test("Adjust saves one adjustment that Read shows with its reason and the new estimate; a retry adds nothing", async () => {
  const app = await setup(), { learner, user, skill } = await learningFixture(app, "adjuster");
  const { track } = await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const input = { skill, adjustmentKey: crypto.randomUUID(), value: 70, reason: "I passed the unit quiz on products last week." };
  const { adjustment } = await learner.ok("/learning/adjust", input);
  expect(adjustment).toEqual(expect.any(String));

  const read = await learner.ok("/learning/read", { skill });
  expect(read.estimate.value).toBeCloseTo(70, 4); expect(read.estimate.ready).toBe(false);
  const row = read.explanation.changes.find((change: { kind: string }) => change.kind === "ADJUSTMENT");
  expect(row).toMatchObject({ source: adjustment, reason: input.reason, after: 70, days: 0 });
  expect(row.before).toBeCloseTo(50, 4);
  expect(read.explanation.changes.at(-1)).toMatchObject({ kind: "TIME", source: "", reason: "" });

  // A retry after a lost reply returns the same identity and appends nothing.
  expect(await learner.ok("/learning/adjust", input)).toEqual({ adjustment });
  const native = await app.native(user);
  expect(await native.gateway("/learning/adjust", input)).toMatchObject({ ok: true, value: { adjustment } });
  expect(await adjustments(app, track)).toHaveLength(1);

  // The same key with a different value or reason is a conflict, and nothing changes.
  const conflict = message(mastery.AdjustmentKeyConflict);
  expect(await learner.post("/learning/adjust", { ...input, value: 71 })).toEqual({ status: 409, body: { error: "CONFLICT", detail: conflict } });
  expect(await native.gateway("/learning/adjust", { ...input, reason: "A different reason" })).toEqual({ ok: false, error: { kind: "domain", value: "ADJUSTMENT_KEY_CONFLICT", detail: conflict } });
  // Admission checks only the skill, so the concept decides the key, value, and reason, and its message reaches the learner.
  const blankKey = message(mastery.InvalidAdjustmentKey), invalidAdjustment = message(mastery.InvalidMasteryAdjustment);
  expect(await learner.post("/learning/adjust", { ...input, adjustmentKey: "  " })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: blankKey } });
  expect(await native.gateway("/learning/adjust", { ...input, adjustmentKey: "" })).toEqual({ ok: false, error: { kind: "domain", value: "INVALID_ADJUSTMENT_KEY", detail: blankKey } });
  for (const invalid of [{ value: 140 }, { value: -5 }, { reason: "   " }]) {
    const attempt = { ...input, adjustmentKey: crypto.randomUUID(), ...invalid };
    expect(await learner.post("/learning/adjust", attempt)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: invalidAdjustment } });
    expect(await native.gateway("/learning/adjust", { ...attempt, adjustmentKey: crypto.randomUUID() }))
      .toEqual({ ok: false, error: { kind: "domain", value: "INVALID_MASTERY_ADJUSTMENT", detail: invalidAdjustment } });
  }
  // Request validation still refuses a value that is not a number.
  expect(await learner.post("/learning/adjust", { ...input, adjustmentKey: crypto.randomUUID(), value: "70" })).toMatchObject({ status: 400 });
  expect(await adjustments(app, track)).toHaveLength(1);
  expect((await learner.ok("/learning/read", { skill })).estimate.value).toBeCloseTo(70, 4);
  // An adjustment alone never makes the skill ready; readiness needs recent independent work.
  await learner.ok("/learning/adjust", { ...input, adjustmentKey: crypto.randomUUID(), value: 100 });
  expect((await learner.ok("/learning/read", { skill })).estimate).toMatchObject({ ready: false });
}, 60_000);

test("Adjust declines an unknown, another learner's, or a draft skill alike, and refuses a skill without a starting estimate", async () => {
  const app = await setup(), { learner, user, unit, skill, material } = await learningFixture(app, "adjust-owner");
  const other = app.browser(), outsider = await other.signIn("adjust-outsider");
  const { track } = await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { skill: draft } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Inverses", outcome: "Invert matrices", gate: "Two inverses" });
  const input = { adjustmentKey: crypto.randomUUID(), value: 90, reason: "I know this already." };
  const owner = await app.native(user), foreign = await app.native(outsider.user);
  for (const [caller, http, target] of [[owner, learner, "missing"], [foreign, other, skill], [owner, learner, draft]] as const) {
    expect(await http.post("/learning/adjust", { ...input, skill: target })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: UNAVAILABLE_SKILL } });
    expect(await caller.gateway("/learning/adjust", { ...input, skill: target })).toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: UNAVAILABLE_SKILL } });
    // The endpoint repeats the check for callers that bypass admission.
    expect(await caller.raw("/learning/adjust", { ...input, skill: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "SKILL_UNAVAILABLE" } });
  }
  expect(await adjustments(app, track)).toEqual([]);
  expect(await app.concepts.MasteryEstimating._tracks({ learner: user, subject: draft } as never)).toEqual([]);
  expect((await app.browser().post("/learning/adjust", { ...input, skill })).status).toBe(401);

  // A confirmed skill without a starting estimate passes admission; the concept refuses it.
  const { skill: unstarted } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Transposes", outcome: "Transpose matrices", gate: "Two transposes" });
  await learner.ok("/courses/skills/confirm", { skill: unstarted });
  const unstartedTrack = message(mastery.AdjustmentTrackUnavailable);
  expect(await learner.post("/learning/adjust", { ...input, skill: unstarted })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: unstartedTrack } });
  expect(await owner.gateway("/learning/adjust", { ...input, adjustmentKey: crypto.randomUUID(), skill: unstarted }))
    .toEqual({ ok: false, error: { kind: "domain", value: "ADJUSTMENT_TRACK_UNAVAILABLE", detail: unstartedTrack } });
  expect(await app.concepts.MasteryEstimating._tracks({ learner: user, subject: unstarted } as never)).toEqual([]);
}, 60_000);

test("an adjustment replans: the candidate gets a new key, priority from the adjusted estimate, and days from the evidence", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "adjust-planner");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await learner.ok("/planning/configure", { course, dailyMinutes: 30 });
  await practise(learner, skill);
  const read = await learner.ok("/learning/read", { skill }), performedAt = new Date(read.cases[0].performedAt);
  expect(read.estimate.value).toBeGreaterThan(94.99);
  type Candidate = { key: string; subject: string; priority: number; earliestDay: string; latestDay: string; reason: string };
  const candidateFor = (plan: { items: { candidate: Candidate }[] }) => plan.items.map((item) => item.candidate).find((candidate) => candidate.subject === skill)!;
  const before = await learner.ok("/planning/read", { course }), evidenced = candidateFor(before.plan);
  // After fresh independent success the next review is due one stability later. Confidence 50 seeds the memory, and the
  // practice right after it is a same-day Good review.
  const { stability } = review(seed(50), gradeOf("INDEPENDENT"), daysBetween(performedAt, Date.parse(read.explanation.start.at)));
  const occasion = studyDate(new Date(performedAt.getTime() + stability * DAY));
  expect(evidenced.key).toBe(`${skill}:${read.skill.current}:${read.cases[0].case}:1:${occasion}`);
  expect(evidenced.priority).toBeCloseTo(5, 3);

  const input = { skill, adjustmentKey: crypto.randomUUID(), value: 40, reason: "I could not redo the second product today." };
  const { adjustment } = await learner.ok("/learning/adjust", input);
  const after = await learner.ok("/planning/read", { course }), adjusted = candidateFor(after.plan);
  expect(after.plan.plan).not.toBe(before.plan.plan);
  expect(adjusted.key).toBe(`${skill}:${read.skill.current}:${read.cases[0].case}:1:${adjustment}:${occasion}`);
  expect(adjusted.priority).toBeCloseTo(60, 3);
  expect(adjusted).toMatchObject({ earliestDay: evidenced.earliestDay, latestDay: evidenced.latestDay, reason: "This skill needs fresh independent evidence." });
  // The proposal made before the adjustment was replaced, not left active.
  const plans = await app.concepts.StudyPlanning._plans({ owner: user, scope: course } as never);
  expect(plans.find((plan) => plan.plan === before.plan.plan)?.status).toBe("SUPERSEDED");
  expect(plans.filter((plan) => plan.status === "ACTIVE").map((plan) => plan.plan)).toEqual([after.plan.plan]);

  // A same-key retry adds no adjustment but runs the replan again, which makes a new proposal from current state.
  expect(await learner.ok("/learning/adjust", input)).toEqual({ adjustment });
  const retried = await app.concepts.StudyPlanning._plans({ owner: user, scope: course } as never);
  expect(retried).toHaveLength(plans.length + 1);
  const proposal = retried.find((plan) => !plans.some((earlier) => earlier.plan === plan.plan))!;
  expect(proposal.status).toBe("ACTIVE");
  expect(retried.find((plan) => plan.plan === after.plan.plan)?.status).toBe("SUPERSEDED");
  expect(candidateFor((await learner.ok("/planning/read", { course })).plan)).toEqual(adjusted);
  expect(await adjustments(app, read.track.track)).toHaveLength(1);
}, 60_000);

test("an exam beyond the seven-day horizon extends the replan after an adjustment instead of refusing it", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "adjust-replan-exam");
  const { track } = await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await learner.ok("/planning/configure", { course, dailyMinutes: 30 });
  await practise(learner, skill);
  const before = await learner.ok("/planning/read", { course });
  // Before exams were planned for, an exam beyond the seven-day horizon made every replan refuse INVALID_PLAN_INPUT.
  // The plan now runs up to the day before the exam, and preparation for the exam stands for the skill's review.
  const date = addDays(studyDate(app.now()), 9);
  expect(await app.concepts.StudyPlanning.setDeadline({ owner: user, scope: course, date, covered: [skill] } as never)).not.toHaveProperty("error");

  const input = { skill, adjustmentKey: crypto.randomUUID(), value: 40, reason: "I could not redo the second product today." };
  const { adjustment } = await learner.ok("/learning/adjust", input);
  expect(await adjustments(app, track)).toHaveLength(1);
  expect((await learner.ok("/learning/read", { skill })).estimate.value).toBeCloseTo(40, 3);
  const after = await learner.ok("/planning/read", { course });
  expect(after.plan.plan).not.toBe(before.plan.plan);
  expect(after.plan.horizonEnd).toBe(addDays(studyDate(app.now()), 8));
  const candidates = after.plan.items.map((item: { candidate: { subject: string; deadlineRefs: string[]; key: string } }) => item.candidate);
  const preparation = candidates.find((candidate: { subject: string }) => candidate.subject === skill);
  // The exam candidate was proposed when the exam was set and is carried unchanged, so its key predates the adjustment.
  expect(preparation.deadlineRefs).toHaveLength(1);
  expect(preparation.key).toEndWith(`:exam:${preparation.deadlineRefs[0]}`);
  // A same-key retry adds no adjustment and leaves the saved estimate alone.
  expect(await learner.ok("/learning/adjust", input)).toEqual({ adjustment });
  expect(await adjustments(app, track)).toHaveLength(1);
}, 60_000);

test("without a saved budget or while an activity is in progress, Adjust succeeds and makes no proposal", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "adjust-no-budget");
  const { track } = await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await learner.ok("/learning/adjust", { skill, adjustmentKey: crypto.randomUUID(), value: 65, reason: "Reviewed my notes." });
  expect(await app.concepts.StudyPlanning._plans({ owner: user, scope: course } as never)).toEqual([]);

  await learner.ok("/planning/configure", { course, dailyMinutes: 30 });
  const { next } = await learner.ok("/planning/read", { course });
  await learner.ok("/planning/begin", { course, item: next.item });
  const plans = await app.concepts.StudyPlanning._plans({ owner: user, scope: course } as never);
  await learner.ok("/learning/adjust", { skill, adjustmentKey: crypto.randomUUID(), value: 75, reason: "Reviewed my notes again." });
  expect(await app.concepts.StudyPlanning._plans({ owner: user, scope: course } as never)).toEqual(plans);
  expect(await adjustments(app, track)).toHaveLength(2);
}, 60_000);

test("Respond and Question save every attachment in one learner turn, in the order attached", async () => {
  const app = await setup(), { learner, course, skill } = await learningFixture(app, "attacher");
  const { material: first } = await learner.ok("/courses/materials/add", upload(course, "page-1.md", "Page one of my paper work."));
  const { material: second } = await learner.ok("/courses/materials/add", upload(course, "page-2.md", "Page two of my paper work."));
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "My two pages.", attachments: [second, first], dialogueLength: 0 });
  // An empty list with text succeeds.
  await learner.ok("/learning/respond", { studySession: task, text: "And a note.", attachments: [], dialogueLength: 1 });
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  await learner.ok("/learning/question", { studySession: lesson, text: "Is my working right?", attachments: [first, second], dialogueLength: 0 });
  const { sessions } = await learner.ok("/learning/read", { skill });
  const dialogue = (session: string) => sessions.find((item: { session: string }) => item.session === session).dialogue;
  const names = (turn: { turn: { media: { name: string }[] } }) => turn.turn.media.map((file) => file.name);
  expect(dialogue(task)).toHaveLength(2);
  expect(dialogue(task)[0].turn).toMatchObject({ speaker: "LEARNER", text: "My two pages." });
  expect(names(dialogue(task)[0])).toEqual(["page-2.md", "page-1.md"]);
  expect(names(dialogue(task)[1])).toEqual([]);
  expect(dialogue(lesson)).toHaveLength(2);
  expect(names(dialogue(lesson)[0])).toEqual(["page-1.md", "page-2.md"]);
  expect(dialogue(lesson)[1].turn.speaker).toBe("TUTOR");
}, 60_000);

test("a duplicate, foreign, or other-course attachment declines the whole response and saves nothing", async () => {
  const app = await setup(), { learner, user, course, skill } = await learningFixture(app, "attach-guard");
  const { material: photo } = await learner.ok("/courses/materials/add", upload(course, "photo.md", "My paper work."));
  const { course: otherCourse } = await learner.ok("/courses/create", { title: "Physics" });
  const { material: elsewhere } = await learner.ok("/courses/materials/add", upload(otherCourse, "forces.md", "Forces."));
  const outsider = app.browser();
  await outsider.signIn("attach-outsider");
  const { course: foreignCourse } = await outsider.ok("/courses/create", { title: "Their course" });
  const { material: foreign } = await outsider.ok("/courses/materials/add", upload(foreignCourse, "theirs.md", "Someone else's work."));
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { task } = await learner.ok("/learning/task", { skill });
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain products." });
  const refused = [{ attachments: [photo, photo] }, { attachments: [photo, foreign] }, { attachments: [elsewhere] }, { attachments: ["missing"] }, { text: "  ", attachments: [] }];
  for (const change of refused) {
    expect(await learner.post("/learning/respond", { studySession: task, text: "My work.", dialogueLength: 0, ...change }), JSON.stringify(change))
      .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: RESPOND_DECLINED } });
    expect(await learner.post("/learning/question", { studySession: lesson, text: "Why?", dialogueLength: 0, ...change }), JSON.stringify(change))
      .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: QUESTION_DECLINED } });
  }
  const native = await app.native(user);
  expect(await native.gateway("/learning/respond", { studySession: task, text: "My work.", channel: "TEXT", attachments: [photo, photo], dialogueLength: 0 }))
    .toMatchObject({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: RESPOND_DECLINED } });
  // A single attachment is a list of one; a bare string is not a list.
  expect((await learner.post("/learning/respond", { studySession: task, text: "My work.", attachments: photo, dialogueLength: 0 })).status).toBe(400);
  const { sessions } = await learner.ok("/learning/read", { skill });
  expect(sessions.map((session: { dialogue: unknown[] }) => session.dialogue)).toEqual([[], []]);
}, 60_000);

test("Read's explanation is null without a track; otherwise it lists the start, ordered changes, ignored attempts, and the basis", async () => {
  const app = await setup(), { learner, skill } = await learningFixture(app, "explained");
  const empty = await learner.ok("/learning/read", { skill });
  expect(empty).toMatchObject({ explanation: null, track: null, estimate: null, sessions: [], cases: [], skill: { skill } });

  await learner.ok("/learning/confidence", { skill, confidence: 60 });
  app.advance(2.5);
  const provisional = (await learner.ok("/learning/read", { skill })).explanation;
  expect(provisional.start).toMatchObject({ confidence: 60, startingBasis: "SELF_REPORTED" });
  expect(provisional.changes).toHaveLength(1);
  expect(provisional.changes[0]).toMatchObject({ kind: "TIME", source: "", before: 60, days: 2, reason: "" });
  // Confidence 60 seeds the memory, and until the first event the estimate follows that memory's retention.
  const startedAt = Date.parse(provisional.start.at), alone = leftAlone(60, daysBetween(Date.parse(provisional.changes[0].at), startedAt));
  expect(provisional.changes[0].after).toBeCloseTo(alone, 3);
  expect(provisional.changes[0].decay).toBeCloseTo(60 - alone, 3);
  expect(provisional).toMatchObject({ ignored: [], provisional: true });
  expect(provisional.basis).toContain("No scored evidence yet; this estimate is provisional.");

  await practise(learner, skill);
  app.advance(1.2);
  const reason = "The second product was a lucky guess.";
  const { adjustment } = await learner.ok("/learning/adjust", { skill, adjustmentKey: crypto.randomUUID(), value: 80, reason });
  app.advance(0.5);
  // Reused work is not informative: the concept lists it as ignored.
  const reused = await practise(learner, skill, { unseen: false });
  app.advance(3.7);
  const read = await learner.ok("/learning/read", { skill }), explanation = read.explanation;
  const scored = read.cases.find((item: { task: string }) => item.task !== reused).case, ignored = read.cases.find((item: { task: string }) => item.task === reused).case;
  expect(explanation.changes.map((change: { kind: string }) => change.kind)).toEqual(["ATTEMPT", "ADJUSTMENT", "TIME"]);
  const [attempt, adjusted, time] = explanation.changes;
  expect(Date.parse(explanation.start.at)).toBe(startedAt);
  // The attempt is a Good review after about 2.5 days; the estimate reached it on the seeded memory's curve.
  const attempted = Date.parse(attempt.at), adjustedAt = Date.parse(adjusted.at);
  const reached = leftAlone(60, daysBetween(attempted, startedAt));
  const { stability } = review(seed(60), gradeOf("INDEPENDENT"), daysBetween(attempted, startedAt));
  expect(attempt).toMatchObject({ source: scored, after: 95, days: 2, reason: "" });
  expect(attempt.before).toBeCloseTo(reached, 3);
  expect(attempt.decay).toBeCloseTo(60 - reached, 3);
  // From 95 the estimate follows the stability the attempt left until the adjustment, which keeps that stability.
  const recalled = 95 * R(daysBetween(adjustedAt, attempted), stability);
  expect(adjusted).toMatchObject({ source: adjustment, after: 80, days: 1, reason });
  expect(adjusted.before).toBeCloseTo(recalled, 3);
  expect(adjusted.decay).toBeCloseTo(95 - recalled, 3);
  // Reused work is not an event, so the time row runs from the adjustment's 80.
  expect(time).toMatchObject({ source: "", before: 80, days: 4, reason: "" });
  expect(time.after).toBeCloseTo(80 * R(daysBetween(Date.parse(time.at), adjustedAt), stability), 3);
  expect(time.decay).toBeCloseTo(time.before - time.after, 9);
  // Rows are in time order and every value stays unrounded for the page to round.
  expect(explanation.changes.map((change: { at: string }) => change.at)).toEqual(explanation.changes.map((change: { at: string }) => change.at).sort());
  expect(Number.isInteger(time.after)).toBe(false);
  expect(explanation.ignored).toEqual([{ evidence: ignored, reason: "Reused successful work gives no new gain." }]);
  expect(explanation.provisional).toBe(false);
  expect(explanation.basis).toContain("Your manual adjustments are included.");
  // The estimate keeps its meaning and agrees with the explanation's last value.
  expect(read.estimate.value).toBeCloseTo(time.after, 3);
}, 60_000);

test("cases reach Read exactly as assessment history reports them, including imported work", async () => {
  const app = await setup(), { learner, user, skill } = await learningFixture(app, "imported");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await practise(learner, skill);
  const { skill: context } = await learner.ok("/learning/read", { skill });
  const imported = await app.concepts.AssessmentReviewing.importGraded({ author: user, subject: skill, definition: context.current, sourceKey: "import:problem-set-3",
    question: "Problem set 3, question 2", criteria: "Two correct products and the reason order matters.",
    response: { text: "My graded answer", attachments: [], conversation: [], citations: [], reviewedDialogueLength: 0 },
    help: "NONE", fresh: true, performedAt: new Date(app.now().getTime() - DAY), mark: "8/10", feedback: "Check the final sum.",
    result: "SLIP", gateMet: false, rationale: "The method is sound; one sum is wrong." } as never);
  expect(imported).not.toHaveProperty("error");
  await app.runtime.gateway.whenIdle();
  const read = await learner.ok("/learning/read", { skill });
  const history = await new AssessmentReviewing(app.connection.db)._history({ author: user, subject: skill });
  expect(read.cases).toEqual(JSON.parse(JSON.stringify(history.cases)));
  const graded = read.cases.find((item: { case: string }) => item.case === (imported as { case: string }).case);
  expect(graded).toMatchObject({ task: null, work: { originalMark: "8/10", originalFeedback: "Check the final sum." } });
  const practice = read.cases.find((item: { case: string }) => item.case !== graded.case);
  expect(practice.task).toEqual(expect.any(String));
  expect(practice.work).toMatchObject({ originalMark: "", originalFeedback: "" });
  // The imported attempt is evidence like any other.
  expect(read.explanation.changes.filter((change: { kind: string }) => change.kind === "ATTEMPT").map((change: { source: string }) => change.source))
    .toEqual([graded.case, practice.case]);
}, 60_000);

test("another learner's real skill, draft, sessions, case, and material are refused on every path and change nothing", async () => {
  const app = await setup(), { learner, user, course, unit, skill, material } = await learningFixture(app, "ids-owner");
  const other = app.browser(), outsider = await other.signIn("ids-outsider");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain why the dimensions matter." });
  await learner.ok("/learning/question", { studySession: lesson, text: "Why does order matter?", dialogueLength: 0 });
  const assessed = await practise(learner, skill);
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "My spoken work", channel: "VOICE", dialogueLength: 0 });
  const { skill: draft } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Inverses", outcome: "Invert matrices", gate: "Two inverses" });
  const { cases: [saved] } = await learner.ok("/learning/read", { skill }), assessment = saved.case, basedOn = saved.judgment.judgment;
  // Everything the owner could lose: sessions with their dialogue, cases with their history, tracks, and the course.
  const state = async () => {
    const { sessions, cases } = await learner.ok("/learning/read", { skill });
    return { sessions, cases, tracks: await app.concepts.MasteryEstimating._tracks({ learner: user, subject: skill } as never), course: await learner.ok("/courses/read", { course }) };
  };
  const before = await state();
  expect(before.sessions).toHaveLength(3);

  // Each request names one of the owner's real records. The last value is the code the endpoint itself answers.
  const requests: [string, Record<string, unknown>, string][] = [
    ["/courses/skills/confirm", { skill: draft }, "COURSE_UNAVAILABLE"],
    ["/courses/skills/edit", { skill: draft, unit, material, title: "Renamed by someone else", outcome: "A forged outcome", gate: "A forged gate" }, "COURSE_UNAVAILABLE"],
    ["/courses/skills/suggest", { material }, "MATERIAL_UNAVAILABLE"],
    ["/learning/read", { skill }, "SKILL_UNAVAILABLE"],
    ["/learning/confidence", { skill, confidence: 90 }, "SKILL_UNAVAILABLE"],
    ["/learning/lesson", { skill, request: "Show the private lesson" }, "SKILL_UNAVAILABLE"],
    ["/learning/task", { skill }, "SKILL_UNAVAILABLE"],
    ["/learning/respond", { studySession: task, text: "Forged work", channel: "TEXT", attachments: [], dialogueLength: 1 }, "SESSION_UNAVAILABLE"],
    ["/learning/question", { studySession: lesson, text: "Forged question", channel: "TEXT", attachments: [], dialogueLength: 2 }, "SESSION_UNAVAILABLE"],
    ["/learning/reply", { studySession: lesson }, "SESSION_UNAVAILABLE"],
    ["/learning/hint", { studySession: task }, "SESSION_UNAVAILABLE"],
    ["/learning/transcript", { studySession: task, turnIndex: 0, text: "Forged words" }, "SESSION_UNAVAILABLE"],
    ["/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false }, "SESSION_UNAVAILABLE"],
    ["/learning/retry", { studySession: assessed }, "SESSION_UNAVAILABLE"],
    ["/learning/regrade", { case: assessment, basedOn, reason: "Check the calculation again" }, "REVISION_CASE_UNAVAILABLE"],
    ["/learning/correct", { case: assessment, basedOn, result: "SLIP", gateMet: false, reason: "A forged correction" }, "REVISION_CASE_UNAVAILABLE"],
  ];
  // Over HTTP, admission declines a guarded command with its detail. The course commands answer FORBIDDEN, and Read and
  // Confidence, which have no admission entry, answer their own refusal, each with its general sentence.
  const guarded = admissions as unknown as Record<string, readonly { detail: string }[]>;
  const declined = (path: string) => guarded[path] ? { status: 400, body: { error: "INVALID_REQUEST", detail: guarded[path].at(-1)!.detail } }
    : path.startsWith("/courses/") ? { status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } } : { status: 400, body: { error: "INVALID_REQUEST", detail: SKILL_UNAVAILABLE } };
  const foreign = await app.native(outsider.user);
  for (const [path, input, code] of requests) {
    expect(await other.post(path, input), path).toEqual(declined(path));
    // Without admission, the endpoint answers a refusal of its own instead of leaving the request unanswered.
    expect(await foreign.raw(path, input), path).toMatchObject({ ok: false, error: { kind: "domain", value: code } });
  }
  // The owner's own submitted attempt is no longer open, so assessing it again without admission is refused the same way.
  const owner = await app.native(user);
  expect(await owner.raw("/learning/assess", { studySession: assessed, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false }))
    .toMatchObject({ ok: false, error: { kind: "domain", value: "SESSION_UNAVAILABLE" } });
  expect(await state()).toEqual(before);
}, 60_000);
