// How the evidence behind an estimate reads in words, shared by the lesson's evidence panel (EstimatePanel.vue) and the
// Memory view's "How your curve was shaped" (MemoryView.vue). Each change of the estimate timeline becomes a sentence such
// as "Independent success on fresh work in Practice 1 raised it from 50% to 95%." `labels` names a skill's conversations,
// such as "Practice 2" (labels.ts, sessionLabels). The panel says each fact once: a row's sentence carries its values, so
// no column repeats them, and a row's timing does not repeat the drop its sentence already states.
import { resultLabels } from "./labels.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";

export type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];
export type Change = NonNullable<SkillData["explanation"]>["changes"][number];
export type Case = SkillData["cases"][number];

/** Imported graded work has no practice task and keeps its original mark. */
export function isImported(item: Case) { return item.task === null && item.work.originalMark.trim() !== ""; }
/** The attempt's name: "Practice 2", "Imported · original mark 8/10", or "Assessment". */
export function caseName(item: Case | undefined, labels: Record<string, string>) {
  if (!item) return "";
  if (isImported(item)) return `Imported · original mark ${item.work.originalMark.trim()}`;
  return item.task ? labels[item.task] ?? "Practice" : "Assessment";
}
/** The judgment's result as the learner reads it, or nothing before a judgment. */
export function resultName(item: Case | undefined) { return item?.judgment ? resultLabels[item.judgment.result] ?? "" : ""; }
/** How a change moved the estimate, in whole percents as the values column shows them. */
export function moved(before: number, after: number) {
  const from = Math.round(before), to = Math.round(after);
  return to > from ? `raised it from ${from}% to ${to}%` : to < from ? `lowered it from ${from}% to ${to}%` : `left it at ${to}%`;
}
/** Each judgment as the subject of a sentence ("A small execution error lowered it …"). */
export const RESULT_SUBJECT: Record<string, string> = {
  INDEPENDENT: "Independent success", SUPPORTED: "Success with help", SLIP: "A small execution error", GAP: "A gap in understanding", UNCERTAIN: "An uncertain result",
};
function attemptPlace(item: Case | undefined, labels: Record<string, string>) {
  if (!item) return "";
  if (isImported(item)) return ` on imported work (original mark ${item.work.originalMark.trim()})`;
  return item.task ? ` in ${labels[item.task] ?? "practice"}` : " in an assessment";
}
/** A change as a sentence: what happened, where, and how it moved the estimate. */
export function changeText(change: Change, cases: ReadonlyMap<string, Case>, labels: Record<string, string>) {
  if (change.kind === "ATTEMPT") {
    const item = cases.get(change.source), judged = item?.judgment?.result;
    const subject = judged ? RESULT_SUBJECT[judged] ?? resultLabels[judged] ?? "An assessed attempt" : "An assessed attempt";
    const fresh = judged === "INDEPENDENT" && item?.fresh ? " on fresh work" : "";
    return `${subject}${fresh}${attemptPlace(item, labels)} ${moved(change.before, change.after)}.`;
  }
  return `${change.kind === "ADJUSTMENT" ? "Your adjustment" : "Time without practice"} ${moved(change.before, change.after)}.`;
}
/** The starting point's row: its value and where it came from, in one sentence, since the row shows no other value. */
export function startText(start: { confidence: number; startingBasis: string }) {
  const value = `${Math.round(start.confidence)}%`;
  return start.startingBasis === "PREVIOUS_DEFINITION"
    ? `The estimate started at ${value}, carried over from an earlier version of this skill.`
    : `The estimate started at ${value}, your reported starting confidence.`;
}
function points(amount: number) { const whole = Math.round(amount); return whole < 1 ? "less than 1 point" : whole === 1 ? "1 point" : `${whole} points`; }
/**
 * A change's timing under its sentence: the days since the previous row and, for an attempt or an adjustment, how much
 * time lowered the estimate before it. A row for time without practice already says how far time lowered it, so its
 * timing gives only the days. Small same-day decay is left out.
 */
export function timingText(change: Pick<Change, "kind" | "days" | "decay">, index: number) {
  const since = index === 0 ? "the starting point" : "the previous change";
  const gap = change.days < 1 ? `Less than a day after ${since}.` : `${change.days === 1 ? "1 day" : `${change.days} days`} after ${since}.`;
  if (change.kind === "TIME") return gap;
  const decay = Math.round(change.decay) >= 1 || (change.decay > 0 && change.days >= 1) ? points(change.decay) : "";
  return decay ? `${gap} Time lowered it ${decay} before this.` : gap;
}
/**
 * Beside the "Provisional" pill: why the estimate is provisional and what has moved it so far. It is said once, under
 * "How the estimate got here", rather than again under the chart.
 */
export function provisionalText(changes: readonly Pick<Change, "kind">[]) {
  return changes.some((change) => change.kind === "ADJUSTMENT")
    ? "No assessed attempt has counted yet, so only your adjustments and time have moved it."
    : "No assessed attempt has counted yet, so only time has moved it.";
}
/** A change's short name for a chart mark: "Assessed attempt · Practice 2 · Independent success". */
export function kindLabel(change: Change, cases: ReadonlyMap<string, Case>, labels: Record<string, string>) {
  if (change.kind === "ATTEMPT") {
    const item = cases.get(change.source);
    return ["Assessed attempt", caseName(item, labels), resultName(item)].filter(Boolean).join(" · ");
  }
  return change.kind === "ADJUSTMENT" ? "Your adjustment" : "Time without practice";
}
