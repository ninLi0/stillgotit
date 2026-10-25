import type { SkillRows, TutorAnswer, TutorRequest } from "../learning-data.ts";
import type { SourceContext } from "../tutor-types.ts";
import type { Material } from "../concepts/MaterialKeeping/MaterialKeeping.ts";
import type { MediaList } from "../media.ts";
import type { Help, JsonValue, Result, ResponseValue } from "../concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { taskCriteria } from "./learning.ts";

// Pure calculations for importing graded work. They read only their input records.

const GRADED_PREFIX = "Graded work: ";
const ZONE = "America/New_York";
const results: readonly Result[] = ["INDEPENDENT", "SUPPORTED", "SLIP", "GAP", "UNCERTAIN"];
const resultNames: Record<Result, string> = { INDEPENDENT: "Independent", SUPPORTED: "Supported", SLIP: "Slip", GAP: "Gap", UNCERTAIN: "Uncertain" };

/** The row sent to Confirm: the extracted values unchanged, the tutor's proposed result, and the learner's skill and result. */
export interface GradedRow {
  label: string; mark: string; feedback: string; excerpt: string; rationale: string;
  proposedResult: Result; skill: string; result: Result;
}
export type GradedStatus = "READY" | "DATE_INVALID" | "DATE_FUTURE" | "ROW_INVALID" | "UNMAPPED" | "HELP_CONFLICT" | "SKILL_UNAVAILABLE";
/** The first failing date or row check, or READY with the performance instant. */
export interface GradedReview { status: GradedStatus; performedAt: Date | null }
/** The skill and source key of the row. */
export interface GradedKey { skill: string; sourceKey: string }
/** The importGraded input built from the row, without its author. */
export interface GradedImport {
  subject: string; definition: string; sourceKey: string; question: string; criteria: string; response: ResponseValue;
  help: Help; fresh: boolean; performedAt: Date; mark: string; feedback: string; result: Result; gateMet: boolean; rationale: string;
}

export function gradedTitle({ title }: { title: string }): boolean {
  return typeof title === "string" && title.startsWith(GRADED_PREFIX) && /\S/.test(title.slice(GRADED_PREFIX.length));
}

export function hasConfirmedSkill({ skills }: { skills: SkillRows }): boolean {
  return skills.some((skill) => skill.status === "CONFIRMED");
}

export function extractRequest({ selected, skills }: { selected: SourceContext[]; skills: SkillRows }): TutorRequest {
  const confirmed = skills.filter((row) => row.status === "CONFIRMED").sort((a, b) => a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0)
    .map(({ skill, title, outcome, gate }) => ({ skill, title, outcome, gate }));
  return { kind: "EXTRACT", sources: selected, context: { skills: confirmed }, work: [] };
}

export function hasGradedRows({ answer }: { answer: TutorAnswer }): boolean {
  return answer.rows.length > 0;
}

/** The America/New_York calendar date of an instant, written YYYY-MM-DD. */
export function gradedToday({ at }: { at: Date }): string {
  return at.toLocaleDateString("en-CA", { timeZone: ZONE });
}

/**
 * The confirm checks for the date and the row, in their stated order. The row is the learner's claim, so every field is checked
 * here even though the host refuses a malformed row first.
 */
export function gradedReview({ row, outsideHelp, performedOn, at, skills }: {
  row: GradedRow; outsideHelp: boolean; performedOn: string; at: Date; skills: SkillRows;
}): GradedReview {
  const refuse = (status: GradedStatus): GradedReview => ({ status, performedAt: null });
  const day = calendarDate(performedOn);
  if (!day) return refuse("DATE_INVALID");
  if (performedOn > gradedToday({ at })) return refuse("DATE_FUTURE");
  if (!validRow(row)) return refuse("ROW_INVALID");
  if (row.skill === "") return refuse("UNMAPPED");
  if (outsideHelp === true && row.result === "INDEPENDENT") return refuse("HELP_CONFLICT");
  if (!skills.some((skill) => skill.skill === row.skill && skill.status === "CONFIRMED")) return refuse("SKILL_UNAVAILABLE");
  return { status: "READY", performedAt: zoneMidnight(day) };
}

/** The source key names the material, the trimmed label, and the skill, so a repeated question for the same skill is refused. */
export function gradedKey({ material, row }: { material: Material; row: GradedRow }): GradedKey {
  return { skill: row.skill, sourceKey: sourceKey(material, row) };
}

/** The importGraded input for a row that gradedReview accepted. */
export function gradedImport({ material, originals, row, outsideHelp, performedAt, skills }: {
  material: Material; originals: MediaList; row: GradedRow; outsideHelp: boolean; performedAt: Date; skills: SkillRows;
}): GradedImport {
  const skill = skills.find((item) => item.skill === row.skill);
  if (!skill) throw new Error("Unavailable skill");
  return {
    subject: row.skill, definition: skill.current, sourceKey: sourceKey(material, row), question: row.label.trim(), criteria: taskCriteria(skill),
    response: { text: row.excerpt, attachments: JSON.parse(JSON.stringify(originals)) as JsonValue[], conversation: [], citations: [{ material }], reviewedDialogueLength: 0 },
    help: outsideHelp ? "HINT" : "NONE", fresh: true, performedAt, mark: row.mark, feedback: row.feedback, result: row.result, gateMet: false,
    rationale: importRationale(row),
  };
}

/** True when gradedKey made the source key for this material. */
export function gradedSource({ sourceKey, material }: { sourceKey: string; material: Material }): boolean {
  if (typeof sourceKey !== "string" || !sourceKey.startsWith("graded")) return false;
  try {
    const parts: unknown = JSON.parse(sourceKey.slice("graded".length));
    return Array.isArray(parts) && parts.length === 3 && parts.every((part) => typeof part === "string") &&
      parts[0] === material && `graded${JSON.stringify(parts)}` === sourceKey;
  } catch { return false; }
}

function sourceKey(material: Material, row: GradedRow): string {
  return `graded${JSON.stringify([material, row.label.trim(), row.skill])}`;
}

function importRationale({ proposedResult, result, rationale }: GradedRow): string {
  return result === proposedResult
    ? `You kept the tutor's proposed result, ${resultNames[result]}, when importing graded work. Tutor's reason: ${rationale}`
    : `You changed the tutor's proposed result from ${resultNames[proposedResult]} to ${resultNames[result]} when importing graded work. Tutor's reason for ${resultNames[proposedResult]}: ${rationale}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const nonblank = (value: string) => value.trim().length > 0;
const textFields = ["label", "mark", "feedback", "excerpt", "rationale", "proposedResult", "skill", "result"] as const;

/** The confirm row checks: a record with eight string fields that follows the extraction's rules. The skill is checked later. */
function validRow(row: unknown): row is GradedRow {
  if (!isRecord(row) || !textFields.every((field) => typeof row[field] === "string")) return false;
  const { label, mark, feedback, excerpt, rationale, proposedResult, result } = row as Record<typeof textFields[number], string>;
  return nonblank(label) && label.length <= 100 && nonblank(mark) && mark.length <= 50 && feedback.length <= 2000 && excerpt.length <= 500 &&
    results.includes(result as Result) && results.includes(proposedResult as Result) && nonblank(rationale) && rationale.length <= 500;
}

/** A real calendar date written YYYY-MM-DD, or null. */
function calendarDate(value: unknown): { year: number; month: number; day: number } | null {
  const match = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return year >= 1 && probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day ? { year, month, day } : null;
}

/** The instant that starts the calendar day in America/New_York. */
function zoneMidnight({ year, month, day }: { year: number; month: number; day: number }): Date {
  const wall = new Date(0);
  wall.setUTCFullYear(year, month - 1, day);
  // Midnight is never inside a New York daylight-saving gap, so a second pass settles the offset.
  let instant = wall.getTime() - zoneOffset(wall.getTime());
  instant = wall.getTime() - zoneOffset(instant);
  return new Date(instant);
}

const offsetFormat = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, timeZoneName: "longOffset" });

/** Local time minus UTC, in milliseconds, at an instant. */
function zoneOffset(instant: number): number {
  const name = offsetFormat.formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value ?? "GMT";
  const match = /^GMT(?:([+-])(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(name);
  if (!match) throw new Error("Unknown time zone offset");
  if (!match[1]) return 0;
  const size = ((Number(match[2]) * 60 + Number(match[3])) * 60 + Number(match[4] ?? 0)) * 1000;
  return match[1] === "-" ? -size : size;
}
