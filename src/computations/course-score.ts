// The course's overall confidence, shared by the server's course score and the Forest view's course summary
// (frontend/src/ForestView.vue), so the two always agree. It reads nothing; callers pass the estimates.

/**
 * The average of the estimates that exist, rounded to a whole percent. A skill without an estimate passes null or
 * undefined and is left out rather than counted as 0. Null when no skill has an estimate.
 */
export function averageEstimate(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return known.length ? Math.round(known.reduce((sum, value) => sum + value, 0) / known.length) : null;
}
