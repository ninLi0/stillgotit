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

## Planning reads

[PlanContext](view:Reads.PlanContext) computes candidate reviews, exam preparation, and a context fingerprint from the course map, learner progress, and planning schedule, which includes the course's active exams. [CanReplan](view:Reads.CanReplan) requires course ownership, saved preferences, and no activity in progress. [NeedsEvidence](view:Reads.NeedsEvidence) requires an effective judgment, a matching mastery track, and an absent or older contribution. Reading it has no side effects.

## Memory curves

The Memory view shows how each skill's estimate is expected to fall without practice, and how evidence has reshaped it. [Memory](reaction:Reads.Memory) answers it.

- When the request arrives with a course, `Sessioning.use` turns the session into the acting learner. No request field can name another learner.
- Where [OwnedCourse](view:Courses.OwnedCourse) holds for that learner and course, the endpoint binds the flow's instant as `at`, as Read does, and answers `asOf`, that instant, `policy` with [MemoryPolicy](former:Reads.MemoryPolicy), and `skills` with [MemorySkills](former:Reads.MemorySkills).
- Where OwnedCourse does not hold, because the course is unknown or belongs to another learner, the endpoint answers `COURSE_UNAVAILABLE` and reads no estimate.

MemoryPolicy reads `MasteryEstimating._policy` and answers its settings: `policy`, `halfLifeDays`, `reviewThreshold`, which is the policy's readinessMinimum, and `readinessDays`. It adds `reference`, the policy's own curve: an estimate of 100% left alone, on day 0 and on days 1, 3, 7, 14, 30, 60, and 90, each value read from `MasteryEstimating._withoutPractice`. [referenceCurve](computation:referenceCurve) only gathers those values.

MemorySkills has one row for each confirmed skill in the course, ordered by skill identity, with `skill`, `title`, `unit`, and `unitTitle`. Draft and archived skills are left out. [SkillCurve](view:Reads.SkillCurve) adds the curve of the skill's current definition:

- `startingConfidence` and `startedAt`: the track's starting confidence and when it was set, from `MasteryEstimating._track`.
- `estimate`: the estimate at `at`, the value of `MasteryEstimating._explanation` at that instant.
- `projection`: the estimate 1, 3, 7, 14, 30, 60, and 90 days after `at`, each read with `MasteryEstimating._estimate` at that instant. A query at a future time projects the decay from the evidence available now and assumes no practice, so the projection never rises. [memoryInstants](computation:memoryInstants) gives the instants and [memoryCurve](computation:memoryCurve) gathers the values. Each point has `days`, `at`, and `value`.
- `reviewBy`: the first whole day after `at`, within 180 days, on which the projection is below the review threshold, as a point with `days`, `at`, and `value`. Because the projection never rises, the search halves the 180 days eight times instead of reading every day: [reviewSearch](computation:reviewSearch) starts it, and each step reads `_estimate` on the day [reviewProbe](computation:reviewProbe) names and keeps the half that [reviewNarrow](computation:reviewNarrow) chooses. `reviewBy` is null when the estimate is already below the threshold at `at`, and then `belowNow` is true. It is also null, with `belowNow` false, when the projection stays at or above the threshold for 180 days. Under prototype-1 that cannot happen, because even 100% falls below 70% within 31 days, but the read does not rely on the policy's numbers.
- `leftAlone`: the curve the skill would have followed from its starting point with no evidence and no adjustment. Its points are the starting point, `at`, and each sample day, with values that `_withoutPractice` gives for the starting confidence and the days since the starting point. [leftAloneDays](computation:leftAloneDays) gives those days and [leftAlonePath](computation:leftAlonePath) gathers the points. The starting point is the explanation's, as on the evidence panel; it is earlier than `startedAt` only when assessed work was done before the learner set a starting point.

A skill whose current definition has no track keeps its row, and every curve field is null, so the page can say that the skill has no curve yet.

The read computes no estimate, decay, or readiness of its own. Every value comes from MasteryEstimating; the computations only choose instants, compare a value with the threshold, and gather values into lists. The page draws the curves from these points, and the past path from the evidence that Read returns, so it computes no decay either. The read changes nothing. Each skill costs about sixteen `_estimate` reads, and a course of twenty skills answers in about a quarter of a second on a local database.

```computations
referenceCurve(v0: Number, v1: Number, v3: Number, v7: Number, v14: Number, v30: Number, v60: Number, v90: Number) : ReferenceCurve
  Lists the values of an estimate of 100% left alone on day 0 and each sample day, as MasteryEstimating._withoutPractice answered them, each with its day.

memoryInstants(at: DateTime) : SampleInstants
  Gives at itself as d0, which the endpoint answers as asOf, and the instants 1, 3, 7, 14, 30, 60, and 90 whole days of 24 hours after at.

reviewSearch(at: DateTime) : ReviewSearch
  Starts the search for the first day below the review threshold: day 0, the instant at, is taken to be at or above it, and day 181 stands for no day within 180.

reviewProbe(search: ReviewSearch) : DateTime
  Names the instant of the day to read next: the middle of the days still in question, or the last of them once one day is left.

reviewNarrow(search: ReviewSearch, value: Number, threshold: Number) : ReviewSearch
  Keeps the later half when value is at or above threshold and the earlier half, with value, when it is below. A finished search is returned unchanged.

memoryCurve(at: DateTime, explanation: MasteryEstimating.EstimateExplanation, threshold: Number, search: ReviewSearch, v1: Number, v3: Number, v7: Number, v14: Number, v30: Number, v60: Number, v90: Number) : MemoryCurve
  Gives the explanation's value as the estimate, the sampled values as the projection, the search's day and value as reviewBy unless the estimate is already below threshold or no day was found, and belowNow.

leftAloneDays(explanation: MasteryEstimating.EstimateExplanation, at: DateTime) : LeftAloneDays
  Gives the days from the explanation's starting point to at and to each sample day after at.

leftAlonePath(explanation: MasteryEstimating.EstimateExplanation, at: DateTime, u0: Number, v1: Number, v3: Number, v7: Number, v14: Number, v30: Number, v60: Number, v90: Number) : LeftAlonePath
  Lists the starting point with the starting confidence, then at and each sample day with the values MasteryEstimating._withoutPractice answered.
```

```endpoints
Reads.Memory at /learning/memory
```

## Course confidence

The course switcher shows the open course's overall confidence, and the course menu shows each course's. [Scores](reaction:Reads.Scores) answers it for every course at once, so one request serves the menu.

- When the request arrives, `Sessioning.use` turns the session into the acting learner. The request has no other field, so no field can name another learner.
- The endpoint answers `courses` with [CourseScores](former:Reads.CourseScores): one row for each of the learner's active courses, ordered by course identity, with `course`, `score`, `skills`, and `estimated`. Archived courses are left out.

[courseScore](computation:courseScore) defines the score as the average of the current estimates of the course's confirmed skills, rounded to a whole percent. Only confirmed skills count; drafts and archived skills do not. A confirmed skill without an estimate for its current definition is left out of the average rather than counted as 0, so a new skill does not pull the score down before the learner sets its starting point. `skills` counts the confirmed skills and `estimated` those with an estimate. The score is null when no confirmed skill has an estimate. The estimates are the ones `/learning/progress` reports, `MasteryEstimating._progress` at the live clock, so the score is the course average that the Forest view's course summary shows. Both compute it with the same function, `averageEstimate` in `src/computations/course-score.ts`.

```computations
courseScore(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows) : CourseScore
  Averages the current estimates of the confirmed skills that have one and rounds the average to a whole percent, or gives null when none has an estimate. Also counts the confirmed skills and those with an estimate.
```

```endpoints
Reads.Scores at /courses/scores
```
