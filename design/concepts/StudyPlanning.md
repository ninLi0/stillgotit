# StudyPlanning

## Purpose

Fit study activities into available time and show what cannot fit.

## Principle

A learner sets a daily budget, exam dates, and priorities. The app proposes activities that fit the available study days. Progress and missed work can lead to a new proposal. Routine timing changes can take effect automatically. New or larger cuts to exam preparation need the learner's confirmation. The active plan remains available until a replacement takes effect. Completed work and time already spent remain recorded across plan changes.

## Types

```types
external Learner
  The identity whose study time is planned.
external Scope
  The context for a budget and its study activities.
external Subject
  An ability that an activity develops or checks.
external Definition
  The fixed version of the requirements used by an activity.
PlanStatus is PROPOSED or ACTIVE or SUPERSEDED or DECLINED
  Whether a plan awaits activation, is in use, has been replaced, or was declined.
ItemStatus is TODO or IN_PROGRESS or DONE or MISSED or STOPPED or REPLACED
  The activity's progress or reason it is no longer scheduled.
opaque SubjectSet
  A finite set of Subject identities, with no duplicates or ordering.
opaque Candidate
  An activity with key, subject, definition, activity text, estimated minutes, numeric priority, earliestDay, latestDay, reason, and examRefs. examRefs identifies all exams this activity prepares for, including direct preparation, prerequisites, and repair work. A later maintenance review can have no exam reference even when an earlier exam covered that subject. Higher priority values run first. A key identifies the same work across proposals.
opaque CandidateList
  An ordered sequence of Candidate values. Allocation uses priority and stable key rather than the supplied order.
opaque CutValue
  An omitted exam activity with exam identity, candidateKey, omittedScope, estimated minutes, reason, and consequence. The scope and consequence state what preparation the learner will forgo.
opaque PlanInputs
  A fixed copy of the planning date, budget, focus note, active exam records, and DONE, STOPPED, or MISSED items with their time records for the same preferences. It excludes proposal records and unstarted items. It contains only this concept's state and is captured by replan, not supplied by the learner.
opaque ScheduleValue
  Preferences, today's date and budget, next item, saved plans, and active exams in one scope.
```

## State

```state
a set of Preferences with
  a learner Learner
  a scope Scope
  a dailyMinutes Number
  a focusNote String
  an approvedExamCuts seq of CutValue
  unique learner and scope
a set of Exams with
  a preferences Preferences
  a date Date
  a covered set of Subject
  an active Flag
  unique preferences and date
a set of Plans with
  a preferences Preferences
  a status PlanStatus
  a basis String
  an inputs PlanInputs
  a horizonEnd Date
  an explanation String
  an optional focusExam Exam
  an examUrgent Flag
  a workloadComplete Flag
  an estimatedExamMinutes Number
  an availableExamMinutes Number
  a deferred seq of Candidate
  an examCuts seq of CutValue
  a needsConfirmation Flag
a set of Items with
  a plan Plan
  a candidate Candidate
  a day Date
  a status ItemStatus
  an actualMinutes Number
  an optional spentOn Date
Rule: preferences are unique by learner and scope. Each exam and plan belongs to existing preferences; each item belongs to an existing plan. Ownership follows the preferences' learner. Unknown records belong to no learner.
Rule: each preferences record has at most one ACTIVE plan and one PROPOSED plan. Each learner has at most one IN_PROGRESS item across all scopes. Only TODO items in an ACTIVE plan can begin or be marked missed.
Rule: dailyMinutes is an integer from 0 through 1440. Candidate minutes are finite and positive. Actual minutes are finite and nonnegative. DONE and STOPPED items have spentOn set; all other items have actualMinutes zero and no spentOn.
Rule: a candidate key is nonblank and stable for the same work and requirements. Candidate content and a plan's proposal fields never change after creation. A later review or changed requirements version needs a new key. A key with a DONE item under these preferences cannot be scheduled again. MISSED and STOPPED work remains unfinished and can be proposed again.
Rule: for a date, spent time is the sum of actualMinutes on DONE and STOPPED items with that spentOn date across all plans for these preferences. Remaining capacity is max(0, dailyMinutes minus spent time). Wrong answers and stopped work still consume time. A new plan does not reset spent time.
Rule: valid proposal input has horizonEnd on or after today, nonblank explanation and basis, unique candidate keys, positive finite durations, finite priorities, nonblank activity and reason, and earliestDay no later than latestDay. Candidate exam references must identify active exams on or after today under the same preferences. Candidate keys must not identify completed work or change the identity of existing work.
Rule: proposal input includes all known unfinished preparation for the nearest active exam, including prerequisites and repair work. Its horizon includes every remaining study day before that exam. workloadComplete false flags an incomplete workload estimate in the plan's explanation; it does not permit known work to be omitted. Skipping a prerequisite check does not remove its workload.
Rule: focusExam is the earliest active exam with date on or after today. Use only study dates strictly before its date because no exam time is stored. If there is no such exam, focusExam is absent, estimatedExamMinutes and availableExamMinutes are zero, and examUrgent is false.
Rule: focus-exam work is identified by examRefs and includes direct preparation for covered skills, prerequisites, and repair work. estimatedExamMinutes W sums these unfinished candidates. availableExamMinutes C sums remaining capacity from today through the day before the exam. examUrgent is true exactly when W > C. With an incomplete workload estimate, these values describe only the known work and cannot prove that all preparation fits.
Rule: allocation visits dates from today through horizonEnd. It considers eligible unfinished candidates by decreasing priority, then stable key. Schedule each at most once on a day within its allowed dates where its full duration fits the remaining capacity. Exam preparation must also precede every exam in its examRefs. A zero budget schedules nothing. Splitting an activity requires a new proposal with new activity keys.
Rule: when examUrgent is true, reserve all remaining capacity before focusExam for its covered skills, prerequisites, and repair work. Defer unrelated maintenance from those dates. Unscheduled candidates remain in deferred, ordered by decreasing priority and then stable key. Do not silently remove work from a proposal to make it fit.
Rule: examCuts describes every known focus-exam candidate that cannot be scheduled before the exam. Each cut records its work, minutes, reason, and consequence. A cut is already approved only when approvedExamCuts contains the same exam, candidateKey, omittedScope, and consequence with at least those minutes. A new or enlarged cut, or changed omitted scope or consequence, needs confirmation. Routine timing changes and removal of cuts do not.
Rule: replan records current PlanInputs. A proposal is locally current only when those saved inputs equal the current local values, including today's date. basis identifies the external planning context, such as requirements, evidence, and priorities. Activation also requires currentBasis to equal the proposal's basis. The caller supplies currentBasis from its current context; this concept does not read other concepts.
Rule: activation supersedes the previous ACTIVE plan. Its overdue TODO items become MISSED; its other TODO items become REPLACED. Finished, stopped, missed, and timed work remain unchanged. The selected proposal becomes ACTIVE, and its exact examCuts replace approvedExamCuts. Activation and these state changes are one action.
Rule: proposing or declining a plan preserves the active plan and its work. Replacing a proposal supersedes it without recording its unstarted activities as missed or spent. No plan can activate while its learner has an IN_PROGRESS item.
Rule: a manual miss records no time and applies no mastery penalty. finish and stop record actual time on today, including an overrun beyond the estimate. A new activity cannot begin if its full estimated duration exceeds today's remaining capacity.
Rule: today is the current study date supplied by the runtime under one consistent time-zone rule. A date change makes an older proposal require replanning. Blank text is empty or contains only whitespace. New identities are unique. Refused actions change no state; unmentioned state stays unchanged. Queries do not change state.
```

## Actions

```actions
configure(learner: Learner, scope: Scope, dailyMinutes: Number, focusNote: String) : returns (preferences: Preferences)
  where dailyMinutes is not an integer from 0 through 1440
  then
    refuses INVALID_DAILY_BUDGET "Enter a whole number of minutes from 0 to 1440."
  where dailyMinutes is an integer from 0 through 1440
  then
    if matching preferences exist, keep that identity as preferences and update dailyMinutes and focusNote
    otherwise create preferences with learner, scope, dailyMinutes, focusNote, and empty approvedExamCuts
    preserve existing plans, activity records, and approved cuts
    returns preferences

setExam(learner: Learner, scope: Scope, date: Date, covered: SubjectSet) : returns (exam: Exam)
  where matching preferences do not exist
  then
    refuses EXAM_PREFERENCES_UNAVAILABLE "Set a study budget for this course first."
  where matching preferences exist and (date is before today or covered is empty)
  then
    refuses INVALID_EXAM_DETAILS "Choose today or a future date and at least one covered skill."
  where matching preferences exist, date is on or after today, and covered is not empty
  then
    if an exam for these preferences and date exists, keep its identity as exam and replace covered and set active true
    otherwise create exam with these preferences, date, covered, and active true
    preserve saved plans
    returns exam

removeExam(learner: Learner, scope: Scope, date: Date) : returns (exam: Exam)
  where no exam exists for learner, scope, and date
  then
    refuses EXAM_REMOVE_UNAVAILABLE "Choose an exam recorded for this course."
  where an exam exists for learner, scope, and date
  then
    keep its identity as exam and set active false
    preserve saved plans and work
    returns exam

replan(learner: Learner, scope: Scope, candidates: CandidateList, horizonEnd: Date, explanation: String, basis: String, workloadComplete: Flag) : returns (plan: Plan)
  where matching preferences do not exist
  then
    refuses PLAN_PREFERENCES_UNAVAILABLE "Set a study budget for this course first."
  where matching preferences exist and the learner has an IN_PROGRESS item
  then
    refuses PLAN_SESSION_IN_PROGRESS "Finish or stop the current activity before replacing the schedule."
  where matching preferences exist, the learner has no IN_PROGRESS item, and the proposal input rules do not hold
  then
    refuses INVALID_PLAN_INPUT "Provide valid activities, planning dates, and all known unfinished exam preparation."
  where matching preferences exist, the learner has no IN_PROGRESS item, and the proposal input rules hold
  then
    supersede any existing PROPOSED plan for these preferences without changing the ACTIVE plan
    capture the current local planning inputs
    create plan with these preferences, status PROPOSED, basis, captured inputs, horizonEnd, explanation, and workloadComplete
    apply the allocation rules and record focusExam, examUrgent, estimatedExamMinutes, availableExamMinutes, deferred, examCuts, and needsConfirmation
    create the scheduled items with plan, their candidate and day, status TODO, actualMinutes zero, and no spentOn
    returns plan

activateRoutine(learner: Learner, plan: Plan, currentBasis: String) : returns (plan: Plan)
  where plan is not learner's PROPOSED plan
  then
    refuses ROUTINE_PLAN_UNAVAILABLE "Choose one of your proposed plans."
  where plan is learner's PROPOSED plan and the learner has an IN_PROGRESS item
  then
    refuses ROUTINE_SESSION_IN_PROGRESS "Finish or stop the current activity before changing plans."
  where plan is learner's PROPOSED plan, the learner has no IN_PROGRESS item, and (the plan is not locally current or currentBasis differs from basis)
  then
    refuses ROUTINE_PLAN_OUTDATED "Create a new proposal from the current budget, dates, and progress."
  where plan is learner's PROPOSED plan, the learner has no IN_PROGRESS item, the plan is locally current, currentBasis equals basis, and needsConfirmation is true
  then
    refuses EXAM_TRADEOFF_CONFIRMATION_REQUIRED "Review and confirm the proposed cuts to exam preparation."
  where plan is learner's PROPOSED plan, the learner has no IN_PROGRESS item, the plan is locally current, currentBasis equals basis, and needsConfirmation is false
  then
    activate plan using the activation rule
    returns plan

confirmTradeoffs(learner: Learner, plan: Plan, currentBasis: String) : returns (plan: Plan)
  where plan is not learner's PROPOSED plan
  then
    refuses TRADEOFF_PLAN_UNAVAILABLE "Choose one of your proposed plans."
  where plan is learner's PROPOSED plan and the learner has an IN_PROGRESS item
  then
    refuses TRADEOFF_SESSION_IN_PROGRESS "Finish or stop the current activity before changing plans."
  where plan is learner's PROPOSED plan, the learner has no IN_PROGRESS item, and (the plan is not locally current or currentBasis differs from basis)
  then
    refuses TRADEOFF_PLAN_OUTDATED "Review a new proposal based on the current budget, dates, and progress."
  where plan is learner's PROPOSED plan, the learner has no IN_PROGRESS item, the plan is locally current, currentBasis equals basis, and needsConfirmation is false
  then
    refuses TRADEOFF_CONFIRMATION_NOT_NEEDED "This plan has no new exam cuts. Use routine activation."
  where plan is learner's PROPOSED plan, the learner has no IN_PROGRESS item, the plan is locally current, currentBasis equals basis, and needsConfirmation is true
  then
    activate plan using the activation rule
    returns plan

declineTradeoffs(learner: Learner, plan: Plan) : returns (plan: Plan)
  where plan is not learner's PROPOSED plan
  then
    refuses PLAN_DECLINE_UNAVAILABLE "Choose one of your proposed plans."
  where plan is learner's PROPOSED plan
  then
    set status to DECLINED and preserve the ACTIVE plan and all work records
    returns plan

begin(learner: Learner, item: Item) : returns (item: Item)
  where item is not learner's TODO item in an ACTIVE plan
  then
    refuses ACTIVITY_BEGIN_UNAVAILABLE "Choose an unfinished activity from your active plan."
  where item is learner's TODO item in an ACTIVE plan and the learner has an IN_PROGRESS item
  then
    refuses ANOTHER_ACTIVITY_IN_PROGRESS "Finish or stop the current activity first."
  where item is learner's TODO item in an ACTIVE plan, the learner has no IN_PROGRESS item, and its day is not today
  then
    refuses ACTIVITY_NOT_SCHEDULED_TODAY "Choose an activity scheduled for today or update the plan."
  where item is learner's TODO item in an ACTIVE plan, the learner has no IN_PROGRESS item, its day is today, and its estimated minutes exceed today's remaining capacity
  then
    refuses ACTIVITY_EXCEEDS_REMAINING_BUDGET "Update the plan or time budget before starting this activity."
  where item is learner's TODO item in an ACTIVE plan, the learner has no IN_PROGRESS item, its day is today, and its estimated minutes fit today's remaining capacity
  then
    set status to IN_PROGRESS
    returns item

finish(learner: Learner, item: Item, actualMinutes: Number) : returns (item: Item)
  where item is not learner's IN_PROGRESS item
  then
    refuses ACTIVITY_FINISH_UNAVAILABLE "Choose your current activity."
  where item is learner's IN_PROGRESS item and actualMinutes is not a finite nonnegative number
  then
    refuses INVALID_FINISH_TIME "Enter a nonnegative number of minutes spent."
  where item is learner's IN_PROGRESS item and actualMinutes is a finite nonnegative number
  then
    set status to DONE, save actualMinutes, and set spentOn to today
    returns item

stop(learner: Learner, item: Item, actualMinutes: Number) : returns (item: Item)
  where item is not learner's IN_PROGRESS item
  then
    refuses ACTIVITY_STOP_UNAVAILABLE "Choose your current activity."
  where item is learner's IN_PROGRESS item and actualMinutes is not a finite nonnegative number
  then
    refuses INVALID_STOP_TIME "Enter a nonnegative number of minutes spent."
  where item is learner's IN_PROGRESS item and actualMinutes is a finite nonnegative number
  then
    set status to STOPPED, save actualMinutes, and set spentOn to today
    returns item

miss(learner: Learner, item: Item) : returns (item: Item)
  where item is not learner's TODO item in an ACTIVE plan
  then
    refuses ACTIVITY_MISS_UNAVAILABLE "Choose an unfinished activity from your active plan."
  where item is learner's TODO item in an ACTIVE plan and its day is after today
  then
    refuses ACTIVITY_MISS_TOO_EARLY "Only today's or an overdue activity can be marked missed."
  where item is learner's TODO item in an ACTIVE plan and its day is on or before today
  then
    set status to MISSED, retaining actualMinutes zero and no spentOn
    returns item
```

## Queries

```queries
_preferences(learner: Learner, scope: Scope) : optional (preferences: Preferences, dailyMinutes: Number, focusNote: String)
  Returns the learner's budget and focus for the scope. Returns no row when no preferences exist.

_exams(learner: Learner, scope: Scope) : many (exam: Exam, date: Date, covered: SubjectSet, active: Flag)
  Returns all recorded exams for the learner and scope, including removed exams, ordered by date and then exam identity. Returns no rows when no preferences or exams exist.

_plans(learner: Learner, scope: Scope) : many (plan: Plan, status: PlanStatus, horizonEnd: Date, needsConfirmation: Flag)
  Returns all plans for the learner and scope, ordered by plan identity. Returns no rows when no preferences or plans exist. At most one row is ACTIVE and one is PROPOSED.

_plan(plan: Plan) : optional (learner: Learner, scope: Scope, status: PlanStatus, basis: String, inputs: PlanInputs, horizonEnd: Date, explanation: String, focusExam?: Exam, examUrgent: Flag, workloadComplete: Flag, estimatedExamMinutes: Number, availableExamMinutes: Number, scheduledMinutes: Number, deferredMinutes: Number, needsConfirmation: Flag)
  Returns the saved proposal and its totals. scheduledMinutes sums the original estimated durations of its items; deferredMinutes sums its unscheduled candidates. These are planning estimates, not time spent. Omits focusExam when absent. Returns no row for an unknown plan.

_items(plan: Plan) : many (item: Item, candidate: Candidate, day: Date, status: ItemStatus, actualMinutes: Number, spentOn?: Date)
  Returns every activity in the plan, ordered by day, decreasing priority, and then stable candidate key. Omits spentOn for unrecorded time. Returns no rows for an unknown plan or one without items.

_next(learner: Learner, scope: Scope) : optional (item: Item, candidate: Candidate, day: Date, status: ItemStatus)
  Returns the learner's IN_PROGRESS item in this scope when present. Otherwise returns the earliest TODO item on or after today in the ACTIVE plan, breaking ties by decreasing priority and then stable key. Returns no row when neither exists. A returned future item cannot begin until its scheduled date; begin still checks time and other work in progress.

_budget(learner: Learner, scope: Scope, day: Date) : optional (dailyMinutes: Number, spentMinutes: Number, remainingMinutes: Number)
  Returns the current daily budget, recorded time on day across all plans for these preferences, and the nonnegative remaining capacity. A date without recorded work has spentMinutes zero. This uses the current budget, not a reconstruction of earlier budget settings. Returns no row when no preferences exist.

_deferred(plan: Plan) : many (candidate: Candidate)
  Returns the plan's unscheduled work in decreasing priority and then stable key order. Returns no rows for an unknown plan or one with no deferred work. Exam omissions also appear in _cuts with their reasons and consequences.

_cuts(plan: Plan) : many (cut: CutValue)
  Returns the plan's saved exam cuts, ordered by exam identity and then candidate key. Returns no rows for an unknown plan or one without cuts.

_proposalCheck(learner: Learner, plan: Plan, currentBasis: String) : optional (locallyCurrent: Flag, contextCurrent: Flag, sessionInProgress: Flag, needsConfirmation: Flag, canActivate: Flag)
  Returns no row unless plan is learner's PROPOSED plan. Compares saved local inputs with current values and basis with currentBasis. canActivate is true only when both comparisons match and the learner has no IN_PROGRESS item. needsConfirmation determines which activation action is required; this query does not grant consent or replace the action's checks.

_schedule(learner: Learner, scope: Scope) : one (schedule: ScheduleValue)
  Returns the learner's schedule in scope using the concept clock. It includes the scope's active exams, each with its identity, date, and covered skills, ordered by date. Missing preferences, budget, and next item are null, and missing plans or exams are empty lists.

_item(item: Item) : optional (learner: Learner, scope: Scope, item: Item, candidate: Candidate, day: String, status: ItemStatus, actualMinutes: Number, spentOn?: String)
  Returns the item and its owning learner and scope. Returns no row for an unknown item.
```
