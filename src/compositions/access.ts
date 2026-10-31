import { compute, former, no, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import { composition as Settings } from "./settings.ts";
import * as R from "./learning-reads.ts";
import { composition as PlanningFlows } from "./planning.ts";
import { composition as Importing } from "./importing.ts";
import { learnerWork } from "./learning.ts";
const { SkillMapping: Mapping, Library, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning } = concepts;

// A confirmed skill keeps a deleted material among its sources. Lessons and practice use the sources that remain, and these
// two formers decline only when none remains, with a sentence that says what happened and what to do.
const SkillSourcesLeft = former("admit study of (skill) while one of its sources remains for (owner)", ({ owner, skill }) => where(
  no(R.SkillSourcesDeleted({ owner, skill })),
).form({ allowed: true })).optional();
const SessionSourcesLeft = former("admit tutor help in (studySession) while one of its sources remains for (owner)", ({ owner, studySession }) => where(
  no(R.SessionSourcesDeleted({ owner, studySession })),
).form({ allowed: true })).optional();
const LessonReady = former("admit a lesson for (owner) and (skill)", ({ owner, skill }, { context, sources, materials }) => where(
  R.ActiveSkill({ owner, skill }), R.SkillContext({ owner, skill }).is({ context, sources }), compute(C.selectSkillMaterials, { context }, materials),
  compute(C.selectSources, { sources, materials }, { valid: true }),
).form({ allowed: true })).optional();
const TaskReady = former("admit practice for (owner) and (skill)", ({ owner, skill }, { definition, skills, tracks, context, sources, materials }) => where(
  R.ActiveSkill({ owner, skill }).is({ definition }), R.SkillContext({ owner, skill }).is({ context, skills, tracks, sources }),
  Mastery._track({ learner: owner, subject: skill, definition }), C.prerequisitesReady({ skills, tracks, skill }),
  compute(C.selectSkillMaterials, { context }, materials), compute(C.selectSources, { sources, materials }, { valid: true }),
).form({ allowed: true })).optional();
// Respond, Question, Reply, and RetryAssessment are admitted by the same views and condition helpers their endpoints state
// (learning.ts and learning-reads.ts), so admission and the endpoints cannot drift apart. Every attachment must be listed
// once and be the learner's own material in the session's course.
const ResponseReady = former("admit learner work in (studySession)", ({ owner, studySession, text, channel, attachments, dialogueLength }, { data, sources, currentDialogue }) => where(
  ...learnerWork(owner, studySession, { text, channel, attachments, dialogueLength, data, sources, currentDialogue }),
).form({ allowed: true })).optional();
const QuestionReady = former("admit a question in (studySession)", ({ owner, studySession, text, channel, attachments, dialogueLength }, { data, sources, currentDialogue }) => where(
  ...learnerWork(owner, studySession, { text, channel, attachments, dialogueLength, data, sources, currentDialogue }), Tutoring._lesson({ lesson: studySession }),
).form({ allowed: true })).optional();
// Reply asks for an unexplained lesson's opening or for the answer to an unanswered question; lessonAwaitsTutor holds in
// exactly those two cases, which the endpoint states with lessonUnexplained and hasLessonQuestion.
const ReplyReady = former("admit a tutor reply in (studySession)", ({ owner, studySession }, { data }) => where(
  R.SessionSources({ owner, studySession }).is({ data }), C.lessonAwaitsTutor({ data }),
).form({ allowed: true })).optional();
const HintReady = former("admit requested help in (studySession)", ({ owner, studySession }) => where(
  R.OpenSession({ owner, studySession }), Tutoring._task({ task: studySession }),
).form({ allowed: true })).optional();
const TranscriptReady = former("admit a transcript correction in (studySession)", ({ owner, studySession }) => where(R.OpenSession({ owner, studySession })).form({ allowed: true })).optional();
// The two conditions of FinishLesson's "owned" branch, so an open practice task is declined with this entry's sentence.
const FinishReady = former("admit finishing lesson (studySession)", ({ owner, studySession }) => where(
  R.OpenSession({ owner, studySession }), Tutoring._lesson({ lesson: studySession }),
).form({ allowed: true })).optional();
// The condition of ReopenLesson's "finished" branch, so an open lesson, a practice task, an archived lesson, and another
// learner's session are declined alike with this entry's sentence.
const ReopenReady = former("admit reopening finished lesson (studySession)", ({ owner, studySession }) => where(
  R.ReopenableLesson({ owner, studySession }),
).form({ allowed: true })).optional();
// Archiving and restoring need only that the conversation is the learner's own, open or finished, lesson or practice.
const ConversationReady = former("admit archiving or restoring (studySession)", ({ owner, studySession }) => where(R.OwnedSession({ owner, studySession })).form({ allowed: true })).optional();
const AssessmentReady = former("admit review of (studySession)", ({ owner, studySession, dialogueLength, reviewed, unseen, outsideHelp }, { skill, definition, data }) => where(
  R.OpenSession({ owner, studySession }).is({ skill, definition }), Mastery._track({ learner: owner, subject: skill, definition }),
  Tutoring._sessionData({ session: studySession }).is({ data }), C.attemptIsReady({ data, dialogueLength, reviewed, unseen, outsideHelp }),
).form({ allowed: true })).optional();
const RetryReady = former("admit retry of (studySession)", ({ owner, studySession }) => where(R.PendingGrade({ owner, studySession })).form({ allowed: true })).optional();
// Admits Correct and Regrade for a practice or imported case. Regrade refuses an imported case itself.
const RegradeReady = former("admit revision of (assessment)", ({ owner, assessment, basedOn }) => where(
  R.OwnedAnyCase({ owner, assessment }), Assessment._effectiveJudgment({ case: assessment }).is({ judgment: basedOn }),
).form({ allowed: true })).optional();
// Only the skill is checked; the concept explains a bad key, value, or reason.
const AdjustReady = former("admit an estimate adjustment for (owner) and (skill)", ({ owner, skill }) => where(R.ActiveSkill({ owner, skill })).form({ allowed: true })).optional();
const SuggestionReady = former("admit suggestions from (material)", ({ owner, material }, { course }) => where(
  Library._material({ material }).is({ owner, scope: course }), Courses.OwnedCourse({ owner, course }),
).form({ allowed: true })).optional();
// The same answer for an unknown material, another learner's material, one outside the learner's courses, and an ungraded material.
const GradedReady = former("admit graded work (material) for (owner)", ({ owner, material }) => where(Importing.GradedMaterial({ owner, material })).form({ allowed: true })).optional();
const CourseReady = former("admit access to (course) for (owner)", ({ owner, course }) => where(Courses.OwnedCourse({ owner, course })).form({ allowed: true })).optional();
// The host's delete route admits only the learner's own kept material in a course they own. An unknown material, another
// learner's material, and one already deleted get the same answer.
const DeleteReady = former("admit deleting (material) for (owner)", ({ owner, material }, { course }) => where(
  Library._material({ material }).is({ owner, scope: course }), Courses.OwnedCourse({ owner, course }),
).form({ allowed: true })).optional();
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
export const composition = { SkillSourcesLeft, SessionSourcesLeft, LessonReady, TaskReady, PracticePrerequisite, ResponseReady, QuestionReady, ReplyReady, HintReady, TranscriptReady, FinishReady,
  ReopenReady, ConversationReady, AssessmentReady, RetryReady, RegradeReady, AdjustReady, SuggestionReady, GradedReady, CourseReady, DeleteReady, PlanReady, ItemReady, BeginReady };

// Transport admission uses these same declared reads before starting a causal flow. Each path lists its formers in the
// order they run; a command that asks the tutor passes TutorReady first, so a retired choice is refused before any write.
const tutorReady = { check: Settings.TutorReady, fields: [], detail: "The tutor model or thinking level you chose is no longer offered. Choose another one in the Tutor panel." } as const;
// When every source is deleted, these come before the general checks, whose sentences would not say why.
const skillSourcesLeft = { check: SkillSourcesLeft, fields: ["skill"],
  detail: "Every material this skill was taught from has been deleted. Add another material from this course as a source under Manage skills, then try again." } as const;
const sessionSourcesLeft = { check: SessionSourcesLeft, fields: ["studySession"],
  detail: "The materials this session was grounded in have been deleted, so the tutor can no longer answer here. Your saved work stays, and you can still finish the lesson or submit the task." } as const;
export const admissions = {
  "/learning/lesson": [tutorReady, skillSourcesLeft, { check: LessonReady, fields: ["skill"], detail: "Confirm the skill and attach sources from this course before requesting a lesson." }],
  "/learning/task": [tutorReady, skillSourcesLeft, { check: TaskReady, fields: ["skill"], detail: "Set starting confidence and check the prerequisites before starting fresh practice.",
    prerequisite: { check: PracticePrerequisite, detail: prerequisiteDetail } }],
  "/learning/respond": [{ check: ResponseReady, fields: ["studySession", "text", "channel", "attachments", "dialogueLength"], detail: "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once." }],
  "/learning/question": [tutorReady, sessionSourcesLeft, { check: QuestionReady, fields: ["studySession", "text", "channel", "attachments", "dialogueLength"], detail: "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once." }],
  "/learning/reply": [tutorReady, sessionSourcesLeft, { check: ReplyReady, fields: ["studySession"], detail: "Send a question in an open lesson before asking for a reply." }],
  "/learning/hint": [tutorReady, sessionSourcesLeft, { check: HintReady, fields: ["studySession"], detail: "Choose an open practice task to request a hint." }],
  "/learning/transcript": [{ check: TranscriptReady, fields: ["studySession"], detail: "Choose an open session before correcting a transcript." }],
  "/learning/finish": [{ check: FinishReady, fields: ["studySession"], detail: "Choose one of your open lessons. A practice task closes when you submit it for assessment." }],
  "/learning/reopen": [{ check: ReopenReady, fields: ["studySession"],
    detail: "Choose one of your finished lessons to continue. A practice task cannot be reopened, and an archived lesson must be restored first." }],
  "/learning/archive": [{ check: ConversationReady, fields: ["studySession"], detail: "Choose one of your own conversations to archive." }],
  "/learning/restore": [{ check: ConversationReady, fields: ["studySession"], detail: "Choose one of your own conversations to restore." }],
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
