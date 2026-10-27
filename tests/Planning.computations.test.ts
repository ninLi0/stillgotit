import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Budgeting, type Candidate, type CutValue } from "../src/concepts/Budgeting/Budgeting.ts";
import { beginAllowed, coveredSkillsConfirmed, cutKey, itemOrder, planRequest, urgentExamItem } from "../src/computations/learning.ts";
import type { Schedule, SkillRows, Tracks } from "../src/learning-data.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { DAY, daysBetween, gradeOf, review, seed } from "./fixtures/fsrs.ts";

// Planning rules in design/compositions/Planning.md, "Exam preparation in proposals", checked on plain values.
const TODAY = "2026-11-02";
const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
// Noon UTC keeps the same study date in New York.
const at = (day: string) => new Date(`${day}T16:00:00Z`);

type SkillRow = SkillRows[number];
type Track = Tracks[number];
type PlanValue = Schedule["plans"][number];
type ExamValue = Schedule["deadlines"][number];

function skill(id: string, overrides: Partial<SkillRow> = {}): SkillRow {
  return { skill: id, title: `Skill ${id}`, current: `${id}-v1`, status: "CONFIRMED", unit: "unit", course: "course",
    outcome: "An outcome", gate: "A gate", materials: ["material"], prerequisites: [], ...overrides };
}
// The study date planRequest gives an instant.
const studyDate = (instant: Date) => instant.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
/** The FSRS memory after replaying the fixture's informative inputs from a starting confidence of 40, with the tests' own formulas. */
function memoryOf(inputs: Track["inputs"], start: Date) {
  let memory = seed(40), reference = start;
  for (const input of inputs) {
    if (input.signal === "UNCERTAIN" || (!input.fresh && (input.signal === "INDEPENDENT" || input.signal === "SUPPORTED"))) continue;
    memory = review(memory, gradeOf(input.signal), daysBetween(input.performedAt, reference));
    reference = input.performedAt;
  }
  return { stability: memory.stability, due: new Date(reference.getTime() + memory.stability * DAY) };
}
function track(row: SkillRow, inputs: Track["inputs"] = [], estimate: { value: number; basis: string; ready: boolean } = { value: 40, basis: "Provisional", ready: false },
  start = at(addDays(TODAY, -30))): Track {
  return { track: `track-${row.skill}`, subject: row.skill, definition: row.current, initialConfidence: 40, startingBasis: "SELF_REPORTED",
    initializedAt: start, inputs, estimate: { ...estimate, ...memoryOf(inputs, start) }, adjustments: [] };
}
function independent(evidence: string, day: string, revision = 1): Track["inputs"][number] {
  return { input: `input-${evidence}`, evidence, revision, performedAt: at(day), signal: "INDEPENDENT", fresh: true, gateMet: true, attribution: "AI assessment" };
}
function schedule({ today = TODAY, exams = [], plans = [] }: { today?: string; exams?: ExamValue[]; plans?: PlanValue[] } = {}): Schedule {
  return { preferences: { preferences: "preferences", dailyMinutes: 30, focusNote: "" }, budget: null, next: null, today, plans, deadlines: exams };
}
function plan(status: PlanValue["status"], items: [Candidate, PlanValue["items"][number]["status"]][], deferred: Candidate[] = [], extra: Partial<PlanValue> = {}): PlanValue {
  return {
    plan: randomUUID(), status, basis: "basis", inputs: { today: TODAY, dailyMinutes: 30, focusNote: "", deadlines: [], work: [] }, horizonEnd: addDays(TODAY, 6),
    explanation: "Saved", urgent: false, workloadComplete: false, requiredMinutes: 0, availableMinutes: 0, deferred, cuts: [], needsConfirmation: false,
    items: items.map(([candidate, itemStatus]) => ({ item: randomUUID(), candidate, day: candidate.earliestDay, status: itemStatus, actualMinutes: 0 })),
    ...extra,
  };
}
const exam = (id: string, date: string, covered: string[]): ExamValue => ({ deadline: id, date, covered });
const keyed = (candidates: Candidate[]) => Object.fromEntries(candidates.map((candidate) => [candidate.subject, candidate]));
// The key prefix planRequest uses for a skill's current version and latest evidence.
const prefix = (row: SkillRow, evidence = "initial", revision = 0) => `${row.skill}:${row.current}:${evidence}:${revision}:`;

describe("planRequest", () => {
  test("without an active exam dated today or later, reviews stay routine within seven days", () => {
    const a = skill("a"), draft = skill("draft", { status: "DRAFT" });
    const result = planRequest({ skills: [a, draft], tracks: [], schedule: schedule({ exams: [exam("past", addDays(TODAY, -1), ["a"])] }) });
    expect(result.horizonEnd).toBe(addDays(TODAY, 6));
    expect(result.candidates).toEqual([{ key: `${prefix(a)}${TODAY}`, subject: "a", definition: "a-v1", activity: "Set confidence and try Skill a", minutes: 10,
      priority: 100, earliestDay: TODAY, latestDay: addDays(TODAY, 6), reason: "This skill needs fresh independent evidence.", deadlineRefs: [] }]);
    expect(result.explanation).not.toContain("exam");
  });

  test("the focus exam's covered skills and their prerequisites become exam work that ends the day before the exam", () => {
    // b is covered; a is its prerequisite and lists b back, which the visited set tolerates. c is unrelated.
    // d is covered but still a draft, so it produces no activity. e is covered only by a later exam.
    const a = skill("a", { prerequisites: ["b"] }), b = skill("b", { prerequisites: ["a"] }), c = skill("c"), d = skill("d", { status: "DRAFT" }), e = skill("e");
    const examDay = addDays(TODAY, 10), laterDay = addDays(TODAY, 20);
    const result = planRequest({ skills: [a, b, c, d, e], tracks: [track(b)],
      schedule: schedule({ exams: [exam("midterm", examDay, ["b", "d"]), exam("final", laterDay, ["e"])] }) });
    const bySkill = keyed(result.candidates);
    expect(Object.keys(bySkill).sort()).toEqual(["a", "b", "c", "e"]);
    expect(result.horizonEnd).toBe(addDays(examDay, -1));
    expect(bySkill.b).toEqual({ key: `${prefix(b)}${TODAY}:exam:midterm`, subject: "b", definition: "b-v1", activity: "Fresh check: Skill b", minutes: 10,
      priority: 1060, earliestDay: TODAY, latestDay: addDays(examDay, -1), reason: `Preparation for the exam on ${examDay}. This skill needs fresh independent evidence.`, deadlineRefs: ["midterm"] });
    expect(bySkill.a).toMatchObject({ key: `${prefix(a)}${TODAY}:exam:midterm`, priority: 1100, latestDay: addDays(examDay, -1), deadlineRefs: ["midterm"] });
    // Unrelated work and work for an exam that is not the focus exam stay routine over the longer horizon.
    expect(bySkill.c).toMatchObject({ key: `${prefix(c)}${TODAY}`, priority: 100, latestDay: addDays(examDay, -1), deadlineRefs: [] });
    expect(bySkill.e).toMatchObject({ key: `${prefix(e)}${TODAY}`, deadlineRefs: [] });
    expect(result.explanation).toEndWith(`Preparation for the exam on ${examDay} comes first.`);
  });

  test("a review that falls on or after the exam date stays routine maintenance", () => {
    // An independent success a day after the start is due once its stability in days has passed, which is after tomorrow's exam.
    const a = skill("a"), examDay = addDays(TODAY, 1);
    const inputs = [independent("first", addDays(TODAY, -1))];
    const memory = review(seed(40), 3, 1), dueDay = studyDate(new Date(at(addDays(TODAY, -1)).getTime() + memory.stability * DAY));
    expect(dueDay > examDay && dueDay <= addDays(TODAY, 6)).toBe(true);
    const result = planRequest({ skills: [a], tracks: [track(a, inputs, { value: 95, basis: "Ready", ready: true }, at(addDays(TODAY, -2)))], schedule: schedule({ exams: [exam("quiz", examDay, ["a"])] }) });
    expect(result.horizonEnd).toBe(addDays(TODAY, 6));
    expect(result.candidates).toEqual([expect.objectContaining({ key: `${prefix(a, "first", 1)}${dueDay}`, earliestDay: dueDay, deadlineRefs: [],
      reason: "A later fresh check will test retention." })]);
  });

  test("unfinished work for the focus exam is carried once per key with its exact content, whatever the plan's status", () => {
    const a = skill("a"), b = skill("b"), examDay = addDays(TODAY, 5);
    const examWork = (row: SkillRow, definition = row.current, day = addDays(TODAY, -2), examId = "midterm"): Candidate => ({
      key: `${row.skill}:${definition}:initial:0:${day}:exam:${examId}`, subject: row.skill, definition, activity: `Old ${row.skill}`, minutes: 25, priority: 1003,
      earliestDay: day, latestDay: addDays(examDay, -1), reason: "Saved earlier", deadlineRefs: [examId] });
    const missed = examWork(a), deferred = examWork(b), finished = examWork(a, "a-v0", addDays(TODAY, -4)), otherExam = examWork(b, "b-v1", addDays(TODAY, -3), "final");
    const plans = [
      plan("SUPERSEDED", [[missed, "MISSED"], [finished, "DONE"]], [deferred]),
      plan("DECLINED", [[missed, "REPLACED"]], [deferred, otherExam]),
    ];
    const result = planRequest({ skills: [a, b], tracks: [], schedule: schedule({ exams: [exam("midterm", examDay, ["a", "b"]), exam("final", addDays(TODAY, 9), ["b"])], plans }) });
    // The unfinished activities stand for both skills, so there is no new exam work and no separate routine review.
    expect(result.candidates).toEqual([missed, deferred]);
  });

  test("earlier exam work covers a skill only for its current version, and finished work only for the latest evidence", () => {
    const a = skill("a", { current: "a-v2" }), b = skill("b"), c = skill("c"), examDay = addDays(TODAY, 5);
    const work = (key: string, row: SkillRow, definition: string): Candidate => ({ key, subject: row.skill, definition, activity: "Saved", minutes: 10, priority: 1050,
      earliestDay: addDays(TODAY, -3), latestDay: addDays(examDay, -1), reason: "Saved", deadlineRefs: ["midterm"] });
    const oldVersion = work(`a:a-v1:initial:0:${addDays(TODAY, -3)}:exam:midterm`, a, "a-v1");
    const finishedLatest = work(`${prefix(b)}${addDays(TODAY, -3)}:exam:midterm`, b, "b-v1");
    const finishedOlder = work(`c:c-v1:old-case:1:${addDays(TODAY, -6)}:exam:midterm`, c, "c-v1");
    const plans = [plan("ACTIVE", [[oldVersion, "STOPPED"], [finishedLatest, "DONE"], [finishedOlder, "DONE"]])];
    const tracks = [track(c, [independent("new-case", addDays(TODAY, -2))], undefined, at(addDays(TODAY, -3)))];
    // c's latest evidence is newer than its finished exam activity, and that success is due before the exam.
    const dueDay = studyDate(new Date(at(addDays(TODAY, -2)).getTime() + review(seed(40), 3, 1).stability * DAY));
    expect(dueDay > TODAY && dueDay < examDay).toBe(true);
    const result = planRequest({ skills: [a, b, c], tracks, schedule: schedule({ exams: [exam("midterm", examDay, ["a", "b", "c"])], plans }) });
    const keys = result.candidates.map((candidate) => candidate.key);
    expect(keys).toEqual([oldVersion.key, `${prefix(a)}${TODAY}:exam:midterm`, `${prefix(c, "new-case", 1)}${dueDay}:exam:midterm`]);
  });

  test("on the exam day no new exam work is made, carried work stays, and reviews are routine", () => {
    const a = skill("a"), b = skill("b");
    const carried: Candidate = { key: `${prefix(a)}${addDays(TODAY, -2)}:exam:quiz`, subject: "a", definition: "a-v1", activity: "Saved", minutes: 10, priority: 1100,
      earliestDay: addDays(TODAY, -2), latestDay: addDays(TODAY, -1), reason: "Saved", deadlineRefs: ["quiz"] };
    const result = planRequest({ skills: [a, b], tracks: [], schedule: schedule({ exams: [exam("quiz", TODAY, ["a", "b"])], plans: [plan("ACTIVE", [[carried, "TODO"]])] }) });
    expect(result.horizonEnd).toBe(addDays(TODAY, 6));
    expect(result.candidates).toEqual([carried,
      expect.objectContaining({ key: `${prefix(a)}${TODAY}`, deadlineRefs: [] }), expect.objectContaining({ key: `${prefix(b)}${TODAY}`, deadlineRefs: [] })]);
  });

  test("routine key reuse skips earlier exam work, and a reused key repeats its saved content", () => {
    const a = skill("a"), b = skill("b");
    // Work for a removed exam shares a's routine prefix but must not lend its key or content to a routine review.
    const removedExamWork: Candidate = { key: `${prefix(a)}${addDays(TODAY, -1)}:exam:removed`, subject: "a", definition: "a-v1", activity: "Exam work", minutes: 10,
      priority: 1100, earliestDay: addDays(TODAY, -1), latestDay: addDays(TODAY, 3), reason: "Saved", deadlineRefs: ["removed"] };
    const routine: Candidate = { key: `${prefix(b)}${addDays(TODAY, -1)}`, subject: "b", definition: "b-v1", activity: "Saved review", minutes: 10, priority: 7,
      earliestDay: addDays(TODAY, -1), latestDay: addDays(TODAY, 2), reason: "Saved", deadlineRefs: [] };
    const result = planRequest({ skills: [a, b], tracks: [], schedule: schedule({ plans: [plan("ACTIVE", [[removedExamWork, "TODO"], [routine, "TODO"]])] }) });
    expect(result.candidates).toEqual([expect.objectContaining({ key: `${prefix(a)}${TODAY}`, deadlineRefs: [] }), routine]);
  });

  test("the fingerprint covers prerequisites but not exam records", () => {
    const a = skill("a"), b = skill("b");
    const base = planRequest({ skills: [a, b], tracks: [], schedule: schedule() }).basis;
    expect(planRequest({ skills: [a, b], tracks: [], schedule: schedule({ exams: [exam("quiz", addDays(TODAY, 3), ["a"])] }) }).basis).toBe(base);
    expect(planRequest({ skills: [a, { ...b, prerequisites: ["a"] }], tracks: [], schedule: schedule() }).basis).not.toBe(base);
  });
});

describe("exam checks", () => {
  test("covered skills must be distinct confirmed skills of the course map; an empty list is left to the planning concept", () => {
    const skills = [skill("a"), skill("b"), skill("draft", { status: "DRAFT" }), skill("archived", { status: "ARCHIVED" })];
    expect(coveredSkillsConfirmed({ covered: ["a", "b"], skills })).toBe(true);
    expect(coveredSkillsConfirmed({ covered: [], skills })).toBe(true);
    expect(coveredSkillsConfirmed({ covered: ["a", "a"], skills })).toBe(false);
    expect(coveredSkillsConfirmed({ covered: ["a", "draft"], skills })).toBe(false);
    expect(coveredSkillsConfirmed({ covered: ["archived"], skills })).toBe(false);
    expect(coveredSkillsConfirmed({ covered: ["other-course"], skills })).toBe(false);
  });

  test("urgency applies only to work for the focus exam of an exam-urgent ACTIVE plan while that exam is active", () => {
    const work = (deadlineRefs: string[]): Candidate => ({ key: "k", subject: "a", definition: "a-v1", activity: "Work", minutes: 10, priority: 1, earliestDay: TODAY, latestDay: TODAY, reason: "r", deadlineRefs });
    const urgent = plan("ACTIVE", [], [], { urgent: true, focusDeadline: "midterm" });
    const exams = [exam("midterm", addDays(TODAY, 1), ["a"])];
    expect(urgentExamItem({ schedule: schedule({ exams, plans: [urgent] }), candidate: work(["midterm"]) })).toBe(true);
    expect(urgentExamItem({ schedule: schedule({ exams, plans: [urgent] }), candidate: work([]) })).toBe(false);
    expect(urgentExamItem({ schedule: schedule({ exams, plans: [urgent] }), candidate: work(["final"]) })).toBe(false);
    // The focus exam was removed, the plan is not urgent, or the urgent plan is only proposed.
    expect(urgentExamItem({ schedule: schedule({ exams: [], plans: [urgent] }), candidate: work(["midterm"]) })).toBe(false);
    expect(urgentExamItem({ schedule: schedule({ exams, plans: [{ ...urgent, urgent: false }] }), candidate: work(["midterm"]) })).toBe(false);
    expect(urgentExamItem({ schedule: schedule({ exams, plans: [{ ...urgent, status: "PROPOSED" }] }), candidate: work(["midterm"]) })).toBe(false);
    expect(urgentExamItem({ schedule: schedule({ exams }), candidate: work(["midterm"]) })).toBe(false);
  });

  test("urgent exam work skips the prerequisite check; other work keeps it", () => {
    const base = skill("base"), next = skill("next", { prerequisites: ["base"] });
    expect(beginAllowed({ skills: [base, next], tracks: [], skill: "next", urgent: false })).toBe(false);
    expect(beginAllowed({ skills: [base, next], tracks: [], skill: "next", urgent: true })).toBe(true);
    const ready = track(base, [independent("case", TODAY)], { value: 95, basis: "Ready", ready: true });
    expect(beginAllowed({ skills: [base, next], tracks: [ready], skill: "next", urgent: false })).toBe(true);
  });
});

describe("sort keys", () => {
  // The concept's orders: _items by day, decreasing priority, then key; _cuts by exam, then candidate key.
  const byItems = (a: { day: string; candidate: Candidate }, b: { day: string; candidate: Candidate }) =>
    a.day.localeCompare(b.day) || b.candidate.priority - a.candidate.priority || (a.candidate.key < b.candidate.key ? -1 : a.candidate.key > b.candidate.key ? 1 : 0);
  const byCuts = (a: CutValue, b: CutValue) => a.deadline.localeCompare(b.deadline) || a.candidateKey.localeCompare(b.candidateKey);
  const sortedBy = <T>(rows: T[], key: (row: T) => string) => [...rows].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));

  test("itemOrder sorts like StudyPlanning._items, including negative, fractional, zero, and large priorities", () => {
    const priorities = [1100, 1060.5, 100, 99.999, 1, 0, -0, -0.25, -3, -1e9, 1e12, Number.MIN_VALUE, -Number.MIN_VALUE];
    const keys = ["a", "a:1", "a:10", "a1", "A", "b-2", "b:2", "zz", "a:1:exam:x"];
    const days = [TODAY, addDays(TODAY, 1), addDays(TODAY, 12)];
    const rows = days.flatMap((day) => priorities.flatMap((priority) => keys.map((key) => ({ day, candidate: { key, priority } as Candidate }))));
    const expected = [...rows].sort(byItems);
    const actual = sortedBy(rows, (row) => itemOrder(row));
    expect(actual.map(({ day, candidate }) => [day, candidate.priority, candidate.key])).toEqual(expected.map(({ day, candidate }) => [day, candidate.priority, candidate.key]));
  });

  test("cutKey sorts like StudyPlanning._cuts for the keys planRequest makes", () => {
    const exams = [randomUUID(), randomUUID()];
    const cuts = exams.flatMap((examId) => Array.from({ length: 12 }, (_, index): CutValue => ({
      deadline: examId, candidateKey: `${randomUUID()}:${randomUUID()}:${index % 3 ? randomUUID() : "initial"}:${index % 3}:${addDays(TODAY, index)}:exam:${examId}`,
      omittedScope: "Work", minutes: 10, reason: "r", consequence: "c" })));
    expect(sortedBy(cuts, (cut) => cutKey({ cut }))).toEqual([...cuts].sort(byCuts));
  });
});

// The planning concept refuses a proposal that changes a key's content, names an inactive or past exam, or leaves out
// unfinished focus-exam work. These sequences check that planRequest's proposals are always accepted.
describe("planRequest proposals accepted by StudyPlanning", () => {
  const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
  let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;
  beforeAll(async () => { connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database }); });
  beforeEach(async () => { await connection!.db.dropDatabase(); });
  afterAll(async () => {
    if (!connection) return;
    try { await connection.db.dropDatabase(); } finally { await connection.client.close(); }
  });

  test("across exam changes, finished work, a revised skill, an earlier exam, and the exam day", async () => {
    let today = TODAY;
    const planning = new Budgeting(connection!.db, "StudyPlanning", () => today), who = { owner: "learner", scope: "course" };
    let skills = [skill("a"), skill("b", { prerequisites: ["a"] }), skill("c")];
    async function propose() {
      const { schedule: saved } = await planning._schedule(who);
      const request = planRequest({ skills, tracks: [], schedule: saved });
      const { plan: proposed } = await planning.replan({ ...who, ...request, workloadComplete: false });
      const [check] = await planning._proposalCheck({ owner: "learner", plan: proposed, currentBasis: request.basis });
      if (check!.needsConfirmation) await planning.confirmTradeoffs({ owner: "learner", plan: proposed, currentBasis: request.basis });
      else await planning.activateRoutine({ owner: "learner", plan: proposed, currentBasis: request.basis });
      return { plan: proposed, request, items: await planning._items({ plan: proposed }), cuts: await planning._cuts({ plan: proposed }) };
    }
    await planning.configure({ ...who, dailyMinutes: 10, focusNote: "" });
    const { deadline: final } = await planning.setDeadline({ ...who, date: addDays(TODAY, 4), covered: ["b"] });
    let current = await propose();
    expect(current.request.candidates.filter((candidate) => candidate.deadlineRefs.includes(final)).map((candidate) => candidate.subject).sort()).toEqual(["a", "b"]);

    // Finish today's first activity, then change the covered skills and revise a's requirements.
    const first = current.items.find((item) => item.day === today)!;
    await planning.begin({ owner: "learner", item: first.item });
    await planning.finish({ owner: "learner", item: first.item, actualMinutes: 10 });
    await planning.setDeadline({ ...who, date: addDays(TODAY, 4), covered: ["b", "c"] });
    skills = skills.map((row) => row.skill === "a" ? { ...row, current: "a-v2" } : row);
    current = await propose();

    // An earlier exam becomes the focus exam; the later exam's work waits and comes back when the earlier one is removed.
    today = addDays(TODAY, 1);
    const { deadline: quiz } = await planning.setDeadline({ ...who, date: addDays(TODAY, 2), covered: ["c"] });
    current = await propose();
    expect(current.request.candidates.every((candidate) => candidate.deadlineRefs.every((id) => id === quiz))).toBe(true);
    await planning.removeDeadline({ ...who, date: addDays(TODAY, 2) });
    current = await propose();
    expect(current.request.candidates.some((candidate) => candidate.deadlineRefs.includes(final))).toBe(true);

    // On the exam day, unfinished preparation can no longer be scheduled and becomes cuts.
    today = addDays(TODAY, 4);
    current = await propose();
    expect(current.cuts.length).toBeGreaterThan(0);
    expect(current.cuts.every(({ cut }) => cut.deadline === final)).toBe(true);
    expect(current.items.every((item) => item.candidate.deadlineRefs.length === 0)).toBe(true);

    // After the exam, its work is never proposed again.
    today = addDays(TODAY, 5);
    current = await propose();
    expect(current.request.candidates.every((candidate) => candidate.deadlineRefs.length === 0)).toBe(true);
    await planning.removeDeadline({ ...who, date: addDays(TODAY, 4) });
    current = await propose();
    expect(current.request.candidates.every((candidate) => candidate.deadlineRefs.length === 0)).toBe(true);
  });
});
