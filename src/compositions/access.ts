import { compute, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import * as R from "./learning-reads.ts";
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
const RegradeReady = former("admit revision of (assessment)", ({ owner, assessment, basedOn }) => where(
  R.OwnedCase({ owner, assessment }), Assessment._effectiveJudgment({ case: assessment }).is({ judgment: basedOn }),
).form({ allowed: true })).optional();
// Only the skill is checked; the concept explains a bad key, value, or reason.
const AdjustReady = former("admit an estimate adjustment for (owner) and (skill)", ({ owner, skill }) => where(R.ActiveSkill({ owner, skill })).form({ allowed: true })).optional();
const SuggestionReady = former("admit suggestions from (material)", ({ owner, material }, { course }) => where(
  Tutoring._material({ material }).is({ owner, scope: course }), Courses.OwnedCourse({ owner, course }),
).form({ allowed: true })).optional();
const CourseReady = former("admit access to (course) for (owner)", ({ owner, course }) => where(Courses.OwnedCourse({ owner, course })).form({ allowed: true })).optional();
const PlanReady = former("admit a routine plan in (course)", ({ owner, course }) => where(R.CanReplan({ owner, course })).form({ allowed: true })).optional();
const ItemReady = former("admit progress on (item) in (course)", ({ owner, course, item }) => where(
  Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course }),
).form({ allowed: true })).optional();
const BeginReady = former("admit starting (item) in (course)", ({ owner, course, item }, { candidate, skill, definition, skills, tracks }) => where(
  Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course, candidate }), compute(C.itemSubject, { candidate }, { skill, definition }),
  R.ActiveSkill({ owner, skill }).is({ course, definition }), Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }),
  C.prerequisitesReady({ skills, tracks, skill }),
).form({ allowed: true })).optional();
export const composition = { LessonReady, TaskReady, ResponseReady, QuestionReady, ReplyReady, HintReady, TranscriptReady, AssessmentReady, RetryReady, RegradeReady, AdjustReady, SuggestionReady, CourseReady, PlanReady, ItemReady, BeginReady };

// Transport admission uses these same declared reads before starting a causal flow.
export const admissions = {
  "/learning/lesson": { check: LessonReady, fields: ["skill"], detail: "Confirm the skill and attach sources from this course before requesting a lesson." },
  "/learning/task": { check: TaskReady, fields: ["skill"], detail: "Set starting confidence and check the prerequisites before starting fresh practice." },
  "/learning/respond": { check: ResponseReady, fields: ["studySession", "text", "channel", "attachments", "dialogueLength"], detail: "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once." },
  "/learning/question": { check: QuestionReady, fields: ["studySession", "text", "channel", "attachments", "dialogueLength"], detail: "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once." },
  "/learning/reply": { check: ReplyReady, fields: ["studySession"], detail: "Send a question in an open lesson before asking for a reply." },
  "/learning/hint": { check: HintReady, fields: ["studySession"], detail: "Choose an open practice task to request a hint." },
  "/learning/transcript": { check: TranscriptReady, fields: ["studySession"], detail: "Choose an open session before correcting a transcript." },
  "/learning/assess": { check: AssessmentReady, fields: ["studySession", "dialogueLength", "reviewed", "unseen", "outsideHelp"], detail: "Review your complete answer and transcripts. If it was already submitted, use its saved assessment or retry." },
  "/learning/retry": { check: RetryReady, fields: ["studySession"], detail: "Choose a saved attempt that is still awaiting assessment." },
  "/learning/regrade": { check: RegradeReady, fields: ["assessment", "basedOn"], detail: "Choose your own assessment and review its latest judgment before requesting a regrade." },
  "/learning/correct": { check: RegradeReady, fields: ["assessment", "basedOn"], detail: "Choose your own assessment and review its latest judgment before correcting it." },
  "/learning/adjust": { check: AdjustReady, fields: ["skill"], detail: "Choose one of your confirmed skills before adjusting its estimate." },
  "/courses/skills/suggest": { check: SuggestionReady, fields: ["material"], detail: "Choose a source from your own course." },
  "/planning/configure": { check: CourseReady, fields: ["course"], detail: "Choose your own course before setting its study budget." },
  "/planning/propose": { check: PlanReady, fields: ["course"], detail: "Set a daily budget and finish or stop the current activity before updating the plan." },
  "/planning/begin": { check: BeginReady, fields: ["course", "item"], detail: "Choose your own current activity and check its prerequisites. Update the plan if requirements changed." },
  "/planning/finish": { check: ItemReady, fields: ["course", "item"], detail: "Choose an activity from your own course." },
  "/planning/stop": { check: ItemReady, fields: ["course", "item"], detail: "Choose an activity from your own course." },
  "/planning/miss": { check: ItemReady, fields: ["course", "item"], detail: "Choose an activity from your own course." },
} as const;
