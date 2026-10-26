// Geometry for the Memory view's three charts (MemoryView.vue, MemoryCurves.vue, MemoryShaped.vue): the default curve, every skill's
// projection, and one skill's path from its starting point. They share the estimate chart's scale, gutters and stairs
// (estimate-chart.ts), so every coordinate is a whole CSS pixel. Like that chart, these only place values the server
// answered: the policy's reference curve, each projection sample, the review day, and the curve left alone. Nothing
// here computes a score or a decay; between two answered values the line falls in the estimate chart's 2px stairs.

import { CHART, THRESHOLDS, spread, stairs, valueY, type ChartPoint } from "./estimate-chart.ts";
import { stageOf, type Stage } from "./pixel-art.ts";

/** The charts look this many days ahead, the last day the server samples. */
export const HORIZON = 90;
/** A value some whole days from the start of a curve, as the memory read answers it. */
export type DayValue = { days: number; value: number };
export type Point = { x: number; y: number };

/**
 * The line colour for each growth stage: one green, darker as the stage grows, so the order reads in the colour. Every
 * step is 4.2:1 or more on white, past the 3:1 a line needs; no text is drawn in these colours. Sprout and leaf are pixel-art.ts's G and g; full and bloom are the meadow text
 * tokens in style.css. A skill without an estimate (a bud) has no line.
 */
export const STAGE_LINES: Record<"sprout" | "leaf" | "full" | "bloom", string> = { sprout: "#2F8A5F", leaf: "#256F4C", full: "#1C5A37", bloom: "#0E3A22" };
/** The default curve, in pixel-art.ts's slate (5.52:1 on white, 5.05:1 on the pale band of the days ahead). Drawn under a
 * skill's own line it is 1 px wide instead of 2, so it recedes by its weight and keeps its contrast. */
export const DEFAULT_LINE = "#5C6B73";
/** The review threshold, in the coral that marks what needs attention (4.64:1 on white). */
export const THRESHOLD_LINE = "#C35124";
export function stageLine(value: number): string {
  const stage = stageOf(value) as Exclude<Stage, "bud" | "flag">;
  return STAGE_LINES[stage];
}

/** The plot box for a chart `width` pixels wide, with the estimate chart's gutters, scale and date row. */
export type Frame = { width: number; height: number; plot: { left: number; right: number; top: number; bottom: number }; inner: { left: number; right: number }; axisY: number };
export function chartFrame(width: number): Frame {
  const w = Math.max(240, Math.floor(width)), bottom = valueY(0);
  const plot = { left: CHART.left, right: w - CHART.right, top: CHART.top, bottom };
  return { width: w, height: bottom + CHART.axis, plot, inner: { left: plot.left + CHART.inset, right: plot.right - CHART.inset }, axisY: bottom + 16 };
}
/** The grid lines where the leaf stages change, as on the estimate chart, and the review threshold. */
export function gridLines(threshold: number) {
  return { ticks: THRESHOLDS.map((value) => ({ value, y: valueY(value) })), threshold: { value: threshold, y: valueY(threshold) } };
}
/** The x of a day between `from` (day 0) and `to` (day HORIZON). */
export function dayX(days: number, from: number, to: number): number {
  return from + Math.round(Math.max(0, Math.min(HORIZON, days)) / HORIZON * (to - from));
}

/**
 * A stepped line through `points` in order. A fall between two points is the estimate chart's stairs; a rise holds the
 * level and steps up at the later point, as an attempt or adjustment does. `lengths[i]` is how far along the line point i
 * sits, so a mark can appear as the line draws itself to it.
 */
export function steppedPath(points: readonly Point[]): { d: string; lengths: number[]; length: number } {
  if (!points.length) return { d: "", lengths: [], length: 0 };
  let d = `M ${points[0]!.x} ${points[0]!.y}`, length = 0;
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    d += b.y >= a.y ? stairs(a.x, a.y, b.x, b.y) : ` H ${b.x} V ${b.y}`;
    length += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
    lengths.push(length);
  }
  return { d, lengths, length };
}
const share = (part: number, whole: number) => (whole > 0 ? Math.min(1, part / whole) : 0);

/**
 * The opening card: the policy's reference curve over 0 to 90 days, the grid and the review threshold. `reach` gives how
 * far along the line each answered day sits, so a mark there can appear as the line draws itself to it.
 */
export function layoutDefault(reference: readonly DayValue[], threshold: number, width: number) {
  const frame = chartFrame(width), x = (days: number) => dayX(days, frame.inner.left, frame.inner.right);
  const points = [...reference].sort((a, b) => a.days - b.days);
  const line = steppedPath(points.map((p) => ({ x: x(p.days), y: valueY(p.value) })));
  const last = points.at(-1);
  const reach = new Map(points.map((p, i) => [p.days, share(line.lengths[i]!, line.length)]));
  return {
    frame, ...gridLines(threshold), path: line.d, reach,
    days: [0, 30, 60, 90].map((days) => ({ days, x: x(days) })),
    end: last ? { x: x(last.days), y: valueY(last.value), value: last.value } : null,
  };
}

/** One skill's curve as the "Your skills" chart needs it. */
export type SkillCurveInput = { skill: string; estimate: number; projection: readonly DayValue[]; reviewBy: DayValue | null };
/** A review day on the chart: one flag for every skill whose review falls on that day, with its label's lane under the threshold. */
export type ReviewFlag = { days: number; x: number; y: number; skills: string[]; label: string; lane: number; reach: number };

/**
 * Lanes for labels that sit side by side: each label goes in the first lane where it clears the label before it by
 * `gap`. Labels arrive in order of x; a label is centred on its x and kept inside `left` to `right`.
 */
export function assignLanes(labels: readonly { x: number; width: number }[], left: number, right: number, gap = 6): number[] {
  const ends: number[] = [];
  return labels.map(({ x, width }) => {
    const start = Math.min(Math.max(x - width / 2, left), right - width);
    let lane = ends.findIndex((end) => start >= end + gap);
    if (lane < 0) { lane = ends.length; ends.push(0); }
    ends[lane] = start + width;
    return lane;
  });
}
/** A label's width in pixels at the charts' 11px label size: a little more than the widest digit per character, plus padding. */
export const labelWidth = (text: string) => Math.ceil(text.length * 6.4) + 8;

/**
 * "Your skills": each skill's projection from today (day 0, its estimate now) through every sample, in its stage's
 * green, over the policy's reference curve. A skill's review day is a point on its own line, so the flag sits on it.
 * Skills reviewing on the same day share one flag and one label. `label` names a review day, such as "Nov 21".
 */
export function layoutSkills(skills: readonly SkillCurveInput[], reference: readonly DayValue[], threshold: number, width: number, label: (days: number) => string) {
  const frame = chartFrame(width), x = (days: number) => dayX(days, frame.inner.left, frame.inner.right);
  const referenceLine = steppedPath([...reference].sort((a, b) => a.days - b.days).map((p) => ({ x: x(p.days), y: valueY(p.value) })));
  const reaches = new Map<string, number>();
  const lines = skills.map((item) => {
    const marks = [{ days: 0, value: item.estimate }, ...item.projection.filter((p) => p.days <= HORIZON)];
    const review = item.reviewBy && item.reviewBy.days <= HORIZON ? item.reviewBy : null;
    if (review && !marks.some((p) => p.days === review.days)) marks.push(review);
    marks.sort((a, b) => a.days - b.days);
    const line = steppedPath(marks.map((p) => ({ x: x(p.days), y: valueY(p.value) })));
    if (review) reaches.set(item.skill, share(line.lengths[marks.findIndex((p) => p.days === review.days)]!, line.length));
    return { skill: item.skill, d: line.d, color: stageLine(item.estimate), start: { x: x(0), y: valueY(item.estimate) } };
  });
  // One flag per review day, in day order; its labels take lanes under the threshold line.
  const days = new Map<number, { value: number; skills: string[] }>();
  for (const item of skills) {
    const review = item.reviewBy;
    if (!review || review.days > HORIZON) continue;
    const day = days.get(review.days);
    if (day) { day.skills.push(item.skill); day.value = Math.max(day.value, review.value); } else days.set(review.days, { value: review.value, skills: [item.skill] });
  }
  const ordered = [...days].sort(([a], [b]) => a - b);
  const texts = ordered.map(([day]) => label(day));
  const lanes = assignLanes(ordered.map(([day], i) => ({ x: x(day), width: labelWidth(texts[i]!) })), frame.plot.left, frame.plot.right);
  const flags: ReviewFlag[] = ordered.map(([day, { value, skills: ids }], i) => ({
    days: day, x: x(day), y: valueY(value), skills: ids, label: texts[i]!, lane: lanes[i]!, reach: Math.min(...ids.map((id) => reaches.get(id) ?? 1)),
  }));
  return { frame, ...gridLines(threshold), reference: referenceLine.d, lines, flags, days: [0, 30, 60, 90].map((day) => ({ days: day, x: x(day) })) };
}

/** The share of the width the past takes on the "How your curve was shaped" chart: its part of the whole time, kept between a fifth and three fifths. */
export function pastShare(pastDays: number): number {
  const past = Math.max(0, pastDays);
  return Math.min(0.6, Math.max(0.2, past / (past + HORIZON)));
}
/** One point on the curve left alone: when, and the value then. */
export type TimedValue = { at: string; value: number };
export type ShapedInput = {
  /** The starting point, then every change in the explanation's order, as the evidence chart takes them. */
  past: readonly ChartPoint[];
  /** The memory read's instant: today, where the projection starts. */
  asOf: string;
  estimate: number;
  projection: readonly DayValue[];
  reviewBy: DayValue | null;
  /** The curve left alone: the starting point, today, then each sample day. */
  leftAlone: readonly TimedValue[];
  threshold: number;
};
export type ShapedMarker = { index: number; point: ChartPoint; x: number; y: number; hit: number; reach: number };

/**
 * "How your curve was shaped": the skill's past path from its starting point to today, as the evidence chart draws it,
 * continued by its projection, over the curve it would have followed left alone from the same starting point. The past
 * runs from the left edge to `split`, spread like the evidence chart so each mark stays reachable; the projection runs
 * from `split` to the right edge, a day to the same width throughout. The curve left alone is drawn through the same
 * places: its starting point, today, and each sample day.
 */
export function layoutShaped(input: ShapedInput, width: number) {
  const frame = chartFrame(width), today = Date.parse(input.asOf);
  const first = input.past[0], start = first ? Date.parse(first.at) : today;
  const pastDays = Math.max(0, (today - start) / 86_400_000);
  const split = frame.inner.left + Math.round(pastShare(pastDays) * (frame.inner.right - frame.inner.left));
  const future = (days: number) => dayX(days, split, frame.inner.right);
  // The past, placed like the evidence chart: time left to right, pushed apart where marks would touch.
  const xs = spread(input.past.map((p) => Math.min(Date.parse(p.at), today)), frame.inner.left, split, CHART.gap);
  const pastPoints: Point[] = [];
  let level = first?.after ?? input.estimate;
  input.past.forEach((p, i) => {
    if (i === 0) { pastPoints.push({ x: xs[0]!, y: valueY(p.after) }); return; }
    // Before an attempt or an adjustment, time had lowered the estimate to `before`; a time row ends at `after`.
    const lowered = p.kind === "TIME" ? p.after : p.before ?? level;
    pastPoints.push({ x: xs[i]!, y: valueY(lowered) });
    if (valueY(p.after) !== valueY(lowered)) pastPoints.push({ x: xs[i]!, y: valueY(p.after) });
    level = p.after;
  });
  // Today: the projection starts from the memory read's estimate.
  const todayPoint = { x: split, y: valueY(input.estimate) };
  const last = pastPoints.at(-1);
  if (!last || last.x !== split) pastPoints.push({ x: split, y: last ? last.y : todayPoint.y });
  const review = input.reviewBy && input.reviewBy.days <= HORIZON ? input.reviewBy : null;
  const ahead = [...input.projection.filter((p) => p.days <= HORIZON), ...(review && !input.projection.some((p) => p.days === review.days) ? [review] : [])]
    .sort((a, b) => a.days - b.days);
  const mine = steppedPath([...pastPoints, todayPoint, ...ahead.map((p) => ({ x: future(p.days), y: valueY(p.value) }))]);
  // Where each past point and the review day fall along the line, so their marks appear as it reaches them.
  const reachAt = (x: number, y: number) => {
    const at = [...pastPoints, todayPoint, ...ahead.map((p) => ({ x: future(p.days), y: valueY(p.value) }))].findIndex((p) => p.x === x && p.y === y);
    return at < 0 ? 1 : share(mine.lengths[at]!, mine.length);
  };
  const marked = input.past.flatMap((point, index) => (point.kind === "TIME" ? [] : [{ index, point, x: xs[index]!, y: valueY(point.after) }]));
  const markers: ShapedMarker[] = marked.map((m, i) => {
    const near = Math.min(i > 0 ? m.x - marked[i - 1]!.x : Infinity, i < marked.length - 1 ? marked[i + 1]!.x - m.x : Infinity);
    const hit = Math.max(12, Math.min(CHART.hit, near));
    return { ...m, hit: hit - (hit % 2), reach: reachAt(m.x, m.y) };
  });
  // The curve left alone: its starting point at the left edge, today at the split, then each sample day.
  const alone = input.leftAlone.map((p, i) => ({
    x: i === 0 ? frame.inner.left : i === 1 ? split : future(Math.round((Date.parse(p.at) - today) / 86_400_000)),
    y: valueY(p.value),
  }));
  const flag = review ? { x: future(review.days), y: valueY(review.value), days: review.days, reach: reachAt(future(review.days), valueY(review.value)) } : null;
  return {
    frame, ...gridLines(input.threshold), split, path: mine.d, leftAlone: steppedPath(alone).d, markers, flag, todayReach: reachAt(todayPoint.x, todayPoint.y),
    end: { x: frame.inner.right, y: valueY(ahead.at(-1)?.value ?? input.estimate) },
  };
}

/** Where a skill's review falls, as the "Review by" list sorts it. */
export type ReviewStanding = "DUE" | "COMING" | "HOLDS" | "UNSTARTED";
export type ReviewRow = { skill: string; title: string; estimate: number | null; reviewBy: { days: number } | null; belowNow: boolean | null };
export function standing(row: ReviewRow): ReviewStanding {
  if (row.estimate === null) return "UNSTARTED";
  if (row.belowNow) return "DUE";
  return row.reviewBy && row.reviewBy.days <= HORIZON ? "COMING" : "HOLDS";
}
const ORDER: Record<ReviewStanding, number> = { DUE: 0, COMING: 1, HOLDS: 2, UNSTARTED: 3 };
/**
 * The "Review by" list's order: skills already due first, lowest estimate first; then the coming reviews, soonest first;
 * then the skills that hold past the chart's last day; then the skills without a starting point. Ties keep title order.
 */
export function reviewOrder<T extends ReviewRow>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => {
    const sa = standing(a), sb = standing(b);
    if (sa !== sb) return ORDER[sa] - ORDER[sb];
    const by = sa === "DUE" ? a.estimate! - b.estimate! : sa === "COMING" ? a.reviewBy!.days - b.reviewBy!.days : 0;
    return by || a.title.localeCompare(b.title) || (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0);
  });
}
