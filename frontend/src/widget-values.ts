// Numbers in a slider example (AnswerWidget.vue): where each slider may stop, and how its value and the formula's result
// read on the page. The page shows each value with as many decimals as its step has, so 0.1 + 0.2 reads 0.3, and the
// result with at most four decimals, so a long fraction stays short.

/** How many decimals a step has, such as 1 for 0.5 and 0 for 2, at most 6. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  const text = String(step);
  const exponent = /e-(\d+)$/.exec(text);
  if (exponent) return Math.min(6, Number(exponent[1]) + (text.split("e")[0]!.split(".")[1]?.length ?? 0));
  return Math.min(6, text.split(".")[1]?.length ?? 0);
}

/** The slider position nearest `value`: min plus a whole number of steps, never past min or max. */
export function snapToStep(value: number, min: number, max: number, step: number): number {
  if (!Number.isFinite(value)) return min;
  const steps = Math.round((Math.min(max, Math.max(min, value)) - min) / step);
  const snapped = Number((min + steps * step).toFixed(Math.max(stepDecimals(step), stepDecimals(min))));
  return snapped > max ? Number((snapped - step).toFixed(stepDecimals(step))) : snapped;
}

const minus = (text: string) => text.replace(/^-/, "−");

/** A slider's value as the page shows it, with its step's decimals and a true minus sign. */
export function formatSliderValue(value: number, step: number): string {
  return minus(value.toLocaleString("en-US", { minimumFractionDigits: stepDecimals(step), maximumFractionDigits: stepDecimals(step), useGrouping: false }));
}

/**
 * The formula's result as the page shows it: up to four decimals, trailing zeros dropped, and a very large or very small
 * number in scientific form, such as 1.23 × 10^9. A result that is not a real number reads as not defined.
 */
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) return "not defined for these values";
  if (value === 0) return "0";
  const size = Math.abs(value);
  if (size >= 1e9 || size < 1e-4) {
    const [mantissa, exponent] = value.toExponential(3).split("e");
    return `${minus(String(Number(mantissa)))} × 10^${minus(String(Number(exponent)))}`;
  }
  return minus(value.toLocaleString("en-US", { maximumFractionDigits: 4, useGrouping: true }));
}
