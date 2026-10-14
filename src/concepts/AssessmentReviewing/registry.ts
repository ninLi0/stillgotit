import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/AssessmentReviewing.md" with { type: "text" };
import { AssessmentReviewing } from "./AssessmentReviewing.ts";
import * as refusal from "./refusals.ts";

export const assessmentReviewing = registerConcept({
  class: AssessmentReviewing, spec, refusals: {
    INVALID_ASSESSMENT_WORK: refusal.InvalidAssessmentWork,
    ASSESSMENT_SOURCE_USED: refusal.AssessmentSourceUsed,
    ASSESSMENT_TASK_USED: refusal.AssessmentTaskUsed,
    ASSESSMENT_CASE_UNAVAILABLE: refusal.AssessmentCaseUnavailable,
    ASSESSMENT_ALREADY_JUDGED: refusal.AssessmentAlreadyJudged,
    INVALID_INITIAL_JUDGMENT: refusal.InvalidInitialJudgment,
    INVALID_GRADED_WORK: refusal.InvalidGradedWork,
    GRADED_SOURCE_USED: refusal.GradedSourceUsed,
    INVALID_IMPORTED_JUDGMENT: refusal.InvalidImportedJudgment,
    CLARIFICATION_CASE_UNAVAILABLE: refusal.ClarificationCaseUnavailable,
    INVALID_WORK_CLARIFICATION: refusal.InvalidWorkClarification,
    REVISION_CASE_UNAVAILABLE: refusal.RevisionCaseUnavailable,
    JUDGMENT_REVISION_OUTDATED: refusal.JudgmentRevisionOutdated,
    INVALID_REVISED_JUDGMENT: refusal.InvalidRevisedJudgment,
  },
});
