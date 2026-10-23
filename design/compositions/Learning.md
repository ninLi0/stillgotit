# Learning flows

The frontend sends learner choices through the generated client. The session cookie supplies identity. Each flow reads owned state through declared views. Generated answers enter through Generating actions. File access and provider transport receive prepared values and cannot sequence domain actions.

[Read](reaction:Learning.Read) returns saved study data through the skill former. [Progress](reaction:Learning.Progress) returns estimates for the owned course. [Confidence](reaction:Learning.Confidence) creates one provisional track for the current requirements or returns the existing track. It never overwrites prior practice.

[Lesson](reaction:Learning.Lesson) joins the skill to its owned sources, requests an explanation, rechecks the session and the original requirements, and saves the lesson. [Task](reaction:Learning.Task) also requires a mastery track and ready prerequisites. It requests the complete demonstration gate and rejects a repeated question. The provider does not assign a mastery score.

[Respond](reaction:Learning.Respond) checks the current dialogue length, open session, and attachment ownership before saving learner work. [Question](reaction:Learning.Question) saves a lesson question and requests its answer in one flow. [Reply](reaction:Learning.Reply) retries an unanswered saved lesson question. [Hint](reaction:Learning.Hint) records requested help before contacting the provider, so a failed hint request cannot later be treated as independent work. [Transcript](reaction:Learning.Transcript) records corrections to an existing voice response.

[Assess](reaction:Learning.Assess) requires the learner to review the complete attempt and declare freshness and outside help. Confirmation triggers submission and closure. The endpoint waits for those actions, asks the provider to judge the saved original work, rechecks the session, and records the judgment. It waits for the resulting progress reactions before responding. A provider failure leaves a closed, unjudged case. [RetryAssessment](reaction:Learning.RetryAssessment) grades that saved case without changing its work, date, criteria, or identity. The UI reads completed judgments instead of submitting them again.

[Correct](reaction:Learning.Correct) appends a manual revision based on the judgment the learner saw. [Regrade](reaction:Learning.Regrade) first saves the learner's clarification, requests another judgment of the original work, and appends a revision only if the expected judgment is still current. Both use the same evidence and planning reactions.

[Suggest](reaction:Learning.Suggest) requests editable skill suggestions from an owned course source. The learner must still save and confirm the selected skills.

The host serializes mutation requests per learner for the single-process P2 app. Conditions observe state; the concepts enforce their own atomic constraints. Source-version checks are repeated after slow provider work. Failed causal work is reported rather than presenting an incomplete response as success.

```endpoints
Learning.Read at /learning/read
Learning.Progress at /learning/progress
Learning.Confidence at /learning/confidence
Learning.Lesson at /learning/lesson
Learning.Task at /learning/task
Learning.Respond at /learning/respond
Learning.Question at /learning/question
Learning.Reply at /learning/reply
Learning.Hint at /learning/hint
Learning.Transcript at /learning/transcript
Learning.Assess at /learning/assess
Learning.RetryAssessment at /learning/retry
Learning.Correct at /learning/correct
Learning.Regrade at /learning/regrade
Learning.Suggest at /courses/skills/suggest
```
