import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Budgeting, type Candidate } from "../src/concepts/Budgeting/Budgeting.ts";
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
  DEADLINE_PREFERENCES_UNAVAILABLE: "Set a daily budget first.",
  INVALID_DEADLINE_DETAILS: "Choose today or a future date and at least one covered subject.",
  DEADLINE_REMOVE_UNAVAILABLE: "Choose a recorded deadline.",
  PLAN_PREFERENCES_UNAVAILABLE: "Set a daily budget first.",
  PLAN_SESSION_IN_PROGRESS: "Finish or stop the current activity before replacing the schedule.",
  INVALID_PLAN_INPUT: "Provide valid activities, planning dates, and all known unfinished work for the nearest deadline.",
  ROUTINE_PLAN_UNAVAILABLE: "Choose one of your proposed plans.",
  ROUTINE_SESSION_IN_PROGRESS: "Finish or stop the current activity before changing plans.",
  ROUTINE_PLAN_OUTDATED: "Create a new proposal from the current budget, dates, and progress.",
  DEADLINE_TRADEOFF_CONFIRMATION_REQUIRED: "Review and confirm the proposed cuts.",
  TRADEOFF_PLAN_UNAVAILABLE: "Choose one of your proposed plans.",
  TRADEOFF_SESSION_IN_PROGRESS: "Finish or stop the current activity before changing plans.",
  TRADEOFF_PLAN_OUTDATED: "Review a new proposal based on the current budget, dates, and progress.",
  TRADEOFF_CONFIRMATION_NOT_NEEDED: "This plan has no new cuts. Use routine activation.",
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

type ItemRow = Awaited<ReturnType<Budgeting["_items"]>>[number];
type PlanRow = Awaited<ReturnType<Budgeting["_plans"]>>[number];

const sam = { owner: "sam", scope: "linear-algebra" };
const proposal = { horizonEnd: "2026-10-19", explanation: "Prepare for the midterm first.", basis: "skills-v1", workloadComplete: true };

function setup() {
  let today = "2026-10-13";
  const planning = new Budgeting(connection!.db, "Budgeting", () => today);
  return { planning, setToday: (value: string) => { today = value; } };
}

function candidate(key: string, overrides: Partial<Candidate> = {}): Candidate {
  return {
    key, subject: key, definition: "v1", activity: `Practice ${key}`, minutes: 20, priority: 1,
    earliestDay: "2026-10-13", latestDay: "2026-10-19", reason: `A fresh check of ${key} is due.`, deadlineRefs: [], ...overrides,
  };
}

const rows = (items: ItemRow[]) => items.map(({ day, candidate: { key }, status }) => [day, key, status]);
const statuses = (plans: PlanRow[]) => Object.fromEntries(plans.map(({ plan, status }) => [plan, status]));

describe("Budgeting", () => {
  test("principle: a budget and deadline lead to an active plan; finished and missed work lead to a replacement that takes over", async () => {
    const { planning, setToday } = setup();
    const { preferences } = await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "Midterm first." });
    expect(await planning._preferences(sam)).toEqual([{ preferences, dailyMinutes: 30, focusNote: "Midterm first." }]);
    const { deadline } = await planning.setDeadline({ ...sam, date: "2026-10-16", covered: ["vectors", "matrices"] });
    expect(await planning._deadlines(sam)).toEqual([{ deadline, date: "2026-10-16", covered: ["vectors", "matrices"], active: true }]);
    const vectors = candidate("vectors", { priority: 3, latestDay: "2026-10-15", deadlineRefs: [deadline] });
    const matrices = candidate("matrices", { priority: 2, latestDay: "2026-10-15", deadlineRefs: [deadline] });
    const review = candidate("determinants", { minutes: 10 });

    // The 30-minute days before the deadline fit all 40 minutes of deadline work, so no cuts need confirmation.
    const first = await planning.replan({ ...sam, candidates: [review, matrices, vectors], ...proposal });
    expect((await planning._plan(first))[0]).toMatchObject({
      owner: "sam", scope: "linear-algebra", status: "PROPOSED", focusDeadline: deadline, urgent: false,
      requiredMinutes: 40, availableMinutes: 90, scheduledMinutes: 50, deferredMinutes: 0, needsConfirmation: false,
    });
    expect(rows(await planning._items(first))).toEqual([
      ["2026-10-13", "vectors", "TODO"], ["2026-10-13", "determinants", "TODO"], ["2026-10-14", "matrices", "TODO"],
    ]);
    await planning.activateRoutine({ owner: "sam", plan: first.plan, currentBasis: "skills-v1" });
    const [firstVectors, firstReview, firstMatrices] = await planning._items(first);
    expect(await planning._next(sam)).toEqual([{ item: firstVectors!.item, candidate: vectors, day: "2026-10-13", status: "TODO" }]);

    // The owner finishes the first activity with an overrun. The review no longer fits today, so it is missed.
    await planning.begin({ owner: "sam", item: firstVectors!.item });
    await planning.finish({ owner: "sam", item: firstVectors!.item, actualMinutes: 25 });
    expect(await planning._budget({ ...sam, day: "2026-10-13" })).toEqual([{ dailyMinutes: 30, spentMinutes: 25, remainingMinutes: 5 }]);
    await planning.miss({ owner: "sam", item: firstReview!.item });

    // The new proposal moves the unfinished work to tomorrow. The active plan stays in use until it is replaced.
    const second = await planning.replan({ ...sam, candidates: [matrices, review], ...proposal });
    expect(statuses(await planning._plans(sam))).toEqual({ [first.plan]: "ACTIVE", [second.plan]: "PROPOSED" });
    expect((await planning._next(sam))[0]!.item).toBe(firstMatrices!.item);
    expect(rows(await planning._items(second))).toEqual([["2026-10-14", "matrices", "TODO"], ["2026-10-14", "determinants", "TODO"]]);
    expect(await planning._proposalCheck({ owner: "sam", plan: second.plan, currentBasis: "skills-v1" })).toEqual([{
      locallyCurrent: true, contextCurrent: true, sessionInProgress: false, needsConfirmation: false, canActivate: true,
    }]);
    await planning.activateRoutine({ owner: "sam", plan: second.plan, currentBasis: "skills-v1" });
    expect(statuses(await planning._plans(sam))).toEqual({ [first.plan]: "SUPERSEDED", [second.plan]: "ACTIVE" });
    expect(rows(await planning._items(first))).toEqual([
      ["2026-10-13", "vectors", "DONE"], ["2026-10-13", "determinants", "MISSED"], ["2026-10-14", "matrices", "REPLACED"],
    ]);

    // The next day the owner stops one activity early and finishes another. Earlier time stays recorded.
    setToday("2026-10-14");
    const [secondMatrices, secondReview] = await planning._items(second);
    expect((await planning._next(sam))[0]!.item).toBe(secondMatrices!.item);
    await planning.begin({ owner: "sam", item: secondMatrices!.item });
    await planning.stop({ owner: "sam", item: secondMatrices!.item, actualMinutes: 12 });
    await planning.begin({ owner: "sam", item: secondReview!.item });
    await planning.finish({ owner: "sam", item: secondReview!.item, actualMinutes: 10 });
    expect(await planning._items(second)).toEqual([
      { ...secondMatrices!, status: "STOPPED", actualMinutes: 12, spentOn: "2026-10-14" },
      { ...secondReview!, status: "DONE", actualMinutes: 10, spentOn: "2026-10-14" },
    ]);
    expect(await planning._item({ item: secondReview!.item })).toEqual([{ owner: "sam", scope: "linear-algebra", ...secondReview!, status: "DONE", actualMinutes: 10, spentOn: "2026-10-14" }]);
    expect(await planning._budget({ ...sam, day: "2026-10-13" })).toEqual([{ dailyMinutes: 30, spentMinutes: 25, remainingMinutes: 5 }]);
    const { schedule } = await planning._schedule(sam);
    expect(schedule).toMatchObject({ today: "2026-10-14", budget: { dailyMinutes: 30, spentMinutes: 22, remainingMinutes: 8 }, next: null });
  });

  test("activating a replacement marks the old plan's overdue activities missed and its later activities replaced", async () => {
    const { planning, setToday } = setup();
    await planning.configure({ ...sam, dailyMinutes: 20, focusNote: "" });
    const work = [candidate("a"), candidate("b"), candidate("c")];
    const first = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ owner: "sam", plan: first.plan, currentBasis: "skills-v1" });
    const [overdue, current, later] = await planning._items(first);
    expect(rows([overdue!, current!, later!])).toEqual([["2026-10-13", "a", "TODO"], ["2026-10-14", "b", "TODO"], ["2026-10-15", "c", "TODO"]]);

    // The owner skips a day without recording anything, then accepts a new plan.
    setToday("2026-10-14");
    const second = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ owner: "sam", plan: second.plan, currentBasis: "skills-v1" });
    expect(await planning._items(first)).toEqual([
      { ...overdue!, status: "MISSED" }, { ...current!, status: "REPLACED" }, { ...later!, status: "REPLACED" },
    ]);
    expect(rows(await planning._items(second))).toEqual([["2026-10-14", "a", "TODO"], ["2026-10-15", "b", "TODO"], ["2026-10-16", "c", "TODO"]]);
    expect((await planning._budget({ ...sam, day: "2026-10-13" }))[0]!.spentMinutes).toBe(0);
  });

  test("new deadline cuts need confirmation, an approved cut later activates routinely, and a declined larger cut keeps the active plan", async () => {
    const { planning } = setup();
    await planning.configure({ ...sam, dailyMinutes: 20, focusNote: "" });
    const { deadline } = await planning.setDeadline({ ...sam, date: "2026-10-14", covered: ["vectors", "matrices"] });
    const work = [candidate("vectors", { priority: 2, deadlineRefs: [deadline] }), candidate("matrices", { deadlineRefs: [deadline] }), candidate("determinants", { minutes: 10 })];

    // Only today is before the deadline, and 20 minutes cannot hold 40 minutes of deadline work.
    const first = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect((await planning._plan(first))[0]).toMatchObject({ urgent: true, requiredMinutes: 40, availableMinutes: 20, needsConfirmation: true });
    const matricesCut = {
      deadline, candidateKey: "matrices", omittedScope: "Practice matrices", minutes: 20,
      reason: "This activity does not fit before the deadline within its dates and the available budget.",
      consequence: "No scheduled preparation for: Practice matrices",
    };
    expect(await planning._cuts(first)).toEqual([{ cut: matricesCut }]);
    expect(await planning._deferred(first)).toEqual([{ candidate: work[1]! }]);
    const before = await savedState();
    await refuses(planning.activateRoutine({ owner: "sam", plan: first.plan, currentBasis: "skills-v1" }), "DEADLINE_TRADEOFF_CONFIRMATION_REQUIRED");
    expect(await savedState()).toEqual(before);
    await planning.confirmTradeoffs({ owner: "sam", plan: first.plan, currentBasis: "skills-v1" });
    expect(rows(await planning._items(first))).toEqual([["2026-10-13", "vectors", "TODO"], ["2026-10-14", "determinants", "TODO"]]);

    // The owner already approved this cut, so the same proposal again activates routinely.
    const second = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect(await planning._cuts(second)).toEqual([{ cut: matricesCut }]);
    expect((await planning._plan(second))[0]!.needsConfirmation).toBe(false);
    await planning.activateRoutine({ owner: "sam", plan: second.plan, currentBasis: "skills-v1" });
    expect(rows(await planning._items(first))).toEqual([["2026-10-13", "vectors", "REPLACED"], ["2026-10-14", "determinants", "REPLACED"]]);

    // With no daily budget, the vectors work is cut too. The owner declines that proposal.
    await planning.configure({ ...sam, dailyMinutes: 0, focusNote: "" });
    const third = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect((await planning._plan(third))[0]).toMatchObject({ needsConfirmation: true, scheduledMinutes: 0 });
    await planning.declineTradeoffs({ owner: "sam", plan: third.plan });
    expect(statuses(await planning._plans(sam))).toEqual({ [first.plan]: "SUPERSEDED", [second.plan]: "ACTIVE", [third.plan]: "DECLINED" });
    expect(rows(await planning._items(second))).toEqual([["2026-10-13", "vectors", "TODO"], ["2026-10-14", "determinants", "TODO"]]);
  });

  test("after a decline, a new proposal with the same cuts is compared with the active plan's cuts, so its new cut still needs confirmation", async () => {
    const { planning } = setup();
    await planning.configure({ ...sam, dailyMinutes: 20, focusNote: "" });
    const { deadline } = await planning.setDeadline({ ...sam, date: "2026-10-14", covered: ["vectors", "matrices"] });
    const work = [candidate("vectors", { priority: 2, deadlineRefs: [deadline] }), candidate("matrices", { deadlineRefs: [deadline] })];
    const cut = (key: string) => ({ cut: {
      deadline, candidateKey: key, omittedScope: `Practice ${key}`, minutes: 20,
      reason: "This activity does not fit before the deadline within its dates and the available budget.",
      consequence: `No scheduled preparation for: Practice ${key}`,
    } });
    const confirmation = async ({ plan }: { plan: string }) => [
      (await planning._plan({ plan }))[0]!.needsConfirmation,
      (await planning._proposalCheck({ owner: "sam", plan, currentBasis: "skills-v1" }))[0]?.needsConfirmation,
    ];

    // The owner confirms leaving out matrices, so the active plan's cuts approve that cut.
    const active = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect(await planning._cuts(active)).toEqual([cut("matrices")]);
    await planning.confirmTradeoffs({ owner: "sam", plan: active.plan, currentBasis: "skills-v1" });

    // With no daily budget, vectors is cut too. The owner declines that proposal.
    await planning.configure({ ...sam, dailyMinutes: 0, focusNote: "" });
    const declined = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect(await confirmation(declined)).toEqual([true, true]);
    await planning.declineTradeoffs({ owner: "sam", plan: declined.plan });

    // The next proposal has the same cuts as the declined one. Declining approved nothing, and the active plan's cuts
    // hold only matrices, so the vectors cut still needs confirmation.
    const again = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect(await planning._cuts(again)).toEqual([cut("matrices"), cut("vectors")]);
    expect(await planning._cuts(again)).toEqual(await planning._cuts(declined));
    expect(await confirmation(again)).toEqual([true, true]);
    await refuses(planning.activateRoutine({ owner: "sam", plan: again.plan, currentBasis: "skills-v1" }), "DEADLINE_TRADEOFF_CONFIRMATION_REQUIRED");
    // Only a PROPOSED plan can need confirmation, so the active plan and the declined plan report false.
    expect(Object.fromEntries((await planning._plans(sam)).map(({ plan, status, needsConfirmation }) => [plan, [status, needsConfirmation]]))).toEqual({
      [active.plan]: ["ACTIVE", false], [declined.plan]: ["DECLINED", false], [again.plan]: ["PROPOSED", true],
    });

    // With the budget restored, only the matrices cut remains. The active plan's cuts approve it, so the proposal activates routinely.
    await planning.configure({ ...sam, dailyMinutes: 20, focusNote: "" });
    const routine = await planning.replan({ ...sam, candidates: work, ...proposal });
    expect(await planning._cuts(routine)).toEqual([cut("matrices")]);
    expect(await confirmation(routine)).toEqual([false, false]);
    await planning.activateRoutine({ owner: "sam", plan: routine.plan, currentBasis: "skills-v1" });
    expect(statuses(await planning._plans(sam))).toEqual({
      [active.plan]: "SUPERSEDED", [declined.plan]: "DECLINED", [again.plan]: "SUPERSEDED", [routine.plan]: "ACTIVE",
    });
  });

  test("removing a deadline keeps its record and outdates proposals that used it; setting the date again restores it", async () => {
    const { planning } = setup();
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const { deadline } = await planning.setDeadline({ ...sam, date: "2026-10-16", covered: ["vectors"] });
    const proposed = await planning.replan({ ...sam, candidates: [candidate("vectors", { latestDay: "2026-10-15", deadlineRefs: [deadline] })], ...proposal });
    expect(await planning.removeDeadline({ ...sam, date: "2026-10-16" })).toEqual({ deadline });
    expect(await planning.removeDeadline({ ...sam, date: "2026-10-16" })).toEqual({ deadline });
    expect(await planning._deadlines(sam)).toEqual([{ deadline, date: "2026-10-16", covered: ["vectors"], active: false }]);

    const before = await savedState();
    await refuses(planning.activateRoutine({ owner: "sam", plan: proposed.plan, currentBasis: "skills-v1" }), "ROUTINE_PLAN_OUTDATED");
    // New work cannot prepare for the removed deadline.
    await refuses(planning.replan({ ...sam, candidates: [candidate("vectors-2", { deadlineRefs: [deadline] })], ...proposal }), "INVALID_PLAN_INPUT");
    expect(await savedState()).toEqual(before);

    const replacement = await planning.replan({ ...sam, candidates: [candidate("vectors-review")], ...proposal });
    const [saved] = await planning._plan(replacement);
    expect(saved).toMatchObject({ urgent: false, requiredMinutes: 0, availableMinutes: 0 });
    expect(saved).not.toHaveProperty("focusDeadline");
    expect(await planning.setDeadline({ ...sam, date: "2026-10-16", covered: ["vectors", "matrices"] })).toEqual({ deadline });
    expect(await planning._deadlines(sam)).toEqual([{ deadline, date: "2026-10-16", covered: ["vectors", "matrices"], active: true }]);
  });

  test("the schedule lists the scope's active deadlines by date, leaving out removed deadlines and other scopes' and owners' deadlines", async () => {
    const { planning, setToday } = setup();
    const physics = { owner: "sam", scope: "physics" };
    const leo = { owner: "leo", scope: "linear-algebra" };
    // Without preferences, every part of the schedule is empty.
    expect(await planning._schedule(sam)).toEqual({ schedule: { preferences: null, budget: null, next: null, today: "2026-10-13", plans: [], deadlines: [] } });

    const { preferences } = await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "Midterm first." });
    await planning.configure({ ...physics, dailyMinutes: 30, focusNote: "" });
    await planning.configure({ ...leo, dailyMinutes: 30, focusNote: "" });
    expect((await planning._schedule(sam)).schedule.deadlines).toEqual([]);

    // The later deadline is set first, so the order comes from the dates.
    const { deadline: final } = await planning.setDeadline({ ...sam, date: "2026-10-20", covered: ["matrices"] });
    const { deadline: midterm } = await planning.setDeadline({ ...sam, date: "2026-10-16", covered: ["vectors", "matrices"] });
    const { deadline: physicsDeadline } = await planning.setDeadline({ ...physics, date: "2026-10-15", covered: ["forces"] });
    const { deadline: leoDeadline } = await planning.setDeadline({ ...leo, date: "2026-10-14", covered: ["vectors"] });
    expect((await planning._schedule(sam)).schedule.deadlines).toEqual([
      { deadline: midterm, date: "2026-10-16", covered: ["vectors", "matrices"] },
      { deadline: final, date: "2026-10-20", covered: ["matrices"] },
    ]);
    expect((await planning._schedule(physics)).schedule.deadlines).toEqual([{ deadline: physicsDeadline, date: "2026-10-15", covered: ["forces"] }]);
    expect((await planning._schedule(leo)).schedule.deadlines).toEqual([{ deadline: leoDeadline, date: "2026-10-14", covered: ["vectors"] }]);

    // The other parts of the schedule keep their shape and values.
    const work = [candidate("vectors", { priority: 2, latestDay: "2026-10-15", deadlineRefs: [midterm] }), candidate("determinants", { minutes: 10 })];
    const plan = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ owner: "sam", plan: plan.plan, currentBasis: "skills-v1" });
    const before = await savedState();
    const { schedule } = await planning._schedule(sam);
    expect(await savedState()).toEqual(before);
    expect(Object.keys(schedule).sort()).toEqual(["budget", "deadlines", "next", "plans", "preferences", "today"]);
    expect(schedule).toMatchObject({
      preferences: { preferences, dailyMinutes: 30, focusNote: "Midterm first." }, today: "2026-10-13",
      budget: (await planning._budget({ ...sam, day: "2026-10-13" }))[0]!, next: (await planning._next(sam))[0]!,
    });
    expect(schedule.plans.map(({ plan, status, horizonEnd, needsConfirmation }) => ({ plan, status, horizonEnd, needsConfirmation }))).toEqual(await planning._plans(sam));
    expect(schedule.plans[0]!.items.slice().sort((a, b) => a.item.localeCompare(b.item)))
      .toEqual((await planning._items(plan)).sort((a, b) => a.item.localeCompare(b.item)));
    // The plan's focus deadline is the first listed deadline.
    expect(schedule.plans[0]!.focusDeadline).toBe(schedule.deadlines[0]!.deadline);

    // Setting a date again replaces its covered subjects and keeps its identity.
    await planning.setDeadline({ ...sam, date: "2026-10-20", covered: ["determinants"] });
    expect((await planning._schedule(sam)).schedule.deadlines).toEqual([
      { deadline: midterm, date: "2026-10-16", covered: ["vectors", "matrices"] },
      { deadline: final, date: "2026-10-20", covered: ["determinants"] },
    ]);

    // A removed deadline leaves the schedule, though _deadlines still records it.
    await planning.removeDeadline({ ...sam, date: "2026-10-16" });
    expect((await planning._schedule(sam)).schedule.deadlines).toEqual([{ deadline: final, date: "2026-10-20", covered: ["determinants"] }]);
    expect((await planning._deadlines(sam)).map(({ deadline, active }) => [deadline, active])).toEqual([[midterm, false], [final, true]]);
    expect((await planning._schedule(physics)).schedule.deadlines).toEqual([{ deadline: physicsDeadline, date: "2026-10-15", covered: ["forces"] }]);

    // An active deadline stays listed after its date until it is removed.
    setToday("2026-10-21");
    expect((await planning._schedule(sam)).schedule.deadlines).toEqual([{ deadline: final, date: "2026-10-20", covered: ["determinants"] }]);
    await planning.removeDeadline({ ...sam, date: "2026-10-20" });
    expect((await planning._schedule(sam)).schedule.deadlines).toEqual([]);
  });

  test("refuses invalid budgets, deadline details, and plan inputs without changing saved plans", async () => {
    const { planning } = setup();
    // Leo has no preferences, so nothing is stored for him.
    await refuses(planning.setDeadline({ owner: "leo", scope: "linear-algebra", date: "2026-10-16", covered: ["vectors"] }), "DEADLINE_PREFERENCES_UNAVAILABLE");
    await refuses(planning.removeDeadline({ owner: "leo", scope: "linear-algebra", date: "2026-10-16" }), "DEADLINE_REMOVE_UNAVAILABLE");
    await refuses(planning.replan({ owner: "leo", scope: "linear-algebra", candidates: [candidate("vectors")], ...proposal }), "PLAN_PREFERENCES_UNAVAILABLE");
    expect(await savedState()).toEqual({});

    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const { deadline } = await planning.setDeadline({ ...sam, date: "2026-10-16", covered: ["vectors"] });
    const vectors = candidate("vectors", { latestDay: "2026-10-15", deadlineRefs: [deadline] });
    await planning.replan({ ...sam, candidates: [vectors], ...proposal });
    const before = await savedState();

    for (const dailyMinutes of [-1, 1441, 12.5, Number.NaN]) {
      await refuses(planning.configure({ ...sam, dailyMinutes, focusNote: "" }), "INVALID_DAILY_BUDGET");
    }
    await refuses(planning.configure({ ...sam, dailyMinutes: 30, focusNote: 7 as unknown as string }), "INVALID_DAILY_BUDGET");
    const invalidDeadlines: { date?: string; covered?: string[] }[] = [
      { date: "2026-10-12" }, { date: "2026-11-31" }, { date: "next week" }, { covered: [] }, { covered: ["matrices", "matrices"] }, { covered: [" "] },
    ];
    for (const invalid of invalidDeadlines) {
      await refuses(planning.setDeadline({ ...sam, date: "2026-10-20", covered: ["matrices"], ...invalid }), "INVALID_DEADLINE_DETAILS");
    }
    await refuses(planning.removeDeadline({ ...sam, date: "2026-10-17" }), "DEADLINE_REMOVE_UNAVAILABLE");
    await refuses(planning.removeDeadline({ owner: "sam", scope: "physics", date: "2026-10-16" }), "DEADLINE_REMOVE_UNAVAILABLE");
    const invalidPlans: Partial<Parameters<Budgeting["replan"]>[0]>[] = [
      { candidates: [] },
      { candidates: [{ ...vectors, minutes: 30 }] },
      { candidates: [vectors, vectors] },
      { candidates: [vectors, candidate("matrices", { minutes: 0 })] },
      { candidates: [vectors, candidate("matrices", { earliestDay: "2026-10-18", latestDay: "2026-10-17" })] },
      { candidates: [vectors, candidate("matrices", { activity: " " })] },
      { candidates: [vectors, candidate("matrices", { deadlineRefs: [randomUUID()] })] },
      { candidates: [vectors], horizonEnd: "2026-10-12" },
      { candidates: [vectors], horizonEnd: "2026-10-14" },
      { candidates: [vectors], basis: "" },
      { candidates: [vectors], explanation: " " },
    ];
    // In order: known deadline work omitted, changed work under an existing key, a duplicate key, no duration, reversed dates,
    // blank activity, an unknown deadline, a horizon before today, and a horizon that ends before the last day.
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
    await planning.activateRoutine({ owner: "sam", plan: active.plan, currentBasis: "skills-v1" });
    const declined = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.declineTradeoffs({ owner: "sam", plan: declined.plan });
    const proposed = await planning.replan({ ...sam, candidates: work, ...proposal });
    const current = { owner: "sam", plan: proposed.plan, currentBasis: "skills-v1" };
    const before = await savedState();

    // Only a proposed plan can be activated, confirmed, or declined, and only by its owner.
    for (const plan of [active.plan, declined.plan, randomUUID()]) {
      await refuses(planning.activateRoutine({ ...current, plan }), "ROUTINE_PLAN_UNAVAILABLE");
      await refuses(planning.confirmTradeoffs({ ...current, plan }), "TRADEOFF_PLAN_UNAVAILABLE");
      await refuses(planning.declineTradeoffs({ owner: "sam", plan }), "PLAN_DECLINE_UNAVAILABLE");
    }
    await refuses(planning.activateRoutine({ ...current, owner: "leo" }), "ROUTINE_PLAN_UNAVAILABLE");
    await refuses(planning.confirmTradeoffs({ ...current, owner: "leo" }), "TRADEOFF_PLAN_UNAVAILABLE");
    await refuses(planning.declineTradeoffs({ owner: "leo", plan: proposed.plan }), "PLAN_DECLINE_UNAVAILABLE");
    // The external planning context changed.
    await refuses(planning.activateRoutine({ ...current, currentBasis: "skills-v2" }), "ROUTINE_PLAN_OUTDATED");
    await refuses(planning.confirmTradeoffs({ ...current, currentBasis: "skills-v2" }), "TRADEOFF_PLAN_OUTDATED");
    // This plan has no cuts.
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
    await planning.begin({ owner: "sam", item: first!.item });
    const busy = await savedState();
    await refuses(planning.activateRoutine(current), "ROUTINE_SESSION_IN_PROGRESS");
    await refuses(planning.confirmTradeoffs(current), "TRADEOFF_SESSION_IN_PROGRESS");
    await refuses(planning.replan({ ...sam, candidates: work, ...proposal }), "PLAN_SESSION_IN_PROGRESS");
    expect(await savedState()).toEqual(busy);

    await planning.finish({ owner: "sam", item: first!.item, actualMinutes: 20 });
    expect((await planning._proposalCheck(current))[0]).toMatchObject({ locallyCurrent: false, sessionInProgress: false, canActivate: false });
  });

  test("one activity can be in progress across scopes, and only the current activity can finish or stop", async () => {
    const { planning } = setup();
    const physics = { owner: "sam", scope: "physics" };
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    await planning.configure({ ...physics, dailyMinutes: 30, focusNote: "" });
    const mathPlan = await planning.replan({ ...sam, candidates: [candidate("vectors")], ...proposal });
    const physicsPlan = await planning.replan({ ...physics, candidates: [candidate("forces")], ...proposal });
    await planning.activateRoutine({ owner: "sam", plan: mathPlan.plan, currentBasis: "skills-v1" });
    await planning.activateRoutine({ owner: "sam", plan: physicsPlan.plan, currentBasis: "skills-v1" });
    const [vectors] = await planning._items(mathPlan);
    const [forces] = await planning._items(physicsPlan);
    await planning.begin({ owner: "sam", item: vectors!.item });
    const before = await savedState();

    await refuses(planning.begin({ owner: "sam", item: forces!.item }), "ANOTHER_ACTIVITY_IN_PROGRESS");
    await refuses(planning.begin({ owner: "sam", item: vectors!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.miss({ owner: "sam", item: vectors!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    await refuses(planning.finish({ owner: "sam", item: forces!.item, actualMinutes: 20 }), "ACTIVITY_FINISH_UNAVAILABLE");
    await refuses(planning.stop({ owner: "sam", item: forces!.item, actualMinutes: 5 }), "ACTIVITY_STOP_UNAVAILABLE");
    for (const actualMinutes of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await refuses(planning.finish({ owner: "sam", item: vectors!.item, actualMinutes }), "INVALID_FINISH_TIME");
      await refuses(planning.stop({ owner: "sam", item: vectors!.item, actualMinutes }), "INVALID_STOP_TIME");
    }
    // Leo cannot act on Sam's activities.
    await refuses(planning.begin({ owner: "leo", item: forces!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.finish({ owner: "leo", item: vectors!.item, actualMinutes: 20 }), "ACTIVITY_FINISH_UNAVAILABLE");
    await refuses(planning.stop({ owner: "leo", item: vectors!.item, actualMinutes: 20 }), "ACTIVITY_STOP_UNAVAILABLE");
    await refuses(planning.miss({ owner: "leo", item: forces!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    expect(await savedState()).toEqual(before);
    expect((await planning._next(sam))[0]).toMatchObject({ item: vectors!.item, status: "IN_PROGRESS" });

    // Stopping with zero minutes records the stop, and the other scope's activity can begin.
    await planning.stop({ owner: "sam", item: vectors!.item, actualMinutes: 0 });
    await planning.begin({ owner: "sam", item: forces!.item });
    expect((await planning._items(mathPlan))[0]).toMatchObject({ status: "STOPPED", actualMinutes: 0, spentOn: "2026-10-13" });
    expect((await planning._next(physics))[0]).toMatchObject({ item: forces!.item, status: "IN_PROGRESS" });
  });

  test("begin and miss refuse activities that are not today's, do not fit the remaining budget, or are not in the active plan", async () => {
    const { planning, setToday } = setup();
    await planning.configure({ ...sam, dailyMinutes: 30, focusNote: "" });
    const work = [candidate("vectors", { priority: 2 }), candidate("review", { minutes: 10 }), candidate("matrices")];
    const plan = await planning.replan({ ...sam, candidates: work, ...proposal });
    await planning.activateRoutine({ owner: "sam", plan: plan.plan, currentBasis: "skills-v1" });
    const [vectors, review, matrices] = await planning._items(plan);
    expect(rows([vectors!, review!, matrices!])).toEqual([["2026-10-13", "vectors", "TODO"], ["2026-10-13", "review", "TODO"], ["2026-10-14", "matrices", "TODO"]]);
    await planning.begin({ owner: "sam", item: vectors!.item });
    await planning.finish({ owner: "sam", item: vectors!.item, actualMinutes: 25 });
    const proposed = await planning.replan({ ...sam, candidates: [work[1]!, work[2]!], ...proposal });
    const [proposedItem] = await planning._items(proposed);
    const before = await savedState();

    await refuses(planning.begin({ owner: "sam", item: review!.item }), "ACTIVITY_EXCEEDS_REMAINING_BUDGET");
    await refuses(planning.begin({ owner: "sam", item: matrices!.item }), "ACTIVITY_NOT_SCHEDULED_TODAY");
    await refuses(planning.miss({ owner: "sam", item: matrices!.item }), "ACTIVITY_MISS_TOO_EARLY");
    await refuses(planning.begin({ owner: "sam", item: vectors!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.miss({ owner: "sam", item: vectors!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    await refuses(planning.begin({ owner: "sam", item: proposedItem!.item }), "ACTIVITY_BEGIN_UNAVAILABLE");
    await refuses(planning.miss({ owner: "sam", item: proposedItem!.item }), "ACTIVITY_MISS_UNAVAILABLE");
    await refuses(planning.begin({ owner: "sam", item: randomUUID() }), "ACTIVITY_BEGIN_UNAVAILABLE");
    expect(await savedState()).toEqual(before);

    // The next day, yesterday's review is overdue and can be missed, and the matrices activity can begin.
    setToday("2026-10-14");
    await planning.miss({ owner: "sam", item: review!.item });
    await planning.begin({ owner: "sam", item: matrices!.item });
    expect(rows(await planning._items(plan))).toEqual([["2026-10-13", "vectors", "DONE"], ["2026-10-13", "review", "MISSED"], ["2026-10-14", "matrices", "IN_PROGRESS"]]);
  });
});
