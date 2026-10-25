import { InvalidLessonContent, InvalidLessonSources, InvalidTaskContent, InvalidTaskSources, ResponseSessionUnavailable, InvalidLearnerResponse, LessonAnswerUnavailable, InvalidLessonAnswer, HintRequestUnavailable, HintTaskUnavailable, InvalidHintText, HintNotRequested, TranscriptSessionUnavailable, TranscriptTurnUnavailable, InvalidConfirmedTranscript, AttemptReviewUnavailable, AttemptReviewChanged, SessionCloseUnavailable } from "./refusals.ts";
import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/GroundedTutoring.md" with { type: "text" };
import type { User } from "../Registering/Registering.ts";
import type { Material } from "../MaterialKeeping/MaterialKeeping.ts";
import type { Skill, Version } from "../SkillMapping.ts";
import { GroundedTutoring } from "./GroundedTutoring.ts";

/**
 * GroundedTutoring bound as the stage's instance: Learner is Registering.User, Material is Library.Material,
 * Topic is SkillMapping.Skill, and Definition is SkillMapping.Version.
 */
class LearnerTutoring extends GroundedTutoring<User, Material, Skill, Version> {}
export const groundedTutoring = registerConcept({
  class: LearnerTutoring, spec,
  refusals: {
    INVALID_LESSON_CONTENT: InvalidLessonContent,
    INVALID_LESSON_SOURCES: InvalidLessonSources,
    INVALID_TASK_CONTENT: InvalidTaskContent,
    INVALID_TASK_SOURCES: InvalidTaskSources,
    RESPONSE_SESSION_UNAVAILABLE: ResponseSessionUnavailable,
    INVALID_LEARNER_RESPONSE: InvalidLearnerResponse,
    LESSON_ANSWER_UNAVAILABLE: LessonAnswerUnavailable,
    INVALID_LESSON_ANSWER: InvalidLessonAnswer,
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
