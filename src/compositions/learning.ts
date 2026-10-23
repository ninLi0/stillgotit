import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, no, is, now, reaction, when, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import { composition as Settings } from "./settings.ts";
import * as R from "./learning-reads.ts";
import { learningInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning, TutorGenerating: AI } = concepts;
const options = { validators: { ...validators, input: learningInput, output: structuredOutput } };

/**
 * Conditions that add the learner's tutor choice to a prepared request. TutorStatus must be SAVED or DEFAULT, and withChoice
 * adds exactly that validated model and level, so TutorGenerating.generate never sends a value from the browser.
 */
const usingTutorChoice = (owner: symbol, draft: symbol, choice: symbol, status: symbol, prepared: symbol) => [
  Settings.TutorStatus({ owner }).is({ choice, status }), is.among(status, ["SAVED", "DEFAULT"]), compute(C.withChoice, { request: draft, choice }, prepared),
] as const;

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
  .then(where(R.ActiveSkill({ owner, skill }), R.SkillContext({ owner, skill }).is({ context, sources }),
    compute(C.selectSkillMaterials, { context }, materials), compute(C.selectSources, { sources, materials }, { selected, valid: true }),
    compute(C.lessonRequest, { selected, context, request }, draft), ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(compute(C.generationDefinition, { request: prepared }, { definition }), R.ActiveSkill({ owner, skill }).is({ definition }), compute(C.generationFields, { answer }, { text: explanation, citations, materials }))
      .then(Tutoring.explain({ owner, topic: skill, definition, request, explanation, materials, citations }).responds({ lesson }))
      .then(respond({ lesson, tutor: Settings.SentTutor({ request: prepared }) })).named("current"),
    where(compute(C.generationDefinition, { request: prepared }, { definition }), no(R.ActiveSkill({ owner, skill }).is({ definition })))
      .then(respond({ error: "SKILL_CHANGED" })).named("changed"),
  ), options);
const Task = endpoint("/learning/task", ({ session, skill, owner, definition, context, skills, tracks, sources, materials, selected, sessions, draft, choice, status, prepared, answer, question, citations, criteria, task }) => receive({ session, skill })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.ActiveSkill({ owner, skill }).is({ definition }), R.SkillContext({ owner, skill }).is({ context, skills, tracks, sources }),
    Mastery._track({ learner: owner, subject: skill, definition }), C.prerequisitesReady({ skills, tracks, skill }),
    Tutoring._study({ owner, topic: skill }).is({ sessions }), compute(C.selectSkillMaterials, { context }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.taskRequest, { selected, context, sessions }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(compute(C.generationDefinition, { request: prepared }, { definition, criteria }), R.ActiveSkill({ owner, skill }).is({ definition }), compute(C.generationFields, { answer }, { text: question, citations, materials }))
      .then(Tutoring.prepareTask({ owner, topic: skill, definition, question, criteria, materials, citations, mode: "CHECK", fresh: true }).responds({ task }))
      .then(respond({ task, tutor: Settings.SentTutor({ request: prepared }) })).named("current"),
    where(compute(C.generationDefinition, { request: prepared }, { definition }), no(R.ActiveSkill({ owner, skill }).is({ definition })))
      .then(respond({ error: "SKILL_CHANGED" })).named("changed"),
  ), options);

const Respond = endpoint("/learning/respond", ({ session, studySession, text, channel, attachments, dialogueLength, owner, course, data, sources, media, currentDialogue }) => receive({ session, studySession, text, channel, attachments, dialogueLength })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.dialogueIsCurrent, { data, dialogueLength }, currentDialogue), is.among(currentDialogue, [true]),
    compute(C.responseInput, { data, text, channel, attachments, sources }, { valid: true, media }))
    .then(Tutoring.respond({ owner, session: studySession, text, channel, media }).responds({})))
  .then(respond({})), options);
const Question = endpoint("/learning/question", ({ session, studySession, text, channel, attachments, dialogueLength, owner, course, data, sources, media, currentDialogue, materials, selected, draft, choice, status, prepared, answer, reply, citations }) => receive({ session, studySession, text, channel, attachments, dialogueLength })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._lesson({ lesson: studySession }), Tutoring._sessionData({ session: studySession }).is({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.dialogueIsCurrent, { data, dialogueLength }, currentDialogue), is.among(currentDialogue, [true]),
    compute(C.responseInput, { data, text, channel, attachments, sources }, { valid: true, media }))
    .then(Tutoring.respond({ owner, session: studySession, text, channel, media }).responds({})))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.sessionRequest, { selected, data, kind: "REPLY" }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.OpenSession({ owner, studySession }), compute(C.generationFields, { answer }, { text: reply, citations }))
      .then(Tutoring.answerLesson({ owner, lesson: studySession, text: reply, citations, channel: "TEXT" }).responds({}))
      .then(respond({ tutor: Settings.SentTutor({ request: prepared }) })).named("open"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_CHANGED" })).named("closed"),
  ), options);
const Reply = endpoint("/learning/reply", ({ session, studySession, owner, course, data, materials, sources, selected, draft, choice, status, prepared, answer, text, citations }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }), C.hasLessonQuestion({ data }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.sessionRequest, { selected, data, kind: "REPLY" }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.OpenSession({ owner, studySession }), compute(C.generationFields, { answer }, { text, citations }))
      .then(Tutoring.answerLesson({ owner, lesson: studySession, text, citations, channel: "TEXT" }).responds({}))
      .then(respond({ tutor: Settings.SentTutor({ request: prepared }) })).named("open"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_CHANGED" })).named("closed"),
  ), options);
const Hint = endpoint("/learning/hint", ({ session, studySession, owner, course, data, sources, materials, selected, draft, choice, status, prepared, answer, text }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }))
    .then(Tutoring.requestHint({ owner, task: studySession }).responds({})))
  .then(where(R.OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }), Tutoring._sourceSet({ owner, scope: course }).is({ sources }),
    compute(C.sessionMaterials, { data }, materials), compute(C.selectSources, { sources, materials }, { selected, valid: true }),
    compute(C.sessionRequest, { selected, data, kind: "HINT" }, draft), ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(
    where(R.OpenSession({ owner, studySession }), compute(C.generationFields, { answer }, { text }))
      .then(Tutoring.giveHint({ owner, task: studySession, text, channel: "TEXT" }).responds({}))
      .then(respond({ tutor: Settings.SentTutor({ request: prepared }) })).named("open"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_CHANGED" })).named("closed"),
  ), options);
const Transcript = endpoint("/learning/transcript", ({ session, studySession, turnIndex, text, owner }) => receive({ session, studySession, turnIndex, text })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.OpenSession({ owner, studySession })).then(Tutoring.confirmTranscript({ owner, session: studySession, turnIndex, text }).responds({})).then(respond({})).named("owned"),
    where(no(R.OpenSession({ owner, studySession }))).then(respond({ error: "SESSION_UNAVAILABLE" })).named("missing"),
  ), options);

const Assess = endpoint("/learning/assess", ({ session, studySession, dialogueLength, reviewed, unseen, outsideHelp, owner, skill, definition, course, assessment, data, sessionData, sources, materials, selected, draft, choice, status, prepared, answer, result, gateMet, rationale, approved }) => receive({ session, studySession, dialogueLength, reviewed, unseen, outsideHelp })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OpenSession({ owner, studySession }).is({ skill, definition }), compute(C.reviewApproved, { reviewed, unseen, outsideHelp }, approved), is.among(approved, [true]),
    Mastery._track({ learner: owner, subject: skill, definition }))
    .then(Tutoring.confirmAttempt({ owner, task: studySession, dialogueLength, unseen, outsideHelp }).responds({})))
  .afterFlowSettles().where(R.OwnedSession({ owner, studySession }).is({ course }), Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }),
    no(Assessment._effectiveJudgment({ case: assessment })), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: studySession }).is({ data: sessionData }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data: sessionData }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.gradeRequest, { selected, data }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
  .then(AI.generate({ owner, request: prepared }).responds({ answer }))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.assess({ case: assessment, result, gateMet, rationale }).responds({})))
  .afterFlowSettles().then(respond({ studySession, tutor: Settings.SentTutor({ request: prepared }) })), options);
const RetryAssessment = endpoint("/learning/retry", ({ session, studySession, owner, assessment, course, data, sessionData, sources, materials, selected, draft, choice, status, prepared, answer, result, gateMet, rationale }) => receive({ session, studySession })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OwnedSession({ owner, studySession }).is({ course }), Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }),
    no(Assessment._effectiveJudgment({ case: assessment })), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: studySession }).is({ data: sessionData }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data: sessionData }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.gradeRequest, { selected, data }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }), compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.assess({ case: assessment, result, gateMet, rationale }).responds({})))
  .afterFlowSettles().then(respond({ tutor: Settings.SentTutor({ request: prepared }) })), options);

const Correct = endpoint("/learning/correct", ({ session, case: assessment, basedOn, result, gateMet, reason, owner, judgment }) => receive({ session, case: assessment, basedOn, result, gateMet, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale: reason, origin: "MANUAL" }).responds({ judgment }))
  .afterFlowSettles().then(respond({ judgment })), options);
const Regrade = endpoint("/learning/regrade", ({ session, case: assessment, basedOn, reason, owner, course, task, clarification, data, sessionData, sources, materials, selected, draft, choice, status, prepared, answer, result, gateMet, rationale, judgment }) => receive({ session, case: assessment, basedOn, reason })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.OwnedCase({ owner, assessment }), Assessment._effectiveJudgment({ case: assessment }).is({ judgment: basedOn }),
    compute(C.correctionNote, { reason }, clarification)).then(Assessment.clarify({ author: owner, case: assessment, clarification }).responds({})))
  .then(where(R.OwnedCase({ owner, assessment }).is({ course, task }), Assessment._caseData({ case: assessment }).is({ data }), Tutoring._sessionData({ session: task }).is({ data: sessionData }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.sessionMaterials, { data: sessionData }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.gradeRequest, { selected, data }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(compute(C.generationFields, { answer }, { result, gateMet, rationale }))
    .then(Assessment.revise({ author: owner, case: assessment, basedOn, result, gateMet, rationale, origin: "AI" }).responds({ judgment })))
  .afterFlowSettles().then(respond({ judgment, tutor: Settings.SentTutor({ request: prepared }) })), options);
// The learner sets the estimate by hand. The settled stage answers only in a terminal state of ReplanAfterAdjustment:
// no replan can run, or a proposed or active plan carries the current fingerprint, which includes this adjustment.
// Until then it does not answer, so a refused replan reaches the learner as the answer.
// It reads the saved adjustment again; the missing path never reaches it because ActiveSkill does not hold there.
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
      Mastery._adjustments({ track }).is({ adjustment }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ basis }),
      Planning._plans({ learner: owner, scope: course }).is({ plan, status }), is.among(status, ["PROPOSED", "ACTIVE"]), Planning._plan({ plan }).is({ basis }))
      .then(respond({ adjustment })).named("planned"),
  ), options);
const ReplanAfterAdjustment = reaction(({ owner, skill, course, candidates, horizonEnd, basis, explanation }) => when(Mastery.adjust({ learner: owner, subject: skill }).responds({}))
  .afterFlowSettles().where(R.OwnedSkill({ owner, skill }).is({ course }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const Suggest = endpoint("/courses/skills/suggest", ({ session, material, owner, course, sources, selected, materials, draft, choice, status, prepared, answer, suggestions }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Tutoring._material({ material }).is({ owner, scope: course }), Courses.OwnedCourse({ owner, course }),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.singleMaterial, { material }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.suggestRequest, { selected }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(compute(C.generationFields, { answer }, { suggestions })).then(respond({ suggestions, tutor: Settings.SentTutor({ request: prepared }) }))), options);
export const composition = { Read, Progress, Confidence, Lesson, Task, Respond, Question, Reply, Hint, Transcript, Assess, RetryAssessment, Correct, Regrade, Adjust, ReplanAfterAdjustment, Suggest };
