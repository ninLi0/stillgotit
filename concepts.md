# StillGotIt: concept design

## Scope and notation

The first version supports one course per learner. It accepts source documents, voice, text, and photos. Sign-in uses a standard authentication service.

These specifications follow the course's [standard form](https://61040.github.io/fa26/background/specifying-concepts/) and [state notation](https://61040.github.io/fa26/background/specifying-concept-state/).

- Generic types identify external objects. A concept cannot read their fields.
- Structured inputs are immutable values: stored copies that cannot change.
- `now` is server time. New identities are unique. Unmentioned state stays unchanged.
- An action occurs only when its preconditions hold. Scores stay between 0 and 100.
- AI, speech, and document services supply inputs through actions. Service failures preserve existing records and allow retry.

## 1. SkillMapping [User, Material]

**Purpose:** Store a confirmed map of skills and keep their identities stable as material changes.

**Operational principle:** A learner creates a course and units. They edit and confirm proposed skills, then connect prerequisites. More material can attach to an existing skill. Archiving removes a skill from active study but keeps its history.

```text
concept SkillMapping [User, Material]

state
  a set of Courses with
    an owner User
    a title String
  a set of Units with
    a course Course
    a title String
  a set of Skills with
    a unit Unit
    a title String
    an outcome String
    a gate String
    a materials set of Materials
    a prerequisites set of Skills
    a status DRAFT or CONFIRMED or ARCHIVED
  Rule: each unit's course and each skill's unit exist.
  Rule: prerequisites are skills in the same course; there are no
    self-dependencies or cycles. A CONFIRMED skill has only confirmed
    prerequisites.
  Rule: a confirmed or archived skill's outcome and gate are immutable.

actions
  createCourse(owner: User, title: String) : return (course: Course)
    where title is nonempty
    then create course with owner and title

  addUnit(owner: User, course: Course, title: String) : return (unit: Unit)
    where course belongs to owner and title is nonempty
    then create unit for course with title

  propose(owner: User, unit: Unit, title: String, outcome: String,
    gate: String, materials: set of Materials) : return (skill: Skill)
    where unit's course belongs to owner; title, outcome, and gate are nonempty
    then create skill with those values, no prerequisites, and status DRAFT

  reviseDraft(owner: User, skill: Skill, title: String, outcome: String,
    gate: String, materials: set of Materials)
    where skill is DRAFT in owner's course and the strings are nonempty
    then replace its title, outcome, gate, and materials

  confirm(owner: User, skill: Skill)
    where skill is DRAFT in owner's course and has at least one material
    then set status to CONFIRMED

  rename(owner: User, skill: Skill, title: String)
    where skill is CONFIRMED in owner's course and title is nonempty
    then set title to title

  attachMaterial(owner: User, skill: Skill, material: Material)
    where skill is CONFIRMED in owner's course
    then add material to its materials

  setPrerequisites(owner: User, skill: Skill, prerequisites: set of Skills)
    where skill is CONFIRMED in owner's course; every proposed prerequisite
      is confirmed in that course; replacement would preserve the acyclic rule
    then replace its prerequisites

  archive(owner: User, skill: Skill)
    where skill is CONFIRMED in owner's course and no confirmed skill
      currently lists it as a prerequisite
    then set status to ARCHIVED

  restore(owner: User, skill: Skill)
    where skill is ARCHIVED in owner's course and every prerequisite
      remains confirmed
    then set status to CONFIRMED
```

A skill's `gate` defines a complete demonstration. For matrix multiplication, it requires two fresh problems solved without hints, with correct reasoning and results, plus conceptual follow-ups. Photos, voice, and text can provide the evidence.

Changing the ability or gate creates a new skill. Renaming preserves its identity. Units organize the tree; prerequisites are separate relationships.

## 2. GroundedTutoring [Learner, Scope, Topic]

**Purpose:** Teach and practice a topic using identifiable source material.

**Operational principle:** A learner adds material. The tutor uses it for an explanation or task. The learner submits work, answers follow-ups, and can request hints. Closing the task preserves its sources, criteria, conversation, and assistance record.

```text
concept GroundedTutoring [Learner, Scope, Topic]

state
  a set of Materials with
    an owner Learner
    a scope Scope
    a title String
    a locator String
    a content String
    a originals seq of MediaValues
    a origin COURSE or REFERENCE
  a set of Lessons with
    an owner Learner
    a topic Topic
    a request String
    a explanation String
    a materials set of Materials
    a citations set of PassageRefs
  a set of Tasks with
    an owner Learner
    a topic Topic
    a question String
    a criteria String
    a materials set of Materials
    a citations set of PassageRefs
    a mode GUIDED or CHECK
    a fresh Flag
    a status OPEN or CLOSED
    a dialogue seq of DialogueTurns
    a hintRequested Flag
  Rule: PassageRef is an immutable (material, passageLocator) value;
    citations must identify passages or image regions in the selected materials.
  Rule: each lesson/task has at least one material, all owned by its owner.
  Rule: original material, lessons, and task question/criteria are immutable.
    Dialogue turns are append-only while a task is OPEN and immutable once
    appended. A CLOSED task cannot receive more turns or attachments.

actions
  addMaterial(owner: Learner, scope: Scope, title: String, locator: String,
    content: String, originals: seq of MediaValues, origin: COURSE or REFERENCE)
    : return (material: Material)
    where title and locator are nonempty; content or originals are nonempty
    then create material with those values

  explain(owner: Learner, topic: Topic, request: String, explanation: String,
    materials: set of Materials, citations: set of PassageRefs)
    : return (lesson: Lesson)
    where request and explanation are nonempty; materials are nonempty and
      owned by owner; citations are nonempty and refer to those materials
    then create lesson with those values

  prepareTask(owner: Learner, topic: Topic, question: String, criteria: String,
    materials: set of Materials, citations: set of PassageRefs,
    mode: GUIDED or CHECK, fresh: Flag) : return (task: Task)
    where question and criteria are nonempty; materials are nonempty and
      owned by owner; citations are nonempty and refer to those materials
    then create OPEN task with those values, an empty dialogue,
      and hintRequested = false

  respond(owner: Learner, task: Task, text: String,
    media: seq of MediaValues, channel: TEXT or VOICE)
    where task is OPEN and belongs to owner; text or media are nonempty
    then append a LEARNER RESPONSE turn with text, media, channel, and at = now

  askFollowup(owner: Learner, task: Task, question: String,
    channel: TEXT or VOICE)
    where task is OPEN and belongs to owner; question is nonempty and
      does not disclose correctness, a correction, or a solution method
    then append a TUTOR PROBE turn with question, no media, channel, and at = now

  clarifyInput(owner: Learner, task: Task, question: String,
    channel: TEXT or VOICE)
    where task is OPEN and belongs to owner; question is nonempty and
      clarifies the submitted input without supplying solution content
    then append a TUTOR INPUT_CLARIFICATION turn with question,
      no media, channel, and at = now

  requestHint(owner: Learner, task: Task)
    where task is OPEN and belongs to owner
    then set hintRequested = true

  giveHint(owner: Learner, task: Task, text: String, channel: TEXT or VOICE)
    where task is OPEN, belongs to owner, and text is nonempty;
      mode is GUIDED or hintRequested is true
    then append a TUTOR HINT turn with text, no media, channel, and at = now;
      set hintRequested = false

  correctTranscript(owner: Learner, task: Task, turnIndex: Number, text: String)
    where task is OPEN and belongs to owner; text is nonempty; turnIndex
      identifies a LEARNER VOICE turn in that task
    then append a LEARNER INPUT_CORRECTION turn with text and at = now,
      referring to turnIndex; preserve the original recognized text

  closeTask(owner: Learner, task: Task)
    where task is OPEN and belongs to owner
    then set its status to CLOSED
```

A `MediaValue` contains the original media reference, kind, and page order. A `DialogueTurn` contains its position, speaker, purpose, text, media, channel, time, and optional correction target. Keep original photos and transcripts. Discard raw audio after transcription. Spoken tutor turns also appear as text.

Learners can add pages or close-ups, pause voice, and switch to text. Ask for clarification when input is unclear. A transcription correction preserves the original turn. A question that reveals a method counts as a hint.

In CHECK mode, wait until submission before giving corrections. Neutral probes and input clarification are allowed. Hints require an explicit request. GUIDED mode permits active coaching.

Source edits create new material records. Citations must point to stored passages or image regions. They identify the teaching basis; they do not prove that generated content is correct.

One task can contain the full gate. The application sets `fresh` after comparison with earlier tasks and known exercises. Changed numbers alone do not establish freshness.

## 3. AssessmentReviewing [Author, Subject, Task]

**Purpose:** Revise judgments while preserving submitted work and assessment history.

**Operational principle:** A learner submits work or imports graded coursework. A judgment applies the saved criteria. Regrades and manual corrections add revisions. Only the latest revision affects the estimate; the original work and earlier judgments remain available.

```text
concept AssessmentReviewing [Author, Subject, Task]

types
  Result is INDEPENDENT or SUPPORTED or SLIP or GAP or UNCERTAIN
  Help is NONE or HINT or UNKNOWN
  Origin is AI or COURSEWORK or MANUAL
  ResponseValue is an immutable bundle of typed/recognized text, original
    media, and the ordered conversation including clarifications and hints
  ClarificationValue is an immutable explanation plus optional media
    about how to read existing submitted evidence

state
  a set of Cases with
    an author Author
    a subject Subject
    a sourceKey String
    an optional task Task
    a question String
    a criteria String
    a response ResponseValue
    a clarifications seq of ClarificationValues
    a help Help
    a fresh Flag
    a performedAt DateTime
    a imported Flag
    a originalMark String
    a originalFeedback String
    an optional pendingRegrade Number
    a nextToken Number
  a set of Judgments with
    a case Case
    a revision Number
    a result Result
    a gateMet Flag
    a rationale String
    a origin Origin
    a recordedAt DateTime
  Rule: (author, subject, sourceKey) is unique among cases.
  Rule: at most one case has any given task.
  Rule: all case fields except pendingRegrade, nextToken, and the append-only
    clarifications are immutable. Original media and the submitted conversation
    are never silently replaced by a later interpretation.
  Rule: judgments are immutable; revision numbers per case are consecutive
    starting at 1; the highest revision is effective.
  Rule: INDEPENDENT requires help NONE; gateMet also requires result
    INDEPENDENT, fresh true, and fulfillment of all saved gate criteria.

actions
  submit(author: Author, subject: Subject, sourceKey: String, task: Task,
    question: String, criteria: String, response: ResponseValue,
    help: Help, fresh: Flag, performedAt: DateTime) : return (case: Case)
    where the key/task are unused; sourceKey, question, and criteria are nonempty;
      response contains learner work in at least one modality; performedAt <= now
    then create case with these values, imported false, empty originalMark
      and originalFeedback, empty clarifications, no pendingRegrade,
      and nextToken = 1

  assess(case: Case, result: Result, gateMet: Flag, rationale: String)
    : return (judgment: Judgment)
    where case exists and has no judgment; rationale is nonempty;
      result and gateMet satisfy the rules above
    then create judgment revision 1 with origin AI and recordedAt = now

  importGraded(author: Author, subject: Subject, sourceKey: String,
    question: String, criteria: String, response: ResponseValue, help: Help,
    fresh: Flag, performedAt: DateTime, mark: String, feedback: String,
    result: Result, gateMet: Flag, rationale: String)
    : return (case: Case, judgment: Judgment)
    where the key is unused; question, criteria, mark, and rationale are nonempty;
      response contains learner work; performedAt <= now; result/gateMet
      satisfy the rules
    then create imported case with no task, these snapshots,
      empty clarifications, no pendingRegrade, and nextToken = 1
      create its revision 1 judgment, origin COURSEWORK, recordedAt = now

  requestRegrade(author: Author, case: Case, clarification?: ClarificationValue)
    : return (token: Number)
    where case belongs to author, has a judgment, and no pendingRegrade
    then append clarification if supplied (otherwise preserve clarifications);
      return nextToken; set pendingRegrade to nextToken; increment nextToken

  finishRegrade(case: Case, token: Number, result: Result,
    gateMet: Flag, rationale: String) : return (judgment: Judgment)
    where pendingRegrade = token; rationale is nonempty; rules are satisfied
    then append the next judgment revision with origin AI and recordedAt = now;
      clear pendingRegrade

  failRegrade(case: Case, token: Number)
    where pendingRegrade = token
    then clear pendingRegrade; retain the effective judgment

  overrideResult(author: Author, case: Case, result: Result,
    gateMet: Flag, rationale: String) : return (judgment: Judgment)
    where case belongs to author and has a judgment; rationale is nonempty;
      result and gateMet satisfy the rules above
    then append the next judgment revision with origin MANUAL and
      recordedAt = now; clear pendingRegrade
```

| Result | Meaning |
| --- | --- |
| INDEPENDENT | Successful work without help. |
| SUPPORTED | Successful work with assistance. |
| SLIP | A substantially correct method with a limited execution error. |
| GAP | Work shows a material gap in understanding or application. |
| UNCERTAIN | The evidence is insufficient for a useful judgment. |

Feedback must refer to the response and criteria. Use the photos, reasoning, probes, and hints together. Unreadable input leads to clarification or UNCERTAIN, not a mastery penalty. A clearer view of the same work can support a regrade. A changed solution requires a new attempt.

Confirm question-to-skill mappings before importing coursework. One question can support several skills through separate cases. Preserve the original marks and feedback. Unknown help or freshness cannot establish a full independent pass.

A manual correction cancels the pending regrade token. A late AI result cannot replace it. Failed regrades retain the earlier judgment and allow retry.

## 4. MasteryEstimating [Learner, Subject, Evidence]

**Purpose:** Estimate current mastery from time, evidence, and recorded adjustments.

**Operational principle:** Reported confidence sets a provisional estimate. Time lowers it. Assisted success restores part of it; fresh independent success can restore more. A regrade replaces the same evidence's contribution. A manual adjustment sets a new estimate that continues to change.

```text
concept MasteryEstimating [Learner, Subject, Evidence]

types
  Signal is INDEPENDENT or SUPPORTED or SLIP or GAP or UNCERTAIN

state
  a set of Tracks with
    a learner Learner
    a subject Subject
    an initialConfidence Number
    an initializedAt DateTime
  a set of Inputs with
    a track Track
    an evidence Evidence
    a revision Number
    a performedAt DateTime
    a signal Signal
    a fresh Flag
    a gateMet Flag
    a attribution String
  a seq of Adjustments with
    a track Track
    a value Number
    a reason String
    an at DateTime
  Rule: tracks have unique learner and subject; inputs have unique track
    and evidence; values/confidences are between 0 and 100.
  Rule: evidence identity and performedAt do not change on replacement.
  Rule: adjustments are immutable. Inputs retain only the effective revision;
    this concept does not own the underlying assessment history.

actions
  initialize(learner: Learner, subject: Subject, confidence: Number)
    where no track exists for this pair and 0 <= confidence <= 100
    then create track with confidence and initializedAt = now

  acceptEvidence(learner: Learner, subject: Subject, evidence: Evidence,
    revision: Number, performedAt: DateTime, signal: Signal,
    fresh: Flag, gateMet: Flag, attribution: String)
    where track exists; revision is a positive integer; performedAt <= now;
      attribution is nonempty; this evidence is new or revision exceeds the
      stored revision and performedAt is unchanged; gateMet implies
      signal INDEPENDENT and fresh true
    then insert or replace that evidence's input with the supplied values

  adjust(learner: Learner, subject: Subject, value: Number, reason: String)
    where track exists, 0 <= value <= 100, and reason is nonempty
    then append an adjustment with value, reason, and at = now

queries
  _estimate(learner: Learner, subject: Subject, at: DateTime)
    : optional (value: Number, basis: String, ready: Flag,
      lastGateAt: optional DateTime)
    If no track exists or at < initializedAt, return no result.
    Otherwise replay the effective evidence and adjustments up to at
    using the policy below, and return the estimate, its basis, readiness
    as defined below, and the latest gateMet event time if any.
    This query never changes state.
```

### Estimation rules

These are initial product parameters. They have not been validated as measures of human mastery.

Let `m` be the estimate and `r` the recovery reference. Both start at reported confidence. Use one effective revision per evidence record. Process evidence by performance time, even when uploaded later. Start at the earlier of initialization or the first informative evidence date, using confidence as the starting value. Order simultaneous evidence by stable identity. Apply manual adjustments after evidence at the same time.

| Event | Effect |
| --- | --- |
| Time passes | Set `m = m × 2^(-elapsedDays / 60)`. Keep `r` unchanged. |
| Fresh INDEPENDENT | Set `m = max(m, r, 80)`, or use 95 for a full gate. Then set `r = m`. |
| Successful reused task | No numerical gain or restored readiness. |
| SUPPORTED with `m < r` | Restore half the gap: `m = m + (r - m) / 2`. |
| Other SUPPORTED | Add 5 points up to 79. Do not reduce a higher value. Keep `r` unchanged. |
| SLIP | Subtract 5 percentage points. |
| GAP | Subtract 20 percentage points. |
| UNCERTAIN | No effect and no reset of time decay. |
| Manual adjustment | Set `m` and `r` to the chosen value. Label it “Manually adjusted.” |

Keep values within 0–100. Round only for display. An old exam ages from its performance date. Regrading it replaces its contribution and preserves later manual adjustments.

`lastGateAt` records the latest completed gate. A chosen percentage cannot create that evidence. Prerequisite `ready` requires all three conditions:

1. The latest informative evidence is fresh INDEPENDENT work.
2. That work was performed within 14 days.
3. The current estimate is at least 70.

A later GAP, SLIP, or SUPPORTED result requires another independent success. The 70-point threshold lets an 80-point check remain useful after some decay.

## 5. StudyPlanning [Learner, Scope, Subject]

**Purpose:** Fit study activities into available time and show what cannot fit.

**Operational principle:** A learner supplies exam dates, priorities, and a daily budget. The plan changes with progress or missed work. Exam preparation gets priority when time is short. New cuts to exam preparation need learner confirmation before the replacement plan becomes active.

```text
concept StudyPlanning [Learner, Scope, Subject]

state
  a set of Preferences with
    a learner Learner
    a scope Scope
    a dailyMinutes Number
    a focusNote String
    a approvedExamCuts seq of CutValues
  a set of Exams with
    a preferences Preferences
    a date Date
    a covered set of Subjects
  a set of Plans with
    a preferences Preferences
    a createdAt DateTime
    a status PROPOSED or ACTIVE or SUPERSEDED or DECLINED
    a basis String
    a needsConfirmation Flag
    a examCuts seq of CutValues
    an optional confirmedAt DateTime
    a horizonEnd Date
    a explanation String
    an optional focusExam Exam
    a estimatedExamMinutes Number
    a availableExamMinutes Number
    an examUrgent Flag
    a deferred seq of Candidates
    a deferredMinutes Number
  a set of Items with
    a plan Plan
    a subject Subject
    a candidateKey String
    a activity String
    a day Date
    a estimatedMinutes Number
    a reason String
    a status TODO or IN_PROGRESS or DONE or MISSED or REPLACED
    an actualMinutes Number
    an optional spentOn Date
  Rule: preferences have unique learner and scope.
  Rule: each preferences record has at most one ACTIVE and one PROPOSED
    plan. Only ACTIVE plan items may begin. Proposing never replaces the
    active plan or changes its items. Activation changes only earlier TODO
    items, preserving all completed or missed activity history.
  Rule: a plan requiring confirmation cannot become ACTIVE without
    confirmTradeoffs; the exact approved omissions are retained.
  Rule: each item has positive estimatedMinutes and nonnegative actualMinutes.
  Rule: at most one item per learner can be IN_PROGRESS.

actions
  configure(learner: Learner, scope: Scope, dailyMinutes: Number,
    focusNote: String)
    where dailyMinutes is an integer between 0 and 1440
    then create or update the matching preferences with these values;
      a new preferences record starts with no approvedExamCuts

  setExam(learner: Learner, scope: Scope, date: Date, covered: set of Subjects)
    where preferences exist, date >= today, and covered is nonempty
    then create or replace that preferences/date exam with covered

  removeExam(learner: Learner, scope: Scope, date: Date)
    where that exam exists
    then remove it

  replan(learner: Learner, scope: Scope, candidates: seq of Candidate,
    horizonEnd: Date, explanation: String, basis: String) : return (plan: Plan)
    where preferences exist, horizonEnd >= today, explanation/basis are nonempty,
      candidate keys are unique, all durations are positive, the input includes
      all estimated unfinished preparation for the nearest upcoming exam,
      the plan horizon includes all study days before that exam, and no item
      for these preferences is IN_PROGRESS
    then mark any prior PROPOSED plan SUPERSEDED;
      compute and store focusExam, estimatedExamMinutes, availableExamMinutes,
      and examUrgent using the rule below;
      create a PROPOSED plan and TODO items using allocation below,
      actualMinutes = 0 and no spentOn; store each candidate key and basis;
      record the explanation, unscheduled candidates as deferred, and
      their total minutes as deferredMinutes;
      record proposed exam omissions in examCuts;
      set needsConfirmation when these include new or enlarged omissions
      beyond approvedExamCuts; leave confirmedAt absent

  activateRoutine(learner: Learner, plan: Plan)
    where plan belongs to learner, is PROPOSED, does not need confirmation,
      and no item for its preferences is IN_PROGRESS
    then activate plan using the activation effects below

  confirmTradeoffs(learner: Learner, plan: Plan)
    where plan belongs to learner, is PROPOSED, needs confirmation,
      and no item for its preferences is IN_PROGRESS
    then set confirmedAt = now;
      activate plan using the activation effects below

  declineTradeoffs(learner: Learner, plan: Plan)
    where plan belongs to learner and is PROPOSED
    then set its status to DECLINED; leave the active plan unchanged

  begin(learner: Learner, item: Item)
    where item belongs to learner, is TODO in the current plan with day = today,
      and no item for learner is IN_PROGRESS
    then set item to IN_PROGRESS

  finish(learner: Learner, item: Item, actualMinutes: Number)
    where item belongs to learner and is IN_PROGRESS; actualMinutes >= 0
    then set item to DONE and record actualMinutes and spentOn = today

  miss(learner: Learner, item: Item)
    where item belongs to learner and is TODO with day <= today
    then set item to MISSED

  stop(learner: Learner, item: Item, actualMinutes: Number)
    where item belongs to learner and is IN_PROGRESS; actualMinutes >= 0
    then set item to MISSED and record actualMinutes and spentOn = today
```

### Plan rules

**Activation:** Set the old active plan to SUPERSEDED. Mark its overdue TODO items MISSED and its remaining TODO items REPLACED. Set the selected plan ACTIVE. Copy its exam cuts to `approvedExamCuts`. Preserve completed work and time records.

A `CutValue` records the exam, date, activity key, omitted scope and minutes, reason, and expected consequence. A new or larger omission needs confirmation. Routine timing changes and previously approved cuts do not. Clearing all cuts also clears the approval record. Removing work from the input or understating its duration cannot bypass confirmation.

The `basis` identifies the planning inputs. Reactions check that those inputs are still current before activation. A changed budget, exam, priority, or evidence record requires a current proposal.

A `Candidate` is `(key, subject, activity, minutes, priority, earliestDay, latestDay, reason)`. AI proposes activities, priorities, and durations. The planner applies these rules:

1. Visit dates from today through the plan horizon.
2. Subtract recorded study time from that day's budget. Count DONE and stopped items across plans. Available time cannot fall below zero.
3. Exclude completed candidate keys. Consider other candidates within their allowed dates, by descending priority and then stable key.
4. Schedule each candidate once, on the first day where it fits. Show unscheduled work and its duration. Split an oversized activity through a new proposal; do not silently shorten it.

### Exam urgency

For the nearest exam, compare all unfinished preparation `W` with remaining study capacity `C`. Include prerequisites and repair work before deferring anything. Urgent mode is `W > C`. With no exam, both are zero and urgent mode is false.

In urgent mode, reserve time before the exam for covered subjects and their prerequisites. Defer unrelated maintenance. If exam work still cannot fit, explain the proposed cuts and ask for confirmation. A pending proposal leaves the active plan unchanged, with its shortfall visible. On first setup, cuts must be confirmed before any plan activates.

A current proposal can report urgency before approval. Skipping a prerequisite check does not remove its estimated work or create readiness evidence. Recompute urgency after progress, missed work, or changed inputs. Flag incomplete workload estimates instead of treating missing work as zero.

Without an exam time, count only days before its date. Ask the learner to accept or edit a suggested 30-minute budget during setup. A zero budget schedules nothing. Record actual time even after a wrong answer or stopped session. Missing work adds no score penalty beyond time decay. Charge sessions crossing midnight to their completion date. Replan overdue items before starting them.

## Essential reactions

`Requesting` is the authenticated request boundary. It derives `actor` from sign-in, not from browser input. `AI` represents generation and grading services; `Clock` supplies date events. These are service boundaries, not extra product concepts. Browser requests cannot directly invoke internal actions or AI callbacks.

### Confirm skills and initialize estimates

```text
when Requesting.confirmSkill(actor, skill)
where SkillMapping: skill is DRAFT in actor's course
and GroundedTutoring: every material linked to skill belongs to actor
  and has scope = skill's course
then SkillMapping.confirm(actor, skill)

when Requesting.setInitialConfidence(actor, skill, confidence)
where SkillMapping: skill is CONFIRMED in actor's course
then MasteryEstimating.initialize(actor, skill, confidence)
```

Apply the same owner and course checks to edits, sources, teaching, and read views. Check media access before passing stored references. The first version accepts only one course per learner. Prefer supplied course material; if none exists, finish reference selection before teaching. Confirmed skills without confidence show “Not assessed.”

### Teach from the selected sources

```text
when AI.lessonReady(request, explanation, citations)
where Requesting: request was authenticated for actor and confirmed skill;
  selectedMaterials and originalQuestion belong to that request
and SkillMapping: skill remains CONFIRMED in actor's course
and GroundedTutoring: selectedMaterials are stored in actor's course
then GroundedTutoring.explain(actor, skill, originalQuestion,
  explanation, selectedMaterials, citations)
```

### Check prerequisites

```text
when Requesting.preparePractice(actor, skill, mode)
where SkillMapping: skill is CONFIRMED in actor's course;
  prerequisiteSkills are skill's transitive prerequisites
and MasteryEstimating: _estimate(actor, prerequisite, now).ready is true
  for every prerequisite
then AI.preparePractice(actor, skill, mode, stored materials and gate)

when Requesting.preparePractice(actor, skill, mode)
where SkillMapping: skill is CONFIRMED in actor's course
and some prerequisite lacks the readiness condition above
and StudyPlanning: the latest plan with a current input basis has examUrgent
  true (whether PROPOSED or ACTIVE), and skill is covered by its focusExam
and Requesting: actor explicitly chose to skip the offered prerequisite check
then AI.preparePractice(actor, skill, mode, stored materials and gate)
```

When time is sufficient, missing readiness blocks dependent practice. Lessons remain available. A short prerequisite check uses one fresh problem and a brief explanation. Save those criteria with the task. A success is INDEPENDENT; set `gateMet` only if the full gate was completed. Skills without prerequisites pass automatically.

In urgent mode, an explicit skip allows exam-relevant practice without raising mastery. Before `AI.taskReady` invokes `prepareTask`, check the request, sources, criteria, and freshness. Complete the request once. Discard duplicate results and results for archived skills.

### Plan recovery and later reviews

After SUPPORTED work, offer a fresh unaided problem now and a review candidate for the next day. After the first independent success, start with a one-day interval. Consecutive successful reviews on later days increase it to three, then seven days. GAP or SLIP returns it to one day. Same-session recovery does not extend this sequence. The application derives eligibility dates from the evidence history. Budget and exam limits still apply.

### Record voice and photos

Route each learner contribution to `respond` after ownership and media checks. Route tutor turns to `askFollowup`, `clarifyInput`, or `giveHint`. CHECK hints require `requestHint` first. A transcription question alone does not request help with the solution. Show spoken output as text. Closed tasks reject late callbacks.

### Submit the complete attempt

Combine stored dialogue and media into one response. Recorded hints or declared outside help set help to HINT. Neutral probes do not. Unknown help stays UNKNOWN. Finish pending uploads and transcription, or ask the learner to exclude them, before submission.

```text
when Requesting.submitWork(actor, task, outsideHelp)
where GroundedTutoring: task is OPEN, belongs to actor;
  topic, question, criteria, fresh, and dialogue are read from task;
  response is the frozen ResponseValue built from the stored dialogue/media
and SkillMapping: topic is CONFIRMED in actor's course
then AssessmentReviewing.submit(actor, topic, task identity as sourceKey,
  task, question, criteria, response, combinedHelp, fresh, now)
  : return (case)

when AssessmentReviewing.submit(author, subject, sourceKey, task,
  question, criteria, response, help, fresh, performedAt) : return (case)
then GroundedTutoring.closeTask(author, task)

when AssessmentReviewing.submit(...) : return (case)
then AI.assess(case, stored question, criteria, complete response bundle,
  original images, and source context)
```

A grading service failure leaves the case pending for retry. A completed grading response invokes `assess`. Task uniqueness prevents duplicate cases.

### Apply the effective judgment once

```text
when AssessmentReviewing.assess(case, result, gateMet, rationale)
  : return (judgment)
where AssessmentReviewing: judgment is the effective revision for case;
  author, subject, performedAt, fresh, and revision are read from saved state
and MasteryEstimating: a track exists for author and subject
then MasteryEstimating.acceptEvidence(author, subject, case, revision,
  performedAt, result, fresh, gateMet, judgment origin and rationale)
```

Use the same rule for `importGraded`, `finishRegrade`, and `overrideResult`. A newer revision replaces the earlier contribution. On track initialization, load any existing reviewed cases with their original performance dates.

Import coursework only after the learner confirms extracted work, marks, and skill mappings. A total grade without supporting work remains unallocated.

### Keep mastery adjustments separate

```text
when Requesting.adjustMastery(actor, skill, value, reason)
where SkillMapping: skill belongs to actor's course
then MasteryEstimating.adjust(actor, skill, value, reason)
```

Regrades and result corrections go through AssessmentReviewing. Adjusting mastery creates no successful attempt or completed gate.

### Refresh and activate plans

Request new candidates after evidence, budget, exam, activity, or date changes. Give AI the current skills, estimates, prerequisites, deadlines, and time budget. Route `AI.planReady` to `replan` only if those inputs remain current and no activity is in progress. Otherwise regenerate after the change or activity ends.

```text
when Requesting.confirmExamTradeoffs(actor, plan)
where StudyPlanning: plan belongs to actor, is PROPOSED, needsConfirmation;
  its basis matches the application's current planning inputs
then StudyPlanning.confirmTradeoffs(actor, plan)

when StudyPlanning.replan(...) : return (plan)
where StudyPlanning: plan is PROPOSED and does not needConfirmation;
  its basis matches the application's current planning inputs
then StudyPlanning.activateRoutine(plan's learner, plan)
```

Declining a proposal keeps the active plan. Changing priorities or time requests another proposal. Neither accepts the old cuts. Refresh covered exam subjects when prerequisites change.

Starting an item requires ownership and the practice prerequisite checks. A submitted assessment activity can record elapsed time while grading is pending. Both completion and the later judgment may refresh the plan; neither adds an extra assessment.

## How the concepts work together

The map defines the skill. Tutoring supplies lessons and tasks. Assessment judges work. Mastery estimates current ability. Planning allocates time. Reactions connect them; each concept reads only its own state. The tree combines their records in one view.

`User`, `Learner`, and `Author` are authenticated users. Bind `SkillMapping.Material` to `GroundedTutoring.Material`. Bind tutoring and planning `Scope` to `SkillMapping.Course`. Bind tutoring `Topic` and all `Subject` parameters to `SkillMapping.Skill`. Bind assessment `Task` to `GroundedTutoring.Task`, and mastery `Evidence` to `AssessmentReviewing.Case`.

## Initial policies and implementation scope

The numerical rules above are starting parameters for testing. Build one complete path first: source material, confirmed skill, photographed work, spoken follow-up, assessment, estimate, and next activity.

The first version excludes cross-course planning, continuous video, a peer-review inbox, and automatic university-system integration. Test source selection, photo interpretation, voice usability, and whether learners understand estimates and assistance records.
