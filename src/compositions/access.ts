import { compute, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import { composition as Settings } from "./settings.ts";
import * as R from "./learning-reads.ts";
import { composition as PlanningFlows } from "./planning.ts";
import { composition as Importing } from "./importing.ts";
const { SkillMapping: Mapping, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning } = concepts;

const LessonReady = former("admit a lesson for (owner) and (skill)", ({ owner, skill }, { context, sources, materials }) => where(
  R.ActiveSkill({ owner, skill }), R.SkillContext({ owner, skill }).is({ context, sources }), compute(C.selectSkillMaterials, { context }, materials),
  compute(C.selectSources, { sources, materials }, { valid: true }),
).form({ allowed: true })).optional();
const TaskReady = former("admit practice for (owner) and (skill)", ({ owner, skill }, { definition, skills, tracks, context, sources, materials }) => where(
  R.ActiveSkill({ owner, skill }).is({ definition }), R.SkillContext({ owner, skill }).is({ context, skills, tracks, sources }),
  Mastery._track({ learner: owner, subject: skill, definition }), C.prerequisitesReady({ skills, tracks, skill }),
  compute(C.selectSkillMaterials, { context }, materials), compute(C.selectSources, { sources, materials }, { valid: true }),
).form({ allowed: true })).optional();
// Every attachment must be listed once and be the learner's own material in the session's course.
const ResponseReady = former("admit learner work in (studySession)", ({ owner, studySession, text, channel, attachments, dialogueLength }, { course, data, sources }) => where(
  R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }),
  Tutoring._sourceSet({ owner, scope: course }).is({ sources }), C.dialogueIsCurrent({ data, dialogueLength }),
  compute(C.responseInput, { data, text, channel, attachments, sources }, { valid: true }),
).form({ allowed: true })).optional();
const QuestionReady = former("admit a question in (studySession)", ({ owner, studySession, text, channel, attachments, dialogueLength }, { course, data, sources }) => where(
  R.OpenSession({ owner, studySession }).is({ course }), Tutoring._lesson({ lesson: studySession }), Tutoring._sessionData({ session: studySession }).is({ data }),
  Tutoring._sourceSet({ owner, scope: course }).is({ sources }), C.dialogueIsCurrent({ data, dialogueLength }),
  compute(C.responseInput, { data, text, channel, attachments, sources }, { valid: true }),
).form({ allowed: true })).optional();
const ReplyReady = former("admit a tutor reply in (studySession)", ({ owner, studySession }, { data }) => where(
  R.OpenSession({ owner, studySession }), Tutoring._sessionData({ session: studySession }).is({ data }), C.hasLessonQuestion({ data }),
).form({ allowed: true })).optional();
const HintReady = former("admit requested help in (studySession)", ({ owner, studySession }) => where(
  R.OpenSession({ owner, studySession }), Tutoring._task({ task: studySession }),
).form({ allowed: true })).optional();
const TranscriptReady = former("admit a transcript correction in (studySession)", ({ owner, studySession }) => where(R.OpenSession({ owner, studySession })).form({ allowed: true })).optional();
const AssessmentReady = former("admit review of (studySession)", ({ owner, studySession, dialogueLength, reviewed, unseen, outsideHelp }, { skill, definition, data }) => where(
  R.OpenSession({ owner, studySession }).is({ skill, definition }), Mastery._track({ learner: owner, subject: skill, definition }),
  Tutoring._sessionData({ session: studySession }).is({ data }), C.attemptIsReady({ data, dialogueLength, reviewed, unseen, outsideHelp }),
).form({ allowed: true })).optional();
const RetryReady = former("admit retry of (studySession)", ({ owner, studySession }, { assessment }) => where(
  R.OwnedSession({ owner, studySession }), Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), no(Assessment._effectiveJudgment({ case: assessment })),
).form({ allowed: true })).optional();
// Admits Correct and Regrade for a practice or imported case. Regrade refuses an imported case itself.
const RegradeReady = former("admit revision of (assessment)", ({ owner, assessment, basedOn }) => where(
  R.OwnedAnyCase({ owner, assessment }), Assessment._effectiveJudgment({ case: assessment }).is({ judgment: basedOn }),
).form({ allowed: true })).optional();
// Only the skill is checked; the concept explains a bad key, value, or reason.
const AdjustReady = former("admit an estimate adjustment for (owner) and (skill)", ({ owner, skill }) => where(R.ActiveSkill({ owner, skill })).form({ allowed: true })).optional();
const SuggestionReady = former("admit suggestions from (material)", ({ owner, material }, { course }) => where(
  Tutoring._material({ material }).is({ owner, scope: course }), Courses.OwnedCourse({ owner, course }),
).form({ allowed: true })).optional();
// The same answer for an unknown material, another learner's material, one outside the learner's courses, and an ungraded material.
const GradedReady = former("admit graded work (material) for (owner)", ({ owner, material }) => where(Importing.GradedMaterial({ owner, material })).form({ allowed: true })).optional();
const CourseReady = former("admit access to (course) for (owner)", ({ owner, course }) => where(Courses.OwnedCourse({ owner, course })).form({ allowed: true })).optional();
const PlanReady = former("admit a routine plan in (course)", ({ owner, course }) => where(R.CanReplan({ owner, course })).form({ allowed: true })).optional();
const ItemReady = former("admit progress on (item) in (course)", ({ owner, course, item }) => where(
  Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ owner, scope: course }),
).form({ allowed: true })).optional();
// The same view as the Begin endpoint, so admission applies the same urgent-mode prerequisite rule.
const BeginReady = former("admit starting (item) in (course)", ({ owner, course, item }) => where(
  Courses.OwnedCourse({ owner, course }), PlanningFlows.StartAllowed({ owner, course, item }),
).form({ allowed: true })).optional();
// When TaskReady declines, this names a prerequisite that is not ready, by the rule TaskReady uses.
// No row means every prerequisite is ready, so the general practice explanation stays.
const PracticePrerequisite = former("the prerequisite to work on before practicing (skill) for (owner)", ({ owner, skill }, { skills, tracks, title }) => where(
  R.ActiveSkill({ owner, skill }), R.SkillContext({ owner, skill }).is({ skills, tracks }),
  compute(C.prerequisiteToPractice, { skills, tracks, skill }, { found: true, title }),
).form({ title })).optional();
/** The practice explanation that names the prerequisite PracticePrerequisite found. */
export const prerequisiteDetail = ({ title }: { title: string }) => `Work on “${title}” first. This skill builds on it.`;
export const composition = { LessonReady, TaskReady, PracticePrerequisite, ResponseReady, QuestionReady, ReplyReady, HintReady, TranscriptReady, AssessmentReady, RetryReady, RegradeReady, AdjustReady, SuggestionReady, GradedReady, CourseReady, PlanReady, ItemReady, BeginReady };

// Transport admission uses these same declared reads before starting a causal flow. Each path lists its formers in the
// order they run; a command that asks the tutor passes TutorReady first, so a retired choice is refused before any write.
const tutorReady = { check: Settings.TutorReady, fields: [], detail: "The tutor model or thinking level you chose is no longer offered. Choose another one in the Tutor panel." } as const;
export const admissions = {
  "/learning/lesson": [tutorReady, { check: LessonReady, fields: ["skill"], detail: "Confirm the skill and attach sources from this course before requesting a lesson." }],
  "/learning/task": [tutorReady, { check: TaskReady, fields: ["skill"], detail: "Set starting confidence and check the prerequisites before starting fresh practice.",
    prerequisite: { check: PracticePrerequisite, detail: prerequisiteDetail } }],
  "/learning/respond": [{ check: ResponseReady, fields: ["studySession", "text", "channel", "attachments", "dialogueLength"], detail: "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once." }],
  "/learning/question": [tutorReady, { check: QuestionReady, fields: ["studySession", "text", "channel", "attachments", "dialogueLength"], detail: "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once." }],
  "/learning/reply": [tutorReady, { check: ReplyReady, fields: ["studySession"], detail: "Send a question in an open lesson before asking for a reply." }],
  "/learning/hint": [tutorReady, { check: HintReady, fields: ["studySession"], detail: "Choose an open practice task to request a hint." }],
  "/learning/transcript": [{ check: TranscriptReady, fields: ["studySession"], detail: "Choose an open session before correcting a transcript." }],
  "/learning/assess": [tutorReady, { check: AssessmentReady, fields: ["studySession", "dialogueLength", "reviewed", "unseen", "outsideHelp"], detail: "Review your complete answer and transcripts. If it was already submitted, use its saved assessment or retry." }],
  "/learning/retry": [tutorReady, { check: RetryReady, fields: ["studySession"], detail: "Choose a saved attempt that is still awaiting assessment." }],
  "/learning/regrade": [tutorReady, { check: RegradeReady, fields: ["assessment", "basedOn"], detail: "Choose your own assessment and review its latest judgment before requesting a regrade." }],
  // Correcting makes no AI call, so it does not pass TutorReady.
  "/learning/correct": [{ check: RegradeReady, fields: ["assessment", "basedOn"], detail: "Choose your own assessment and review its latest judgment before correcting it." }],
  "/learning/adjust": [{ check: AdjustReady, fields: ["skill"], detail: "Choose one of your confirmed skills before adjusting its estimate." }],
  "/courses/skills/suggest": [tutorReady, { check: SuggestionReady, fields: ["material"], detail: "Choose a source from your own course." }],
  "/planning/configure": [{ check: CourseReady, fields: ["course"], detail: "Choose your own course before setting its study budget." }],
  "/planning/propose": [{ check: PlanReady, fields: ["course"], detail: "Set a daily budget and finish or stop the current activity before updating the plan." }],
  "/planning/begin": [{ check: BeginReady, fields: ["course", "item"], detail: "Choose your own current activity and check its prerequisites. Update the plan if requirements changed." }],
  "/planning/finish": [{ check: ItemReady, fields: ["course", "item"], detail: "Choose an activity from your own course." }],
  "/planning/stop": [{ check: ItemReady, fields: ["course", "item"], detail: "Choose an activity from your own course." }],
  "/planning/miss": [{ check: ItemReady, fields: ["course", "item"], detail: "Choose an activity from your own course." }],
  // Exam and tradeoff commands are admitted on course ownership alone; the planning concept explains its own refusals.
  "/planning/exams/set": [{ check: CourseReady, fields: ["course"], detail: "Choose one of your own courses." }],
  "/planning/exams/remove": [{ check: CourseReady, fields: ["course"], detail: "Choose one of your own courses." }],
  "/planning/tradeoffs/confirm": [{ check: CourseReady, fields: ["course"], detail: "Choose one of your own courses." }],
  "/planning/tradeoffs/decline": [{ check: CourseReady, fields: ["course"], detail: "Choose one of your own courses." }],
  "/courses/graded/extract": [tutorReady, { check: GradedReady, fields: ["material"], detail: "Choose graded work that you imported into one of your courses." }],
  "/courses/graded/confirm": [{ check: GradedReady, fields: ["material"], detail: "Choose graded work that you imported into one of your courses." }],
} as const;
