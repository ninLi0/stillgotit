import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";
import { homeViewRefusals, tutorRefusals } from "../compositions/settings.ts";
import { assessmentReviewing } from "../concepts/AssessmentReviewing/registry.ts";
import { commonsFederating } from "../concepts/Federating/registry.ts";
import { generating } from "../concepts/Generating/registry.ts";
import { groundedTutoring } from "../concepts/GroundedTutoring/registry.ts";
import { materialKeeping } from "../concepts/MaterialKeeping/registry.ts";
import { masteryEstimating } from "../concepts/MasteryEstimating/registry.ts";
import { registering } from "../concepts/Registering/registry.ts";
import { sessioning } from "../concepts/Sessioning/registry.ts";
import { skillMapping } from "../concepts/SkillMapping.registry.ts";
import { budgeting } from "../concepts/Budgeting/registry.ts";

export const SESSION_COOKIE = "__Host-stillgotit-session";
export const ATTEMPT_COOKIE = "__Host-stillgotit-sign-in";
export const BODY_LIMIT = 16_384;

export function stillGotItPolicy(publicOrigin: string, requestBodyBytes = BODY_LIMIT) {
  return httpPolicy({
    publicOrigin,
    basePath: "/api",
    requestOrigins: { allowed: [publicOrigin], requireOrigin: true },
    limits: { requestBodyBytes },
    publicErrors: {
      SKILL_CHANGED: "CONFLICT",
      SESSION_CHANGED: "CONFLICT",
      ACTIVITY_BEGIN_UNAVAILABLE: "INVALID_REQUEST",
      ACTIVITY_EXCEEDS_REMAINING_BUDGET: "INVALID_REQUEST",
      ACTIVITY_FINISH_UNAVAILABLE: "INVALID_REQUEST",
      ACTIVITY_MISS_TOO_EARLY: "INVALID_REQUEST",
      ACTIVITY_MISS_UNAVAILABLE: "INVALID_REQUEST",
      ACTIVITY_NOT_SCHEDULED_TODAY: "INVALID_REQUEST",
      ACTIVITY_STOP_UNAVAILABLE: "INVALID_REQUEST",
      ADJUSTMENT_KEY_CONFLICT: "CONFLICT",
      ADJUSTMENT_TRACK_UNAVAILABLE: "INVALID_REQUEST",
      ANOTHER_ACTIVITY_IN_PROGRESS: "INVALID_REQUEST",
      ASSESSMENT_ALREADY_JUDGED: "INVALID_REQUEST",
      ASSESSMENT_CASE_UNAVAILABLE: "INVALID_REQUEST",
      ASSESSMENT_SOURCE_USED: "INVALID_REQUEST",
      ASSESSMENT_TASK_USED: "INVALID_REQUEST",
      ATTEMPT_REVIEW_CHANGED: "INVALID_REQUEST",
      ATTEMPT_REVIEW_UNAVAILABLE: "INVALID_REQUEST",
      CLARIFICATION_CASE_UNAVAILABLE: "INVALID_REQUEST",
      DEADLINE_PREFERENCES_UNAVAILABLE: "INVALID_REQUEST",
      DEADLINE_REMOVE_UNAVAILABLE: "INVALID_REQUEST",
      DEADLINE_TRADEOFF_CONFIRMATION_REQUIRED: "INVALID_REQUEST",
      EVIDENCE_DATE_MISMATCH: "INVALID_REQUEST",
      EVIDENCE_REVISION_NOT_NEW: "INVALID_REQUEST",
      EVIDENCE_TRACK_MISMATCH: "INVALID_REQUEST",
      EVIDENCE_TRACK_UNAVAILABLE: "INVALID_REQUEST",
      EXAM_SKILLS_UNAVAILABLE: "INVALID_REQUEST",
      // http.ts adds the tutor's reason as `detail`, so the learner sees why and can retry.
      GENERATION_FAILED: "INVALID_REQUEST",
      GRADED_DATE_FUTURE: "INVALID_REQUEST",
      GRADED_DATE_INVALID: "INVALID_REQUEST",
      GRADED_HELP_CONFLICT: "INVALID_REQUEST",
      GRADED_MARKS_MISSING: "INVALID_REQUEST",
      GRADED_MATERIAL_NOT_SOURCE: "INVALID_REQUEST",
      GRADED_ROW_INVALID: "INVALID_REQUEST",
      GRADED_ROW_UNMAPPED: "INVALID_REQUEST",
      GRADED_SKILL_UNAVAILABLE: "INVALID_REQUEST",
      GRADED_SKILLS_UNAVAILABLE: "INVALID_REQUEST",
      GRADED_SOURCE_USED: "INVALID_REQUEST",
      HINT_NOT_REQUESTED: "INVALID_REQUEST",
      HINT_REQUEST_UNAVAILABLE: "INVALID_REQUEST",
      HINT_TASK_UNAVAILABLE: "INVALID_REQUEST",
      INVALID_ADJUSTMENT_KEY: "INVALID_REQUEST",
      IMPORTED_GATE_UNAVAILABLE: "INVALID_REQUEST",
      INVALID_ASSESSMENT_WORK: "INVALID_REQUEST",
      INVALID_CONFIRMED_TRANSCRIPT: "INVALID_REQUEST",
      INVALID_DAILY_BUDGET: "INVALID_REQUEST",
      INVALID_DEADLINE_DETAILS: "INVALID_REQUEST",
      INVALID_FINISH_TIME: "INVALID_REQUEST",
      INVALID_GRADED_WORK: "INVALID_REQUEST",
      INVALID_HINT_TEXT: "INVALID_REQUEST",
      INVALID_IMPORTED_JUDGMENT: "INVALID_REQUEST",
      INVALID_INITIAL_CONFIDENCE: "INVALID_REQUEST",
      INVALID_INITIAL_JUDGMENT: "INVALID_REQUEST",
      INVALID_LEARNER_RESPONSE: "INVALID_REQUEST",
      INVALID_LESSON_ANSWER: "INVALID_REQUEST",
      INVALID_LESSON_CONTENT: "INVALID_REQUEST",
      INVALID_LESSON_SOURCES: "INVALID_REQUEST",
      INVALID_MASTERY_ADJUSTMENT: "INVALID_REQUEST",
      INVALID_MASTERY_EVIDENCE: "INVALID_REQUEST",
      INVALID_PLAN_INPUT: "INVALID_REQUEST",
      INVALID_REVISED_JUDGMENT: "INVALID_REQUEST",
      INVALID_STOP_TIME: "INVALID_REQUEST",
      INVALID_TASK_CONTENT: "INVALID_REQUEST",
      INVALID_TASK_SOURCES: "INVALID_REQUEST",
      INVALID_WORK_CLARIFICATION: "INVALID_REQUEST",
      JUDGMENT_REVISION_OUTDATED: "INVALID_REQUEST",
      LESSON_ANSWER_UNAVAILABLE: "INVALID_REQUEST",
      MASTERY_TRACK_EXISTS: "INVALID_REQUEST",
      PLAN_DECLINE_UNAVAILABLE: "INVALID_REQUEST",
      PLAN_PREFERENCES_UNAVAILABLE: "INVALID_REQUEST",
      PLAN_SESSION_IN_PROGRESS: "INVALID_REQUEST",
      PROPOSAL_UNAVAILABLE: "INVALID_REQUEST",
      REGRADE_IMPORTED_UNAVAILABLE: "INVALID_REQUEST",
      RESPONSE_SESSION_UNAVAILABLE: "INVALID_REQUEST",
      REVISION_CASE_UNAVAILABLE: "INVALID_REQUEST",
      ROUTINE_PLAN_OUTDATED: "INVALID_REQUEST",
      ROUTINE_PLAN_UNAVAILABLE: "INVALID_REQUEST",
      ROUTINE_SESSION_IN_PROGRESS: "INVALID_REQUEST",
      SESSION_CLOSE_UNAVAILABLE: "INVALID_REQUEST",
      SESSION_UNAVAILABLE: "INVALID_REQUEST",
      SKILL_UNAVAILABLE: "INVALID_REQUEST",
      TRADEOFF_CONFIRMATION_NOT_NEEDED: "INVALID_REQUEST",
      TRADEOFF_PLAN_OUTDATED: "INVALID_REQUEST",
      TRADEOFF_PLAN_UNAVAILABLE: "INVALID_REQUEST",
      TRADEOFF_SESSION_IN_PROGRESS: "INVALID_REQUEST",
      TRANSCRIPT_SESSION_UNAVAILABLE: "INVALID_REQUEST",
      TRANSCRIPT_TURN_UNAVAILABLE: "INVALID_REQUEST",
      // ChooseTutor refusals. Nothing is saved; the learner chooses again from the Tutor panel.
      UNKNOWN_TUTOR_MODEL: "INVALID_REQUEST",
      UNSUPPORTED_THINKING_LEVEL: "INVALID_REQUEST",
      // The SetHomeView refusal. Nothing is saved; the learner chooses the skill tree or the task list.
      UNKNOWN_HOME_VIEW: "INVALID_REQUEST",

      NOT_SIGNED_IN: "UNAUTHORIZED",
      SIGN_IN_EXPIRED: "FORBIDDEN",
      SIGN_IN_REFUSED: "FORBIDDEN",
      NOT_CONFIRMED: "FORBIDDEN",
      ALREADY_LINKED: "CONFLICT",
      INVALID_USERNAME: "INVALID_REQUEST",
      USERNAME_TAKEN: "CONFLICT",
      RECOVERY_KEY_CONFLICT: "CONFLICT",
      INVALID_COURSE_TITLE: "INVALID_REQUEST",
      COURSE_UNAVAILABLE: "FORBIDDEN",
      MATERIAL_UNAVAILABLE: "FORBIDDEN",
      GRADED_MATERIAL_UNAVAILABLE: "FORBIDDEN",
      INVALID_TUTORING_MATERIAL: "INVALID_REQUEST",
      INVALID_MATERIAL_IMPORT_KEY: "INVALID_REQUEST",
      MATERIAL_IMPORT_CONFLICT: "CONFLICT",
      UNIT_COURSE_UNAVAILABLE: "FORBIDDEN",
      INVALID_UNIT_TITLE: "INVALID_REQUEST",
      PROPOSAL_UNIT_UNAVAILABLE: "FORBIDDEN",
      INVALID_SKILL_PROPOSAL: "INVALID_REQUEST",
      INVALID_SKILL_PROPOSAL_KEY: "INVALID_REQUEST",
      SKILL_CONFIRM_UNAVAILABLE: "CONFLICT",
      SKILL_SOURCE_REQUIRED: "INVALID_REQUEST",
      DRAFT_REVISION_UNAVAILABLE: "CONFLICT",
      DRAFT_UNIT_MISMATCH: "INVALID_REQUEST",
      INVALID_DRAFT_CONTENT: "INVALID_REQUEST",
      UNIT_EMPHASIS_UNAVAILABLE: "FORBIDDEN",
      SKILL_DETAILS_UNAVAILABLE: "CONFLICT",
      SKILL_UNIT_MISMATCH: "INVALID_REQUEST",
      INVALID_SKILL_TITLE: "INVALID_REQUEST",
      SKILL_DEFINITION_UNAVAILABLE: "CONFLICT",
      INVALID_SKILL_DEFINITION: "INVALID_REQUEST",
      SKILL_DEFINITION_UNCHANGED: "CONFLICT",
      SKILL_MATERIAL_UNAVAILABLE: "CONFLICT",
      SKILL_PREREQUISITES_UNAVAILABLE: "CONFLICT",
      INVALID_SKILL_PREREQUISITES: "INVALID_REQUEST",
      SKILL_ARCHIVE_UNAVAILABLE: "CONFLICT",
      SKILL_STILL_REQUIRED: "CONFLICT",
      SKILL_RESTORE_UNAVAILABLE: "CONFLICT",
      SKILL_RESTORE_PREREQUISITES: "CONFLICT",
    },
    cookies: {
      session: {
        name: "stillgotit-session", input: "session",
        issue: ["/auth/commons/resume", "/auth/commons/choose"].map((path) =>
          ({ path, value: "session", expires: "expiresAt" })),
        clear: ["/auth/logout"],
      },
      signIn: {
        name: "stillgotit-sign-in", input: "attempt",
        issue: [{ path: "/auth/commons/start", value: "attempt", expires: "expiresAt" }],
        clear: ["/auth/commons/resume", "/auth/commons/choose"],
      },
    },
  });
}

// The adapter sends a refusal only as its public category above, so http.ts adds the refusal's sentence as `detail`.
// A concept's sentences come from its specification, which states the same sentence its refusal class carries.
const conceptSentences: Readonly<Record<string, string>> = Object.fromEntries(
  [registering, commonsFederating, sessioning, skillMapping, materialKeeping, groundedTutoring, assessmentReviewing, masteryEstimating, budgeting, generating]
    .flatMap(({ specification }) => specification.actions.flatMap(({ refusals }) => refusals.map(({ code, message }) => [code, message]))));

/**
 * The sentence for each refusal code, on every endpoint that answers it. The engine keeps only the code of a
 * composition's answer, so the compositions' sentences are restated here from their designs.
 */
export const refusalDetails: Readonly<Record<string, string>> = {
  ...conceptSentences,
  // Planning.md.
  EXAM_SKILLS_UNAVAILABLE: "Choose confirmed skills from this course, each once.",
  PROPOSAL_UNAVAILABLE: "Choose one of your proposed plans.",
  // Settings.md: the two ChooseTutor refusals and the SetHomeView refusal.
  ...tutorRefusals,
  ...homeViewRefusals,
  // Importing.md: Confirm's checks. GRADED_SOURCE_USED is AssessmentReviewing's own refusal, so its sentence comes from the concept.
  GRADED_DATE_INVALID: "Enter the date the work was performed.",
  GRADED_DATE_FUTURE: "The performance date cannot be after today.",
  GRADED_ROW_INVALID: "Review the extracted rows again.",
  GRADED_ROW_UNMAPPED: "Map the question to a skill.",
  GRADED_HELP_CONFLICT: "With help, the strongest result is “Success with help”.",
  GRADED_SKILL_UNAVAILABLE: "Map the question to a confirmed skill in this course.",
  // Importing.md, Courses.md and Learning.md: the graded-work checks before and after Confirm.
  GRADED_MATERIAL_UNAVAILABLE: "Choose graded work that you imported into one of your courses.",
  GRADED_SKILLS_UNAVAILABLE: "Confirm at least one skill in this course before importing graded work.",
  GRADED_MARKS_MISSING: "No question marks were found, and a total score alone cannot update individual skills.",
  GRADED_MATERIAL_NOT_SOURCE: "Graded work is evidence, not a teaching source.",
  IMPORTED_GATE_UNAVAILABLE: "Imported coursework cannot show the complete demonstration gate.",
  REGRADE_IMPORTED_UNAVAILABLE: "Imported coursework has no practice task to regrade, so correct it manually instead.",
  // Learning.md, "Refusal sentences": the learning endpoints' session and change refusals, and the material refusal that
  // Suggest shares with the course endpoints.
  SESSION_UNAVAILABLE: "This session is closed or is not one of yours. Choose one of your open sessions.",
  SESSION_CHANGED: "This session closed before the tutor's answer could be saved. Your own work in it is still saved.",
  SKILL_CHANGED: "This skill changed while the tutor was answering, so nothing was saved. Try again.",
  MATERIAL_UNAVAILABLE: "This material is not available in this course. Reload the page to see its materials.",
};

/** Codes whose design gives a sentence only on some endpoints. Other endpoints answer the same code without one. */
export const scopedRefusalDetails: Readonly<Record<string, { readonly applies: (path: string) => boolean; readonly detail: string }>> = {
  // Planning.md: every planning endpoint answers a course that is not the learner's with this sentence.
  COURSE_UNAVAILABLE: { applies: (path) => path.startsWith("/planning/"), detail: "Choose one of your own courses." },
  // Learning.md: Adjust answers a skill that is not one of the learner's confirmed skills with this sentence.
  SKILL_UNAVAILABLE: { applies: (path) => path === "/learning/adjust", detail: "Choose one of your confirmed skills before adjusting its estimate." },
};

/** The sentence for refusal `code` from the endpoint at `path` (without `/api`), or undefined when its design gives none. */
export function refusalDetail(path: string, code: string): string | undefined {
  const scoped = Object.hasOwn(scopedRefusalDetails, code) ? scopedRefusalDetails[code] : undefined;
  if (scoped) return scoped.applies(path) ? scoped.detail : undefined;
  return Object.hasOwn(refusalDetails, code) ? refusalDetails[code] : undefined;
}
