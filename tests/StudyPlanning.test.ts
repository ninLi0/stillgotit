import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { StudyPlanning, type Candidate } from "../src/concepts/StudyPlanning/StudyPlanning.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

beforeAll(async () => { connection = await connectMongo({ uri, database }); });
// Every test starts from an empty database.
beforeEach(async () => { await connection!.db.dropDatabase(); });
afterAll(async () => {
  if (!connection) return;
  try { await connection.db.dropDatabase(); }
  finally { await connection.client.close(); }
});

const messages = {
  INVALID_DAILY_BUDGET: "Enter a whole number of minutes from 0 to 1440.",
  EXAM_PREFERENCES_UNAVAILABLE: "Set a study budget for this course first.",
  INVALID_EXAM_DETAILS: "Choose today or a future date and at least one covered skill.",
  EXAM_REMOVE_UNAVAILABLE: "Choose an exam recorded for this course.",
  PLAN_PREFERENCES_UNAVAILABLE: "Set a study budget for this course first.",
  PLAN_SESSION_IN_PROGRESS: "Finish or stop the current activity before replacing the schedule.",
  INVALID_PLAN_INPUT: "Provide valid activities, planning dates, and all known unfinished exam preparation.",
  ROUTINE_PLAN_UNAVAILABLE: "Choose one of your proposed plans.",
  ROUTINE_SESSION_IN_PROGRESS: "Finish or stop the current activity before changing plans.",
  ROUTINE_PLAN_OUTDATED: "Create a new proposal from the current budget, dates, and progress.",
  EXAM_TRADEOFF_CONFIRMATION_REQUIRED: "Review and confirm the proposed cuts to exam preparation.",
  TRADEOFF_PLAN_UNAVAILABLE: "Choose one of your proposed plans.",
  TRADEOFF_SESSION_IN_PROGRESS: "Finish or stop the current activity before changing plans.",
  TRADEOFF_PLAN_OUTDATED: "Review a new proposal based on the current budget, dates, and progress.",
  TRADEOFF_CONFIRMATION_NOT_NEEDED: "This plan has no new exam cuts. Use routine activation.",
  PLAN_DECLINE_UNAVAILABLE: "Choose one of your proposed plans.",
  ACTIVITY_BEGIN_UNAVAILABLE: "Choose an unfinished activity from your active plan.",
  ANOTHER_ACTIVITY_IN_PROGRESS: "Finish or stop the current activity first.",
  ACTIVITY_NOT_SCHEDULED_TODAY: "Choose an activity scheduled for today or update the plan.",
  ACTIVITY_EXCEEDS_REMAINING_BUDGET: "Update the plan or time budget before starting this activity.",
  ACTIVITY_FINISH_UNAVAILABLE: "Choose your current activity.",
  INVALID_FINISH_TIME: "Enter a nonnegative number of minutes spent.",
  ACTIVITY_STOP_UNAVAILABLE: "Choose your current activity.",
  INVALID_STOP_TIME: "Enter a nonnegative number of minutes spent.",
  ACTIVITY_MISS_UNAVAILABLE: "Choose an unfinished activity from your active plan.",
  ACTIVITY_MISS_TOO_EARLY: "Only today's or an overdue activity can be marked missed.",
} as const;

async function refuses(action: Promise<unknown>, code: keyof typeof messages) {
  await expect(action).rejects.toMatchObject({ code, message: messages[code] });
}

// Raw reads only compare stored state before and after an action. Tests create records through actions.
async function savedState(): Promise<Record<string, Document[]>> {
  const collections = await connection!.db.listCollections({}, { nameOnly: true }).toArray();
  return Object.fromEntries(await Promise.all(collections.map(async ({ name }) =>
    [name, await connection!.db.collection(name).find().sort({ _id: 1 }).toArray()] as const)));
}

type ItemRow = Awaited<ReturnType<StudyPlanning["_items"]>>[number];
type PlanRow = Awaited<ReturnType<StudyPlanning["_plans"]>>[number];

const sam = { learner: "sam", scope: "linear-algebra" };
const proposal = { horizonEnd: "2026-10-19", explanation: "Prepare for the midterm first.", basis: "skills-v1", workloadComplete: true };

function setup() {
  let today = "2026-10-13";
  const planning = new StudyPlanning(connection!.db, "StudyPlanning", () => today);
  return { planning, setToday: (value: string) => { today = value; } };
}

function candidate(key: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    key, subject: key, definition: "v1", activity: `Practice ${key}`, minutes: 20, priority: 1,
    earliestDay: "2026-10-13", latestDay: "2026-10-19", reason: `A fresh check of ${key} is due.`, examRefs: [], ...overrides,
  };
}

const rows = (items: ItemRow[]) => items.map(({ day, candidate: { key }, status }) => [day, key, status]);
const statuses = (plans: PlanRow[]) => Object.fromEntries(plans.map(({ plan, status }) => [plan, status]));

describe("StudyPlanning", () => {
  test("principle: a budget and exam lead to an active plan; finished and missed work lead to a replacement that takes over", async () => {
    const { planning, setToday } = setup();
    const { preferences } = await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "Midterm first." });
    expect(await planning._preferences(sam)).toEqual([{ preferences, dailyMinutes: 30, focusNote: "Midterm first." }]);
    const { exam } = await planning.setExam({ ...sam, date: "2026-10-16", covered: ["vectors", "matrices"] });
    expect(await planning._exams(sam)).toEqual([{ exam, date: "2026-10-16", covered: ["vectors", "matrices"], active: true }]);
    const vectors = candidate("vectors", { priority: 3, latestDay: "2026-10-15", examRefs: [exam] });
    const matrices = candidate("matrices", { priority: 2, latestDay: "2026-10-15", examRefs: [exam] });
    const review = candidate("determinants", { minutes: 10 });

    // The 30-minute days before the exam fit all 40 minutes of exam work, so no cuts need confirmation.
    const first = await planning.replan({ ...sam, candidates: [review, matrices, vectors], ...proposal });
    expect((await planning._plan(first))[0]).toMatchObject({
      learner: "sam", scope: "linear-algebra", status: "PROPOSED", focusExam: exam, examUrgent: false,
      estimatedExamMinutes: 40, availableExamMinutes: 90, scheduledMinutes: 50, deferredMinutes: 0, needsConfirmation: false,
    });
    expect(rows(await planning._items(first))).toEqual([
      ["2026-10-13", "vectors", "TODO"], ["2026-10-13", "determinants", "TODO"], ["2026-10-14", "matrices", "TODO"],
    ]);
    await planning.activateRoutine({ learner: "sam", plan: first.plan, currentBasis: "skills-v1" });
    const [firstVectors, firstReview, firstMatrices] = await planning._items(first);
    expect(await planning._next(sam)).toEqual([{ item: firstVectors!.item, candidate: vectors, day: "2026-10-13", status: "TODO" }]);

    // The learner finishes the first activity with an overrun. The review no longer fits today, so it is missed.
    await planning.begin({ learner: "sam", item: firstVectors!.item });
    await planning.finish({ learner: "sam", item: firstVectors!.item, actualMinutes: 25 });
    expect(await planning._budget({ ...sam, day: "2026-10-13" })).toEqual([{ dailyMinutes: 30, spentMinutes: 25, remainingMinutes: 5 }]);
    await planning.miss({ learner: "sam", item: firstReview!.item });

    // The new proposal moves the unfinished work to tomorrow. The active plan stays in use until it is replaced.
    const second = await planning.replan({ ...sam, candidates: [matrices, review], ...proposal });
    expect(statuses(await planning._plans(sam))).toEqual({ [first.plan]: "ACTIVE", [second.plan]: "PROPOSED" });
    expect((await planning._next(sam))[0]!.item).toBe(firstMatrices!.item);
    expect(rows(await planning._items(second))).toEqual([["2026-10-14", "matrices", "TODO"], ["2026-10-14", "determinants", "TODO"]]);
    expect(await planning._proposalCheck({ learner: "sam", plan: second.plan, currentBasis: "skills-v1" })).toEqual([{
      locallyCurrent: true, contextCurrent: true, sessionInProgress: false, needsConfirmation: false, canActivate: true,
    }]);
    await planning.activateRoutine({ learner: "sam", plan: second.plan, currentBasis: "skills-v1" });
    expect(statuses(await planning._plans(sam))).toEqual({ [first.plan]: "SUPERSEDED", [second.plan]: "ACTIVE" });
    expect(rows(await planning._items(first))).toEqual([
      ["2026-10-13", "vectors", "DONE"], ["2026-10-13", "determinants", "MISSED"], ["2026-10-14", "matrices", "REPLACED"],
    ]);

    // The next day the learner stops one activity early and finishes another. Earlier time stays recorded.
    setToday("2026-10-14");
    const [secondMatrices, secondReview] = await planning._items(second);
    expect((await planning._next(sam))[0]!.item).toBe(secondMatrices!.item);
    await planning.begin({ learner: "sam", item: secondMatrices!.item });
    await planning.stop({ learner: "sam", item: secondMatrices!.item, actualMinutes: 12 });
    await planning.begin({ learner: "sam", item: secondReview!.item });
    await planning.finish({ learner: "sam", item: secondReview!.item, actualMinutes: 10 });
    expect(await planning._items(second)).toEqual([
      { ...secondMatrices!, status: "STOPPED", actualMinutes: 12, spentOn: "2026-10-14" },
      { ...secondReview!, status: "DONE", actualMinutes: 10, spentOn: "2026-10-14" },
    ]);
    expect(await planning._item({ item: secondReview!.item })).toEqual([{ learner: "sam", scope: "linear-algebra", ...secondReview!, status: "DONE", actualMinutes: 10, spentOn: "2026-10-14" }]);
    expect(await planning._budget({ ...sam, day: "2026-10-13" })).toEqual([{ dailyMinutes: 30, spentMinutes: 25, remainingMinutes: 5 }]);
    const { schedule } = await planning._schedule(sam);
    expect(schedule).toMatchObject({ today: "2026-10-14", budget: { dailyMinutes: 30, spentMinutes: 22, remainingMinutes: 8 }, next: null });
  });

  test("activating a replacement marks the old plan's overdue activities missed and its later activities replaced", async () => {
    const { planning, setToday } = setup();
    await planning.configure({ ...sam, dailyMinutes: 20, focusNote: "" });
    const work = [candidate("a"), candidate("b"), candidate("c")];
    const first = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ learner: "sam", plan: first.plan, currentBasis: "skills-v1" });
    const [overdue, current, later] = await planning._items(first);
    expect(rows([overdue!, current!, later!])).toEqual([["2026-10-13", "a", "TODO"], ["2026-10-14", "b", "TODO"], ["2026-10-15", "c", "TODO"]]);

    // The learner skips a day without recording anything, then accepts a new plan.
    setToday("2026-10-14");
    const second = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ learner: "sam", plan: second.plan, currentBasis: "skills-v1" });
    expect(await planning._items(first)).toEqual([
      { ...overdue!, status: "MISSED" }, { ...current!, status: "REPLACED" }, { ...later!, status: "REPLACED" },
    ]);
    expect(rows(await planning._items(second))).toEqual([["2026-10-14", "a", "TODO"], ["2026-10-15", "b", "TODO"], ["2026-10-16", "c", "TODO"]]);
    expect((await planning._budget({ ...sam, day: "2026-10-13" }))[0]!.spentMinutes).toBe(0);
  });

  test("new exam cuts need confirmation, an approved cut later activates routinely, and a declined larger cut keeps the active plan", async () => {
    const { planning } = setup();
    await planning.configure({ ...sam, dailyMinutes: 20, focusNote: "" });
    const { exam } = await planning.setExam({ ...sam, date: "2026-10-14", covered: ["vectors", "matrices"] });
    const work = [candidate("vectors", { priority: 2, examRefs: [exam] }), candidate("matrices", { examRefs: [exam] }), candidate("determinants", { minutes: 10 })];

    // Only today is before the exam, and 20 minutes cannot hold 40 minutes of exam work.
    const first = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect((await planning._plan(first))[0]).toMatchObject({ examUrgent: true, estimatedExamMinutes: 40, availableExamMinutes: 20, needsConfirmation: true });
    const matricesCut = {
      exam, candidateKey: "matrices", omittedScope: "Practice matrices", minutes: 20,
      reason: "This activity does not fit before the exam within its dates and the available budget.",
      consequence: "No scheduled preparation for: Practice matrices",
    };
    expect(await planning._cuts(first)).toEqual([{ cut: matricesCut }]);
    expect(await planning._deferred(first)).toEqual([{ candidate: work[1]! }]);
    const before = await savedState();
    await refuses(planning.activateRoutine({ learner: "sam", plan: first.plan, currentBasis: "skills-v1" }), "EXAM_TRADEOFF_CONFIRMATION_REQUIRED");
    expect(await savedState()).toEqual(before);
    await planning.confirmTradeoffs({ learner: "sam", plan: first.plan, currentBasis: "skills-v1" });
    expect(rows(await planning._items(first))).toEqual([["2026-10-13", "vectors", "TODO"], ["2026-10-14", "determinants", "TODO"]]);

    // The learner already approved this cut, so the same proposal again activates routinely.
    const second = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect(await planning._cuts(second)).toEqual([{ cut: matricesCut }]);
    expect((await planning._plan(second))[0]!.needsConfirmation).toBe(false);
    await planning.activateRoutine({ learner: "sam", plan: second.plan, currentBasis: "skills-v1" });
    expect(rows(await planning._items(first))).toEqual([["2026-10-13", "vectors", "REPLACED"], ["2026-10-14", "determinants", "REPLACED"]]);

    // With no study time, the vectors work is cut too. The learner declines that proposal.
    await planning.configure({ ...sam, dailyMinutes: 0, focusNote: "" });
    const third = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect((await planning._plan(third))[0]).toMatchObject({ needsConfirmation: true, scheduledMinutes: 0 });
    await planning.declineTradeoffs({ learner: "sam", plan: third.plan });
    expect(statuses(await planning._plans(sam))).toEqual({ [first.plan]: "SUPERSEDED", [second.plan]: "ACTIVE", [third.plan]: "DECLINED" });
    expect(rows(await planning._items(second))).toEqual([["2026-10-13", "vectors", "TODO"], ["2026-10-14", "determinants", "TODO"]]);
  });

  test("removing an exam keeps its record and outdates proposals that used it; setting the date again restores it", async () => {
    const { planning } = setup();
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const { exam } = await planning.setExam({ ...sam, date: "2026-10-16", covered: ["vectors"] });
    const proposed = await planning.replan({ ...sam, candidates: [candidate("vectors", { latestDay: "2026-10-15", examRefs: [exam] })], ...proposal });
    expect(await planning.removeExam({ ...sam, date: "2026-10-16" })).toEqual({ exam });
    expect(await planning.removeExam({ ...sam, date: "2026-10-16" })).toEqual({ exam });
    expect(await planning._exams(sam)).toEqual([{ exam, date: "2026-10-16", covered: ["vectors"], active: false }]);

    const before = await savedState();
    await refuses(planning.activateRoutine({ learner: "sam", plan: proposed.plan, currentBasis: "skills-v1" }), "ROUTINE_PLAN_OUTDATED");
    // New work cannot prepare for the removed exam.
    await refuses(planning.replan({ ...sam, candidates: [candidate("vectors-2", { examRefs: [exam] })], ...proposal }), "INVALID_PLAN_INPUT");
    expect(await savedState()).toEqual(before);

    const replacement = await planning.replan({ ...sam, candidates: [candidate("vectors-review")], ...proposal });
    const [saved] = await planning._plan(replacement);
    expect(saved).toMatchObject({ examUrgent: false, estimatedExamMinutes: 0, availableExamMinutes: 0 });
    expect(saved).not.toHaveProperty("focusExam");
    expect(await planning.setExam({ ...sam, date: "2026-10-16", covered: ["vectors", "matrices"] })).toEqual({ exam });
    expect(await planning._exams(sam)).toEqual([{ exam, date: "2026-10-16", covered: ["vectors", "matrices"], active: true }]);
  });

  test("refuses invalid budgets, exam details, and plan inputs without changing saved plans", async () => {
    const { planning } = setup();
    // Leo has no preferences, so nothing is stored for him.
    await refuses(planning.setExam({ learner: "leo", scope: "linear-algebra", date: "2026-10-16", covered: ["vectors"] }), "EXAM_PREFERENCES_UNAVAILABLE");
    await refuses(planning.removeExam({ learner: "leo", scope: "linear-algebra", date: "2026-10-16" }), "EXAM_REMOVE_UNAVAILABLE");
    await refuses(planning.replan({ learner: "leo", scope: "linear-algebra", candidates: [candidate("vectors")], ...proposal }), "PLAN_PREFERENCES_UNAVAILABLE");
    expect(await savedState()).toEqual({});

    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const { exam } = await planning.setExam({ ...sam, date: "2026-10-16", covered: ["vectors"] });
    const vectors = candidate("vectors", { latestDay: "2026-10-15", examRefs: [exam] });
    await planning.replan({ ...sam, candidates: [vectors], ...proposal });
    const before = await savedState();

    for (const dailyMinutes of [-1, 1441, 12.5, Number.NaN]) {
      await refuses(planning.configure({ ...sam, dailyMinutes, focusNote: "" }), "INVALID_DAILY_BUDGET");
    }
    await refuses(planning.configure({ ...sam, dailyMinutes: 30, focusNote: 7 as unknown as string }), "INVALID_DAILY_BUDGET");
    const invalidExams: { date?: string; covered?: string[] }[] = [
      { date: "2026-10-12" }, { date: "2026-11-31" }, { date: "next week" }, { covered: [] }, { covered: ["matrices", "matrices"] }, { covered: [" "] },
    ];
    for (const invalid of invalidExams) {
      await refuses(planning.setExam({ ...sam, date: "2026-10-20", covered: ["matrices"], ...invalid }), "INVALID_EXAM_DETAILS");
    }
    await refuses(planning.removeExam({ ...sam, date: "2026-10-17" }), "EXAM_REMOVE_UNAVAILABLE");
    await refuses(planning.removeExam({ learner: "sam", scope: "physics", date: "2026-10-16" }), "EXAM_REMOVE_UNAVAILABLE");
    const invalidPlans: Partial<Parameters<StudyPlanning["replan"]>[0]>[] = [
      { candidates: [] },
      { candidates: [{ ...vectors, minutes: 30 }] },
      { candidates: [vectors, vectors] },
      { candidates: [vectors, candidate("matrices", { minutes: 0 })] },
      { candidates: [vectors, candidate("matrices", { earliestDay: "2026-10-18", latestDay: "2026-10-17" })] },
      { candidates: [vectors, candidate("matrices", { activity: " " })] },
      { candidates: [vectors, candidate("matrices", { examRefs: [randomUUID()] })] },
      { candidates: [vectors], horizonEnd: "2026-10-12" },
      { candidates: [vectors], horizonEnd: "2026-10-14" },
      { candidates: [vectors], basis: "" },
      { candidates: [vectors], explanation: " " },
    ];
    // In order: known exam work omitted, changed work under an existing key, a duplicate key, no duration, reversed dates,
    // blank activity, an unknown exam, a horizon before today, and a horizon that ends before the last study day.
    for (const invalid of invalidPlans) {
      await refuses(planning.replan({ ...sam, ...proposal, candidates: [vectors], ...invalid }), "INVALID_PLAN_INPUT");
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses activating, confirming, or declining a plan that is unavailable, outdated, blocked by an activity, or confirmed the wrong way", async () => {
    const { planning } = setup();
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const work = [candidate("vectors"), candidate("matrices", { minutes: 10 })];
    const active = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ learner: "sam", plan: active.plan, currentBasis: "skills-v1" });
    const declined = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.declineTradeoffs({ learner: "sam", plan: declined.plan });
    const proposed = await planning.replan({ ...sam, candidates: work, ...proposal });
    const current = { learner: "sam", plan: proposed.plan, currentBasis: "skills-v1" };
    const before = await savedState();

    // Only a proposed plan can be activated, confirmed, or declined, and only by its learner.
    for (const plan of [active.plan, declined.plan, randomUUID()]) {
      await refuses(planning.activateRoutine({ ...current, plan }), "ROUTINE_PLAN_UNAVAILABLE");
      await refuses(planning.confirmTradeoffs({ ...current, plan }), "TRADEOFF_PLAN_UNAVAILABLE");
      await refuses(planning.declineTradeoffs({ learner: "sam", plan }), "PLAN_DECLINE_UNAVAILABLE");
    }
    await refuses(planning.activateRoutine({ ...current, learner: "leo" }), "ROUTINE_PLAN_UNAVAILABLE");
    await refuses(planning.confirmTradeoffs({ ...current, learner: "leo" }), "TRADEOFF_PLAN_UNAVAILABLE");
    await refuses(planning.declineTradeoffs({ learner: "leo", plan: proposed.plan }), "PLAN_DECLINE_UNAVAILABLE");
    // The external planning context changed.
    await refuses(planning.activateRoutine({ ...current, currentBasis: "skills-v2" }), "ROUTINE_PLAN_OUTDATED");
    await refuses(planning.confirmTradeoffs({ ...current, currentBasis: "skills-v2" }), "TRADEOFF_PLAN_OUTDATED");
    // This plan has no exam cuts.
    await refuses(planning.confirmTradeoffs(current), "TRADEOFF_CONFIRMATION_NOT_NEEDED");
    expect(await savedState()).toEqual(before);

    // A changed budget makes the proposal locally outdated. Restoring the budget makes it current again.
    await planning.configure({ ...sam, dailyMinutes: 45, focusNote: "" });
    const changed = await savedState();
    await refuses(planning.activateRoutine(current), "ROUTINE_PLAN_OUTDATED");
    await refuses(planning.confirmTradeoffs(current), "TRADEOFF_PLAN_OUTDATED");
    expect(await savedState()).toEqual(changed);
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });

    // An activity in progress blocks plan changes.
    const [first] = await planning._items(active);
    await planning.begin({ learner: "sam", item: first!.item });
    const busy = await savedState();
    await refuses(planning.activateRoutine(current), "ROUTINE_SESSION_IN_PROGRESS");
    await refuses(planning.confirmTradeoffs(current), "TRADEOFF_SESSION_IN_PROGRESS");
    await refuses(planning.replan({ ...sam, candidates: work, ...proposal }), "PLAN_SESSION_IN_PROGRESS");
    expect(await savedState()).toEqual(busy);

    await planning.finish({ learner: "sam", item: first!.item, actualMinutes: 20 });
    expect((await planning._proposalCheck(current))[0]).toMatchObject({ locallyCurrent: false, sessionInProgress: false, canActivate: false });
  });

  test("one activity can be in progress across courses, and only the current activity can finish or stop", async () => {
    const { planning } = setup();
    const physics = { learner: "sam", scope: "physics" };
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    await planning.configure({ ...physics, dailyMinutes: 30, focusNote: "" });
    const mathPlan = await planning.replan({ ...sam, candidates: [candidate("vectors")], ...proposal });
    const physicsPlan = await planning.replan({ ...physics, candidates: [candidate("forces")], ...proposal });
    await planning.activateRoutine({ learner: "sam", plan: mathPlan.plan, currentBasis: "skills-v1" });
    await planning.activateRoutine({ learner: "sam", plan: physicsPlan.plan, currentBasis: "skills-v1" });
    const [vectors] = await planning._items(mathPlan);
    const [forces] = await planning._items(physicsPlan);
    await planning.begin({ learner: "sam", item: vectors!.item });
    const before = await savedState();

    await refuses(planning.begin({ learner: "sam", item: forces!.item }), "ANOTHER_ACTIVITY_IN_PROGRESS");
    await refuses(planning.begin({ learner: "sam", item: vectors!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.miss({ learner: "sam", item: vectors!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    await refuses(planning.finish({ learner: "sam", item: forces!.item, actualMinutes: 20 }), "ACTIVITY_FINISH_UNAVAILABLE");
    await refuses(planning.stop({ learner: "sam", item: forces!.item, actualMinutes: 5 }), "ACTIVITY_STOP_UNAVAILABLE");
    for (const actualMinutes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await refuses(planning.finish({ learner: "sam", item: vectors!.item, actualMinutes }), "INVALID_FINISH_TIME");
      await refuses(planning.stop({ learner: "sam", item: vectors!.item, actualMinutes }), "INVALID_STOP_TIME");
    }
    // Leo cannot act on Sam's activities.
    await refuses(planning.begin({ learner: "leo", item: forces!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.finish({ learner: "leo", item: vectors!.item, actualMinutes: 20 }), "ACTIVITY_FINISH_UNAVAILABLE");
    await refuses(planning.stop({ learner: "leo", item: vectors!.item, actualMinutes: 20 }), "ACTIVITY_STOP_UNAVAILABLE");
    await refuses(planning.miss({ learner: "leo", item: forces!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    expect(await savedState()).toEqual(before);
    expect((await planning._next(sam))[0]).toMatchObject({ item: vectors!.item, status: "IN_PROGRESS" });

    // Stopping with zero minutes records the stop, and the other course's activity can begin.
    await planning.stop({ learner: "sam", item: vectors!.item, actualMinutes: 0 });
    await planning.begin({ learner: "sam", item: forces!.item });
    expect((await planning._items(mathPlan))[0]).toMatchObject({ status: "STOPPED", actualMinutes: 0, spentOn: "2026-10-13" });
    expect((await planning._next(physics))[0]).toMatchObject({ item: forces!.item, status: "IN_PROGRESS" });
  });

  test("begin and miss refuse activities that are not today's, do not fit the remaining budget, or are not in the active plan", async () => {
    const { planning, setToday } = setup();
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const work = [candidate("vectors", { priority: 2 }), candidate("review", { minutes: 10 }), candidate("matrices")];
    const plan = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ learner: "sam", plan: plan.plan, currentBasis: "skills-v1" });
    const [vectors, review, matrices] = await planning._items(plan);
    expect(rows([vectors!, review!, matrices!])).toEqual([["2026-10-13", "vectors", "TODO"], ["2026-10-13", "review", "TODO"], ["2026-10-14", "matrices", "TODO"]]);
    await planning.begin({ learner: "sam", item: vectors!.item });
    await planning.finish({ learner: "sam", item: vectors!.item, actualMinutes: 25 });
    const proposed = await planning.replan({ ...sam, candidates: [work[1]!, work[2]!], ...proposal });
    const [proposedItem] = await planning._items(proposed);
    const before = await savedState();

    await refuses(planning.begin({ learner: "sam", item: review!.item }), "ACTIVITY_EXCEEDS_REMAINING_BUDGET");
    await refuses(planning.begin({ learner: "sam", item: matrices!.item }), "ACTIVITY_NOT_SCHEDULED_TODAY");
    await refuses(planning.miss({ learner: "sam", item: matrices!.item }), "ACTIVITY_MISS_TOO_EARLY");
    await refuses(planning.begin({ learner: "sam", item: vectors!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.miss({ learner: "sam", item: vectors!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    await refuses(planning.begin({ learner: "sam", item: proposedItem!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.miss({ learner: "sam", item: proposedItem!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    await refuses(planning.begin({ learner: "sam", item: randomUUID() }), "ACTIVITY_BEGIN_UNAVAILABLE");
    expect(await savedState()).toEqual(before);

    // The next day, yesterday's review is overdue and can be missed, and the matrices activity can begin.
    setToday("2026-10-14");
    await planning.miss({ learner: "sam", item: review!.item });
    await planning.begin({ learner: "sam", item: matrices!.item });
    expect(rows(await planning._items(plan))).toEqual([["2026-10-13", "vectors", "DONE"], ["2026-10-13", "review", "MISSED"], ["2026-10-14", "matrices", "IN_PROGRESS"]]);
  });
});
