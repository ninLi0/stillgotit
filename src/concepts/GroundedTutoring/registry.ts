import { InvalidLessonContent, InvalidLessonSources, InvalidTaskContent, InvalidTaskSources, ResponseSessionUnavailable, InvalidLearnerResponse, LessonAnswerUnavailable, InvalidLessonAnswer, FollowupTaskUnavailable, InvalidTaskProbe, ClarificationSessionUnavailable, InvalidInputClarification, HintRequestUnavailable, HintTaskUnavailable, InvalidHintText, HintNotRequested, TranscriptSessionUnavailable, TranscriptTurnUnavailable, InvalidConfirmedTranscript, AttemptReviewUnavailable, AttemptReviewChanged, SessionCloseUnavailable } from "./refusals.ts";
import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/GroundedTutoring.md" with { type: "text" };
import type { User } from "../Registering/Registering.ts";
import type { Course } from "../SkillMapping.ts";
import { GroundedTutoring, InvalidTutoringMaterial, InvalidMaterialImportKey, MaterialImportConflict } from "./GroundedTutoring.ts";

class MaterialStorage extends GroundedTutoring<User, Course> {}
export const groundedTutoring = registerConcept({
  class: MaterialStorage, spec,
  refusals: {
    INVALID_TUTORING_MATERIAL: InvalidTutoringMaterial,
    INVALID_MATERIAL_IMPORT_KEY: InvalidMaterialImportKey,
    MATERIAL_IMPORT_CONFLICT: MaterialImportConflict,
    INVALID_LESSON_CONTENT: InvalidLessonContent,
    INVALID_LESSON_SOURCES: InvalidLessonSources,
    INVALID_TASK_CONTENT: InvalidTaskContent,
    INVALID_TASK_SOURCES: InvalidTaskSources,
    RESPONSE_SESSION_UNAVAILABLE: ResponseSessionUnavailable,
    INVALID_LEARNER_RESPONSE: InvalidLearnerResponse,
    LESSON_ANSWER_UNAVAILABLE: LessonAnswerUnavailable,
    INVALID_LESSON_ANSWER: InvalidLessonAnswer,
    FOLLOWUP_TASK_UNAVAILABLE: FollowupTaskUnavailable,
    INVALID_TASK_PROBE: InvalidTaskProbe,
    CLARIFICATION_SESSION_UNAVAILABLE: ClarificationSessionUnavailable,
    INVALID_INPUT_CLARIFICATION: InvalidInputClarification,
    HINT_REQUEST_UNAVAILABLE: HintRequestUnavailable,
    HINT_TASK_UNAVAILABLE: HintTaskUnavailable,
    INVALID_HINT_TEXT: InvalidHintText,
    HINT_NOT_REQUESTED: HintNotRequested,
    TRANSCRIPT_SESSION_UNAVAILABLE: TranscriptSessionUnavailable,
    TRANSCRIPT_TURN_UNAVAILABLE: TranscriptTurnUnavailable,
    INVALID_CONFIRMED_TRANSCRIPT: InvalidConfirmedTranscript,
    ATTEMPT_REVIEW_UNAVAILABLE: AttemptReviewUnavailable,
    ATTEMPT_REVIEW_CHANGED: AttemptReviewChanged,
    SESSION_CLOSE_UNAVAILABLE: SessionCloseUnavailable,

  },
});
