// Geometry for the estimate-over-time chart on a skill's evidence panel (EstimateChart.vue). Every coordinate is a
// whole CSS pixel, so the SVG's edges stay crisp. The chart only places the concept's own values: the starting
// confidence, each change's value before and after, and the value now. It computes no score and no decay.

/** One point on the chart: the starting point, or one change from the estimate timeline. */
export type ChartKind = "START" | "ATTEMPT" | "ADJUSTMENT" | "TIME";
export type ChartPoint = {
  at: string; kind: ChartKind;
  /** The value just before the change, after time had lowered it; null for the starting point. */
  before: number | null;
  after: number;
  /** What happened, as the learner reads it, such as "Assessed attempt · Practice 2 · Independent success". */
  label: string;
};
export type ChartMarker = { index: number; point: ChartPoint; x: number; y: number; hit: number };
export type ChartLayout = {
  width: number; height: number;
  plot: { left: number; right: number; top: number; bottom: number };
  ticks: { value: number; y: number }[];
  path: string;
  markers: ChartMarker[];
  end: { x: number; y: number; value: number };
  axisY: number;
};

/** Fixed sizes in CSS pixels: 1.2 px per point of the 0 to 100 scale, gutters for the value labels, and the date row. */
export const CHART = { top: 12, plotHeight: 120, axis: 22, left: 32, right: 38, inset: 8, gap: 12, hit: 24 } as const;
/** The lines drawn across the plot: the leaf stages change at 35, 65 and 80 (pixel-art.ts, stageOf). */
export const THRESHOLDS = [80, 65, 35] as const;

const clamp = (value: number) => Math.max(0, Math.min(100, value));
export function valueY(value: number): number { return CHART.top + Math.round((100 - clamp(value)) * CHART.plotHeight / 100); }

/**
 * Horizontal positions: time runs left to right, the first point on the left edge and the last on the right. Points
 * closer than `gap` are pushed apart so each marker stays visible and reachable; if they cannot all fit, they are
 * spaced evenly in order instead.
 */
export function spread(times: readonly number[], left: number, right: number, gap: number): number[] {
  const n = times.length;
  if (n === 0) return [];
  if (n === 1) return [left];
  const first = times[0]!, span = times[n - 1]! - first;
  const even = () => times.map((_, i) => left + Math.round(i * (right - left) / (n - 1)));
  if (!(span > 0) || (n - 1) * gap > right - left) return even();
  const xs = times.map((t) => left + Math.round((t - first) / span * (right - left)));
  for (let i = 1; i < n; i++) xs[i] = Math.max(xs[i]!, xs[i - 1]! + gap);
  xs[n - 1] = right;
  for (let i = n - 2; i >= 0; i--) xs[i] = Math.min(xs[i]!, xs[i + 1]! - gap);
  return xs[0]! < left ? even() : xs;
}

/**
 * The path from (x0, y0) to (x1, y1) while time lowers the estimate: a falling stair of 2px steps spread over the gap,
 * the last step landing at x1. Time never raises the estimate, so a higher target only holds until x1.
 */
export function stairs(x0: number, y0: number, x1: number, y1: number): string {
  const drop = y1 - y0;
  if (drop <= 0) return ` H ${x1}`;
  const steps = Math.ceil(drop / 2);
  let d = "";
  for (let k = 1; k <= steps; k++) d += ` H ${x0 + Math.round(k * (x1 - x0) / steps)} V ${y0 + Math.round(k * drop / steps)}`;
  return d;
}

/** Lays the chart out for a box `width` pixels wide. `points` starts with the starting point, then the changes in order. */
export function layoutChart(points: readonly ChartPoint[], width: number): ChartLayout {
  const w = Math.max(200, Math.floor(width));
  const plot = { left: CHART.left, right: w - CHART.right, top: CHART.top, bottom: valueY(0) };
  const inner = { left: plot.left + CHART.inset, right: plot.right - CHART.inset };
  const xs = spread(points.map((p) => Date.parse(p.at)), inner.left, inner.right, CHART.gap);
  let path = "", level = points[0]?.after ?? 0;
  points.forEach((p, i) => {
    if (i === 0) { path = `M ${xs[0]} ${valueY(p.after)}`; return; }
    // Before an attempt or an adjustment, time had lowered the estimate to `before`; a time row ends at `after`.
    const lowered = p.kind === "TIME" ? p.after : p.before ?? level;
    path += stairs(xs[i - 1]!, valueY(level), xs[i]!, valueY(lowered)) + ` V ${valueY(p.after)}`;
    level = p.after;
  });
  if (points.length === 1) path += ` H ${inner.right}`;
  const last = points.length - 1;
  const end = { x: points.length > 1 ? xs[last]! : inner.right, y: valueY(level), value: level };
  // Markers for the starting point, each attempt and each adjustment. A marker's hit area is 24px, narrowed only so
  // it never covers its neighbour's.
  const marked = points.flatMap((point, index) => (point.kind === "TIME" ? [] : [{ index, point, x: xs[index]!, y: valueY(point.after) }]));
  const markers = marked.map((m, i) => {
    const near = Math.min(i > 0 ? m.x - marked[i - 1]!.x : Infinity, i < marked.length - 1 ? marked[i + 1]!.x - m.x : Infinity);
    const hit = Math.max(12, Math.min(CHART.hit, near));
    return { ...m, hit: hit - (hit % 2) };
  });
  return {
    width: w, height: plot.bottom + CHART.axis, plot, ticks: THRESHOLDS.map((value) => ({ value, y: valueY(value) })),
    path, markers, end, axisY: plot.bottom + 16,
  };
}
