import { configuredModelName, TUTOR_MODELS } from "../computations/tutor.ts";
import type { Gemini } from "./gemini.ts";

/**
 * GEMINI_MODEL must be unset or name an offered model, because the server cannot know which thinking levels an unlisted
 * model accepts. The server stops at startup with this message instead of serving an invalid default.
 */
export function checkConfiguredModel(value: string | undefined): { ok: true; model: string } | { ok: false; message: string } {
  const model = configuredModelName(value);
  if (TUTOR_MODELS.some((entry) => entry.model === model)) return { ok: true, model };
  const offered = TUTOR_MODELS.map((entry) => entry.model).join(", ");
  return { ok: false, message: `GEMINI_MODEL is ${JSON.stringify(value)}, which is not an offered tutor model. Set it to one of ${offered}, or leave it unset to use ${configuredModelName(undefined)}.` };
}

/**
 * The startup check against Gemini's model list. Returns the offered models to withdraw: those the list lacks or that do not
 * support generateContent. It withdraws nothing when the list cannot be read completely, and never the default model.
 */
export async function checkModelList({ gemini, defaultModel, timeoutMs, log = console }: {
  gemini: Pick<Gemini, "listModels" | "status">; defaultModel: string; timeoutMs?: number; log?: Pick<Console, "log" | "warn">;
}): Promise<string[]> {
  if (!gemini.status().available) return [];
  const listed = await gemini.listModels({ timeoutMs });
  if (!listed) {
    log.warn("Gemini's model list could not be read completely at startup, so every tutor model stays offered.");
    return [];
  }
  if (!listed.has(defaultModel)) {
    log.warn(`Gemini's model list lacks the default tutor model ${defaultModel}. It stays offered, and tutor requests that use it will be refused until Google lists it again.`);
  }
  const withdrawn = TUTOR_MODELS.map((entry) => entry.model).filter((model) => model !== defaultModel && !listed.has(model));
  if (withdrawn.length) log.log(`Tutor models withdrawn because Gemini's model list lacks them: ${withdrawn.join(", ")}.`);
  return withdrawn;
}
