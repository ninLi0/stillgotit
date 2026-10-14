import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, no, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import * as R from "./learning-reads.ts";
import { learningInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, StudyPlanning: Planning, SkillMapping: Mapping, MasteryEstimating: Mastery } = concepts;
const options = { validators: { ...validators, input: learningInput, output: structuredOutput } };
const Read = endpoint("/planning/read", ({ session, course, owner }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course })).then(respond({ data: R.PlanData({ owner, course }) })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), options);
const Configure = endpoint("/planning/configure", ({ session, course, dailyMinutes, focusNote, owner, preferences }) => receive({ session, course, dailyMinutes, focusNote })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Courses.OwnedCourse({ owner, course })).then(Planning.configure({ learner: owner, scope: course, dailyMinutes, focusNote }).responds({ preferences })))
  .afterFlowSettles().then(respond({ preferences })), options);
const Propose = endpoint("/planning/propose", ({ session, course, owner, candidates, horizonEnd, basis, explanation, plan }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
    .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false }).responds({ plan })))
  .afterFlowSettles().then(respond({ plan })), options);
const Begin = endpoint("/planning/begin", ({ session, course, item, owner, candidate, skill, definition, skills, tracks }) => receive({ session, course, item })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course, candidate }),
    compute(C.itemSubject, { candidate }, { skill, definition }), R.ActiveSkill({ owner, skill }).is({ course, definition }),
    Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }), C.prerequisitesReady({ skills, tracks, skill }))
    .then(Planning.begin({ learner: owner, item }).responds({ item }))).then(respond({ item })), options);
const Finish = endpoint("/planning/finish", ({ session, course, item, actualMinutes, owner }) => receive({ session, course, item, actualMinutes })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Planning._item({ item }).is({ learner: owner, scope: course }), Courses.OwnedCourse({ owner, course }))
    .then(Planning.finish({ learner: owner, item, actualMinutes }).responds({ item })))
  .afterFlowSettles().then(respond({ item })), options);
const Stop = endpoint("/planning/stop", ({ session, course, item, actualMinutes, owner }) => receive({ session, course, item, actualMinutes })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Planning._item({ item }).is({ learner: owner, scope: course }), Courses.OwnedCourse({ owner, course }))
    .then(Planning.stop({ learner: owner, item, actualMinutes }).responds({ item })))
  .afterFlowSettles().then(respond({ item })), options);
const Miss = endpoint("/planning/miss", ({ session, course, item, owner }) => receive({ session, course, item })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(Planning._item({ item }).is({ learner: owner, scope: course }), Courses.OwnedCourse({ owner, course }))
    .then(Planning.miss({ learner: owner, item }).responds({ item })))
  .afterFlowSettles().then(respond({ item })), options);
export const composition = { Read, Configure, Propose, Begin, Finish, Stop, Miss };
