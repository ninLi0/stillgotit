# MasteryEstimating

## Purpose

Help learners judge what they can still do from the evidence available.

## Principle

A learner reports confidence in an ability. This gives a provisional estimate for its current requirements. Time lowers the estimate. Success with help can restore part of a loss. Fresh independent work can restore more. A regrade replaces one attempt's contribution and recalculates later changes. A manual adjustment sets a new starting value; later practice and time still change it. Revised requirements use a separate record and need fresh evidence.

## Types

```types
external Learner
  The identity whose ability is estimated.
external Subject
  The ability being estimated.
external Definition
  The fixed version of the requirements for that ability.
external Evidence
  The identity of one assessed attempt. A regrade keeps this identity.
Signal is INDEPENDENT or SUPPORTED or SLIP or GAP or UNCERTAIN
  Successful independent work, successful assisted work, a small execution error, a gap in understanding or application, or insufficient evidence.
StartingBasis is SELF_REPORTED or PREVIOUS_DEFINITION
  Whether starting confidence comes from the learner's report or the estimate for earlier requirements.
opaque EstimateExplanation
  A computed explanation containing the policy version, starting confidence and basis, replay start, included evidence identities and revisions, ignored inputs and their reasons, ordered score changes, final estimate, and reasons for prerequisite readiness. Each change identifies its time and source, the values before and after it, and any time decay. It is a query result, not stored assessment history.
```

## State

```state
a set of Tracks with
  a learner Learner
  a subject Subject
  a definition Definition
  an initialConfidence Number
  a startingBasis StartingBasis
  an initializedAt DateTime
  unique learner and subject and definition
a set of Inputs with
  a track Track
  an evidence Evidence
  a revision Number
  a performedAt DateTime
  a signal Signal
  a fresh Flag
  a gateMet Flag
  an attribution String
  unique track and evidence
a seq of Adjustments with
  a track Track
  a value Number
  a reason String
  an at DateTime
Rule: a matching track has the supplied learner, subject, and definition. Track fields never change. Every input and adjustment belongs to an existing track.
Rule: each Evidence identity belongs to at most one input and one track. Its identity, track, and performedAt never change. Replacement preserves the input identity and stores only the higher revision's signal, freshness, gateMet, and attribution.
Rule: a valid score is a finite number from 0 through 100. Initial confidence and adjustment values are valid scores. Adjustments never change and retain their append order.
Rule: valid evidence has a positive integer revision, performedAt no later than now, and nonblank attribution. If gateMet is true, signal must be INDEPENDENT and fresh must be true. A full gate means all saved demonstration requirements were met; this concept receives that judgment rather than assessing work again.
Rule: all estimates use policy prototype-1. These are initial test settings, not validated measures of mastery. Parameters are halfLifeDays = 60, partialGain = 10, partialLimit = 79, fullGateFloor = 95, supportedGain = 5, supportedLimit = 79, slipLoss = 5, gapLoss = 20, readinessMinimum = 70, and readinessDays = 14. A calculation change requires a new policy version.
Rule: an informative input is SLIP or GAP, or a fresh INDEPENDENT or SUPPORTED result. UNCERTAIN and successful reused work are not informative. They do not directly change the score, recovery reference, support cap, or readiness. Time decay still applies.
Rule: queries use the current effective inputs whose performedAt is no later than the requested time, and adjustments whose at is no later than that time. They do not reconstruct which revisions were known at a past time. A future query projects time decay from the evidence currently available; it assumes no future practice.
Rule: replay starts at the earlier of initializedAt and the earliest included informative input date. If there is no such input, it starts at initializedAt. The starting estimate m and recovery reference r both equal initialConfidence at that replay start; the support cap c is unset. This preserves the provisional rule for calibrating from work done before setup.
Rule: process informative inputs by performedAt. Break simultaneous evidence ties by stable Evidence identity. Then process adjustments at that time in append order. Before each event, and from the last event to the requested time, set m = m * 2^(-elapsedDays / halfLifeDays). Use elapsed seconds divided by 86400 for days. Decay leaves r and c unchanged.
Rule: apply the reused-success rule before either success rule. Successful work with fresh false gives no gain and cannot restore readiness.
Rule: fresh INDEPENDENT with gateMet false sets m = max(m, min(max(partialLimit, r), m + partialGain)). Fresh INDEPENDENT with gateMet true sets m = max(m, fullGateFloor). After either fresh independent success, set r = max(r, m) and clear c.
Rule: for fresh SUPPORTED, keep an existing c. When c is unset and m < r, set c = (m + r) / 2. When c is unset and m >= r, set c = max(m, min(supportedLimit, m + supportedGain)). Then set m = max(m, c). More supported successes cannot raise that cap until an independent success or manual adjustment clears it.
Rule: SLIP subtracts slipLoss percentage points from m. GAP subtracts gapLoss percentage points from m. Neither changes r or c. A manual adjustment sets m = r = value and clears c. Clamp m to 0 through 100 after each event. Round only for display.
Rule: a regrade replaces the input at its original performedAt and replays all later events, including manual adjustments. It is not another success at the time of the regrade. Receiving an older or equal revision does not change the estimate.
Rule: readiness requires m >= readinessMinimum and the latest informative input to be fresh INDEPENDENT work performed within readinessDays of the requested time. The boundary at exactly readinessDays is included. No informative input means not ready. A later SLIP, GAP, or SUPPORTED result requires another independent success. Manual adjustments alone cannot establish readiness.
Rule: a new definition has its own track. StartingBasis PREVIOUS_DEFINITION records a provisional starting estimate without transferring evidence. Until fresh independent evidence exists on that track, its explanation says that a new check is needed. Regrading old work changes only its original track.
Rule: blank text is empty or contains only whitespace. now is server time. New identities are unique. Refused actions change no state; unmentioned state stays unchanged. Queries never change state.
```

## Actions

```actions
initialize(learner: Learner, subject: Subject, definition: Definition, confidence: Number, basis: StartingBasis) : returns (track: Track)
  where confidence is not a valid score
  then
    refuses INVALID_INITIAL_CONFIDENCE "Enter a confidence value from 0 to 100."
  where confidence is a valid score and a matching track exists
  then
    refuses MASTERY_TRACK_EXISTS "This skill version already has an estimate."
  where confidence is a valid score and no matching track exists
  then
    create track with learner, subject, definition, confidence as initialConfidence, basis as startingBasis, and initializedAt now
    returns track

acceptEvidence(learner: Learner, subject: Subject, definition: Definition, evidence: Evidence, revision: Number, performedAt: DateTime, signal: Signal, fresh: Flag, gateMet: Flag, attribution: String) : returns (input: Input)
  where no matching track exists
  then
    refuses EVIDENCE_TRACK_UNAVAILABLE "Set a starting estimate for this skill version first."
  where a matching track exists and the valid evidence rules do not hold
  then
    refuses INVALID_MASTERY_EVIDENCE "Provide a valid revision, attempt date, result, and assessment explanation."
  where a matching track exists, the valid evidence rules hold, and evidence already belongs to another track
  then
    refuses EVIDENCE_TRACK_MISMATCH "Keep this attempt with its original learner, skill, and requirements version."
  where a matching track exists, the valid evidence rules hold, evidence belongs to that track, and performedAt differs from its saved date
  then
    refuses EVIDENCE_DATE_MISMATCH "Keep the original attempt date when applying a regrade."
  where a matching track exists, the valid evidence rules hold, evidence belongs to that track, performedAt matches its saved date, and revision is no greater than its saved revision
  then
    refuses EVIDENCE_REVISION_NOT_NEW "This judgment revision has already been applied or replaced."
  where a matching track exists, the valid evidence rules hold, and evidence has no input
  then
    create input with the matching track, evidence, revision, performedAt, signal, fresh, gateMet, and attribution
    returns input
  where a matching track exists, the valid evidence rules hold, evidence belongs to that track, performedAt matches its saved date, and revision is greater than its saved revision
  then
    keep the existing input identity as input and replace its revision, signal, fresh, gateMet, and attribution
    returns input

adjust(learner: Learner, subject: Subject, definition: Definition, value: Number, reason: String) : returns (adjustment: Adjustment)
  where no matching track exists
  then
    refuses ADJUSTMENT_TRACK_UNAVAILABLE "Choose a skill version with a starting estimate."
  where a matching track exists and (value is not a valid score or reason is blank)
  then
    refuses INVALID_MASTERY_ADJUSTMENT "Enter a value from 0 to 100 and explain the adjustment."
  where a matching track exists, value is a valid score, and reason is not blank
  then
    append a new adjustment with the matching track, value, reason, and at now
    returns adjustment
```

## Queries

```queries
_tracks(learner: Learner, subject: Subject) : many (track: Track, definition: Definition, initialConfidence: Number, startingBasis: StartingBasis, initializedAt: DateTime)
  Returns the learner's tracks for the subject across all requirements versions, ordered by initializedAt and then track identity. Returns no rows when none match.

_track(learner: Learner, subject: Subject, definition: Definition) : optional (track: Track, initialConfidence: Number, startingBasis: StartingBasis, initializedAt: DateTime)
  Returns the matching track and its starting values. Returns no row when no matching track exists.

_inputs(track: Track) : many (input: Input, evidence: Evidence, revision: Number, performedAt: DateTime, signal: Signal, fresh: Flag, gateMet: Flag, attribution: String)
  Returns the current effective input for each attempt on the track, including inputs that have no direct scoring effect. Orders rows by performedAt and then stable Evidence identity. Returns no rows for an unknown track or one without evidence. Earlier judgment revisions belong to the evidence source, not this input list.

_adjustments(track: Track) : many (adjustment: Adjustment, value: Number, reason: String, at: DateTime)
  Returns the track's manual adjustments in append order. Returns no rows for an unknown track or one without adjustments.

_estimate(learner: Learner, subject: Subject, definition: Definition, at: DateTime) : optional (value: Number, basis: String, ready: Flag)
  Returns no row if the track is absent or at precedes initializedAt. Otherwise applies the replay rules through at and returns m as value, a short explanation as basis, and prerequisite readiness as ready. The explanation identifies a provisional starting basis when applicable and the evidence, assistance, adjustments, and time decay that affect the estimate. The value is unrounded.

_explanation(learner: Learner, subject: Subject, definition: Definition, at: DateTime) : optional (explanation: EstimateExplanation)
  Returns the detailed replay used by _estimate for the same inputs, including reasons for ignored evidence and the readiness decision. Returns no row if the track is absent or at precedes initializedAt. The computation uses the current effective revisions even when at is in the past.
```
