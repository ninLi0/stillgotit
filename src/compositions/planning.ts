import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, each, former, is, no, reaction, view, when, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { composition as Courses } from "./courses.ts";
import * as R from "./learning-reads.ts";
import { learningInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, StudyPlanning: Planning, SkillMapping: Mapping, MasteryEstimating: Mastery } = concepts;
const options = { validators: { ...validators, input: learningInput, output: structuredOutput } };
// A missing course and another learner's course get the same answer, before any other refusal.
// The engine's answer currently carries only the error code; HTTP admission gives the learner this sentence.
const courseUnavailable = () => respond({ error: "COURSE_UNAVAILABLE", detail: "Choose one of your own courses." });
const WAITING = "Your plan will update when you finish or stop your current activity.";

/** The learner has an activity in progress in one of their courses, so no plan can change now. */
export const ActivityInProgress = view("(owner) has an activity in progress", ({ owner }, {}, { course }) => where(
  Mapping._courses({ owner }).is({ course }), Planning._next({ learner: owner, scope: course }).is({ status: "IN_PROGRESS" }),
)).holds();
/** The item is the learner's, its skill is confirmed with the item's version, and its prerequisites are ready unless it is urgent exam preparation. */
export const StartAllowed = view("(owner) may start (item) in (course)", ({ owner, course, item }, {}, { candidate, skill, definition, skills, tracks, schedule, urgent }) => where(
  Planning._item({ item }).is({ learner: owner, scope: course, candidate }), compute(C.itemSubject, { candidate }, { skill, definition }),
  R.ActiveSkill({ owner, skill }).is({ course, definition }), Mapping._map({ course }).is({ skills }), Mastery._progress({ learner: owner }).is({ tracks }),
  Planning._schedule({ learner: owner, scope: course }).is({ schedule }), compute(C.urgentExamItem, { schedule, candidate }, urgent),
  C.beginAllowed({ skills, tracks, skill, urgent }),
)).holds();

export const Exams = former("the active exams for (owner) in (course)", ({ owner, course }, { exam, date, covered }) =>
  each(Planning._exams({ learner: owner, scope: course }).is({ exam, date, covered, active: true })).arranged(date).form({ exam, date, covered }));
export const PendingProposal = former("the proposal awaiting confirmation for (owner) in (course)", ({ owner, course }, {
  plan, explanation, examUrgent, estimatedExamMinutes, availableExamMinutes, focusExam, focusExamDate, currentBasis, locallyCurrent, contextCurrent, sessionInProgress,
}) =>
  // The planning concept keeps at most one PROPOSED plan per course, so this list has at most one record.
  each(Planning._plans({ learner: owner, scope: course }).is({ plan, status: "PROPOSED", needsConfirmation: true })).where(
    Planning._plan({ plan }).is({ explanation, examUrgent, estimatedExamMinutes, availableExamMinutes, focusExam }),
    Planning._exams({ learner: owner, scope: course }).is({ exam: focusExam, date: focusExamDate }),
    R.PlanContext({ owner, course }).is({ basis: currentBasis }),
    Planning._proposalCheck({ learner: owner, plan, currentBasis }).is({ locallyCurrent, contextCurrent, sessionInProgress }),
  ).arranged(plan).form({ plan, explanation, examUrgent, estimatedExamMinutes, availableExamMinutes, focusExam, focusExamDate, locallyCurrent, contextCurrent, sessionInProgress }));
export const PendingItems = former("the activities of the proposal awaiting confirmation for (owner) in (course)", ({ owner, course }, { plan, item, candidate, day, order }) =>
  each(Planning._plans({ learner: owner, scope: course }).is({ plan, status: "PROPOSED", needsConfirmation: true }))
    .where(Planning._items({ plan }).is({ item, candidate, day }), compute(C.itemOrder, { day, candidate }, order))
    .arranged(order).form({ item, candidate, day }));
export const PendingCuts = former("the cuts of the proposal awaiting confirmation for (owner) in (course)", ({ owner, course }, { plan, cut, order }) =>
  each(Planning._plans({ learner: owner, scope: course }).is({ plan, status: "PROPOSED", needsConfirmation: true }))
    .where(Planning._cuts({ plan }).is({ cut }), compute(C.cutKey, { cut }, order))
    .arranged(order).form({ cut }));

const Read = endpoint("/planning/read", ({ session, course, owner }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course })).then(respond({ data: R.PlanData({ owner, course }), exams: Exams({ owner, course }),
      proposal: PendingProposal({ owner, course }), proposalItems: PendingItems({ owner, course }), cuts: PendingCuts({ owner, course }) })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ), options);
const Configure = endpoint("/planning/configure", ({ session, course, dailyMinutes, focusNote, owner, preferences }) => receive({ session, course, dailyMinutes, focusNote })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course })).then(Planning.configure({ learner: owner, scope: course, dailyMinutes, focusNote }).responds({})).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ).afterFlowSettles().then(where(Courses.OwnedCourse({ owner, course }), Planning._preferences({ learner: owner, scope: course }).is({ preferences, dailyMinutes, focusNote }))
    .then(respond({ preferences }))), options);
const Propose = endpoint("/planning/propose", ({ session, course, owner, candidates, horizonEnd, basis, explanation, plan }) => receive({ session, course })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(R.CanReplan({ owner, course }), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
      .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false }).responds({})).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  // The plan proposed in this flow is either still awaiting the learner or now active.
  ).afterFlowSettles().then(
    where(Courses.OwnedCourse({ owner, course }), Planning._plans({ learner: owner, scope: course }).is({ plan, status: "PROPOSED" })).then(respond({ plan })).named("proposed"),
    where(Courses.OwnedCourse({ owner, course }), no(Planning._plans({ learner: owner, scope: course }).is({ status: "PROPOSED" })),
      Planning._plans({ learner: owner, scope: course }).is({ plan, status: "ACTIVE" })).then(respond({ plan })).named("active"),
  ), options);
const Begin = endpoint("/planning/begin", ({ session, course, item, owner }) => receive({ session, course, item })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), StartAllowed({ owner, course, item }))
      .then(Planning.begin({ learner: owner, item }).responds({ item })).then(respond({ item })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ), options);
const Finish = endpoint("/planning/finish", ({ session, course, item, actualMinutes, owner }) => receive({ session, course, item, actualMinutes })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course }))
      .then(Planning.finish({ learner: owner, item, actualMinutes }).responds({ item })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ).afterFlowSettles().then(where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course, status: "DONE" })).then(respond({ item }))), options);
const Stop = endpoint("/planning/stop", ({ session, course, item, actualMinutes, owner }) => receive({ session, course, item, actualMinutes })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course }))
      .then(Planning.stop({ learner: owner, item, actualMinutes }).responds({ item })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ).afterFlowSettles().then(where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course, status: "STOPPED" })).then(respond({ item }))), options);
const Miss = endpoint("/planning/miss", ({ session, course, item, owner }) => receive({ session, course, item })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course }))
      .then(Planning.miss({ learner: owner, item }).responds({ item })).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ).afterFlowSettles().then(where(Courses.OwnedCourse({ owner, course }), Planning._item({ item }).is({ learner: owner, scope: course, status: "MISSED" })).then(respond({ item }))), options);

// After an exam change settles, say whether an activity in progress kept the plan from refreshing.
const SetExam = endpoint("/planning/exams/set", ({ session, course, date, covered, owner, skills, confirmed, exam }) => receive({ session, course, date, covered })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), Mapping._map({ course }).is({ skills }), compute(C.coveredSkillsConfirmed, { covered, skills }, confirmed), is.among(confirmed, [true]))
      .then(Planning.setExam({ learner: owner, scope: course, date, covered }).responds({})).named("owned"),
    where(Courses.OwnedCourse({ owner, course }), Mapping._map({ course }).is({ skills }), compute(C.coveredSkillsConfirmed, { covered, skills }, confirmed), is.among(confirmed, [false]))
      .then(respond({ error: "EXAM_SKILLS_UNAVAILABLE", detail: "Choose confirmed skills from this course, each once." })).named("skills"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  // The saved exam is read again after the refresh; the refusal paths above fail these conditions.
  ).afterFlowSettles().then(
    where(Courses.OwnedCourse({ owner, course }), Mapping._map({ course }).is({ skills }), compute(C.coveredSkillsConfirmed, { covered, skills }, confirmed), is.among(confirmed, [true]),
      Planning._exams({ learner: owner, scope: course }).is({ exam, date, covered, active: true }), no(ActivityInProgress({ owner }))).then(respond({ exam, refreshed: true })).named("refreshed"),
    where(Courses.OwnedCourse({ owner, course }), Mapping._map({ course }).is({ skills }), compute(C.coveredSkillsConfirmed, { covered, skills }, confirmed), is.among(confirmed, [true]),
      Planning._exams({ learner: owner, scope: course }).is({ exam, date, covered, active: true }), ActivityInProgress({ owner })).then(respond({ exam, refreshed: false, notice: WAITING })).named("waiting"),
  ), options);
const RemoveExam = endpoint("/planning/exams/remove", ({ session, course, date, owner, exam }) => receive({ session, course, date })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }))
      .then(Planning.removeExam({ learner: owner, scope: course, date }).responds({})).named("owned"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ).afterFlowSettles().then(
    where(Courses.OwnedCourse({ owner, course }), Planning._exams({ learner: owner, scope: course }).is({ exam, date, active: false }), no(ActivityInProgress({ owner })))
      .then(respond({ exam, refreshed: true })).named("refreshed"),
    where(Courses.OwnedCourse({ owner, course }), Planning._exams({ learner: owner, scope: course }).is({ exam, date, active: false }), ActivityInProgress({ owner }))
      .then(respond({ exam, refreshed: false, notice: WAITING })).named("waiting"),
  ), options);
// An activity in another course would make the planning concept refuse the replan, and that refusal would become the
// exam answer. Skipping the replan keeps the saved exam and lets the answer say the plan updates after the activity.
const ReplanAfterExam = reaction(({ owner, course, candidates, horizonEnd, basis, explanation }) => when(Planning.setExam({ learner: owner, scope: course }).responds({}))
  .where(R.CanReplan({ owner, course }), no(ActivityInProgress({ owner })), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));
const ReplanAfterExamRemoval = reaction(({ owner, course, candidates, horizonEnd, basis, explanation }) => when(Planning.removeExam({ learner: owner, scope: course }).responds({}))
  .where(R.CanReplan({ owner, course }), no(ActivityInProgress({ owner })), R.PlanContext({ owner, course }).is({ candidates, horizonEnd, basis, explanation }))
  .then(Planning.replan({ learner: owner, scope: course, candidates, horizonEnd, basis, explanation, workloadComplete: false })));

// Only a plan of this learner and course can be confirmed or declined here.
const proposalUnavailable = () => respond({ error: "PROPOSAL_UNAVAILABLE", detail: "Choose one of your proposed plans." });
const ConfirmTradeoffs = endpoint("/planning/tradeoffs/confirm", ({ session, course, plan, owner, currentBasis }) => receive({ session, course, plan })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), Planning._plan({ plan }).is({ learner: owner, scope: course }), R.PlanContext({ owner, course }).is({ basis: currentBasis }))
      .then(Planning.confirmTradeoffs({ learner: owner, plan, currentBasis }).responds({ plan })).then(respond({ plan })).named("owned"),
    where(Courses.OwnedCourse({ owner, course }), no(Planning._plan({ plan }).is({ learner: owner, scope: course }))).then(proposalUnavailable()).named("plan"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ), options);
const DeclineTradeoffs = endpoint("/planning/tradeoffs/decline", ({ session, course, plan, owner }) => receive({ session, course, plan })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Courses.OwnedCourse({ owner, course }), Planning._plan({ plan }).is({ learner: owner, scope: course }))
      .then(Planning.declineTradeoffs({ learner: owner, plan }).responds({ plan })).then(respond({ plan })).named("owned"),
    where(Courses.OwnedCourse({ owner, course }), no(Planning._plan({ plan }).is({ learner: owner, scope: course }))).then(proposalUnavailable()).named("plan"),
    where(no(Courses.OwnedCourse({ owner, course }))).then(courseUnavailable()).named("missing"),
  ), options);

export const composition = { Read, Configure, Propose, Begin, Finish, Stop, Miss, SetExam, RemoveExam, ReplanAfterExam, ReplanAfterExamRemoval, ConfirmTradeoffs, DeclineTradeoffs,
  ActivityInProgress, StartAllowed, Exams, PendingProposal, PendingItems, PendingCuts };
