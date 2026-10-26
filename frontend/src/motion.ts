// Timing for the one choreographed moment (design/visual-design.md, "Motion"): when the evidence opens, the estimate
// line draws itself on the entrance curve, and each mark on it appears as the line reaches it. CSS eases the line;
// this works out when, on that same curve, the line arrives at a given share of its length.

export type Curve = readonly [number, number, number, number];

/** Reads a `cubic-bezier(...)` custom property of the page, such as `--ease-enter`, or null when there is none. */
export function readCurve(name: string): Curve | null {
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") return null;
  const text = getComputedStyle(document.documentElement).getPropertyValue(name);
  const match = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(text);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] : null;
}

/**
 * The share of an animation's duration, from 0 to 1, after which a CSS cubic-bezier timing function first reaches
 * `progress` (also 0 to 1). Without a curve, progress is linear in time. The curve's progress is found by bisection on
 * the curve's own parameter, which is exact enough for timing because the entrance curve never falls back.
 */
export function timeToReach(curve: Curve | null, progress: number): number {
  const target = Math.min(1, Math.max(0, progress));
  if (!curve) return target;
  const [x1, y1, x2, y2] = curve;
  const at = (a: number, b: number, s: number) => 3 * a * (1 - s) ** 2 * s + 3 * b * (1 - s) * s ** 2 + s ** 3;
  let low = 0, high = 1;
  for (let i = 0; i < 40; i++) { const mid = (low + high) / 2; if (at(y1, y2, mid) < target) low = mid; else high = mid; }
  return Math.min(1, Math.max(0, at(x1, x2, high)));
}
