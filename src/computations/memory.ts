// Computations for the memory read (design/compositions/LearningReads.md, "Memory curves") and the course score. They
// only place, compare and gather values that MasteryEstimating answers. None of them computes a score or a forgetting
// curve: every value on a curve comes from MasteryEstimating._estimate or MasteryEstimating._withoutPractice, and the
// review day comes from the explanation's due instant, placed on a calendar day by the plan request's own dueDay.
import type { EstimateExplanation } from "../concepts/MasteryEstimating/MasteryEstimating.ts";
import type { SkillRows, Tracks } from "../learning-data.ts";
import { averageEstimate } from "./course-score.ts";
import { daysFrom, dueDay, studyDate } from "./review-day.ts";

const DAY = 86_400_000;
/** The days after the read's instant at which each projection is sampled. */
export const SAMPLE_DAYS = [1, 3, 7, 14, 30, 60, 90] as const;
const after = (at: Date, days: number) => new Date(at.getTime() + days * DAY);
type Samples = { v1: number; v3: number; v7: number; v14: number; v30: number; v60: number; v90: number };
const sampleValues = (values: Samples) => [values.v1, values.v3, values.v7, values.v14, values.v30, values.v60, values.v90];

/** The read's instant, `d0`, and the instants whole days after it at which the projection is sampled. */
export function memoryInstants({ at }: { at: Date }) {
  return { d0: at, d1: after(at, 1), d3: after(at, 3), d7: after(at, 7), d14: after(at, 14), d30: after(at, 30), d60: after(at, 60), d90: after(at, 90) };
}

/**
 * The skill's review day (design/compositions/LearningReads.md, "The review day"): `day` is the calendar day in New York on
 * which the explanation's due instant falls, given by the dueDay the plan request uses, so the Memory view and the Plan
 * name the same day; `days` is the whole calendar days from the read's day to it, 0 when the memory is due later today.
 * `instant` is `days` whole days of 24 hours after `at`, where the projection's time line places that day, so the estimate
 * read there sits on the projected curve. When `due` is at or before `at` the memory is due now: the day is today, `days`
 * is 0 and `instant` is `at`, and memoryCurve answers no review day.
 */
export function reviewDay({ at, explanation }: { at: Date; explanation: EstimateExplanation }): { day: string; days: number; instant: Date } {
  const today = studyDate(at), day = dueDay(explanation.due, today), days = daysFrom(today, day);
  return { day, days, instant: after(at, days) };
}

/** One projected value: whole days after the read's instant, that instant, and the estimate then. */
export interface CurvePoint { days: number; at: Date; value: number }
/** The day to review a skill by: the calendar day, the calendar days until it, and the projected estimate on it. */
export interface ReviewPoint { day: string; days: number; value: number }
/** What the memory read says about one skill's curve. */
export interface MemoryCurve {
  estimate: number;
  projection: CurvePoint[];
  /** The calendar day the FSRS due instant falls on, or null when that instant has passed. */
  reviewBy: ReviewPoint | null;
  /** True when the due instant is at or before the read's instant. */
  belowNow: boolean;
}
/** Gathers the estimate now, the samples, and the review day with the estimate on it. */
export function memoryCurve({ at, explanation, day, days, reviewValue, ...values }: { at: Date; explanation: EstimateExplanation; day: string; days: number; reviewValue: number } & Samples): MemoryCurve {
  const projected = sampleValues(values);
  const belowNow = explanation.due.getTime() <= at.getTime();
  return {
    estimate: explanation.value,
    projection: SAMPLE_DAYS.map((sample, index) => ({ days: sample, at: after(at, sample), value: projected[index]! })),
    reviewBy: belowNow ? null : { day, days, value: reviewValue },
    belowNow,
  };
}

/** Days from the explanation's starting point to the read's instant and to each sample after it. */
export function leftAloneDays({ explanation, at }: { explanation: EstimateExplanation; at: Date }) {
  const since = (at.getTime() - explanation.replayStart.getTime()) / DAY;
  return { e0: since, e1: since + 1, e3: since + 3, e7: since + 7, e14: since + 14, e30: since + 30, e60: since + 60, e90: since + 90 };
}
/** The point on a left-alone curve: when, and the value then. */
export interface PathPoint { at: Date; value: number }
/**
 * The curve the skill would have followed from its starting point with no evidence and no adjustment: the starting
 * point, the read's instant, and each sample day after it, with the values _withoutPractice answered.
 */
export function leftAlonePath({ explanation, at, u0, ...values }: { explanation: EstimateExplanation; at: Date; u0: number } & Samples): PathPoint[] {
  const projected = sampleValues(values);
  return [{ at: explanation.replayStart, value: explanation.initialConfidence }, { at, value: u0 },
    ...SAMPLE_DAYS.map((days, index) => ({ at: after(at, days), value: projected[index]! }))];
}

/** The policy's reference curve from 100%: day 0 and each sample day, with the values _withoutPractice answered. */
export function referenceCurve({ v0, ...values }: { v0: number } & Samples): { days: number; value: number }[] {
  const projected = sampleValues(values);
  return [{ days: 0, value: v0 }, ...SAMPLE_DAYS.map((days, index) => ({ days, value: projected[index]! }))];
}

/**
 * A course's overall confidence: the average of the current estimates of its confirmed skills that have one, rounded to a
 * whole percent, with skills without an estimate left out. `skills` counts the confirmed skills, `estimated` those with an
 * estimate. The Forest view's course summary uses the same averageEstimate.
 */
export function courseScore({ skills, tracks }: { skills: SkillRows; tracks: Tracks }): { score: number | null; skills: number; estimated: number } {
  const confirmed = skills.filter((skill) => skill.status === "CONFIRMED");
  const values = confirmed.map((skill) => tracks.find((track) => track.subject === skill.skill && track.definition === skill.current)?.estimate?.value ?? null);
  return { score: averageEstimate(values), skills: confirmed.length, estimated: values.filter((value) => value !== null).length };
}
