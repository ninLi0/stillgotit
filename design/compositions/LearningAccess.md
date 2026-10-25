# Request admission

Before dispatching a learning or planning command, HTTP and the exported runtime gateway evaluate the same registered admission formers under the same learner lock. A command that asks the tutor passes two formers, as described below; every other command passes one. A declined result produces an immediate explanation. This avoids waiting for an endpoint whose conditions cannot hold. Identity always comes from the session; request fields cannot select another owner. Each endpoint repeats the ownership guard that admission checks first, and when that guard fails it answers a refusal of its own, so a caller that skips admission gets an answer instead of waiting for the request limit. Each concept still enforces its own state rules.

The adapter performs no domain writes and sequences no learning actions. The engine evaluates the formers. Native callers use the runtime's exported `gateway`; the raw assembled invoker bypasses this admission layer. On that path the endpoints answer these refusals themselves: Lesson and Task answer `SKILL_UNAVAILABLE` when the skill is not one of the learner's confirmed skills; Respond, Question, Reply, Hint, Transcript, and Assess answer `SESSION_UNAVAILABLE` when the session is not one of the learner's open sessions; RetryAssessment answers `SESSION_UNAVAILABLE` when the session is not one of the learner's own; Correct and Regrade answer `REVISION_CASE_UNAVAILABLE` when the case is not one of the learner's own; Suggest answers `MATERIAL_UNAVAILABLE` for a material that is not the learner's own and `COURSE_UNAVAILABLE` for the learner's material in a course they do not own. The planning endpoints answer as the [planning flows](Planning.md) describe. Admission declines all of these first over HTTP, with the details below, so these answers matter for the host's own code paths, for tests that bypass admission, and for a route added later without an admission entry. Other conditions, such as a stale dialogue length, are still checked only by admission and the concepts. The [advisory review](../advisory-review.md) records the P2 decision to keep this boundary.

A command that asks the tutor first passes [TutorReady](former:Settings.TutorReady), before its own former. These are the commands at `/learning/lesson`, `/learning/task`, `/learning/question`, `/learning/reply`, `/learning/hint`, `/learning/assess`, `/learning/retry`, `/learning/regrade`, and `/courses/skills/suggest`. TutorReady admits the command when the learner has no saved tutor choice, or has a saved choice that is still offered. A declined result explains: "The tutor model or thinking level you chose is no longer offered. Choose another one in the Tutor panel." The [tutor settings](Settings.md) describe the choice.

`/learning/correct` shares RegradeReady but makes no AI call, so it does not pass TutorReady.

[LessonReady](former:Access.LessonReady) checks the corresponding command against current owned state.
[TaskReady](former:Access.TaskReady) checks the corresponding command against current owned state.
[ResponseReady](former:Access.ResponseReady) requires an open session, the current dialogue length, and text or at least one attachment. Every attachment must be listed once and be the learner's own material in the session's course; otherwise the whole response is declined, with a detail that does not name the attachment.
[ReplyReady](former:Access.ReplyReady) checks the corresponding command against current owned state.
[HintReady](former:Access.HintReady) checks the corresponding command against current owned state.
[TranscriptReady](former:Access.TranscriptReady) checks the corresponding command against current owned state.
[AssessmentReady](former:Access.AssessmentReady) checks the corresponding command against current owned state.
[RetryReady](former:Access.RetryReady) checks the corresponding command against current owned state.
[RegradeReady](former:Access.RegradeReady) admits Correct and Regrade for the learner's own practice or imported case ([OwnedAnyCase](view:Reads.OwnedAnyCase)) whose effective judgment is the one the learner saw. Regrade then refuses an imported case itself.
[AdjustReady](former:Access.AdjustReady) requires a confirmed skill that the learner owns. It declines an unknown skill, another learner's skill, and a draft skill with the same detail as the endpoint's `SKILL_UNAVAILABLE`, "Choose one of your confirmed skills before adjusting its estimate." It does not check the key, value, or reason, so the concept's message explains those refusals.
[SuggestionReady](former:Access.SuggestionReady) checks the corresponding command against current owned state.
[GradedReady](former:Access.GradedReady) admits Extract and Confirm only when [GradedMaterial](view:Importing.GradedMaterial) holds. Otherwise it declines, with the admission layer's usual code, and the sentence "Choose graded work that you imported into one of your courses." The answer is the same for an unknown material, another learner's material, a material outside the learner's courses, and the learner's own ungraded material.
[CourseReady](former:Access.CourseReady) checks the corresponding command against current owned state.
[PlanReady](former:Access.PlanReady) checks the corresponding command against current owned state.
[ItemReady](former:Access.ItemReady) checks the corresponding command against current owned state.
[BeginReady](former:Access.BeginReady) checks the corresponding command against current owned state.

[QuestionReady](former:Access.QuestionReady) requires an open lesson, current dialogue length, and valid learner content, with the same attachment rule as ResponseReady.

When [TaskReady](former:Access.TaskReady) declines, [PracticePrerequisite](former:Access.PracticePrerequisite) reads the same skill context and uses [prerequisiteToPractice](computation:prerequisiteToPractice) to look for a prerequisite that is not ready. If it finds one, the explanation names it: Work on “<title>” first. This skill builds on it. Otherwise the practice explanation stays: Set starting confidence and check the prerequisites before starting fresh practice.

```computations
prerequisiteToPractice(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill) : PrerequisiteChoice
  Finds the prerequisite to work on first. It starts from the skill's direct prerequisites that are not ready by the rule prerequisitesReady uses. It follows prerequisites that are also not ready until it reaches one whose own prerequisites are all ready, taking the lowest skill identity at each step, and gives that skill's title. Answers found false when every direct prerequisite is ready.
```

Exam and tradeoff commands are admitted on course ownership alone, with the detail "Choose one of your own courses.", the same answer the planning endpoints give for a course that is not the learner's. The planning concept's own refusals then reach the learner with its messages. Begin admission uses the planning composition's StartAllowed view, so admission and the endpoint apply the same urgent-mode rule.
