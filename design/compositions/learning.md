# Lessons, practice, and submitted work

[LearningContext](view:Learning.LearningContext) joins an owned confirmed skill, its current requirements, and its readable sources. Use the learner's materials first. If none are available, select and save a reputable reference before teaching. Free questions and study buttons use the same context.

[OpenLesson](reaction:Learning.OpenLesson) requests a grounded explanation and calls `GroundedTutoring.explain` after checking its citations and current context. [OpenPractice](reaction:Learning.OpenPractice) requests a task with the saved demonstration requirements and calls `prepareTask`. A task can contain two fresh problems and reasoning questions. Changing only the numbers in a solved example does not establish freshness.

[PracticeEligibility](view:Learning.PracticeEligibility) checks the current estimates for all direct and indirect prerequisites. Lessons remain available when a prerequisite needs work. Otherwise offer a short prerequisite check before practice. The full exam policy permits an explicit skip only for relevant exam work under a current urgent plan or proposal; a skip gives no mastery credit. The P2 daily-review flow has no automatic skip.

[Respond](reaction:Learning.Respond) saves text, retained attachments, or a speech transcript through `GroundedTutoring.respond`. Lesson replies can use `answerLesson` immediately. [TutorReply](reaction:Learning.TutorReply) saves a response only while the session remains open and the request context still matches. In a CHECK task, neutral reasoning questions use `askFollowup`, and input questions use `clarifyInput`; neither may reveal a method or correction.

[Hint](reaction:Learning.Hint) records `requestHint` before requesting and saving `giveHint`. A hint remains in the attempt even if the learner later solves the problem. [CorrectTranscript](reaction:Learning.CorrectTranscript) uses `confirmTranscript` to append a correction. Ordinary lessons need no approval after each spoken message.

## Confirm and assess

[SubmitWork](reaction:Learning.SubmitWork) applies one review to the whole attempt:

1. [ReviewedAttempt](view:Learning.ReviewedAttempt) checks ownership, task membership, OPEN status, completed uploads and transcription, at least one response, and no existing assessment case for the task.
2. Under the learner's mutation lock, save any reviewed transcript corrections. Require the displayed dialogue length to match the latest dialogue. Call `confirmAttempt` for that exact version.
3. Read `_review`, `_task`, `_session`, `_dialogue`, `_sources`, and `_citations`. Build an immutable response from those saved records. Use the task's topic, definition, question, criteria, and freshness. The browser cannot replace them.
4. Derive assistance from recorded hints and declared outside help. Either makes help HINT; unknown assistance makes it UNKNOWN. A learner's report cannot erase a recorded hint. Neutral probes and input corrections do not count as help.
5. Call `AssessmentReviewing.submit`, using the task identity as `sourceKey` and the server's submission time as `performedAt`.

[CloseSubmittedTask](reaction:Learning.CloseSubmittedTask) follows a successful submission and calls `GroundedTutoring.close`. [AssessSubmittedWork](reaction:Learning.AssessSubmittedWork) requests assessment of the saved case, requirements, sources, and complete work. It then enters the [assessment result flow](progress.md).

The case is the durable record of submission. All session mutation paths refuse further edits once a case exists, even if a failure left the tutoring session OPEN. On retry or restart, reuse the case and finish closing the session. Do not describe this multi-action sequence as one engine transaction. A failed AI request leaves the submitted work available for retry.

[ReadSession](reaction:Learning.ReadSession) returns owned saved work through [SessionPage](former:Learning.SessionPage). [SessionChange](former:Learning.SessionChange) returns the result of lesson, response, correction, and hint operations. [Submission](former:Learning.Submission) returns the case and assessment state, including a pending or retryable result when grading has not finished.

```endpoints
Learning.OpenLesson at /learning/lesson
Learning.OpenPractice at /learning/practice
Learning.Respond at /learning/respond
Learning.Hint at /learning/hint
Learning.CorrectTranscript at /learning/transcript
Learning.SubmitWork at /learning/submit
Learning.ReadSession at /learning/session
```
