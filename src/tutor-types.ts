import type { Material, MaterialData } from "./concepts/GroundedTutoring/GroundedTutoring.ts";
export interface SkillSuggestion { title: string; outcome: string; gate: string }
export interface Suggestions { unitTitle: string; skills: SkillSuggestion[] }
export interface SourceContext { material: Material; data: MaterialData }
