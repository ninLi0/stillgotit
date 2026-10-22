import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { StudyPlanning, type Candidate } from "../src/concepts/StudyPlanning/StudyPlanning.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

let connection: Awaited<ReturnType<typeof connectMongo>>;
beforeAll(async () => { connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` }); });
afterAll(async () => { if (connection) { await connection.db.dropDatabase(); await connection.client.close(); } });
const start = new Date("2026-10-13T12:00:00Z"), day = 86_400_000;
const identity = { learner: "sam", subject: "matrix", definition: "v1" };
const work = { author: "sam", subject: "matrix", definition: "v1", sourceKey: "attempt-1", task: "task-1",
  question: "Solve two products and explain the rule.", criteria: "Two correct results and sound reasoning.",
  response: { text: "My two solutions and explanation", attachments: [], conversation: [], citations: [], reviewedDialogueLength: 1 },
  help: "NONE" as const, fresh: true, performedAt: start };

describe("Assessment history", () => {
  test("saves work once, appends a regrade, and rejects a stale correction", async () => {
    const assessment = new AssessmentReviewing(connection.db, crypto.randomUUID(), () => start);
    const result = await assessment.submit(work);
    const initial = await assessment.assess({ ...result, result: "SLIP", gateMet: false, rationale: "An arithmetic slip." });
    await assessment.clarify({ author: "sam", ...result, clarification: { text: "That symbol was a 7.", attachments: [], originalWorkOnly: true } });
    const revised = await assessment.revise({ author: "sam", ...result, basedOn: initial.judgment, result: "INDEPENDENT", gateMet: true, rationale: "The original work meets every requirement.", origin: "MANUAL" });
    expect((await assessment._effectiveJudgment(result))[0]!.judgment).toBe(revised.judgment);
    expect((await assessment._judgments(result)).map((j) => j.revision)).toEqual([1, 2]);
    expect((await assessment._work(result))[0]!.response).toEqual(work.response);
    await expect(assessment.revise({ author: "sam", ...result, basedOn: initial.judgment, result: "GAP", gateMet: false, rationale: "Stale", origin: "AI" })).rejects.toMatchObject({ code: "JUDGMENT_REVISION_OUTDATED" });
    await expect(assessment.clarify({ author: "other", ...result, clarification: { text: "Edit", attachments: [], originalWorkOnly: true } })).rejects.toMatchObject({ code: "CLARIFICATION_CASE_UNAVAILABLE" });
  });
  test("assisted or reused work cannot meet the gate; concurrent submission has one case", async () => {
    const name = crypto.randomUUID(), assessment = new AssessmentReviewing(connection.db, name, () => start);
    const attempts = await Promise.allSettled([assessment.submit({ ...work, help: "HINT" }), assessment.submit({ ...work, help: "HINT" })]);
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [saved] = await assessment._byTask({ author: "sam", task: work.task });
    await expect(assessment.assess({ ...saved!, result: "INDEPENDENT", gateMet: true, rationale: "Correct" })).rejects.toMatchObject({ code: "INVALID_INITIAL_JUDGMENT" });
    await assessment.assess({ ...saved!, result: "SUPPORTED", gateMet: false, rationale: "Correct after a hint." });
    expect((await new AssessmentReviewing(connection.db, name)._cases({ author: "sam", subject: "matrix" }))).toHaveLength(1);
  });
  test("an imported mark remains separate and new work is not a clarification", async () => {
    const assessment = new AssessmentReviewing(connection.db, crypto.randomUUID(), () => start);
    const { task: _, ...input } = work;
    const result = await assessment.importGraded({ ...input, mark: "8/10", feedback: "Check the final sum.", result: "SLIP", gateMet: false, rationale: "The method is sound." });
    expect((await assessment._case(result))[0]).not.toHaveProperty("task");
    expect((await assessment._work(result))[0]!.originalMark).toBe("8/10");
    await expect(assessment.clarify({ author: "sam", ...result, clarification: { text: "Here is a new solution", attachments: [], originalWorkOnly: false } })).rejects.toMatchObject({ code: "INVALID_WORK_CLARIFICATION" });
  });
});

async function mastery(confidence = 80) {
  let now = new Date(start);
  const name = crypto.randomUUID(), concept = new MasteryEstimating(connection.db, name, () => now);
  const track = await concept.initialize({ ...identity, confidence, basis: "SELF_REPORTED" });
  const estimate = async () => (await concept._estimate({ ...identity, at: now }))[0]!;
  const evidence = (id: string, signal: "INDEPENDENT" | "SUPPORTED" | "SLIP" | "GAP" | "UNCERTAIN", extra = {}) =>
    concept.acceptEvidence({ ...identity, evidence: id, revision: 1, performedAt: now, signal, fresh: true, gateMet: false, attribution: "Saved assessment", ...extra });
  return { name, concept, track, estimate, evidence, advance: (n: number) => { now = new Date(start.getTime() + n * day); }, now: () => now };
}
describe("Mastery replay", () => {
  test("confidence is provisional, decays over 60 days, and needs independent evidence", async () => {
    const m = await mastery();
    expect(await m.estimate()).toMatchObject({ value: 80, ready: false });
    m.advance(60); expect((await m.estimate()).value).toBeCloseTo(40);
    await m.evidence("fresh", "INDEPENDENT", { gateMet: true });
    expect(await m.estimate()).toMatchObject({ value: 95, ready: true });
    m.advance(74); expect((await m.estimate()).ready).toBe(true);
    m.advance(74.001); expect((await m.estimate()).ready).toBe(false);
  });
  test("supported recovery has a fixed cap until independent work", async () => {
    const m = await mastery(); m.advance(60);
    await m.evidence("a", "SUPPORTED"); expect((await m.estimate()).value).toBeCloseTo(60);
    await m.evidence("b", "SUPPORTED"); expect((await m.estimate()).value).toBeCloseTo(60);
    await m.evidence("c", "INDEPENDENT"); expect((await m.estimate()).value).toBeCloseTo(70);
    await m.evidence("d", "SLIP"); expect((await m.estimate()).value).toBeCloseTo(65);
    expect((await m.estimate()).ready).toBe(false);
  });
  test("regrading replaces the old event and replays a later manual adjustment", async () => {
    const m = await mastery(50);
    const first = await m.evidence("attempt", "GAP");
    m.advance(1); await m.concept.adjust({ ...identity, value: 85, reason: "Prior coursework." });
    m.advance(2); await m.evidence("later", "SLIP");
    const before = await m.estimate();
    const replacement = await m.evidence("attempt", "INDEPENDENT", { revision: 2, performedAt: start, gateMet: true });
    expect(replacement.input).toBe(first.input);
    expect((await m.estimate()).value).toBeCloseTo(before.value);
    await expect(m.evidence("attempt", "INDEPENDENT", { revision: 1, performedAt: start })).rejects.toMatchObject({ code: "EVIDENCE_REVISION_NOT_NEW" });
    expect((await m.concept._inputs(m.track))).toHaveLength(2);
  });
  test("unknown and reused successes give no gain; new definitions do not inherit readiness", async () => {
    const m = await mastery(90);
    await m.evidence("a", "UNCERTAIN"); await m.evidence("b", "INDEPENDENT", { fresh: false });
    expect(await m.estimate()).toMatchObject({ value: 90, ready: false });
    await m.concept.initialize({ ...identity, definition: "v2", confidence: 90, basis: "PREVIOUS_DEFINITION" });
    await expect(m.concept.acceptEvidence({ ...identity, definition: "v2", evidence: "a", revision: 2, performedAt: start, signal: "GAP", fresh: false, gateMet: false, attribution: "New judgment" })).rejects.toMatchObject({ code: "EVIDENCE_TRACK_MISMATCH" });
    expect((await m.concept._estimate({ ...identity, definition: "v2", at: start }))[0]!.ready).toBe(false);
    expect((await new MasteryEstimating(connection.db, m.name)._inputs(m.track))).toHaveLength(2);
  });
});

function candidate(key: string, minutes = 10): Candidate { return { key, subject: key, definition: "v1", activity: `Review ${key}`, minutes,
  priority: 1, earliestDay: "2026-10-13", latestDay: "2026-10-19", reason: "A fresh check is due.", examRefs: [] }; }
async function planner(budget = 20) {
  let date = "2026-10-13";
  const concept = new StudyPlanning(connection.db, crypto.randomUUID(), () => date);
  await concept.configure({ learner: "sam", scope: "math", dailyMinutes: budget, focusNote: "" });
  const propose = (candidates: Candidate[], extra = {}) => concept.replan({ learner: "sam", scope: "math", candidates, horizonEnd: "2026-10-19", explanation: "Review weaker skills.", basis: "v1", workloadComplete: true, ...extra });
  return { concept, propose, setDay: (value: string) => { date = value; } };
}
describe("Study time", () => {
  test("spends time once, preserves it across replans, and refuses repeated completed work", async () => {
    const p = await planner(), plan = await p.propose([candidate("a"), candidate("b")]);
    await p.concept.activateRoutine({ learner: "sam", ...plan, currentBasis: "v1" });
    const [first] = await p.concept._next({ learner: "sam", scope: "math" });
    await p.concept.begin({ learner: "sam", item: first!.item });
    await expect(p.propose([candidate("b")])).rejects.toMatchObject({ code: "PLAN_SESSION_IN_PROGRESS" });
    await p.concept.finish({ learner: "sam", item: first!.item, actualMinutes: 17 });
    await expect(p.propose([candidate("a")])).rejects.toMatchObject({ code: "INVALID_PLAN_INPUT" });
    const next = await p.propose([candidate("b")]);
    await p.concept.activateRoutine({ learner: "sam", ...next, currentBasis: "v1" });
    expect((await p.concept._items(next))[0]!.day).toBe("2026-10-14");
    expect((await p.concept._budget({ learner: "sam", scope: "math", day: "2026-10-13" }))[0]).toMatchObject({ spentMinutes: 17, remainingMinutes: 3 });
  });
  test("budget changes and a new day make a proposal stale; another learner cannot activate it", async () => {
    const p = await planner(), plan = await p.propose([candidate("a")]);
    await expect(p.concept.activateRoutine({ learner: "other", ...plan, currentBasis: "v1" })).rejects.toMatchObject({ code: "ROUTINE_PLAN_UNAVAILABLE" });
    p.setDay("2026-10-14");
    expect((await p.concept._proposalCheck({ learner: "sam", ...plan, currentBasis: "v1" }))[0]!.locallyCurrent).toBe(false);
    await expect(p.concept.activateRoutine({ learner: "sam", ...plan, currentBasis: "v1" })).rejects.toMatchObject({ code: "ROUTINE_PLAN_OUTDATED" });
  });
  test("zero budget defers work; an urgent exam cut needs confirmation and moves maintenance to the exam day", async () => {
    const p = await planner(0), empty = await p.propose([candidate("maintenance")]);
    expect(await p.concept._items(empty)).toEqual([]); expect(await p.concept._deferred(empty)).toHaveLength(1);
    await p.concept.configure({ learner: "sam", scope: "math", dailyMinutes: 10, focusNote: "Exam" });
    const { exam } = await p.concept.setExam({ learner: "sam", scope: "math", date: "2026-10-14", covered: ["a", "b"] });
    const plan = await p.propose([{ ...candidate("a"), examRefs: [exam] }, { ...candidate("b"), examRefs: [exam] }, candidate("maintenance")]);
    expect((await p.concept._plan(plan))[0]).toMatchObject({ examUrgent: true, needsConfirmation: true });
    await expect(p.concept.activateRoutine({ learner: "sam", ...plan, currentBasis: "v1" })).rejects.toMatchObject({ code: "EXAM_TRADEOFF_CONFIRMATION_REQUIRED" });
    await p.concept.confirmTradeoffs({ learner: "sam", ...plan, currentBasis: "v1" });
    const items = await p.concept._items(plan);
    expect(items.find((i) => i.candidate.key === "maintenance")!.day).toBe("2026-10-14");
    expect(await p.concept._cuts(plan)).toHaveLength(1);
  });
  test("competing starts on one plan leave only one activity in progress", async () => {
    const p = await planner();
    const plan = await p.propose([candidate("a"), candidate("b")]);
    await p.concept.activateRoutine({ learner: "sam", ...plan, currentBasis: "v1" });
    const items = await p.concept._items(plan);
    const results = await Promise.allSettled(items.map((item) => p.concept.begin({ learner: "sam", item: item.item })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect((await p.concept._items(plan)).filter((item) => item.status === "IN_PROGRESS")).toHaveLength(1);
  });
});
