import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, each, former, no, now, view, where, whether, type Condition } from "@mit-sdg/sync-engine/language";
import { concepts, computations } from "../concepts.ts";
import { SEARCH_STEPS } from "../computations/memory.ts";
import { composition as Courses } from "./courses.ts";
import { learningInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, SkillMapping: Mapping, Library, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, MasteryEstimating: Mastery, StudyPlanning: Planning } = concepts;
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
// The learner's open session with its saved dialogue and the learner's sources in its course. The two queries always
// answer for an existing session, so this view holds exactly when OpenSession holds; OpenSession stays the refusal guard.
export const SessionSources = view("(owner) can use open session (studySession) with its sources", ({ owner, studySession }, { course, data, sources }) => where(
  OpenSession({ owner, studySession }).is({ course }), Tutoring._sessionData({ session: studySession }).is({ data }), Library._sourceSet({ owner, scope: course }).is({ sources }),
)).optional();
// A submitted attempt in the learner's own session that has no judgment yet, with the case's work, the saved session, and
// the learner's sources in its course: everything a grading request reads.
export const PendingGrade = view("(owner) has an ungraded attempt in (studySession)", ({ owner, studySession }, { course, assessment, data, sessionData, sources }) => where(
  OwnedSession({ owner, studySession }).is({ course }), Assessment._byTask({ author: owner, task: studySession }).is({ case: assessment }),
  no(Assessment._effectiveJudgment({ case: assessment })), Assessment._caseData({ case: assessment }).is({ data }),
  Tutoring._sessionData({ session: studySession }).is({ data: sessionData }), Library._sourceSet({ owner, scope: course }).is({ sources }),
)).optional();
export const OwnedCase = view("(owner) owns assessment (assessment)", ({ owner, assessment }, { skill, course, definition, task }) => where(
  Assessment._case({ case: assessment }).is({ author: owner, subject: skill, definition, task }), OwnedSkill({ owner, skill }).is({ course }),
)).optional();
// A practice or imported case, joined to its author and course without reading a task.
export const OwnedAnyCase = view("(owner) owns practice or imported assessment (assessment)", ({ owner, assessment }, { skill, course, definition, imported }) => where(
  Assessment._case({ case: assessment }).is({ author: owner, subject: skill, definition, imported }), OwnedSkill({ owner, skill }).is({ course }),
)).optional();
export const SkillContext = view("the current context of (skill) for (owner)", ({ owner, skill }, { context, definition, skills, tracks, sources }, { course }) => where(
  OwnedSkill({ owner, skill }).is({ course, definition }), Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }),
  Library._sourceSet({ owner, scope: course }).is({ sources }), compute(computations.selectSkill, { skills, skill }, context),
)).optional();
// `at` is the Read flow's instant. The explanation is an optional row: without one, `explanation` is null and the record is unchanged.
export const SkillData = former("study data for (owner) and (skill) at (at)", ({ owner, skill, at }, { context, definition, tracks, sessions, cases, track, estimate, explanation, timeline }) => where(
  SkillContext({ owner, skill }).is({ context, definition, tracks }), Tutoring._study({ owner, topic: skill }).is({ sessions }),
  Assessment._history({ author: owner, subject: skill }).is({ cases }), compute(computations.studyDetail, { context, tracks, sessions, cases }, { track, estimate }),
  whether(Mastery._explanation({ learner: owner, subject: skill, definition, at }).is({ explanation })),
  compute(computations.estimateTimeline, { explanation, tracks }, timeline),
).form({ skill: context, track, estimate, sessions, cases, explanation: timeline }));
export const SessionData = former("saved study session (studySession)", ({ studySession }, { data }) => where(Tutoring._sessionData({ session: studySession }).is({ data })).form({ data }));
export const Progress = former("skill estimates for (owner) in (course)", ({ owner, course }, { skills, tracks, estimates }) => where(
  Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }), compute(computations.progressRows, { skills, tracks }, estimates),
).form({ estimates }));
export const PlanData = former("study plan for (owner) in (course)", ({ owner, course }, { schedule, preferences, budget, next, today, plan }) => where(
  Planning._schedule({ owner, scope: course }).is({ schedule }), compute(computations.planDetail, { schedule }, { preferences, budget, next, today, plan }),
).form({ preferences, budget, next, today, plan }));
export const PlanContext = view("review inputs for (owner) in (course)", ({ owner, course }, { candidates, horizonEnd, basis, explanation }, { skills, tracks, schedule }) => where(
  Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }), Planning._schedule({ owner, scope: course }).is({ schedule }),
  compute(computations.planRequest, { skills, tracks, schedule }, { candidates, horizonEnd, basis, explanation }),
)).one();
export const CanReplan = view("(owner) can refresh routine reviews in (course)", ({ owner, course }) => where(
  Courses.OwnedCourse({ owner, course }), Planning._preferences({ owner, scope: course }), no(Planning._next({ owner, scope: course }).is({ status: "IN_PROGRESS" })),
)).holds();
export const NeedsEvidence = view("assessment (assessment) needs evidence for (owner)", ({ owner, assessment }, { skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt }, { data, tracks }) => where(
  Assessment._case({ case: assessment }).is({ author: owner, subject: skill, definition, fresh, performedAt }),
  Assessment._effectiveJudgment({ case: assessment }).is({ revision, result, gateMet, rationale, origin }),
  Assessment._caseData({ case: assessment }).is({ data }), Mastery._progress({ learner: owner }).is({ tracks }),
  compute(computations.evidenceUpdate, { data, tracks }, { needed: true }),
)).optional();
// The sessions Home offers to continue: each session of a confirmed skill in the course that OpenSession admits, so a task
// with submitted work is left out. The kind and the latest turn's time come from the session's own record.
export const OpenStudy = former("open study sessions for (owner) in (course)", ({ owner, course }, { unit, skill, title, studySession, data, kind, lastActive }) =>
  each(Mapping._units({ course }).is({ unit }))
    .where(Mapping._skills({ unit }).is({ skill, title, status: "CONFIRMED" }), Tutoring._sessions({ owner, topic: skill }).is({ session: studySession, status: "OPEN" }),
      OpenSession({ owner, studySession }).is({ skill, course }), Tutoring._sessionData({ session: studySession }).is({ data }),
      compute(computations.sessionActivity, { data }, { kind, lastActive }))
    .arranged(studySession)
    .form({ studySession, skill, title, kind, lastActive }),
);
const Continue = endpoint("/learning/continue", ({ session, course, owner }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course })).then(respond({ sessions: OpenStudy({ owner, course }) })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, input: learningInput, output: structuredOutput } });

// ---- Memory curves (design/compositions/LearningReads.md, "Memory curves") ----
// Every value on a curve is MasteryEstimating's: _estimate for the skill's own projection, _withoutPractice for a curve
// that belongs to no track. The computations only place and compare those values.
/**
 * The review search's steps. Each reads the projection on the middle day of the interval still in question and keeps the
 * half that holds the first day below the threshold; SEARCH_STEPS steps narrow 180 days to one.
 */
function reviewSearchLines(owner: symbol, skill: symbol, definition: symbol, threshold: symbol, at: symbol, free: Record<string, symbol>): Condition[] {
  const lines: Condition[] = [compute(computations.reviewSearch, { at }, free.search0!)];
  for (let step = 1; step <= SEARCH_STEPS; step++) {
    const search = free[`search${step - 1}`]!, probe = free[`probe${step}`]!, value = free[`probed${step}`]!;
    lines.push(compute(computations.reviewProbe, { search }, probe),
      Mastery._estimate({ learner: owner, subject: skill, definition, at: probe }).is({ value }),
      compute(computations.reviewNarrow, { search, value, threshold }, free[`search${step}`]!));
  }
  return lines;
}
// The skill's curve for its current definition: its starting point, the estimate at `at`, the projection sampled at whole
// days after `at`, the first day the projection falls below the review threshold, and the curve the skill would have
// followed from its starting point with no evidence. There is no row when the definition has no track.
export const SkillCurve = view("the memory curve of (skill) at (definition) for (owner) at (at)", ({ owner, skill, definition, at },
  { startingConfidence, startedAt, estimate, projection, reviewBy, belowNow, leftAlone }, free) => {
  const { threshold, explanation, t1, t3, t7, t14, t30, t60, t90, v1, v3, v7, v14, v30, v60, v90, e0, e1, e3, e7, e14, e30, e60, e90, u0, u1, u3, u7, u14, u30, u60, u90 } = free;
  const estimateAt = (instant: symbol, value: symbol) => Mastery._estimate({ learner: owner, subject: skill, definition, at: instant }).is({ value });
  const leftAloneAt = (days: symbol, value: symbol) => Mastery._withoutPractice({ confidence: startingConfidence, days }).is({ value });
  return where(
    Mastery._track({ learner: owner, subject: skill, definition }).is({ initialConfidence: startingConfidence, initializedAt: startedAt }),
    Mastery._policy({}).is({ readinessMinimum: threshold }),
    Mastery._explanation({ learner: owner, subject: skill, definition, at }).is({ explanation }),
    compute(computations.memoryInstants, { at }, { d1: t1, d3: t3, d7: t7, d14: t14, d30: t30, d60: t60, d90: t90 }),
    estimateAt(t1, v1), estimateAt(t3, v3), estimateAt(t7, v7), estimateAt(t14, v14), estimateAt(t30, v30), estimateAt(t60, v60), estimateAt(t90, v90),
    ...reviewSearchLines(owner, skill, definition, threshold, at, free),
    compute(computations.memoryCurve, { at, explanation, threshold, search: free[`search${SEARCH_STEPS}`]!, v1, v3, v7, v14, v30, v60, v90 }, { estimate, projection, reviewBy, belowNow }),
    compute(computations.leftAloneDays, { explanation, at }, { e0, e1, e3, e7, e14, e30, e60, e90 }),
    leftAloneAt(e0, u0), leftAloneAt(e1, u1), leftAloneAt(e3, u3), leftAloneAt(e7, u7), leftAloneAt(e14, u14), leftAloneAt(e30, u30), leftAloneAt(e60, u60), leftAloneAt(e90, u90),
    compute(computations.leftAlonePath, { explanation, at, u0, v1: u1, v3: u3, v7: u7, v14: u14, v30: u30, v60: u60, v90: u90 }, leftAlone),
  );
}).optional();
// Every confirmed skill in the course, with its curve; a skill without a track keeps its row with every curve field null.
export const MemorySkills = former("the memory curves of the confirmed skills in (course) for (owner) at (at)", ({ owner, course, at },
  { unit, unitTitle, skill, title, definition, startingConfidence, startedAt, estimate, projection, reviewBy, belowNow, leftAlone }) =>
  each(Mapping._units({ course }).is({ unit, title: unitTitle }))
    .where(Mapping._skills({ unit }).is({ skill, title, current: definition, status: "CONFIRMED" }),
      whether(SkillCurve({ owner, skill, definition, at }).is({ startingConfidence, startedAt, estimate, projection, reviewBy, belowNow, leftAlone })))
    .arranged(skill)
    .form({ skill, title, unit, unitTitle, startingConfidence, startedAt, estimate, projection, reviewBy, belowNow, leftAlone }),
);
// The policy's settings and its reference curve: an estimate of 100% left alone, on day 0 and each sample day.
export const MemoryPolicy = former("the estimate policy and its reference curve", (_inputs, { policy, halfLifeDays, readinessMinimum, readinessDays, v0, v1, v3, v7, v14, v30, v60, v90, reference }) => {
  const fromFull = (days: number, value: symbol) => Mastery._withoutPractice({ confidence: 100, days }).is({ value });
  return where(
    Mastery._policy({}).is({ policy, halfLifeDays, readinessMinimum, readinessDays }),
    fromFull(0, v0), fromFull(1, v1), fromFull(3, v3), fromFull(7, v7), fromFull(14, v14), fromFull(30, v30), fromFull(60, v60), fromFull(90, v90),
    compute(computations.referenceCurve, { v0, v1, v3, v7, v14, v30, v60, v90 }, reference),
  ).form({ policy, halfLifeDays, reviewThreshold: readinessMinimum, readinessDays, reference });
});
const Memory = endpoint("/learning/memory", ({ session, course, owner, at, asOf }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), now(at), compute(computations.memoryInstants, { at }, { d0: asOf }))
      .then(respond({ asOf, policy: MemoryPolicy({}), skills: MemorySkills({ owner, course, at }) })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, input: learningInput, output: structuredOutput } });

// ---- Course confidence (design/compositions/LearningReads.md, "Course confidence") ----
// Each active course of the learner with its score, its confirmed skills and how many of them have an estimate.
export const CourseScores = former("the confidence in each active course of (owner)", ({ owner }, { course, skills, tracks, score, count, estimated }) =>
  each(Mapping._courses({ owner }).is({ course, status: "ACTIVE" }))
    .where(Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }),
      compute(computations.courseScore, { skills, tracks }, { score, skills: count, estimated }))
    .arranged(course)
    .form({ course, score, skills: count, estimated }),
);
const Scores = endpoint("/courses/scores", ({ session, owner }) => receive({ session })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(respond({ courses: CourseScores({ owner }) })), { validators: { ...validators, output: structuredOutput } });
export const composition = { OwnedSkill, ActiveSkill, OwnedSession, OpenSession, SessionSources, PendingGrade, OwnedCase, OwnedAnyCase, SkillContext, SkillData, SessionData, Progress, PlanData, PlanContext, CanReplan, NeedsEvidence, OpenStudy, Continue,
  SkillCurve, MemorySkills, MemoryPolicy, Memory, CourseScores, Scores };
