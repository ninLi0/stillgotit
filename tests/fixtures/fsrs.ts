// The tests' own copy of FSRS-6 as policy fsrs-1 uses it (design/concepts/MasteryEstimating.md), written from the
// published formulas and independent of the concept's code, so a test can compute the numbers it expects.
export const W = [0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796,
  1.4835, 0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542];
export const DECAY = -W[20]!;
export const FACTOR = Math.pow(0.9, 1 / DECAY) - 1;
export const DAY = 86_400_000;
export type Grade = 1 | 2 | 3 | 4;
export interface Memory { stability: number; difficulty: number }

const between = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
/** Retention after `t` days at stability `s`. */
export const R = (t: number, s: number) => Math.pow(1 + FACTOR * t / s, DECAY);
/** Stability of a first rating. */
export const S0 = (g: Grade) => W[g - 1]!;
/** Difficulty of a first rating, before clamping. */
export const D0raw = (g: Grade) => W[4]! - Math.exp(W[5]! * (g - 1)) + 1;
/** Difficulty of a first rating, clamped to 1 through 10. */
export const D0 = (g: Grade) => between(D0raw(g), 1, 10);
/** The first rating a starting confidence stands for. */
export const g0 = (c: number): Grade => (c >= 80 ? 4 : c >= 50 ? 3 : c >= 20 ? 2 : 1);
/** The memory a starting confidence seeds. */
export const seed = (c: number): Memory => ({ stability: S0(g0(c)), difficulty: D0(g0(c)) });
/** Difficulty after a review: linear damping, then mean reversion toward the unclamped D0(4), then clamping. */
export const nextD = (d: number, g: Grade) => between(W[7]! * D0raw(4) + (1 - W[7]!) * (d - W[6]! * (g - 3) * (10 - d) / 9), 1, 10);
/** The factor a successful review (grade 2 to 4) after `t` >= 1 days multiplies stability by. */
export const successFactor = (s: number, d: number, t: number, g: Grade) =>
  Math.exp(W[8]!) * (11 - d) * Math.pow(s, -W[9]!) * (Math.exp((1 - R(t, s)) * W[10]!) - 1) * (g === 2 ? W[15]! : 1) * (g === 4 ? W[16]! : 1) + 1;
/** Stability after a lapse after `t` >= 1 days: the long-term formula, capped by the short-term bound. */
export const lapseS = (s: number, d: number, t: number) =>
  Math.min(W[11]! * Math.pow(d, -W[12]!) * (Math.pow(s + 1, W[13]!) - 1) * Math.exp((1 - R(t, s)) * W[14]!), s / Math.exp(W[17]! * W[18]!));
/** Stability after a same-day review (`t` < 1). Good and Easy never lower it. */
export const sameDayS = (s: number, g: Grade) => {
  const increase = Math.exp(W[17]! * (g - 3 + W[18]!)) * Math.pow(s, -W[19]!);
  return s * (g >= 3 ? Math.max(increase, 1) : increase);
};
/** One review with grade `g` after `t` days: stability from the memory before it, then difficulty. */
export function review(memory: Memory, g: Grade, t: number): Memory {
  const { stability: s, difficulty: d } = memory;
  const stability = t < 1 ? sameDayS(s, g) : g === 1 ? lapseS(s, d, t) : s * successFactor(s, d, t, g);
  return { stability: between(stability, 0.001, 36_500), difficulty: nextD(d, g) };
}
/** The grade of a signal: fresh INDEPENDENT is Good, fresh SUPPORTED and SLIP are Hard, GAP is Again. */
export const gradeOf = (signal: "INDEPENDENT" | "SUPPORTED" | "SLIP" | "GAP"): Grade => (signal === "GAP" ? 1 : signal === "INDEPENDENT" ? 3 : 2);
/** Days between two instants, as the concept counts them. */
export const daysBetween = (later: Date | number, earlier: Date | number) => (Number(later) - Number(earlier)) / DAY;
/** The value a starting confidence reaches after `t` days left alone. */
export const leftAlone = (c: number, t: number) => c * R(Math.max(0, t), S0(g0(c)));
