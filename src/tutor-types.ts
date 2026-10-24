import type { Material, MaterialData } from "./concepts/GroundedTutoring/GroundedTutoring.ts";
import type { Result } from "./concepts/AssessmentReviewing/AssessmentReviewing.ts";
export interface SkillSuggestion { title: string; outcome: string; gate: string }
export interface Suggestions { unitTitle: string; skills: SkillSuggestion[] }
export interface SourceContext { material: Material; data: MaterialData }
/** One marked question read from graded work. `skill` is empty when no listed skill fits. */
export interface ExtractedRow { label: string; mark: string; feedback: string; excerpt: string; skill: string; result: Result; rationale: string }
/** The confirmed skills an EXTRACT request may propose, in skill identity order. */
export interface ExtractContext { skills: { skill: string; title: string; outcome: string; gate: string }[] }
