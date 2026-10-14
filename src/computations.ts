/** The learner selects one imported material, which may contain several source files. */
export function singleMaterial({ material }: { material: string }): readonly string[] { return [material]; }

export function evidenceAttribution({ origin, rationale }: { origin: string; rationale: string }): string {
  return `${origin === "MANUAL" ? "Learner correction" : "AI assessment"}: ${rationale}`;
}
