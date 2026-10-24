import { compute, each, former, no, view, where, whether } from "@mit-sdg/sync-engine/language";
import { concepts, computations } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
const { SkillMapping: Mapping, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning } = concepts;
export const OwnedSkill = view("(owner) owns study skill (skill)", ({ owner, skill }, { course, definition, status }, { unit }) => where(
  Mapping._skill({ skill }).is({ unit, current: definition, status }), Mapping._unit({ unit }).is({ course }), Courses.OwnedCourse({ owner, course }),
)).optional();
export const ActiveSkill = view("(owner) can study confirmed (skill)", ({ owner, skill }, { course, definition }) => where(OwnedSkill({ owner, skill }).is({ course, definition, status: "CONFIRMED" }))).optional();
export const OwnedSession = view("(owner) owns study session (studySession)", ({ owner, studySession }, { skill, course, definition }) => where(
  Tutoring._session({ session: studySession }).is({ owner, topic: skill, definition }), OwnedSkill({ owner, skill }).is({ course }),
)).optional();
export const OpenSession = view("(owner) can change session (studySession)", ({ owner, studySession }, { skill, course, definition }) => where(
  OwnedSession({ owner, studySession }).is({ skill, course, definition }), Tutoring._session({ session: studySession }).is({ status: "OPEN" }),
  no(Assessment._byTask({ author: owner, task: studySession })),
)).optional();
export const OwnedCase = view("(owner) owns assessment (assessment)", ({ owner, assessment }, { skill, course, definition, task }) => where(
  Assessment._case({ case: assessment }).is({ author: owner, subject: skill, definition, task }), OwnedSkill({ owner, skill }).is({ course }),
)).optional();
// A practice or imported case, joined to its author and course without reading a task.
export const OwnedAnyCase = view("(owner) owns practice or imported assessment (assessment)", ({ owner, assessment }, { skill, course, definition, imported }) => where(
  Assessment._case({ case: assessment }).is({ author: owner, subject: skill, definition, imported }), OwnedSkill({ owner, skill }).is({ course }),
)).optional();
export const SkillContext = view("the current context of (skill) for (owner)", ({ owner, skill }, { context, skills, tracks, sources }, { course }) => where(
  OwnedSkill({ owner, skill }).is({ course }), Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }),
  Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(computations.selectSkill, { skills, skill }, context),
)).optional();
export const SkillData = former("study data for (owner) and (skill)", ({ owner, skill }, { context, tracks, sessions, cases, track, estimate }) => where(
  SkillContext({ owner, skill }).is({ context, tracks }), Tutoring._study({ owner, topic: skill }).is({ sessions }),
  Assessment._history({ author: owner, subject: skill }).is({ cases }), compute(computations.studyDetail, { context, tracks, sessions, cases }, { track, estimate }),
).form({ skill: context, track, estimate, sessions, cases }));
export const SessionData = former("saved study session (studySession)", ({ studySession }, { data }) => where(Tutoring._sessionData({ session: studySession }).is({ data })).form({ data }));
export const Progress = former("skill estimates for (owner) in (course)", ({ owner, course }, { skills, tracks, estimates }) => where(
  Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }), compute(computations.progressRows, { skills, tracks }, estimates),
).form({ estimates }));
export const PlanData = former("study plan for (owner) in (course)", ({ owner, course }, { schedule, preferences, budget, next, today, plan }) => where(
  Planning._schedule({ learner: owner, scope: course }).is({ schedule }), compute(computations.planDetail, { schedule }, { preferences, budget, next, today, plan }),
).form({ preferences, budget, next, today, plan }));
export const PlanContext = view("review inputs for (owner) in (course)", ({ owner, course }, { candidates, horizonEnd, basis, explanation }, { skills, tracks, schedule }) => where(
  Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }), Planning._schedule({ learner: owner, scope: course }).is({ schedule }),
  compute(computations.planRequest, { skills, tracks, schedule }, { candidates, horizonEnd, basis, explanation }),
)).one();
export const CanReplan = view("(owner) can refresh routine reviews in (course)", ({ owner, course }) => where(
  Courses.OwnedCourse({ owner, course }), Planning._preferences({ learner: owner, scope: course }), no(Planning._next({ learner: owner, scope: course }).is({ status: "IN_PROGRESS" })),
)).holds();
export const NeedsEvidence = view("assessment (assessment) needs evidence for (owner)", ({ owner, assessment }, { skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }, { data, tracks }) => where(
  Assessment._case({ case: assessment }).is({ author: owner, subject: skill, definition, fresh, performedAt }),
  Assessment._effectiveJudgment({ case: assessment }).is({ revision, result, gateMet, rationale, origin }),
  Assessment._caseData({ case: assessment }).is({ data }), Mastery._progress({ learner: owner }).is({ tracks }),
  compute(computations.evidenceUpdate, { data, tracks }, { needed: true }),
)).optional();
export const composition = { OwnedSkill, ActiveSkill, OwnedSession, OpenSession, OwnedCase, OwnedAnyCase, SkillContext, SkillData, SessionData, Progress, PlanData, PlanContext, CanReplan, NeedsEvidence };
