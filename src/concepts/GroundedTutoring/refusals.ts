// Refusals from the GroundedTutoring specification.
export class InvalidLessonContent extends Error {
  readonly code = "INVALID_LESSON_CONTENT";
  constructor() { super("Provide a learning request and explanation."); this.name = "InvalidLessonContent"; }
}
export class InvalidLessonSources extends Error {
  readonly code = "INVALID_LESSON_SOURCES";
  constructor() { super("Use your readable sources from one course and cite their content."); this.name = "InvalidLessonSources"; }
}
export class InvalidTaskContent extends Error {
  readonly code = "INVALID_TASK_CONTENT";
  constructor() { super("Provide a practice question and its assessment requirements."); this.name = "InvalidTaskContent"; }
}
export class InvalidTaskSources extends Error {
  readonly code = "INVALID_TASK_SOURCES";
  constructor() { super("Use your readable sources from one course and cite their content."); this.name = "InvalidTaskSources"; }
}
export class ResponseSessionUnavailable extends Error {
  readonly code = "RESPONSE_SESSION_UNAVAILABLE";
  constructor() { super("Choose one of your open sessions."); this.name = "ResponseSessionUnavailable"; }
}
export class InvalidLearnerResponse extends Error {
  readonly code = "INVALID_LEARNER_RESPONSE";
  constructor() { super("Provide a response. Spoken responses need a transcript."); this.name = "InvalidLearnerResponse"; }
}
export class LessonAnswerUnavailable extends Error {
  readonly code = "LESSON_ANSWER_UNAVAILABLE";
  constructor() { super("Choose one of your open lessons."); this.name = "LessonAnswerUnavailable"; }
}
export class InvalidLessonAnswer extends Error {
  readonly code = "INVALID_LESSON_ANSWER";
  constructor() { super("Provide an explanation with references to this lesson's sources."); this.name = "InvalidLessonAnswer"; }
}
export class HintRequestUnavailable extends Error {
  readonly code = "HINT_REQUEST_UNAVAILABLE";
  constructor() { super("Choose one of your open practice tasks."); this.name = "HintRequestUnavailable"; }
}
export class HintTaskUnavailable extends Error {
  readonly code = "HINT_TASK_UNAVAILABLE";
  constructor() { super("Choose one of your open practice tasks."); this.name = "HintTaskUnavailable"; }
}
export class InvalidHintText extends Error {
  readonly code = "INVALID_HINT_TEXT";
  constructor() { super("Provide the hint text."); this.name = "InvalidHintText"; }
}
export class HintNotRequested extends Error {
  readonly code = "HINT_NOT_REQUESTED";
  constructor() { super("Wait for the learner to request help during an independent check."); this.name = "HintNotRequested"; }
}
export class TranscriptSessionUnavailable extends Error {
  readonly code = "TRANSCRIPT_SESSION_UNAVAILABLE";
  constructor() { super("Choose one of your open sessions."); this.name = "TranscriptSessionUnavailable"; }
}
export class TranscriptTurnUnavailable extends Error {
  readonly code = "TRANSCRIPT_TURN_UNAVAILABLE";
  constructor() { super("Choose a spoken response from this session."); this.name = "TranscriptTurnUnavailable"; }
}
export class InvalidConfirmedTranscript extends Error {
  readonly code = "INVALID_CONFIRMED_TRANSCRIPT";
  constructor() { super("Provide the text that was spoken."); this.name = "InvalidConfirmedTranscript"; }
}
export class AttemptReviewUnavailable extends Error {
  readonly code = "ATTEMPT_REVIEW_UNAVAILABLE";
  constructor() { super("Choose one of your open practice tasks."); this.name = "AttemptReviewUnavailable"; }
}
export class AttemptReviewChanged extends Error {
  readonly code = "ATTEMPT_REVIEW_CHANGED";
  constructor() { super("The conversation changed. Review the latest transcript."); this.name = "AttemptReviewChanged"; }
}
export class SessionCloseUnavailable extends Error {
  readonly code = "SESSION_CLOSE_UNAVAILABLE";
  constructor() { super("Choose one of your open sessions."); this.name = "SessionCloseUnavailable"; }
}
