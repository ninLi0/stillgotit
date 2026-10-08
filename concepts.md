# StillGotIt: concept design

## Scope and notation

The first version supports one course per learner. It accepts source documents, voice, text, and photos.

The specifications use the course's [standard form](https://61040.github.io/fa26/background/specifying-concepts/) and [state notation](https://61040.github.io/fa26/background/specifying-concept-state/). Generic types identify external objects; a concept cannot read their fields. Structured values are saved copies. New identities are unique. Unmentioned state stays unchanged. `now` is server time.

## 1. SkillMapping [User, Material]

**Purpose:** Help learners identify what to learn and what counts as a successful demonstration.

**Operational principle:** A learner edits and confirms proposed skills. Later, they change a skill's requirements. The skill keeps its identity, while earlier requirements remain available for judging earlier work.

```text
concept SkillMapping [User, Material]

types
  SkillStatus is DRAFT or CONFIRMED or ARCHIVED

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
    a materials set of Materials
    a prerequisites set of Skills
    a current Version
    a status SkillStatus
  a set of Versions with
    a skill Skill
    an outcome String
    a gate String
  Rule: each unit belongs to an existing course.
  Rule: each skill belongs to an existing unit; its current version belongs
    to that skill. Versions are immutable.
  Rule: prerequisites are confirmed skills in the same course, with no
    self-dependencies or cycles. Archived skills may retain older links.

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
    then create DRAFT skill and its current version from these values,
      with no prerequisites

  reviseDraft(owner: User, skill: Skill, unit: Unit, title: String,
    outcome: String, gate: String, materials: set of Materials)
    where skill is DRAFT in owner's course; unit is in that course;
      title, outcome, and gate are nonempty
    then replace unit, title, and materials; if outcome or gate changed,
      create a version with those values and make it current

  discardDraft(owner: User, skill: Skill)
    where skill is DRAFT in owner's course
    then remove skill and its versions

  confirm(owner: User, skill: Skill)
    where skill is DRAFT in owner's course and has at least one material
    then set status to CONFIRMED

  editDetails(owner: User, skill: Skill, unit: Unit, title: String)
    where skill is CONFIRMED in owner's course; unit is in that course;
      title is nonempty
    then replace unit and title

  reviseDefinition(owner: User, skill: Skill, outcome: String, gate: String)
    : return (previous: Version, version: Version)
    where skill is CONFIRMED in owner's course; outcome and gate are nonempty
      and at least one differs from the current version
    then return the current version as previous; create version with skill,
      outcome, and gate; make it current

  attachMaterial(owner: User, skill: Skill, material: Material)
    where skill is CONFIRMED in owner's course
    then add material to its materials

  setPrerequisites(owner: User, skill: Skill, prerequisites: set of Skills)
    where skill is CONFIRMED in owner's course; replacement preserves
      the prerequisite rules
    then replace its prerequisites

  archive(owner: User, skill: Skill)
    where skill is CONFIRMED in owner's course and no confirmed skill
      lists it as a prerequisite
    then set status to ARCHIVED

  restore(owner: User, skill: Skill)
    where skill is ARCHIVED in owner's course; restoring it preserves
      the prerequisite rules
    then set status to CONFIRMED
```

A **gate** is the complete demonstration required for a skill. For matrix multiplication, it requires two fresh problems, correct reasoning and results, and conceptual follow-ups, all without hints.

Changing requirements creates a new version, not another skill or leaf. New tasks use the current version. Existing tasks keep their saved requirements. Renaming, moving a skill, or adding sources does not change its version. Units group the tree; prerequisites describe dependencies.

## 2. GroundedTutoring [Learner, Scope, Topic, Definition]

**Purpose:** Help learners understand and practice a topic using sources they can inspect.

**Operational principle:** A learner selects material, asks questions, and practices. The tutor explains from those sources and records assistance. The saved conversation lets the learner inspect how they reached an answer.

```text
concept GroundedTutoring [Learner, Scope, Topic, Definition]

types
  MaterialOrigin is COURSE or REFERENCE
  Mode is GUIDED or CHECK
  SessionStatus is OPEN or CLOSED
  Channel is TEXT or VOICE
  PassageRef is an immutable (material, passageLocator) value
  MediaValue records an original image/document reference, kind, and page order
  DialogueTurn records speaker, purpose, text, media, channel, citations,
    time, and an optional correction target

state
  a set of Materials with
    an owner Learner
    a scope Scope
    a title String
    a locator String
    a content String
    an originals seq of MediaValues
    an origin MaterialOrigin
  a set of Sessions with
    an owner Learner
    a topic Topic
    a definition Definition
    a materials set of Materials
    a citations set of PassageRefs
    a dialogue seq of DialogueTurns
    a checkedVoiceTurns set of Numbers
    a status SessionStatus
  a lessons set of Sessions with
    a request String
    an explanation String
  a tasks set of Sessions with
    a question String
    a criteria String
    a mode Mode
    a fresh Flag
    a hintRequested Flag
  alias Lesson for lessons
  alias Task for tasks
  Rule: each session is exactly one lesson or task.
  Rule: session materials are nonempty and owned by its owner. Citations
    identify passages or image regions in those materials.
  Rule: sources, session definitions, and opening content are immutable.
    Dialogue is append-only while OPEN. CLOSED sessions cannot change.

actions
  addMaterial(owner: Learner, scope: Scope, title: String, locator: String,
    content: String, originals: seq of MediaValues, origin: MaterialOrigin)
    : return (material: Material)
    where title and locator are nonempty; content or originals are nonempty
    then create material with these values

  explain(owner: Learner, topic: Topic, definition: Definition,
    request: String, explanation: String, materials: set of Materials,
    citations: set of PassageRefs) : return (lesson: Lesson)
    where request and explanation are nonempty; source rules hold
      and citations are nonempty
    then create OPEN lesson with these values and empty dialogue
      and checkedVoiceTurns

  prepareTask(owner: Learner, topic: Topic, definition: Definition,
    question: String, criteria: String, materials: set of Materials,
    citations: set of PassageRefs, mode: Mode, fresh: Flag)
    : return (task: Task)
    where question and criteria are nonempty; source rules hold
      and citations are nonempty
    then create OPEN task with these values, empty dialogue and
      checkedVoiceTurns, and hintRequested = false

  respond(owner: Learner, session: Session, text: String,
    media: seq of MediaValues, channel: Channel)
    where session is OPEN and belongs to owner; text or media are nonempty
    then append a learner response with these values and time now

  answerLesson(owner: Learner, lesson: Lesson, text: String,
    citations: set of PassageRefs, channel: Channel)
    where lesson is OPEN and belongs to owner; text and citations are
      nonempty; citations refer to its materials
    then append a tutor explanation with these values and time now

  askFollowup(owner: Learner, task: Task, question: String, channel: Channel)
    where task is OPEN and belongs to owner; question is nonempty and
      supplies no correctness feedback, correction, or solution method
    then append a tutor probe with question, channel, and time now

  clarifyInput(owner: Learner, session: Session, question: String,
    channel: Channel)
    where session is OPEN and belongs to owner; question is nonempty
      and supplies no solution content
    then append a tutor input clarification with question, channel, and time now

  requestHint(owner: Learner, task: Task)
    where task is OPEN and belongs to owner
    then set hintRequested = true

  giveHint(owner: Learner, task: Task, text: String, channel: Channel)
    where task is OPEN and belongs to owner; text is nonempty;
      mode is GUIDED or hintRequested is true
    then append a tutor hint with text, channel, and time now;
      set hintRequested = false

  confirmTranscript(owner: Learner, session: Session, turnIndex: Number,
    text: String)
    where session is OPEN and belongs to owner; text is nonempty;
      turnIndex identifies a learner voice response in its dialogue
    then append an input correction if text differs from the latest
      transcript for that turn; add turnIndex to checkedVoiceTurns

  close(owner: Learner, session: Session)
    where session is OPEN and belongs to owner; every learner voice
      response has a checked transcript
    then set status to CLOSED
```

Keep original photos and recognized text. Corrections refer to the original turn. Keep raw conversational audio until the learner confirms its transcript, then delete it. Spoken tutor output also appears as text.

CHECK mode withholds corrections until submission unless the learner requests a hint. GUIDED mode permits coaching. A question that reveals a method counts as a hint. Misheard words and unclear symbols need clarification, not a score penalty.

Task criteria include both the task requirements and the full gate. A task can contain several problems and follow-up questions, so one submission can demonstrate the full gate. A fresh problem requires work the learner has not already seen solved. It can use the same method. Changing numbers alone does not prove freshness. Source edits create new material records. Citations identify the basis of teaching; they do not prove correctness.

## 3. AssessmentReviewing [Author, Subject, Definition, Task]

**Purpose:** Give learners an assessment they can inspect and correct without losing the original work.

**Operational principle:** A learner submits work or imports graded coursework. They inspect the judgment and request a regrade or make a correction. The new judgment replaces the earlier judgment's effect while both remain available.

```text
concept AssessmentReviewing [Author, Subject, Definition, Task]

types
  Result is INDEPENDENT or SUPPORTED or SLIP or GAP or UNCERTAIN
  Help is NONE or HINT or UNKNOWN
  Origin is AI or MANUAL
  ResponseValue contains text, original photos, and the ordered conversation
  ClarificationValue contains text and optional media about existing work

state
  a set of Cases with
    an author Author
    a subject Subject
    a definition Definition
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
  a set of Judgments with
    a case Case
    a revision Number
    a result Result
    a gateMet Flag
    a rationale String
    an origin Origin
    a recordedAt DateTime
  Rule: (author, subject, sourceKey) is unique; each task has at most one case.
  Rule: case fields are immutable except append-only clarifications.
  Rule: judgments are immutable, with consecutive revisions starting at 1.
    The highest revision is effective.
  Rule: INDEPENDENT requires help NONE. gateMet requires INDEPENDENT,
    fresh work, and fulfillment of the complete saved gate.

actions
  submit(author: Author, subject: Subject, definition: Definition,
    sourceKey: String, task: Task, question: String, criteria: String,
    response: ResponseValue, help: Help, fresh: Flag, performedAt: DateTime)
    : return (case: Case)
    where key and task are unused; sourceKey, question, and criteria are
      nonempty; response contains work; performedAt <= now
    then create case with these values, imported false, empty clarifications,
      originalMark, and originalFeedback

  assess(case: Case, result: Result, gateMet: Flag, rationale: String)
    : return (judgment: Judgment)
    where case exists and has no judgment; rationale is nonempty;
      result and gateMet satisfy the rules
    then create revision 1 with these values, origin AI, and recordedAt = now

  importGraded(author: Author, subject: Subject, definition: Definition,
    sourceKey: String, question: String, criteria: String,
    response: ResponseValue, help: Help, fresh: Flag, performedAt: DateTime,
    mark: String, feedback: String, result: Result, gateMet: Flag,
    rationale: String) : return (case: Case, judgment: Judgment)
    where key is unused; sourceKey, question, criteria, mark, and rationale
      are nonempty; response contains work; performedAt <= now;
      result and gateMet satisfy the rules
    then create imported case with these values, no task, empty
      clarifications, and mark/feedback saved as the original assessment;
      create revision 1 with origin AI and recordedAt = now

  clarify(author: Author, case: Case, clarification: ClarificationValue)
    where case belongs to author; clarification concerns the same work
    then append clarification

  revise(author: Author, case: Case, basedOn: Judgment, result: Result,
    gateMet: Flag, rationale: String, origin: Origin)
    : return (judgment: Judgment)
    where case belongs to author; basedOn is its effective judgment;
      rationale is nonempty; result and gateMet satisfy the rules
    then append the next revision with these values and recordedAt = now
```

| Result | Meaning |
| --- | --- |
| INDEPENDENT | Successful work without help. |
| SUPPORTED | Successful work with assistance. |
| SLIP | A sound method with a small execution error. |
| GAP | A gap in understanding or application. |
| UNCERTAIN | Too little reliable evidence to judge. |

An instructor's mark and the app's interpretation are separate. For example, retain “8/10” as the original mark and record “SLIP” as the app's judgment. Confirm extracted work, dates, and skill versions before import. A total grade alone cannot update every skill. One question may support several skills through separate cases.

Regrades use the original requirements and work. A clearer photo can clarify that work; a changed solution needs a new attempt. A late AI regrade based on an older judgment cannot replace a manual correction. Failed regrades leave the effective judgment unchanged.

## 4. MasteryEstimating [Learner, Subject, Definition, Evidence]

**Purpose:** Help learners judge what they can still do from the evidence available.

**Operational principle:** Confidence gives a provisional estimate. Time lowers it. Assisted success restores part of a loss. Fresh independent work can restore more. Regrading replaces one contribution; a manual adjustment becomes a new starting estimate.

```text
concept MasteryEstimating [Learner, Subject, Definition, Evidence]

types
  Signal is INDEPENDENT or SUPPORTED or SLIP or GAP or UNCERTAIN
  StartingBasis is SELF_REPORTED or PREVIOUS_DEFINITION

state
  a set of Tracks with
    a learner Learner
    a subject Subject
    a definition Definition
    an initialConfidence Number
    a startingBasis StartingBasis
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
  Rule: tracks have unique learner, subject, and definition.
    Inputs have unique track and evidence.
  Rule: confidence and adjustment values are within 0–100.
    Evidence dates and track assignments cannot change on replacement.
  Rule: inputs retain only the effective revision; adjustments are immutable.

actions
  initialize(learner: Learner, subject: Subject, definition: Definition,
    confidence: Number, basis: StartingBasis)
    where no matching track exists and 0 <= confidence <= 100
    then create track with these values and initializedAt = now

  acceptEvidence(learner: Learner, subject: Subject, definition: Definition,
    evidence: Evidence, revision: Number, performedAt: DateTime,
    signal: Signal, fresh: Flag, gateMet: Flag, attribution: String)
    where matching track exists; revision is a positive integer;
      performedAt <= now; attribution is nonempty; evidence is new
      or has a higher revision with its original date and track;
      gateMet implies signal INDEPENDENT and fresh true
    then insert or replace the evidence input

  adjust(learner: Learner, subject: Subject, definition: Definition,
    value: Number, reason: String)
    where matching track exists; 0 <= value <= 100; reason is nonempty
    then append adjustment with value, reason, and at = now

queries
  _estimate(learner: Learner, subject: Subject, definition: Definition,
    at: DateTime) : optional (value: Number, basis: String, ready: Flag)
    Return no result if the track is absent or at precedes initialization.
    Otherwise replay the effective inputs and adjustments through at
    using the policy below. Return the estimate, its basis, and readiness.
    This query does not change state.
```

### Estimation rules

These numbers are initial test values, not validated measures of mastery.

Let `m` be the estimate and `r` the recovery reference. Both start at initial confidence. The supported-recovery cap `c` starts unset. Process evidence by performance date, even when imported later. Start at the earlier of initialization or the first informative evidence date. Apply simultaneous evidence by stable identity, then manual adjustments.

Apply the reused-success rule before either success rule below.

| Event | Effect |
| --- | --- |
| Time passes | `m = m × 2^(-elapsedDays / 60)`. Keep `r` and `c` unchanged. |
| Successful reused task | No gain and no restored readiness. |
| Fresh INDEPENDENT, partial check | Add up to 10 points: `m = max(m, min(max(79, r), m + 10))`. |
| Fresh INDEPENDENT, full gate | `m = max(m, 95)`. |
| Fresh SUPPORTED | Keep an existing `c`. When unset, set it to `(m + r) / 2` if `m < r`, or `max(m, min(79, m + 5))` otherwise. Set `m = max(m, c)`. |
| SLIP | Subtract 5 percentage points. |
| GAP | Subtract 20 percentage points. |
| UNCERTAIN | No change beyond time decay. |
| Manual adjustment | Set `m = r = value` and clear `c`. Continue normal updates. |

After fresh independent success, set `r = max(r, m)` and clear `c`. Bound scores to 0–100; round only for display. Regrading replaces the original contribution and replays later events, including manual adjustments.

For example, a former estimate of 90 has fallen to 50. Supported success sets a cap of 70. More hinted successes cannot raise that cap. Fresh independent work is needed for further recovery. A partial check adds limited evidence; completing the full gate can justify a high estimate.

Prerequisite readiness requires the latest informative result to be fresh INDEPENDENT work within 14 days, with an estimate of at least 70. Ignore UNCERTAIN and successful reused tasks for this test. A later SLIP, GAP, or SUPPORTED result requires a new independent success.

A revised definition gets a separate track. Use the old estimate as a provisional starting value, without copying its evidence. Keep the old version's score visible under **“Previous definition.”** Show **“Needs a new check”** for the new track until it has fresh independent evidence. Changing requirements is not a failed attempt. Regrading old work changes only its matching track.

## 5. StudyPlanning [Learner, Scope, Subject, Definition]

**Purpose:** Fit study activities into available time and show what cannot fit.

**Operational principle:** A learner sets exam dates, priorities, and a daily budget. The plan changes with progress or missed work. If exam preparation cannot fit, the learner confirms proposed cuts before the new plan takes effect.

```text
concept StudyPlanning [Learner, Scope, Subject, Definition]

types
  PlanStatus is PROPOSED or ACTIVE or SUPERSEDED or DECLINED
  ItemStatus is TODO or IN_PROGRESS or DONE or MISSED or STOPPED or REPLACED
  Candidate is (key, subject, definition, activity, minutes, priority,
    earliestDay, latestDay, reason)
  CutValue is (exam, candidateKey, omittedScope, minutes, reason, consequence)

state
  a set of Preferences with
    a learner Learner
    a scope Scope
    a dailyMinutes Number
    a focusNote String
    an approvedExamCuts seq of CutValues
  a set of Exams with
    a preferences Preferences
    a date Date
    a covered set of Subjects
    an active Flag
  a set of Plans with
    a preferences Preferences
    a status PlanStatus
    a basis String
    a horizonEnd Date
    a explanation String
    an optional focusExam Exam
    an examUrgent Flag
    an estimatedExamMinutes Number
    an availableExamMinutes Number
    a deferred seq of Candidates
    an examCuts seq of CutValues
    a needsConfirmation Flag
  a set of Items with
    a plan Plan
    a candidate Candidate
    a day Date
    a status ItemStatus
    an actualMinutes Number
    an optional spentOn Date
  Rule: preferences are unique by learner and scope, with at most one
    ACTIVE and one PROPOSED plan.
  Rule: proposing preserves the active plan. Activation preserves finished
    and stopped work, missed items, and time records.
  Rule: each learner has at most one IN_PROGRESS item.
    Durations are positive; actual time is nonnegative.

actions
  configure(learner: Learner, scope: Scope, dailyMinutes: Number,
    focusNote: String)
    where dailyMinutes is an integer from 0 to 1440
    then create or update preferences; new preferences have no approved cuts

  setExam(learner: Learner, scope: Scope, date: Date, covered: set of Subjects)
    where preferences exist; date >= today; covered is nonempty
    then create or update that preferences/date exam and set active true

  removeExam(learner: Learner, scope: Scope, date: Date)
    where matching exam exists
    then set active false; preserve saved plans

  replan(learner: Learner, scope: Scope, candidates: seq of Candidates,
    horizonEnd: Date, explanation: String, basis: String) : return (plan: Plan)
    where preferences exist; no item for learner is IN_PROGRESS;
      horizonEnd >= today;
      explanation and basis are nonempty; keys are unique and durations
      positive; input includes all unfinished preparation for the nearest
      exam, if any, and the horizon includes all study days before it
    then supersede any prior proposal; create a PROPOSED plan using the
      allocation rules below; record urgency, capacity, deferred work,
      and exam cuts; set needsConfirmation for new or enlarged cuts;
      create scheduled TODO items with actualMinutes 0 and no spentOn

  activateRoutine(learner: Learner, plan: Plan)
    where plan belongs to learner, is PROPOSED, needs no confirmation,
      and no item for learner is IN_PROGRESS
    then activate using the rule below

  confirmTradeoffs(learner: Learner, plan: Plan)
    where plan belongs to learner, is PROPOSED, needs confirmation,
      and no item for learner is IN_PROGRESS
    then activate using the rule below

  declineTradeoffs(learner: Learner, plan: Plan)
    where plan belongs to learner and is PROPOSED
    then set status to DECLINED; preserve the active plan

  begin(learner: Learner, item: Item)
    where item belongs to learner, is TODO in an ACTIVE plan for today,
      and learner has no IN_PROGRESS item
    then set status to IN_PROGRESS

  finish(learner: Learner, item: Item, actualMinutes: Number)
    where item belongs to learner and is IN_PROGRESS; actualMinutes >= 0
    then set status to DONE; record actualMinutes and spentOn = today

  stop(learner: Learner, item: Item, actualMinutes: Number)
    where item belongs to learner and is IN_PROGRESS; actualMinutes >= 0
    then set status to STOPPED; record actualMinutes and spentOn = today

  miss(learner: Learner, item: Item)
    where item belongs to learner and is TODO with day <= today
    then set status to MISSED
```

### Plan rules

**Activation:** Supersede the old active plan. Mark its overdue TODO items MISSED and remaining TODO items REPLACED. Activate the selected plan and save its exact cuts as the approved cuts. New or enlarged cuts need confirmation; routine timing changes do not.

**Allocation:** Visit study dates in order. Subtract time already spent across all plans. Consider unfinished candidates within their allowed dates, by priority and then stable key. Schedule each once, where its full duration fits. Show deferred work and its total time. Splitting a long task requires a new proposal. A later review or changed skill version has a new candidate key.

**Exam urgency:** For the nearest active exam, compare unfinished preparation `W` with remaining capacity `C`. Include prerequisites and repair work. When `W > C`, devote the budget before the exam to its covered skills and prerequisites. Defer unrelated maintenance. If exam work still cannot fit, explain the cuts and request confirmation. Keep the active plan until approval, with its shortfall visible. Incomplete workload estimates must be flagged. Without an exam, urgency is false.

Use only days before the exam date when its time is unknown. A zero budget schedules nothing. Count time spent on wrong answers and stopped work. Missing a session adds no mastery penalty. Skipping a prerequisite check does not erase its estimated workload. Removing work from the input cannot bypass confirmation. Candidate keys prevent completed work from being scheduled again.

The `basis` identifies the inputs used for a proposal. Check that they remain current before activation. Definitions, evidence, priorities, exams, or budget changes require a current proposal.

## Essential reactions

`Requesting` represents signed-in requests; `AI` supplies generated content and judgments. Reactions check ownership and course membership before calling actions. The learner confirms sources and skills. Use their material first; select a reference before teaching if none is available.

### Confirm requirements and initialize estimates

```text
when Requesting.confirmSkill(actor, skill)
where SkillMapping: skill is DRAFT in actor's course
and GroundedTutoring: linked materials belong to actor and that course
then SkillMapping.confirm(actor, skill)

when Requesting.setInitialConfidence(actor, skill, confidence)
where SkillMapping: skill is CONFIRMED; definition is its current version
then MasteryEstimating.initialize(actor, skill, definition,
  confidence, SELF_REPORTED)

when SkillMapping.reviseDefinition(actor, skill, outcome, gate)
  : return (previous, definition)
where MasteryEstimating: _estimate(actor, skill, previous, now)
  returns an estimate with value
then MasteryEstimating.initialize(actor, skill, definition,
  value, PREVIOUS_DEFINITION)
```

Without an initial estimate, show “Not assessed.” On initialization, load any existing judgments for that version, using their original performance dates.

### Teach and prepare practice

```text
when Requesting.preparePractice(actor, skill, mode)
where SkillMapping: skill is CONFIRMED with current version definition;
  prerequisites include all direct and indirect prerequisites
and MasteryEstimating: each prerequisite's current version is ready
then AI.preparePractice(actor, skill, definition, mode,
  selected sources and saved gate)

when AI.taskReady(request, question, criteria, citations, fresh)
where request remains current; skill and definition still match;
  sources, criteria, and freshness have been checked
then GroundedTutoring.prepareTask(request's actor, skill, definition,
  question, criteria, selected materials, citations, request's mode, fresh)
```

Without ready prerequisites, offer a short check. Lessons remain available. If a plan or proposal based on current inputs reports exam urgency, the learner may explicitly skip the check for an exam skill. This allows practice without raising mastery. Otherwise, complete prerequisites first.

Lesson generation follows the same source and version checks, then calls `explain`. Follow-up questions and answers stay in that lesson. Once a task starts, a later definition change does not change its requirements.

### Submit work and assess it

```text
when Requesting.submitWork(actor, task, outsideHelp)
where GroundedTutoring: task is OPEN and owned by actor;
  voice transcripts are checked; uploads are complete;
  subject, definition, question, criteria, and fresh come from the task;
  response combines its saved text, original photos, and dialogue
then AssessmentReviewing.submit(actor, subject, definition,
  task identity as sourceKey, task, question, criteria, response,
  recorded and declared help, fresh, now) : return (case)

when AssessmentReviewing.submit(author, subject, definition, sourceKey,
  task, ...) : return (case)
then GroundedTutoring.close(author, task)

when AssessmentReviewing.submit(...) : return (case)
then AI.assess(case, saved requirements, complete work, and source context)
```

Recorded hints or declared assistance count as help. Neutral probes and input corrections do not. Unknown assistance or freshness cannot establish an independent full pass. Regrade requests send the saved work, clarifications, and effective judgment to AI. The response calls `revise` with that judgment as `basedOn`.

### Update mastery once per attempt

```text
when AssessmentReviewing.assess(case, result, gateMet, rationale)
  : return (judgment)
where AssessmentReviewing: judgment is effective; case supplies author,
  subject, definition, performedAt, and fresh
and MasteryEstimating: the matching track exists
then MasteryEstimating.acceptEvidence(author, subject, definition,
  case, judgment's revision, performedAt, result, fresh, gateMet,
  judgment's origin and rationale)
```

Apply the same linkage to imported work and revised judgments. Each case contributes once to its version. Regrading old work cannot satisfy revised requirements. Manual mastery changes use `adjust`; assessment corrections use `revise`.

### Refresh the plan

Evidence, skill versions, prerequisites, dates, budget, and activity changes request a new plan. Include a new check after a definition change. Wait for an active session to finish or stop before replacing its plan.

```text
when AI.planReady(request, candidates, horizon, explanation)
where request's inputs remain current and no item for its learner
  is IN_PROGRESS
then StudyPlanning.replan(request's learner, request's scope,
  candidates, horizon, explanation, request's basis) : return (plan)

when StudyPlanning.replan(...) : return (plan)
where plan needs no confirmation and its basis remains current
then StudyPlanning.activateRoutine(plan's learner, plan)

when Requesting.confirmExamTradeoffs(actor, plan)
where plan is actor's current proposal and its basis remains current
then StudyPlanning.confirmTradeoffs(actor, plan)
```

Declining preserves the active plan. Changing inputs does not approve old cuts. Before an item starts, check its skill version and prerequisites. Replan outdated items. Recording time and receiving a grade may each refresh the plan; neither creates another assessment.

After supported success, offer a fresh unaided check and a next-day review. Independent reviews on later days extend the interval from one to three, then seven days. A SLIP or GAP returns it to one day. Same-session recovery does not extend it. These are test intervals; the budget and exam priorities still apply.

## How the concepts work together

SkillMapping defines what to learn. GroundedTutoring teaches and records work. AssessmentReviewing judges that work. MasteryEstimating estimates current ability. StudyPlanning allocates time. Each concept reads only its own state; reactions connect them. The tree combines their records into one view.

Bind user types to signed-in users, `Scope` to `SkillMapping.Course`, and `Topic`/`Subject` to `SkillMapping.Skill`. Bind `Definition` to `SkillMapping.Version`. Bind mapping `Material` to `GroundedTutoring.Material`, assessment `Task` to `GroundedTutoring.Task`, and mastery `Evidence` to `AssessmentReviewing.Case`.

## Initial policies and implementation scope

Numeric settings need testing. The 10-point partial-check gain limits how much one small success can change the estimate.

Authentication, AI requests, transcription, and retries use external services. Validate callbacks, reject duplicates, and retain existing records after failures. Raw audio is temporary service input; confirmed text and original photos form the saved attempt.

Build one complete path first: source, confirmed skill, photographed work, spoken follow-up, assessment, estimate, and next activity. The first version excludes cross-course planning, continuous video, peer review, and automatic university integration. Test source selection, photo and voice input, and whether learners understand the estimates.
