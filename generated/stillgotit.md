<!-- Generated from the StillGotIt assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.2.0; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.2.0. -->

# StillGotIt — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

### AssessmentReviewing

Defined in [AssessmentReviewing](../design/concepts/AssessmentReviewing.md), line 1.

#### Actions

- `submit(author: Author, subject: Subject, definition: Definition, sourceKey: String, task: Task, question: String, criteria: String, response: ResponseValue, help: Help, fresh: Flag, performedAt: DateTime) : returns (case: Case)`
  - Refuses `INVALID_ASSESSMENT_WORK`: Provide the work, question, requirements, source key, and a valid attempt date.
  - Refuses `ASSESSMENT_SOURCE_USED`: This work already has an assessment case for this skill.
  - Refuses `ASSESSMENT_TASK_USED`: This practice task has already been submitted.
- `assess(case: Case, result: Result, gateMet: Flag, rationale: String) : returns (judgment: Judgment)`
  - Refuses `ASSESSMENT_CASE_UNAVAILABLE`: Choose an existing assessment case.
  - Refuses `ASSESSMENT_ALREADY_JUDGED`: Use a regrade to change an existing judgment.
  - Refuses `INVALID_INITIAL_JUDGMENT`: Provide an explanation and a result consistent with the saved work and assistance.
- `importGraded(author: Author, subject: Subject, definition: Definition, sourceKey: String, question: String, criteria: String, response: ResponseValue, help: Help, fresh: Flag, performedAt: DateTime, mark: String, feedback: String, result: Result, gateMet: Flag, rationale: String) : returns (case: Case, judgment: Judgment)`
  - Refuses `INVALID_GRADED_WORK`: Provide the graded work, original mark, requirements, attempt date, and assessment explanation.
  - Refuses `GRADED_SOURCE_USED`: This work already has an assessment case for this skill.
  - Refuses `INVALID_IMPORTED_JUDGMENT`: Use a result consistent with the imported work and assistance.
- `clarify(author: Author, case: Case, clarification: ClarificationValue) : returns ()`
  - Refuses `CLARIFICATION_CASE_UNAVAILABLE`: Choose one of your assessment cases.
  - Refuses `INVALID_WORK_CLARIFICATION`: Clarify the original work. Submit a new attempt for a changed solution.
- `revise(author: Author, case: Case, basedOn: Judgment, result: Result, gateMet: Flag, rationale: String, origin: Origin) : returns (judgment: Judgment)`
  - Refuses `REVISION_CASE_UNAVAILABLE`: Choose one of your assessment cases.
  - Refuses `JUDGMENT_REVISION_OUTDATED`: Review the current judgment before submitting a revision.
  - Refuses `INVALID_REVISED_JUDGMENT`: Provide an explanation and a result consistent with the saved work and assistance.

#### Queries

- `_cases(author: Author, subject: Subject) : many (case: Case, definition: Definition, performedAt: DateTime, imported: Flag)`
- `_case(case: Case) : optional (author: Author, subject: Subject, definition: Definition, sourceKey: String, task?: Task, help: Help, fresh: Flag, performedAt: DateTime, imported: Flag)`
- `_work(case: Case) : optional (question: String, criteria: String, response: ResponseValue, originalMark: String, originalFeedback: String)`
- `_clarifications(case: Case) : many (index: Number, clarification: ClarificationValue)`
- `_judgments(case: Case) : many (judgment: Judgment, revision: Number, result: Result, gateMet: Flag, rationale: String, origin: Origin, recordedAt: DateTime)`
- `_judgment(judgment: Judgment) : optional (case: Case, revision: Number, result: Result, gateMet: Flag, rationale: String, origin: Origin, recordedAt: DateTime)`
- `_effectiveJudgment(case: Case) : optional (judgment: Judgment, revision: Number, result: Result, gateMet: Flag, rationale: String, origin: Origin, recordedAt: DateTime)`
- `_byTask(author: Author, task: Task) : optional (case: Case)`
- `_history(author: Author, subject: Subject) : one (cases: CaseRecords)`
- `_caseData(case: Case) : optional (data: CaseRecord)`

#### Instances

- `AssessmentReviewing` — instance of `AssessmentReviewing` — [P2 learning journey](../design/stages/materials.md), line 39.
  - `Author` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 40.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 42.
  - `Subject` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 41.
  - `Task` is `GroundedTutoring.Session` — [P2 learning journey](../design/stages/materials.md), line 43.

### Budgeting

Defined in [Budgeting](../design/concepts/Budgeting.md), line 1.

#### Actions

- `configure(owner: Owner, scope: Scope, dailyMinutes: Number, focusNote: String) : returns (preferences: Preferences)`
  - Refuses `INVALID_DAILY_BUDGET`: Enter a whole number of minutes from 0 to 1440.
- `setDeadline(owner: Owner, scope: Scope, date: Date, covered: SubjectSet) : returns (deadline: Deadline)`
  - Refuses `DEADLINE_PREFERENCES_UNAVAILABLE`: Set a daily budget first.
  - Refuses `INVALID_DEADLINE_DETAILS`: Choose today or a future date and at least one covered subject.
- `removeDeadline(owner: Owner, scope: Scope, date: Date) : returns (deadline: Deadline)`
  - Refuses `DEADLINE_REMOVE_UNAVAILABLE`: Choose a recorded deadline.
- `replan(owner: Owner, scope: Scope, candidates: CandidateList, horizonEnd: Date, explanation: String, basis: String, workloadComplete: Flag) : returns (plan: Plan)`
  - Refuses `PLAN_PREFERENCES_UNAVAILABLE`: Set a daily budget first.
  - Refuses `PLAN_SESSION_IN_PROGRESS`: Finish or stop the current activity before replacing the schedule.
  - Refuses `INVALID_PLAN_INPUT`: Provide valid activities, planning dates, and all known unfinished work for the nearest deadline.
- `activateRoutine(owner: Owner, plan: Plan, currentBasis: String) : returns (plan: Plan)`
  - Refuses `ROUTINE_PLAN_UNAVAILABLE`: Choose one of your proposed plans.
  - Refuses `ROUTINE_SESSION_IN_PROGRESS`: Finish or stop the current activity before changing plans.
  - Refuses `ROUTINE_PLAN_OUTDATED`: Create a new proposal from the current budget, dates, and progress.
  - Refuses `DEADLINE_TRADEOFF_CONFIRMATION_REQUIRED`: Review and confirm the proposed cuts.
- `confirmTradeoffs(owner: Owner, plan: Plan, currentBasis: String) : returns (plan: Plan)`
  - Refuses `TRADEOFF_PLAN_UNAVAILABLE`: Choose one of your proposed plans.
  - Refuses `TRADEOFF_SESSION_IN_PROGRESS`: Finish or stop the current activity before changing plans.
  - Refuses `TRADEOFF_PLAN_OUTDATED`: Review a new proposal based on the current budget, dates, and progress.
  - Refuses `TRADEOFF_CONFIRMATION_NOT_NEEDED`: This plan has no new cuts. Use routine activation.
- `declineTradeoffs(owner: Owner, plan: Plan) : returns (plan: Plan)`
  - Refuses `PLAN_DECLINE_UNAVAILABLE`: Choose one of your proposed plans.
- `begin(owner: Owner, item: Item) : returns (item: Item)`
  - Refuses `ACTIVITY_BEGIN_UNAVAILABLE`: Choose an unfinished activity from your active plan.
  - Refuses `ANOTHER_ACTIVITY_IN_PROGRESS`: Finish or stop the current activity first.
  - Refuses `ACTIVITY_NOT_SCHEDULED_TODAY`: Choose an activity scheduled for today or update the plan.
  - Refuses `ACTIVITY_EXCEEDS_REMAINING_BUDGET`: Update the plan or time budget before starting this activity.
- `finish(owner: Owner, item: Item, actualMinutes: Number) : returns (item: Item)`
  - Refuses `ACTIVITY_FINISH_UNAVAILABLE`: Choose your current activity.
  - Refuses `INVALID_FINISH_TIME`: Enter a nonnegative number of minutes spent.
- `stop(owner: Owner, item: Item, actualMinutes: Number) : returns (item: Item)`
  - Refuses `ACTIVITY_STOP_UNAVAILABLE`: Choose your current activity.
  - Refuses `INVALID_STOP_TIME`: Enter a nonnegative number of minutes spent.
- `miss(owner: Owner, item: Item) : returns (item: Item)`
  - Refuses `ACTIVITY_MISS_UNAVAILABLE`: Choose an unfinished activity from your active plan.
  - Refuses `ACTIVITY_MISS_TOO_EARLY`: Only today's or an overdue activity can be marked missed.

#### Queries

- `_preferences(owner: Owner, scope: Scope) : optional (preferences: Preferences, dailyMinutes: Number, focusNote: String)`
- `_deadlines(owner: Owner, scope: Scope) : many (deadline: Deadline, date: Date, covered: SubjectSet, active: Flag)`
- `_plans(owner: Owner, scope: Scope) : many (plan: Plan, status: PlanStatus, horizonEnd: Date, needsConfirmation: Flag)`
- `_plan(plan: Plan) : optional (owner: Owner, scope: Scope, status: PlanStatus, basis: String, inputs: PlanInputs, horizonEnd: Date, explanation: String, focusDeadline?: Deadline, urgent: Flag, workloadComplete: Flag, requiredMinutes: Number, availableMinutes: Number, scheduledMinutes: Number, deferredMinutes: Number, needsConfirmation: Flag)`
- `_items(plan: Plan) : many (item: Item, candidate: Candidate, day: Date, status: ItemStatus, actualMinutes: Number, spentOn?: Date)`
- `_next(owner: Owner, scope: Scope) : optional (item: Item, candidate: Candidate, day: Date, status: ItemStatus)`
- `_budget(owner: Owner, scope: Scope, day: Date) : optional (dailyMinutes: Number, spentMinutes: Number, remainingMinutes: Number)`
- `_deferred(plan: Plan) : many (candidate: Candidate)`
- `_cuts(plan: Plan) : many (cut: CutValue)`
- `_proposalCheck(owner: Owner, plan: Plan, currentBasis: String) : optional (locallyCurrent: Flag, contextCurrent: Flag, sessionInProgress: Flag, needsConfirmation: Flag, canActivate: Flag)`
- `_schedule(owner: Owner, scope: Scope) : one (schedule: ScheduleValue)`
- `_item(item: Item) : optional (owner: Owner, scope: Scope, item: Item, candidate: Candidate, day: String, status: ItemStatus, actualMinutes: Number, spentOn?: String)`

#### Instances

- `StudyPlanning` — instance of `Budgeting` — [P2 learning journey](../design/stages/materials.md), line 51.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 55.
  - `Owner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 52.
  - `Scope` is `SkillMapping.Course` — [P2 learning journey](../design/stages/materials.md), line 53.
  - `Subject` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 54.

### Federating

Defined in [Federating](../design/concepts/Federating.md), line 1.

#### Actions

- `start() : returns (attempt: Attempt, expiresAt: DateTime, address: String)`
- `finish(attempt: Attempt, nonce: String, code: String) : returns (username: String)`
  - Refuses `SIGN_IN_EXPIRED`: This sign-in has expired. Start again.
  - Refuses `SIGN_IN_REFUSED`: The other site didn't confirm this sign-in. Start again.
- `link(attempt: Attempt, user: User) : returns (user: User)`
  - Refuses `NOT_CONFIRMED`: This sign-in hasn't been confirmed.
  - Refuses `SIGN_IN_EXPIRED`: This sign-in has expired. Start again.
  - Refuses `ALREADY_LINKED`: This account on the other site is already linked.

#### Queries

- `_identity(attempt: Attempt) : optional (subject: String, username: String, expiresAt: DateTime)`
- `_user(attempt: Attempt) : optional (user: User)`
- `_linkable(attempt: Attempt) : one (linkable: Flag)`

#### Instances

- `CommonsFederating` — instance of `Federating` — [P2 learning journey](../design/stages/materials.md), line 19.
  - `User` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 20.

### Generating

Defined in [Generating](../design/concepts/Generating.md), line 1.

#### Actions

- `generate(owner: Owner, request: Request) : returns (answer: Answer)`
  - Refuses `GENERATION_FAILED`: The tutor could not finish. Check your connection and retry. Your saved work is still available.

#### Instances

- `TutorGenerating` — instance of `Generating` — [P2 learning journey](../design/stages/materials.md), line 57.
  - `Answer` is `TutorAnswer` — [P2 learning journey](../design/stages/materials.md), line 60.
  - `Owner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 58.
  - `Request` is `TutorRequest` — [P2 learning journey](../design/stages/materials.md), line 59.

### GroundedTutoring

Defined in [GroundedTutoring](../design/concepts/GroundedTutoring.md), line 1.

#### Actions

- `explain(owner: Learner, topic: Topic, definition: Definition, request: String, explanation: String, materials: MaterialSet, citations: PassageSet) : returns (lesson: Session)`
  - Refuses `INVALID_LESSON_CONTENT`: Provide a learning request and explanation.
  - Refuses `INVALID_LESSON_SOURCES`: Use your readable sources from one course and cite their content.
- `prepareTask(owner: Learner, topic: Topic, definition: Definition, question: String, criteria: String, materials: MaterialSet, citations: PassageSet, mode: Mode, fresh: Flag) : returns (task: Session)`
  - Refuses `INVALID_TASK_CONTENT`: Provide a practice question and its assessment requirements.
  - Refuses `INVALID_TASK_SOURCES`: Use your readable sources from one course and cite their content.
- `respond(owner: Learner, session: Session, text: String, media: MediaList, channel: Channel) : returns ()`
  - Refuses `RESPONSE_SESSION_UNAVAILABLE`: Choose one of your open sessions.
  - Refuses `INVALID_LEARNER_RESPONSE`: Provide a response. Spoken responses need a transcript.
- `answerLesson(owner: Learner, lesson: Session, text: String, citations: PassageSet, channel: Channel) : returns ()`
  - Refuses `LESSON_ANSWER_UNAVAILABLE`: Choose one of your open lessons.
  - Refuses `INVALID_LESSON_ANSWER`: Provide an explanation with references to this lesson's sources.
- `requestHint(owner: Learner, task: Session) : returns ()`
  - Refuses `HINT_REQUEST_UNAVAILABLE`: Choose one of your open practice tasks.
- `giveHint(owner: Learner, task: Session, text: String, channel: Channel) : returns ()`
  - Refuses `HINT_TASK_UNAVAILABLE`: Choose one of your open practice tasks.
  - Refuses `INVALID_HINT_TEXT`: Provide the hint text.
  - Refuses `HINT_NOT_REQUESTED`: Wait for the learner to request help during an independent check.
- `confirmTranscript(owner: Learner, session: Session, turnIndex: Number, text: String) : returns ()`
  - Refuses `TRANSCRIPT_SESSION_UNAVAILABLE`: Choose one of your open sessions.
  - Refuses `TRANSCRIPT_TURN_UNAVAILABLE`: Choose a spoken response from this session.
  - Refuses `INVALID_CONFIRMED_TRANSCRIPT`: Provide the text that was spoken.
- `confirmAttempt(owner: Learner, task: Session, dialogueLength: Number, unseen?: Flag, outsideHelp?: Flag) : returns ()`
  - Refuses `ATTEMPT_REVIEW_UNAVAILABLE`: Choose one of your open practice tasks.
  - Refuses `ATTEMPT_REVIEW_CHANGED`: The conversation changed. Review the latest transcript.
- `close(owner: Learner, session: Session) : returns ()`
  - Refuses `SESSION_CLOSE_UNAVAILABLE`: Choose one of your open sessions.

#### Queries

- `_sessions(owner: Learner, topic: Topic) : many (session: Session, definition: Definition, status: SessionStatus)`
- `_session(session: Session) : optional (owner: Learner, topic: Topic, definition: Definition, status: SessionStatus)`
- `_lesson(lesson: Session) : optional (request: String, explanation: String)`
- `_task(task: Session) : optional (question: String, criteria: String, mode: Mode, fresh: Flag, hintRequested: Flag)`
- `_sources(session: Session) : many (material: Material)`
- `_citations(session: Session) : many (citation: PassageRef)`
- `_dialogue(session: Session) : many (turnIndex: Number, turn: DialogueTurn)`
- `_voiceResponses(session: Session) : many (turnIndex: Number, text: String, confirmed: Flag)`
- `_review(task: Session) : optional (dialogueLength: Number, uncheckedVoiceCount: Number, ready: Flag)`
- `_study(owner: Learner, topic: Topic) : one (sessions: StudyRecords)`
- `_sessionData(session: Session) : optional (data: StudyRecord)`

#### Instances

- `GroundedTutoring` — instance of `GroundedTutoring` — [P2 learning journey](../design/stages/materials.md), line 33.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 37.
  - `Learner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 34.
  - `Material` is `Library.Material` — [P2 learning journey](../design/stages/materials.md), line 35.
  - `Topic` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 36.

### MasteryEstimating

Defined in [MasteryEstimating](../design/concepts/MasteryEstimating.md), line 1.

#### Actions

- `initialize(learner: Learner, subject: Subject, definition: Definition, confidence: Number, basis: StartingBasis) : returns (track: Track)`
  - Refuses `INVALID_INITIAL_CONFIDENCE`: Enter a confidence value from 0 to 100.
  - Refuses `MASTERY_TRACK_EXISTS`: This skill version already has an estimate.
- `acceptEvidence(learner: Learner, subject: Subject, definition: Definition, evidence: Evidence, revision: Number, performedAt: DateTime, signal: Signal, fresh: Flag, gateMet: Flag, attribution: String) : returns (input: Input)`
  - Refuses `EVIDENCE_TRACK_UNAVAILABLE`: Set a starting estimate for this skill version first.
  - Refuses `INVALID_MASTERY_EVIDENCE`: Provide a valid revision, attempt date, result, and assessment explanation.
  - Refuses `EVIDENCE_TRACK_MISMATCH`: Keep this attempt with its original learner, skill, and requirements version.
  - Refuses `EVIDENCE_DATE_MISMATCH`: Keep the original attempt date when applying a regrade.
  - Refuses `EVIDENCE_REVISION_NOT_NEW`: This judgment revision has already been applied or replaced.
- `adjust(learner: Learner, subject: Subject, definition: Definition, adjustmentKey: String, value: Number, reason: String) : returns (adjustment: Adjustment)`
  - Refuses `INVALID_ADJUSTMENT_KEY`: Provide a nonblank adjustment key.
  - Refuses `ADJUSTMENT_KEY_CONFLICT`: Use the original skill, value, and reason when retrying this adjustment.
  - Refuses `ADJUSTMENT_TRACK_UNAVAILABLE`: Choose a skill version with a starting estimate.
  - Refuses `INVALID_MASTERY_ADJUSTMENT`: Enter a value from 0 to 100 and explain the adjustment.

#### Queries

- `_tracks(learner: Learner, subject: Subject) : many (track: Track, definition: Definition, initialConfidence: Number, startingBasis: StartingBasis, initializedAt: DateTime)`
- `_track(learner: Learner, subject: Subject, definition: Definition) : optional (track: Track, initialConfidence: Number, startingBasis: StartingBasis, initializedAt: DateTime)`
- `_inputs(track: Track) : many (input: Input, evidence: Evidence, revision: Number, performedAt: DateTime, signal: Signal, fresh: Flag, gateMet: Flag, attribution: String)`
- `_adjustments(track: Track) : many (adjustment: Adjustment, value: Number, reason: String, at: DateTime)`
- `_estimate(learner: Learner, subject: Subject, definition: Definition, at: DateTime) : optional (value: Number, basis: String, ready: Flag)`
- `_explanation(learner: Learner, subject: Subject, definition: Definition, at: DateTime) : optional (explanation: EstimateExplanation)`
- `_progress(learner: Learner) : one (tracks: ProgressRows)`

#### Instances

- `MasteryEstimating` — instance of `MasteryEstimating` — [P2 learning journey](../design/stages/materials.md), line 45.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 48.
  - `Evidence` is `AssessmentReviewing.Case` — [P2 learning journey](../design/stages/materials.md), line 49.
  - `Learner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 46.
  - `Subject` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 47.

### MaterialKeeping

Defined in [MaterialKeeping](../design/concepts/MaterialKeeping.md), line 1.

#### Actions

- `add(owner: Owner, importKey: String, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin) : returns (material: Material)`
  - Refuses `INVALID_TUTORING_MATERIAL`: Provide a title, source location, and readable material.
  - Refuses `INVALID_MATERIAL_IMPORT_KEY`: Provide a nonblank import key.
  - Refuses `MATERIAL_IMPORT_CONFLICT`: Use the original material input for this import key.

#### Queries

- `_materials(owner: Owner, scope: Scope) : many (material: Material, title: String, locator: String, origin: MaterialOrigin)`
- `_material(material: Material) : optional (owner: Owner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin)`
- `_sourceSet(owner: Owner, scope: Scope) : one (sources: SourceRecords)`

#### Instances

- `Library` — instance of `MaterialKeeping` — [P2 learning journey](../design/stages/materials.md), line 29.
  - `Owner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 30.
  - `Scope` is `SkillMapping.Course` — [P2 learning journey](../design/stages/materials.md), line 31.

### Preferring

Defined in [Preferring](../design/concepts/Preferring.md), line 1.

#### Actions

- `set(user: User, option: Option) : returns ()`
- `clear(user: User) : returns ()`

#### Queries

- `_choice(user: User) : optional (option: Option)`

#### Instances

- `TutorPreferring` — instance of `Preferring` — [P2 learning journey](../design/stages/materials.md), line 62.
  - `Option` is `TutorChoice` — [P2 learning journey](../design/stages/materials.md), line 64.
  - `User` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 63.
- `ViewPreferring` — instance of `Preferring` — [P2 learning journey](../design/stages/materials.md), line 66.
  - `Option` is `HomeView` — [P2 learning journey](../design/stages/materials.md), line 68.
  - `User` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 67.

### Registering

Defined in [Registering](../design/concepts/Registering.md), line 1.

#### Actions

- `register(username: String, recoveryKey: String) : returns (user: User)`
  - Refuses `INVALID_USERNAME`: A username must have 3 to 32 letters, digits, underscores, or hyphens.
  - Refuses `INVALID_RECOVERY_KEY`: Provide a nonblank recovery key.
  - Refuses `RECOVERY_KEY_CONFLICT`: This recovery key already belongs to a different username.
  - Refuses `USERNAME_TAKEN`: That username is taken.

#### Queries

- `_byUsername(username: String) : optional (user: User)`
- `_username(user: User) : optional (username: String)`
- `_byRecoveryKey(recoveryKey: String) : optional (user: User)`

#### Instances

- `Registering` — instance of `Registering` — [P2 learning journey](../design/stages/materials.md), line 17.

### Sessioning

Defined in [Sessioning](../design/concepts/Sessioning.md), line 1.

#### Actions

- `start(subject: Subject) : returns (session: Session, expiresAt: DateTime)`
- `use(session: Session) : returns (subject: Subject)`
  - Refuses `NOT_SIGNED_IN`: Your session has ended. Sign in again.
- `end(session: Session) : returns (session: Session)`
  - Refuses `NOT_SIGNED_IN`: Your session has ended. Sign in again.

#### Instances

- `Sessioning` — instance of `Sessioning` — [P2 learning journey](../design/stages/materials.md), line 22.
  - `Subject` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 23.

### SkillMapping

Defined in [SkillMapping](../design/concepts/SkillMapping.md), line 1.

#### Actions

- `createCourse(owner: User, title: String) : returns (course: Course)`
  - Refuses `INVALID_COURSE_TITLE`: Enter a course title.
- `addUnit(owner: User, course: Course, title: String) : returns (unit: Unit)`
  - Refuses `UNIT_COURSE_UNAVAILABLE`: Choose one of your courses.
  - Refuses `INVALID_UNIT_TITLE`: Enter a unit title.
- `setEmphasis(owner: User, unit: Unit, emphasized: Flag) : returns ()`
  - Refuses `UNIT_EMPHASIS_UNAVAILABLE`: Choose a unit in one of your courses.
- `propose(owner: User, unit: Unit, proposalKey: String, title: String, outcome: String, gate: String, materials: MaterialSet) : returns (skill: Skill)`
  - Refuses `PROPOSAL_UNIT_UNAVAILABLE`: Choose a unit in one of your courses.
  - Refuses `INVALID_SKILL_PROPOSAL`: Enter a skill title, outcome, and demonstration requirements.
  - Refuses `INVALID_SKILL_PROPOSAL_KEY`: Provide a nonblank proposal key of at most 100 characters.
  - Refuses `SKILL_PROPOSAL_CONFLICT`: Use the original skill details when retrying this save.
  - Refuses `SKILL_PROPOSAL_DISCARDED`: This draft was discarded. Create a new proposal to save it again.
- `reviseDraft(owner: User, skill: Skill, unit: Unit, title: String, outcome: String, gate: String, materials: MaterialSet) : returns ()`
  - Refuses `DRAFT_REVISION_UNAVAILABLE`: Choose one of your draft skills.
  - Refuses `DRAFT_UNIT_MISMATCH`: Choose a unit in the skill's course.
  - Refuses `INVALID_DRAFT_CONTENT`: Enter a skill title, outcome, and demonstration requirements.
- `discardDraft(owner: User, skill: Skill) : returns ()`
  - Refuses `DRAFT_DISCARD_UNAVAILABLE`: Only your draft skills can be discarded.
- `confirm(owner: User, skill: Skill) : returns ()`
  - Refuses `SKILL_CONFIRM_UNAVAILABLE`: Choose one of your draft skills.
  - Refuses `SKILL_SOURCE_REQUIRED`: Add a source before confirming this skill.
- `editDetails(owner: User, skill: Skill, unit: Unit, title: String) : returns ()`
  - Refuses `SKILL_DETAILS_UNAVAILABLE`: Choose one of your confirmed skills.
  - Refuses `SKILL_UNIT_MISMATCH`: Choose a unit in the skill's course.
  - Refuses `INVALID_SKILL_TITLE`: Enter a skill title.
- `reviseDefinition(owner: User, skill: Skill, outcome: String, gate: String) : returns (previous: Version, version: Version)`
  - Refuses `SKILL_DEFINITION_UNAVAILABLE`: Choose one of your confirmed skills.
  - Refuses `INVALID_SKILL_DEFINITION`: Enter an outcome and demonstration requirements.
  - Refuses `SKILL_DEFINITION_UNCHANGED`: Change the outcome or requirements to create a new version.
- `attachMaterial(owner: User, skill: Skill, material: Material) : returns ()`
  - Refuses `SKILL_MATERIAL_UNAVAILABLE`: Choose one of your confirmed skills.
- `setPrerequisites(owner: User, skill: Skill, prerequisites: SkillSet) : returns ()`
  - Refuses `SKILL_PREREQUISITES_UNAVAILABLE`: Choose one of your confirmed skills.
  - Refuses `INVALID_SKILL_PREREQUISITES`: Use confirmed skills from this course, without self-dependencies or cycles.
- `archive(owner: User, skill: Skill) : returns ()`
  - Refuses `SKILL_ARCHIVE_UNAVAILABLE`: Choose one of your confirmed skills.
  - Refuses `SKILL_STILL_REQUIRED`: Remove this skill from other active skills' prerequisites first.
- `restore(owner: User, skill: Skill) : returns ()`
  - Refuses `SKILL_RESTORE_UNAVAILABLE`: Choose one of your archived skills.
  - Refuses `SKILL_RESTORE_PREREQUISITES`: Restore this skill's prerequisites before restoring the skill.

#### Queries

- `_courses(owner: User) : many (course: Course, title: String)`
- `_course(course: Course) : optional (owner: User, title: String)`
- `_units(course: Course) : many (unit: Unit, title: String, emphasized: Flag)`
- `_unit(unit: Unit) : optional (course: Course, title: String)`
- `_skills(unit: Unit) : many (skill: Skill, title: String, current: Version, status: SkillStatus)`
- `_skill(skill: Skill) : optional (unit: Unit, title: String, current: Version, status: SkillStatus)`
- `_materials(skill: Skill) : many (material: Material)`
- `_prerequisites(skill: Skill) : many (prerequisite: Skill)`
- `_versions(skill: Skill) : many (version: Version, outcome: String, gate: String)`
- `_version(version: Version) : optional (skill: Skill, outcome: String, gate: String)`
- `_map(course: Course) : one (skills: SkillMapRows)`

#### Instances

- `SkillMapping` — instance of `SkillMapping` — [P2 learning journey](../design/stages/materials.md), line 25.
  - `Material` is `Library.Material` — [P2 learning journey](../design/stages/materials.md), line 27.
  - `User` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 26.

## Application types

Concrete types:

- `HomeView` — [P2 learning journey](../design/stages/materials.md), line 12.
- `TutorAnswer` — [P2 learning journey](../design/stages/materials.md), line 8.
- `TutorChoice` — [P2 learning journey](../design/stages/materials.md), line 10.
- `TutorRequest` — [P2 learning journey](../design/stages/materials.md), line 6.

## Computations

- `attemptIsReady(data: GroundedTutoring.StudyRecord, dialogueLength: Number, reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag` — [Learning computations](../design/compositions/LearningComputations.md), line 105.
- `beginAllowed(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill, urgent: Flag) : Flag` — [Daily planning flows](../design/compositions/Planning.md), line 106.
- `carriedEstimate(tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill, current: SkillMapping.Version) : CarriedEstimate` — [Courses, materials, and skills](../design/compositions/Courses.md), line 46.
- `choiceOffered(choice: TutorChoice) : Flag` — [Settings](../design/compositions/Settings.md), line 43.
- `correctionNote(reason: String) : AttemptClarification` — [Learning computations](../design/compositions/LearningComputations.md), line 21.
- `coveredSkillsConfirmed(covered: StudyPlanning.SubjectSet, skills: SkillMapping.SkillMapRows) : Flag` — [Daily planning flows](../design/compositions/Planning.md), line 100.
- `cutKey(cut: StudyPlanning.CutValue) : String` — [Daily planning flows](../design/compositions/Planning.md), line 112.
- `defaultChoice() : TutorChoice` — [Settings](../design/compositions/Settings.md), line 31.
- `defaultHomeView() : HomeView` — [Settings](../design/compositions/Settings.md), line 147.
- `dialogueIsCurrent(data: GroundedTutoring.StudyRecord, dialogueLength: Number) : Flag` — [Learning computations](../design/compositions/LearningComputations.md), line 24.
- `estimateTimeline(explanation?: MasteryEstimating.EstimateExplanation, tracks: MasteryEstimating.ProgressRows) : EstimateTimeline` — [Learning computations](../design/compositions/LearningComputations.md), line 86.
- `evidenceAttribution(origin: AssessmentReviewing.Origin, rationale: String) : String` — [P2 learning journey](../design/stages/materials.md), line 129.
- `evidenceUpdate(data: AssessmentReviewing.CaseRecord, tracks: MasteryEstimating.ProgressRows) : EvidenceUpdate` — [Learning computations](../design/compositions/LearningComputations.md), line 27.
- `extractRequest(selected: Library.SourceRecords, skills: SkillMapping.SkillMapRows) : TutorRequest` — [Importing graded work](../design/compositions/Importing.md), line 112.
- `generationDefinition(request: TutorRequest) : GenerationDefinition` — [Learning computations](../design/compositions/LearningComputations.md), line 30.
- `generationFields(answer: TutorAnswer) : TutorAnswer` — [Learning computations](../design/compositions/LearningComputations.md), line 33.
- `gradeRequest(selected: Library.SourceRecords, data: AssessmentReviewing.CaseRecord) : TutorRequest` — [Learning computations](../design/compositions/LearningComputations.md), line 36.
- `gradedImport(material: Library.Material, originals: Library.MediaList, row: GradedRow, outsideHelp: Flag, performedAt: DateTime, skills: SkillMapping.SkillMapRows) : GradedImport` — [Importing graded work](../design/compositions/Importing.md), line 127.
- `gradedKey(material: Library.Material, row: GradedRow) : GradedKey` — [Importing graded work](../design/compositions/Importing.md), line 124.
- `gradedReview(row: GradedRow, outsideHelp: Flag, performedOn: String, at: DateTime, skills: SkillMapping.SkillMapRows) : GradedReview` — [Importing graded work](../design/compositions/Importing.md), line 121.
- `gradedSource(sourceKey: String, material: Library.Material) : Flag` — [Importing graded work](../design/compositions/Importing.md), line 130.
- `gradedTitle(title: String) : Flag` — [Importing graded work](../design/compositions/Importing.md), line 106.
- `gradedToday(at: DateTime) : String` — [Importing graded work](../design/compositions/Importing.md), line 118.
- `hasConfirmedSkill(skills: SkillMapping.SkillMapRows) : Flag` — [Importing graded work](../design/compositions/Importing.md), line 109.
- `hasGradedRows(answer: TutorAnswer) : Flag` — [Importing graded work](../design/compositions/Importing.md), line 115.
- `hasLessonQuestion(data: GroundedTutoring.StudyRecord) : Flag` — [Learning computations](../design/compositions/LearningComputations.md), line 39.
- `homeViewOffered(view: String) : Flag` — [Settings](../design/compositions/Settings.md), line 141.
- `itemOrder(day: Date, candidate: StudyPlanning.Candidate) : String` — [Daily planning flows](../design/compositions/Planning.md), line 109.
- `itemSubject(candidate: StudyPlanning.Candidate) : ItemSubject` — [Learning computations](../design/compositions/LearningComputations.md), line 42.
- `lessonRequest(selected: Library.SourceRecords, context: SkillContext, request: String) : TutorRequest` — [Learning computations](../design/compositions/LearningComputations.md), line 45.
- `levelSupported(model: String, level: String) : Flag` — [Settings](../design/compositions/Settings.md), line 37.
- `modelOffered(model: String) : Flag` — [Settings](../design/compositions/Settings.md), line 34.
- `offeredChoice(model: String, level: String) : TutorChoice` — [Settings](../design/compositions/Settings.md), line 40.
- `offeredHomeView(view: String) : HomeView` — [Settings](../design/compositions/Settings.md), line 144.
- `planDetail(schedule: StudyPlanning.ScheduleValue) : PlanDetail` — [Learning computations](../design/compositions/LearningComputations.md), line 48.
- `planRequest(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, schedule: StudyPlanning.ScheduleValue) : ReviewProposal` — [Learning computations](../design/compositions/LearningComputations.md), line 51.
- `prerequisiteSet(prerequisites: SkillList) : SkillMapping.SkillSet` — [Courses, materials, and skills](../design/compositions/Courses.md), line 55.
- `prerequisiteToPractice(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill) : PrerequisiteChoice` — [Request admission](../design/compositions/LearningAccess.md), line 33.
- `prerequisitesReady(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill) : Flag` — [Learning computations](../design/compositions/LearningComputations.md), line 56.
- `progressRows(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows) : SkillProgress` — [Learning computations](../design/compositions/LearningComputations.md), line 59.
- `requestChoice(request: TutorRequest) : TutorChoice` — [Settings](../design/compositions/Settings.md), line 86.
- `responseInput(data: GroundedTutoring.StudyRecord, text: String, channel: GroundedTutoring.Channel, attachments: AttachmentList, sources: Library.SourceRecords) : ResponseInput` — [Learning computations](../design/compositions/LearningComputations.md), line 62.
- `reviewApproved(reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag` — [Learning computations](../design/compositions/LearningComputations.md), line 65.
- `selectSkill(skills: SkillMapping.SkillMapRows, skill: SkillMapping.Skill) : SkillContext` — [Learning computations](../design/compositions/LearningComputations.md), line 68.
- `selectSkillMaterials(context: SkillContext) : GroundedTutoring.MaterialSet` — [Learning computations](../design/compositions/LearningComputations.md), line 71.
- `selectSources(sources: Library.SourceRecords, materials: GroundedTutoring.MaterialSet) : SourceSelection` — [Learning computations](../design/compositions/LearningComputations.md), line 74.
- `sessionMaterials(data: GroundedTutoring.StudyRecord) : GroundedTutoring.MaterialSet` — [Learning computations](../design/compositions/LearningComputations.md), line 77.
- `sessionRequest(selected: Library.SourceRecords, data: GroundedTutoring.StudyRecord, kind: String) : TutorRequest` — [Learning computations](../design/compositions/LearningComputations.md), line 80.
- `sessionSubject(identity: SessionIdentity) : SessionOwner` — [Learning computations](../design/compositions/LearningComputations.md), line 108.
- `singleMaterial(material: Library.Material) : SkillMapping.MaterialSet` — [P2 learning journey](../design/stages/materials.md), line 126.
- `studyDetail(context: SkillContext, tracks: MasteryEstimating.ProgressRows, sessions: GroundedTutoring.StudyRecords, cases: AssessmentReviewing.CaseRecords) : StudyDetail` — [Learning computations](../design/compositions/LearningComputations.md), line 83.
- `submissionInput(data: GroundedTutoring.StudyRecord, unseen: Flag, outsideHelp: Flag) : SubmissionInput` — [Learning computations](../design/compositions/LearningComputations.md), line 96.
- `suggestRequest(selected: Library.SourceRecords) : TutorRequest` — [Learning computations](../design/compositions/LearningComputations.md), line 99.
- `taskRequest(selected: Library.SourceRecords, context: SkillContext, sessions: GroundedTutoring.StudyRecords) : TutorRequest` — [Learning computations](../design/compositions/LearningComputations.md), line 102.
- `tutorCatalog() : TutorCatalog` — [Settings](../design/compositions/Settings.md), line 28.
- `tutorStatus(saved: Flag, offered: Flag) : String` — [Settings](../design/compositions/Settings.md), line 46.
- `urgentExamItem(schedule: StudyPlanning.ScheduleValue, candidate: StudyPlanning.Candidate) : Flag` — [Daily planning flows](../design/compositions/Planning.md), line 103.
- `withChoice(request: TutorRequest, choice: TutorChoice) : TutorRequest` — [Settings](../design/compositions/Settings.md), line 83.

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

### (owner) already imported (sourceKey) for (skill)

Authored path: `Importing.AlreadyImported`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 54.

```view
(owner) already imported (sourceKey) for (skill) — inputs (owner, skill, sourceKey); outputs (); bindings (assessment)
  where
    AssessmentReviewing._cases (author: owner, subject: skill) has (case: assessment)
    AssessmentReviewing._case (case: assessment) has (sourceKey)
```

### (owner) owns (course) with (title)

Authored path: `Courses.OwnedCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 7.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 19.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 3.
- Covered by [P2 learning journey](../design/stages/materials.md), line 97.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```view
(owner) owns (course) with (title) — inputs (owner, course); outputs (title); bindings () — answers at most one (title)
  where SkillMapping._course (course) has (owner, title)
```

### (owner) owns study skill (skill)

Authored path: `Reads.OwnedSkill`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 49.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 3.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 37.

```view
(owner) owns study skill (skill) — inputs (owner, skill); outputs (course, definition, status); bindings (unit) — answers at most one (course, definition, status)
  where
    SkillMapping._skill (skill) has (current: definition, status, unit)
    SkillMapping._unit (unit) has (course)
    view "(owner) owns (course) with (title)" with (course, owner)
```

### (owner) owns study session (studySession)

Authored path: `Reads.OwnedSession`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 3.

```view
(owner) owns study session (studySession) — inputs (owner, studySession); outputs (skill, course, definition); bindings () — answers at most one (skill, course, definition)
  where
    GroundedTutoring._session (session: studySession) has (definition, owner, topic: skill)
    view "(owner) owns study skill (skill)" with (owner, skill) has (course)
```

### (owner) can change session (studySession)

Authored path: `Reads.OpenSession`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 3.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 7.

```view
(owner) can change session (studySession) — inputs (owner, studySession); outputs (skill, course, definition); bindings () — answers at most one (skill, course, definition)
  where
    view "(owner) owns study session (studySession)" with (owner, studySession) has (course, definition, skill)
    GroundedTutoring._session (session: studySession) has (status: "OPEN")
    no AssessmentReviewing._byTask (author: owner, task: studySession)
```

### (owner) can refresh routine reviews in (course)

Authored path: `Reads.CanReplan`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 49.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 23.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 31.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 35.

```view
(owner) can refresh routine reviews in (course) — inputs (owner, course); outputs (); bindings ()
  where
    view "(owner) owns (course) with (title)" with (course, owner)
    StudyPlanning._preferences (owner, scope: course)
    no StudyPlanning._next (owner, scope: course) has (status: "IN_PROGRESS")
```

### (owner) can study confirmed (skill)

Authored path: `Reads.ActiveSkill`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 36.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 3.

```view
(owner) can study confirmed (skill) — inputs (owner, skill); outputs (course, definition); bindings () — answers at most one (course, definition)
  where view "(owner) owns study skill (skill)" with (owner, skill) has (course, definition, status: "CONFIRMED")
```

### (owner) has an activity in progress

Authored path: `Planning.ActivityInProgress`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 29.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 31.

```view
(owner) has an activity in progress — inputs (owner); outputs (); bindings (course)
  where
    SkillMapping._courses (owner) has (course)
    StudyPlanning._next (owner, scope: course) has (status: "IN_PROGRESS")
```

### (owner) imported graded work (material)

Authored path: `Importing.GradedMaterial`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 19.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 22.

```view
(owner) imported graded work (material) — inputs (owner, material); outputs (course, originals); bindings (title, graded) — answers at most one (course, originals)
  where
    Library._material (material) has (originals, owner, scope: course, title)
    view "(owner) owns (course) with (title)" with (course, owner)
    graded is gradedTitle (title)
    graded is among [true]
```

### (owner) may start (item) in (course)

Authored path: `Planning.StartAllowed`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 73.

```view
(owner) may start (item) in (course) — inputs (owner, course, item); outputs (); bindings (candidate, skill, definition, skills, tracks, schedule, urgent)
  where
    StudyPlanning._item (item) has (candidate, owner, scope: course)
    (definition, skill) is itemSubject (candidate)
    view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
    SkillMapping._map (course) has (skills)
    MasteryEstimating._progress (learner: owner) has (tracks)
    StudyPlanning._schedule (owner, scope: course) has (schedule)
    urgent is urgentExamItem (candidate, schedule)
    beginAllowed (skill, skills, tracks, urgent)
```

### (owner) owns (unit) in (course)

Authored path: `Courses.OwnedUnit`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 7.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 29.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```view
(owner) owns (unit) in (course) — inputs (owner, unit); outputs (course); bindings () — answers at most one (course)
  where
    SkillMapping._unit (unit) has (course)
    view "(owner) owns (course) with (title)" with (course, owner)
```

### (owner) owns (skill) in (course)

Authored path: `Courses.OwnedSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 7.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 29.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```view
(owner) owns (skill) in (course) — inputs (owner, skill); outputs (course, unit); bindings () — answers at most one (course, unit)
  where
    SkillMapping._skill (skill) has (unit)
    view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
```

### (owner) owns assessment (assessment)

Authored path: `Reads.OwnedCase`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 86.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 3.

```view
(owner) owns assessment (assessment) — inputs (owner, assessment); outputs (skill, course, definition, task); bindings () — answers at most one (skill, course, definition, task)
  where
    AssessmentReviewing._case (case: assessment) has (author: owner, definition, subject: skill, task)
    view "(owner) owns study skill (skill)" with (owner, skill) has (course)
```

### (owner) owns practice or imported assessment (assessment)

Authored path: `Reads.OwnedAnyCase`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 19.

```view
(owner) owns practice or imported assessment (assessment) — inputs (owner, assessment); outputs (skill, course, definition, imported); bindings () — answers at most one (skill, course, definition, imported)
  where
    AssessmentReviewing._case (case: assessment) has (author: owner, definition, imported, subject: skill)
    view "(owner) owns study skill (skill)" with (owner, skill) has (course)
```

### (skill) has a source outside (owner)'s (course)

Authored path: `Courses.UnavailableSkillMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```view
(skill) has a source outside (owner)'s (course) — inputs (owner, skill, course); outputs (); bindings (material)
  where
    SkillMapping._materials (skill) has (material)
    no Library._material (material) has (owner, scope: course)
```

### assessment (assessment) needs evidence for (owner)

Authored path: `Reads.NeedsEvidence`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 23.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 17.

```view
assessment (assessment) needs evidence for (owner) — inputs (owner, assessment); outputs (skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt); bindings (data, tracks) — answers at most one (skill, definition, revision, result, gateMet, rationale, origin, fresh, performedAt)
  where
    AssessmentReviewing._case (case: assessment) has (author: owner, definition, fresh, performedAt, subject: skill)
    AssessmentReviewing._effectiveJudgment (case: assessment) has (gateMet, origin, rationale, result, revision)
    AssessmentReviewing._caseData (case: assessment) has (data)
    MasteryEstimating._progress (learner: owner) has (tracks)
    (needed: true) is evidenceUpdate (data, tracks)
```

### review inputs for (owner) in (course)

Authored path: `Reads.PlanContext`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 49.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 23.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 11.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 35.

```view
review inputs for (owner) in (course) — inputs (owner, course); outputs (candidates, horizonEnd, basis, explanation); bindings (skills, tracks, schedule) — answers exactly one (candidates, horizonEnd, basis, explanation)
  where
    SkillMapping._map (course) has (skills)
    MasteryEstimating._progress (learner: owner) has (tracks)
    StudyPlanning._schedule (owner, scope: course) has (schedule)
    (basis, candidates, explanation, horizonEnd) is planRequest (schedule, skills, tracks)
```

### the current context of (skill) for (owner)

Authored path: `Reads.SkillContext`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 5.

```view
the current context of (skill) for (owner) — inputs (owner, skill); outputs (context, definition, skills, tracks, sources); bindings (course) — answers at most one (context, definition, skills, tracks, sources)
  where
    view "(owner) owns study skill (skill)" with (owner, skill) has (course, definition)
    SkillMapping._map (course) has (skills)
    MasteryEstimating._progress (learner: owner) has (tracks)
    Library._sourceSet (owner, scope: course) has (sources)
    context is selectSkill (skill, skills)
```

### the home view that applies to (owner)

Authored path: `Settings.AppliedHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 151.

```view
the home view that applies to (owner) — inputs (owner); outputs (view); bindings (saved, offered) — answers exactly one (view)
  where
    ViewPreferring._choice (user: owner) has (option: view)
    offered is homeViewOffered (view)
    offered is among [true]
  where
    ViewPreferring._choice (user: owner) has (option: saved)
    offered is homeViewOffered (view: saved)
    offered is among [false]
    view is defaultHomeView
  where
    no ViewPreferring._choice (user: owner)
    view is defaultHomeView
```

### the tutor choice that applies to (owner)

Authored path: `Settings.TutorStatus`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 90.
- Covered by [Settings](../design/compositions/Settings.md), line 54.

```view
the tutor choice that applies to (owner) — inputs (owner); outputs (choice, status); bindings (offered) — answers exactly one (choice, status)
  where
    TutorPreferring._choice (user: owner) has (option: choice)
    offered is choiceOffered (choice)
    status is tutorStatus (offered, saved: true)
  where
    no TutorPreferring._choice (user: owner)
    choice is defaultChoice
    status is tutorStatus (offered: true, saved: false)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

### admit a lesson for (owner) and (skill)

Authored path: `Access.LessonReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 11.

```former
Former "admit a lesson for (owner) and (skill)" — inputs (owner, skill); bindings (context, sources, materials); promises at most one record — forms:
  a record of
    where view "(owner) can study confirmed (skill)" with (owner, skill)
    where view "the current context of (skill) for (owner)" with (owner, skill) has (context, sources)
    where materials is selectSkillMaterials (context)
    where (valid: true) is selectSources (materials, sources)
    allowed: true
```

### admit a question in (studySession)

Authored path: `Access.QuestionReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 28.

```former
Former "admit a question in (studySession)" — inputs (owner, studySession, text, channel, attachments, dialogueLength); bindings (course, data, sources); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession) has (course)
    where GroundedTutoring._lesson (lesson: studySession)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where Library._sourceSet (owner, scope: course) has (sources)
    where dialogueIsCurrent (data, dialogueLength)
    where (valid: true) is responseInput (attachments, channel, data, sources, text)
    allowed: true
```

### admit a routine plan in (course)

Authored path: `Access.PlanReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 24.

```former
Former "admit a routine plan in (course)" — inputs (owner, course); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can refresh routine reviews in (course)" with (course, owner)
    allowed: true
```

### admit a transcript correction in (studySession)

Authored path: `Access.TranscriptReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 16.

```former
Former "admit a transcript correction in (studySession)" — inputs (owner, studySession); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession)
    allowed: true
```

### admit a tutor reply in (studySession)

Authored path: `Access.ReplyReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 14.

```former
Former "admit a tutor reply in (studySession)" — inputs (owner, studySession); bindings (data); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where hasLessonQuestion (data)
    allowed: true
```

### admit a tutor request for (owner)

Authored path: `Settings.TutorReady`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 90.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 7.
- Covered by [Settings](../design/compositions/Settings.md), line 90.

```former
Former "admit a tutor request for (owner)" — inputs (owner); bindings (status); promises at most one record — forms:
  a record of
    where view "the tutor choice that applies to (owner)" with (owner) has (status)
    where status is among ["SAVED", "DEFAULT"]
    allowed: true
```

### admit access to (course) for (owner)

Authored path: `Access.CourseReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 23.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.

```former
Former "admit access to (course) for (owner)" — inputs (owner, course); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns (course) with (title)" with (course, owner)
    allowed: true
```

### admit an estimate adjustment for (owner) and (skill)

Authored path: `Access.AdjustReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 20.

```former
Former "admit an estimate adjustment for (owner) and (skill)" — inputs (owner, skill); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can study confirmed (skill)" with (owner, skill)
    allowed: true
```

### admit graded work (material) for (owner)

Authored path: `Access.GradedReady`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 7.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 22.

```former
Former "admit graded work (material) for (owner)" — inputs (owner, material); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) imported graded work (material)" with (material, owner)
    allowed: true
```

### admit learner work in (studySession)

Authored path: `Access.ResponseReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 13.

```former
Former "admit learner work in (studySession)" — inputs (owner, studySession, text, channel, attachments, dialogueLength); bindings (course, data, sources); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession) has (course)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where Library._sourceSet (owner, scope: course) has (sources)
    where dialogueIsCurrent (data, dialogueLength)
    where (valid: true) is responseInput (attachments, channel, data, sources, text)
    allowed: true
```

### admit practice for (owner) and (skill)

Authored path: `Access.TaskReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 12.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 30.

```former
Former "admit practice for (owner) and (skill)" — inputs (owner, skill); bindings (definition, skills, tracks, context, sources, materials); promises at most one record — forms:
  a record of
    where view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
    where view "the current context of (skill) for (owner)" with (owner, skill) has (context, skills, sources, tracks)
    where MasteryEstimating._track (definition, learner: owner, subject: skill)
    where prerequisitesReady (skill, skills, tracks)
    where materials is selectSkillMaterials (context)
    where (valid: true) is selectSources (materials, sources)
    allowed: true
```

### admit progress on (item) in (course)

Authored path: `Access.ItemReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 25.

```former
Former "admit progress on (item) in (course)" — inputs (owner, course, item); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns (course) with (title)" with (course, owner)
    where StudyPlanning._item (item) has (owner, scope: course)
    allowed: true
```

### admit requested help in (studySession)

Authored path: `Access.HintReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 15.

```former
Former "admit requested help in (studySession)" — inputs (owner, studySession); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession)
    where GroundedTutoring._task (task: studySession)
    allowed: true
```

### admit retry of (studySession)

Authored path: `Access.RetryReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 18.

```former
Former "admit retry of (studySession)" — inputs (owner, studySession); bindings (assessment); promises at most one record — forms:
  a record of
    where view "(owner) owns study session (studySession)" with (owner, studySession)
    where AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
    where no AssessmentReviewing._effectiveJudgment (case: assessment)
    allowed: true
```

### admit review of (studySession)

Authored path: `Access.AssessmentReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 17.

```former
Former "admit review of (studySession)" — inputs (owner, studySession, dialogueLength, reviewed, unseen, outsideHelp); bindings (skill, definition, data); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession) has (definition, skill)
    where MasteryEstimating._track (definition, learner: owner, subject: skill)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where attemptIsReady (data, dialogueLength, outsideHelp, reviewed, unseen)
    allowed: true
```

### admit revision of (assessment)

Authored path: `Access.RegradeReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 19.

```former
Former "admit revision of (assessment)" — inputs (owner, assessment, basedOn); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns practice or imported assessment (assessment)" with (assessment, owner)
    where AssessmentReviewing._effectiveJudgment (case: assessment) has (judgment: basedOn)
    allowed: true
```

### admit starting (item) in (course)

Authored path: `Access.BeginReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 26.

```former
Former "admit starting (item) in (course)" — inputs (owner, course, item); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns (course) with (title)" with (course, owner)
    where view "(owner) may start (item) in (course)" with (course, item, owner)
    allowed: true
```

### admit suggestions from (material)

Authored path: `Access.SuggestionReady`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 21.

```former
Former "admit suggestions from (material)" — inputs (owner, material); bindings (course); promises at most one record — forms:
  a record of
    where Library._material (material) has (owner, scope: course)
    where view "(owner) owns (course) with (title)" with (course, owner)
    allowed: true
```

### saved study session (studySession)

Authored path: `Reads.SessionData`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 7.

```former
Former "saved study session (studySession)" — inputs (studySession); bindings (data); promises exactly one record — forms:
  a record of
    where GroundedTutoring._sessionData (session: studySession) has (data)
    data
```

### skill estimates for (owner) in (course)

Authored path: `Reads.Progress`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 7.

```former
Former "skill estimates for (owner) in (course)" — inputs (owner, course); bindings (skills, tracks, estimates); promises exactly one record — forms:
  a record of
    where SkillMapping._map (course) has (skills)
    where MasteryEstimating._progress (learner: owner) has (tracks)
    where estimates is progressRows (skills, tracks)
    estimates
```

### study data for (owner) and (skill) at (at)

Authored path: `Reads.SkillData`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 46.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 7.

```former
Former "study data for (owner) and (skill) at (at)" — inputs (owner, skill, at); bindings (context, definition, tracks, sessions, cases, track, estimate, explanation, timeline); promises exactly one record — forms:
  a record of
    where view "the current context of (skill) for (owner)" with (owner, skill) has (context, definition, tracks)
    where GroundedTutoring._study (owner, topic: skill) has (sessions)
    where AssessmentReviewing._history (author: owner, subject: skill) has (cases)
    where (estimate, track) is studyDetail (cases, context, sessions, tracks)
    where whether MasteryEstimating._explanation (at, definition, learner: owner, subject: skill) has (explanation)
    where timeline is estimateTimeline (explanation, tracks)
    cases
    estimate
    explanation: timeline
    sessions
    skill: context
    track
```

### study plan for (owner) in (course)

Authored path: `Reads.PlanData`.
- Covered by [Shared learning reads](../design/compositions/LearningReads.md), line 7.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.

```former
Former "study plan for (owner) in (course)" — inputs (owner, course); bindings (schedule, preferences, budget, next, today, plan); promises exactly one record — forms:
  a record of
    where StudyPlanning._schedule (owner, scope: course) has (schedule)
    where (budget, next, plan, preferences, today) is planDetail (schedule)
    budget
    next
    plan
    preferences
    today
```

### the active exams for (owner) in (course)

Authored path: `Planning.Exams`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.

```former
Former "the active exams for (owner) in (course)" — inputs (owner, course); bindings (exam, date, covered); promises exactly one record — forms:
  each StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
    arranged by date
    form a record of
      covered
      date
      exam
```

### the activities of the proposal awaiting confirmation for (owner) in (course)

Authored path: `Planning.PendingItems`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.

```former
Former "the activities of the proposal awaiting confirmation for (owner) in (course)" — inputs (owner, course); bindings (plan, item, candidate, day, order); promises exactly one record — forms:
  each StudyPlanning._plans (owner, scope: course) has (needsConfirmation: true, plan, status: "PROPOSED")
    where StudyPlanning._items (plan) has (candidate, day, item)
    where order is itemOrder (candidate, day)
    arranged by order
    form a record of
      candidate
      day
      item
```

### the courses belonging to (owner)

Authored path: `Courses.CourseList`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 97.

```former
Former "the courses belonging to (owner)" — inputs (owner); bindings (course, title); promises exactly one record — forms:
  each SkillMapping._courses (owner) has (course)
    where view "(owner) owns (course) with (title)" with (course, owner) has (title)
    arranged by course
    form a record of
      course
      title
```

### the cuts of the proposal awaiting confirmation for (owner) in (course)

Authored path: `Planning.PendingCuts`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.

```former
Former "the cuts of the proposal awaiting confirmation for (owner) in (course)" — inputs (owner, course); bindings (plan, cut, order); promises exactly one record — forms:
  each StudyPlanning._plans (owner, scope: course) has (needsConfirmation: true, plan, status: "PROPOSED")
    where StudyPlanning._cuts (plan) has (cut)
    where order is cutKey (cut)
    arranged by order
    form a record of
      cut
```

### the imports from (material) for (owner) in (course)

Authored path: `Importing.ImportedRows`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 82.

```former
Former "the imports from (material) for (owner) in (course)" — inputs (owner, material, course); bindings (unit, skill, assessment, performedAt, sourceKey, fromMaterial, label, mark, feedback, result); promises exactly one record — forms:
  each SkillMapping._units (course) has (unit)
    where SkillMapping._skills (unit) has (skill)
    where AssessmentReviewing._cases (author: owner, subject: skill) has (case: assessment, imported: true, performedAt)
    where AssessmentReviewing._case (case: assessment) has (sourceKey)
    where fromMaterial is gradedSource (material, sourceKey)
    where fromMaterial is among [true]
    where AssessmentReviewing._work (case: assessment) has (originalFeedback: feedback, originalMark: mark, question: label)
    where AssessmentReviewing._effectiveJudgment (case: assessment) has (result)
    arranged by assessment
    form a record of
      case: assessment
      feedback
      label
      mark
      performedAt
      result
      skill
```

### the prerequisite links in (course)

Authored path: `Courses.Prerequisites`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```former
Former "the prerequisite links in (course)" — inputs (course); bindings (unit, skill, prerequisite); promises exactly one record — forms:
  each SkillMapping._units (course) has (unit)
    where SkillMapping._skills (unit) has (skill)
    where SkillMapping._prerequisites (skill) has (prerequisite)
    arranged by skill
    form a record of
      prerequisite
      skill
```

### the prerequisite to work on before practicing (skill) for (owner)

Authored path: `Access.PracticePrerequisite`.
- Covered by [Request admission](../design/compositions/LearningAccess.md), line 30.

```former
Former "the prerequisite to work on before practicing (skill) for (owner)" — inputs (owner, skill); bindings (skills, tracks, title); promises at most one record — forms:
  a record of
    where view "(owner) can study confirmed (skill)" with (owner, skill)
    where view "the current context of (skill) for (owner)" with (owner, skill) has (skills, tracks)
    where (found: true, title) is prerequisiteToPractice (skill, skills, tracks)
    title
```

### the proposal awaiting confirmation for (owner) in (course)

Authored path: `Planning.PendingProposal`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.

```former
Former "the proposal awaiting confirmation for (owner) in (course)" — inputs (owner, course); bindings (plan, explanation, examUrgent, estimatedExamMinutes, availableExamMinutes, focusExam, focusExamDate, currentBasis, locallyCurrent, contextCurrent, sessionInProgress); promises exactly one record — forms:
  each StudyPlanning._plans (owner, scope: course) has (needsConfirmation: true, plan, status: "PROPOSED")
    where StudyPlanning._plan (plan) has (availableMinutes: availableExamMinutes, explanation, focusDeadline: focusExam, requiredMinutes: estimatedExamMinutes, urgent: examUrgent)
    where StudyPlanning._deadlines (owner, scope: course) has (date: focusExamDate, deadline: focusExam)
    where view "review inputs for (owner) in (course)" with (course, owner) has (basis: currentBasis)
    where StudyPlanning._proposalCheck (currentBasis, owner, plan) has (contextCurrent, locallyCurrent, sessionInProgress)
    arranged by plan
    form a record of
      availableExamMinutes
      contextCurrent
      estimatedExamMinutes
      examUrgent
      explanation
      focusExam
      focusExamDate
      locallyCurrent
      plan
      sessionInProgress
```

### the requirements versions in (course)

Authored path: `Courses.Versions`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```former
Former "the requirements versions in (course)" — inputs (course); bindings (unit, skill, version, outcome, gate); promises exactly one record — forms:
  each SkillMapping._units (course) has (unit)
    where SkillMapping._skills (unit) has (skill)
    where SkillMapping._versions (skill) has (gate, outcome, version)
    arranged by skill
    form a record of
      gate
      outcome
      skill
      version
```

### the skill definitions in (course)

Authored path: `Courses.Skills`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```former
Former "the skill definitions in (course)" — inputs (course); bindings (unit, skill, title, current, status, outcome, gate); promises exactly one record — forms:
  each SkillMapping._units (course) has (unit)
    where SkillMapping._skills (unit) has (current, skill, status, title)
    where SkillMapping._version (version: current) has (gate, outcome)
    arranged by skill
    form a record of
      current
      gate
      outcome
      skill
      status
      title
      unit
```

### the skill sources in (course)

Authored path: `Courses.SkillSources`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```former
Former "the skill sources in (course)" — inputs (course); bindings (unit, skill, material); promises exactly one record — forms:
  each SkillMapping._units (course) has (unit)
    where SkillMapping._skills (unit) has (skill)
    where SkillMapping._materials (skill) has (material)
    arranged by skill
    form a record of
      material
      skill
```

### the source summaries for (owner) in (course)

Authored path: `Courses.Materials`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```former
Former "the source summaries for (owner) in (course)" — inputs (owner, course); bindings (material, title, locator, origin); promises exactly one record — forms:
  each Library._materials (owner, scope: course) has (locator, material, origin, title)
    arranged by material
    form a record of
      locator
      material
      origin
      title
```

### the tutor choice that (request) carried

Authored path: `Settings.SentTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 96.

```former
Former "the tutor choice that (request) carried" — inputs (request); bindings (model, level); promises exactly one record — forms:
  a record of
    where (level, model) is requestChoice (request)
    level
    model
```

### the tutor settings for (owner)

Authored path: `Settings.TutorSettings`.
- Covered by [Settings](../design/compositions/Settings.md), line 62.

```former
Former "the tutor settings for (owner)" — inputs (owner); bindings (models, choice, status, fallback); promises exactly one record — forms:
  a record of
    where models is tutorCatalog
    where view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
    where fallback is defaultChoice
    choice
    defaultChoice: fallback
    models
    status
```

### the units in (course)

Authored path: `Courses.Units`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```former
Former "the units in (course)" — inputs (course); bindings (unit, title, emphasized); promises exactly one record — forms:
  each SkillMapping._units (course) has (emphasized, title, unit)
    arranged by unit
    form a record of
      emphasized
      title
      unit
```

## Reactions

### Courses.AddMaterial

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 15.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 75.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.AddMaterial:missing#2

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 15.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 75.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddMaterial
where
  earlier, RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.AddMaterial:owned#2

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 15.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 75.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddMaterial
where
  earlier, RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  Library.add (content, importKey, locator, origin, originals, owner, scope: course, title)
```

### Courses.AddMaterial:owned#3

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 15.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 75.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Library.add (content, importKey, locator, origin, originals, owner, scope: course, title, material), asked by Courses.AddMaterial:owned#2
where
  earlier, RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
then
  RequestBoundary.respond (material, requestId)
```

### Courses.AddSkillSource

Authored path: `Courses.AddSkillSource`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 50.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 81.

```reaction
when RequestBoundary.request (material, path: "/courses/skills/sources/add", requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.AddSkillSource:missing#2

Authored path: `Courses.AddSkillSource`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 50.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 81.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddSkillSource
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/sources/add", requestId, session, skill)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.AddSkillSource:owned#2

Authored path: `Courses.AddSkillSource`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 50.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 81.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddSkillSource
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/sources/add", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill) has (course)
  Library._material (material) has (owner, scope: course)
then
  SkillMapping.attachMaterial (material, owner, skill)
```

### Courses.AddSkillSource:owned#3

Authored path: `Courses.AddSkillSource`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 50.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 81.

```reaction
when SkillMapping.attachMaterial (material, owner, skill), asked by Courses.AddSkillSource:owned#2
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/sources/add", requestId, session, skill)
then
  RequestBoundary.respond (requestId)
```

### Courses.AddSkillSource:source#2

Authored path: `Courses.AddSkillSource`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 50.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 81.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddSkillSource
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/sources/add", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill) has (course)
  no Library._material (material) has (owner, scope: course)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.AddUnit

Authored path: `Courses.AddUnit`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 13.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when RequestBoundary.request (course, path: "/courses/units/add", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.AddUnit#2

Authored path: `Courses.AddUnit`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 13.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddUnit
where
  earlier, RequestBoundary.request (course, path: "/courses/units/add", requestId, session, title)
then
  SkillMapping.addUnit (course, owner, title)
```

### Courses.AddUnit#3

Authored path: `Courses.AddUnit`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 13.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when SkillMapping.addUnit (course, owner, title, unit), asked by Courses.AddUnit#2
where
  earlier, RequestBoundary.request (course, path: "/courses/units/add", requestId, session, title)
then
  RequestBoundary.respond (requestId, unit)
```

### Courses.ArchiveSkill

Authored path: `Courses.ArchiveSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 59.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 83.

```reaction
when RequestBoundary.request (path: "/courses/skills/archive", requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.ArchiveSkill:missing#2

Authored path: `Courses.ArchiveSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 59.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 83.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ArchiveSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/archive", requestId, session, skill)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ArchiveSkill:owned#2

Authored path: `Courses.ArchiveSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 59.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 83.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ArchiveSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/archive", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill)
then
  SkillMapping.archive (owner, skill)
```

### Courses.ArchiveSkill:owned#3

Authored path: `Courses.ArchiveSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 59.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 83.

```reaction
when SkillMapping.archive (owner, skill), asked by Courses.ArchiveSkill:owned#2
where
  earlier, RequestBoundary.request (path: "/courses/skills/archive", requestId, session, skill)
then
  RequestBoundary.respond (requestId)
```

### Courses.ConfirmSkill

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 78.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.ConfirmSkill:missing#2

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 78.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ConfirmSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ConfirmSkill:owned#2

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 78.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ConfirmSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill) has (course)
  no view "(skill) has a source outside (owner)'s (course)" with (course, owner, skill)
then
  SkillMapping.confirm (owner, skill)
```

### Courses.ConfirmSkill:owned#3

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 78.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when SkillMapping.confirm (owner, skill), asked by Courses.ConfirmSkill:owned#2
where
  earlier, RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
then
  RequestBoundary.respond (requestId)
```

### Courses.ConfirmSkill:source#2

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 78.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ConfirmSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill) has (course)
  view "(skill) has a source outside (owner)'s (course)" with (course, owner, skill)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.CreateCourse

Authored path: `Courses.CreateCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 13.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 71.
- Covered by [P2 learning journey](../design/stages/materials.md), line 99.

```reaction
when RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.CreateCourse#2

Authored path: `Courses.CreateCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 13.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 71.
- Covered by [P2 learning journey](../design/stages/materials.md), line 99.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.CreateCourse
where
  earlier, RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  SkillMapping.createCourse (owner, title)
```

### Courses.CreateCourse#3

Authored path: `Courses.CreateCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 13.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 71.
- Covered by [P2 learning journey](../design/stages/materials.md), line 99.

```reaction
when SkillMapping.createCourse (owner, title, course), asked by Courses.CreateCourse#2
where
  earlier, RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  RequestBoundary.respond (course, requestId)
```

### Courses.EditDraft

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 77.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
then
  Sessioning.use (session)
```

### Courses.EditDraft:graded#2

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 77.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditDraft
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  Library._material (material) has (owner, scope: course, title: materialTitle)
  graded is gradedTitle (title: materialTitle)
  graded is among [true]
then
  RequestBoundary.respond (error: "GRADED_MATERIAL_NOT_SOURCE", requestId)
```

### Courses.EditDraft:missing#2

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 77.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditDraft
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
  no view "(owner) owns (unit) in (course)" with (owner, unit)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.EditDraft:owned#2

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 77.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditDraft
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  Library._material (material) has (owner, scope: course, title: materialTitle)
  graded is gradedTitle (title: materialTitle)
  graded is among [false]
  materials is singleMaterial (material)
then
  SkillMapping.reviseDraft (gate, materials, outcome, owner, skill, title, unit)
```

### Courses.EditDraft:owned#3

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 77.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when SkillMapping.reviseDraft (gate, materials, outcome, owner, skill, title, unit), asked by Courses.EditDraft:owned#2
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
then
  RequestBoundary.respond (requestId)
```

### Courses.EditDraft:source#2

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 25.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 77.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditDraft
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  no Library._material (material) has (owner, scope: course)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.EditSkillDetails

Authored path: `Courses.EditSkillDetails`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 33.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 79.

```reaction
when RequestBoundary.request (path: "/courses/skills/details", requestId, session, skill, title, unit)
then
  Sessioning.use (session)
```

### Courses.EditSkillDetails:missing#2

Authored path: `Courses.EditSkillDetails`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 33.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 79.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditSkillDetails
where
  earlier, RequestBoundary.request (path: "/courses/skills/details", requestId, session, skill, title, unit)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.EditSkillDetails:owned#2

Authored path: `Courses.EditSkillDetails`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 33.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 79.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditSkillDetails
where
  earlier, RequestBoundary.request (path: "/courses/skills/details", requestId, session, skill, title, unit)
  view "(owner) owns (skill) in (course)" with (owner, skill)
then
  SkillMapping.editDetails (owner, skill, title, unit)
```

### Courses.EditSkillDetails:owned#3

Authored path: `Courses.EditSkillDetails`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 33.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 79.

```reaction
when SkillMapping.editDetails (owner, skill, title, unit), asked by Courses.EditSkillDetails:owned#2
where
  earlier, RequestBoundary.request (path: "/courses/skills/details", requestId, session, skill, title, unit)
then
  RequestBoundary.respond (requestId)
```

### Courses.ListCourses

Authored path: `Courses.ListCourses`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 7.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 70.
- Covered by [P2 learning journey](../design/stages/materials.md), line 97.

```reaction
when RequestBoundary.request (path: "/courses", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ListCourses#2

Authored path: `Courses.ListCourses`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 7.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 70.
- Covered by [P2 learning journey](../design/stages/materials.md), line 97.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ListCourses
where
  earlier, RequestBoundary.request (path: "/courses", requestId, session)
then
  RequestBoundary.respond (courses: former "the courses belonging to (owner)" with (owner), requestId)
```

### Courses.ProposeSkill

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 76.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
then
  Sessioning.use (session)
```

### Courses.ProposeSkill:graded#2

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 76.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ProposeSkill
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  Library._material (material) has (owner, scope: course, title: materialTitle)
  graded is gradedTitle (title: materialTitle)
  graded is among [true]
then
  RequestBoundary.respond (error: "GRADED_MATERIAL_NOT_SOURCE", requestId)
```

### Courses.ProposeSkill:missing#2

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 76.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ProposeSkill
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
  no view "(owner) owns (unit) in (course)" with (owner, unit)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ProposeSkill:owned#2

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 76.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ProposeSkill
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  Library._material (material) has (owner, scope: course, title: materialTitle)
  graded is gradedTitle (title: materialTitle)
  graded is among [false]
  materials is singleMaterial (material)
then
  SkillMapping.propose (gate, materials, outcome, owner, proposalKey, title, unit)
```

### Courses.ProposeSkill:owned#3

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 76.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when SkillMapping.propose (gate, materials, outcome, owner, proposalKey, title, unit, skill), asked by Courses.ProposeSkill:owned#2
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
then
  RequestBoundary.respond (requestId, skill)
```

### Courses.ProposeSkill:source#2

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 76.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ProposeSkill
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  no Library._material (material) has (owner, scope: course)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.ReadCourse

Authored path: `Courses.ReadCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 72.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```reaction
when RequestBoundary.request (course, path: "/courses/read", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ReadCourse:missing#2

Authored path: `Courses.ReadCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 72.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadCourse
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (course, path: "/courses/read", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ReadCourse:owned#2

Authored path: `Courses.ReadCourse`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 72.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadCourse
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (course, path: "/courses/read", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (materials: former "the source summaries for (owner) in (course)" with (course, owner), prerequisites: former "the prerequisite links in (course)" with (course), requestId, skillSources: former "the skill sources in (course)" with (course), skills: former "the skill definitions in (course)" with (course), units: former "the units in (course)" with (course), versions: former "the requirements versions in (course)" with (course))
```

### Courses.ReadMaterial

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 73.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ReadMaterial:course#2

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 73.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadMaterial
where
  earlier, RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
  Library._material (material) has (owner, scope: course)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ReadMaterial:missing#2

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 73.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadMaterial
where
  earlier, RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
  no Library._material (material) has (owner)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.ReadMaterial:owned#2

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 73.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 11.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 121.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadMaterial
where
  earlier, RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
  Library._material (material) has (content, locator, origin, originals, owner, scope: course, title)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (content, locator, origin, originals, requestId, title)
```

### Courses.RepairRevisedTrack

Authored path: `Courses.RepairRevisedTrack`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 9.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 39.

```reaction
when any action is returned (action: "use", concept: "Sessioning", result: identity)
where
  (owner) is sessionSubject (identity)
  SkillMapping._courses (owner) has (course)
  SkillMapping._units (course) has (unit)
  SkillMapping._skills (unit) has (current, skill, status: "CONFIRMED")
  no MasteryEstimating._track (definition: current, learner: owner, subject: skill)
  MasteryEstimating._progress (learner: owner) has (tracks)
  (confidence, found: true) is carriedEstimate (current, skill, tracks)
then
  MasteryEstimating.initialize (basis: "PREVIOUS_DEFINITION", confidence, definition: current, learner: owner, subject: skill)
```

### Courses.RestoreSkill

Authored path: `Courses.RestoreSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 61.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 84.

```reaction
when RequestBoundary.request (path: "/courses/skills/restore", requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.RestoreSkill:missing#2

Authored path: `Courses.RestoreSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 61.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 84.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.RestoreSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/restore", requestId, session, skill)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.RestoreSkill:owned#2

Authored path: `Courses.RestoreSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 61.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 84.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.RestoreSkill
where
  earlier, RequestBoundary.request (path: "/courses/skills/restore", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill)
then
  SkillMapping.restore (owner, skill)
```

### Courses.RestoreSkill:owned#3

Authored path: `Courses.RestoreSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 61.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 84.

```reaction
when SkillMapping.restore (owner, skill), asked by Courses.RestoreSkill:owned#2
where
  earlier, RequestBoundary.request (path: "/courses/skills/restore", requestId, session, skill)
then
  RequestBoundary.respond (requestId)
```

### Courses.ReviseSkill

Authored path: `Courses.ReviseSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 35.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 80.

```reaction
when RequestBoundary.request (gate, outcome, path: "/courses/skills/revise", requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.ReviseSkill:missing#2

Authored path: `Courses.ReviseSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 35.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 80.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReviseSkill
where
  earlier, RequestBoundary.request (gate, outcome, path: "/courses/skills/revise", requestId, session, skill)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ReviseSkill:owned#2

Authored path: `Courses.ReviseSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 35.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 80.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReviseSkill
where
  earlier, RequestBoundary.request (gate, outcome, path: "/courses/skills/revise", requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill)
then
  SkillMapping.reviseDefinition (gate, outcome, owner, skill)
```

### Courses.ReviseSkill:owned#3

Authored path: `Courses.ReviseSkill`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 35.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 80.

```reaction
when SkillMapping.reviseDefinition (gate, outcome, owner, skill, previous, version), asked by Courses.ReviseSkill:owned#2
where
  earlier, RequestBoundary.request (gate, outcome, path: "/courses/skills/revise", requestId, session, skill)
then
  RequestBoundary.respond (previous, requestId, version)
```

### Courses.RevisedTrack

Authored path: `Courses.RevisedTrack`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 35.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 37.

```reaction
when SkillMapping.reviseDefinition (owner, skill, previous, version)
where
  MasteryEstimating._track (definition: previous, learner: owner, subject: skill)
  no MasteryEstimating._track (definition: version, learner: owner, subject: skill)
  at is the current flow's instant
  MasteryEstimating._estimate (at, definition: previous, learner: owner, subject: skill) has (value: confidence)
then
  MasteryEstimating.initialize (basis: "PREVIOUS_DEFINITION", confidence, definition: version, learner: owner, subject: skill)
```

### Courses.SetSkillPrerequisites

Authored path: `Courses.SetSkillPrerequisites`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 52.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 82.

```reaction
when RequestBoundary.request (path: "/courses/skills/prerequisites", prerequisites, requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.SetSkillPrerequisites:missing#2

Authored path: `Courses.SetSkillPrerequisites`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 52.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 82.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.SetSkillPrerequisites
where
  earlier, RequestBoundary.request (path: "/courses/skills/prerequisites", prerequisites, requestId, session, skill)
  no view "(owner) owns (skill) in (course)" with (owner, skill)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.SetSkillPrerequisites:owned#2

Authored path: `Courses.SetSkillPrerequisites`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 52.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 82.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.SetSkillPrerequisites
where
  earlier, RequestBoundary.request (path: "/courses/skills/prerequisites", prerequisites, requestId, session, skill)
  view "(owner) owns (skill) in (course)" with (owner, skill)
  required is prerequisiteSet (prerequisites)
then
  SkillMapping.setPrerequisites (owner, prerequisites: required, skill)
```

### Courses.SetSkillPrerequisites:owned#3

Authored path: `Courses.SetSkillPrerequisites`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 52.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 82.

```reaction
when SkillMapping.setPrerequisites (owner, prerequisites: required, skill), asked by Courses.SetSkillPrerequisites:owned#2
where
  earlier, RequestBoundary.request (path: "/courses/skills/prerequisites", prerequisites, requestId, session, skill)
then
  RequestBoundary.respond (requestId)
```

### Courses.SetUnitEmphasis

Authored path: `Courses.SetUnitEmphasis`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 63.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 85.

```reaction
when RequestBoundary.request (emphasized, path: "/courses/units/emphasis", requestId, session, unit)
then
  Sessioning.use (session)
```

### Courses.SetUnitEmphasis:missing#2

Authored path: `Courses.SetUnitEmphasis`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 63.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 85.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.SetUnitEmphasis
where
  earlier, RequestBoundary.request (emphasized, path: "/courses/units/emphasis", requestId, session, unit)
  no view "(owner) owns (unit) in (course)" with (owner, unit)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.SetUnitEmphasis:owned#2

Authored path: `Courses.SetUnitEmphasis`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 63.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 85.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.SetUnitEmphasis
where
  earlier, RequestBoundary.request (emphasized, path: "/courses/units/emphasis", requestId, session, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit)
then
  SkillMapping.setEmphasis (emphasized, owner, unit)
```

### Courses.SetUnitEmphasis:owned#3

Authored path: `Courses.SetUnitEmphasis`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 63.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 85.

```reaction
when SkillMapping.setEmphasis (emphasized, owner, unit), asked by Courses.SetUnitEmphasis:owned#2
where
  earlier, RequestBoundary.request (emphasized, path: "/courses/units/emphasis", requestId, session, unit)
then
  RequestBoundary.respond (requestId)
```

### DeliverFaultToAsker

```reaction
when any action is faulted, not asked by DeliverFaultToAsker
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respondFramework (error: "INTERNAL_ERROR", requestId)
```

### DeliverRefusalToAsker

```reaction
when any action is refused (message), except RequestBoundary
where
  earlier, RequestBoundary.request (requestId)
then
  RequestBoundary.respond (error: message, requestId)
```

### Importing.Confirm

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
then
  Sessioning.use (session)
```

### Importing.Confirm:dateFuture#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  (status: "DATE_FUTURE") is gradedReview (at, outsideHelp, performedOn, row, skills)
then
  RequestBoundary.respond (error: "GRADED_DATE_FUTURE", requestId)
```

### Importing.Confirm:dateFuture#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_DATE_FUTURE", requestId), asked by Importing.Confirm:dateFuture#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:dateFuture#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:dateFuture#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_DATE_FUTURE", requestId), asked by Importing.Confirm:dateFuture#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:dateInvalid#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  (status: "DATE_INVALID") is gradedReview (at, outsideHelp, performedOn, row, skills)
then
  RequestBoundary.respond (error: "GRADED_DATE_INVALID", requestId)
```

### Importing.Confirm:dateInvalid#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_DATE_INVALID", requestId), asked by Importing.Confirm:dateInvalid#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:dateInvalid#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:dateInvalid#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_DATE_INVALID", requestId), asked by Importing.Confirm:dateInvalid#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:helpConflict#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  (status: "HELP_CONFLICT") is gradedReview (at, outsideHelp, performedOn, row, skills)
then
  RequestBoundary.respond (error: "GRADED_HELP_CONFLICT", requestId)
```

### Importing.Confirm:helpConflict#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_HELP_CONFLICT", requestId), asked by Importing.Confirm:helpConflict#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:helpConflict#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:helpConflict#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_HELP_CONFLICT", requestId), asked by Importing.Confirm:helpConflict#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:missing#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  no view "(owner) imported graded work (material)" with (material, owner)
then
  RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId)
```

### Importing.Confirm:missing#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId), asked by Importing.Confirm:missing#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:missing#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:missing#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId), asked by Importing.Confirm:missing#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:ready#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  no view "(owner) already imported (sourceKey) for (skill)" with (owner, skill, sourceKey)
then
  Sessioning.use (session)
```

### Importing.Confirm:ready#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm:ready#2
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:ready#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:ready#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:rowInvalid#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  (status: "ROW_INVALID") is gradedReview (at, outsideHelp, performedOn, row, skills)
then
  RequestBoundary.respond (error: "GRADED_ROW_INVALID", requestId)
```

### Importing.Confirm:rowInvalid#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_ROW_INVALID", requestId), asked by Importing.Confirm:rowInvalid#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:rowInvalid#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:rowInvalid#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_ROW_INVALID", requestId), asked by Importing.Confirm:rowInvalid#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:skillUnavailable#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  (status: "SKILL_UNAVAILABLE") is gradedReview (at, outsideHelp, performedOn, row, skills)
then
  RequestBoundary.respond (error: "GRADED_SKILL_UNAVAILABLE", requestId)
```

### Importing.Confirm:skillUnavailable#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_SKILL_UNAVAILABLE", requestId), asked by Importing.Confirm:skillUnavailable#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:skillUnavailable#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:skillUnavailable#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_SKILL_UNAVAILABLE", requestId), asked by Importing.Confirm:skillUnavailable#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:unmapped#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  (status: "UNMAPPED") is gradedReview (at, outsideHelp, performedOn, row, skills)
then
  RequestBoundary.respond (error: "GRADED_ROW_UNMAPPED", requestId)
```

### Importing.Confirm:unmapped#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_ROW_UNMAPPED", requestId), asked by Importing.Confirm:unmapped#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:unmapped#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:unmapped#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_ROW_UNMAPPED", requestId), asked by Importing.Confirm:unmapped#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Confirm:used#2

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Confirm
where
  at is the current flow's instant
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  view "(owner) already imported (sourceKey) for (skill)" with (owner, skill, sourceKey)
then
  RequestBoundary.respond (error: "GRADED_SOURCE_USED", requestId)
```

### Importing.Confirm:used#3

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when RequestBoundary.respond (error: "GRADED_SOURCE_USED", requestId), asked by Importing.Confirm:used#2
where
  at is the current flow's instant
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Confirm
  earlier, RequestBoundary.request (material, outsideHelp, path: "/courses/graded/confirm", performedOn, requestId, row, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course, originals)
  SkillMapping._map (course) has (skills)
  (performedAt, status: "READY") is gradedReview (at, outsideHelp, performedOn, row, skills)
  (skill, sourceKey) is gradedKey (material, row)
  (criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject) is gradedImport (material, originals, outsideHelp, performedAt, row, skills)
then
  AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject)
```

### Importing.Confirm:used#4

Authored path: `Importing.Confirm`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 50.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 92.

```reaction
when AssessmentReviewing.importGraded (author: owner, criteria, definition, feedback, fresh, gateMet, help, mark, performedAt: importedAt, question, rationale, response, result, sourceKey, subject, case: assessment), asked by Importing.Confirm:used#3
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "GRADED_SOURCE_USED", requestId), asked by Importing.Confirm:used#2
then
  RequestBoundary.respond (case: assessment, requestId)
```

### Importing.Extract

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
then
  Sessioning.use (session)
```

### Importing.Extract:missing#2

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract
where
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
  no view "(owner) imported graded work (material)" with (material, owner)
then
  RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId)
```

### Importing.Extract:missing#3

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId), asked by Importing.Extract:missing#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Extract
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  confirmed is hasConfirmedSkill (skills)
  confirmed is among [true]
  Library._sourceSet (owner, scope: course) has (sources)
  materials is singleMaterial (material)
  (selected, valid: true) is selectSources (materials, sources)
  draft is extractRequest (selected, skills)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Importing.Extract:missing#4

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:missing#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Extract
then
  Sessioning.use (session)
```

### Importing.Extract:missing:rows#5

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:missing#4
where
  earlier, RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId), asked by Importing.Extract:missing#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:missing#3
  found is hasGradedRows (answer)
  found is among [true]
  (rows) is generationFields (answer)
then
  RequestBoundary.respond (requestId, rows)
```

### Importing.Extract:missing:total#5

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:missing#4
where
  earlier, RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId), asked by Importing.Extract:missing#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:missing#3
  found is hasGradedRows (answer)
  found is among [false]
then
  RequestBoundary.respond (error: "GRADED_MARKS_MISSING", requestId)
```

### Importing.Extract:ready#2

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract
where
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  confirmed is hasConfirmedSkill (skills)
  confirmed is among [true]
then
  Sessioning.use (session)
```

### Importing.Extract:ready#3

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:ready#2
where
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  confirmed is hasConfirmedSkill (skills)
  confirmed is among [true]
  Library._sourceSet (owner, scope: course) has (sources)
  materials is singleMaterial (material)
  (selected, valid: true) is selectSources (materials, sources)
  draft is extractRequest (selected, skills)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Importing.Extract:ready#4

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:ready#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Extract
then
  Sessioning.use (session)
```

### Importing.Extract:ready:rows#5

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:ready#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:ready#3
  found is hasGradedRows (answer)
  found is among [true]
  (rows) is generationFields (answer)
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
then
  RequestBoundary.respond (requestId, rows)
```

### Importing.Extract:ready:total#5

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:ready#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:ready#3
  found is hasGradedRows (answer)
  found is among [false]
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
then
  RequestBoundary.respond (error: "GRADED_MARKS_MISSING", requestId)
```

### Importing.Extract:unmapped#2

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract
where
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  confirmed is hasConfirmedSkill (skills)
  confirmed is among [false]
then
  RequestBoundary.respond (error: "GRADED_SKILLS_UNAVAILABLE", requestId)
```

### Importing.Extract:unmapped#3

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when RequestBoundary.respond (error: "GRADED_SKILLS_UNAVAILABLE", requestId), asked by Importing.Extract:unmapped#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Extract
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (material, path: "/courses/graded/extract", requestId, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
  SkillMapping._map (course) has (skills)
  confirmed is hasConfirmedSkill (skills)
  confirmed is among [true]
  Library._sourceSet (owner, scope: course) has (sources)
  materials is singleMaterial (material)
  (selected, valid: true) is selectSources (materials, sources)
  draft is extractRequest (selected, skills)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Importing.Extract:unmapped#4

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:unmapped#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Importing.Extract
then
  Sessioning.use (session)
```

### Importing.Extract:unmapped:rows#5

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:unmapped#4
where
  earlier, RequestBoundary.respond (error: "GRADED_SKILLS_UNAVAILABLE", requestId), asked by Importing.Extract:unmapped#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:unmapped#3
  found is hasGradedRows (answer)
  found is among [true]
  (rows) is generationFields (answer)
then
  RequestBoundary.respond (requestId, rows)
```

### Importing.Extract:unmapped:total#5

Authored path: `Importing.Extract`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 25.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.Extract:unmapped#4
where
  earlier, RequestBoundary.respond (error: "GRADED_SKILLS_UNAVAILABLE", requestId), asked by Importing.Extract:unmapped#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Importing.Extract:unmapped#3
  found is hasGradedRows (answer)
  found is among [false]
then
  RequestBoundary.respond (error: "GRADED_MARKS_MISSING", requestId)
```

### Importing.ReadImports

Authored path: `Importing.ReadImports`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 37.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 82.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 93.

```reaction
when RequestBoundary.request (material, path: "/courses/graded/read", requestId, session)
then
  Sessioning.use (session)
```

### Importing.ReadImports:graded#2

Authored path: `Importing.ReadImports`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 37.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 82.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 93.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.ReadImports
where
  at is the current flow's instant
  today is gradedToday (at)
  earlier, RequestBoundary.request (material, path: "/courses/graded/read", requestId, session)
  view "(owner) imported graded work (material)" with (material, owner) has (course)
then
  RequestBoundary.respond (imported: former "the imports from (material) for (owner) in (course)" with (course, material, owner), requestId, today)
```

### Importing.ReadImports:missing#2

Authored path: `Importing.ReadImports`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 37.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 82.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 93.

```reaction
when Sessioning.use (session, subject: owner), asked by Importing.ReadImports
where
  earlier, RequestBoundary.request (material, path: "/courses/graded/read", requestId, session)
  no view "(owner) imported graded work (material)" with (material, owner)
then
  RequestBoundary.respond (error: "GRADED_MATERIAL_UNAVAILABLE", requestId)
```

### Learning.Adjust

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
then
  Sessioning.use (session)
```

### Learning.Adjust:active#2

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Adjust
where
  earlier, RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
then
  MasteryEstimating.adjust (adjustmentKey, definition, learner: owner, reason, subject: skill, value)
```

### Learning.Adjust:active:planned#3

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when MasteryEstimating.adjust (adjustmentKey, definition, learner: owner, reason, subject: skill, value, adjustment), asked by Learning.Adjust:active#2
at the flow's settlement frontier
where
  view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
  MasteryEstimating._track (definition, learner: owner, subject: skill) has (track)
  MasteryEstimating._adjustments (track) has (adjustment)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis)
  StudyPlanning._plans (owner, scope: course) has (plan, status)
  status is among ["PROPOSED", "ACTIVE"]
  StudyPlanning._plan (plan) has (basis)
  earlier, RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
then
  RequestBoundary.respond (adjustment, requestId)
```

### Learning.Adjust:active:unplanned#3

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when MasteryEstimating.adjust (adjustmentKey, definition, learner: owner, reason, subject: skill, value, adjustment), asked by Learning.Adjust:active#2
at the flow's settlement frontier
where
  view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
  MasteryEstimating._track (definition, learner: owner, subject: skill) has (track)
  MasteryEstimating._adjustments (track) has (adjustment)
  no view "(owner) can refresh routine reviews in (course)" with (course, owner)
  earlier, RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
then
  RequestBoundary.respond (adjustment, requestId)
```

### Learning.Adjust:missing#2

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Adjust
where
  earlier, RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
  no view "(owner) can study confirmed (skill)" with (owner, skill)
then
  RequestBoundary.respond (detail: "Choose one of your confirmed skills before adjusting its estimate.", error: "SKILL_UNAVAILABLE", requestId)
```

### Learning.Adjust:missing:planned#3

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when RequestBoundary.respond (detail: "Choose one of your confirmed skills before adjusting its estimate.", error: "SKILL_UNAVAILABLE", requestId), asked by Learning.Adjust:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Adjust
  earlier, RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
  MasteryEstimating._track (definition, learner: owner, subject: skill) has (track)
  MasteryEstimating._adjustments (track) has (adjustment)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis)
  StudyPlanning._plans (owner, scope: course) has (plan, status)
  status is among ["PROPOSED", "ACTIVE"]
  StudyPlanning._plan (plan) has (basis)
then
  RequestBoundary.respond (adjustment, requestId)
```

### Learning.Adjust:missing:unplanned#3

Authored path: `Learning.Adjust`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 33.
- Covered by [Learning flows](../design/compositions/Learning.md), line 111.

```reaction
when RequestBoundary.respond (detail: "Choose one of your confirmed skills before adjusting its estimate.", error: "SKILL_UNAVAILABLE", requestId), asked by Learning.Adjust:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Adjust
  earlier, RequestBoundary.request (adjustmentKey, path: "/learning/adjust", reason, requestId, session, skill, value)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
  MasteryEstimating._track (definition, learner: owner, subject: skill) has (track)
  MasteryEstimating._adjustments (track) has (adjustment)
  no view "(owner) can refresh routine reviews in (course)" with (course, owner)
then
  RequestBoundary.respond (adjustment, requestId)
```

### Learning.Assess

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 107.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (dialogueLength, outsideHelp, path: "/learning/assess", requestId, reviewed, session, studySession, unseen)
then
  Sessioning.use (session)
```

### Learning.Assess#2

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 107.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Assess
where
  earlier, RequestBoundary.request (dialogueLength, outsideHelp, path: "/learning/assess", requestId, reviewed, session, studySession, unseen)
  view "(owner) can change session (studySession)" with (owner, studySession) has (definition, skill)
  approved is reviewApproved (outsideHelp, reviewed, unseen)
  approved is among [true]
  MasteryEstimating._track (definition, learner: owner, subject: skill)
then
  GroundedTutoring.confirmAttempt (dialogueLength, outsideHelp, owner, task: studySession, unseen)
```

### Learning.Assess#3

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 107.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.confirmAttempt (dialogueLength, outsideHelp, owner, task: studySession, unseen), asked by Learning.Assess#2
at the flow's settlement frontier
where
  view "(owner) owns study session (studySession)" with (owner, studySession) has (course)
  AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
  no AssessmentReviewing._effectiveJudgment (case: assessment)
  AssessmentReviewing._caseData (case: assessment) has (data)
  GroundedTutoring._sessionData (session: studySession) has (data: sessionData)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  draft is gradeRequest (data, selected)
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Assess#4

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 107.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Assess#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Assess
then
  Sessioning.use (session)
```

### Learning.Assess#5

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 107.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Assess#4
where
  earlier, GroundedTutoring.confirmAttempt (dialogueLength, outsideHelp, owner, task: studySession, unseen), asked by Learning.Assess#2
  AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Assess#3
  (gateMet, rationale, result) is generationFields (answer)
then
  AssessmentReviewing.assess (case: assessment, gateMet, rationale, result)
```

### Learning.Assess#6

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 107.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when AssessmentReviewing.assess (case: assessment, gateMet, rationale, result), asked by Learning.Assess#5
at the flow's settlement frontier
where
  earlier, GroundedTutoring.confirmAttempt (dialogueLength, outsideHelp, owner, task: studySession, unseen), asked by Learning.Assess#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Assess#3
  earlier, RequestBoundary.request (dialogueLength, outsideHelp, path: "/learning/assess", requestId, reviewed, session, studySession, unseen)
then
  RequestBoundary.respond (requestId, studySession, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Confidence

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 99.

```reaction
when RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Confidence:existing#2

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 99.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Confidence
where
  earlier, RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
  MasteryEstimating._track (definition, learner: owner, subject: skill) has (track)
then
  RequestBoundary.respond (requestId, track)
```

### Learning.Confidence:missing#2

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 99.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Confidence
where
  earlier, RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
  no view "(owner) can study confirmed (skill)" with (owner, skill)
then
  RequestBoundary.respond (error: "SKILL_UNAVAILABLE", requestId)
```

### Learning.Confidence:new#2

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 99.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Confidence
where
  earlier, RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
  no MasteryEstimating._track (definition, learner: owner, subject: skill)
then
  MasteryEstimating.initialize (basis: "SELF_REPORTED", confidence, definition, learner: owner, subject: skill)
```

### Learning.Confidence:new#3

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 99.

```reaction
when MasteryEstimating.initialize (basis: "SELF_REPORTED", confidence, definition, learner: owner, subject: skill, track), asked by Learning.Confidence:new#2
where
  earlier, RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
then
  RequestBoundary.respond (requestId, track)
```

### Learning.Correct

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  Sessioning.use (session)
```

### Learning.Correct:imported#2

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Correct
where
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
  view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  gateMet is among [false]
then
  AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result)
```

### Learning.Correct:imported:importedRevised#3

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result, judgment), asked by Learning.Correct:imported#2
at the flow's settlement frontier
where
  AssessmentReviewing._effectiveJudgment (case) has (judgment)
  view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  gateMet is among [false]
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Correct:imported:practiceRevised#3

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result, judgment), asked by Learning.Correct:imported#2
at the flow's settlement frontier
where
  AssessmentReviewing._effectiveJudgment (case) has (judgment)
  no view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Correct:importedGate#2

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Correct
where
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
  view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  gateMet is among [true]
then
  RequestBoundary.respond (error: "IMPORTED_GATE_UNAVAILABLE", requestId)
```

### Learning.Correct:importedGate:importedRevised#3

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when RequestBoundary.respond (error: "IMPORTED_GATE_UNAVAILABLE", requestId), asked by Learning.Correct:importedGate#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Correct
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
  AssessmentReviewing._effectiveJudgment (case) has (judgment)
  view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  gateMet is among [false]
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Correct:importedGate:practiceRevised#3

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when RequestBoundary.respond (error: "IMPORTED_GATE_UNAVAILABLE", requestId), asked by Learning.Correct:importedGate#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Correct
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
  AssessmentReviewing._effectiveJudgment (case) has (judgment)
  no view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Correct:practice#2

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Correct
where
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
  no view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
then
  AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result)
```

### Learning.Correct:practice:importedRevised#3

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result, judgment), asked by Learning.Correct:practice#2
at the flow's settlement frontier
where
  AssessmentReviewing._effectiveJudgment (case) has (judgment)
  view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  gateMet is among [false]
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Correct:practice:practiceRevised#3

Authored path: `Learning.Correct`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 29.
- Covered by [Learning flows](../design/compositions/Learning.md), line 109.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result, judgment), asked by Learning.Correct:practice#2
at the flow's settlement frontier
where
  AssessmentReviewing._effectiveJudgment (case) has (judgment)
  no view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Hint

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (path: "/learning/hint", requestId, session, studySession)
then
  Sessioning.use (session)
```

### Learning.Hint#2

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Hint
where
  earlier, RequestBoundary.request (path: "/learning/hint", requestId, session, studySession)
  view "(owner) can change session (studySession)" with (owner, studySession)
then
  GroundedTutoring.requestHint (owner, task: studySession)
```

### Learning.Hint#3

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.requestHint (owner, task: studySession), asked by Learning.Hint#2
where
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data)
  (selected, valid: true) is selectSources (materials, sources)
  draft is sessionRequest (data, kind: "HINT", selected)
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Hint#4

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Hint#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Hint
then
  Sessioning.use (session)
```

### Learning.Hint:closed#5

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Hint#4
where
  earlier, GroundedTutoring.requestHint (owner, task: studySession), asked by Learning.Hint#2
  no view "(owner) can change session (studySession)" with (owner, studySession)
  earlier, RequestBoundary.request (path: "/learning/hint", requestId, session, studySession)
then
  RequestBoundary.respond (error: "SESSION_CHANGED", requestId)
```

### Learning.Hint:open#5

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Hint#4
where
  earlier, GroundedTutoring.requestHint (owner, task: studySession), asked by Learning.Hint#2
  view "(owner) can change session (studySession)" with (owner, studySession)
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Hint#3
  (text) is generationFields (answer)
then
  GroundedTutoring.giveHint (channel: "TEXT", owner, task: studySession, text)
```

### Learning.Hint:open#6

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 105.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.giveHint (channel: "TEXT", owner, task: studySession, text), asked by Learning.Hint:open#5
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Hint#3
  earlier, RequestBoundary.request (path: "/learning/hint", requestId, session, studySession)
then
  RequestBoundary.respond (requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Lesson

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 100.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Lesson#2

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 100.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Lesson
where
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill)
  view "the current context of (skill) for (owner)" with (owner, skill) has (context, sources)
  materials is selectSkillMaterials (context)
  (selected, valid: true) is selectSources (materials, sources)
  draft is lessonRequest (context, request, selected)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Lesson#3

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 100.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Lesson#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Lesson
then
  Sessioning.use (session)
```

### Learning.Lesson:changed#4

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 100.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Lesson#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Lesson#2
  (definition) is generationDefinition (request: prepared)
  earlier, RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
  no view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
then
  RequestBoundary.respond (error: "SKILL_CHANGED", requestId)
```

### Learning.Lesson:current#4

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 100.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Lesson#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Lesson#2
  (definition) is generationDefinition (request: prepared)
  (citations, materials, text: explanation) is generationFields (answer)
  earlier, RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
then
  GroundedTutoring.explain (citations, definition, explanation, materials, owner, request, topic: skill)
```

### Learning.Lesson:current#5

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 100.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.explain (citations, definition, explanation, materials, owner, request, topic: skill, lesson), asked by Learning.Lesson:current#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Lesson#2
  earlier, RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
then
  RequestBoundary.respond (lesson, requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Progress

Authored path: `Learning.Progress`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 98.

```reaction
when RequestBoundary.request (course, path: "/learning/progress", requestId, session)
then
  Sessioning.use (session)
```

### Learning.Progress:missing#2

Authored path: `Learning.Progress`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 98.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Progress
where
  earlier, RequestBoundary.request (course, path: "/learning/progress", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Learning.Progress:owned#2

Authored path: `Learning.Progress`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 98.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Progress
where
  earlier, RequestBoundary.request (course, path: "/learning/progress", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (data: former "skill estimates for (owner) in (course)" with (course, owner), requestId)
```

### Learning.Question

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
then
  Sessioning.use (session)
```

### Learning.Question#2

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Question
where
  earlier, RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._lesson (lesson: studySession)
  GroundedTutoring._sessionData (session: studySession) has (data)
  Library._sourceSet (owner, scope: course) has (sources)
  currentDialogue is dialogueIsCurrent (data, dialogueLength)
  currentDialogue is among [true]
  (media, valid: true) is responseInput (attachments, channel, data, sources, text)
then
  GroundedTutoring.respond (channel, media, owner, session: studySession, text)
```

### Learning.Question#3

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Question#2
where
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data)
  (selected, valid: true) is selectSources (materials, sources)
  draft is sessionRequest (data, kind: "REPLY", selected)
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Question#4

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Question#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Question
then
  Sessioning.use (session)
```

### Learning.Question:closed#5

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Question#4
where
  earlier, GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Question#2
  no view "(owner) can change session (studySession)" with (owner, studySession)
  earlier, RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
then
  RequestBoundary.respond (error: "SESSION_CHANGED", requestId)
```

### Learning.Question:open#5

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Question#4
where
  earlier, GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Question#2
  view "(owner) can change session (studySession)" with (owner, studySession)
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Question#3
  (citations, text: reply) is generationFields (answer)
then
  GroundedTutoring.answerLesson (channel: "TEXT", citations, lesson: studySession, owner, text: reply)
```

### Learning.Question:open#6

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 103.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.answerLesson (channel: "TEXT", citations, lesson: studySession, owner, text: reply), asked by Learning.Question:open#5
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Question#3
  earlier, RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
then
  RequestBoundary.respond (requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Read

Authored path: `Learning.Read`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 46.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 97.

```reaction
when RequestBoundary.request (path: "/learning/read", requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Read:missing#2

Authored path: `Learning.Read`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 46.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 97.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Read
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (path: "/learning/read", requestId, session, skill)
  no view "(owner) owns study skill (skill)" with (owner, skill)
then
  RequestBoundary.respond (error: "SKILL_UNAVAILABLE", requestId)
```

### Learning.Read:owned#2

Authored path: `Learning.Read`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 46.
- Covered by [Learning flows](../design/compositions/Learning.md), line 5.
- Covered by [Learning flows](../design/compositions/Learning.md), line 97.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Read
at the flow's settlement frontier
where
  at is the current flow's instant
  earlier, RequestBoundary.request (path: "/learning/read", requestId, session, skill)
  view "(owner) owns study skill (skill)" with (owner, skill)
then
  RequestBoundary.respond (data: former "study data for (owner) and (skill) at (at)" with (at, owner, skill), requestId)
```

### Learning.Regrade

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  Sessioning.use (session)
```

### Learning.Regrade:imported#2

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Regrade
where
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
  view "(owner) owns practice or imported assessment (assessment)" with (assessment: case, owner) has (imported: true)
then
  RequestBoundary.respond (error: "REGRADE_IMPORTED_UNAVAILABLE", requestId)
```

### Learning.Regrade:imported#3

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.respond (error: "REGRADE_IMPORTED_UNAVAILABLE", requestId), asked by Learning.Regrade:imported#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Regrade
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
  view "(owner) owns assessment (assessment)" with (assessment: case, owner) has (course, task)
  AssessmentReviewing._caseData (case) has (data)
  GroundedTutoring._sessionData (session: task) has (data: sessionData)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  draft is gradeRequest (data, selected)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Regrade:imported#4

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade:imported#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Regrade
then
  Sessioning.use (session)
```

### Learning.Regrade:imported#5

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Regrade:imported#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade:imported#3
  (gateMet, rationale, result) is generationFields (answer)
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "AI", rationale, result)
```

### Learning.Regrade:imported#6

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "AI", rationale, result, judgment), asked by Learning.Regrade:imported#5
at the flow's settlement frontier
where
  earlier, RequestBoundary.respond (error: "REGRADE_IMPORTED_UNAVAILABLE", requestId), asked by Learning.Regrade:imported#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade:imported#3
then
  RequestBoundary.respond (judgment, requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Regrade:practice#2

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Regrade
where
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
  view "(owner) owns assessment (assessment)" with (assessment: case, owner)
  AssessmentReviewing._effectiveJudgment (case) has (judgment: basedOn)
  clarification is correctionNote (reason)
then
  AssessmentReviewing.clarify (author: owner, case, clarification)
```

### Learning.Regrade:practice#3

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when AssessmentReviewing.clarify (author: owner, case, clarification), asked by Learning.Regrade:practice#2
where
  view "(owner) owns assessment (assessment)" with (assessment: case, owner) has (course, task)
  AssessmentReviewing._caseData (case) has (data)
  GroundedTutoring._sessionData (session: task) has (data: sessionData)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  draft is gradeRequest (data, selected)
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Regrade:practice#4

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade:practice#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Regrade
then
  Sessioning.use (session)
```

### Learning.Regrade:practice#5

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Regrade:practice#4
where
  earlier, AssessmentReviewing.clarify (author: owner, case, clarification), asked by Learning.Regrade:practice#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade:practice#3
  (gateMet, rationale, result) is generationFields (answer)
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "AI", rationale, result)
```

### Learning.Regrade:practice#6

Authored path: `Learning.Regrade`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 86.
- Covered by [Learning flows](../design/compositions/Learning.md), line 84.
- Covered by [Learning flows](../design/compositions/Learning.md), line 110.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "AI", rationale, result, judgment), asked by Learning.Regrade:practice#5
at the flow's settlement frontier
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade:practice#3
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  RequestBoundary.respond (judgment, requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.ReplanAfterAdjustment

Authored path: `Learning.ReplanAfterAdjustment`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 46.

```reaction
when MasteryEstimating.adjust (learner: owner, subject: skill)
at the flow's settlement frontier
where
  view "(owner) owns study skill (skill)" with (owner, skill) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Learning.Reply

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 104.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 135.

```reaction
when RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
then
  Sessioning.use (session)
```

### Learning.Reply#2

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 104.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 135.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Reply
where
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  hasLessonQuestion (data)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data)
  (selected, valid: true) is selectSources (materials, sources)
  draft is sessionRequest (data, kind: "REPLY", selected)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Reply#3

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 104.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 135.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Reply#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Reply
then
  Sessioning.use (session)
```

### Learning.Reply:closed#4

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 104.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 135.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Reply#3
where
  earlier, RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
  no view "(owner) can change session (studySession)" with (owner, studySession)
then
  RequestBoundary.respond (error: "SESSION_CHANGED", requestId)
```

### Learning.Reply:open#4

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 104.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 135.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Reply#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Reply#2
  (citations, text) is generationFields (answer)
  earlier, RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
  view "(owner) can change session (studySession)" with (owner, studySession)
then
  GroundedTutoring.answerLesson (channel: "TEXT", citations, lesson: studySession, owner, text)
```

### Learning.Reply:open#5

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 104.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 135.

```reaction
when GroundedTutoring.answerLesson (channel: "TEXT", citations, lesson: studySession, owner, text), asked by Learning.Reply:open#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Reply#2
  earlier, RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
then
  RequestBoundary.respond (requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Respond

Authored path: `Learning.Respond`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 102.

```reaction
when RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/respond", requestId, session, studySession, text)
then
  Sessioning.use (session)
```

### Learning.Respond#2

Authored path: `Learning.Respond`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 102.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Respond
where
  earlier, RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/respond", requestId, session, studySession, text)
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  Library._sourceSet (owner, scope: course) has (sources)
  currentDialogue is dialogueIsCurrent (data, dialogueLength)
  currentDialogue is among [true]
  (media, valid: true) is responseInput (attachments, channel, data, sources, text)
then
  GroundedTutoring.respond (channel, media, owner, session: studySession, text)
```

### Learning.Respond#3

Authored path: `Learning.Respond`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 102.

```reaction
when GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Respond#2
where
  earlier, RequestBoundary.request (attachments, channel, dialogueLength, path: "/learning/respond", requestId, session, studySession, text)
then
  RequestBoundary.respond (requestId)
```

### Learning.RetryAssessment

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 108.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
then
  Sessioning.use (session)
```

### Learning.RetryAssessment#2

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 108.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.RetryAssessment
where
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
  view "(owner) owns study session (studySession)" with (owner, studySession) has (course)
  AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
  no AssessmentReviewing._effectiveJudgment (case: assessment)
  AssessmentReviewing._caseData (case: assessment) has (data)
  GroundedTutoring._sessionData (session: studySession) has (data: sessionData)
  Library._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  draft is gradeRequest (data, selected)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.RetryAssessment#3

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 108.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.RetryAssessment#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.RetryAssessment
then
  Sessioning.use (session)
```

### Learning.RetryAssessment#4

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 108.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.RetryAssessment#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.RetryAssessment#2
  (gateMet, rationale, result) is generationFields (answer)
  earlier, RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
  AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
then
  AssessmentReviewing.assess (case: assessment, gateMet, rationale, result)
```

### Learning.RetryAssessment#5

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 27.
- Covered by [Learning flows](../design/compositions/Learning.md), line 108.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when AssessmentReviewing.assess (case: assessment, gateMet, rationale, result), asked by Learning.RetryAssessment#4
at the flow's settlement frontier
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.RetryAssessment#2
  earlier, RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
then
  RequestBoundary.respond (requestId, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Suggest

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
then
  Sessioning.use (session)
```

### Learning.Suggest:graded#2

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
  Library._material (material) has (owner, scope: course, title)
  view "(owner) owns (course) with (title)" with (course, owner)
  graded is gradedTitle (title)
  graded is among [true]
then
  RequestBoundary.respond (error: "GRADED_MATERIAL_NOT_SOURCE", requestId)
```

### Learning.Suggest:graded#3

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when RequestBoundary.respond (error: "GRADED_MATERIAL_NOT_SOURCE", requestId), asked by Learning.Suggest:graded#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Suggest
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
  Library._material (material) has (owner, scope: course, title)
  view "(owner) owns (course) with (title)" with (course, owner)
  graded is gradedTitle (title)
  graded is among [false]
  Library._sourceSet (owner, scope: course) has (sources)
  materials is singleMaterial (material)
  (selected, valid: true) is selectSources (materials, sources)
  draft is suggestRequest (selected)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Suggest:graded#4

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Suggest:graded#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Suggest
then
  Sessioning.use (session)
```

### Learning.Suggest:graded#5

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest:graded#4
where
  earlier, RequestBoundary.respond (error: "GRADED_MATERIAL_NOT_SOURCE", requestId), asked by Learning.Suggest:graded#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Suggest:graded#3
  (suggestions) is generationFields (answer)
then
  RequestBoundary.respond (requestId, suggestions, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Suggest:source#2

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
  Library._material (material) has (owner, scope: course, title)
  view "(owner) owns (course) with (title)" with (course, owner)
  graded is gradedTitle (title)
  graded is among [false]
then
  Sessioning.use (session)
```

### Learning.Suggest:source#3

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest:source#2
where
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
  Library._material (material) has (owner, scope: course, title)
  view "(owner) owns (course) with (title)" with (course, owner)
  graded is gradedTitle (title)
  graded is among [false]
  Library._sourceSet (owner, scope: course) has (sources)
  materials is singleMaterial (material)
  (selected, valid: true) is selectSources (materials, sources)
  draft is suggestRequest (selected)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Suggest:source#4

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Suggest:source#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Suggest
then
  Sessioning.use (session)
```

### Learning.Suggest:source#5

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skills](../design/compositions/Courses.md), line 19.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 21.
- Covered by [Learning flows](../design/compositions/Learning.md), line 88.
- Covered by [Learning flows](../design/compositions/Learning.md), line 112.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.
- Covered by [P2 learning journey](../design/stages/materials.md), line 123.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest:source#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Suggest:source#3
  (suggestions) is generationFields (answer)
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
then
  RequestBoundary.respond (requestId, suggestions, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Task

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 101.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when RequestBoundary.request (path: "/learning/task", requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Task#2

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 101.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Task
where
  view "the tutor choice that applies to (owner)" with (owner) has (choice, status)
  status is among ["SAVED", "DEFAULT"]
  earlier, RequestBoundary.request (path: "/learning/task", requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
  view "the current context of (skill) for (owner)" with (owner, skill) has (context, skills, sources, tracks)
  MasteryEstimating._track (definition, learner: owner, subject: skill)
  prerequisitesReady (skill, skills, tracks)
  GroundedTutoring._study (owner, topic: skill) has (sessions)
  materials is selectSkillMaterials (context)
  (selected, valid: true) is selectSources (materials, sources)
  draft is taskRequest (context, selected, sessions)
  prepared is withChoice (choice, request: draft)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Task#3

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 101.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Task#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Task
then
  Sessioning.use (session)
```

### Learning.Task:changed#4

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 101.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Task#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Task#2
  (definition) is generationDefinition (request: prepared)
  earlier, RequestBoundary.request (path: "/learning/task", requestId, session, skill)
  no view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
then
  RequestBoundary.respond (error: "SKILL_CHANGED", requestId)
```

### Learning.Task:current#4

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 101.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Task#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Task#2
  (criteria, definition) is generationDefinition (request: prepared)
  (citations, materials, text: question) is generationFields (answer)
  earlier, RequestBoundary.request (path: "/learning/task", requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
then
  GroundedTutoring.prepareTask (citations, criteria, definition, fresh: true, materials, mode: "CHECK", owner, question, topic: skill)
```

### Learning.Task:current#5

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 7.
- Covered by [Learning flows](../design/compositions/Learning.md), line 101.
- Covered by [Importing and viewing materials](../design/compositions/Materials.md), line 117.

```reaction
when GroundedTutoring.prepareTask (citations, criteria, definition, fresh: true, materials, mode: "CHECK", owner, question, topic: skill, task), asked by Learning.Task:current#4
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Task#2
  earlier, RequestBoundary.request (path: "/learning/task", requestId, session, skill)
then
  RequestBoundary.respond (requestId, task, tutor: former "the tutor choice that (request) carried" with (request: prepared))
```

### Learning.Transcript

Authored path: `Learning.Transcript`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 106.

```reaction
when RequestBoundary.request (path: "/learning/transcript", requestId, session, studySession, text, turnIndex)
then
  Sessioning.use (session)
```

### Learning.Transcript:missing#2

Authored path: `Learning.Transcript`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 106.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Transcript
where
  earlier, RequestBoundary.request (path: "/learning/transcript", requestId, session, studySession, text, turnIndex)
  no view "(owner) can change session (studySession)" with (owner, studySession)
then
  RequestBoundary.respond (error: "SESSION_UNAVAILABLE", requestId)
```

### Learning.Transcript:owned#2

Authored path: `Learning.Transcript`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 106.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Transcript
where
  earlier, RequestBoundary.request (path: "/learning/transcript", requestId, session, studySession, text, turnIndex)
  view "(owner) can change session (studySession)" with (owner, studySession)
then
  GroundedTutoring.confirmTranscript (owner, session: studySession, text, turnIndex)
```

### Learning.Transcript:owned#3

Authored path: `Learning.Transcript`.
- Covered by [Learning flows](../design/compositions/Learning.md), line 11.
- Covered by [Learning flows](../design/compositions/Learning.md), line 106.

```reaction
when GroundedTutoring.confirmTranscript (owner, session: studySession, text, turnIndex), asked by Learning.Transcript:owned#2
where
  earlier, RequestBoundary.request (path: "/learning/transcript", requestId, session, studySession, text, turnIndex)
then
  RequestBoundary.respond (requestId)
```

### Planning.Begin

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 73.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 89.

```reaction
when RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Begin:missing#2

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 73.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 89.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Begin
where
  earlier, RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Begin:owned#2

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 73.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 89.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Begin
where
  earlier, RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  view "(owner) may start (item) in (course)" with (course, item, owner)
then
  StudyPlanning.begin (item, owner)
```

### Planning.Begin:owned#3

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 73.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 89.

```reaction
when StudyPlanning.begin (item, owner), asked by Planning.Begin:owned#2
where
  earlier, RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Configure

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 19.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 87.

```reaction
when RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Configure:missing#2

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 19.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 87.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Configure
where
  earlier, RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Configure:missing#3

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 19.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 87.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.Configure:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.Configure
  earlier, RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._preferences (owner, scope: course) has (dailyMinutes, focusNote, preferences)
then
  RequestBoundary.respond (preferences, requestId)
```

### Planning.Configure:owned#2

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 19.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 87.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Configure
where
  earlier, RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  StudyPlanning.configure (dailyMinutes, focusNote, owner, scope: course)
```

### Planning.Configure:owned#3

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 19.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 87.

```reaction
when StudyPlanning.configure (dailyMinutes, focusNote, owner, scope: course), asked by Planning.Configure:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._preferences (owner, scope: course) has (dailyMinutes, focusNote, preferences)
  earlier, RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
then
  RequestBoundary.respond (preferences, requestId)
```

### Planning.ConfirmTradeoffs

Authored path: `Planning.ConfirmTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 65.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 95.

```reaction
when RequestBoundary.request (course, path: "/planning/tradeoffs/confirm", plan, requestId, session)
then
  Sessioning.use (session)
```

### Planning.ConfirmTradeoffs:missing#2

Authored path: `Planning.ConfirmTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 65.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 95.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.ConfirmTradeoffs
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/confirm", plan, requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.ConfirmTradeoffs:owned#2

Authored path: `Planning.ConfirmTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 65.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 95.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.ConfirmTradeoffs
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/confirm", plan, requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._plan (plan) has (owner, scope: course)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis: currentBasis)
then
  StudyPlanning.confirmTradeoffs (currentBasis, owner, plan)
```

### Planning.ConfirmTradeoffs:owned#3

Authored path: `Planning.ConfirmTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 65.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 95.

```reaction
when StudyPlanning.confirmTradeoffs (currentBasis, owner, plan), asked by Planning.ConfirmTradeoffs:owned#2
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/confirm", plan, requestId, session)
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.ConfirmTradeoffs:plan#2

Authored path: `Planning.ConfirmTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 65.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 95.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.ConfirmTradeoffs
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/confirm", plan, requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  no StudyPlanning._plan (plan) has (owner, scope: course)
then
  RequestBoundary.respond (detail: "Choose one of your proposed plans.", error: "PROPOSAL_UNAVAILABLE", requestId)
```

### Planning.DeclineTradeoffs

Authored path: `Planning.DeclineTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 67.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 96.

```reaction
when RequestBoundary.request (course, path: "/planning/tradeoffs/decline", plan, requestId, session)
then
  Sessioning.use (session)
```

### Planning.DeclineTradeoffs:missing#2

Authored path: `Planning.DeclineTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 67.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 96.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.DeclineTradeoffs
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/decline", plan, requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.DeclineTradeoffs:owned#2

Authored path: `Planning.DeclineTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 67.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 96.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.DeclineTradeoffs
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/decline", plan, requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._plan (plan) has (owner, scope: course)
then
  StudyPlanning.declineTradeoffs (owner, plan)
```

### Planning.DeclineTradeoffs:owned#3

Authored path: `Planning.DeclineTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 67.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 96.

```reaction
when StudyPlanning.declineTradeoffs (owner, plan), asked by Planning.DeclineTradeoffs:owned#2
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/decline", plan, requestId, session)
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.DeclineTradeoffs:plan#2

Authored path: `Planning.DeclineTradeoffs`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 67.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 96.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.DeclineTradeoffs
where
  earlier, RequestBoundary.request (course, path: "/planning/tradeoffs/decline", plan, requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  no StudyPlanning._plan (plan) has (owner, scope: course)
then
  RequestBoundary.respond (detail: "Choose one of your proposed plans.", error: "PROPOSAL_UNAVAILABLE", requestId)
```

### Planning.Finish

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 90.

```reaction
when RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Finish:missing#2

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 90.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Finish
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Finish:missing#3

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 90.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.Finish:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.Finish
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (owner, scope: course, status: "DONE")
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Finish:owned#2

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 90.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Finish
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (owner, scope: course)
then
  StudyPlanning.finish (actualMinutes, item, owner)
```

### Planning.Finish:owned#3

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 90.

```reaction
when StudyPlanning.finish (actualMinutes, item, owner), asked by Planning.Finish:owned#2
at the flow's settlement frontier
where
  StudyPlanning._item (item) has (owner, scope: course, status: "DONE")
  view "(owner) owns (course) with (title)" with (course, owner)
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Miss

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 92.

```reaction
when RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Miss:missing#2

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Miss
where
  earlier, RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Miss:missing#3

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 92.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.Miss:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.Miss
  earlier, RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (owner, scope: course, status: "MISSED")
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Miss:owned#2

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 92.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Miss
where
  earlier, RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (owner, scope: course)
then
  StudyPlanning.miss (item, owner)
```

### Planning.Miss:owned#3

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 92.

```reaction
when StudyPlanning.miss (item, owner), asked by Planning.Miss:owned#2
at the flow's settlement frontier
where
  StudyPlanning._item (item) has (owner, scope: course, status: "MISSED")
  view "(owner) owns (course) with (title)" with (course, owner)
  earlier, RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Propose

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when RequestBoundary.request (course, path: "/planning/propose", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Propose:missing#2

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Propose
where
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Propose:missing:active#3

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.Propose:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.Propose
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  no StudyPlanning._plans (owner, scope: course) has (status: "PROPOSED")
  StudyPlanning._plans (owner, scope: course) has (plan, status: "ACTIVE")
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.Propose:missing:proposed#3

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.Propose:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.Propose
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._plans (owner, scope: course) has (plan, status: "PROPOSED")
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.Propose:owned#2

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Propose
where
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Planning.Propose:owned:active#3

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false), asked by Planning.Propose:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  no StudyPlanning._plans (owner, scope: course) has (status: "PROPOSED")
  StudyPlanning._plans (owner, scope: course) has (plan, status: "ACTIVE")
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.Propose:owned:proposed#3

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 21.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 88.

```reaction
when StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false), asked by Planning.Propose:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._plans (owner, scope: course) has (plan, status: "PROPOSED")
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.Read

Authored path: `Planning.Read`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 86.

```reaction
when RequestBoundary.request (course, path: "/planning/read", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Read:missing#2

Authored path: `Planning.Read`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 86.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Read
where
  earlier, RequestBoundary.request (course, path: "/planning/read", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Read:owned#2

Authored path: `Planning.Read`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 7.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 86.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Read
where
  earlier, RequestBoundary.request (course, path: "/planning/read", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (cuts: former "the cuts of the proposal awaiting confirmation for (owner) in (course)" with (course, owner), data: former "study plan for (owner) in (course)" with (course, owner), exams: former "the active exams for (owner) in (course)" with (course, owner), proposal: former "the proposal awaiting confirmation for (owner) in (course)" with (course, owner), proposalItems: former "the activities of the proposal awaiting confirmation for (owner) in (course)" with (course, owner), requestId)
```

### Planning.RemoveExam

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
then
  Sessioning.use (session)
```

### Planning.RemoveExam:missing#2

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.RemoveExam
where
  earlier, RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.RemoveExam:missing:refreshed#3

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.RemoveExam:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.RemoveExam
  no view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._deadlines (owner, scope: course) has (active: false, date, deadline: exam)
then
  RequestBoundary.respond (exam, refreshed: true, requestId)
```

### Planning.RemoveExam:missing:waiting#3

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.RemoveExam:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.RemoveExam
  view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._deadlines (owner, scope: course) has (active: false, date, deadline: exam)
then
  RequestBoundary.respond (exam, notice: "Your plan will update when you finish or stop your current activity.", refreshed: false, requestId)
```

### Planning.RemoveExam:owned#2

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.RemoveExam
where
  earlier, RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  StudyPlanning.removeDeadline (date, owner, scope: course)
```

### Planning.RemoveExam:owned:refreshed#3

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when StudyPlanning.removeDeadline (date, owner, scope: course), asked by Planning.RemoveExam:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._deadlines (owner, scope: course) has (active: false, date, deadline: exam)
  no view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
then
  RequestBoundary.respond (exam, refreshed: true, requestId)
```

### Planning.RemoveExam:owned:waiting#3

Authored path: `Planning.RemoveExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 27.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 94.

```reaction
when StudyPlanning.removeDeadline (date, owner, scope: course), asked by Planning.RemoveExam:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._deadlines (owner, scope: course) has (active: false, date, deadline: exam)
  view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, date, path: "/planning/exams/remove", requestId, session)
then
  RequestBoundary.respond (exam, notice: "Your plan will update when you finish or stop your current activity.", refreshed: false, requestId)
```

### Planning.ReplanAfterExam

Authored path: `Planning.ReplanAfterExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 31.

```reaction
when StudyPlanning.setDeadline (owner, scope: course)
where
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  no view "(owner) has an activity in progress" with (owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Planning.ReplanAfterExamRemoval

Authored path: `Planning.ReplanAfterExamRemoval`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 33.

```reaction
when StudyPlanning.removeDeadline (owner, scope: course)
where
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  no view "(owner) has an activity in progress" with (owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Planning.SetExam

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
then
  Sessioning.use (session)
```

### Planning.SetExam:missing#2

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.SetExam
where
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.SetExam:missing:refreshed#3

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.SetExam:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.SetExam
  no view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
  StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
then
  RequestBoundary.respond (exam, refreshed: true, requestId)
```

### Planning.SetExam:missing:waiting#3

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.SetExam:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.SetExam
  view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
  StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
then
  RequestBoundary.respond (exam, notice: "Your plan will update when you finish or stop your current activity.", refreshed: false, requestId)
```

### Planning.SetExam:owned#2

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.SetExam
where
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
then
  StudyPlanning.setDeadline (covered, date, owner, scope: course)
```

### Planning.SetExam:owned:refreshed#3

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when StudyPlanning.setDeadline (covered, date, owner, scope: course), asked by Planning.SetExam:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
  StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
  no view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
then
  RequestBoundary.respond (exam, refreshed: true, requestId)
```

### Planning.SetExam:owned:waiting#3

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when StudyPlanning.setDeadline (covered, date, owner, scope: course), asked by Planning.SetExam:owned#2
at the flow's settlement frontier
where
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
  StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
  view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
then
  RequestBoundary.respond (exam, notice: "Your plan will update when you finish or stop your current activity.", refreshed: false, requestId)
```

### Planning.SetExam:skills#2

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.SetExam
where
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [false]
then
  RequestBoundary.respond (detail: "Choose confirmed skills from this course, each once.", error: "EXAM_SKILLS_UNAVAILABLE", requestId)
```

### Planning.SetExam:skills:refreshed#3

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when RequestBoundary.respond (detail: "Choose confirmed skills from this course, each once.", error: "EXAM_SKILLS_UNAVAILABLE", requestId), asked by Planning.SetExam:skills#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.SetExam
  no view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
  StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
then
  RequestBoundary.respond (exam, refreshed: true, requestId)
```

### Planning.SetExam:skills:waiting#3

Authored path: `Planning.SetExam`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 25.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 93.

```reaction
when RequestBoundary.respond (detail: "Choose confirmed skills from this course, each once.", error: "EXAM_SKILLS_UNAVAILABLE", requestId), asked by Planning.SetExam:skills#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.SetExam
  view "(owner) has an activity in progress" with (owner)
  earlier, RequestBoundary.request (course, covered, date, path: "/planning/exams/set", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  SkillMapping._map (course) has (skills)
  confirmed is coveredSkillsConfirmed (covered, skills)
  confirmed is among [true]
  StudyPlanning._deadlines (owner, scope: course) has (active: true, covered, date, deadline: exam)
then
  RequestBoundary.respond (exam, notice: "Your plan will update when you finish or stop your current activity.", refreshed: false, requestId)
```

### Planning.Stop

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 91.

```reaction
when RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Stop:missing#2

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Stop
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Stop:missing#3

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 91.

```reaction
when RequestBoundary.respond (detail: "Choose one of your own courses.", error: "COURSE_UNAVAILABLE", requestId), asked by Planning.Stop:missing#2
at the flow's settlement frontier
where
  earlier, Sessioning.use (session, subject: owner), asked by Planning.Stop
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (owner, scope: course, status: "STOPPED")
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Stop:owned#2

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 91.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Stop
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (owner, scope: course)
then
  StudyPlanning.stop (actualMinutes, item, owner)
```

### Planning.Stop:owned#3

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 77.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 91.

```reaction
when StudyPlanning.stop (actualMinutes, item, owner), asked by Planning.Stop:owned#2
at the flow's settlement frontier
where
  StudyPlanning._item (item) has (owner, scope: course, status: "STOPPED")
  view "(owner) owns (course) with (title)" with (course, owner)
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Progress.ActivateRoutine

Authored path: `Progress.ActivateRoutine`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 35.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 47.

```reaction
when StudyPlanning.replan (owner, scope: course, workloadComplete: false, plan)
where
  view "review inputs for (owner) in (course)" with (course, owner) has (basis: currentBasis)
  StudyPlanning._proposalCheck (currentBasis, owner, plan) has (canActivate: true, needsConfirmation: false)
then
  StudyPlanning.activateRoutine (currentBasis, owner, plan)
```

### Progress.AssessedEvidence

Authored path: `Progress.AssessedEvidence`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 17.

```reaction
when AssessmentReviewing.assess (case: assessment)
where
  AssessmentReviewing._case (case: assessment) has (author: owner)
  view "assessment (assessment) needs evidence for (owner)" with (assessment, owner) has (definition, fresh, gateMet, origin, performedAt, rationale, result, revision, skill)
  attribution is evidenceAttribution (origin, rationale)
then
  MasteryEstimating.acceptEvidence (attribution, definition, evidence: assessment, fresh, gateMet, learner: owner, performedAt, revision, signal: result, subject: skill)
```

### Progress.CloseSubmitted

Authored path: `Progress.CloseSubmitted`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 11.

```reaction
when AssessmentReviewing.submit (author: owner, task)
where
  GroundedTutoring._session (session: task) has (owner, status: "OPEN")
then
  GroundedTutoring.close (owner, session: task)
```

### Progress.ImportedEvidence

Authored path: `Progress.ImportedEvidence`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 3.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 23.

```reaction
when AssessmentReviewing.importGraded (author: owner, case: assessment)
where
  view "assessment (assessment) needs evidence for (owner)" with (assessment, owner) has (definition, fresh, gateMet, origin, performedAt, rationale, result, revision, skill)
  attribution is evidenceAttribution (origin, rationale)
then
  MasteryEstimating.acceptEvidence (attribution, definition, evidence: assessment, fresh, gateMet, learner: owner, performedAt, revision, signal: result, subject: skill)
```

### Progress.InitializedEvidence

Authored path: `Progress.InitializedEvidence`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 76.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 27.

```reaction
when MasteryEstimating.initialize (definition, learner: owner, subject: skill)
where
  AssessmentReviewing._cases (author: owner, subject: skill) has (case: assessment)
  view "assessment (assessment) needs evidence for (owner)" with (assessment, owner) has (definition, fresh, gateMet, origin, performedAt, rationale, result, revision, skill)
  attribution is evidenceAttribution (origin, rationale)
then
  MasteryEstimating.acceptEvidence (attribution, definition, evidence: assessment, fresh, gateMet, learner: owner, performedAt, revision, signal: result, subject: skill)
```

### Progress.RepairReadClosure

Authored path: `Progress.RepairReadClosure`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 67.

```reaction
when any action is returned (action: "use", concept: "Sessioning", result: identity)
where
  (owner) is sessionSubject (identity)
  SkillMapping._courses (owner) has (course)
  SkillMapping._units (course) has (unit)
  SkillMapping._skills (unit) has (skill)
  AssessmentReviewing._cases (author: owner, subject: skill) has (case: assessment)
  AssessmentReviewing._case (case: assessment) has (task)
  GroundedTutoring._session (session: task) has (owner, status: "OPEN")
then
  GroundedTutoring.close (owner, session: task)
```

### Progress.RepairReadEvidence

Authored path: `Progress.RepairReadEvidence`.
- Covered by [Importing graded work](../design/compositions/Importing.md), line 78.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 65.

```reaction
when any action is returned (action: "use", concept: "Sessioning", result: identity)
where
  (owner) is sessionSubject (identity)
  SkillMapping._courses (owner) has (course)
  SkillMapping._units (course) has (unit)
  SkillMapping._skills (unit) has (skill)
  AssessmentReviewing._cases (author: owner, subject: skill) has (case: assessment)
  view "assessment (assessment) needs evidence for (owner)" with (assessment, owner) has (definition, fresh, gateMet, origin, performedAt, rationale, result, revision, skill)
  attribution is evidenceAttribution (origin, rationale)
then
  MasteryEstimating.acceptEvidence (attribution, definition, evidence: assessment, fresh, gateMet, learner: owner, performedAt, revision, signal: result, subject: skill)
```

### Progress.ReplanAfterBudget

Authored path: `Progress.ReplanAfterBudget`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 43.

```reaction
when StudyPlanning.configure (owner, scope: course)
where
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterConfidence

Authored path: `Progress.ReplanAfterConfidence`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 39.

```reaction
when MasteryEstimating.initialize (learner: owner, subject: skill)
at the flow's settlement frontier
where
  view "(owner) owns study skill (skill)" with (owner, skill) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterEvidence

Authored path: `Progress.ReplanAfterEvidence`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 37.

```reaction
when MasteryEstimating.acceptEvidence (learner: owner, subject: skill)
at the flow's settlement frontier
where
  view "(owner) owns study skill (skill)" with (owner, skill) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterFinish

Authored path: `Progress.ReplanAfterFinish`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 37.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 53.

```reaction
when StudyPlanning.finish (owner)
where
  SkillMapping._courses (owner) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterMiss

Authored path: `Progress.ReplanAfterMiss`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 59.

```reaction
when StudyPlanning.miss (item, owner)
where
  StudyPlanning._item (item) has (owner, scope: course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterStop

Authored path: `Progress.ReplanAfterStop`.
- Covered by [Daily planning flows](../design/compositions/Planning.md), line 37.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 55.

```reaction
when StudyPlanning.stop (owner)
where
  SkillMapping._courses (owner) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, owner, scope: course, workloadComplete: false)
```

### Progress.RevisedEvidence

Authored path: `Progress.RevisedEvidence`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 21.

```reaction
when AssessmentReviewing.revise (author: owner, case: assessment)
where
  view "assessment (assessment) needs evidence for (owner)" with (assessment, owner) has (definition, fresh, gateMet, origin, performedAt, rationale, result, revision, skill)
  attribution is evidenceAttribution (origin, rationale)
then
  MasteryEstimating.acceptEvidence (attribution, definition, evidence: assessment, fresh, gateMet, learner: owner, performedAt, revision, signal: result, subject: skill)
```

### Progress.SubmitReviewed

Authored path: `Progress.SubmitReviewed`.
- Covered by [Progress reactions](../design/compositions/Progress.md), line 7.

```reaction
when GroundedTutoring.confirmAttempt (outsideHelp, owner, task, unseen)
where
  view "(owner) can change session (studySession)" with (owner, studySession: task) has (definition, skill)
  GroundedTutoring._review (task) has (ready: true)
  MasteryEstimating._track (definition, learner: owner, subject: skill)
  GroundedTutoring._task (task) has (criteria, question)
  GroundedTutoring._sessionData (session: task) has (data)
  at is the current flow's instant
  (fresh, help, response, sourceKey) is submissionInput (data, outsideHelp, unseen)
then
  AssessmentReviewing.submit (author: owner, criteria, definition, fresh, help, performedAt: at, question, response, sourceKey, subject: skill, task)
```

### Settings.ChooseTutor

Authored path: `Settings.ChooseTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 66.
- Covered by [Settings](../design/compositions/Settings.md), line 190.

```reaction
when RequestBoundary.request (level, model, path: "/settings/tutor/choose", requestId, session)
then
  Sessioning.use (session)
```

### Settings.ChooseTutor:level#2

Authored path: `Settings.ChooseTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 66.
- Covered by [Settings](../design/compositions/Settings.md), line 190.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.ChooseTutor
where
  earlier, RequestBoundary.request (level, model, path: "/settings/tutor/choose", requestId, session)
  known is modelOffered (model)
  known is among [true]
  listed is levelSupported (level, model)
  listed is among [false]
then
  RequestBoundary.respond (error: "UNSUPPORTED_THINKING_LEVEL", requestId)
```

### Settings.ChooseTutor:offered#2

Authored path: `Settings.ChooseTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 66.
- Covered by [Settings](../design/compositions/Settings.md), line 190.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.ChooseTutor
where
  earlier, RequestBoundary.request (level, model, path: "/settings/tutor/choose", requestId, session)
  known is modelOffered (model)
  known is among [true]
  listed is levelSupported (level, model)
  listed is among [true]
  choice is offeredChoice (level, model)
then
  TutorPreferring.set (option: choice, user: owner)
```

### Settings.ChooseTutor:offered#3

Authored path: `Settings.ChooseTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 66.
- Covered by [Settings](../design/compositions/Settings.md), line 190.

```reaction
when TutorPreferring.set (option: choice, user: owner), asked by Settings.ChooseTutor:offered#2
where
  earlier, RequestBoundary.request (level, model, path: "/settings/tutor/choose", requestId, session)
then
  RequestBoundary.respond (requestId, settings: former "the tutor settings for (owner)" with (owner))
```

### Settings.ChooseTutor:unknown#2

Authored path: `Settings.ChooseTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 66.
- Covered by [Settings](../design/compositions/Settings.md), line 190.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.ChooseTutor
where
  earlier, RequestBoundary.request (level, model, path: "/settings/tutor/choose", requestId, session)
  known is modelOffered (model)
  known is among [false]
then
  RequestBoundary.respond (error: "UNKNOWN_TUTOR_MODEL", requestId)
```

### Settings.ClearTutor

Authored path: `Settings.ClearTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 74.
- Covered by [Settings](../design/compositions/Settings.md), line 191.

```reaction
when RequestBoundary.request (path: "/settings/tutor/clear", requestId, session)
then
  Sessioning.use (session)
```

### Settings.ClearTutor#2

Authored path: `Settings.ClearTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 74.
- Covered by [Settings](../design/compositions/Settings.md), line 191.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.ClearTutor
then
  TutorPreferring.clear (user: owner)
```

### Settings.ClearTutor#3

Authored path: `Settings.ClearTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 74.
- Covered by [Settings](../design/compositions/Settings.md), line 191.

```reaction
when TutorPreferring.clear (user: owner), asked by Settings.ClearTutor#2
where
  earlier, RequestBoundary.request (path: "/settings/tutor/clear", requestId, session)
then
  RequestBoundary.respond (requestId, settings: former "the tutor settings for (owner)" with (owner))
```

### Settings.ReadHomeView

Authored path: `Settings.ReadHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 159.
- Covered by [Settings](../design/compositions/Settings.md), line 192.

```reaction
when RequestBoundary.request (path: "/settings/view", requestId, session)
then
  Sessioning.use (session)
```

### Settings.ReadHomeView#2

Authored path: `Settings.ReadHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 159.
- Covered by [Settings](../design/compositions/Settings.md), line 192.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.ReadHomeView
where
  view "the home view that applies to (owner)" with (owner) has (view: shown)
  earlier, RequestBoundary.request (path: "/settings/view", requestId, session)
then
  RequestBoundary.respond (requestId, view: shown)
```

### Settings.ReadTutor

Authored path: `Settings.ReadTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 64.
- Covered by [Settings](../design/compositions/Settings.md), line 189.

```reaction
when RequestBoundary.request (path: "/settings/tutor", requestId, session)
then
  Sessioning.use (session)
```

### Settings.ReadTutor#2

Authored path: `Settings.ReadTutor`.
- Covered by [Settings](../design/compositions/Settings.md), line 64.
- Covered by [Settings](../design/compositions/Settings.md), line 189.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.ReadTutor
where
  earlier, RequestBoundary.request (path: "/settings/tutor", requestId, session)
then
  RequestBoundary.respond (requestId, settings: former "the tutor settings for (owner)" with (owner))
```

### Settings.SetHomeView

Authored path: `Settings.SetHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 161.
- Covered by [Settings](../design/compositions/Settings.md), line 193.

```reaction
when RequestBoundary.request (path: "/settings/view/set", requestId, session, view)
then
  Sessioning.use (session)
```

### Settings.SetHomeView:offered#2

Authored path: `Settings.SetHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 161.
- Covered by [Settings](../design/compositions/Settings.md), line 193.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.SetHomeView
where
  earlier, RequestBoundary.request (path: "/settings/view/set", requestId, session, view)
  offered is homeViewOffered (view)
  offered is among [true]
  chosen is offeredHomeView (view)
then
  ViewPreferring.set (option: chosen, user: owner)
```

### Settings.SetHomeView:offered#3

Authored path: `Settings.SetHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 161.
- Covered by [Settings](../design/compositions/Settings.md), line 193.

```reaction
when ViewPreferring.set (option: chosen, user: owner), asked by Settings.SetHomeView:offered#2
where
  earlier, RequestBoundary.request (path: "/settings/view/set", requestId, session, view)
then
  RequestBoundary.respond (requestId, view: chosen)
```

### Settings.SetHomeView:unknown#2

Authored path: `Settings.SetHomeView`.
- Covered by [Settings](../design/compositions/Settings.md), line 161.
- Covered by [Settings](../design/compositions/Settings.md), line 193.

```reaction
when Sessioning.use (session, subject: owner), asked by Settings.SetHomeView
where
  earlier, RequestBoundary.request (path: "/settings/view/set", requestId, session, view)
  offered is homeViewOffered (view)
  offered is among [false]
then
  RequestBoundary.respond (error: "UNKNOWN_HOME_VIEW", requestId)
```

### reusable.accounts.identifying.Me

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 84.
- Covered by [P2 learning journey](../design/stages/materials.md), line 91.

```reaction
when RequestBoundary.request (path: "/auth/me", requestId, session)
then
  Sessioning.use (session)
```

### reusable.accounts.identifying.Me:known#2

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 84.
- Covered by [P2 learning journey](../design/stages/materials.md), line 91.

```reaction
when Sessioning.use (session, subject: user), asked by reusable.accounts.identifying.Me
where
  Registering._username (user) has (username)
  earlier, RequestBoundary.request (path: "/auth/me", requestId, session)
then
  RequestBoundary.respond (requestId, username)
```

### reusable.accounts.identifying.Me:missing#2

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 84.
- Covered by [P2 learning journey](../design/stages/materials.md), line 91.

```reaction
when Sessioning.use (session, subject: user), asked by reusable.accounts.identifying.Me
where
  no Registering._username (user)
  earlier, RequestBoundary.request (path: "/auth/me", requestId, session)
then
  RequestBoundary.respond (error: "NOT_SIGNED_IN", requestId)
```

### reusable.accounts.leaving.SignOut

Authored path: `reusable.accounts.leaving.SignOut`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 84.
- Covered by [P2 learning journey](../design/stages/materials.md), line 92.

```reaction
when RequestBoundary.request (path: "/auth/logout", requestId, session)
then
  Sessioning.end (session)
```

### reusable.accounts.leaving.SignOut#2

Authored path: `reusable.accounts.leaving.SignOut`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 84.
- Covered by [P2 learning journey](../design/stages/materials.md), line 92.

```reaction
when Sessioning.end (session), asked by reusable.accounts.leaving.SignOut
where
  earlier, RequestBoundary.request (path: "/auth/logout", requestId, session)
then
  RequestBoundary.respond (requestId)
```

### reusable.commons.finishing.ChooseUsername:expired

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
where
  no CommonsFederating._identity (attempt)
then
  RequestBoundary.respond (error: "SIGN_IN_EXPIRED", requestId)
```

### reusable.commons.finishing.ChooseUsername:new

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
where
  CommonsFederating._identity (attempt)
  no CommonsFederating._user (attempt)
  no Registering._byRecoveryKey (recoveryKey)
then
  Registering.register (recoveryKey, username)
```

### reusable.commons.finishing.ChooseUsername:new#2

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when Registering.register (recoveryKey, username, user), asked by reusable.commons.finishing.ChooseUsername:new
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ChooseUsername:new#3

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ChooseUsername:new#2
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:new#4

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:new#3
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ChooseUsername:recovered

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
where
  CommonsFederating._identity (attempt)
  no CommonsFederating._user (attempt)
  Registering._byRecoveryKey (recoveryKey) has (user)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ChooseUsername:recovered#2

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ChooseUsername:recovered
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:recovered#3

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:recovered#2
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ChooseUsername:returning

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
where
  CommonsFederating._identity (attempt)
  CommonsFederating._user (attempt) has (user)
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:returning#2

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 80.
- Covered by [P2 learning journey](../design/stages/materials.md), line 90.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:returning
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.FinishCommons

Authored path: `reusable.commons.finishing.FinishCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 88.

```reaction
when RequestBoundary.request (attempt, code, path: "/auth/commons/finish", requestId, state)
then
  CommonsFederating.finish (attempt, code, nonce: state)
```

### reusable.commons.finishing.FinishCommons#2

Authored path: `reusable.commons.finishing.FinishCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 88.

```reaction
when CommonsFederating.finish (attempt, code, nonce: state, username), asked by reusable.commons.finishing.FinishCommons
where
  earlier, RequestBoundary.request (attempt, code, path: "/auth/commons/finish", requestId, state)
then
  RequestBoundary.respond (requestId, username)
```

### reusable.commons.finishing.ResumeCommons:expired

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
where
  no CommonsFederating._identity (attempt)
then
  RequestBoundary.respond (error: "SIGN_IN_EXPIRED", requestId)
```

### reusable.commons.finishing.ResumeCommons:new

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
where
  CommonsFederating._identity (attempt)
  no CommonsFederating._user (attempt)
  no Registering._byRecoveryKey (recoveryKey)
then
  Registering.register (recoveryKey, username)
```

### reusable.commons.finishing.ResumeCommons:new#2

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when Registering.register (recoveryKey, username, user), asked by reusable.commons.finishing.ResumeCommons:new
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ResumeCommons:new#3

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ResumeCommons:new#2
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:new#4

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:new#3
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ResumeCommons:recovered

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
where
  CommonsFederating._identity (attempt)
  no CommonsFederating._user (attempt)
  Registering._byRecoveryKey (recoveryKey) has (user)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ResumeCommons:recovered#2

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ResumeCommons:recovered
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:recovered#3

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:recovered#2
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ResumeCommons:returning

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
where
  CommonsFederating._identity (attempt)
  CommonsFederating._user (attempt) has (user)
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:returning#2

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.
- Covered by [P2 learning journey](../design/stages/materials.md), line 89.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:returning
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.starting.StartCommons

Authored path: `reusable.commons.starting.StartCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 87.

```reaction
when RequestBoundary.request (path: "/auth/commons/start", requestId)
then
  CommonsFederating.start ()
```

### reusable.commons.starting.StartCommons#2

Authored path: `reusable.commons.starting.StartCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.
- Covered by [P2 learning journey](../design/stages/materials.md), line 87.

```reaction
when CommonsFederating.start (address, attempt, expiresAt), asked by reusable.commons.starting.StartCommons
where
  earlier, RequestBoundary.request (path: "/auth/commons/start", requestId)
then
  RequestBoundary.respond (address, attempt, expiresAt, requestId)
```

## Endpoint input contracts

Before recording an action ask, the boundary rejects a body that is not an
object or lacks a required key. The response uses `INVALID_INPUT` and names
the path or missing key. A declared default fills an absent key. Endpoints
not listed here have no explicit input contract.

- `/auth/commons/choose` — requires `attempt`; fills `recoveryKey` with "" when absent; fills `username` with "" when absent
- `/auth/commons/finish` — requires `attempt`, `code`, `state`
- `/auth/commons/resume` — requires `attempt`; fills `recoveryKey` with "" when absent; fills `username` with "" when absent
- `/auth/logout` — requires `session`
- `/auth/me` — requires `session`
- `/courses` — requires `session`
- `/courses/create` — requires `session`, `title`
- `/courses/graded/confirm` — requires `material`, `outsideHelp`, `performedOn`, `row`, `session`
- `/courses/graded/extract` — requires `material`, `session`
- `/courses/graded/read` — requires `material`, `session`
- `/courses/materials/read` — requires `material`, `session`
- `/courses/read` — requires `course`, `session`
- `/courses/skills/archive` — requires `session`, `skill`
- `/courses/skills/confirm` — requires `session`, `skill`
- `/courses/skills/details` — requires `session`, `skill`, `title`, `unit`
- `/courses/skills/edit` — requires `gate`, `material`, `outcome`, `session`, `skill`, `title`, `unit`
- `/courses/skills/prerequisites` — requires `prerequisites`, `session`, `skill`
- `/courses/skills/propose` — requires `gate`, `material`, `outcome`, `proposalKey`, `session`, `title`, `unit`
- `/courses/skills/restore` — requires `session`, `skill`
- `/courses/skills/revise` — requires `gate`, `outcome`, `session`, `skill`
- `/courses/skills/sources/add` — requires `material`, `session`, `skill`
- `/courses/skills/suggest` — requires `material`, `session`
- `/courses/units/add` — requires `course`, `session`, `title`
- `/courses/units/emphasis` — requires `emphasized`, `session`, `unit`
- `/internal/materials/add` — requires `content`, `course`, `importKey`, `locator`, `origin`, `originals`, `session`, `title`
- `/learning/adjust` — requires `adjustmentKey`, `reason`, `session`, `skill`, `value`
- `/learning/assess` — requires `dialogueLength`, `outsideHelp`, `reviewed`, `session`, `studySession`, `unseen`
- `/learning/confidence` — requires `confidence`, `session`, `skill`
- `/learning/correct` — requires `basedOn`, `case`, `gateMet`, `reason`, `result`, `session`
- `/learning/hint` — requires `session`, `studySession`
- `/learning/lesson` — requires `request`, `session`, `skill`
- `/learning/progress` — requires `course`, `session`
- `/learning/question` — requires `attachments`, `channel`, `dialogueLength`, `session`, `studySession`, `text`
- `/learning/read` — requires `session`, `skill`
- `/learning/regrade` — requires `basedOn`, `case`, `reason`, `session`
- `/learning/reply` — requires `session`, `studySession`
- `/learning/respond` — requires `attachments`, `channel`, `dialogueLength`, `session`, `studySession`, `text`
- `/learning/retry` — requires `session`, `studySession`
- `/learning/task` — requires `session`, `skill`
- `/learning/transcript` — requires `session`, `studySession`, `text`, `turnIndex`
- `/planning/begin` — requires `course`, `item`, `session`
- `/planning/configure` — requires `course`, `dailyMinutes`, `focusNote`, `session`
- `/planning/exams/remove` — requires `course`, `date`, `session`
- `/planning/exams/set` — requires `course`, `covered`, `date`, `session`
- `/planning/finish` — requires `actualMinutes`, `course`, `item`, `session`
- `/planning/miss` — requires `course`, `item`, `session`
- `/planning/propose` — requires `course`, `session`
- `/planning/read` — requires `course`, `session`
- `/planning/stop` — requires `actualMinutes`, `course`, `item`, `session`
- `/planning/tradeoffs/confirm` — requires `course`, `plan`, `session`
- `/planning/tradeoffs/decline` — requires `course`, `plan`, `session`
- `/settings/tutor` — requires `session`
- `/settings/tutor/choose` — requires `level`, `model`, `session`
- `/settings/tutor/clear` — requires `session`
- `/settings/view` — requires `session`
- `/settings/view/set` — requires `session`, `view`
