# Shared learning reads

[OwnedSkill](view:Reads.OwnedSkill) joins a skill through its unit to the learner's course. [ActiveSkill](view:Reads.ActiveSkill) also requires confirmation, and gives the skill's course and current definition. [OwnedSession](view:Reads.OwnedSession) checks both session ownership and access to its skill. [OpenSession](view:Reads.OpenSession) excludes closed sessions and any task with submitted assessment work. [OwnedCase](view:Reads.OwnedCase) joins an assessment to its author and course.

[SessionSources](view:Reads.SessionSources) adds the open session's saved dialogue and the learner's sources in the session's course. Both queries answer for any session that exists, so SessionSources holds exactly when OpenSession holds. The endpoints still use OpenSession as their refusal guard, because its absence is what the refusal is about. [PendingGrade](view:Reads.PendingGrade) gives a submitted attempt in the learner's own session that has no judgment yet, with the case's work, the saved session, and the learner's sources in its course. These are everything a grading request reads. Assess and RetryAssessment grade through PendingGrade, and the admission check for a retry reads it too.

[SkillContext](view:Reads.SkillContext) supplies the current definition, course map, owned materials, and learner progress. Each concept query reads only its own records. Application computations combine the returned values without database calls.

[SkillData](former:Reads.SkillData) presents current requirements, the matching mastery track, saved sessions, original work, and judgment history. [SessionData](former:Reads.SessionData) presents a saved tutoring session. [Progress](former:Reads.Progress) builds the tree's estimate list. [PlanData](former:Reads.PlanData) presents preferences, today's budget, the next activity, and the active plan.

## Evidence behind the estimate

SkillData also carries `explanation`, the evidence behind the estimate. The Read endpoint binds the flow's instant, the same engine-supplied instant that Progress.SubmitReviewed uses as an attempt's date, and passes it to SkillData as `at`. No computation supplies it. SkillData asks `MasteryEstimating._explanation` for the session's learner, the skill, and the skill's current definition at `at`. It reads that query as an optional row. [estimateTimeline](computation:estimateTimeline) turns the row, together with the learner's tracks that SkillContext already reads, into a starting point, an ordered list of changes, the attempts that did not count, and the concept's own basis sentence. The tracks supply each adjustment's reason; a timeline row is matched to its adjustment by the adjustment's identity. The page shows the changes as a plain list with readable dates and rounded values. It computes nothing the concept already computes.

When the current definition has no track, or the track starts after `at`, `_explanation` has no row. SkillData still returns its one record, with `explanation` null and every other field unchanged. The page then asks for starting confidence, as it does today. The explanation always belongs to the session's learner, because the learner identity comes from the session and the read first requires OwnedSkill. Another learner's estimate cannot be read.

`estimate` keeps its current meaning: the value, basis, and readiness from `MasteryEstimating._progress`. The explanation's last value is computed at the read's instant, so the two can differ only by time decay during the read, which rounding hides.

## Imported cases

Each entry in `cases` passes through exactly as `AssessmentReviewing._history` reports it, with the original mark and feedback inside its `work`; an imported case has no task, which is how the page tells it apart. The study detail passes cases through unchanged. Practice cases have a task and an empty original mark and feedback. Imported cases have no practice task, so the page lists them in the skill's assessment history rather than under a conversation. It shows them as "Imported · original mark 8/10" with the grader's feedback, separate from the app's judgment.

## Sessions to continue

Home shows a Continue card that lists the learner's lessons and practice tasks that are still open in the course, so the learner can pick one up again. [Continue](reaction:Reads.Continue) answers that list.

- When the request arrives with a course, `Sessioning.use` turns the session into the acting learner. No request field can name another learner.
- Where [OwnedCourse](view:Courses.OwnedCourse) holds for that learner and course, the endpoint answers `sessions` with [OpenStudy](former:Reads.OpenStudy).
- Where OwnedCourse does not hold, because the course is unknown or belongs to another learner, the endpoint answers `COURSE_UNAVAILABLE` and reads no session.

OpenStudy has one row for each session of a confirmed skill in the course that OpenSession admits for the learner. It reads each skill's sessions with `GroundedTutoring._sessions`, keeps the OPEN ones, and then requires OpenSession, so a task with submitted work is left out, as it is for every endpoint that changes a session. Each row gives the session, its skill and the skill's title, its kind, and `lastActive`. [sessionActivity](computation:sessionActivity) reads the kind and `lastActive` from the session's record from `GroundedTutoring._sessionData`. Rows are ordered by session identity, as `_sessions` orders them. A draft or archived skill has no study page, so its sessions are not listed. The list is empty when nothing is open.

The concept records a time only on dialogue turns, so `lastActive` is the time of the session's latest turn, and it is null for a session that has no turn yet. The card lists sessions with a turn first, latest first, and then the others, most recently started first. Selecting a row opens that skill's study page on that session.

```computations
sessionActivity(data: GroundedTutoring.StudyRecord) : SessionActivity
  Names the session's kind, LESSON for a lesson and PRACTICE for a practice task, and gives lastActive, the server time of its latest dialogue turn. lastActive is null when the session has no dialogue turn yet.
```

```endpoints
Reads.Continue at /learning/continue
```

## Conversations in the sidebar

The sidebar lists the learner's latest conversations in the course, open or closed, so the learner can go back to any of them from any page. [Recent](reaction:Reads.Recent) answers that list.

- When the request arrives with a course, `Sessioning.use` turns the session into the acting learner, as for Continue.
- Where [OwnedCourse](view:Courses.OwnedCourse) holds for that learner and course, the endpoint answers `sessions` with [RecentStudy](former:Reads.RecentStudy).
- Where OwnedCourse does not hold, the endpoint answers `COURSE_UNAVAILABLE` and reads no session.

RecentStudy reads the course map with `SkillMapping._map`, and [studyTopics](computation:studyTopics) keeps its confirmed skills, since only a confirmed skill has a study page. `GroundedTutoring._recent` then gives at most 40 of the learner's sessions in those skills, in every status, most recently active first: by the latest turn's time, or, before the first turn, by the time the session started. The cap and the order come from the concept query, because a former can order rows but cannot keep only the first few. For each of those sessions, RecentStudy reads the skill's title with `SkillMapping._skill` and the session's record with `GroundedTutoring._sessionData`, and [recentSession](computation:recentSession) gives its kind, its title, when it started, and when it was last active. A row keeps the order `_recent` gave it.

Each row gives the session, its skill and the skill's title, its kind, its status, its title, `startedAt`, and `lastActivity`. A lesson's title is its opening request, shortened to about 60 characters at a word boundary; a practice session's title is "Practice · " and the skill's title. `startedAt` is null for a session saved before identities recorded the time, and `lastActivity` is then null until its first turn. Selecting a row opens that skill's study page on that session, the way a Continue row does.

```computations
studyTopics(skills: SkillMapping.SkillMapRows) : TopicList
  Lists the skills in the course map whose status is CONFIRMED.

recentSession(data: GroundedTutoring.StudyRecord, skillTitle: String) : RecentSession
  Names the session's kind, LESSON or PRACTICE, and gives its title: a lesson's opening request with its spaces collapsed and, when it is longer than 60 characters, cut at the last word before that with an ellipsis; or "Practice · " followed by skillTitle. startedAt is the time the session's identity records, or null when it records none. lastActivity is the server time of the latest dialogue turn, or startedAt when there is no turn.
```

```endpoints
Reads.Recent at /learning/recent
```

## Planning reads

[PlanContext](view:Reads.PlanContext) computes candidate reviews, exam preparation, and a context fingerprint from the course map, learner progress, and planning schedule, which includes the course's active exams. [CanReplan](view:Reads.CanReplan) requires course ownership, saved preferences, and no activity in progress. [NeedsEvidence](view:Reads.NeedsEvidence) requires an effective judgment, a matching mastery track, and an absent or older contribution. Reading it has no side effects.
