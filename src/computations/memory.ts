// Computations for the memory read (design/compositions/LearningReads.md, "Memory curves") and the course score. They
// only place, compare and gather values that MasteryEstimating answers. None of them computes a score or a decay: every
// value on a curve comes from MasteryEstimating._estimate or MasteryEstimating._withoutPractice.
import type { EstimateExplanation } from "../concepts/MasteryEstimating/MasteryEstimating.ts";
import type { SkillRows, Tracks } from "../learning-data.ts";
import { averageEstimate } from "./course-score.ts";

const DAY = 86_400_000;
/** The days after the read's instant at which each projection is sampled. */
export const SAMPLE_DAYS = [1, 3, 7, 14, 30, 60, 90] as const;
/** How many whole days ahead the review search looks. */
export const SEARCH_DAYS = 180;
/** Binary search steps that narrow 0 to SEARCH_DAYS + 1 to one day. */
export const SEARCH_STEPS = Math.ceil(Math.log2(SEARCH_DAYS + 1));

const after = (at: Date, days: number) => new Date(at.getTime() + days * DAY);
type Samples = { v1: number; v3: number; v7: number; v14: number; v30: number; v60: number; v90: number };
const sampleValues = (values: Samples) => [values.v1, values.v3, values.v7, values.v14, values.v30, values.v60, values.v90];

/** The read's instant, `d0`, and the instants whole days after it at which the projection is sampled. */
export function memoryInstants({ at }: { at: Date }) {
  return { d0: at, d1: after(at, 1), d3: after(at, 3), d7: after(at, 7), d14: after(at, 14), d30: after(at, 30), d60: after(at, 60), d90: after(at, 90) };
}

/**
 * The review search. Without new evidence the projection never rises, so the first whole day below the threshold is
 * found by halving: `low` is a day known to be at or above it (0 stands for the read's instant), and `high` a day known
 * to be below it, or SEARCH_DAYS + 1 while none is known. `highValue` is the projection on day `high`.
 */
export interface ReviewSearch { at: Date; low: number; high: number; highValue: number | null }
export function reviewSearch({ at }: { at: Date }): ReviewSearch { return { at, low: 0, high: SEARCH_DAYS + 1, highValue: null }; }
const middle = (search: ReviewSearch) => (search.high - search.low > 1 ? Math.floor((search.low + search.high) / 2) : search.high);
/** The instant of the day the next step reads: the middle of the interval, or its end once the search has finished. */
export function reviewProbe({ search }: { search: ReviewSearch }): Date { return after(search.at, middle(search)); }
/** Keeps the half of the interval that still holds the first day below the threshold. A finished search stays as it is. */
export function reviewNarrow({ search, value, threshold }: { search: ReviewSearch; value: number; threshold: number }): ReviewSearch {
  if (search.high - search.low <= 1) return search;
  const day = middle(search);
  return value < threshold ? { ...search, high: day, highValue: value } : { ...search, low: day };
}

/** One projected value: whole days after the read's instant, that instant, and the estimate then. */
export interface CurvePoint { days: number; at: Date; value: number }
/** What the memory read says about one skill's curve. */
export interface MemoryCurve {
  estimate: number;
  projection: CurvePoint[];
  /** The first whole day on which the projection is below the threshold, or null when it is already below or holds for SEARCH_DAYS. */
  reviewBy: CurvePoint | null;
  belowNow: boolean;
}
/** Gathers the estimate now, the samples and the search's result. */
export function memoryCurve({ at, explanation, threshold, search, ...values }: { at: Date; explanation: EstimateExplanation; threshold: number; search: ReviewSearch } & Samples): MemoryCurve {
  const projected = sampleValues(values);
  const belowNow = explanation.value < threshold;
  const found = !belowNow && search.high <= SEARCH_DAYS && search.highValue !== null;
  return {
    estimate: explanation.value,
    projection: SAMPLE_DAYS.map((days, index) => ({ days, at: after(at, days), value: projected[index]! })),
    reviewBy: found ? { days: search.high, at: after(at, search.high), value: search.highValue! } : null,
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
