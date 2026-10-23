# Shared learning reads

[OwnedSkill](view:Reads.OwnedSkill) joins a skill through its unit to the learner's course. [ActiveSkill](view:Reads.ActiveSkill) also requires confirmation, and gives the skill's course and current definition. [OwnedSession](view:Reads.OwnedSession) checks both session ownership and access to its skill. [OpenSession](view:Reads.OpenSession) excludes closed sessions and any task with submitted assessment work. [OwnedCase](view:Reads.OwnedCase) joins an assessment to its author and course.

[SkillContext](view:Reads.SkillContext) supplies the current definition, course map, owned materials, and learner progress. Each concept query reads only its own records. Application computations combine the returned values without database calls.

[SkillData](former:Reads.SkillData) presents current requirements, the matching mastery track, saved sessions, original work, and judgment history. [SessionData](former:Reads.SessionData) presents a saved tutoring session. [Progress](former:Reads.Progress) builds the tree's estimate list. [PlanData](former:Reads.PlanData) presents preferences, today's budget, the next activity, and the active plan.

## Evidence behind the estimate

SkillData also carries `explanation`, the evidence behind the estimate. The Read endpoint binds the flow's instant, the same engine-supplied instant that Progress.SubmitReviewed uses as an attempt's date, and passes it to SkillData as `at`. No computation supplies it. SkillData asks `MasteryEstimating._explanation` for the session's learner, the skill, and the skill's current definition at `at`. It reads that query as an optional row. [estimateTimeline](computation:estimateTimeline) turns the row, together with the learner's tracks that SkillContext already reads, into a starting point, an ordered list of changes, the attempts that did not count, and the concept's own basis sentence. The tracks supply each adjustment's reason; a timeline row is matched to its adjustment by the adjustment's identity. The page shows the changes as a plain list with readable dates and rounded values. It computes nothing the concept already computes.

When the current definition has no track, or the track starts after `at`, `_explanation` has no row. SkillData still returns its one record, with `explanation` null and every other field unchanged. The page then asks for starting confidence, as it does today. The explanation always belongs to the session's learner, because the learner identity comes from the session and the read first requires OwnedSkill. Another learner's estimate cannot be read.

`estimate` keeps its current meaning: the value, basis, and readiness from `MasteryEstimating._progress`. The explanation's last value is computed at the read's instant, so the two can differ only by time decay during the read, which rounding hides.

## Imported cases

Each entry in `cases` passes through exactly as `AssessmentReviewing._history` reports it, with the original mark and feedback inside its `work`; an imported case has no task, which is how the page tells it apart. The study detail passes cases through unchanged. Practice cases have a task and an empty original mark and feedback. Imported cases have no practice task, so the page lists them in the skill's assessment history rather than under a conversation. It shows them as "Imported · original mark 8/10" with the grader's feedback, separate from the app's judgment.

## Planning reads

[PlanContext](view:Reads.PlanContext) computes candidate reviews, exam preparation, and a context fingerprint from the course map, learner progress, and planning schedule, which includes the course's active exams. [CanReplan](view:Reads.CanReplan) requires course ownership, saved preferences, and no activity in progress. [NeedsEvidence](view:Reads.NeedsEvidence) requires an effective judgment, a matching mastery track, and an absent or older contribution. Reading it has no side effects.
