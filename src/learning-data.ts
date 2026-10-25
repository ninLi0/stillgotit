import type { SkillMapping } from "./concepts/SkillMapping.ts";
import type { GroundedTutoring } from "./concepts/GroundedTutoring/GroundedTutoring.ts";
import type { AssessmentReviewing, Result } from "./concepts/AssessmentReviewing/AssessmentReviewing.ts";
import type { MasteryEstimating } from "./concepts/MasteryEstimating/MasteryEstimating.ts";
import type { Budgeting } from "./concepts/Budgeting/Budgeting.ts";
import type { PassageSet, MaterialSet } from "./concepts/GroundedTutoring/dialogue.ts";
import type { MediaList } from "./media.ts";
import type { ExtractedRow, SourceContext, Suggestions } from "./tutor-types.ts";
export type SkillRows = Awaited<ReturnType<SkillMapping["_map"]>>["skills"];
export type SkillInfo = SkillRows[number];
export type Sessions = Awaited<ReturnType<GroundedTutoring["_study"]>>["sessions"];
export type StudySession = Sessions[number];
export type Cases = Awaited<ReturnType<AssessmentReviewing["_history"]>>["cases"];
export type CaseInfo = Cases[number];
export type Tracks = Awaited<ReturnType<MasteryEstimating["_progress"]>>["tracks"];
export type Schedule = Awaited<ReturnType<Budgeting["_schedule"]>>["schedule"];
export interface TutorRequest {
  kind: "SUGGEST" | "LESSON" | "TASK" | "REPLY" | "HINT" | "GRADE" | "EXTRACT";
  sources: SourceContext[]; context: unknown; work: MediaList; definition?: string; criteria?: string;
}
export interface TutorAnswer {
  text: string; citations: PassageSet; materials: MaterialSet;
  result: Result; gateMet: boolean; rationale: string; suggestions: Suggestions;
  /** Validated EXTRACT rows in the tutor's order; empty for every other kind. */
  rows: ExtractedRow[];
}
