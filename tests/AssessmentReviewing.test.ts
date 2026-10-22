import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { AssessmentReviewing, type Help, type Origin, type Result } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
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
  INVALID_ASSESSMENT_WORK: "Provide the work, question, requirements, source key, and a valid attempt date.",
  ASSESSMENT_SOURCE_USED: "This work already has an assessment case for this skill.",
  ASSESSMENT_TASK_USED: "This practice task has already been submitted.",
  ASSESSMENT_CASE_UNAVAILABLE: "Choose an existing assessment case.",
  ASSESSMENT_ALREADY_JUDGED: "Use a regrade to change an existing judgment.",
  INVALID_INITIAL_JUDGMENT: "Provide an explanation and a result consistent with the saved work and assistance.",
  INVALID_GRADED_WORK: "Provide the graded work, original mark, requirements, attempt date, and assessment explanation.",
  GRADED_SOURCE_USED: "This work already has an assessment case for this skill.",
  INVALID_IMPORTED_JUDGMENT: "Use a result consistent with the imported work and assistance.",
  CLARIFICATION_CASE_UNAVAILABLE: "Choose one of your assessment cases.",
  INVALID_WORK_CLARIFICATION: "Clarify the original work. Submit a new attempt for a changed solution.",
  REVISION_CASE_UNAVAILABLE: "Choose one of your assessment cases.",
  JUDGMENT_REVISION_OUTDATED: "Review the current judgment before submitting a revision.",
  INVALID_REVISED_JUDGMENT: "Provide an explanation and a result consistent with the saved work and assistance.",
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

type Submission = Parameters<AssessmentReviewing["submit"]>[0];
type GradedImport = Parameters<AssessmentReviewing["importGraded"]>[0];
type JudgmentRow = Awaited<ReturnType<AssessmentReviewing["_judgments"]>>[number];

const attemptedAt = new Date("2026-10-13T14:30:00Z");
const start = new Date("2026-10-13T15:00:00Z");

function setup() {
  let now = start;
  const assessment = new AssessmentReviewing(connection!.db, "AssessmentReviewing", () => now);
  // Each call moves the injected clock forward one minute and returns the new time.
  const tick = () => { now = new Date(now.getTime() + 60_000); return now; };
  return { assessment, tick };
}

const response = {
  text: "AB is [[19, 22], [43, 50]] and BA is [[23, 34], [31, 46]]. Each entry pairs a row with a column, so swapping the order changes the pairs.",
  attachments: [], conversation: [{ speaker: "LEARNER", purpose: "RESPONSE", text: "AB is 19 22 43 50 and BA is 23 34 31 46." }],
  citations: [], reviewedDialogueLength: 1,
};

function practice(overrides: Partial<Submission> = {}): Submission {
  return {
    author: "sam", subject: "matrix-products", definition: "v1", sourceKey: "practice:task-1", task: "task-1",
    question: "For A = [[1, 2], [3, 4]] and B = [[5, 6], [7, 8]], compute AB and BA. Explain why they differ.",
    criteria: "Both products are correct and the explanation names the row-column pairing. Gate: two fresh products without hints.",
    response, help: "NONE", fresh: true, performedAt: attemptedAt, ...overrides,
  };
}

function graded(overrides: Partial<GradedImport> = {}): GradedImport {
  const { task: _, ...work } = practice({ sourceKey: "pset-3:problem-2" });
  return {
    ...work, help: "UNKNOWN", fresh: false, mark: "7/10", feedback: "Check the second product.",
    result: "SLIP", gateMet: false, rationale: "The method is sound, but one entry of BA is wrong.", ...overrides,
  };
}

describe("AssessmentReviewing", () => {
  test("principle: saved work is assessed, clarified, regraded, and corrected while earlier judgments stay readable", async () => {
    const { assessment, tick } = setup();
    const work = practice();
    const { case: id } = await assessment.submit(work);
    expect(await assessment._case({ case: id })).toEqual([{
      author: "sam", subject: "matrix-products", definition: "v1", sourceKey: "practice:task-1", task: "task-1",
      help: "NONE", fresh: true, performedAt: attemptedAt, imported: false,
    }]);
    expect(await assessment._effectiveJudgment({ case: id })).toEqual([]);

    const assessedAt = tick();
    const initial = await assessment.assess({ case: id, result: "GAP", gateMet: false, rationale: "BA uses the wrong pairing." });
    tick();
    const clarification = { text: "The entry read as 37 is 31. My 1 looks like a 7.", attachments: [], originalWorkOnly: true };
    await assessment.clarify({ author: "sam", case: id, clarification });
    // Clarifying explains the work but does not change the effective judgment.
    expect((await assessment._effectiveJudgment({ case: id }))[0]!.judgment).toBe(initial.judgment);

    const regradedAt = tick();
    const regrade = await assessment.revise({ author: "sam", case: id, basedOn: initial.judgment, result: "SLIP", gateMet: false,
      rationale: "With the clarified entry, only one entry of BA is wrong.", origin: "AI" });
    const correctedAt = tick();
    const correction = await assessment.revise({ author: "sam", case: id, basedOn: regrade.judgment, result: "INDEPENDENT", gateMet: true,
      rationale: "The remaining entry was also misread. Both products and the explanation are correct.", origin: "MANUAL" });

    const history: JudgmentRow[] = [
      { judgment: initial.judgment, revision: 1, result: "GAP", gateMet: false, rationale: "BA uses the wrong pairing.", origin: "AI", recordedAt: assessedAt },
      { judgment: regrade.judgment, revision: 2, result: "SLIP", gateMet: false, rationale: "With the clarified entry, only one entry of BA is wrong.", origin: "AI", recordedAt: regradedAt },
      { judgment: correction.judgment, revision: 3, result: "INDEPENDENT", gateMet: true,
        rationale: "The remaining entry was also misread. Both products and the explanation are correct.", origin: "MANUAL", recordedAt: correctedAt },
    ];
    expect(await assessment._judgments({ case: id })).toEqual(history);
    expect(await assessment._effectiveJudgment({ case: id })).toEqual([history[2]!]);
    const { judgment: _, ...initialData } = history[0]!;
    expect(await assessment._judgment({ judgment: initial.judgment })).toEqual([{ case: id, ...initialData }]);
    expect(await assessment._work({ case: id })).toEqual([{ question: work.question, criteria: work.criteria, response, originalMark: "", originalFeedback: "" }]);
    expect(await assessment._clarifications({ case: id })).toEqual([{ index: 0, clarification }]);
    expect(await assessment._byTask({ author: "sam", task: "task-1" })).toEqual([{ case: id }]);
    const [{ data }] = await assessment._caseData({ case: id });
    expect(data).toMatchObject({ case: id, task: "task-1", judgment: history[2]!, history, clarifications: [clarification] });
  });

  test("imported coursework keeps its original mark separate from the app's judgment", async () => {
    const { assessment, tick } = setup();
    const input = graded();
    const imported = await assessment.importGraded(input);
    expect(await assessment._case({ case: imported.case })).toEqual([{
      author: "sam", subject: "matrix-products", definition: "v1", sourceKey: "pset-3:problem-2",
      help: "UNKNOWN", fresh: false, performedAt: attemptedAt, imported: true,
    }]);
    expect(await assessment._work({ case: imported.case })).toEqual([{
      question: input.question, criteria: input.criteria, response, originalMark: "7/10", originalFeedback: "Check the second product.",
    }]);
    expect(await assessment._judgments({ case: imported.case })).toEqual([{
      judgment: imported.judgment, revision: 1, result: "SLIP", gateMet: false, rationale: input.rationale, origin: "AI", recordedAt: start,
    }]);

    // The imported case already has a judgment, so a change must be a revision.
    const before = await savedState();
    await refuses(assessment.assess({ case: imported.case, result: "SLIP", gateMet: false, rationale: "One entry is wrong." }), "ASSESSMENT_ALREADY_JUDGED");
    expect(await savedState()).toEqual(before);
    tick();
    const corrected = await assessment.revise({ author: "sam", case: imported.case, basedOn: imported.judgment, result: "SUPPORTED", gateMet: false,
      rationale: "The grader misread the second product. I worked with a study group.", origin: "MANUAL" });
    expect((await assessment._effectiveJudgment({ case: imported.case }))[0]).toMatchObject({ judgment: corrected.judgment, revision: 2, result: "SUPPORTED", origin: "MANUAL" });
    expect((await assessment._work({ case: imported.case }))[0]).toMatchObject({ originalMark: "7/10", originalFeedback: "Check the second product." });

    // Imported and practice cases are listed together by attempt date.
    const laterAt = new Date(attemptedAt.getTime() + 60_000);
    const later = await assessment.submit(practice({ performedAt: laterAt }));
    expect(await assessment._cases({ author: "sam", subject: "matrix-products" })).toEqual([
      { case: imported.case, definition: "v1", performedAt: attemptedAt, imported: true },
      { case: later.case, definition: "v1", performedAt: laterAt, imported: false },
    ]);
  });

  test("refuses invalid work and a reused source key or task without saving a case", async () => {
    const { assessment } = setup();
    await assessment.submit(practice());
    const before = await savedState();

    const unused = { sourceKey: "practice:task-2", task: "task-2" };
    const invalidWork: Partial<Submission>[] = [
      { performedAt: new Date(start.getTime() + 1) }, { performedAt: new Date(Number.NaN) },
      { question: " " }, { criteria: "" }, { sourceKey: "" }, { task: "" },
      { response: { ...response, text: " ", attachments: [] } },
      { help: "SOME" as unknown as Help }, { fresh: undefined as unknown as boolean },
    ];
    for (const invalid of invalidWork) {
      await refuses(assessment.submit(practice({ ...unused, ...invalid })), "INVALID_ASSESSMENT_WORK");
    }
    await refuses(assessment.submit(practice({ task: "task-2" })), "ASSESSMENT_SOURCE_USED");
    await refuses(assessment.submit(practice({ sourceKey: "practice:task-2" })), "ASSESSMENT_TASK_USED");
    expect(await savedState()).toEqual(before);

    // A source key is unique only for one author and subject.
    await assessment.submit(practice({ author: "leo", task: "task-leo" }));
    await assessment.submit(practice({ subject: "matrix-inverses", task: "task-3" }));
    expect(await assessment._cases({ author: "leo", subject: "matrix-products" })).toHaveLength(1);
    expect(await assessment._cases({ author: "sam", subject: "matrix-inverses" })).toHaveLength(1);
  });

  test("refuses invalid, reused, or inconsistent imported grades without saving a case", async () => {
    const { assessment } = setup();
    await assessment.importGraded(graded());
    const before = await savedState();

    const unused = { sourceKey: "pset-3:problem-3" };
    const invalidImports: Partial<GradedImport>[] = [
      { mark: " " }, { rationale: "" }, { feedback: 7 as unknown as string }, { question: "" },
      { performedAt: new Date(start.getTime() + 1) }, { response: { ...response, text: "", attachments: [] } },
    ];
    for (const invalid of invalidImports) {
      await refuses(assessment.importGraded(graded({ ...unused, ...invalid })), "INVALID_GRADED_WORK");
    }
    await refuses(assessment.importGraded(graded({ mark: "9/10" })), "GRADED_SOURCE_USED");
    // Unknown help cannot establish an independent result, and work that is not fresh cannot meet the gate.
    await refuses(assessment.importGraded(graded({ ...unused, result: "INDEPENDENT" })), "INVALID_IMPORTED_JUDGMENT");
    await refuses(assessment.importGraded(graded({ ...unused, help: "NONE", result: "INDEPENDENT", gateMet: true })), "INVALID_IMPORTED_JUDGMENT");
    expect(await savedState()).toEqual(before);
  });

  test("refuses assessing an unknown or already judged case and judgments the saved work cannot support", async () => {
    const { assessment } = setup();
    const hinted = await assessment.submit(practice({ help: "HINT" }));
    const reused = await assessment.submit(practice({ sourceKey: "practice:task-2", task: "task-2", fresh: false }));
    const unknownHelp = await assessment.submit(practice({ sourceKey: "practice:task-3", task: "task-3", help: "UNKNOWN" }));
    const judged = await assessment.submit(practice({ sourceKey: "practice:task-4", task: "task-4" }));
    await assessment.assess({ case: judged.case, result: "SLIP", gateMet: false, rationale: "One entry of BA is wrong." });
    const before = await savedState();

    await refuses(assessment.assess({ case: randomUUID(), result: "SLIP", gateMet: false, rationale: "One entry is wrong." }), "ASSESSMENT_CASE_UNAVAILABLE");
    await refuses(assessment.assess({ case: judged.case, result: "INDEPENDENT", gateMet: true, rationale: "All correct." }), "ASSESSMENT_ALREADY_JUDGED");
    const unsupported: [{ case: string }, { result: Result; gateMet: boolean; rationale: string }][] = [
      [hinted, { result: "INDEPENDENT", gateMet: false, rationale: "Correct." }],
      [unknownHelp, { result: "INDEPENDENT", gateMet: false, rationale: "Correct." }],
      [reused, { result: "INDEPENDENT", gateMet: true, rationale: "Correct and complete." }],
      [hinted, { result: "SUPPORTED", gateMet: true, rationale: "Correct after a hint." }],
      [hinted, { result: "SUPPORTED", gateMet: false, rationale: " " }],
      [hinted, { result: "PASS" as unknown as Result, gateMet: false, rationale: "Correct." }],
    ];
    for (const [target, judgment] of unsupported) {
      await refuses(assessment.assess({ case: target.case, ...judgment }), "INVALID_INITIAL_JUDGMENT");
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses another author's case, an outdated basis, and an invalid revision or clarification", async () => {
    const { assessment } = setup();
    const unjudged = await assessment.submit(practice({ sourceKey: "practice:task-2", task: "task-2" }));
    const hinted = await assessment.submit(practice({ help: "HINT" }));
    const first = await assessment.assess({ case: hinted.case, result: "SLIP", gateMet: false, rationale: "One entry of BA is wrong." });
    const second = await assessment.revise({ author: "sam", case: hinted.case, basedOn: first.judgment, result: "SUPPORTED", gateMet: false,
      rationale: "Correct after the hint.", origin: "AI" });
    const revision = { result: "SUPPORTED" as Result, gateMet: false, rationale: "Correct after the hint, with a clear explanation.", origin: "MANUAL" as Origin };
    const note = { text: "That symbol is a 1, not a 7.", attachments: [], originalWorkOnly: true };
    const before = await savedState();

    // Leo cannot clarify or revise Sam's case. Unknown cases belong to no one.
    await refuses(assessment.clarify({ author: "leo", case: hinted.case, clarification: note }), "CLARIFICATION_CASE_UNAVAILABLE");
    await refuses(assessment.clarify({ author: "sam", case: randomUUID(), clarification: note }), "CLARIFICATION_CASE_UNAVAILABLE");
    await refuses(assessment.revise({ author: "leo", case: hinted.case, basedOn: second.judgment, ...revision }), "REVISION_CASE_UNAVAILABLE");
    await refuses(assessment.revise({ author: "sam", case: randomUUID(), basedOn: second.judgment, ...revision }), "REVISION_CASE_UNAVAILABLE");
    // A revision must start from the effective judgment, and an unassessed case has none.
    await refuses(assessment.revise({ author: "sam", case: hinted.case, basedOn: first.judgment, ...revision }), "JUDGMENT_REVISION_OUTDATED");
    await refuses(assessment.revise({ author: "sam", case: unjudged.case, basedOn: first.judgment, ...revision }), "JUDGMENT_REVISION_OUTDATED");
    // A revision follows the same judgment rules as an assessment.
    await refuses(assessment.revise({ author: "sam", case: hinted.case, basedOn: second.judgment, ...revision, result: "INDEPENDENT" }), "INVALID_REVISED_JUDGMENT");
    await refuses(assessment.revise({ author: "sam", case: hinted.case, basedOn: second.judgment, ...revision, rationale: "" }), "INVALID_REVISED_JUDGMENT");
    await refuses(assessment.revise({ author: "sam", case: hinted.case, basedOn: second.judgment, ...revision, origin: "TEACHER" as unknown as Origin }), "INVALID_REVISED_JUDGMENT");
    // A clarification needs an explanation or an attachment.
    await refuses(assessment.clarify({ author: "sam", case: hinted.case, clarification: { ...note, text: " " } }), "INVALID_WORK_CLARIFICATION");
    expect(await savedState()).toEqual(before);
    expect((await assessment._effectiveJudgment({ case: hinted.case }))[0]!.judgment).toBe(second.judgment);

    // A clearer photo alone can clarify the original work.
    const photo = { text: "", attachments: [{ file: "retained-clearer-photo", name: "work.jpg" }], originalWorkOnly: true };
    await assessment.clarify({ author: "sam", case: hinted.case, clarification: photo });
    expect(await assessment._clarifications({ case: hinted.case })).toEqual([{ index: 0, clarification: photo }]);
  });

  test("when a manual correction and a regrade start from the same judgment, only one becomes the next revision", async () => {
    const { assessment } = setup();
    const saved = await assessment.submit(practice());
    const first = await assessment.assess({ case: saved.case, result: "SLIP", gateMet: false, rationale: "One entry of BA is wrong." });
    // A second concept instance stands in for another server process handling the regrade.
    const other = new AssessmentReviewing(connection!.db, "AssessmentReviewing", () => start);
    const outcomes = await Promise.allSettled([
      assessment.revise({ author: "sam", case: saved.case, basedOn: first.judgment, result: "INDEPENDENT", gateMet: true,
        rationale: "The entry was misread. Everything is correct.", origin: "MANUAL" }),
      other.revise({ author: "sam", case: saved.case, basedOn: first.judgment, result: "SLIP", gateMet: false,
        rationale: "The regrade still finds one wrong entry.", origin: "AI" }),
    ]);
    const accepted = outcomes.flatMap((outcome) => outcome.status === "fulfilled" ? [outcome.value] : []);
    const refused = outcomes.flatMap((outcome) => outcome.status === "rejected" ? [outcome.reason] : []);
    expect(accepted).toHaveLength(1);
    expect(refused).toEqual([expect.objectContaining({ code: "JUDGMENT_REVISION_OUTDATED", message: messages.JUDGMENT_REVISION_OUTDATED })]);
    const judgments = await assessment._judgments({ case: saved.case });
    expect(judgments.map(({ judgment, revision }) => [judgment, revision])).toEqual([[first.judgment, 1], [accepted[0]!.judgment, 2]]);
  });
});
