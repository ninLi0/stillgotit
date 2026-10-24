import type { Material, MaterialData } from "./concepts/GroundedTutoring/GroundedTutoring.ts";
import type { Result } from "./concepts/AssessmentReviewing/AssessmentReviewing.ts";
export interface SkillSuggestion { title: string; outcome: string; gate: string }
export interface Suggestions { unitTitle: string; skills: SkillSuggestion[] }
export interface SourceContext { material: Material; data: MaterialData }

/** Gemini's thinking levels, in the order the catalog lists them. Gemini receives them in lowercase. */
export type TutorLevel = "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";

/** One offered tutor model and one thinking level that model lists, validated on the server against the catalog. */
export interface TutorChoice { model: string; level: TutorLevel }

/** One row of the tutor catalog, with a mark on the server's default model. */
export interface TutorModelOffer {
  /** The Gemini model name, for example gemini-3.8-flash. */
  model: string;
  /** The name shown to learners. */
  name: string;
  description: string;
  /** The levels the model accepts, in the order Minimal, Low, Medium, High. */
  levels: TutorLevel[];
  defaultLevel: TutorLevel;
  /** Levels at which a long request may not finish within the 80-second limit. */
  slowLevels: TutorLevel[];
  tradeoff: string;
  /** True for the entry that GEMINI_MODEL names ("App default"). */
  appDefault: boolean;
}

/** The offered tutor models in table order. */
export type TutorCatalog = TutorModelOffer[];

// A prepared TutorRequest (declared in learning-data.ts) carries the validated pair once withChoice has added it.
// The Gemini transport refuses a tutor request without it.
declare module "./learning-data.ts" {
  interface TutorRequest { tutor?: TutorChoice }
}
/** One marked question read from graded work. `skill` is empty when no listed skill fits. */
export interface ExtractedRow { label: string; mark: string; feedback: string; excerpt: string; skill: string; result: Result; rationale: string }
/** The confirmed skills an EXTRACT request may propose, in skill identity order. */
export interface ExtractContext { skills: { skill: string; title: string; outcome: string; gate: string }[] }
