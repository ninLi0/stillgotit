import { describe, expect, test } from "bun:test";
import { extractRequest, gradedImport, gradedKey, gradedReview, gradedSource, gradedTitle, gradedToday, hasConfirmedSkill, hasGradedRows, type GradedRow } from "../src/computations/importing.ts";
import type { SkillRows, TutorAnswer } from "../src/learning-data.ts";
import type { Material } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import type { MediaList } from "../src/media.ts";

const material = "material-1" as Material;
const skill = (id: string, status: "DRAFT" | "CONFIRMED" | "ARCHIVED" = "CONFIRMED") => ({ skill: id, title: `Skill ${id}`, current: `${id}-v2`, status, unit: "unit-1", course: "course-1",
  outcome: `Outcome ${id}`, gate: `Gate ${id}`, materials: [], prerequisites: [] }) as unknown as SkillRows[number];
const skills: SkillRows = [skill("s-b"), skill("s-a"), skill("s-draft", "DRAFT"), skill("s-old", "ARCHIVED")];
const row = (overrides: Partial<GradedRow> = {}): GradedRow => ({ label: "Question 1", mark: "8/10", feedback: "Check the last entry.", excerpt: "[[4,4],[10,8]]",
  rationale: "One entry is wrong.", proposedResult: "SLIP", skill: "s-a", result: "SLIP", ...overrides });
// 2026-10-23 is a Friday; 16:00 UTC is noon in New York.
const at = new Date("2026-10-23T16:00:00Z");
const review = (value: unknown, extra: Partial<{ outsideHelp: boolean; performedOn: unknown; at: Date }> = {}) =>
  gradedReview({ row: value as GradedRow, outsideHelp: false, performedOn: "2026-10-20", at, skills, ...extra } as Parameters<typeof gradedReview>[0]);

describe("graded titles and extraction requests", () => {
  test("a graded title is the exact prefix followed by a nonblank name", () => {
    expect(gradedTitle({ title: "Graded work: Midterm 1" })).toBe(true);
    expect(gradedTitle({ title: "Graded work: x" })).toBe(true);
    for (const title of ["Graded work: ", "Graded work:    ", "Graded work:\t\n", "graded work: Midterm", "Graded work:Midterm", " Graded work: Midterm", "Midterm", ""]) {
      expect(gradedTitle({ title }), title).toBe(false);
    }
  });

  test("an extraction request lists confirmed skills in identity order and carries one source and no work", () => {
    expect(hasConfirmedSkill({ skills })).toBe(true);
    expect(hasConfirmedSkill({ skills: [skill("s-draft", "DRAFT"), skill("s-old", "ARCHIVED")] })).toBe(false);
    expect(hasConfirmedSkill({ skills: [] })).toBe(false);
    const selected = [{ material, data: { owner: "sam", scope: "course-1", title: "Graded work: Midterm", locator: "upload:1", content: "", originals: [], origin: "COURSE" as const } }];
    expect(extractRequest({ selected, skills })).toEqual({ kind: "EXTRACT", sources: selected, work: [], context: { skills: [
      { skill: "s-a", title: "Skill s-a", outcome: "Outcome s-a", gate: "Gate s-a" },
      { skill: "s-b", title: "Skill s-b", outcome: "Outcome s-b", gate: "Gate s-b" },
    ] } });
  });

  test("an answer has graded rows only when the validated extraction has at least one row", () => {
    const answer = { rows: [] } as unknown as TutorAnswer;
    expect(hasGradedRows({ answer })).toBe(false);
    expect(hasGradedRows({ answer: { ...answer, rows: [{ label: "1", mark: "2/2", feedback: "", excerpt: "", skill: "", result: "INDEPENDENT", rationale: "Correct." }] } })).toBe(true);
  });
});

describe("dates", () => {
  test("today is the New York calendar date of the instant", () => {
    expect(gradedToday({ at })).toBe("2026-10-23");
    expect(gradedToday({ at: new Date("2026-10-24T03:59:59Z") })).toBe("2026-10-23");
    expect(gradedToday({ at: new Date("2026-10-24T04:00:00Z") })).toBe("2026-10-24");
    expect(gradedToday({ at: new Date("2026-01-15T04:59:59Z") })).toBe("2026-01-14");
    expect(gradedToday({ at: new Date("2026-01-15T05:00:00Z") })).toBe("2026-01-15");
  });

  test("the performance instant is the start of that date in New York, across daylight-saving changes", () => {
    const start = (performedOn: string) => review(row(), { performedOn, at: new Date("2026-12-31T12:00:00Z") }).performedAt?.toISOString();
    expect(start("2026-10-20")).toBe("2026-10-20T04:00:00.000Z");
    expect(start("2026-01-15")).toBe("2026-01-15T05:00:00.000Z");
    expect(start("2026-03-08")).toBe("2026-03-08T05:00:00.000Z");
    expect(start("2026-03-09")).toBe("2026-03-09T04:00:00.000Z");
    expect(start("2026-11-01")).toBe("2026-11-01T04:00:00.000Z");
    expect(start("2026-11-02")).toBe("2026-11-02T05:00:00.000Z");
    expect(start("2024-02-29")).toBe("2024-02-29T05:00:00.000Z");
  });

  test("today is accepted and its start is not later than the instant; tomorrow is in the future", () => {
    const today = review(row(), { performedOn: "2026-10-23" });
    expect(today.status).toBe("READY");
    expect(today.performedAt!.getTime()).toBeLessThanOrEqual(at.getTime());
    expect(review(row(), { performedOn: "2026-10-24" })).toEqual({ status: "DATE_FUTURE", performedAt: null });
    // Just after midnight in New York, that new date is today even though it is still the previous day in some zones.
    expect(review(row(), { performedOn: "2026-10-24", at: new Date("2026-10-24T04:00:01Z") }).status).toBe("READY");
  });

  test("a blank, malformed, or impossible date is invalid", () => {
    for (const performedOn of ["", "   ", "2026-02-30", "2026-13-01", "2026-00-10", "2026-1-5", "10/20/2026", "2026-10-20T00:00", " 2026-10-20", "0000-01-01", "yesterday"]) {
      expect(review(row(), { performedOn }), performedOn).toEqual({ status: "DATE_INVALID", performedAt: null });
    }
  });
});

describe("confirm review order", () => {
  test("each check answers in the stated order: date, row, unmapped, help, skill", () => {
    const { mark: _mark, ...withoutMark } = row();
    // An invalid date wins over every row problem, and a future date over a malformed row.
    expect(review(withoutMark, { performedOn: "2026-02-30" }).status).toBe("DATE_INVALID");
    expect(review(withoutMark, { performedOn: "2026-10-30" }).status).toBe("DATE_FUTURE");
    expect(review(row({ mark: "", skill: "" }), { outsideHelp: true }).status).toBe("ROW_INVALID");
    expect(review(row({ skill: "", result: "INDEPENDENT" }), { outsideHelp: true }).status).toBe("UNMAPPED");
    expect(review(row({ result: "INDEPENDENT", skill: "s-draft" }), { outsideHelp: true }).status).toBe("HELP_CONFLICT");
    expect(review(row({ skill: "s-draft" })).status).toBe("SKILL_UNAVAILABLE");
    expect(review(row())).toEqual({ status: "READY", performedAt: new Date("2026-10-20T04:00:00Z") });
  });

  test("a date that is not a string is invalid", () => {
    for (const performedOn of [null, 20261020, true, ["2026-10-20"], { date: "2026-10-20" }]) {
      expect(review(row(), { performedOn }), JSON.stringify(performedOn)).toEqual({ status: "DATE_INVALID", performedAt: null });
    }
  });

  test("the row is a record of eight strings that keeps the extraction's rules", () => {
    const { mark: _mark, ...withoutMark } = row();
    const { proposedResult: _proposed, ...withoutProposal } = row();
    const invalid: [string, unknown][] = [
      ["not a record", "Question 1"], ["null", null], ["list", [row()]], ["missing mark", withoutMark], ["missing proposed result", withoutProposal],
      ["numeric mark", { ...row(), mark: 8 }], ["null feedback", { ...row(), feedback: null }], ["boolean skill", { ...row(), skill: false }],
      ["blank label", row({ label: "  " })], ["long label", row({ label: "x".repeat(101) })], ["blank mark", row({ mark: " " })], ["long mark", row({ mark: "1".repeat(51) })],
      ["long feedback", row({ feedback: "x".repeat(2001) })], ["long excerpt", row({ excerpt: "x".repeat(501) })],
      ["unknown result", { ...row(), result: "PASS" }], ["lowercase result", { ...row(), result: "slip" }], ["unknown proposed result", { ...row(), proposedResult: "independent" }],
      ["blank rationale", row({ rationale: "" })], ["long rationale", row({ rationale: "x".repeat(501) })],
    ];
    for (const [name, value] of invalid) expect(review(value).status, name).toBe("ROW_INVALID");
    // The longest allowed values, blank feedback and excerpt, and extra fields pass.
    expect(review(row({ label: "x".repeat(100), mark: "1".repeat(50), feedback: "f".repeat(2000), excerpt: "e".repeat(500), rationale: "r".repeat(500) })).status).toBe("READY");
    expect(review(row({ feedback: "", excerpt: "" })).status).toBe("READY");
    expect(review({ ...row(), checked: true }).status).toBe("READY");
  });

  test("the row needs a skill; help forbids an independent result; the skill must be confirmed in the course", () => {
    expect(review(row({ skill: "" })).status).toBe("UNMAPPED");
    expect(review(row({ result: "INDEPENDENT" }), { outsideHelp: false }).status).toBe("READY");
    expect(review(row({ result: "SUPPORTED" }), { outsideHelp: true }).status).toBe("READY");
    // The help rule applies to the learner's result, not the tutor's proposal.
    expect(review(row({ proposedResult: "INDEPENDENT", result: "SUPPORTED" }), { outsideHelp: true }).status).toBe("READY");
    for (const id of ["s-draft", "s-old", "s-other-course", " s-a", "S-A"]) expect(review(row({ skill: id })).status, id).toBe("SKILL_UNAVAILABLE");
    expect(review(row({ skill: "s-b" })).status).toBe("READY");
  });
});

describe("source keys and imports", () => {
  test("the key names the material, the trimmed label, and the skill", () => {
    expect(gradedKey({ material, row: row({ label: "  Question 1 " }) })).toEqual({ skill: "s-a", sourceKey: 'graded["material-1","Question 1","s-a"]' });
    expect(gradedKey({ material, row: row({ label: "Question 1", skill: "s-b" }) })).toEqual({ skill: "s-b", sourceKey: 'graded["material-1","Question 1","s-b"]' });
    // JSON keeps labels with quotes or brackets unambiguous.
    expect(gradedKey({ material, row: row({ label: 'Q "1" [a]' }) }).sourceKey).toBe('graded["material-1","Q \\"1\\" [a]","s-a"]');
    expect(gradedSource({ sourceKey: 'graded["material-1","Question 1","s-a"]', material })).toBe(true);
    expect(gradedSource({ sourceKey: gradedKey({ material, row: row({ label: 'Q "1" [a]' }) }).sourceKey, material })).toBe(true);
    expect(gradedSource({ sourceKey: 'graded["material-2","Question 1","s-a"]', material })).toBe(false);
    for (const sourceKey of ["practice:session-1", "graded", 'graded["material-1","Question 1"]', 'graded[ "material-1","Question 1","s-a"]', 'graded["material-1","Q",1]', "graded{}"]) {
      expect(gradedSource({ sourceKey, material }), sourceKey).toBe(false);
    }
  });

  test("the row becomes one importGraded input with the stated values", () => {
    const originals: MediaList = [{ file: "files/midterm.pdf", name: "Midterm.pdf", mediaType: "application/pdf", renditions: [], limitations: [] }];
    const performedAt = new Date("2026-10-20T04:00:00Z");
    expect(gradedImport({ material, originals, row: row({ label: "  Question 1 " }), outsideHelp: false, performedAt, skills }) as unknown).toEqual({
      subject: "s-a", definition: "s-a-v2", sourceKey: 'graded["material-1","Question 1","s-a"]', question: "Question 1",
      criteria: "Outcome s-a\nFull demonstration gate: Gate s-a",
      response: { text: "[[4,4],[10,8]]", attachments: [...originals], conversation: [], citations: [{ material }], reviewedDialogueLength: 0 },
      help: "NONE", fresh: true, performedAt, mark: "8/10", feedback: "Check the last entry.", result: "SLIP", gateMet: false,
      rationale: "You kept the tutor's proposed result, Slip, when importing graded work. Tutor's reason: One entry is wrong." });
    expect(gradedImport({ material, originals, row: row({ label: "Question 4", skill: "s-b", proposedResult: "GAP", result: "UNCERTAIN", rationale: "The method is missing." }),
      outsideHelp: false, performedAt, skills })).toMatchObject({ subject: "s-b", definition: "s-b-v2", question: "Question 4", result: "UNCERTAIN",
      rationale: "You changed the tutor's proposed result from Gap to Uncertain when importing graded work. Tutor's reason for Gap: The method is missing." });
    // The grader's mark and feedback are kept exactly; the excerpt may be blank because the originals are attached.
    expect(gradedImport({ material, originals, row: row({ mark: " 8 / 10 ", feedback: "", excerpt: "", result: "SUPPORTED", proposedResult: "INDEPENDENT" }), outsideHelp: true, performedAt, skills }))
      .toMatchObject({ mark: " 8 / 10 ", feedback: "", help: "HINT", result: "SUPPORTED", response: { text: "" },
        rationale: "You changed the tutor's proposed result from Independent to Supported when importing graded work. Tutor's reason for Independent: One entry is wrong." });
  });
});
