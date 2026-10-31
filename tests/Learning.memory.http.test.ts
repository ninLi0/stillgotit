import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { R, S0, daysBetween, g0, gradeOf, leftAlone, review, seed } from "./fixtures/fsrs.ts";
const ORIGIN = "http://localhost:5173", DAY = 86_400_000, cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const SAMPLE_DAYS = [1, 3, 7, 14, 30, 60, 90];
// Courses.md, "Course and skill refusals": the general sentence for a course that is not the learner's.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";
// Policy fsrs-2, as MasteryEstimating.md states it, computed with the tests' own copy of FSRS-6. The test checks the read
// against these numbers; the read itself takes every value from the concept.
/** An instant as milliseconds, from a JSON string or a native Date. */
const instant = (value: string | Date) => new Date(value).getTime();
// Review days are calendar days in New York, counted as the planner counts them (design/compositions/LearningReads.md,
// "The review day"). These are the tests' own copies, independent of src/computations/review-day.ts.
const studyDate = (at: string | number | Date) => new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });
const calendarDays = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);
/** The review day of a due instant as the read answers it: the day it falls on, and the calendar days from the read's day to it. */
const reviewOn = (asOf: string | Date, due: number) => ({ day: studyDate(due), days: calendarDays(studyDate(asOf), studyDate(due)) });
// A fixed start keeps calendar days stable: 10:00 in New York on Wednesday, October 30, 2030, four days before daylight
// saving time ends on Sunday, November 3. It lies years ahead so that MongoDB's expiry of sessions, which follows the real
// clock, never removes a session the test still uses.
const WEDNESDAY_10AM = Date.parse("2030-10-30T14:00:00Z");

type Point = { days: number; at: string; value: number };
type ReviewPoint = { day: string; days: number; value: number };
type MemorySkill = {
  skill: string; title: string; unit: string; unitTitle: string; startingConfidence: number | null; startedAt: string | null; estimate: number | null;
  projection: Point[] | null; reviewBy: ReviewPoint | null; belowNow: boolean | null; leftAlone: { at: string; value: number }[] | null;
};
type MemoryAnswer = { asOf: string; policy: { policy: string; desiredRetention: number; reviewThreshold: number; readinessDays: number; reference: { days: number; value: number }[] }; skills: MemorySkill[] };

// The harness of Learning.evidence.http.test.ts, with its movable clock. The clock starts at `start`, which is now unless
// a test fixes it, and only `advance` moves it.
async function setup(start = Date.now()) {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  let offset = 0, questions = 0;
  const clock = () => new Date(start + offset);
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
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock });
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
      gateway: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 }),
      raw: (path: string, input: Record<string, unknown>) => runtime.application.invoker.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 }),
    };
  }
  return { browser, native, advance: (days: number) => { offset += days * DAY; }, now: clock };
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
  return { learner, user, course, unit, material, confirmed };
}
/** One fresh, unaided practice attempt, which the canned assessment judges an independent success that meets the gate. */
async function practise(learner: ReturnType<App["browser"]>, skill: string) {
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
}
const memory = async (learner: ReturnType<App["browser"]>, course: string) => await learner.ok("/learning/memory", { course }) as MemoryAnswer;
const row = (answer: MemoryAnswer, skill: string) => answer.skills.find((item) => item.skill === skill)!;

/** A projection never rises, sits on whole days after the read, and on each of them has the value `expected` gives for that instant. */
function expectDecaying(answer: MemoryAnswer, item: MemorySkill, expected: (at: number) => number) {
  const asOf = Date.parse(answer.asOf), projection = item.projection!;
  expect(projection.map((point) => point.days)).toEqual(SAMPLE_DAYS);
  for (const point of projection) expect(Date.parse(point.at)).toBe(asOf + point.days * DAY);
  const values = [item.estimate!, ...projection.map((point) => point.value)];
  for (let index = 1; index < values.length; index++) expect(values[index]!).toBeLessThanOrEqual(values[index - 1]!);
  for (const point of projection) expect(point.value).toBeCloseTo(expected(Date.parse(point.at)), 6);
}

test("Memory answers the policy and its reference curve, a curve for a skill with a starting point, and no curve without one", async () => {
  const app = await setup(WEDNESDAY_10AM), { learner, course, unit, material, confirmed } = await learningFixture(app, "memory-reader");
  const started = await confirmed("Products"), unstarted = await confirmed("Transposes");
  await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Inverses", outcome: "Invert matrices", gate: "One inverse and why" });
  await learner.ok("/learning/confidence", { skill: started, confidence: 80 });
  const answer = await memory(learner, course);

  // The policy's settings come from MasteryEstimating, with the reference curve of an estimate of 100% left alone.
  expect(Object.keys(answer.policy).sort()).toEqual(["desiredRetention", "policy", "readinessDays", "reference", "reviewThreshold"]);
  expect(answer.policy).toMatchObject({ policy: "fsrs-2", desiredRetention: 0.9, reviewThreshold: 70, readinessDays: 14 });
  expect(answer.policy.reference.map((point) => point.days)).toEqual([0, ...SAMPLE_DAYS]);
  for (const point of answer.policy.reference) expect(point.value).toBeCloseTo(leftAlone(100, point.days), 9);

  // Only confirmed skills are listed, in skill identity order; the draft is left out.
  expect(answer.skills.map((item) => item.skill)).toEqual([started, unstarted].sort());
  const curve = row(answer, started);
  expect(curve).toMatchObject({ title: "Products", unit, unitTitle: "Products", startingConfidence: 80, belowNow: false });
  const startedAt = Date.parse(curve.startedAt!), fromStart = (at: number) => leftAlone(80, daysBetween(at, startedAt));
  expect(startedAt).toBe(WEDNESDAY_10AM);
  expect(curve.estimate!).toBeCloseTo(80, 3);
  expect(curve.estimate!).toBeCloseTo(fromStart(Date.parse(answer.asOf)), 9);
  expectDecaying(answer, curve, fromStart);
  // A starting confidence of 80 stands for a first Good rating, the highest a reported confidence seeds. Its memory is due
  // when the retention falls to 90%, 2.3 days after the start: at 17:21 on Friday, so the review day is Friday, two
  // calendar days away. The value on it is the projection's two whole days of 24 hours after the read.
  const due = startedAt + S0(g0(80)) * DAY;
  expect(curve.reviewBy).toEqual({ ...reviewOn(answer.asOf, due), value: expect.any(Number) });
  expect(curve.reviewBy).toMatchObject({ day: "2030-11-01", days: 2 });
  expect(curve.reviewBy!.value).toBeCloseTo(fromStart(Date.parse(answer.asOf) + 2 * DAY), 9);
  // Left alone from its starting point, the skill follows its own projection, because nothing has changed it.
  expect(curve.leftAlone!.map((point) => point.at)).toEqual([curve.startedAt!, answer.asOf, ...curve.projection!.map((point) => point.at)]);
  expect(curve.leftAlone![0]!.value).toBe(80);
  curve.projection!.forEach((point, index) => expect(curve.leftAlone![index + 2]!.value).toBeCloseTo(point.value, 9));

  // A skill without a starting point keeps its row with no curve.
  expect(row(answer, unstarted)).toEqual({ skill: unstarted, title: "Transposes", unit, unitTitle: "Products", startingConfidence: null, startedAt: null,
    estimate: null, projection: null, reviewBy: null, belowNow: null, leftAlone: null });
  // A course with no confirmed skill answers an empty list and the same policy.
  const { course: empty } = await learner.ok("/courses/create", { title: "Statistics" });
  expect(await memory(learner, empty)).toMatchObject({ skills: [], policy: { policy: "fsrs-2", desiredRetention: 0.9, reviewThreshold: 70 } });
}, 60_000);

test("a skill lifted to 95% by an assessment is due for review on the calendar day its retention reaches 90%, and that day stays as time passes", async () => {
  const app = await setup(WEDNESDAY_10AM), { learner, user, course, confirmed } = await learningFixture(app, "memory-practiser");
  const skill = await confirmed("Products");
  await learner.ok("/learning/confidence", { skill, confidence: 80 });
  await practise(learner, skill);

  const answer = await memory(learner, course), curve = row(answer, skill);
  // The success is a Good review of the memory the 80% start seeded, moments after the start. It lifts the estimate to 95,
  // which then falls along the memory the review left.
  const { track } = await learner.ok("/learning/read", { skill }) as { track: { inputs: { performedAt: string }[] } };
  const practisedAt = Date.parse(track.inputs[0]!.performedAt);
  const after = review(seed(80), gradeOf("INDEPENDENT"), daysBetween(practisedAt, Date.parse(curve.startedAt!)));
  const estimateAt = (at: number) => 95 * R(daysBetween(at, practisedAt), after.stability), due = practisedAt + after.stability * DAY;
  expect(curve.estimate!).toBeCloseTo(95, 3);
  expect(curve.estimate!).toBeCloseTo(estimateAt(Date.parse(answer.asOf)), 9);
  expect(curve.belowNow).toBe(false);
  expectDecaying(answer, curve, estimateAt);
  // The review day is the calendar day the due instant falls on: Friday at 17:21, two days after the read on Wednesday at
  // 10:00. Counting whole spans of 24 hours from the read, as the read used to, rounded the 2.3 days up to Saturday.
  expect(curve.reviewBy).toEqual({ ...reviewOn(answer.asOf, due), value: expect.any(Number) });
  expect(curve.reviewBy).toMatchObject({ day: "2030-11-01", days: 2 });
  expect(curve.reviewBy!.value).toBeCloseTo(estimateAt(Date.parse(answer.asOf) + 2 * DAY), 9);
  // The assessment lifted the curve above the one it would have followed from its 80% start.
  expect(curve.leftAlone![0]!.value).toBe(80);
  curve.projection!.forEach((point, index) => expect(point.value).toBeGreaterThan(curve.leftAlone![index + 2]!.value));

  // A day later, without practice, the estimate has fallen and the same review day is one day nearer. Each later read uses
  // a new native session, since the browser's session may have ended.
  const readLater = async () => { const result = await (await app.native(user)).gateway("/learning/memory", { course }) as { ok: true; value: MemoryAnswer };
    return { asOf: result.value.asOf, curve: row(result.value, skill) }; };
  app.advance(1);
  const later = await readLater();
  expect(later.curve.estimate!).toBeLessThan(curve.estimate!);
  expect(later.curve.estimate!).toBeCloseTo(estimateAt(instant(later.asOf)), 9);
  expect(later.curve.reviewBy).toEqual({ ...reviewOn(later.asOf, due), value: expect.any(Number) });
  expect(later.curve.reviewBy).toMatchObject({ day: "2030-11-01", days: 1 });
  expect(later.curve.reviewBy!.value).toBeCloseTo(estimateAt(instant(later.asOf) + DAY), 9);
  // Past the due instant the skill is due now, so there is no review day left to find.
  app.advance(3);
  const past = await readLater();
  expect(instant(past.asOf)).toBeGreaterThan(due);
  expect(past.curve).toMatchObject({ belowNow: true, reviewBy: null });
}, 60_000);

test("Memory refuses a course the learner does not own on every path and shows nothing of it", async () => {
  const app = await setup(WEDNESDAY_10AM), { learner, user, course, confirmed } = await learningFixture(app, "memory-owner");
  const skill = await confirmed("Products");
  await learner.ok("/learning/confidence", { skill, confidence: 80 });
  const other = app.browser(), outsider = await other.signIn("memory-outsider");
  const { course: own } = await other.ok("/courses/create", { title: "Statistics" });

  for (const target of [course, "missing-course"]) {
    const answer = await other.post("/learning/memory", { course: target });
    expect(answer).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(JSON.stringify(answer.body)).not.toContain(skill);
    const foreign = await app.native(outsider.user);
    expect(await foreign.gateway("/learning/memory", { course: target })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    expect(await foreign.raw("/learning/memory", { course: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
  }
  // The outsider's own course lists only the outsider's skills, which are none.
  expect((await memory(other, own)).skills).toEqual([]);
  // The owner reads the curve on every path, with the review day of the memory the 80% start seeded, and a request without
  // a session is refused before any read.
  const owner = await app.native(user);
  for (const path of [owner.gateway, owner.raw]) {
    const result = await path("/learning/memory", { course }) as { ok: true; value: MemoryAnswer };
    expect(result).toMatchObject({ ok: true });
    const due = instant(result.value.skills[0]!.startedAt!) + S0(g0(80)) * DAY;
    expect(result.value.skills.map((item) => [item.skill, item.reviewBy?.day, item.reviewBy?.days])).toEqual([[skill, ...Object.values(reviewOn(result.value.asOf, due))]]);
  }
  expect((await app.browser().post("/learning/memory", { course })).status).toBe(401);
}, 60_000);

/** The review the course's active plan holds for a skill: its key, its first day, and the day the plan placed it on. */
async function planned(learner: ReturnType<App["browser"]>, course: string, skill: string) {
  type Item = { candidate: { subject: string; key: string; earliestDay: string }; day: string };
  // The harness answers a body's `data` field, which for the plan read is the plan data itself.
  const data = await learner.ok("/planning/read", { course }) as { plan: { items: Item[] } | null };
  const item = data.plan!.items.find((row) => row.candidate.subject === skill)!;
  return { key: item.candidate.key, earliestDay: item.candidate.earliestDay, day: item.day };
}

test("after practice and then a manual adjustment, the Plan and the Memory view name the same review day", async () => {
  const app = await setup(WEDNESDAY_10AM), { learner, course, confirmed } = await learningFixture(app, "memory-planner");
  const adjusted = await confirmed("Products"), steady = await confirmed("Transposes");
  await learner.ok("/planning/configure", { course, dailyMinutes: 30, focusNote: "" });
  for (const skill of [adjusted, steady]) {
    await learner.ok("/learning/confidence", { skill, confidence: 80 });
    await practise(learner, skill);
  }
  /** The skill's review day in the Memory view and its review in the Plan, read at the same moment. */
  const both = async (skill: string) => {
    const answer = await memory(learner, course);
    return { asOf: answer.asOf, memory: row(answer, skill).reviewBy, plan: await planned(learner, course, skill) };
  };
  // Each success is a same-day Good review of the memory that the 80% start seeded, which leaves its stability at 2.3 days,
  // so both skills are due at 17:21 on Friday. The Plan starts both reviews on Friday, and the Memory view says to review
  // both by Friday.
  const { stability } = review(seed(80), gradeOf("INDEPENDENT"), 0);
  for (const skill of [adjusted, steady]) {
    const { asOf, memory: reviewBy, plan } = await both(skill);
    expect(reviewBy).toEqual({ ...reviewOn(asOf, WEDNESDAY_10AM + stability * DAY), value: expect.any(Number) });
    expect(reviewBy).toMatchObject({ day: "2030-11-01", days: 2 });
    expect(plan).toMatchObject({ earliestDay: "2030-11-01", day: "2030-11-01" });
  }

  // At 22:00 on Thursday the learner sets Products to 80%. The adjustment keeps the stability but restarts the curve, so
  // the memory is due 2.3 days after it, at 4:21 on Sunday, after daylight saving time has ended. The Plan's review moves
  // to Sunday with it. Counted from the practice instead, the Plan kept Friday while the Memory view said Sunday.
  app.advance(1.5);
  const { adjustment } = await learner.ok("/learning/adjust", { skill: adjusted, adjustmentKey: crypto.randomUUID(), value: 80, reason: "I needed my notes for the second product." });
  const adjustedAt = WEDNESDAY_10AM + 1.5 * DAY, due = adjustedAt + stability * DAY;
  const { explanation } = await learner.ok("/learning/read", { skill: adjusted }) as { explanation: { changes: { kind: string; source: string; at: string }[] } };
  expect(explanation.changes.find((change) => change.kind === "ADJUSTMENT")).toMatchObject({ source: adjustment, at: new Date(adjustedAt).toISOString() });
  const moved = await both(adjusted);
  expect(moved.memory).toEqual({ ...reviewOn(moved.asOf, due), value: expect.any(Number) });
  expect(moved.memory).toMatchObject({ day: "2030-11-03", days: 3 });
  expect(moved.plan).toMatchObject({ earliestDay: "2030-11-03", day: "2030-11-03" });
  expect(moved.plan.key).toEndWith(`:${adjustment}:2030-11-03`);
  // The skill without an adjustment keeps its Friday in both, now one day away.
  const kept = await both(steady);
  expect(kept.memory).toMatchObject({ day: "2030-11-01", days: 1 });
  expect(kept.plan).toMatchObject({ earliestDay: "2030-11-01", day: "2030-11-01" });

  // A day later, after Update plan, both still name Sunday, now two days away.
  app.advance(1);
  await learner.ok("/planning/propose", { course });
  const later = await both(adjusted);
  expect(later.memory).toMatchObject({ day: "2030-11-03", days: 2 });
  expect(later.plan).toMatchObject({ earliestDay: "2030-11-03", day: "2030-11-03" });
}, 60_000);

test("a memory due later today is reviewed today, no days away, and is due now once that time has passed", async () => {
  const app = await setup(WEDNESDAY_10AM), { learner, user, course, confirmed } = await learningFixture(app, "memory-today");
  const skill = await confirmed("Products");
  // A starting confidence of 30 seeds a first Again rating, whose memory is due about five hours later, at 15:05.
  await learner.ok("/learning/confidence", { skill, confidence: 30 });
  const answer = await memory(learner, course), curve = row(answer, skill);
  expect(curve.reviewBy).toEqual({ day: "2030-10-30", days: 0, value: expect.any(Number) });
  expect(curve.reviewBy!.value).toBeCloseTo(curve.estimate!, 9);
  expect(reviewOn(answer.asOf, WEDNESDAY_10AM + S0(g0(30)) * DAY)).toEqual({ day: "2030-10-30", days: 0 });
  // At 16:00 the memory is due now.
  app.advance(0.25);
  const result = await (await app.native(user)).gateway("/learning/memory", { course }) as { ok: true; value: MemoryAnswer };
  expect(row(result.value, skill)).toMatchObject({ belowNow: true, reviewBy: null });
}, 60_000);
