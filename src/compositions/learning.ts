import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, no, is, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import * as R from "./learning-reads.ts";
import { learningInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, TutorGenerating: AI } = concepts;
const options = { validators: { ...validators, input: learningInput, output: structuredOutput } };

const Read = endpoint("/learning/read", ({ session, skill, owner }) => receive({ session, skill })
  .then(Sessioning.use({ session }).responds({ subject: owner })).afterFlowSettles().then(
    where(R.OwnedSkill({ owner, skill })).then(respond({ data: R.SkillData({ owner, skill }) })).named("owned"),
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

const Lesson = endpoint("/learning/lesson", ({ session, skill, request, owner, definition, context, sources, materials, selected, prepared, answer, explanation, citations, lesson }) => receive({ session, skill, request })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.ActiveSkill({ owner, skill }), R.SkillContext({ owner, skill }).is({ context, sources }),
    compute(C.selectSkillMaterials, { context }, materials), compute(C.selectSources, { sources, materials }, { selected, valid: true }),
    compute(C.lessonRequest, { selected, context, request }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(compute(C.generationDefinition, { request: prepared }, { definition }), R.ActiveSkill({ owner, skill }).is({ definition }), compute(C.generationFields, { answer }, { text: explanation, citations, materials }))
      .then(Tutoring.explain({ owner, topic: skill, definition, request, explanation, materials, citations }).responds({ lesson })).then(respond({ lesson })).named("current"),
    where(compute(C.generationDefinition, { request: prepared }, { definition }), no(R.ActiveSkill({ owner, skill }).is({ definition })))
      .then(respond({ error: "SKILL_CHANGED" })).named("changed"),
  ), options);
const Task = endpoint("/learning/task", ({ session, skill, owner, definition, context, skills, tracks, sources, materials, selected, sessions, prepared, answer, question, citations, criteria, task }) => receive({ session, skill })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.ActiveSkill({ owner, skill }).is({ definition }), R.SkillContext({ owner, skill }).is({ context, skills, tracks, sources }),
    Mastery._track({ learner: owner, subject: skill, definition }), C.prerequisitesReady({ skills, tracks, skill }),
    Tutoring._study({ owner, topic: skill }).is({ sessions }), compute(C.selectSkillMaterials, { context }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.taskRequest, { selected, context, sessions }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(compute(C.generationDefinition, { request: prepared }, { definition, criteria }), R.ActiveSkill({ owner, skill }).is({ definition }), compute(C.generationFields, { answer }, { text: question, citations, materials }))
      .then(Tutoring.prepareTask({ owner, topic: skill, definition, question, criteria, materials, citations, mode: "CHECK", fresh: true }).responds({ task })).then(respond({ task })).named("current"),
    where(compute(C.generationDefinition, { request: prepared }, { definition }), no(R.ActiveSkill({ owner, skill }).is({ definition })))
      .then(respond({ error: "SKILL_CHANGED" })).named("changed"),
  ), options);

const Respond = endpoint("/learning/respond", ({ session, studySession, text, channel, attachment, dialogueLength, owner, course, data, sources, media, currentDialogue }) => receive({ session, studySession, text, channel, attachment, dialogueLength })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.dialogueIsCurrent, { data, dialogueLength }, currentDialogue), is.among(currentDialogue, [true]),
    compute(C.responseInput, { data, text, channel, attachment, sources }, { valid: true, media }))
    .then(Tutoring.respond({ owner, session: studySession, text, channel, media }).responds({})))
  .then(respond({})), options);
const Question = endpoint("/learning/question", ({ session, studySession, text, channel, attachment, dialogueLength, owner, course, data, sources, media, currentDialogue, materials, selected, prepared, answer, reply, citations }) => receive({ session, studySession, text, channel, attachment, dialogueLength })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._lesson({ lesson: studySession }), Tutoring._sessionData({ session: studySession }).is({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.dialogueIsCurrent, { data, dialogueLength }, currentDialogue), is.among(currentDialogue, [true]),
    compute(C.responseInput, { data, text, channel, attachment, sources }, { valid: true, media }))
    .then(Tutoring.respond({ owner, session: studySession, text, channel, media }).responds({})))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.sessionRequest, { selected, data, kind: "REPLY" }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.OpenSession({ owner, studySession }), compute(C.generationFields, { answer }, { text: reply, citations }))
      .then(Tutoring.answerLesson({ owner, lesson: studySession, text: reply, citations, channel: "TEXT" }).responds({})).then(respond({})).named("open"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_CHANGED" })).named("closed"),
  ), options);
const Reply = endpoint("/learning/reply", ({ session, studySession, owner, course, data, materials, sources, selected, prepared, answer, text, citations }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }), C.hasLessonQuestion({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.sessionRequest, { selected, data, kind: "REPLY" }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.OpenSession({ owner, studySession }), compute(C.generationFields, { answer }, { text, citations }))
      .then(Tutoring.answerLesson({ owner, lesson: studySession, text, citations, channel: "TEXT" }).responds({})).then(respond({})).named("open"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_CHANGED" })).named("closed"),
  ), options);
const Hint = endpoint("/learning/hint", ({ session, studySession, owner, course, data, sources, materials, selected, prepared, answer, text }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }))
    .then(Tutoring.requestHint({ owner, task: studySession }).responds({})))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }), Tutoring._sourceSet({ owner, scope: course }).is({ sources }),
    compute(C.sessionMaterials, { data }, materials), compute(C.selectSources, { sources, materials }, { selected, valid: true }),
    compute(C.sessionRequest, { selected, data, kind: "HINT" }, prepared)).then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.OpenSession({ owner, studySession }), compute(C.generationFields, { answer }, { text }))
      .then(Tutoring.giveHint({ owner, task: studySession, text, channel: "TEXT" }).responds({})).then(respond({})).named("open"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_CHANGED" })).named("closed"),
  ), options);
const Transcript = endpoint("/learning/transcript", ({ session, studySession, turnIndex, text, owner }) => receive({ session, studySession, turnIndex, text })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OpenSession({ owner, studySession })).then(Tutoring.confirmTranscript({ owner, session: studySession, turnIndex, text }).responds({})).then(respond({})).named("owned"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  ), options);

const Assess = endpoint("/learning/assess", ({ session, studySession, dialogueLength, reviewed, unseen, outsideHelp, owner, skill, definition, course, assessment, data, sessionData, sources, materials, selected, prepared, answer, result, gateMet, rationale, approved }) => receive({ session, studySession, dialogueLength, reviewed, unseen, outsideHelp })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ skill, definition }), compute(C.reviewApproved, { reviewed, unseen, outsideHelp }, approved), is.among(approved, [true]),
    Mastery._track({ learner: owner, subject: skill, definition }))
    .then(Tutoring.confirmAttempt({ owner, task: studySession, dialogueLength, unseen, outsideHelp }).responds({})))
  .afterFlowSettles().where(R.OwnedSession({ owner, studySession }).is({ course }), Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }),
    no(Assessment._effectiveJudgment({ case: assessment })), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: studySession }).is({ data: sessionData }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data: sessionData }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.gradeRequest, { selected, data }, prepared))
  .then(AI.generate({ owner, request: prepared }).responds({ answer }))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.assess({ case: assessment, result, gateMet, rationale }).responds({})))
  .afterFlowSettles().then(respond({ studySession })), options);
const RetryAssessment = endpoint("/learning/retry", ({ session, studySession, owner, assessment, course, data, sessionData, sources, materials, selected, prepared, answer, result, gateMet, rationale }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OwnedSession({ owner, studySession }).is({ course }), Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }),
    no(Assessment._effectiveJudgment({ case: assessment })), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: studySession }).is({ data: sessionData }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data: sessionData }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.gradeRequest, { selected, data }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.assess({ case: assessment, result, gateMet, rationale }).responds({})))
  .afterFlowSettles().then(respond({})), options);

// An imported case keeps gateMet false: imported coursework cannot show the complete demonstration gate.
// Every other correction goes to revise, which still refuses another learner's case or an outdated judgment.
// A continuation follows every branch, so the settled answer reads the effective judgment again, and each branch excludes the others.
const Correct = endpoint("/learning/correct", ({ session, case: assessment, basedOn, result, gateMet, reason, owner, judgment }) => receive({ session, case: assessment, basedOn, result, gateMet, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: true }), is.among(gateMet, [true]))
      .then(respond({ error: "IMPORTED_GATE_UNAVAILABLE" })).named("importedGate"),
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: true }), is.among(gateMet, [false]))
      .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale: reason, origin: "MANUAL" }).responds({ judgment })).named("imported"),
    where(no(R.OwnedAnyCase({ owner, assessment }).is({ imported: true })))
      .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale: reason, origin: "MANUAL" }).responds({ judgment })).named("practice"),
  ).afterFlowSettles().then(
    where(Assessment._effectiveJudgment({ case: assessment }).is({ judgment }), R.OwnedAnyCase({ owner, assessment }).is({ imported: true }), is.among(gateMet, [false]))
      .then(respond({ judgment })).named("importedRevised"),
    where(Assessment._effectiveJudgment({ case: assessment }).is({ judgment }), no(R.OwnedAnyCase({ owner, assessment }).is({ imported: true })))
      .then(respond({ judgment })).named("practiceRevised"),
  ), options);
// Imported coursework has no practice task to regrade, so it is refused before any clarification or tutor request.
const Regrade = endpoint("/learning/regrade", ({ session, case: assessment, basedOn, reason, owner, course, task, clarification, data, sessionData, sources, materials, selected, prepared, answer, result, gateMet, rationale, judgment }) => receive({ session, case: assessment, basedOn, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OwnedAnyCase({ owner, assessment }).is({ imported: true })).then(respond({ error: "REGRADE_IMPORTED_UNAVAILABLE" })).named("imported"),
    where(R.OwnedCase({ owner, assessment }), Assessment._effectiveJudgment({ case: assessment }).is({ judgment: basedOn }),
      compute(C.correctionNote, { reason }, clarification)).then(Assessment.clarify({ author: owner, case: assessment, clarification }).responds({})).named("practice"),
  )
  .then(where(R.OwnedCase({ owner, assessment }).is({ course, task }), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: task }).is({ data: sessionData }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data: sessionData }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.gradeRequest, { selected, data }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale, origin: "AI" }).responds({ judgment })))
  .afterFlowSettles().then(respond({ judgment })), options);
// Graded work is evidence, not a teaching source. The check applies only to the learner's own material in a course they own;
// any other material keeps the admission refusal. Every branch shares the stages that follow, so the tutor request lives there
// and repeats the source condition: the graded branch has already answered, and the source branch only rechecks the session.
const Suggest = endpoint("/courses/skills/suggest", ({ session, material, owner, course, sources, selected, materials, prepared, answer, suggestions, title, graded }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Tutoring._material({ material }).is({ owner, scope: course, title }), Courses.OwnedCourse({ owner, course }), compute(C.gradedTitle, { title }, graded), is.among(graded, [true]))
      .then(respond({ error: "GRADED_MATERIAL_NOT_SOURCE" })).named("graded"),
    where(Tutoring._material({ material }).is({ owner, scope: course, title }), Courses.OwnedCourse({ owner, course }), compute(C.gradedTitle, { title }, graded), is.among(graded, [false]))
      .then(Sessioning.use({ session }).responds({ subject: owner })).named("source"),
  )
  .then(where(Tutoring._material({ material }).is({ owner, scope: course, title }), Courses.OwnedCourse({ owner, course }), compute(C.gradedTitle, { title }, graded), is.among(graded, [false]),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.singleMaterial, { material }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.suggestRequest, { selected }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(compute(C.generationFields, { answer }, { suggestions })).then(respond({ suggestions }))), options);
export const composition = { Read, Progress, Confidence, Lesson, Task, Respond, Question, Reply, Hint, Transcript, Assess, RetryAssessment, Correct, Regrade, Suggest };
