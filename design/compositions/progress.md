# Assessments and mastery updates

[SetConfidence](reaction:Progress.SetConfidence) accepts confidence for an owned confirmed skill's current version. It calls `MasteryEstimating.initialize` with basis SELF_REPORTED. [ExistingEvidence](reaction:Progress.ExistingEvidence) then loads effective judgments already saved for that exact version and applies them with their original dates.

[ChangedRequirements](reaction:Progress.ChangedRequirements) follows `SkillMapping.reviseDefinition`. It reads the previous version's estimate and initializes the new version with that value and basis PREVIOUS_DEFINITION. It does not copy evidence. If the old track does not exist, leave the new one unassessed until the learner reports confidence. [ProgressState](view:Progress.ProgressState) keeps old versions visible and explains why the new version needs a fresh check.

## Save and correct assessments

[SaveAssessment](reaction:Progress.SaveAssessment) accepts a validated provider result for a saved case and calls `AssessmentReviewing.assess`. This is an internal path. A learner request cannot supply a result and label it AI.

[RequestRegrade](reaction:Progress.RequestRegrade) checks [OwnedCase](view:Access.OwnedCase), optionally appends a clarification through `clarify`, and requests a new judgment against the original work and requirements. Save the effective judgment identity and clarification count with the request. [SaveRegrade](reaction:Progress.SaveRegrade) checks both again under the mutation lock and calls `revise` with that judgment as `basedOn` and origin AI. Discard a delayed result whose context has changed.

[CorrectJudgment](reaction:Progress.CorrectJudgment) calls `revise` with origin MANUAL after an explicit learner correction and explanation. It follows the same assistance, freshness, and full-gate rules. A changed solution needs a new attempt; it cannot be inserted as a clarification.

## Apply one contribution per attempt

[ApplyAssessment](reaction:Progress.ApplyAssessment) follows `AssessmentReviewing.assess`. [ApplyRegrade](reaction:Progress.ApplyRegrade) follows `AssessmentReviewing.revise`. Both use [EffectiveEvidence](view:Progress.EffectiveEvidence), which requires the judgment to remain the case's effective judgment, reads the case's author, skill, definition, date, and freshness, and finds the matching mastery track.

Call `MasteryEstimating.acceptEvidence` with the case identity, effective judgment revision, original attempt date, mapped signal, freshness, gateMet, and the judgment's origin and rationale as attribution. A newer revision replaces the same input. An already applied or older revision changes nothing; treat that refusal as an already handled delivery, not a new attempt.

If no track exists, retain the judgment and apply it after initialization. If an update fails, show that synchronization is pending and retry from the saved effective judgment. AssessmentReviewing owns judgment history; MasteryEstimating holds only its current scoring input. Restart recovery checks for missing or older inputs before presenting a current estimate.

[ReadProgress](reaction:Progress.ReadProgress) returns [ProgressPage](former:Progress.ProgressPage): the current estimate and its explanation, original work, judgment history, and previous requirement versions. [ProgressChange](former:Progress.ProgressChange) returns the saved confidence or correction result. Regrading old work updates only its original version.

A successful evidence update or manual mastery adjustment triggers the [planning refresh](planning.md). Finishing a timed activity alone does not produce assessment evidence. Graded-coursework import follows the same case-to-evidence rule when its P3 interface is added.

```endpoints
Progress.SetConfidence at /progress/confidence
Progress.RequestRegrade at /progress/regrade
Progress.CorrectJudgment at /progress/correct
Progress.ReadProgress at /progress/read
```
