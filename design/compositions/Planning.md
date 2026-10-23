# Daily planning flows

Every planning endpoint takes its learner from `Sessioning.use`; no request field chooses the learner. Before any other check, each endpoint requires [OwnedCourse](view:Courses.OwnedCourse) for the requested course. A course that does not exist and another learner's course both answer `COURSE_UNAVAILABLE` with the detail "Choose one of your own courses.", so a learner cannot tell them apart. This answer comes before every other refusal, including `PROPOSAL_UNAVAILABLE`. The host admits each request with a declared check before it reaches the endpoint, and the endpoint repeats its own checks. The exam and tradeoff endpoints are admitted on course ownership with that same detail. The older planning endpoints keep their existing admission details.

## Reading the plan

[Read](reaction:Planning.Read) answers an owned course with five parts. `data` comes from [the plan former](former:Reads.PlanData): preferences, today's budget, the next activity, and the active plan with its deferred work. `exams` comes from [the exam list](former:Planning.Exams). `proposal`, `proposalItems`, and `cuts` come from [the pending proposal](former:Planning.PendingProposal), [its activities](former:Planning.PendingItems), and [its cuts](former:Planning.PendingCuts), which describe a proposed plan that waits for the learner. Reading changes nothing.

The exam list has one row per active exam: the exam, its date, and its covered skills. Rows are ordered by date, which is unique within a course. There are no rows when the course has no active exam. Removed exams are left out. An active exam whose date has passed stays listed until the learner removes it, but it no longer affects planning.

The pending proposal is a list of at most one record: the course's PROPOSED plan whose `needsConfirmation` is true. It gives the plan, its explanation, `examUrgent`, `estimatedExamMinutes`, `availableExamMinutes`, and the focus exam with its date. Such a plan always has a focus exam, because every cut is preparation for that exam. The record also carries three flags from `_proposalCheck`, compared against the current fingerprint from [PlanContext](view:Reads.PlanContext): `locallyCurrent` says the proposal still matches the local planning inputs, `contextCurrent` says it matches the current context, and `sessionInProgress` says the learner has an activity in progress in any course. The screen uses them to say why confirming is unavailable before the learner tries. Without such a plan the list is empty.

The proposal's activities list has one row per scheduled activity of that pending proposal: the item, its candidate, and its day. Rows keep the concept's order, day, then decreasing priority, then candidate key, through [an activity sort key](computation:itemOrder). Without a pending proposal there are no rows. Together with the explanation, these rows show the learner what they are confirming.

The cuts list has one row per saved cut of that pending proposal. Each cut names the exam, the omitted work and its candidate key, its minutes, the reason, and the consequence. Rows keep the concept's order, exam and then candidate key, through [a cut sort key](computation:cutKey). Without a pending proposal there are no rows.

## Budget and routine proposals

[Configure](reaction:Planning.Configure) saves the daily budget and focus note. Its successful action triggers a review proposal and routine activation.

[Propose](reaction:Planning.Propose) requests a fresh plan from declared current-state reads. The calculation keeps the prototype's ten-minute activities and its one-, three-, and seven-day review intervals. The horizon is seven days, or longer when an exam needs it. Work that does not fit remains visible.

## Exams

[SetExam](reaction:Planning.SetExam) takes the course, a study date, and the covered skills. A course that is not the learner's answers `COURSE_UNAVAILABLE` first. Then SetExam reads the course map and requires [every covered skill to be a confirmed skill of this course](computation:coveredSkillsConfirmed). It calls `StudyPlanning.setExam` with the session learner and the course. When the resulting plan refresh settles, it answers with the exam and `refreshed`. A covered skill from outside this course, one not yet confirmed, or a skill listed twice answers `EXAM_SKILLS_UNAVAILABLE` with the detail "Choose confirmed skills from this course, each once." and saves nothing. The concept's own refusals reach the learner with its messages: no budget for the course, a date before today, or no covered skill. Setting the same date again keeps the exam's identity, replaces its covered skills, and makes it active again.

[RemoveExam](reaction:Planning.RemoveExam) takes the course and the exam date. A course that is not the learner's answers `COURSE_UNAVAILABLE` first. Then RemoveExam calls `StudyPlanning.removeExam`, and when the resulting plan refresh settles it answers with the exam and `refreshed`. The concept refuses a date with no recorded exam. Removing an exam that is already removed succeeds again and leaves it inactive.

In both answers, `refreshed` is false exactly when [ActivityInProgress](view:Planning.ActivityInProgress) holds, meaning the learner has an activity in progress in one of their courses. The answer then also carries the notice "Your plan will update when you finish or stop your current activity." Otherwise `refreshed` is true, which means only that no activity blocked the refresh. Normally the course's plan is then active or a proposal waits for confirmation. If the refresh is interrupted, the active plan stays in use and Update plan makes the proposal, as the paragraph below says. If the concept refuses the refresh for another reason, which the planning request is built not to cause, that refusal is the endpoint's answer, and the exam still stays saved.

[ReplanAfterExam](reaction:Planning.ReplanAfterExam): when `StudyPlanning.setExam` succeeds for a learner and course, where [CanReplan](view:Reads.CanReplan) holds for them, [ActivityInProgress](view:Planning.ActivityInProgress) does not hold, and PlanContext gives candidates, horizon end, basis, and explanation, then call `StudyPlanning.replan` with those values and `workloadComplete` false.

[ReplanAfterExamRemoval](reaction:Planning.ReplanAfterExamRemoval): when `StudyPlanning.removeExam` succeeds for a learner and course, where CanReplan holds for them, ActivityInProgress does not hold, and PlanContext gives the same four values, then call `StudyPlanning.replan` with those values and `workloadComplete` false.

Each new proposal replaces any earlier proposal. [ActivateRoutine](reaction:Progress.ActivateRoutine) then activates it only when it needs no confirmation. A proposal with new or larger exam cuts stays PROPOSED, and the active plan stays in use until the learner confirms or declines. These two reactions live here, not in the progress document.

The exam is saved before any proposal is made. The planning concept makes no proposal while the learner has an activity in progress in any course. If that activity is in this course, CanReplan fails and the reaction does nothing. If it is in another course, CanReplan holds, but ActivityInProgress holds too, so the reaction also does nothing instead of asking the concept for a replan it would refuse. Either way the exam stays saved, the plan is unchanged, and the answer says so. When the learner finishes or stops that activity, [ReplanAfterFinish](reaction:Progress.ReplanAfterFinish) and [ReplanAfterStop](reaction:Progress.ReplanAfterStop) refresh every course of the learner that has saved preferences, not only the activity's course, so the exam change takes effect then.

That refresh also closes the case of an urgent plan that stays active after its exam is removed, because the refresh replaces it. Until then, and while a replacement waits for confirmation, the start rule below ignores urgency whose focus exam is no longer active.

If a proposal is refused for another reason or interrupted, the exam stays saved and the active plan stays in use. Update plan, any later progress, a budget change, or setting the same exam again then makes the proposal. An older proposal stops being current as soon as the exam records change, because its saved local inputs no longer match.

## Exam preparation in proposals

PlanContext passes the course map, the learner's progress, and the planning schedule to [candidate generation](computation:planRequest). The schedule includes the course's active exams and every saved plan. Every proposal uses PlanContext: the Propose endpoint, the exam reactions above, and the progress reactions. The planning concept refuses a proposal that reuses a key with different content, names an exam that is no longer active or already past, or leaves out unfinished work for the focus exam. Candidate generation follows these rules so that none of those refusals can happen.

- The focus exam is the earliest active exam dated today or later, the same exam the concept selects. Only the focus exam is marked.
- Its exam skills are its covered skills and their prerequisites, followed through the course map with a visited set that stops cycles. Only confirmed skills produce new activities.
- Carried work: every scheduled or deferred candidate in any saved plan, whatever the plan's status, that names the focus exam and whose key has no DONE item is proposed again, once per key, with exactly its earlier content. Deferred candidates count because earlier cuts are deferred and never become items. Carried work stays in every proposal until it is done or its exam stops being the focus exam, even if the exam's covered skills or the skill's requirements changed since.
- New exam work: an exam skill whose next review falls before the exam date gets one exam activity, unless earlier work for this exam already covers it. Earlier work covers it when an unfinished exam activity exists for the same skill and requirements version, or a finished one exists for the skill's current version and latest evidence.
- A new exam activity's key is the routine key followed by `:exam:` and the exam identity. The activity names only the focus exam in `examRefs`. It runs from the review's earliest day to the day before the exam. Its priority is above every unrelated candidate, and need still orders exam activities among themselves. Its reason names the exam date.
- An exam skill whose review falls before the exam gets no separate routine review; its exam activity, carried or new, stands for it.
- A review whose earliest day is on or after the exam date is maintenance. It stays routine, with no exam reference. On the exam day itself no new exam work is made, because no study day remains before it.
- Routine work is built as before, with one change: routine key reuse skips earlier candidates that name an exam. A routine key therefore never takes on exam content, and exam work never becomes routine work under the same key.
- Once a key has content, every later proposal that uses that key repeats the content exactly.
- Work for an exam that is not the focus exam is left out. Work for a removed or past exam is never proposed again, because the concept refuses a reference to it, and its skills return to routine reviews under routine keys. A replan after removeExam is therefore never refused for exam reasons. Setting a removed exam's date again restores the same exam identity, so its unfinished work is carried again. When an earlier exam becomes the focus exam, the later exam's work waits until that exam is the focus exam again.
- `horizonEnd` is the later of six days after today and the day before the focus exam. The concept refuses a shorter horizon.
- The fingerprint also covers each confirmed skill's prerequisites, because the exam skills depend on them. Exam records stay out of the fingerprint; the concept's local check covers them.
- With a focus exam, the explanation says that preparation for its date comes first. The concept itself adds the note that the workload estimate is incomplete.

The planning concept then decides urgency, allocation, deferred work, and cuts from these candidates. Because unfinished exam work must be carried, two cases stay visible until the exam passes or is removed. Carried work whose requirements version is no longer current cannot begin, because Begin requires the current version. On the exam day, carried work can no longer be scheduled, so it becomes cuts, and the proposal can ask the learner to confirm leaving it out.

## Tradeoffs

[ConfirmTradeoffs](reaction:Planning.ConfirmTradeoffs) takes the course and the plan. A course that is not the learner's answers `COURSE_UNAVAILABLE` first. Then ConfirmTradeoffs requires `StudyPlanning._plan` to name this learner and course, reads the current basis from PlanContext, and calls `StudyPlanning.confirmTradeoffs` with it. It answers with the plan. An unknown plan, another learner's plan, and a plan from another of the learner's courses all answer `PROPOSAL_UNAVAILABLE` with the detail "Choose one of your proposed plans." The concept's own refusals reach the learner with its messages: the plan is no longer proposed, an activity is in progress, the proposal is out of date, or it needs no confirmation. One concept action activates the plan, supersedes the previous plan, and records the approved cuts.

[DeclineTradeoffs](reaction:Planning.DeclineTradeoffs) takes the course and the plan. It answers `COURSE_UNAVAILABLE` first for a course that is not the learner's, then makes the same plan check. It calls `StudyPlanning.declineTradeoffs` and answers with the plan, now DECLINED. The active plan and all work stay unchanged. The concept refuses a plan that is no longer proposed. It accepts a decline while an activity is in progress, since declining changes neither the active plan nor that activity. The endpoint adds no in-progress refusal of its own: the brief asked for one by mistake, and the concept allows declining during an activity on purpose. Declining approves nothing. After a decline, each later refresh that produces the same cuts waits for confirmation again. Routine updates for this course therefore do not take effect until the learner confirms or the cuts go away. Because every finish or stop refreshes all of the learner's courses, a declined proposal's cuts can come back after an activity in another course, and a confirmation panel opened during that activity can go stale; the author accepted both effects for now, and the screen re-reads the plan on the no-longer-proposed refusal.

Repeating a confirmation or decline after it succeeded is refused by the concept, because the plan is no longer proposed. After a lost answer, or after the refusal that says the plan is no longer proposed, the screen reads the plan again.

## Starting and recording activities

[Begin](reaction:Planning.Begin) requires [StartAllowed](view:Planning.StartAllowed) before it calls `StudyPlanning.begin`. The view requires the item to belong to this learner and course, and its skill to be confirmed in this course with the item's requirements version. It reads the course map, the learner's progress, and the planning schedule.

[The urgency rule](computation:urgentExamItem) decides from the schedule whether the item prepares for the focus exam of an exam-urgent ACTIVE plan whose focus exam is still active. A course with no ACTIVE plan counts as not urgent, and so does a plan whose focus exam was removed. Then [the start rule](computation:beginAllowed) requires ready prerequisites unless the urgency rule holds. With no ACTIVE plan the view still answers, so Begin reaches the concept's `ACTIVITY_BEGIN_UNAVAILABLE` message as it does today. The admission check for Begin uses the same view, so both decide alike. StudyPlanning still refuses an item outside the active plan and enforces remaining time and the one-active-activity rule.

[Finish](reaction:Planning.Finish), [Stop](reaction:Planning.Stop), and [Miss](reaction:Planning.Miss) check item ownership before recording progress. Each waits for the resulting plan refresh before responding. Finish and Stop refresh every course of the learner that has saved preferences; Miss refreshes its own course. Actual time stays in the planning concept. Completing a timer does not prove mastery.

## Planner screen

The planner section on the course home lists active exams as "Exam in N days", "Exam today", or "Exam date passed", with a Remove action for each. Adding an exam takes a date and covered skills chosen from the course's confirmed skills, grouped by unit. Units only group the choices; the exam records skills. When setting or removing an exam answers with `refreshed` false, the screen shows the answer's notice.

When a proposal waits, a panel shows what changed: the explanation, the activities the proposal would schedule, the preparation needed and the time available before the exam, and each cut with its minutes, reason, and consequence. It offers Confirm tradeoffs, which confirms, and Keep current plan, which declines. It says that nothing changes until the learner confirms: the current plan stays in use, or, when the course has no active plan yet, no plan starts. On the exam day, the panel can list unfinished preparation as cuts, because no study day remains before the exam. It then says that this preparation was not finished before the exam, and routine updates for the course wait until the learner confirms. Deferred work stays in the week list.

```endpoints
Planning.Read at /planning/read
Planning.Configure at /planning/configure
Planning.Propose at /planning/propose
Planning.Begin at /planning/begin
Planning.Finish at /planning/finish
Planning.Stop at /planning/stop
Planning.Miss at /planning/miss
Planning.SetExam at /planning/exams/set
Planning.RemoveExam at /planning/exams/remove
Planning.ConfirmTradeoffs at /planning/tradeoffs/confirm
Planning.DeclineTradeoffs at /planning/tradeoffs/decline
```

```computations
coveredSkillsConfirmed(covered: StudyPlanning.SubjectSet, skills: SkillMapping.SkillMapRows) : Flag
  True when every covered skill identity names a confirmed skill in the supplied course map and no identity repeats. An empty set is true, so the planning concept reports the missing skill with its own message.

urgentExamItem(schedule: StudyPlanning.ScheduleValue, candidate: StudyPlanning.Candidate) : Flag
  True when the schedule's ACTIVE plan is exam-urgent, its focus exam is still among the schedule's active exams, and the candidate names that exam in examRefs. False when the schedule has no ACTIVE plan.

beginAllowed(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill, urgent: Flag) : Flag
  True when prerequisitesReady holds for the skill, or when urgent is true. Every item outside urgent exam preparation keeps the prerequisite check.

itemOrder(day: Date, candidate: StudyPlanning.Candidate) : String
  Joins the day, the candidate's priority in decreasing order, and its key into one sort key, so activities keep the order of `_items`.

cutKey(cut: StudyPlanning.CutValue) : String
  Joins the cut's exam identity and candidate key into one sort key, so cuts keep the order of `_cuts`.
```
