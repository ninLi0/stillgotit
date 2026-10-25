import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Budgeting, type Candidate } from "../src/concepts/Budgeting/Budgeting.ts";
import { upgradeEarlierDocuments } from "../src/concepts/Budgeting/upgrade.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// Documents saved before StudyPlanning became an instance of Budgeting (src/concepts/Budgeting/upgrade.ts).
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;
beforeAll(async () => { connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database }); });
afterAll(async () => {
  if (!connection) return;
  try { await connection.db.dropDatabase(); }
  finally { await connection.client.close(); }
});

const TODAY = "2026-10-13", scope = "linear-algebra";
const earlier = (key: string, priority: number) => ({
  key, subject: key, definition: "v1", activity: `Practice ${key}`, minutes: 20, priority,
  earliestDay: TODAY, latestDay: "2026-10-19", reason: `A fresh check of ${key} is due.`, examRefs: ["midterm"],
});
const current = ({ examRefs, ...rest }: ReturnType<typeof earlier>): Candidate => ({ ...rest, deadlineRefs: examRefs });
const midterm = { exam: "midterm", date: "2026-10-14", covered: ["vectors", "matrices"], active: true };
const earlierCut = { exam: "midterm", candidateKey: "matrices", omittedScope: "Practice matrices", minutes: 20,
  reason: "This activity does not fit before the exam within its dates and the available budget.", consequence: "No scheduled preparation for: Practice matrices" };
// A plan as the earlier code saved it on TODAY: twenty minutes fit only vectors before tomorrow's exam, so matrices was cut.
const earlierPlan = (plan: string, status: string, item: string, needsConfirmation: boolean) => ({
  plan, status, basis: "skills-v1", inputs: { today: TODAY, dailyMinutes: 20, focusNote: "", exams: [midterm], work: [] }, horizonEnd: "2026-10-19",
  explanation: "Prepare for the midterm first.", focusExam: "midterm", examUrgent: true, workloadComplete: true, estimatedExamMinutes: 40, availableExamMinutes: 20,
  deferred: [earlier("matrices", 1)], examCuts: [earlierCut], needsConfirmation,
  items: [{ item, candidate: earlier("vectors", 2), day: TODAY, status: "TODO", actualMinutes: 0 }],
});
const earlierDocument = { _id: "sam", revision: 5, preferences: [{
  preferences: "sam-preferences", scope, dailyMinutes: 20, focusNote: "", approvedExamCuts: [earlierCut], exams: [midterm],
  plans: [earlierPlan("active-plan", "ACTIVE", "active-item", true), earlierPlan("proposed-plan", "PROPOSED", "proposed-item", false)],
}] };

// The instance's collection, read raw only to show what the upgrade wrote.
interface Saved extends Document { _id: string }
const learners = () => connection!.db.collection<Saved>("studyplanning.learners");
const stored = async () => await learners().find().sort({ _id: 1 }).toArray();
const earlierNames = /"(exams|exam|examRefs|approvedExamCuts|examCuts|focusExam|examUrgent|estimatedExamMinutes|availableExamMinutes|needsConfirmation)"/;

test("an earlier document is rewritten once in the current shape, and the instance reads and changes it as before", async () => {
  const db = connection!.db, planning = new Budgeting(db, "StudyPlanning", () => TODAY);
  await learners().insertOne(structuredClone(earlierDocument));
  // Leo's document is already in the current shape, so the upgrade leaves it alone.
  await planning.configure({ owner: "leo", scope, dailyMinutes: 30, focusNote: "" });
  await planning.setDeadline({ owner: "leo", scope, date: "2026-10-20", covered: ["vectors"] });
  const leo = (await stored()).find((document) => document._id === "leo");

  expect(await upgradeEarlierDocuments(db, "StudyPlanning")).toBe(1);
  const [sam, leoAfter] = await stored().then((documents) => ["sam", "leo"].map((id) => documents.find((document) => document._id === id)!));
  expect(JSON.stringify(sam)).not.toMatch(earlierNames);
  expect(sam!.revision).toBe(6);
  expect(leoAfter).toEqual(leo!);

  // The same deadline, items, and deferred work, under the current names.
  expect(await planning._deadlines({ owner: "sam", scope })).toEqual([{ deadline: "midterm", date: "2026-10-14", covered: ["vectors", "matrices"], active: true }]);
  expect((await planning._items({ plan: "active-plan" })).map(({ candidate }) => candidate)).toEqual([current(earlier("vectors", 2))]);
  expect(await planning._deferred({ plan: "active-plan" })).toEqual([{ candidate: current(earlier("matrices", 1)) }]);
  // The totals and cuts are computed from the rewritten inputs and candidates, as for any plan.
  expect((await planning._plan({ plan: "active-plan" }))[0]).toMatchObject({
    owner: "sam", scope, status: "ACTIVE", focusDeadline: "midterm", urgent: true, requiredMinutes: 40, availableMinutes: 20, needsConfirmation: false,
  });
  expect(await planning._cuts({ plan: "proposed-plan" })).toEqual([{ cut: {
    deadline: "midterm", candidateKey: "matrices", omittedScope: "Practice matrices", minutes: 20,
    reason: "This activity does not fit before the deadline within its dates and the available budget.", consequence: "No scheduled preparation for: Practice matrices",
  } }]);
  // The proposal's saved inputs still match the current records, and the active plan already approves its cut.
  expect(await planning._proposalCheck({ owner: "sam", plan: "proposed-plan", currentBasis: "skills-v1" })).toEqual([{
    locallyCurrent: true, contextCurrent: true, sessionInProgress: false, needsConfirmation: false, canActivate: true,
  }]);

  // A second run finds nothing to change.
  const upgraded = await stored();
  expect(await upgradeEarlierDocuments(db, "StudyPlanning")).toBe(0);
  expect(await stored()).toEqual(upgraded);

  // The rewritten plan activates routinely, and a new proposal may repeat the saved candidates under their keys.
  await planning.activateRoutine({ owner: "sam", plan: "proposed-plan", currentBasis: "skills-v1" });
  const next = await planning.replan({ owner: "sam", scope, candidates: [current(earlier("vectors", 2)), current(earlier("matrices", 1))],
    horizonEnd: "2026-10-19", explanation: "Prepare for the midterm first.", basis: "skills-v1", workloadComplete: true });
  const plans = await planning._plans({ owner: "sam", scope });
  expect(Object.fromEntries(plans.map(({ plan, status, needsConfirmation }) => [plan, [status, needsConfirmation]]))).toEqual({
    "active-plan": ["SUPERSEDED", false], "proposed-plan": ["ACTIVE", false], [next.plan]: ["PROPOSED", false],
  });
});
