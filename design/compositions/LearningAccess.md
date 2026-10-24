# Request admission

Before dispatching a learning or planning command, HTTP and the exported runtime gateway evaluate the same registered admission former under the same learner lock. A declined result produces an immediate explanation. This avoids waiting for an endpoint whose conditions cannot hold. Identity always comes from the session; request fields cannot select another owner. The endpoint repeats its guards, and each concept still enforces its own state rules.

The adapter performs no domain writes and sequences no learning actions. The engine evaluates the formers. Native callers use the runtime's exported `gateway`; the raw assembled invoker bypasses this admission layer. The [advisory review](../advisory-review.md) records the P2 decision to keep this boundary.

[LessonReady](former:Access.LessonReady) checks the corresponding command against current owned state.
[TaskReady](former:Access.TaskReady) checks the corresponding command against current owned state.
[ResponseReady](former:Access.ResponseReady) checks the corresponding command against current owned state.
[ReplyReady](former:Access.ReplyReady) checks the corresponding command against current owned state.
[HintReady](former:Access.HintReady) checks the corresponding command against current owned state.
[TranscriptReady](former:Access.TranscriptReady) checks the corresponding command against current owned state.
[AssessmentReady](former:Access.AssessmentReady) checks the corresponding command against current owned state.
[RetryReady](former:Access.RetryReady) checks the corresponding command against current owned state.
[RegradeReady](former:Access.RegradeReady) admits Correct and Regrade for the learner's own practice or imported case ([OwnedAnyCase](view:Reads.OwnedAnyCase)) whose effective judgment is the one the learner saw. Regrade then refuses an imported case itself.
[SuggestionReady](former:Access.SuggestionReady) checks the corresponding command against current owned state.
[GradedReady](former:Access.GradedReady) admits Extract and Confirm only when [GradedMaterial](view:Importing.GradedMaterial) holds. Otherwise it declines, with the admission layer's usual code, and the sentence "Choose graded work that you imported into one of your courses." The answer is the same for an unknown material, another learner's material, a material outside the learner's courses, and the learner's own ungraded material.
[CourseReady](former:Access.CourseReady) checks the corresponding command against current owned state.
[PlanReady](former:Access.PlanReady) checks the corresponding command against current owned state.
[ItemReady](former:Access.ItemReady) checks the corresponding command against current owned state.
[BeginReady](former:Access.BeginReady) checks the corresponding command against current owned state.

[QuestionReady](former:Access.QuestionReady) requires an open lesson, current dialogue length, and valid learner content.
