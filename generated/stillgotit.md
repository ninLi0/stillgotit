<!-- Generated from the StillGotIt assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.1.0; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.1.0. -->

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

- `AssessmentReviewing` — instance of `AssessmentReviewing` — [P2 learning journey](../design/stages/materials.md), line 31.
  - `Author` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 32.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 34.
  - `Subject` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 33.
  - `Task` is `GroundedTutoring.Session` — [P2 learning journey](../design/stages/materials.md), line 35.

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

- `CommonsFederating` — instance of `Federating` — [P2 learning journey](../design/stages/materials.md), line 15.
  - `User` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 16.

### Generating

Defined in [Generating](../design/concepts/Generating.md), line 1.

#### Actions

- `generate(owner: Owner, request: Request) : returns (answer: Answer)`
  - Refuses `GENERATION_FAILED`: The tutor could not finish. Check your connection and retry. Your saved work is still available.

#### Instances

- `TutorGenerating` — instance of `Generating` — [P2 learning journey](../design/stages/materials.md), line 49.
  - `Answer` is `TutorAnswer` — [P2 learning journey](../design/stages/materials.md), line 52.
  - `Owner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 50.
  - `Request` is `TutorRequest` — [P2 learning journey](../design/stages/materials.md), line 51.

### GroundedTutoring

Defined in [GroundedTutoring](../design/concepts/GroundedTutoring.md), line 1.

#### Actions

- `addMaterial(owner: Learner, importKey: String, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin) : returns (material: Material)`
  - Refuses `INVALID_TUTORING_MATERIAL`: Provide a title, source location, and readable material.
  - Refuses `INVALID_MATERIAL_IMPORT_KEY`: Provide a nonblank import key.
  - Refuses `MATERIAL_IMPORT_CONFLICT`: Use the original material input for this import key.
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

- `_materials(owner: Learner, scope: Scope) : many (material: Material, title: String, locator: String, origin: MaterialOrigin)`
- `_material(material: Material) : optional (owner: Learner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin)`
- `_sessions(owner: Learner, topic: Topic) : many (session: Session, definition: Definition, status: SessionStatus)`
- `_session(session: Session) : optional (owner: Learner, topic: Topic, definition: Definition, status: SessionStatus)`
- `_lesson(lesson: Session) : optional (request: String, explanation: String)`
- `_task(task: Session) : optional (question: String, criteria: String, mode: Mode, fresh: Flag, hintRequested: Flag)`
- `_sources(session: Session) : many (material: Material)`
- `_citations(session: Session) : many (citation: PassageRef)`
- `_dialogue(session: Session) : many (turnIndex: Number, turn: DialogueTurn)`
- `_voiceResponses(session: Session) : many (turnIndex: Number, text: String, confirmed: Flag)`
- `_review(task: Session) : optional (dialogueLength: Number, uncheckedVoiceCount: Number, ready: Flag)`
- `_sourceSet(owner: Learner, scope: Scope) : one (sources: SourceRecords)`
- `_study(owner: Learner, topic: Topic) : one (sessions: StudyRecords)`
- `_sessionData(session: Session) : optional (data: StudyRecord)`

#### Instances

- `GroundedTutoring` — instance of `GroundedTutoring` — [P2 learning journey](../design/stages/materials.md), line 25.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 29.
  - `Learner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 26.
  - `Scope` is `SkillMapping.Course` — [P2 learning journey](../design/stages/materials.md), line 27.
  - `Topic` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 28.

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
- `adjust(learner: Learner, subject: Subject, definition: Definition, value: Number, reason: String) : returns (adjustment: Adjustment)`
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

- `MasteryEstimating` — instance of `MasteryEstimating` — [P2 learning journey](../design/stages/materials.md), line 37.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 40.
  - `Evidence` is `AssessmentReviewing.Case` — [P2 learning journey](../design/stages/materials.md), line 41.
  - `Learner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 38.
  - `Subject` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 39.

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

- `Registering` — instance of `Registering` — [P2 learning journey](../design/stages/materials.md), line 13.

### Sessioning

Defined in [Sessioning](../design/concepts/Sessioning.md), line 1.

#### Actions

- `start(subject: Subject) : returns (session: Session, expiresAt: DateTime)`
- `use(session: Session) : returns (subject: Subject)`
  - Refuses `NOT_SIGNED_IN`: Your session has ended. Sign in again.
- `end(session: Session) : returns (session: Session)`
  - Refuses `NOT_SIGNED_IN`: Your session has ended. Sign in again.

#### Instances

- `Sessioning` — instance of `Sessioning` — [P2 learning journey](../design/stages/materials.md), line 18.
  - `Subject` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 19.

### SkillMapping

Defined in [SkillMapping](../design/concepts/SkillMapping.md), line 1.

#### Actions

- `createCourse(owner: User, title: String) : returns (course: Course)`
  - Refuses `INVALID_COURSE_TITLE`: Enter a course title.
- `addUnit(owner: User, course: Course, title: String) : returns (unit: Unit)`
  - Refuses `UNIT_COURSE_UNAVAILABLE`: Choose one of your courses.
  - Refuses `INVALID_UNIT_TITLE`: Enter a unit title.
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
- `_units(course: Course) : many (unit: Unit, title: String)`
- `_unit(unit: Unit) : optional (course: Course, title: String)`
- `_skills(unit: Unit) : many (skill: Skill, title: String, current: Version, status: SkillStatus)`
- `_skill(skill: Skill) : optional (unit: Unit, title: String, current: Version, status: SkillStatus)`
- `_materials(skill: Skill) : many (material: Material)`
- `_prerequisites(skill: Skill) : many (prerequisite: Skill)`
- `_version(version: Version) : optional (skill: Skill, outcome: String, gate: String)`
- `_map(course: Course) : one (skills: SkillMapRows)`

#### Instances

- `SkillMapping` — instance of `SkillMapping` — [P2 learning journey](../design/stages/materials.md), line 21.
  - `Material` is `GroundedTutoring.Material` — [P2 learning journey](../design/stages/materials.md), line 23.
  - `User` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 22.

### StudyPlanning

Defined in [StudyPlanning](../design/concepts/StudyPlanning.md), line 1.

#### Actions

- `configure(learner: Learner, scope: Scope, dailyMinutes: Number, focusNote: String) : returns (preferences: Preferences)`
  - Refuses `INVALID_DAILY_BUDGET`: Enter a whole number of minutes from 0 to 1440.
- `setExam(learner: Learner, scope: Scope, date: Date, covered: SubjectSet) : returns (exam: Exam)`
  - Refuses `EXAM_PREFERENCES_UNAVAILABLE`: Set a study budget for this course first.
  - Refuses `INVALID_EXAM_DETAILS`: Choose today or a future date and at least one covered skill.
- `removeExam(learner: Learner, scope: Scope, date: Date) : returns (exam: Exam)`
  - Refuses `EXAM_REMOVE_UNAVAILABLE`: Choose an exam recorded for this course.
- `replan(learner: Learner, scope: Scope, candidates: CandidateList, horizonEnd: Date, explanation: String, basis: String, workloadComplete: Flag) : returns (plan: Plan)`
  - Refuses `PLAN_PREFERENCES_UNAVAILABLE`: Set a study budget for this course first.
  - Refuses `PLAN_SESSION_IN_PROGRESS`: Finish or stop the current activity before replacing the schedule.
  - Refuses `INVALID_PLAN_INPUT`: Provide valid activities, planning dates, and all known unfinished exam preparation.
- `activateRoutine(learner: Learner, plan: Plan, currentBasis: String) : returns (plan: Plan)`
  - Refuses `ROUTINE_PLAN_UNAVAILABLE`: Choose one of your proposed plans.
  - Refuses `ROUTINE_SESSION_IN_PROGRESS`: Finish or stop the current activity before changing plans.
  - Refuses `ROUTINE_PLAN_OUTDATED`: Create a new proposal from the current budget, dates, and progress.
  - Refuses `EXAM_TRADEOFF_CONFIRMATION_REQUIRED`: Review and confirm the proposed cuts to exam preparation.
- `confirmTradeoffs(learner: Learner, plan: Plan, currentBasis: String) : returns (plan: Plan)`
  - Refuses `TRADEOFF_PLAN_UNAVAILABLE`: Choose one of your proposed plans.
  - Refuses `TRADEOFF_SESSION_IN_PROGRESS`: Finish or stop the current activity before changing plans.
  - Refuses `TRADEOFF_PLAN_OUTDATED`: Review a new proposal based on the current budget, dates, and progress.
  - Refuses `TRADEOFF_CONFIRMATION_NOT_NEEDED`: This plan has no new exam cuts. Use routine activation.
- `declineTradeoffs(learner: Learner, plan: Plan) : returns (plan: Plan)`
  - Refuses `PLAN_DECLINE_UNAVAILABLE`: Choose one of your proposed plans.
- `begin(learner: Learner, item: Item) : returns (item: Item)`
  - Refuses `ACTIVITY_BEGIN_UNAVAILABLE`: Choose an unfinished activity from your active plan.
  - Refuses `ANOTHER_ACTIVITY_IN_PROGRESS`: Finish or stop the current activity first.
  - Refuses `ACTIVITY_NOT_SCHEDULED_TODAY`: Choose an activity scheduled for today or update the plan.
  - Refuses `ACTIVITY_EXCEEDS_REMAINING_BUDGET`: Update the plan or time budget before starting this activity.
- `finish(learner: Learner, item: Item, actualMinutes: Number) : returns (item: Item)`
  - Refuses `ACTIVITY_FINISH_UNAVAILABLE`: Choose your current activity.
  - Refuses `INVALID_FINISH_TIME`: Enter a nonnegative number of minutes spent.
- `stop(learner: Learner, item: Item, actualMinutes: Number) : returns (item: Item)`
  - Refuses `ACTIVITY_STOP_UNAVAILABLE`: Choose your current activity.
  - Refuses `INVALID_STOP_TIME`: Enter a nonnegative number of minutes spent.
- `miss(learner: Learner, item: Item) : returns (item: Item)`
  - Refuses `ACTIVITY_MISS_UNAVAILABLE`: Choose an unfinished activity from your active plan.
  - Refuses `ACTIVITY_MISS_TOO_EARLY`: Only today's or an overdue activity can be marked missed.

#### Queries

- `_preferences(learner: Learner, scope: Scope) : optional (preferences: Preferences, dailyMinutes: Number, focusNote: String)`
- `_exams(learner: Learner, scope: Scope) : many (exam: Exam, date: Date, covered: SubjectSet, active: Flag)`
- `_plans(learner: Learner, scope: Scope) : many (plan: Plan, status: PlanStatus, horizonEnd: Date, needsConfirmation: Flag)`
- `_plan(plan: Plan) : optional (learner: Learner, scope: Scope, status: PlanStatus, basis: String, inputs: PlanInputs, horizonEnd: Date, explanation: String, focusExam?: Exam, examUrgent: Flag, workloadComplete: Flag, estimatedExamMinutes: Number, availableExamMinutes: Number, scheduledMinutes: Number, deferredMinutes: Number, needsConfirmation: Flag)`
- `_items(plan: Plan) : many (item: Item, candidate: Candidate, day: Date, status: ItemStatus, actualMinutes: Number, spentOn?: Date)`
- `_next(learner: Learner, scope: Scope) : optional (item: Item, candidate: Candidate, day: Date, status: ItemStatus)`
- `_budget(learner: Learner, scope: Scope, day: Date) : optional (dailyMinutes: Number, spentMinutes: Number, remainingMinutes: Number)`
- `_deferred(plan: Plan) : many (candidate: Candidate)`
- `_cuts(plan: Plan) : many (cut: CutValue)`
- `_proposalCheck(learner: Learner, plan: Plan, currentBasis: String) : optional (locallyCurrent: Flag, contextCurrent: Flag, sessionInProgress: Flag, needsConfirmation: Flag, canActivate: Flag)`
- `_schedule(learner: Learner, scope: Scope) : one (schedule: ScheduleValue)`
- `_item(item: Item) : optional (learner: Learner, scope: Scope, item: Item, candidate: Candidate, day: String, status: ItemStatus, actualMinutes: Number, spentOn?: String)`

#### Instances

- `StudyPlanning` — instance of `StudyPlanning` — [P2 learning journey](../design/stages/materials.md), line 43.
  - `Definition` is `SkillMapping.Version` — [P2 learning journey](../design/stages/materials.md), line 47.
  - `Learner` is `Registering.User` — [P2 learning journey](../design/stages/materials.md), line 44.
  - `Scope` is `SkillMapping.Course` — [P2 learning journey](../design/stages/materials.md), line 45.
  - `Subject` is `SkillMapping.Skill` — [P2 learning journey](../design/stages/materials.md), line 46.

## Application types

Concrete types:

- `TutorAnswer` — [P2 learning journey](../design/stages/materials.md), line 8.
- `TutorRequest` — [P2 learning journey](../design/stages/materials.md), line 6.

## Computations

- `attemptIsReady(data: GroundedTutoring.StudyRecord, dialogueLength: Number, reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag` — [Learning computations](../design/compositions/learning-computations.md), line 91.
- `correctionNote(reason: String) : AttemptClarification` — [Learning computations](../design/compositions/learning-computations.md), line 19.
- `dialogueIsCurrent(data: GroundedTutoring.StudyRecord, dialogueLength: Number) : Flag` — [Learning computations](../design/compositions/learning-computations.md), line 22.
- `evidenceAttribution(origin: AssessmentReviewing.Origin, rationale: String) : String` — [P2 learning journey](../design/stages/materials.md), line 113.
- `evidenceUpdate(data: AssessmentReviewing.CaseRecord, tracks: MasteryEstimating.ProgressRows) : EvidenceUpdate` — [Learning computations](../design/compositions/learning-computations.md), line 25.
- `generationDefinition(request: TutorRequest) : GenerationDefinition` — [Learning computations](../design/compositions/learning-computations.md), line 28.
- `generationFields(answer: TutorAnswer) : TutorAnswer` — [Learning computations](../design/compositions/learning-computations.md), line 31.
- `gradeRequest(selected: GroundedTutoring.SourceRecords, data: AssessmentReviewing.CaseRecord) : TutorRequest` — [Learning computations](../design/compositions/learning-computations.md), line 34.
- `hasLessonQuestion(data: GroundedTutoring.StudyRecord) : Flag` — [Learning computations](../design/compositions/learning-computations.md), line 37.
- `itemSubject(candidate: StudyPlanning.Candidate) : ItemSubject` — [Learning computations](../design/compositions/learning-computations.md), line 40.
- `lessonRequest(selected: GroundedTutoring.SourceRecords, context: SkillContext, request: String) : TutorRequest` — [Learning computations](../design/compositions/learning-computations.md), line 43.
- `planDetail(schedule: StudyPlanning.ScheduleValue) : PlanDetail` — [Learning computations](../design/compositions/learning-computations.md), line 46.
- `planRequest(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, schedule: StudyPlanning.ScheduleValue) : ReviewProposal` — [Learning computations](../design/compositions/learning-computations.md), line 49.
- `prerequisitesReady(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill) : Flag` — [Learning computations](../design/compositions/learning-computations.md), line 52.
- `progressRows(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows) : SkillProgress` — [Learning computations](../design/compositions/learning-computations.md), line 55.
- `responseInput(data: GroundedTutoring.StudyRecord, text: String, channel: GroundedTutoring.Channel, attachment: String, sources: GroundedTutoring.SourceRecords) : ResponseInput` — [Learning computations](../design/compositions/learning-computations.md), line 58.
- `reviewApproved(reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag` — [Learning computations](../design/compositions/learning-computations.md), line 61.
- `selectSkill(skills: SkillMapping.SkillMapRows, skill: SkillMapping.Skill) : SkillContext` — [Learning computations](../design/compositions/learning-computations.md), line 64.
- `selectSkillMaterials(context: SkillContext) : GroundedTutoring.MaterialSet` — [Learning computations](../design/compositions/learning-computations.md), line 67.
- `selectSources(sources: GroundedTutoring.SourceRecords, materials: GroundedTutoring.MaterialSet) : SourceSelection` — [Learning computations](../design/compositions/learning-computations.md), line 70.
- `sessionMaterials(data: GroundedTutoring.StudyRecord) : GroundedTutoring.MaterialSet` — [Learning computations](../design/compositions/learning-computations.md), line 73.
- `sessionRequest(selected: GroundedTutoring.SourceRecords, data: GroundedTutoring.StudyRecord, kind: String) : TutorRequest` — [Learning computations](../design/compositions/learning-computations.md), line 76.
- `sessionSubject(identity: SessionIdentity) : SessionOwner` — [Learning computations](../design/compositions/learning-computations.md), line 94.
- `singleMaterial(material: GroundedTutoring.Material) : SkillMapping.MaterialSet` — [P2 learning journey](../design/stages/materials.md), line 110.
- `studyDetail(context: SkillContext, tracks: MasteryEstimating.ProgressRows, sessions: GroundedTutoring.StudyRecords, cases: AssessmentReviewing.CaseRecords) : StudyDetail` — [Learning computations](../design/compositions/learning-computations.md), line 79.
- `submissionInput(data: GroundedTutoring.StudyRecord, unseen: Flag, outsideHelp: Flag) : SubmissionInput` — [Learning computations](../design/compositions/learning-computations.md), line 82.
- `suggestRequest(selected: GroundedTutoring.SourceRecords) : TutorRequest` — [Learning computations](../design/compositions/learning-computations.md), line 85.
- `taskRequest(selected: GroundedTutoring.SourceRecords, context: SkillContext, sessions: GroundedTutoring.StudyRecords) : TutorRequest` — [Learning computations](../design/compositions/learning-computations.md), line 88.

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

### (owner) owns (course) with (title)

Authored path: `Courses.OwnedCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 81.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```view
(owner) owns (course) with (title) — inputs (owner, course); outputs (title); bindings () — answers at most one (title)
  where SkillMapping._course (course) has (owner, title)
```

### (owner) owns study skill (skill)

Authored path: `Reads.OwnedSkill`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 3.

```view
(owner) owns study skill (skill) — inputs (owner, skill); outputs (course, definition, status); bindings (unit) — answers at most one (course, definition, status)
  where
    SkillMapping._skill (skill) has (current: definition, status, unit)
    SkillMapping._unit (unit) has (course)
    view "(owner) owns (course) with (title)" with (course, owner)
```

### (owner) owns study session (studySession)

Authored path: `Reads.OwnedSession`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 3.

```view
(owner) owns study session (studySession) — inputs (owner, studySession); outputs (skill, course, definition); bindings () — answers at most one (skill, course, definition)
  where
    GroundedTutoring._session (session: studySession) has (definition, owner, topic: skill)
    view "(owner) owns study skill (skill)" with (owner, skill) has (course)
```

### (owner) can change session (studySession)

Authored path: `Reads.OpenSession`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 3.

```view
(owner) can change session (studySession) — inputs (owner, studySession); outputs (skill, course, definition); bindings () — answers at most one (skill, course, definition)
  where
    view "(owner) owns study session (studySession)" with (owner, studySession) has (course, definition, skill)
    GroundedTutoring._session (session: studySession) has (status: "OPEN")
    no AssessmentReviewing._byTask (author: owner, task: studySession)
```

### (owner) can refresh routine reviews in (course)

Authored path: `Reads.CanReplan`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 9.

```view
(owner) can refresh routine reviews in (course) — inputs (owner, course); outputs (); bindings ()
  where
    view "(owner) owns (course) with (title)" with (course, owner)
    StudyPlanning._preferences (learner: owner, scope: course)
    no StudyPlanning._next (learner: owner, scope: course) has (status: "IN_PROGRESS")
```

### (owner) can study confirmed (skill)

Authored path: `Reads.ActiveSkill`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 3.

```view
(owner) can study confirmed (skill) — inputs (owner, skill); outputs (course, definition); bindings () — answers at most one (course, definition)
  where view "(owner) owns study skill (skill)" with (owner, skill) has (course, definition, status: "CONFIRMED")
```

### (owner) owns (unit) in (course)

Authored path: `Courses.OwnedUnit`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```view
(owner) owns (unit) in (course) — inputs (owner, unit); outputs (course); bindings () — answers at most one (course)
  where
    SkillMapping._unit (unit) has (course)
    view "(owner) owns (course) with (title)" with (course, owner)
```

### (owner) owns (skill) in (course)

Authored path: `Courses.OwnedSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```view
(owner) owns (skill) in (course) — inputs (owner, skill); outputs (course, unit); bindings () — answers at most one (course, unit)
  where
    SkillMapping._skill (skill) has (unit)
    view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
```

### (owner) owns assessment (assessment)

Authored path: `Reads.OwnedCase`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 3.

```view
(owner) owns assessment (assessment) — inputs (owner, assessment); outputs (skill, course, definition, task); bindings () — answers at most one (skill, course, definition, task)
  where
    AssessmentReviewing._case (case: assessment) has (author: owner, definition, subject: skill, task)
    view "(owner) owns study skill (skill)" with (owner, skill) has (course)
```

### (skill) has a source outside (owner)'s (course)

Authored path: `Courses.UnavailableSkillMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```view
(skill) has a source outside (owner)'s (course) — inputs (owner, skill, course); outputs (); bindings (material)
  where
    SkillMapping._materials (skill) has (material)
    no GroundedTutoring._material (material) has (owner, scope: course)
```

### assessment (assessment) needs evidence for (owner)

Authored path: `Reads.NeedsEvidence`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 9.

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
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 9.

```view
review inputs for (owner) in (course) — inputs (owner, course); outputs (candidates, horizonEnd, basis, explanation); bindings (skills, tracks, schedule) — answers exactly one (candidates, horizonEnd, basis, explanation)
  where
    SkillMapping._map (course) has (skills)
    MasteryEstimating._progress (learner: owner) has (tracks)
    StudyPlanning._schedule (learner: owner, scope: course) has (schedule)
    (basis, candidates, explanation, horizonEnd) is planRequest (schedule, skills, tracks)
```

### the current context of (skill) for (owner)

Authored path: `Reads.SkillContext`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 5.

```view
the current context of (skill) for (owner) — inputs (owner, skill); outputs (context, skills, tracks, sources); bindings (course) — answers at most one (context, skills, tracks, sources)
  where
    view "(owner) owns study skill (skill)" with (owner, skill) has (course)
    SkillMapping._map (course) has (skills)
    MasteryEstimating._progress (learner: owner) has (tracks)
    GroundedTutoring._sourceSet (owner, scope: course) has (sources)
    context is selectSkill (skill, skills)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

### admit a lesson for (owner) and (skill)

Authored path: `Access.LessonReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 7.

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
- Covered by [Request admission](../design/compositions/learning-access.md), line 22.

```former
Former "admit a question in (studySession)" — inputs (owner, studySession, text, channel, attachment, dialogueLength); bindings (course, data, sources); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession) has (course)
    where GroundedTutoring._lesson (lesson: studySession)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where GroundedTutoring._sourceSet (owner, scope: course) has (sources)
    where dialogueIsCurrent (data, dialogueLength)
    where (valid: true) is responseInput (attachment, channel, data, sources, text)
    allowed: true
```

### admit a routine plan in (course)

Authored path: `Access.PlanReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 18.

```former
Former "admit a routine plan in (course)" — inputs (owner, course); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can refresh routine reviews in (course)" with (course, owner)
    allowed: true
```

### admit a transcript correction in (studySession)

Authored path: `Access.TranscriptReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 12.

```former
Former "admit a transcript correction in (studySession)" — inputs (owner, studySession); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession)
    allowed: true
```

### admit a tutor reply in (studySession)

Authored path: `Access.ReplyReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 10.

```former
Former "admit a tutor reply in (studySession)" — inputs (owner, studySession); bindings (data); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where hasLessonQuestion (data)
    allowed: true
```

### admit access to (course) for (owner)

Authored path: `Access.CourseReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 17.

```former
Former "admit access to (course) for (owner)" — inputs (owner, course); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns (course) with (title)" with (course, owner)
    allowed: true
```

### admit learner work in (studySession)

Authored path: `Access.ResponseReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 9.

```former
Former "admit learner work in (studySession)" — inputs (owner, studySession, text, channel, attachment, dialogueLength); bindings (course, data, sources); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession) has (course)
    where GroundedTutoring._sessionData (session: studySession) has (data)
    where GroundedTutoring._sourceSet (owner, scope: course) has (sources)
    where dialogueIsCurrent (data, dialogueLength)
    where (valid: true) is responseInput (attachment, channel, data, sources, text)
    allowed: true
```

### admit practice for (owner) and (skill)

Authored path: `Access.TaskReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 8.

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
- Covered by [Request admission](../design/compositions/learning-access.md), line 19.

```former
Former "admit progress on (item) in (course)" — inputs (owner, course, item); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns (course) with (title)" with (course, owner)
    where StudyPlanning._item (item) has (learner: owner, scope: course)
    allowed: true
```

### admit requested help in (studySession)

Authored path: `Access.HintReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 11.

```former
Former "admit requested help in (studySession)" — inputs (owner, studySession); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) can change session (studySession)" with (owner, studySession)
    where GroundedTutoring._task (task: studySession)
    allowed: true
```

### admit retry of (studySession)

Authored path: `Access.RetryReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 14.

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
- Covered by [Request admission](../design/compositions/learning-access.md), line 13.

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
- Covered by [Request admission](../design/compositions/learning-access.md), line 15.

```former
Former "admit revision of (assessment)" — inputs (owner, assessment, basedOn); bindings (); promises at most one record — forms:
  a record of
    where view "(owner) owns assessment (assessment)" with (assessment, owner)
    where AssessmentReviewing._effectiveJudgment (case: assessment) has (judgment: basedOn)
    allowed: true
```

### admit starting (item) in (course)

Authored path: `Access.BeginReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 20.

```former
Former "admit starting (item) in (course)" — inputs (owner, course, item); bindings (candidate, skill, definition, skills, tracks); promises at most one record — forms:
  a record of
    where view "(owner) owns (course) with (title)" with (course, owner)
    where StudyPlanning._item (item) has (candidate, learner: owner, scope: course)
    where (definition, skill) is itemSubject (candidate)
    where view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
    where SkillMapping._map (course) has (skills)
    where MasteryEstimating._progress (learner: owner) has (tracks)
    where prerequisitesReady (skill, skills, tracks)
    allowed: true
```

### admit suggestions from (material)

Authored path: `Access.SuggestionReady`.
- Covered by [Request admission](../design/compositions/learning-access.md), line 16.

```former
Former "admit suggestions from (material)" — inputs (owner, material); bindings (course); promises at most one record — forms:
  a record of
    where GroundedTutoring._material (material) has (owner, scope: course)
    where view "(owner) owns (course) with (title)" with (course, owner)
    allowed: true
```

### saved study session (studySession)

Authored path: `Reads.SessionData`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 7.

```former
Former "saved study session (studySession)" — inputs (studySession); bindings (data); promises exactly one record — forms:
  a record of
    where GroundedTutoring._sessionData (session: studySession) has (data)
    data
```

### skill estimates for (owner) in (course)

Authored path: `Reads.Progress`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 7.

```former
Former "skill estimates for (owner) in (course)" — inputs (owner, course); bindings (skills, tracks, estimates); promises exactly one record — forms:
  a record of
    where SkillMapping._map (course) has (skills)
    where MasteryEstimating._progress (learner: owner) has (tracks)
    where estimates is progressRows (skills, tracks)
    estimates
```

### study data for (owner) and (skill)

Authored path: `Reads.SkillData`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 7.

```former
Former "study data for (owner) and (skill)" — inputs (owner, skill); bindings (context, tracks, sessions, cases, track, estimate); promises exactly one record — forms:
  a record of
    where view "the current context of (skill) for (owner)" with (owner, skill) has (context, tracks)
    where GroundedTutoring._study (owner, topic: skill) has (sessions)
    where AssessmentReviewing._history (author: owner, subject: skill) has (cases)
    where (estimate, track) is studyDetail (cases, context, sessions, tracks)
    cases
    estimate
    sessions
    skill: context
    track
```

### study plan for (owner) in (course)

Authored path: `Reads.PlanData`.
- Covered by [Shared learning reads](../design/compositions/learning-reads.md), line 7.

```former
Former "study plan for (owner) in (course)" — inputs (owner, course); bindings (schedule, preferences, budget, next, today, plan); promises exactly one record — forms:
  a record of
    where StudyPlanning._schedule (learner: owner, scope: course) has (schedule)
    where (budget, next, plan, preferences, today) is planDetail (schedule)
    budget
    next
    plan
    preferences
    today
```

### the courses belonging to (owner)

Authored path: `Courses.CourseList`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 7.
- Covered by [P2 learning journey](../design/stages/materials.md), line 81.

```former
Former "the courses belonging to (owner)" — inputs (owner); bindings (course, title); promises exactly one record — forms:
  each SkillMapping._courses (owner) has (course)
    where view "(owner) owns (course) with (title)" with (course, owner) has (title)
    arranged by course
    form a record of
      course
      title
```

### the skill definitions in (course)

Authored path: `Courses.Skills`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

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

### the source summaries for (owner) in (course)

Authored path: `Courses.Materials`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```former
Former "the source summaries for (owner) in (course)" — inputs (owner, course); bindings (material, title, locator, origin); promises exactly one record — forms:
  each GroundedTutoring._materials (owner, scope: course) has (locator, material, origin, title)
    arranged by material
    form a record of
      locator
      material
      origin
      title
```

### the units in (course)

Authored path: `Courses.Units`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```former
Former "the units in (course)" — inputs (course); bindings (unit, title); promises exactly one record — forms:
  each SkillMapping._units (course) has (title, unit)
    arranged by unit
    form a record of
      title
      unit
```

## Reactions

### Courses.AddMaterial

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 15.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 39.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.AddMaterial:missing#2

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 15.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 39.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

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
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 15.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 39.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddMaterial
where
  earlier, RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  GroundedTutoring.addMaterial (content, importKey, locator, origin, originals, owner, scope: course, title)
```

### Courses.AddMaterial:owned#3

Authored path: `Courses.AddMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 15.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 39.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when GroundedTutoring.addMaterial (content, importKey, locator, origin, originals, owner, scope: course, title, material), asked by Courses.AddMaterial:owned#2
where
  earlier, RequestBoundary.request (content, course, importKey, locator, origin, originals, path: "/internal/materials/add", requestId, session, title)
then
  RequestBoundary.respond (material, requestId)
```

### Courses.AddUnit

Authored path: `Courses.AddUnit`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 38.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when RequestBoundary.request (course, path: "/courses/units/add", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.AddUnit#2

Authored path: `Courses.AddUnit`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 38.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.AddUnit
where
  earlier, RequestBoundary.request (course, path: "/courses/units/add", requestId, session, title)
then
  SkillMapping.addUnit (course, owner, title)
```

### Courses.AddUnit#3

Authored path: `Courses.AddUnit`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 38.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when SkillMapping.addUnit (course, owner, title, unit), asked by Courses.AddUnit#2
where
  earlier, RequestBoundary.request (course, path: "/courses/units/add", requestId, session, title)
then
  RequestBoundary.respond (requestId, unit)
```

### Courses.ConfirmSkill

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 42.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
then
  Sessioning.use (session)
```

### Courses.ConfirmSkill:missing#2

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 42.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

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
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 42.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

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
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 42.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when SkillMapping.confirm (owner, skill), asked by Courses.ConfirmSkill:owned#2
where
  earlier, RequestBoundary.request (path: "/courses/skills/confirm", requestId, session, skill)
then
  RequestBoundary.respond (requestId)
```

### Courses.ConfirmSkill:source#2

Authored path: `Courses.ConfirmSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 42.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

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
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 35.
- Covered by [P2 learning journey](../design/stages/materials.md), line 83.

```reaction
when RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.CreateCourse:existing#2

Authored path: `Courses.CreateCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 35.
- Covered by [P2 learning journey](../design/stages/materials.md), line 83.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.CreateCourse
where
  SkillMapping._courses (owner)
  earlier, RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  RequestBoundary.respond (error: "COURSE_EXISTS", requestId)
```

### Courses.CreateCourse:first#2

Authored path: `Courses.CreateCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 35.
- Covered by [P2 learning journey](../design/stages/materials.md), line 83.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.CreateCourse
where
  no SkillMapping._courses (owner)
  earlier, RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  SkillMapping.createCourse (owner, title)
```

### Courses.CreateCourse:first#3

Authored path: `Courses.CreateCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 13.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 35.
- Covered by [P2 learning journey](../design/stages/materials.md), line 83.

```reaction
when SkillMapping.createCourse (owner, title, course), asked by Courses.CreateCourse:first#2
where
  earlier, RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  RequestBoundary.respond (course, requestId)
```

### Courses.EditDraft

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 41.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
then
  Sessioning.use (session)
```

### Courses.EditDraft:missing#2

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 41.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

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
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 41.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditDraft
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  GroundedTutoring._material (material) has (owner, scope: course)
  materials is singleMaterial (material)
then
  SkillMapping.reviseDraft (gate, materials, outcome, owner, skill, title, unit)
```

### Courses.EditDraft:owned#3

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 41.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when SkillMapping.reviseDraft (gate, materials, outcome, owner, skill, title, unit), asked by Courses.EditDraft:owned#2
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
then
  RequestBoundary.respond (requestId)
```

### Courses.EditDraft:source#2

Authored path: `Courses.EditDraft`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 25.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 41.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.EditDraft
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/edit", requestId, session, skill, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  no GroundedTutoring._material (material) has (owner, scope: course)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.ListCourses

Authored path: `Courses.ListCourses`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 7.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 34.
- Covered by [P2 learning journey](../design/stages/materials.md), line 81.

```reaction
when RequestBoundary.request (path: "/courses", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ListCourses#2

Authored path: `Courses.ListCourses`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 7.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 34.
- Covered by [P2 learning journey](../design/stages/materials.md), line 81.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ListCourses
where
  earlier, RequestBoundary.request (path: "/courses", requestId, session)
then
  RequestBoundary.respond (courses: former "the courses belonging to (owner)" with (owner), requestId)
```

### Courses.ProposeSkill

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 40.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
then
  Sessioning.use (session)
```

### Courses.ProposeSkill:missing#2

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 40.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

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
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 40.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ProposeSkill
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  GroundedTutoring._material (material) has (owner, scope: course)
  materials is singleMaterial (material)
then
  SkillMapping.propose (gate, materials, outcome, owner, proposalKey, title, unit)
```

### Courses.ProposeSkill:owned#3

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 40.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when SkillMapping.propose (gate, materials, outcome, owner, proposalKey, title, unit, skill), asked by Courses.ProposeSkill:owned#2
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
then
  RequestBoundary.respond (requestId, skill)
```

### Courses.ProposeSkill:source#2

Authored path: `Courses.ProposeSkill`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 40.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ProposeSkill
where
  earlier, RequestBoundary.request (gate, material, outcome, path: "/courses/skills/propose", proposalKey, requestId, session, title, unit)
  view "(owner) owns (unit) in (course)" with (owner, unit) has (course)
  no GroundedTutoring._material (material) has (owner, scope: course)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.ReadCourse

Authored path: `Courses.ReadCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 36.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```reaction
when RequestBoundary.request (course, path: "/courses/read", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ReadCourse:missing#2

Authored path: `Courses.ReadCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 36.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadCourse
where
  earlier, RequestBoundary.request (course, path: "/courses/read", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ReadCourse:owned#2

Authored path: `Courses.ReadCourse`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 36.
- Covered by [P2 learning journey](../design/stages/materials.md), line 101.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadCourse
where
  earlier, RequestBoundary.request (course, path: "/courses/read", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (materials: former "the source summaries for (owner) in (course)" with (course, owner), requestId, skills: former "the skill definitions in (course)" with (course), units: former "the units in (course)" with (course))
```

### Courses.ReadMaterial

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ReadMaterial:course#2

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadMaterial
where
  earlier, RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
  GroundedTutoring._material (material) has (owner, scope: course)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Courses.ReadMaterial:missing#2

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadMaterial
where
  earlier, RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
  no GroundedTutoring._material (material) has (owner)
then
  RequestBoundary.respond (error: "MATERIAL_UNAVAILABLE", requestId)
```

### Courses.ReadMaterial:owned#2

Authored path: `Courses.ReadMaterial`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 9.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 37.
- Covered by [P2 learning journey](../design/stages/materials.md), line 105.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ReadMaterial
where
  earlier, RequestBoundary.request (material, path: "/courses/materials/read", requestId, session)
  GroundedTutoring._material (material) has (content, locator, origin, originals, owner, scope: course, title)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (content, locator, origin, originals, requestId, title)
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

### Learning.Assess

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 30.

```reaction
when RequestBoundary.request (dialogueLength, outsideHelp, path: "/learning/assess", requestId, reviewed, session, studySession, unseen)
then
  Sessioning.use (session)
```

### Learning.Assess#2

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 30.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 30.

```reaction
when GroundedTutoring.confirmAttempt (dialogueLength, outsideHelp, owner, task: studySession, unseen), asked by Learning.Assess#2
at the flow's settlement frontier
where
  view "(owner) owns study session (studySession)" with (owner, studySession) has (course)
  AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
  no AssessmentReviewing._effectiveJudgment (case: assessment)
  AssessmentReviewing._caseData (case: assessment) has (data)
  GroundedTutoring._sessionData (session: studySession) has (data: sessionData)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is gradeRequest (data, selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Assess#4

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 30.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Assess#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Assess
then
  Sessioning.use (session)
```

### Learning.Assess#5

Authored path: `Learning.Assess`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 30.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 30.

```reaction
when AssessmentReviewing.assess (case: assessment, gateMet, rationale, result), asked by Learning.Assess#5
at the flow's settlement frontier
where
  earlier, GroundedTutoring.confirmAttempt (dialogueLength, outsideHelp, owner, task: studySession, unseen), asked by Learning.Assess#2
  earlier, RequestBoundary.request (dialogueLength, outsideHelp, path: "/learning/assess", requestId, reviewed, session, studySession, unseen)
then
  RequestBoundary.respond (requestId, studySession)
```

### Learning.Confidence

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 22.

```reaction
when RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Confidence:existing#2

Authored path: `Learning.Confidence`.
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 22.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 22.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 22.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 22.

```reaction
when MasteryEstimating.initialize (basis: "SELF_REPORTED", confidence, definition, learner: owner, subject: skill, track), asked by Learning.Confidence:new#2
where
  earlier, RequestBoundary.request (confidence, path: "/learning/confidence", requestId, session, skill)
then
  RequestBoundary.respond (requestId, track)
```

### Learning.Correct

Authored path: `Learning.Correct`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 32.

```reaction
when RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  Sessioning.use (session)
```

### Learning.Correct#2

Authored path: `Learning.Correct`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 32.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Correct
where
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result)
```

### Learning.Correct#3

Authored path: `Learning.Correct`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 32.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "MANUAL", rationale: reason, result, judgment), asked by Learning.Correct#2
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (basedOn, case, gateMet, path: "/learning/correct", reason, requestId, result, session)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Hint

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

```reaction
when RequestBoundary.request (path: "/learning/hint", requestId, session, studySession)
then
  Sessioning.use (session)
```

### Learning.Hint#2

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

```reaction
when GroundedTutoring.requestHint (owner, task: studySession), asked by Learning.Hint#2
where
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is sessionRequest (data, kind: "HINT", selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Hint#4

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Hint#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Hint
then
  Sessioning.use (session)
```

### Learning.Hint:closed#5

Authored path: `Learning.Hint`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 28.

```reaction
when GroundedTutoring.giveHint (channel: "TEXT", owner, task: studySession, text), asked by Learning.Hint:open#5
where
  earlier, RequestBoundary.request (path: "/learning/hint", requestId, session, studySession)
then
  RequestBoundary.respond (requestId)
```

### Learning.Lesson

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 23.

```reaction
when RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Lesson#2

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 23.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Lesson
where
  earlier, RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill)
  view "the current context of (skill) for (owner)" with (owner, skill) has (context, sources)
  materials is selectSkillMaterials (context)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is lessonRequest (context, request, selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Lesson#3

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 23.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Lesson#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Lesson
then
  Sessioning.use (session)
```

### Learning.Lesson:changed#4

Authored path: `Learning.Lesson`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 23.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 23.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 23.

```reaction
when GroundedTutoring.explain (citations, definition, explanation, materials, owner, request, topic: skill, lesson), asked by Learning.Lesson:current#4
where
  earlier, RequestBoundary.request (path: "/learning/lesson", request, requestId, session, skill)
then
  RequestBoundary.respond (lesson, requestId)
```

### Learning.Progress

Authored path: `Learning.Progress`.
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 21.

```reaction
when RequestBoundary.request (course, path: "/learning/progress", requestId, session)
then
  Sessioning.use (session)
```

### Learning.Progress:missing#2

Authored path: `Learning.Progress`.
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 21.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 21.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

```reaction
when RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
then
  Sessioning.use (session)
```

### Learning.Question#2

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Question
where
  earlier, RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._lesson (lesson: studySession)
  GroundedTutoring._sessionData (session: studySession) has (data)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  currentDialogue is dialogueIsCurrent (data, dialogueLength)
  currentDialogue is among [true]
  (media, valid: true) is responseInput (attachment, channel, data, sources, text)
then
  GroundedTutoring.respond (channel, media, owner, session: studySession, text)
```

### Learning.Question#3

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

```reaction
when GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Question#2
where
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is sessionRequest (data, kind: "REPLY", selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Question#4

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Question#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Question
then
  Sessioning.use (session)
```

### Learning.Question:closed#5

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Question#4
where
  earlier, GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Question#2
  no view "(owner) can change session (studySession)" with (owner, studySession)
  earlier, RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
then
  RequestBoundary.respond (error: "SESSION_CHANGED", requestId)
```

### Learning.Question:open#5

Authored path: `Learning.Question`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 26.

```reaction
when GroundedTutoring.answerLesson (channel: "TEXT", citations, lesson: studySession, owner, text: reply), asked by Learning.Question:open#5
where
  earlier, RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/question", requestId, session, studySession, text)
then
  RequestBoundary.respond (requestId)
```

### Learning.Read

Authored path: `Learning.Read`.
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 20.

```reaction
when RequestBoundary.request (path: "/learning/read", requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Read:missing#2

Authored path: `Learning.Read`.
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 20.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 5.
- Covered by [Learning flows](../design/compositions/learning.md), line 20.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Read
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (path: "/learning/read", requestId, session, skill)
  view "(owner) owns study skill (skill)" with (owner, skill)
then
  RequestBoundary.respond (data: former "study data for (owner) and (skill)" with (owner, skill), requestId)
```

### Learning.Regrade

Authored path: `Learning.Regrade`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 33.

```reaction
when RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  Sessioning.use (session)
```

### Learning.Regrade#2

Authored path: `Learning.Regrade`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 33.

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

### Learning.Regrade#3

Authored path: `Learning.Regrade`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 33.

```reaction
when AssessmentReviewing.clarify (author: owner, case, clarification), asked by Learning.Regrade#2
where
  view "(owner) owns assessment (assessment)" with (assessment: case, owner) has (course, task)
  AssessmentReviewing._caseData (case) has (data)
  GroundedTutoring._sessionData (session: task) has (data: sessionData)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is gradeRequest (data, selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Regrade#4

Authored path: `Learning.Regrade`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 33.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade#3
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Regrade
then
  Sessioning.use (session)
```

### Learning.Regrade#5

Authored path: `Learning.Regrade`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 33.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Regrade#4
where
  earlier, AssessmentReviewing.clarify (author: owner, case, clarification), asked by Learning.Regrade#2
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Regrade#3
  (gateMet, rationale, result) is generationFields (answer)
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "AI", rationale, result)
```

### Learning.Regrade#6

Authored path: `Learning.Regrade`.
- Covered by [Learning flows](../design/compositions/learning.md), line 13.
- Covered by [Learning flows](../design/compositions/learning.md), line 33.

```reaction
when AssessmentReviewing.revise (author: owner, basedOn, case, gateMet, origin: "AI", rationale, result, judgment), asked by Learning.Regrade#5
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (basedOn, case, path: "/learning/regrade", reason, requestId, session)
then
  RequestBoundary.respond (judgment, requestId)
```

### Learning.Reply

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 27.

```reaction
when RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
then
  Sessioning.use (session)
```

### Learning.Reply#2

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 27.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Reply
where
  earlier, RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  hasLessonQuestion (data)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is sessionRequest (data, kind: "REPLY", selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Reply#3

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 27.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Reply#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Reply
then
  Sessioning.use (session)
```

### Learning.Reply:closed#4

Authored path: `Learning.Reply`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 27.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 27.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 27.

```reaction
when GroundedTutoring.answerLesson (channel: "TEXT", citations, lesson: studySession, owner, text), asked by Learning.Reply:open#4
where
  earlier, RequestBoundary.request (path: "/learning/reply", requestId, session, studySession)
then
  RequestBoundary.respond (requestId)
```

### Learning.Respond

Authored path: `Learning.Respond`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 25.

```reaction
when RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/respond", requestId, session, studySession, text)
then
  Sessioning.use (session)
```

### Learning.Respond#2

Authored path: `Learning.Respond`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 25.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Respond
where
  earlier, RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/respond", requestId, session, studySession, text)
  view "(owner) can change session (studySession)" with (owner, studySession) has (course)
  GroundedTutoring._sessionData (session: studySession) has (data)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  currentDialogue is dialogueIsCurrent (data, dialogueLength)
  currentDialogue is among [true]
  (media, valid: true) is responseInput (attachment, channel, data, sources, text)
then
  GroundedTutoring.respond (channel, media, owner, session: studySession, text)
```

### Learning.Respond#3

Authored path: `Learning.Respond`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 25.

```reaction
when GroundedTutoring.respond (channel, media, owner, session: studySession, text), asked by Learning.Respond#2
where
  earlier, RequestBoundary.request (attachment, channel, dialogueLength, path: "/learning/respond", requestId, session, studySession, text)
then
  RequestBoundary.respond (requestId)
```

### Learning.RetryAssessment

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 31.

```reaction
when RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
then
  Sessioning.use (session)
```

### Learning.RetryAssessment#2

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 31.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.RetryAssessment
where
  earlier, RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
  view "(owner) owns study session (studySession)" with (owner, studySession) has (course)
  AssessmentReviewing._byTask (author: owner, task: studySession) has (case: assessment)
  no AssessmentReviewing._effectiveJudgment (case: assessment)
  AssessmentReviewing._caseData (case: assessment) has (data)
  GroundedTutoring._sessionData (session: studySession) has (data: sessionData)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is sessionMaterials (data: sessionData)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is gradeRequest (data, selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.RetryAssessment#3

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 31.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.RetryAssessment#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.RetryAssessment
then
  Sessioning.use (session)
```

### Learning.RetryAssessment#4

Authored path: `Learning.RetryAssessment`.
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 31.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 11.
- Covered by [Learning flows](../design/compositions/learning.md), line 31.

```reaction
when AssessmentReviewing.assess (case: assessment, gateMet, rationale, result), asked by Learning.RetryAssessment#4
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (path: "/learning/retry", requestId, session, studySession)
then
  RequestBoundary.respond (requestId)
```

### Learning.Suggest

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Learning flows](../design/compositions/learning.md), line 15.
- Covered by [Learning flows](../design/compositions/learning.md), line 34.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
then
  Sessioning.use (session)
```

### Learning.Suggest#2

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Learning flows](../design/compositions/learning.md), line 15.
- Covered by [Learning flows](../design/compositions/learning.md), line 34.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest
where
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
  GroundedTutoring._material (material) has (owner, scope: course)
  view "(owner) owns (course) with (title)" with (course, owner)
  GroundedTutoring._sourceSet (owner, scope: course) has (sources)
  materials is singleMaterial (material)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is suggestRequest (selected)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Suggest#3

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Learning flows](../design/compositions/learning.md), line 15.
- Covered by [Learning flows](../design/compositions/learning.md), line 34.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Suggest#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Suggest
then
  Sessioning.use (session)
```

### Learning.Suggest#4

Authored path: `Learning.Suggest`.
- Covered by [Courses, materials, and skill drafts](../design/compositions/courses.md), line 19.
- Covered by [Learning flows](../design/compositions/learning.md), line 15.
- Covered by [Learning flows](../design/compositions/learning.md), line 34.
- Covered by [P2 learning journey](../design/stages/materials.md), line 107.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Suggest#3
where
  earlier, TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Suggest#2
  (suggestions) is generationFields (answer)
  earlier, RequestBoundary.request (material, path: "/courses/skills/suggest", requestId, session)
then
  RequestBoundary.respond (requestId, suggestions)
```

### Learning.Task

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 24.

```reaction
when RequestBoundary.request (path: "/learning/task", requestId, session, skill)
then
  Sessioning.use (session)
```

### Learning.Task#2

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 24.

```reaction
when Sessioning.use (session, subject: owner), asked by Learning.Task
where
  earlier, RequestBoundary.request (path: "/learning/task", requestId, session, skill)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (definition)
  view "the current context of (skill) for (owner)" with (owner, skill) has (context, skills, sources, tracks)
  MasteryEstimating._track (definition, learner: owner, subject: skill)
  prerequisitesReady (skill, skills, tracks)
  GroundedTutoring._study (owner, topic: skill) has (sessions)
  materials is selectSkillMaterials (context)
  (selected, valid: true) is selectSources (materials, sources)
  prepared is taskRequest (context, selected, sessions)
then
  TutorGenerating.generate (owner, request: prepared)
```

### Learning.Task#3

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 24.

```reaction
when TutorGenerating.generate (owner, request: prepared, answer), asked by Learning.Task#2
where
  earlier, Sessioning.use (session, subject: owner), asked by Learning.Task
then
  Sessioning.use (session)
```

### Learning.Task:changed#4

Authored path: `Learning.Task`.
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 24.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 24.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 7.
- Covered by [Learning flows](../design/compositions/learning.md), line 24.

```reaction
when GroundedTutoring.prepareTask (citations, criteria, definition, fresh: true, materials, mode: "CHECK", owner, question, topic: skill, task), asked by Learning.Task:current#4
where
  earlier, RequestBoundary.request (path: "/learning/task", requestId, session, skill)
then
  RequestBoundary.respond (requestId, task)
```

### Learning.Transcript

Authored path: `Learning.Transcript`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 29.

```reaction
when RequestBoundary.request (path: "/learning/transcript", requestId, session, studySession, text, turnIndex)
then
  Sessioning.use (session)
```

### Learning.Transcript:missing#2

Authored path: `Learning.Transcript`.
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 29.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 29.

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
- Covered by [Learning flows](../design/compositions/learning.md), line 9.
- Covered by [Learning flows](../design/compositions/learning.md), line 29.

```reaction
when GroundedTutoring.confirmTranscript (owner, session: studySession, text, turnIndex), asked by Learning.Transcript:owned#2
where
  earlier, RequestBoundary.request (path: "/learning/transcript", requestId, session, studySession, text, turnIndex)
then
  RequestBoundary.respond (requestId)
```

### Planning.Begin

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 7.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 17.

```reaction
when RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Begin#2

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 7.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 17.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Begin
where
  MasteryEstimating._progress (learner: owner) has (tracks)
  earlier, RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
  StudyPlanning._item (item) has (candidate, learner: owner, scope: course)
  (definition, skill) is itemSubject (candidate)
  view "(owner) can study confirmed (skill)" with (owner, skill) has (course, definition)
  SkillMapping._map (course) has (skills)
  prerequisitesReady (skill, skills, tracks)
then
  StudyPlanning.begin (item, learner: owner)
```

### Planning.Begin#3

Authored path: `Planning.Begin`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 7.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 17.

```reaction
when StudyPlanning.begin (item, learner: owner), asked by Planning.Begin#2
where
  earlier, RequestBoundary.request (course, item, path: "/planning/begin", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Configure

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 3.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 15.

```reaction
when RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Configure#2

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 3.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 15.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Configure
where
  earlier, RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  StudyPlanning.configure (dailyMinutes, focusNote, learner: owner, scope: course)
```

### Planning.Configure#3

Authored path: `Planning.Configure`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 3.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 15.

```reaction
when StudyPlanning.configure (dailyMinutes, focusNote, learner: owner, scope: course, preferences), asked by Planning.Configure#2
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (course, dailyMinutes, focusNote, path: "/planning/configure", requestId, session)
then
  RequestBoundary.respond (preferences, requestId)
```

### Planning.Finish

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 18.

```reaction
when RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Finish#2

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 18.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Finish
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
  StudyPlanning._item (item) has (learner: owner, scope: course)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  StudyPlanning.finish (actualMinutes, item, learner: owner)
```

### Planning.Finish#3

Authored path: `Planning.Finish`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 18.

```reaction
when StudyPlanning.finish (actualMinutes, item, learner: owner), asked by Planning.Finish#2
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/finish", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Miss

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 20.

```reaction
when RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Miss#2

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 20.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Miss
where
  earlier, RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
  StudyPlanning._item (item) has (learner: owner, scope: course)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  StudyPlanning.miss (item, learner: owner)
```

### Planning.Miss#3

Authored path: `Planning.Miss`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 20.

```reaction
when StudyPlanning.miss (item, learner: owner), asked by Planning.Miss#2
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (course, item, path: "/planning/miss", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Planning.Propose

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 5.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 16.

```reaction
when RequestBoundary.request (course, path: "/planning/propose", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Propose#2

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 5.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 16.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Propose
where
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Planning.Propose#3

Authored path: `Planning.Propose`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 5.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 16.

```reaction
when StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false, plan), asked by Planning.Propose#2
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (course, path: "/planning/propose", requestId, session)
then
  RequestBoundary.respond (plan, requestId)
```

### Planning.Read

Authored path: `Planning.Read`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 3.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 14.

```reaction
when RequestBoundary.request (course, path: "/planning/read", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Read:missing#2

Authored path: `Planning.Read`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 3.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 14.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Read
where
  earlier, RequestBoundary.request (course, path: "/planning/read", requestId, session)
  no view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (error: "COURSE_UNAVAILABLE", requestId)
```

### Planning.Read:owned#2

Authored path: `Planning.Read`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 3.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 14.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Read
where
  earlier, RequestBoundary.request (course, path: "/planning/read", requestId, session)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  RequestBoundary.respond (data: former "study plan for (owner) in (course)" with (course, owner), requestId)
```

### Planning.Stop

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 19.

```reaction
when RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
then
  Sessioning.use (session)
```

### Planning.Stop#2

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 19.

```reaction
when Sessioning.use (session, subject: owner), asked by Planning.Stop
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
  StudyPlanning._item (item) has (learner: owner, scope: course)
  view "(owner) owns (course) with (title)" with (course, owner)
then
  StudyPlanning.stop (actualMinutes, item, learner: owner)
```

### Planning.Stop#3

Authored path: `Planning.Stop`.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 9.
- Covered by [Daily planning flows](../design/compositions/planning.md), line 19.

```reaction
when StudyPlanning.stop (actualMinutes, item, learner: owner), asked by Planning.Stop#2
at the flow's settlement frontier
where
  earlier, RequestBoundary.request (actualMinutes, course, item, path: "/planning/stop", requestId, session)
then
  RequestBoundary.respond (item, requestId)
```

### Progress.ActivateRoutine

Authored path: `Progress.ActivateRoutine`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 13.

```reaction
when StudyPlanning.replan (learner: owner, scope: course, workloadComplete: false, plan)
where
  view "review inputs for (owner) in (course)" with (course, owner) has (basis: currentBasis)
  StudyPlanning._proposalCheck (currentBasis, learner: owner, plan) has (canActivate: true, needsConfirmation: false)
then
  StudyPlanning.activateRoutine (currentBasis, learner: owner, plan)
```

### Progress.AssessedEvidence

Authored path: `Progress.AssessedEvidence`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 7.

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
- Covered by [Progress reactions](../design/compositions/progress.md), line 5.

```reaction
when AssessmentReviewing.submit (author: owner, task)
where
  GroundedTutoring._session (session: task) has (owner, status: "OPEN")
then
  GroundedTutoring.close (owner, session: task)
```

### Progress.ImportedEvidence

Authored path: `Progress.ImportedEvidence`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 7.

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
- Covered by [Progress reactions](../design/compositions/progress.md), line 9.

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
- Covered by [Progress reactions](../design/compositions/progress.md), line 17.

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
- Covered by [Progress reactions](../design/compositions/progress.md), line 17.

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
- Covered by [Progress reactions](../design/compositions/progress.md), line 11.

```reaction
when StudyPlanning.configure (learner: owner, scope: course)
where
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterConfidence

Authored path: `Progress.ReplanAfterConfidence`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 11.

```reaction
when MasteryEstimating.initialize (learner: owner, subject: skill)
at the flow's settlement frontier
where
  view "(owner) owns study skill (skill)" with (owner, skill) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterEvidence

Authored path: `Progress.ReplanAfterEvidence`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 11.

```reaction
when MasteryEstimating.acceptEvidence (learner: owner, subject: skill)
at the flow's settlement frontier
where
  view "(owner) owns study skill (skill)" with (owner, skill) has (course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterFinish

Authored path: `Progress.ReplanAfterFinish`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 15.

```reaction
when StudyPlanning.finish (item, learner: owner)
where
  StudyPlanning._item (item) has (learner: owner, scope: course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterMiss

Authored path: `Progress.ReplanAfterMiss`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 15.

```reaction
when StudyPlanning.miss (item, learner: owner)
where
  StudyPlanning._item (item) has (learner: owner, scope: course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Progress.ReplanAfterStop

Authored path: `Progress.ReplanAfterStop`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 15.

```reaction
when StudyPlanning.stop (item, learner: owner)
where
  StudyPlanning._item (item) has (learner: owner, scope: course)
  view "(owner) can refresh routine reviews in (course)" with (course, owner)
  view "review inputs for (owner) in (course)" with (course, owner) has (basis, candidates, explanation, horizonEnd)
then
  StudyPlanning.replan (basis, candidates, explanation, horizonEnd, learner: owner, scope: course, workloadComplete: false)
```

### Progress.RevisedEvidence

Authored path: `Progress.RevisedEvidence`.
- Covered by [Progress reactions](../design/compositions/progress.md), line 7.

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
- Covered by [Progress reactions](../design/compositions/progress.md), line 3.

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

### reusable.accounts.identifying.Me

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 68.
- Covered by [P2 learning journey](../design/stages/materials.md), line 75.

```reaction
when RequestBoundary.request (path: "/auth/me", requestId, session)
then
  Sessioning.use (session)
```

### reusable.accounts.identifying.Me:known#2

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 68.
- Covered by [P2 learning journey](../design/stages/materials.md), line 75.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 68.
- Covered by [P2 learning journey](../design/stages/materials.md), line 75.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 68.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.

```reaction
when RequestBoundary.request (path: "/auth/logout", requestId, session)
then
  Sessioning.end (session)
```

### reusable.accounts.leaving.SignOut#2

Authored path: `reusable.accounts.leaving.SignOut`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 68.
- Covered by [P2 learning journey](../design/stages/materials.md), line 76.

```reaction
when Sessioning.end (session), asked by reusable.accounts.leaving.SignOut
where
  earlier, RequestBoundary.request (path: "/auth/logout", requestId, session)
then
  RequestBoundary.respond (requestId)
```

### reusable.commons.finishing.ChooseUsername:expired

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
where
  no CommonsFederating._identity (attempt)
then
  RequestBoundary.respond (error: "SIGN_IN_EXPIRED", requestId)
```

### reusable.commons.finishing.ChooseUsername:new

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when Registering.register (recoveryKey, username, user), asked by reusable.commons.finishing.ChooseUsername:new
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ChooseUsername:new#3

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ChooseUsername:new#2
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:new#4

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:new#3
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ChooseUsername:recovered

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ChooseUsername:recovered
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:recovered#3

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:recovered#2
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ChooseUsername:returning

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 64.
- Covered by [P2 learning journey](../design/stages/materials.md), line 74.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:returning
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.FinishCommons

Authored path: `reusable.commons.finishing.FinishCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 58.
- Covered by [P2 learning journey](../design/stages/materials.md), line 72.

```reaction
when RequestBoundary.request (attempt, code, path: "/auth/commons/finish", requestId, state)
then
  CommonsFederating.finish (attempt, code, nonce: state)
```

### reusable.commons.finishing.FinishCommons#2

Authored path: `reusable.commons.finishing.FinishCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 58.
- Covered by [P2 learning journey](../design/stages/materials.md), line 72.

```reaction
when CommonsFederating.finish (attempt, code, nonce: state, username), asked by reusable.commons.finishing.FinishCommons
where
  earlier, RequestBoundary.request (attempt, code, path: "/auth/commons/finish", requestId, state)
then
  RequestBoundary.respond (requestId, username)
```

### reusable.commons.finishing.ResumeCommons:expired

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
where
  no CommonsFederating._identity (attempt)
then
  RequestBoundary.respond (error: "SIGN_IN_EXPIRED", requestId)
```

### reusable.commons.finishing.ResumeCommons:new

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when Registering.register (recoveryKey, username, user), asked by reusable.commons.finishing.ResumeCommons:new
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ResumeCommons:new#3

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ResumeCommons:new#2
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:new#4

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:new#3
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ResumeCommons:recovered

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ResumeCommons:recovered
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:recovered#3

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:recovered#2
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ResumeCommons:returning

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

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
- Covered by [P2 learning journey](../design/stages/materials.md), line 60.
- Covered by [P2 learning journey](../design/stages/materials.md), line 73.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:returning
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.starting.StartCommons

Authored path: `reusable.commons.starting.StartCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 58.
- Covered by [P2 learning journey](../design/stages/materials.md), line 71.

```reaction
when RequestBoundary.request (path: "/auth/commons/start", requestId)
then
  CommonsFederating.start ()
```

### reusable.commons.starting.StartCommons#2

Authored path: `reusable.commons.starting.StartCommons`.
- Covered by [P2 learning journey](../design/stages/materials.md), line 58.
- Covered by [P2 learning journey](../design/stages/materials.md), line 71.

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
- `/courses/materials/read` — requires `material`, `session`
- `/courses/read` — requires `course`, `session`
- `/courses/skills/confirm` — requires `session`, `skill`
- `/courses/skills/edit` — requires `gate`, `material`, `outcome`, `session`, `skill`, `title`, `unit`
- `/courses/skills/propose` — requires `gate`, `material`, `outcome`, `proposalKey`, `session`, `title`, `unit`
- `/courses/skills/suggest` — requires `material`, `session`
- `/courses/units/add` — requires `course`, `session`, `title`
- `/internal/materials/add` — requires `content`, `course`, `importKey`, `locator`, `origin`, `originals`, `session`, `title`
- `/learning/assess` — requires `dialogueLength`, `outsideHelp`, `reviewed`, `session`, `studySession`, `unseen`
- `/learning/confidence` — requires `confidence`, `session`, `skill`
- `/learning/correct` — requires `basedOn`, `case`, `gateMet`, `reason`, `result`, `session`
- `/learning/hint` — requires `session`, `studySession`
- `/learning/lesson` — requires `request`, `session`, `skill`
- `/learning/progress` — requires `course`, `session`
- `/learning/question` — requires `attachment`, `channel`, `dialogueLength`, `session`, `studySession`, `text`
- `/learning/read` — requires `session`, `skill`
- `/learning/regrade` — requires `basedOn`, `case`, `reason`, `session`
- `/learning/reply` — requires `session`, `studySession`
- `/learning/respond` — requires `attachment`, `channel`, `dialogueLength`, `session`, `studySession`, `text`
- `/learning/retry` — requires `session`, `studySession`
- `/learning/task` — requires `session`, `skill`
- `/learning/transcript` — requires `session`, `studySession`, `text`, `turnIndex`
- `/planning/begin` — requires `course`, `item`, `session`
- `/planning/configure` — requires `course`, `dailyMinutes`, `focusNote`, `session`
- `/planning/finish` — requires `actualMinutes`, `course`, `item`, `session`
- `/planning/miss` — requires `course`, `item`, `session`
- `/planning/propose` — requires `course`, `session`
- `/planning/read` — requires `course`, `session`
- `/planning/stop` — requires `actualMinutes`, `course`, `item`, `session`
