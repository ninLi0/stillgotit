# Progress reactions

[SubmitReviewed](reaction:Progress.SubmitReviewed): when a learner confirms the whole attempt with freshness and help declarations, read its saved task, corrected responses, and review state. Submit an immutable assessment case with the original requirements and server time.

[CloseSubmitted](reaction:Progress.CloseSubmitted): when a case is submitted, close its open tutoring task. A failed provider request leaves the original work available for retry.

[AssessedEvidence](reaction:Progress.AssessedEvidence), [RevisedEvidence](reaction:Progress.RevisedEvidence), and [ImportedEvidence](reaction:Progress.ImportedEvidence): when a judgment is saved, read the effective revision and its original attempt date. Apply it to the matching mastery track only when that evidence is absent or older. A regrade replaces one contribution; it does not count as another attempt.

[InitializedEvidence](reaction:Progress.InitializedEvidence): when a track is initialized, apply existing judgments for that same definition. Evidence for an earlier definition does not silently certify a newer one.

After a skill definition is revised, the new version's mastery track starts from the previous estimate, and is repaired on the next course read, by two reactions declared in [Courses](Courses.md): RevisedTrack and RepairRevisedTrack. They live there because the course-editing flow owns the learner's lock and the course read.

[ReplanAfterEvidence](reaction:Progress.ReplanAfterEvidence) and [ReplanAfterConfidence](reaction:Progress.ReplanAfterConfidence) wait for ordinary work in their causal flow to settle, then propose reviews from the current requirements and evidence. [ReplanAfterBudget](reaction:Progress.ReplanAfterBudget) does the same after changed preferences. No proposal is made while an activity is in progress.

[ActivateRoutine](reaction:Progress.ActivateRoutine) checks both the planning concept's state and the current application fingerprint before activating a routine proposal. A proposal needing tradeoff approval cannot use this path.

[ReplanAfterFinish](reaction:Progress.ReplanAfterFinish) and [ReplanAfterStop](reaction:Progress.ReplanAfterStop): when a learner finishes or stops an activity, then for every course of that learner where CanReplan holds and PlanContext gives candidates, horizon end, basis, and explanation, call `StudyPlanning.replan` with those values and `workloadComplete` false. This covers every course with saved preferences, not only the activity's course. No course can be replanned while an activity is in progress, so an exam or budget change made in another course during the activity takes effect here. [ReplanAfterMiss](reaction:Progress.ReplanAfterMiss) refreshes the missed activity's course. None of these changes mastery. A missed activity is not assessment evidence.

[RepairReadEvidence](reaction:Progress.RepairReadEvidence) and [RepairReadClosure](reaction:Progress.RepairReadClosure) watch the successful authentication step of Learning.Read. They repair a missing contribution or an unclosed submitted task from durable concept records. They inspect only that learner's courses and cases. The read endpoint waits for this causal work before returning. Repeated reads do not add another contribution or judgment. This is explicit recovery; the framework does not replay old occurrence logs after restart.
