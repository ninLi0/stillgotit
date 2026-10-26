import type { TutorRequest } from "../learning-data.ts";
import type { TutorCatalog, TutorChoice, TutorLevel, TutorModelOffer } from "../tutor-types.ts";

/** Levels always appear in this order. The browser and the catalog use these names; Gemini receives them in lowercase. */
export const TUTOR_LEVELS: readonly TutorLevel[] = Object.freeze(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
export const LEVEL_NAMES: Readonly<Record<TutorLevel, string>> = Object.freeze({ MINIMAL: "Minimal", LOW: "Low", MEDIUM: "Medium", HIGH: "High" });
/** The default entry when GEMINI_MODEL is unset. */
export const DEFAULT_TUTOR_MODEL = "gemini-3.8-flash";

type TutorModel = Readonly<Omit<TutorModelOffer, "appDefault" | "levels" | "slowLevels">> & { readonly levels: readonly TutorLevel[]; readonly slowLevels: readonly TutorLevel[] };
const row = (entry: TutorModel): TutorModel => Object.freeze({ ...entry, levels: Object.freeze([...entry.levels]), slowLevels: Object.freeze([...entry.slowLevels]) });

/**
 * The tutor catalog from design/compositions/Settings.md. Every model listed returns JSON matching a schema and reads PDFs and images.
 * Only Pro at High and Argon at High are marked "may not finish in time" until large-document timings are measured.
 */
export const TUTOR_MODELS: readonly TutorModel[] = Object.freeze([
  row({ model: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", description: "The fastest and lowest-cost model offered.",
    levels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultLevel: "MINIMAL", slowLevels: [],
    tradeoff: "It answers quickly but can miss detail in long or difficult material." }),
  row({ model: "gemini-3.8-flash", name: "Gemini 3.8 Flash", description: "A fast general model for lessons, practice, and feedback.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "MEDIUM", slowLevels: [],
    tradeoff: "It balances speed, cost, and care; raise the level for harder problems." }),
  row({ model: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (preview)", description: "A careful model for difficult material and grading.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "HIGH", slowLevels: ["HIGH"],
    tradeoff: "It is slower and costs more, and as a preview Google may change or withdraw it." }),
  row({ model: "gemini-4-argon", name: "Gemini 4 Argon", description: "Google's flagship reasoning model, for the hardest material and grading.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "MEDIUM", slowLevels: ["HIGH"],
    tradeoff: "It is the most capable model offered and the most expensive, and at High a long request may not finish in time." }),
]);

/** GEMINI_MODEL after trimming and removing a leading `models/`, or the built-in default when it is unset or blank. */
export function configuredModelName(value: string | undefined): string {
  return value?.trim().replace(/^models\//, "") || DEFAULT_TUTOR_MODEL;
}

// The offer is fixed for the life of the server process. GEMINI_MODEL names the default when this module loads; the
// server stops at startup if that name is not in the table (src/host/tutor-catalog.ts). The startup model-list check
// may withdraw entries once, before the server accepts requests. After that the computations below always read the
// same table, so each returns the same result for the same input within one process.
const defaultModel = configuredModelName(process.env.GEMINI_MODEL);
let offered: readonly TutorModel[] = TUTOR_MODELS;
let fixed = false;

/** Removes models the startup check found missing from Gemini's model list. Called at most once, before serving. The default stays. */
export function withdrawTutorModels(models: readonly string[]): void {
  if (fixed) throw new Error("The tutor catalog is already fixed for this server process.");
  fixed = true;
  offered = Object.freeze(TUTOR_MODELS.filter((entry) => entry.model === defaultModel || !models.includes(entry.model)));
}

const entryFor = (model: unknown) => typeof model === "string" ? offered.find((entry) => entry.model === model) : undefined;

/** The offered models in table order, with each entry's fields and a mark on the default entry. */
export function tutorCatalog(_input: Record<string, never>): TutorCatalog {
  return offered.map((entry) => ({ model: entry.model, name: entry.name, description: entry.description, levels: [...entry.levels],
    defaultLevel: entry.defaultLevel, slowLevels: [...entry.slowLevels], tradeoff: entry.tradeoff, appDefault: entry.model === defaultModel }));
}

/** The default model at that model's default level. */
export function defaultChoice(_input: Record<string, never>): TutorChoice {
  const entry = entryFor(defaultModel);
  if (!entry) throw new Error(`GEMINI_MODEL names ${defaultModel}, which is not an offered tutor model.`);
  return { model: entry.model, level: entry.defaultLevel };
}

/** Holds when model exactly matches the name of an offered model, including case. */
export function modelOffered({ model }: { model: string }): boolean {
  return entryFor(model) !== undefined;
}

/** Holds when model is offered and level is exactly one of the levels that model lists. */
export function levelSupported({ model, level }: { model: string; level: string }): boolean {
  return entryFor(model)?.levels.includes(level as TutorLevel) ?? false;
}

/** Pairs an offered model with a level it lists. Flows use it only after modelOffered and levelSupported hold. */
export function offeredChoice({ model, level }: { model: string; level: string }): TutorChoice {
  if (!levelSupported({ model, level })) throw new Error("Only an offered model and one of its levels can be chosen.");
  return { model, level: level as TutorLevel };
}

/** Holds when a saved choice's model is still offered and still lists the saved level. */
export function choiceOffered({ choice }: { choice: TutorChoice }): boolean {
  return typeof choice === "object" && choice !== null && levelSupported({ model: choice.model, level: choice.level });
}

/** Adds the validated model and thinking level to a prepared request and changes nothing else in it. */
export function withChoice({ request, choice }: { request: TutorRequest; choice: TutorChoice }): TutorRequest {
  if (!choiceOffered({ choice })) throw new Error("A tutor request can use only an offered model and one of its levels.");
  return { ...request, tutor: { model: choice.model, level: choice.level } };
}

/** The model and thinking level that a prepared request carried, so a response can say what produced its answer. */
export function requestChoice({ request }: { request: TutorRequest }): TutorChoice {
  if (!request.tutor) throw new Error("This tutor request carries no model and thinking level.");
  return { model: request.tutor.model, level: request.tutor.level };
}

/** Names the TutorStatus case: DEFAULT when nothing is saved, SAVED when the saved choice is still offered, RETIRED when it is not. */
export function tutorStatus({ saved, offered }: { saved: boolean; offered: boolean }): "SAVED" | "RETIRED" | "DEFAULT" {
  return !saved ? "DEFAULT" : offered ? "SAVED" : "RETIRED";
}
