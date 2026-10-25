import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, no, is, now, reaction, when, where, type Condition, type ReadLine } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import { composition as Settings, usingTutorChoice } from "./settings.ts";
import * as R from "./learning-reads.ts";
import { ActivityInProgress } from "./planning.ts";
import { learningInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, Library, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning, TutorGenerating: AI } = concepts;
const options = { validators: { ...validators, input: learningInput, output: structuredOutput } };

const useAgain = (session: symbol, owner: symbol) => Sessioning.use({ session }).responds({ subject: owner });
type Symbols<K extends string> = Record<K, symbol>;
type Branch = ReturnType<ReturnType<typeof where>["then"]>;

/**
 * Conditions that admit learner work in the open session: the dialogue the learner saw is still current, and the response
 * has text or attachments, each the learner's own source in the session's course and listed once. Respond and Question
 * state them, and so do their admission formers in access.ts, so admission and the endpoints cannot drift apart. The
 * endpoints also bind `media`, the saved files to send with the turn; admission only needs to know the input is valid.
 */
export const learnerWork = (owner: symbol, studySession: symbol, { text, channel, attachments, dialogueLength, data, sources, currentDialogue, media }:
  Symbols<"text" | "channel" | "attachments" | "dialogueLength" | "data" | "sources" | "currentDialogue"> & { media?: symbol }) => [
  R.SessionSources({ owner, studySession }).is({ data, sources }),
  compute(C.dialogueIsCurrent, { data, dialogueLength }, currentDialogue), is.among(currentDialogue, [true]),
  media === undefined ? compute(C.responseInput, { data, text, channel, attachments, sources }, { valid: true })
    : compute(C.responseInput, { data, text, channel, attachments, sources }, { valid: true, media }),
] as const;
/**
 * Conditions that prepare a tutor request of one kind from the learner's open session. Every material saved with the
 * session must still be among the learner's sources in its course, and the learner's tutor choice is added last.
 */
const sessionTutorRequest = (owner: symbol, studySession: symbol, kind: "REPLY" | "HINT", { data, sources, materials, selected, draft, choice, status, prepared }:
  Symbols<"data" | "sources" | "materials" | "selected" | "draft" | "choice" | "status" | "prepared">) => [
  R.SessionSources({ owner, studySession }).is({ data, sources }), compute(C.sessionMaterials, { data }, materials),
  compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.sessionRequest, { selected, data, kind }, draft),
  ...usingTutorChoice(owner, draft, choice, status, prepared),
] as const;
/**
 * Conditions that prepare a grading request for a saved case from its work, the materials saved with its session, and the
 * learner's sources in its course. Assess, RetryAssessment, and Regrade share them; each reads the case its own way first.
 */
const gradeRequest = (owner: symbol, { data, sessionData, sources, materials, selected, draft, choice, status, prepared }:
  Symbols<"data" | "sessionData" | "sources" | "materials" | "selected" | "draft" | "choice" | "status" | "prepared">) => [
  compute(C.sessionMaterials, { data: sessionData }, materials), compute(C.selectSources, { sources, materials }, { selected, valid: true }),
  compute(C.gradeRequest, { selected, data }, draft), ...usingTutorChoice(owner, draft, choice, status, prepared),
] as const;
/**
 * The two paths after the tutor answers. While the guard still holds, the `saved` chain stores the answer and answers the
 * request; otherwise the endpoint answers the "changed" code and stores nothing. `lead` binds what the guard reads, such as
 * the requirements version the request was prepared for, and both paths state it first. Each call builds fresh read lines.
 */
const afterTutor = (guard: () => ReadLine, changed: "SKILL_CHANGED" | "SESSION_CHANGED", saved: (...held: Condition[]) => Branch,
  lead: () => Condition[] = () => []) => [
  saved(...lead(), guard()).named(changed === "SKILL_CHANGED" ? "current" : "open"),
  where(...lead(), no(guard())).then(respond({ error: changed })).named(changed === "SKILL_CHANGED" ? "changed" : "closed"),
] as const;

// Each command endpoint below answers a refusal when its first guard fails, as Read and Transcript do, so a caller that
// skips admission gets an answer instead of waiting for the request limit. A later stage follows every branch of the
// group before it, including a refusal that has already answered. Where the next stage is not guarded by the same
// view, the ready branch only uses the session again, and the stage after it repeats the guard, as Suggest does.
const Read = endpoint("/learning/read", ({ session, skill, owner, at }) => receive({ session, skill })
  .then(Sessioning.use({ session }).responds({ subject: owner })).afterFlowSettles().then(
    where(R.OwnedSkill({ owner, skill }), now(at)).then(respond({ data: R.SkillData({ owner, skill, at }) })).named("owned"),
    where(no(R.OwnedSkill({ owner, skill }))).then(respond({ error: "SKILL_UNAVAILABLE" })).named("missing"),
  ), options);
const Progress = endpoint("/learning/progress", ({ session, course, owner }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course })).then(respond({ data: R.Progress({ owner, course }) })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), options);
const Confidence = endpoint("/learning/confidence", ({ session, skill, confidence, owner, definition, track }) => receive({ session, skill, confidence })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.ActiveSkill({ owner, skill }).is({ definition }), no(Mastery._track({ learner: owner, subject: skill, definition })))
      .then(Mastery.initialize({ learner: owner, subject: skill, definition, confidence, basis: "SELF_REPORTED" }).responds({ track })).then(respond({ track })).named("new"),
    where(R.ActiveSkill({ owner, skill }).is({ definition }), Mastery._track({ learner: owner, subject: skill, definition }).is({ track }))
      .then(respond({ track })).named("existing"),
    where(no(R.ActiveSkill({ owner, skill }))).then(respond({ error: "SKILL_UNAVAILABLE" })).named("missing"),
  ), options);

const Lesson = endpoint("/learning/lesson", ({ session, skill, request, owner, definition, context, sources, materials, selected, draft, choice, status, prepared, answer, explanation, citations, lesson }) => receive({ session, skill, request })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.ActiveSkill({ owner, skill })).then(useAgain(session, owner)).named("ready"),
    where(no(R.ActiveSkill({ owner, skill }))).then(respond({ error: "SKILL_UNAVAILABLE" })).named("missing"),
  )
  .then(where(R.ActiveSkill({ owner, skill }), R.SkillContext({ owner, skill }).is({ context, sources }),
    compute(C.selectSkillMaterials, { context }, materials), compute(C.selectSources, { sources, materials }, { selected, valid: true }),
    compute(C.lessonRequest, { selected, context, request }, draft), ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(...afterTutor(() => R.ActiveSkill({ owner, skill }).is({ definition }), "SKILL_CHANGED",
    (...held) => where(...held, compute(C.generationFields, { answer }, { text: explanation, citations, materials }))
      .then(Tutoring.explain({ owner, topic: skill, definition, request, explanation, materials, citations }).responds({ lesson }))
      .then(respond({ lesson, tutor: Settings.SentTutor({ request: prepared }) })),
    () => [compute(C.generationDefinition, { request: prepared }, { definition })])), options);
const Task = endpoint("/learning/task", ({ session, skill, owner, definition, context, skills, tracks, sources, materials, selected, sessions, draft, choice, status, prepared, answer, question, citations, criteria, task }) => receive({ session, skill })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.ActiveSkill({ owner, skill })).then(useAgain(session, owner)).named("ready"),
    where(no(R.ActiveSkill({ owner, skill }))).then(respond({ error: "SKILL_UNAVAILABLE" })).named("missing"),
  )
  .then(where(R.ActiveSkill({ owner, skill }).is({ definition }), R.SkillContext({ owner, skill }).is({ context, skills, tracks, sources }),
    Mastery._track({ learner: owner, subject: skill, definition }), C.prerequisitesReady({ skills, tracks, skill }),
    Tutoring._study({ owner, topic: skill }).is({ sessions }), compute(C.selectSkillMaterials, { context }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.taskRequest, { selected, context, sessions }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(...afterTutor(() => R.ActiveSkill({ owner, skill }).is({ definition }), "SKILL_CHANGED",
    (...held) => where(...held, compute(C.generationFields, { answer }, { text: question, citations, materials }))
      .then(Tutoring.prepareTask({ owner, topic: skill, definition, question, criteria, materials, citations, mode: "CHECK", fresh: true }).responds({ task }))
      .then(respond({ task, tutor: Settings.SentTutor({ request: prepared }) })),
    () => [compute(C.generationDefinition, { request: prepared }, { definition, criteria })])), options);

const Respond = endpoint("/learning/respond", ({ session, studySession, text, channel, attachments, dialogueLength, owner, data, sources, media, currentDialogue }) => receive({ session, studySession, text, channel, attachments, dialogueLength })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(...learnerWork(owner, studySession, { text, channel, attachments, dialogueLength, data, sources, currentDialogue, media }))
      .then(Tutoring.respond({ owner, session: studySession, text, channel, media }).responds({})).then(respond({})).named("ready"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  ), options);
const Question = endpoint("/learning/question", ({ session, studySession, text, channel, attachments, dialogueLength, owner, data, sources, media, currentDialogue, materials, selected, draft, choice, status, prepared, answer, reply, citations }) => receive({ session, studySession, text, channel, attachments, dialogueLength })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(...learnerWork(owner, studySession, { text, channel, attachments, dialogueLength, data, sources, currentDialogue, media }), Tutoring._lesson({ lesson: studySession }))
      .then(Tutoring.respond({ owner, session: studySession, text, channel, media }).responds({})).named("ready"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  )
  // The tutor choice is read here, after the question is saved; admission has already checked it.
  .then(where(...sessionTutorRequest(owner, studySession, "REPLY", { data, sources, materials, selected, draft, choice, status, prepared }))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(...afterTutor(() => R.OpenSession({ owner, studySession }), "SESSION_CHANGED",
    (...held) => where(...held, compute(C.generationFields, { answer }, { text: reply, citations }))
      .then(Tutoring.answerLesson({ owner, lesson: studySession, text: reply, citations, channel: "TEXT" }).responds({}))
      .then(respond({ tutor: Settings.SentTutor({ request: prepared }) })))), options);
const Reply = endpoint("/learning/reply", ({ session, studySession, owner, data, materials, sources, selected, draft, choice, status, prepared, answer, text, citations }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OpenSession({ owner, studySession })).then(useAgain(session, owner)).named("ready"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  )
  .then(where(...sessionTutorRequest(owner, studySession, "REPLY", { data, sources, materials, selected, draft, choice, status, prepared }), C.hasLessonQuestion({ data }))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(...afterTutor(() => R.OpenSession({ owner, studySession }), "SESSION_CHANGED",
    (...held) => where(...held, compute(C.generationFields, { answer }, { text, citations }))
      .then(Tutoring.answerLesson({ owner, lesson: studySession, text, citations, channel: "TEXT" }).responds({}))
      .then(respond({ tutor: Settings.SentTutor({ request: prepared }) })))), options);
const Hint = endpoint("/learning/hint", ({ session, studySession, owner, data, sources, materials, selected, draft, choice, status, prepared, answer, text }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OpenSession({ owner, studySession })).then(Tutoring.requestHint({ owner, task: studySession }).responds({})).named("ready"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  )
  // The tutor choice is read here, after the request for help is saved; admission has already checked it.
  .then(where(...sessionTutorRequest(owner, studySession, "HINT", { data, sources, materials, selected, draft, choice, status, prepared }))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(...afterTutor(() => R.OpenSession({ owner, studySession }), "SESSION_CHANGED",
    (...held) => where(...held, compute(C.generationFields, { answer }, { text }))
      .then(Tutoring.giveHint({ owner, task: studySession, text, channel: "TEXT" }).responds({}))
      .then(respond({ tutor: Settings.SentTutor({ request: prepared }) })))), options);
const Transcript = endpoint("/learning/transcript", ({ session, studySession, turnIndex, text, owner }) => receive({ session, studySession, turnIndex, text })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OpenSession({ owner, studySession })).then(Tutoring.confirmTranscript({ owner, session: studySession, turnIndex, text }).responds({})).then(respond({})).named("owned"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  ), options);

// Admission also checks the dialogue length and the attempt's content with attemptIsReady; the endpoint checks only the
// learner's review and declarations, and Tutoring.confirmAttempt checks the dialogue length itself. Confirming the attempt
// submits it, and CloseSubmitted closes the session, so the grading stage reads PendingGrade rather than an open session.
const Assess = endpoint("/learning/assess", ({ session, studySession, dialogueLength, reviewed, unseen, outsideHelp, owner, skill, definition, assessment, data, sessionData, sources, materials, selected, draft, choice, status, prepared, answer, result, gateMet, rationale, approved }) => receive({ session, studySession, dialogueLength, reviewed, unseen, outsideHelp })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OpenSession({ owner, studySession })).then(useAgain(session, owner)).named("ready"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  )
  .then(where(R.OpenSession({ owner, studySession }).is({ skill, definition }), compute(C.reviewApproved, { reviewed, unseen, outsideHelp }, approved), is.among(approved, [true]),
    Mastery._track({ learner: owner, subject: skill, definition }))
    .then(Tutoring.confirmAttempt({ owner, task: studySession, dialogueLength, unseen, outsideHelp }).responds({})))
  .afterFlowSettles().where(R.PendingGrade({ owner, studySession }).is({ assessment, data, sessionData, sources }),
    ...gradeRequest(owner, { data, sessionData, sources, materials, selected, draft, choice, status, prepared }))
  .then(AI.generate({ owner, request: prepared }).responds({ answer }))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.assess({ case: assessment, result, gateMet, rationale }).responds({})))
  .afterFlowSettles().then(respond({ studySession, tutor: Settings.SentTutor({ request: prepared }) })), options);
const RetryAssessment = endpoint("/learning/retry", ({ session, studySession, owner, assessment, data, sessionData, sources, materials, selected, draft, choice, status, prepared, answer, result, gateMet, rationale }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    // The attempt's session is closed once it is submitted, so retry guards on ownership rather than an open session.
    where(R.OwnedSession({ owner, studySession })).then(useAgain(session, owner)).named("ready"),
    where(no(R.OwnedSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  )
  .then(where(R.PendingGrade({ owner, studySession }).is({ assessment, data, sessionData, sources }),
    ...gradeRequest(owner, { data, sessionData, sources, materials, selected, draft, choice, status, prepared }))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.assess({ case: assessment, result, gateMet, rationale }).responds({})))
  .afterFlowSettles().then(respond({ tutor: Settings.SentTutor({ request: prepared }) })), options);

// An imported case keeps gateMet false: imported coursework cannot show the complete demonstration gate.
// A correction of the learner's own practice case goes to revise, which still refuses an outdated judgment. A case that is
// not the learner's own is refused before revise. A continuation follows every branch, so the settled answer reads the
// effective judgment again, and each branch excludes the others.
const Correct = endpoint("/learning/correct", ({ session, case: assessment, basedOn, result, gateMet, reason, owner, judgment }) => receive({ session, case: assessment, basedOn, result, gateMet, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: true }), is.among(gateMet, [true]))
      .then(respond({ error: "IMPORTED_GATE_UNAVAILABLE" })).named("importedGate"),
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: true }), is.among(gateMet, [false]))
      .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale: reason, origin: "MANUAL" }).responds({ judgment })).named("imported"),
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: false }))
      .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale: reason, origin: "MANUAL" }).responds({ judgment })).named("practice"),
    where(no(R.OwnedAnyCase({ owner, assessment }))).then(respond({ error: "REVISION_CASE_UNAVAILABLE" })).named("missing"),
  ).afterFlowSettles().then(
    where(Assessment._effectiveJudgment({ case: assessment }).is({ judgment }), R.OwnedAnyCase({ owner, assessment }).is({ imported: true }), is.among(gateMet, [false]))
      .then(respond({ judgment })).named("importedRevised"),
    where(Assessment._effectiveJudgment({ case: assessment }).is({ judgment }), R.OwnedAnyCase({ owner, assessment }).is({ imported: false }))
      .then(respond({ judgment })).named("practiceRevised"),
  ), options);
// Imported coursework has no practice task to regrade, so it is refused before any clarification or tutor request.
const Regrade = endpoint("/learning/regrade", ({ session, case: assessment, basedOn, reason, owner, course, task, clarification, data, sessionData, sources, materials, selected, draft, choice, status, prepared, answer, result, gateMet, rationale, judgment }) => receive({ session, case: assessment, basedOn, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: true })).then(respond({ error: "REGRADE_IMPORTED_UNAVAILABLE" })).named("imported"),
    where(R.OwnedCase({ owner, assessment }), Assessment._effectiveJudgment({ case: assessment }).is({ judgment: basedOn }),
      compute(C.correctionNote, { reason }, clarification)).then(Assessment.clarify({ author: owner, case: assessment, clarification }).responds({})).named("practice"),
    where(no(R.OwnedAnyCase({ owner, assessment }))).then(respond({ error: "REVISION_CASE_UNAVAILABLE" })).named("missing"),
  )
  .then(where(R.OwnedCase({ owner, assessment }).is({ course, task }), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: task }).is({ data: sessionData }),
    Library._sourceSet({ owner, scope: course }).is({ sources }), ...gradeRequest(owner, { data, sessionData, sources, materials, selected, draft, choice, status, prepared }))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale, origin: "AI" }).responds({ judgment })))
  .afterFlowSettles().then(respond({ judgment, tutor: Settings.SentTutor({ request: prepared }) })), options);
// The learner sets the estimate by hand. The settled stage answers only in a terminal state of ReplanAfterAdjustment:
// no replan can run, because CanReplan fails or an activity is in progress in another course, or a proposed or active plan
// carries the current fingerprint, which includes this adjustment. Until then it does not answer, so a refused replan
// reaches the learner as the answer. It reads the saved adjustment again; the missing path never reaches it because
// ActiveSkill does not hold there.
const Adjust = endpoint("/learning/adjust", ({ session, skill, adjustmentKey, value, reason, owner, course, definition, track, adjustment, basis, plan, status }) => receive({ session, skill, adjustmentKey, value, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.ActiveSkill({ owner, skill }).is({ definition }))
      .then(Mastery.adjust({ learner: owner, subject: skill, definition, adjustmentKey, value, reason }).responds({ adjustment })).named("active"),
    where(no(R.ActiveSkill({ owner, skill })))
      .then(respond({ error: "SKILL_UNAVAILABLE", detail: "Choose one of your confirmed skills before adjusting its estimate." })).named("missing"),
  ).afterFlowSettles().then(
    where(R.ActiveSkill({ owner, skill }).is({ course, definition }), Mastery._track({ learner: owner, subject: skill, definition }).is({ track }),
      Mastery._adjustments({ track }).is({ adjustment }), no(R.CanReplan({ owner, course }))).then(respond({ adjustment })).named("unplanned"),
    where(R.ActiveSkill({ owner, skill }).is({ course, definition }), Mastery._track({ learner: owner, subject: skill, definition }).is({ track }),
      Mastery._adjustments({ track }).is({ adjustment }), R.CanReplan({ owner, course }), ActivityInProgress({ owner })).then(respond({ adjustment })).named("waiting"),
    where(R.ActiveSkill({ owner, skill }).is({ course, definition }), Mastery._track({ learner: owner, subject: skill, definition }).is({ track }),
      Mastery._adjustments({ track }).is({ adjustment }), R.CanReplan({ owner, course }), no(ActivityInProgress({ owner })), R.PlanContext({ owner, course }).is({ basis }),
      Planning._plans({ owner, scope: course }).is({ plan, status }), is.among(status, ["PROPOSED", "ACTIVE"]), Planning._plan({ plan }).is({ basis }))
      .then(respond({ adjustment })).named("planned"),
  ), options);
const ReplanAfterAdjustment = reaction(({ owner, skill, course, candidates, horizonEnd, basis, explanation }) => when(Mastery.adjust({ learner: owner, subject: skill }).responds({}))
  .afterFlowSettles().where(R.OwnedSkill({ owner, skill }).is({ course }), R.CanReplan({ owner, course }), no(ActivityInProgress({ owner })), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
// Graded work is evidence, not a teaching source. The check applies only to the learner's own material in a course they own;
// any other material keeps the admission refusal, and the endpoint answers MATERIAL_UNAVAILABLE or COURSE_UNAVAILABLE
// for a caller that skips admission, as the material read in the course composition does. Every branch shares the stages
// that follow, so the tutor request lives there and repeats the source condition: the refusal branches have already
// answered, and the source branch only rechecks the session.
const Suggest = endpoint("/courses/skills/suggest", ({ session, material, owner, course, sources, selected, materials, draft, choice, status, prepared, answer, suggestions, title, graded }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Library._material({ material }).is({ owner, scope: course, title }), Courses.OwnedCourse({ owner, course }), compute(C.gradedTitle, { title }, graded), is.among(graded, [true]))
      .then(respond({ error: "GRADED_MATERIAL_NOT_SOURCE" })).named("graded"),
    where(Library._material({ material }).is({ owner, scope: course, title }), Courses.OwnedCourse({ owner, course }), compute(C.gradedTitle, { title }, graded), is.among(graded, [false]))
      .then(Sessioning.use({ session }).responds({ subject: owner })).named("source"),
    where(no(Library._material({ material }).is({ owner }))).then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("missing"),
    where(Library._material({ material }).is({ owner, scope: course }), no(Courses.OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("course"),
  )
  .then(where(Library._material({ material }).is({ owner, scope: course, title }), Courses.OwnedCourse({ owner, course }), compute(C.gradedTitle, { title }, graded), is.among(graded, [false]),
    Library._sourceSet({ owner, scope: course }).is({ sources }), compute(C.singleMaterial, { material }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.suggestRequest, { selected }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(compute(C.generationFields, { answer }, { suggestions })).then(respond({ suggestions, tutor: Settings.SentTutor({ request: prepared }) }))), options);
export const composition = { Read, Progress, Confidence, Lesson, Task, Respond, Question, Reply, Hint, Transcript, Assess, RetryAssessment, Correct, Regrade, Adjust, ReplanAfterAdjustment, Suggest };
