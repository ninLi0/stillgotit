import { describe, expect, test } from "bun:test";
import {
  KeptReviews, alreadyImported, confirmRow, dateProblem, earlierLabels, estimateStart, isCalendarDate, newRows, rowProblem, sentences,
  type ExtractedRow, type ImportedRow, type KeptReview, type Material,
} from "../frontend/src/graded-import.ts";

function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}
const extracted = (label: string, skill: string, result: ExtractedRow["result"] = "SLIP"): ExtractedRow =>
  ({ label, mark: "8/10", feedback: "Check the second step.", excerpt: "x = 2", skill, result, rationale: "One sign error." });
const imported = (label: string, skill: string): ImportedRow =>
  ({ case: `case-${label}-${skill}`, label, skill, mark: "5/5", feedback: "", performedAt: "2026-10-01T04:00:00.000Z", result: "SLIP" });
const material = "material-1" as Material, key = "stillgotit-graded-import:material-1";

describe("Kept graded reviews", () => {
  test("a saved review reads back unchanged, including a row kept as sent, until it is removed", () => {
    const saved = storage(), store = new KeptReviews(saved);
    expect(store.read(material)).toBeNull();
    const review: KeptReview = { performedOn: "2026-10-01", outsideHelp: true, started: true,
      rows: [{ ...newRows([extracted("Q1", "skill-a")], [], new Set(["skill-a"]), true)[0]!, pending: true }] };
    store.save(material, review);
    expect(store.read(material)).toEqual(review);
    store.remove(material);
    expect(store.read(material)).toBeNull();
    expect(saved.values.size).toBe(0);
  });

  test("unusable kept work is reported and left in place, not replaced", () => {
    const saved = storage(), store = new KeptReviews(saved);
    const valid = { performedOn: "", outsideHelp: false, started: false, rows: newRows([extracted("Q1", "skill-a")], [], new Set(["skill-a"]), false) };
    const broken = [
      "{not json",
      JSON.stringify({ ...valid, rows: [] }),
      JSON.stringify({ ...valid, started: "no" }),
      JSON.stringify({ ...valid, rows: [{ ...valid.rows[0], result: "PERFECT" }] }),
      JSON.stringify({ ...valid, rows: [{ ...valid.rows[0], mark: 8 }] }),
      JSON.stringify({ ...valid, rows: [{ ...valid.rows[0], pending: "yes" }] }),
    ];
    for (const text of broken) {
      saved.setItem(key, text);
      expect(() => store.read(material)).toThrow("The kept questions for this work could not be read. Read the work again to start over.");
      expect(saved.getItem(key)).toBe(text);
    }
  });

  test("a storage failure is reported as a sentence", () => {
    const store = new KeptReviews({ getItem: () => null, setItem: () => { throw new Error("QuotaExceededError"); }, removeItem: () => undefined });
    expect(() => store.save(material, { performedOn: "", outsideHelp: false, started: false, rows: [] }))
      .toThrow("The browser could not keep your review. Keep this tab open, and confirm again when browser storage is available.");
  });
});

describe("Rows from a new extraction", () => {
  test("rows matching an import, sharing a skill with an import, or without a confirmed skill start unchecked", () => {
    const rows = newRows([extracted(" Q1 ", "skill-a"), extracted("Q2", "skill-a"), extracted("Q3", "draft-skill"), extracted("Q4", ""), extracted("Q5", "skill-b")],
      [imported("Q1", "skill-a")], new Set(["skill-a", "skill-b"]), false);
    expect(rows.map((row) => [row.label, row.skill, row.imported, row.checked])).toEqual([
      [" Q1 ", "skill-a", true, false],
      ["Q2", "skill-a", false, false],
      ["Q3", "", false, false],
      ["Q4", "", false, false],
      ["Q5", "skill-b", false, true],
    ]);
    // The extracted fields are kept exactly as the tutor returned them, for a retry with the same source key.
    expect(confirmRow(rows[0]!)).toEqual({ label: " Q1 ", mark: "8/10", feedback: "Check the second step.", excerpt: "x = 2", rationale: "One sign error.",
      proposedResult: "SLIP", skill: "skill-a", result: "SLIP" });
  });

  test("with help declared, an Independent proposal becomes Supported and the proposal is kept", () => {
    const [independent, slip] = newRows([extracted("Q1", "skill-a", "INDEPENDENT"), extracted("Q2", "skill-a", "SLIP")], [], new Set(["skill-a"]), true);
    expect([independent!.proposedResult, independent!.result]).toEqual(["INDEPENDENT", "SUPPORTED"]);
    expect([slip!.proposedResult, slip!.result]).toEqual(["SLIP", "SLIP"]);
    const [alone] = newRows([extracted("Q1", "skill-a", "INDEPENDENT")], [], new Set(["skill-a"]), false);
    expect(alone!.result).toBe("INDEPENDENT");
  });
});

describe("Comparing rows with earlier imports", () => {
  test("a row is already imported only when its trimmed label and skill match", () => {
    const earlier = [imported("Question 1", "skill-a")];
    expect(alreadyImported({ label: "  Question 1 ", skill: "skill-a" }, earlier)).toBe(true);
    expect(alreadyImported({ label: "Question 1", skill: "skill-b" }, earlier)).toBe(false);
    expect(alreadyImported({ label: "Question 2", skill: "skill-a" }, earlier)).toBe(false);
    expect(alreadyImported({ label: "Question 1", skill: "" }, earlier)).toBe(false);
  });

  test("earlier labels list the skill's other imports from this work once each", () => {
    const earlier = [imported("Q1", "skill-a"), imported("Q2 ", "skill-a"), imported("Q2", "skill-a"), imported("Q3", "skill-b")];
    expect(earlierLabels({ label: "Q4", skill: "skill-a" }, earlier)).toEqual(["Q1", "Q2"]);
    expect(earlierLabels({ label: " Q1", skill: "skill-a" }, earlier)).toEqual(["Q2"]);
    expect(earlierLabels({ label: "Q4", skill: "skill-c" }, earlier)).toEqual([]);
    expect(earlierLabels({ label: "Q4", skill: "" }, earlier)).toEqual([]);
  });
});

describe("Checks before Confirm", () => {
  const confirmed = new Set(["skill-a"]);
  const ready = confirmRow(newRows([extracted("Q1", "skill-a", "INDEPENDENT")], [], confirmed, false)[0]!);

  test("each check answers the design's sentence, in the design's order", () => {
    expect(rowProblem(ready, false, confirmed)).toBe("");
    // An invalid row is reported before a missing skill, help, or an unavailable skill.
    expect(rowProblem({ ...ready, mark: " ", skill: "", result: "INDEPENDENT" }, true, confirmed)).toBe(sentences.rowInvalid);
    expect(rowProblem({ ...ready, skill: "" }, true, confirmed)).toBe(sentences.unmapped);
    expect(rowProblem({ ...ready, skill: "archived" }, true, confirmed)).toBe(sentences.helpConflict);
    expect(rowProblem({ ...ready, skill: "archived" }, false, confirmed)).toBe(sentences.skillUnavailable);
    expect(rowProblem({ ...ready, result: "SUPPORTED" }, true, confirmed)).toBe("");
  });

  test("a row breaking the extraction's rules is invalid", () => {
    const invalid = [
      { ...ready, label: " " }, { ...ready, label: "x".repeat(101) }, { ...ready, mark: "" }, { ...ready, mark: "x".repeat(51) },
      { ...ready, feedback: "x".repeat(2001) }, { ...ready, excerpt: "x".repeat(501) }, { ...ready, rationale: "" },
      { ...ready, rationale: "x".repeat(501) }, { ...ready, skill: "x".repeat(301) },
      { ...ready, result: "PERFECT" as never }, { ...ready, proposedResult: "PERFECT" as never },
    ];
    for (const row of invalid) expect(rowProblem(row, false, confirmed)).toBe(sentences.rowInvalid);
    expect(rowProblem({ ...ready, feedback: "", excerpt: "", label: "x".repeat(100), mark: "x".repeat(50) }, false, confirmed)).toBe("");
  });

  test("the date must be a real calendar date no later than the server's today", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    for (const day of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-4-01", "20261001", "", "2026-10-01T00:00"]) expect(isCalendarDate(day)).toBe(false);
    expect(dateProblem("", "2026-10-23")).toBe(sentences.dateInvalid);
    expect(dateProblem("2026-02-30", "2026-10-23")).toBe(sentences.dateInvalid);
    expect(dateProblem("2026-10-24", "2026-10-23")).toBe(sentences.dateFuture);
    expect(dateProblem("2027-01-01", "2026-10-23")).toBe(sentences.dateFuture);
    expect(dateProblem("2026-10-23", "2026-10-23")).toBe("");
    expect(dateProblem("2025-12-31", "2026-10-23")).toBe("");
  });
});

describe("Where a skill's estimate starts", () => {
  type Track = Parameters<typeof estimateStart>[0];
  const input = (evidence: string, revision: number, performedAt: string, signal: string) =>
    ({ evidence, revision, performedAt, signal, fresh: true, gateMet: false, attribution: "", input: "" });
  // estimateStart does not read the starting basis, so the test leaves its value unspecified.
  const startingBasis = undefined as unknown as NonNullable<Track>["startingBasis"];
  const track = (initializedAt: string, inputs: ReturnType<typeof input>[]) => ({ track: "track", subject: "skill-a", definition: "version",
    initialConfidence: 50, startingBasis, initializedAt, inputs, estimate: null }) as Track;

  test("a skill without an estimate has no start", () => {
    expect(estimateStart(null)).toBeNull();
  });

  test("the start is the New York date of the earlier of the starting date and the oldest informative evidence", () => {
    expect(estimateStart(track("2026-10-10T15:00:00.000Z", []))).toBe("2026-10-10");
    // 02:00 UTC on October 10 is still October 9 in New York.
    expect(estimateStart(track("2026-10-10T02:00:00.000Z", []))).toBe("2026-10-09");
    expect(estimateStart(track("2026-10-10T15:00:00.000Z", [input("e1", 1, "2026-09-01T04:00:00.000Z", "GAP")]))).toBe("2026-09-01");
    expect(estimateStart(track("2026-10-10T15:00:00.000Z", [input("e1", 1, "2026-10-20T04:00:00.000Z", "GAP")]))).toBe("2026-10-10");
  });

  test("evidence whose latest revision is Uncertain does not move the start", () => {
    expect(estimateStart(track("2026-10-10T15:00:00.000Z", [input("e1", 1, "2026-09-01T04:00:00.000Z", "UNCERTAIN")]))).toBe("2026-10-10");
    expect(estimateStart(track("2026-10-10T15:00:00.000Z", [
      input("e1", 1, "2026-09-01T04:00:00.000Z", "SLIP"), input("e1", 2, "2026-09-01T04:00:00.000Z", "UNCERTAIN"),
    ]))).toBe("2026-10-10");
    expect(estimateStart(track("2026-10-10T15:00:00.000Z", [
      input("e1", 2, "2026-09-01T04:00:00.000Z", "SLIP"), input("e1", 1, "2026-09-01T04:00:00.000Z", "UNCERTAIN"),
    ]))).toBe("2026-09-01");
  });
});
