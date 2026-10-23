import { compute, reaction, when, returned, now } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import * as R from "./learning-reads.ts";
const { SkillMapping: Mapping, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning } = concepts;
const SubmitReviewed = reaction(({ owner, task, unseen, outsideHelp, skill, definition, data, sourceKey, response, help, fresh, question, criteria, at }) =>
  when(Tutoring.confirmAttempt({ owner, task, unseen, outsideHelp }).responds({}))
    .where(R.OpenSession({ owner, studySession: task }).is({ skill, definition }), Tutoring._review({ task }).is({ ready: true }),
      Mastery._track({ learner: owner, subject: skill, definition }), Tutoring._task({ task }).is({ question, criteria }),
      Tutoring._sessionData({ session: task }).is({ data }), now(at), compute(C.submissionInput, { data, unseen, outsideHelp }, { sourceKey, response, help, fresh }))
    .then(Assessment.submit({ author: owner, subject: skill, definition, sourceKey, task, question, criteria, response, help, fresh, performedAt: at })));
const CloseSubmitted = reaction(({ owner, task }) => when(Assessment.submit({ author: owner, task }).responds({}))
  .where(Tutoring._session({ session: task }).is({ owner, status: "OPEN" })).then(Tutoring.close({ owner, session: task })));
const AssessedEvidence = reaction(({ assessment, owner, skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt, attribution }) => when(Assessment.assess({ case: assessment }).responds({}))
  .where(Assessment._case({ case: assessment }).is({ author: owner }),
    R.NeedsEvidence({ owner, assessment }).is({ skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }), compute(C.evidenceAttribution, { origin, rationale }, attribution))
  .then(Mastery.acceptEvidence({ learner: owner, subject: skill, definition, evidence: assessment, revision, performedAt, signal: result, fresh, gateMet, attribution })));
const RevisedEvidence = reaction(({ assessment, owner, skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt, attribution }) => when(Assessment.revise({ case: assessment, author: owner }).responds({}))
  .where(R.NeedsEvidence({ owner, assessment }).is({ skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }), compute(C.evidenceAttribution, { origin, rationale }, attribution))
  .then(Mastery.acceptEvidence({ learner: owner, subject: skill, definition, evidence: assessment, revision, performedAt, signal: result, fresh, gateMet, attribution })));
const ImportedEvidence = reaction(({ assessment, owner, skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt, attribution }) => when(Assessment.importGraded({ author: owner }).responds({ case: assessment }))
  .where(R.NeedsEvidence({ owner, assessment }).is({ skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }), compute(C.evidenceAttribution, { origin, rationale }, attribution))
  .then(Mastery.acceptEvidence({ learner: owner, subject: skill, definition, evidence: assessment, revision, performedAt, signal: result, fresh, gateMet, attribution })));
const InitializedEvidence = reaction(({ owner, skill, definition, assessment, revision, result, gateMet, rationale, origin, fresh, performedAt, attribution }) => when(Mastery.initialize({ learner: owner, subject: skill, definition }).responds({}))
  .where(Assessment._cases({ author: owner, subject: skill }).is({ case: assessment }),
    R.NeedsEvidence({ owner, assessment }).is({ skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }), compute(C.evidenceAttribution, { origin, rationale }, attribution))
  .then(Mastery.acceptEvidence({ learner: owner, subject: skill, definition, evidence: assessment, revision, performedAt, signal: result, fresh, gateMet, attribution })));
const ReplanAfterEvidence = reaction(({ owner, skill, course, candidates, horizonEnd, basis, explanation }) => when(Mastery.acceptEvidence({ learner: owner, subject: skill }).responds({}))
  .afterFlowSettles().where(R.OwnedSkill({ owner, skill }).is({ course }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const ReplanAfterConfidence = reaction(({ owner, skill, course, candidates, horizonEnd, basis, explanation }) => when(Mastery.initialize({ learner: owner, subject: skill }).responds({}))
  .afterFlowSettles().where(R.OwnedSkill({ owner, skill }).is({ course }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const ReplanAfterBudget = reaction(({ owner, course, candidates, horizonEnd, basis, explanation }) => when(Planning.configure({ learner: owner, scope: course }).responds({}))
  .where(R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const ActivateRoutine = reaction(({ owner, course, plan, currentBasis }) => when(Planning.replan({ learner: owner, scope: course, workloadComplete: false }).responds({ plan }))
  .where(R.PlanContext({ owner, course }).is({ basis: currentBasis }), Planning._proposalCheck({ learner: owner, plan, currentBasis }).is({ canActivate: true, needsConfirmation: false }))
  .then(Planning.activateRoutine({ learner: owner, plan, currentBasis })));
// No course can be replanned during an activity, so finishing or stopping one refreshes every course of the learner
// with saved preferences. An exam or budget change made in another course during the activity takes effect here.
const ReplanAfterFinish = reaction(({ owner, course, candidates, horizonEnd, basis, explanation }) => when(Planning.finish({ learner: owner }).responds({}))
  .where(Mapping._courses({ owner }).is({ course }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const ReplanAfterStop = reaction(({ owner, course, candidates, horizonEnd, basis, explanation }) => when(Planning.stop({ learner: owner }).responds({}))
  .where(Mapping._courses({ owner }).is({ course }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const ReplanAfterMiss = reaction(({ owner, item, course, candidates, horizonEnd, basis, explanation }) => when(Planning.miss({ learner: owner, item }).responds({}))
  .where(Planning._item({ item }).is({ learner: owner, scope: course }), R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
// Recovery is scoped to the Read endpoint's successful authentication occurrence.
const RepairReadEvidence = reaction(({ identity, owner, course, unit, skill, assessment, definition, revision, result, gateMet, rationale, origin, fresh, performedAt, attribution }) =>
  when(returned({ concept: "Sessioning", action: "use", result: identity }, { by: "Learning.Read" }))
    .where(compute(C.sessionSubject, { identity }, { owner }), Mapping._courses({ owner }).is({ course }), Mapping._units({ course }).is({ unit }), Mapping._skills({ unit }).is({ skill }),
      Assessment._cases({ author: owner, subject: skill }).is({ case: assessment }),
      R.NeedsEvidence({ owner, assessment }).is({ skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }),
      compute(C.evidenceAttribution, { origin, rationale }, attribution))
    .then(Mastery.acceptEvidence({ learner: owner, subject: skill, definition, evidence: assessment, revision, performedAt, signal: result, fresh, gateMet, attribution })));
const RepairReadClosure = reaction(({ identity, owner, course, unit, skill, assessment, task }) =>
  when(returned({ concept: "Sessioning", action: "use", result: identity }, { by: "Learning.Read" }))
    .where(compute(C.sessionSubject, { identity }, { owner }), Mapping._courses({ owner }).is({ course }), Mapping._units({ course }).is({ unit }), Mapping._skills({ unit }).is({ skill }),
      Assessment._cases({ author: owner, subject: skill }).is({ case: assessment }), Assessment._case({ case: assessment }).is({ task }),
      Tutoring._session({ session: task }).is({ owner, status: "OPEN" }))
    .then(Tutoring.close({ owner, session: task })));
export const composition = { RepairReadEvidence, RepairReadClosure, SubmitReviewed, CloseSubmitted, AssessedEvidence, RevisedEvidence, ImportedEvidence, InitializedEvidence,
  ReplanAfterEvidence, ReplanAfterConfidence, ReplanAfterBudget, ActivateRoutine, ReplanAfterFinish, ReplanAfterStop, ReplanAfterMiss };
