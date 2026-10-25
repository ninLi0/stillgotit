import type { StillGotItHttp } from "../../generated/wire.ts";
import { errorMessage, failureText } from "./api.ts";

export type PlanRead = StillGotItHttp["/planning/read"]["output"];
export type PlanData = PlanRead["data"];
export type Exam = PlanRead["exams"][number];
export type Proposal = PlanRead["proposal"][number];
export type ProposalItem = PlanRead["proposalItems"][number];
export type Cut = PlanRead["cuts"][number]["cut"];
export type CourseRead = StillGotItHttp["/courses/read"]["output"];
export type CourseSkill = CourseRead["skills"][number];
export type CourseUnit = CourseRead["units"][number];
export type ExamInput = { date: string; covered: string[] };

/**
 * The planning concept's and the planning composition's own sentences. Over HTTP the host now adds a refusal's
 * sentence as `detail` (src/host/http-policy.ts), and `settle` shows it. A refusal that still arrives bare is
 * explained the old way: the planner checks inputs before sending and, after a refusal, reads the plan again to tell
 * which rule applied, then shows the rule's sentence from this list. `examBudget` and `examDetails` are the exam
 * form's own wording for two rules that the planning concept states in general terms, about a budget and a deadline.
 */
export const sentences = {
  courseUnavailable: "Choose one of your own courses.",
  examBudget: "Set a study budget for this course first.",
  examDetails: "Choose today or a future date and at least one covered skill.",
  examSkills: "Choose confirmed skills from this course, each once.",
  proposalGone: "Choose one of your proposed plans.",
  changeInProgress: "Finish or stop the current activity before changing plans.",
  proposalOutdated: "Review a new proposal based on the current budget, dates, and progress.",
  beginUnavailable: "Choose an unfinished activity from your active plan.",
  beginAnother: "Finish or stop the current activity first.",
  beginNotToday: "Choose an activity scheduled for today or update the plan.",
  beginBudget: "Update the plan or time budget before starting this activity.",
  refreshPending: "Your plan will update when you finish or stop your current activity.",
} as const;

/** A refused or failed planning request. `bare` means the server refused without saying why. */
export class PlanningFailure extends Error {
  constructor(message: string, readonly bare = false) { super(message); }
}

/** The answer when the request succeeded. A refusal or transport fault throws a PlanningFailure with a sentence for the learner. */
export function settle<T extends object>(result: T): Exclude<T, { error: unknown }> {
  if (!("error" in result)) return result as Exclude<T, { error: unknown }>;
  const failure = result as { error: unknown; detail?: unknown };
  const code = String(failure.error);
  const explained = typeof failure.detail === "string" && failure.detail.trim() !== "";
  // Every planning endpoint answers a course that is not the learner's with this sentence. Over HTTP it can arrive as a bare 403.
  if (code === "FORBIDDEN" && !explained) throw new PlanningFailure(sentences.courseUnavailable);
  throw new PlanningFailure(failureText(failure), code === "INVALID_REQUEST" && !explained);
}

/** Text for any failure: the PlanningFailure's sentence, or the transport message for a fault thrown by the browser. */
export function failureMessage(problem: unknown): string {
  return problem instanceof PlanningFailure ? problem.message : errorMessage("NETWORK_ERROR");
}

/** Whole days from `today` to `day`, both calendar days such as "2026-10-23". */
export function daysUntil(day: string, today: string): number | null {
  const from = dayNumber(today), to = dayNumber(day);
  return from === null || to === null ? null : to - from;
}

function dayNumber(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000 : null;
}

/** "Exam in 5 days", "Exam today", or "Exam date passed". */
export function examWhen(date: string, today: string): string {
  const days = daysUntil(date, today);
  if (days === null) return "Exam";
  if (days < 0) return "Exam date passed";
  if (days === 0) return "Exam today";
  return `Exam in ${days} ${days === 1 ? "day" : "days"}`;
}

/** The sentence for an exam the concept would refuse, or "" when the exam can be sent. */
export function examProblem(input: ExamInput, data: PlanData | null | undefined, skills: readonly CourseSkill[]): string {
  if (!data?.preferences) return sentences.examBudget;
  if (dayNumber(input.date) === null || input.date < data.today || !input.covered.length) return sentences.examDetails;
  const confirmed = new Set(skills.filter((skill) => skill.status === "CONFIRMED").map((skill) => skill.skill));
  if (new Set(input.covered).size !== input.covered.length || input.covered.some((skill) => !confirmed.has(skill))) return sentences.examSkills;
  return "";
}

/** Why SetExam was refused, from a fresh read taken after the refusal. */
export function examRefusal(input: ExamInput, read: PlanRead, skills: readonly CourseSkill[]): string {
  const problem = examProblem(input, read.data, skills);
  if (problem) return problem;
  const covered = new Set(input.covered);
  // The exam was saved and the plan refresh after it was refused. The exam stays; Update plan makes the proposal.
  if (read.exams.some((exam) => exam.date === input.date && exam.covered.length === covered.size && exam.covered.every((skill) => covered.has(skill)))) {
    return "Exam saved, but the plan could not update. Use Update plan to try again.";
  }
  return "The exam was not saved. Try again.";
}

/** Why RemoveExam was refused, from a fresh read taken after the refusal. */
export function removeRefusal(date: string, read: PlanRead): string {
  return read.exams.some((exam) => exam.date === date)
    ? "The exam was not removed. Try again."
    : "Exam removed, but the plan could not update. Use Update plan to try again.";
}

/** Why confirming or declining was refused, from the pending proposal in a fresh read. */
export function tradeoffRefusal(plan: string, fresh: Proposal | undefined, confirming: boolean): string {
  if (!fresh || fresh.plan !== plan) return sentences.proposalGone;
  if (confirming) { const reason = confirmReason(fresh); if (reason) return reason; }
  return "The plan did not change. Try again.";
}

/** Why a pending proposal cannot be confirmed now, or "" when it can. */
export function confirmReason(proposal: Proposal): string {
  if (proposal.sessionInProgress) return sentences.changeInProgress;
  if (!proposal.locallyCurrent || !proposal.contextCurrent) return sentences.proposalOutdated;
  return "";
}

/** Why Begin was refused, from a fresh read taken after the refusal. The checks follow the planning concept's begin rules. */
export function beginRefusal(item: string, data: PlanData): string {
  const next = data.next;
  if (next?.status === "IN_PROGRESS") return sentences.beginAnother;
  if (!next || next.item !== item) return sentences.beginUnavailable;
  if (next.day !== data.today) return sentences.beginNotToday;
  const left = data.budget?.remainingMinutes;
  if (typeof left === "number" && next.candidate.minutes > left) return sentences.beginBudget;
  // The item is today's, unfinished, and fits the budget, so the activity in progress is in another course.
  return sentences.beginAnother;
}
