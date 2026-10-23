# Learning flows

The frontend sends learner choices through the generated client. The session cookie supplies identity. Each flow reads owned state through declared views. Generated answers enter through Generating actions. File access and provider transport receive prepared values and cannot sequence domain actions.

[Read](reaction:Learning.Read) returns saved study data through the skill former. It binds one instant for the request and reads the estimate's explanation at that instant, as described in the [shared reads](LearningReads.md). [Progress](reaction:Learning.Progress) returns estimates for the owned course. [Confidence](reaction:Learning.Confidence) creates one provisional track for the current requirements or returns the existing track. It never overwrites prior practice.

[Lesson](reaction:Learning.Lesson) joins the skill to its owned sources, requests an explanation, rechecks the session and the original requirements, and saves the lesson. [Task](reaction:Learning.Task) also requires a mastery track and ready prerequisites. It requests the complete demonstration gate and rejects a repeated question. The provider does not assign a mastery score.

[Respond](reaction:Learning.Respond) checks the current dialogue length, open session, and the ownership of every attachment before saving learner work. [Question](reaction:Learning.Question) saves a lesson question and requests its answer in one flow. [Reply](reaction:Learning.Reply) retries an unanswered saved lesson question. [Hint](reaction:Learning.Hint) records requested help before contacting the provider, so a failed hint request cannot later be treated as independent work. [Transcript](reaction:Learning.Transcript) records corrections to an existing voice response.

## Several attachments in one response

Respond and Question take `attachments`, a list of material identities, in place of the single `attachment`. The list is required and may be empty. Each entry is one of the learner's own course materials, usually a photo of paper work uploaded for this answer. The rule for each entry is the rule that applied to the single attachment:

- When either request arrives, `Sessioning.use` turns the session into the acting learner.
- Where the session is the learner's open session (an open lesson for Question), the displayed dialogue length is current, and [responseInput](computation:responseInput) finds every listed material among the learner's own sources in the session's course, the endpoint calls `GroundedTutoring.respond` once. That call saves the text and the retained files of all listed materials as one learner turn, in the order the learner attached them.
- Where any listed material is unknown, belongs to another learner, or belongs to another course, or the same material is listed twice, or the response has neither text nor an attachment, nothing is saved. Request admission declines the whole response before dispatch, as it does today, with the admission layer's decline code and one detail per endpoint. For Respond the detail is "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once." For Question it is "Choose an open lesson, check the latest dialogue, and attach only your own work from this course, each file once."

The detail does not name the attachment that failed. The page lists only photos it uploaded to this skill's course for this answer, so it cannot send an attachment that fails this check; the check guards against altered requests. After a refusal the page keeps the draft and every attachment, so the learner can remove one and send again.

Respond answers after the turn is saved. Question then requests the tutor's answer from the saved dialogue, so the provider receives every attached file. Assessment later uses all files saved in the learner's responses. Removing a photo before sending only changes the list the screen sends; nothing is saved until the learner sends.

## Assessment

[Assess](reaction:Learning.Assess) requires the learner to review the complete attempt and declare freshness and outside help. Confirmation triggers submission and closure. The endpoint waits for those actions, asks the provider to judge the saved original work, rechecks the session, and records the judgment. It waits for the resulting progress reactions before responding. A provider failure leaves a closed, unjudged case. [RetryAssessment](reaction:Learning.RetryAssessment) grades that saved case without changing its work, date, criteria, or identity. The UI reads completed judgments instead of submitting them again.

[Correct](reaction:Learning.Correct) appends a manual revision based on the judgment the learner saw. [Regrade](reaction:Learning.Regrade) first saves the learner's clarification, requests another judgment of the original work, and appends a revision only if the expected judgment is still current. Both use the same evidence and planning reactions. Correcting an assessment changes a judgment; it is separate from adjusting the estimate.

## Adjusting the estimate

[Adjust](reaction:Learning.Adjust) lets the learner set the estimate by hand with a reason. The skill page offers it beside the estimate as "Adjust estimate", apart from "Review or correct this assessment". The request carries `skill`, `adjustmentKey`, `value`, and `reason`. The page makes a new key, such as a random UUID, for each new adjustment. It keeps that key with the value and reason in the browser's session storage until it gets an answer, as the draft queue in the [course composition](Courses.md) does, so a retry sends the same key and input even after a reload. Changing the value or reason starts a new adjustment with a new key.

- When the request arrives, `Sessioning.use` turns the session into the acting learner. No request field can name another learner.
- Where [ActiveSkill](view:Reads.ActiveSkill) holds for that learner and skill, it gives the skill's current definition. The endpoint then calls `MasteryEstimating.adjust` with the learner, the skill as subject, that definition, `adjustmentKey`, `value`, and `reason`. It waits for the adjustment and for the replan below to settle, then answers with the `adjustment` identity. The page then calls Read again, which shows the adjustment with its reason in the timeline, and the new estimate.
- Where ActiveSkill does not hold, the endpoint answers `SKILL_UNAVAILABLE` with the detail "Choose one of your confirmed skills before adjusting its estimate." and changes nothing. An unknown skill, another learner's skill, and a draft skill get this same answer.
- Where ActiveSkill holds, the concept decides the remaining refusals and their messages. `INVALID_ADJUSTMENT_KEY` means the key is blank. `ADJUSTMENT_KEY_CONFLICT` means the key was already used for a different skill, value, or reason. `ADJUSTMENT_TRACK_UNAVAILABLE` means the current definition has no starting estimate yet. `INVALID_MASTERY_ADJUSTMENT` means the value is not a number from 0 through 100 or the reason is blank. Each refusal reaches the learner with the concept's message and leaves every concept unchanged.

Through HTTP and the runtime gateway, request admission checks the same ActiveSkill condition before dispatch. It declines an unknown skill, another learner's skill, and a draft skill alike, with the admission layer's decline code and the same detail as `SKILL_UNAVAILABLE`. A caller therefore cannot tell the three cases apart on either path. The endpoint repeats the check for a skill that changes after admission and for callers that bypass admission. Admission does not check the key, value, or reason, so those refusals keep the concept's message.

Each new key appends one adjustment for the current definition; tracks for earlier definitions are never adjusted here. A repeated request with the same key and input returns the same adjustment and changes nothing in MasteryEstimating, so a retry after a lost reply never adds a second row.

An adjustment never makes a skill ready by itself. The concept's readiness rule decides readiness, and the page shows the concept's own readiness sentence.

[ReplanAfterAdjustment](reaction:Learning.ReplanAfterAdjustment) proposes new reviews after an adjustment, the same way ReplanAfterEvidence does after evidence in the [progress reactions](Progress.md). It belongs to this composition so this work does not edit the progress composition.

- When `MasteryEstimating.adjust` succeeds for a learner and skill, it waits for ordinary work in that flow to settle.
- Where [OwnedSkill](view:Reads.OwnedSkill) gives the skill's course, [CanReplan](view:Reads.CanReplan) holds for the learner and that course, and [PlanContext](view:Reads.PlanContext) gives the review candidates, horizon end, explanation, and fingerprint,
- then it calls `StudyPlanning.replan` with the learner, the course as scope, those values, and `workloadComplete` false.

Planning sees adjustments because the tracks PlanContext reads now list each track's adjustments. The intended effect of this replan is:

- The adjusted skill gets a review candidate whose priority comes from the adjusted estimate, when its next review falls within the seven-day horizon that planRequest uses. A lowered estimate moves that review ahead when the daily budget is short, and a raised one moves it back.
- The review's days still follow the latest evidence, because an adjustment is not practice. An activity already finished for that evidence within its window is not offered again.
- The fingerprint includes adjustments, so a proposal made before the adjustment can no longer be activated as current. ActivateRoutine activates the new proposal when nothing else blocks it.

[planRequest](computation:planRequest) states how candidate keys and the fingerprint carry adjustments.

When CanReplan does not hold, because the course has no saved budget or an activity is in progress, no proposal is made. That is not a failure. The Adjust endpoint waits for this reaction before answering. If the replan is refused or faults, the answer is that failure: the planning concept's refusal message, or the general internal error. The adjustment stays saved, because one concept's write is not rolled back when another concept fails. The answer cannot say which step failed, so after any failed or lost reply the page:

- shows the failure's message, followed by "The timeline below shows whether your adjustment was saved. Sending it again will not add it twice.";
- reads the skill again, so the timeline shows whether the adjustment was saved; and
- keeps the key with the unchanged value and reason, so sending again is a retry.

A retry with the same key returns the saved adjustment without adding a row. Because `adjust` succeeds again, this reaction runs again and proposes from current state, which completes a replan that failed. Updating the plan through `/planning/propose`, or any later replan trigger, also recovers it.

## Reading a cited passage

Each citation names a material and a location in it. When the learner opens an entry under "Sources used", the page calls the existing `/courses/materials/read` endpoint from the [course composition](Courses.md) with the citation's material. That read checks the session, the material's owner, and the course owner, and refuses with `MATERIAL_UNAVAILABLE` or `COURSE_UNAVAILABLE`. It returns the title, locator, readable content, and retained files. Each retained file lists its renditions, and each rendition has a location, as the [material data](../material-data.md) describes.

The page shows every rendition whose location equals the citation's location, in saved order: a text rendition as its text, and an image rendition as the image. The importer gives an uploaded image one location, and citations use the importer's locations, so a citation into an image names that location and matches its rendition; the material data defines no finer image-region locations today. If no rendition matches, the page shows the material's readable content and names the location. It labels the passage with the material title and location, as the source labels do today. If the read refuses, the page shows that reason in place of the passage.

An image rendition holds a retained file reference, not the image itself. The page loads the image through the host's existing material-file download, which is a host route rather than an endpoint. As the material data requires, that download first checks the signed-in learner's access to the material and the exact file reference, then reads the bytes. The file store keeps each learner's files under a digest of that learner's identity, so another learner's reference cannot be read.

No new endpoint is needed. The existing read returns every location and file reference, and the existing download serves the image with the same session and ownership checks. A citation can only name materials the session uses, and those belong to the session's learner and course. Saved materials never change, so a cited location stays valid.

## Listening

Listening to lessons, practice questions, tutor replies, and hints is screen-only. The browser speaks text that Read already returns, so it needs no endpoint or contract.

## Suggestions and ordering

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
Learning.Adjust at /learning/adjust
Learning.Suggest at /courses/skills/suggest
```
