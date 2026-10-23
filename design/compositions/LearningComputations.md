# Learning computations

These functions are pure calculations over values supplied by queries and action records. They do not read databases, change state, call providers, or start other actions.

- **SkillContext**: One current skill, its course, requirements, source identities, and prerequisites.
- **SourceSelection**: The selected source records and a flag saying whether every requested source was found.
- **StudyDetail**: The selected skill, matching track and estimate, sessions, and assessment cases.
- **SkillProgress**: Skill identities paired with optional current estimates.
- **ResponseInput**: Validated response text, channel, retained attachments, and a validity flag.
- **SubmissionInput**: Original work, its stable source key, effective help, and declared freshness.
- **AttemptClarification**: A reason concerning the original work, with no new solution or attachments.
- **EvidenceUpdate**: Whether a saved judgment needs to replace or create a mastery contribution.
- **ReviewProposal**: Candidates, horizon end, explanation, and a fingerprint of the current evidence and requirements.
- **PlanDetail**: Preferences, today's budget, next item, and the active plan with deferred work.
- **ItemSubject**: The skill and requirements version named by a planning candidate.
- **GenerationDefinition**: The original requirements version and task criteria sent to the provider.

```computations
correctionNote(reason: String) : AttemptClarification
  Formats the learner's explanation as a clarification of original work.

dialogueIsCurrent(data: GroundedTutoring.StudyRecord, dialogueLength: Number) : Flag
  Compares the learner's displayed dialogue length with saved dialogue.

evidenceUpdate(data: AssessmentReviewing.CaseRecord, tracks: MasteryEstimating.ProgressRows) : EvidenceUpdate
  Requires a matching track and a newer effective judgment revision than the contribution already applied.

generationDefinition(request: TutorRequest) : GenerationDefinition
  Recovers the original version and criteria after provider work, so current requirements can be checked again.

generationFields(answer: TutorAnswer) : TutorAnswer
  Exposes fields from a validated provider answer for later actions.

gradeRequest(selected: GroundedTutoring.SourceRecords, data: AssessmentReviewing.CaseRecord) : TutorRequest
  Prepares the immutable assessment work and clarifications for grading. It does not call a provider.

hasLessonQuestion(data: GroundedTutoring.StudyRecord) : Flag
  Requires a lesson whose latest turn is a learner response.

itemSubject(candidate: StudyPlanning.Candidate) : ItemSubject
  Extracts the activity's saved skill and requirement version for validation.

lessonRequest(selected: GroundedTutoring.SourceRecords, context: SkillContext, request: String) : TutorRequest
  Prepares the selected outcome and learner question for a cited lesson.

planDetail(schedule: StudyPlanning.ScheduleValue) : PlanDetail
  Selects the active plan and totals scheduled and deferred minutes.

planRequest(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, schedule: StudyPlanning.ScheduleValue) : ReviewProposal
  Builds ten-minute review candidates within seven days, or through the day before the nearest active exam when that is later. Independent success on distinct days extends review intervals from one to three to seven days. Missed activities do not change mastery. Reads the active exams and saved plans from the schedule. Marks preparation for the nearest active exam, including prerequisites of its covered skills, under separate exam keys, and carries its unfinished preparation forward unchanged, as the planning composition describes. The fingerprint excludes continuous time decay but includes evidence revisions, requirement versions, and prerequisites.

prerequisitesReady(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill) : Flag
  Traverses prerequisite identities in the supplied map, requiring confirmed definitions and ready estimates. A visited set bounds cycles.

progressRows(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows) : SkillProgress
  Pairs each course skill with its estimate for the current definition.

responseInput(data: GroundedTutoring.StudyRecord, text: String, channel: GroundedTutoring.Channel, attachment: String, sources: GroundedTutoring.SourceRecords) : ResponseInput
  Checks attachment membership and rejects a response with neither text nor work.

reviewApproved(reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag
  Requires explicit whole-attempt review and Boolean freshness and outside-help declarations.

selectSkill(skills: SkillMapping.SkillMapRows, skill: SkillMapping.Skill) : SkillContext
  Selects the current skill from the owned course map.

selectSkillMaterials(context: SkillContext) : GroundedTutoring.MaterialSet
  Returns the current skill's material identities.

selectSources(sources: GroundedTutoring.SourceRecords, materials: GroundedTutoring.MaterialSet) : SourceSelection
  Selects the requested material identities and checks that none are missing.

sessionMaterials(data: GroundedTutoring.StudyRecord) : GroundedTutoring.MaterialSet
  Returns the source identities fixed when the session was created.

sessionRequest(selected: GroundedTutoring.SourceRecords, data: GroundedTutoring.StudyRecord, kind: String) : TutorRequest
  Prepares saved dialogue and sources for a lesson reply or requested hint.

studyDetail(context: SkillContext, tracks: MasteryEstimating.ProgressRows, sessions: GroundedTutoring.StudyRecords, cases: AssessmentReviewing.CaseRecords) : StudyDetail
  Matches the current skill definition to its track; retains original session and assessment history.

submissionInput(data: GroundedTutoring.StudyRecord, unseen: Flag, outsideHelp: Flag) : SubmissionInput
  Uses corrected transcripts, saved attachments, and recorded hints. Converts dates to JSON values. Outside help prevents independent classification; the learner's freshness claim can only reduce the task's freshness.

suggestRequest(selected: GroundedTutoring.SourceRecords) : TutorRequest
  Prepares one owned source for editable skill suggestions.

taskRequest(selected: GroundedTutoring.SourceRecords, context: SkillContext, sessions: GroundedTutoring.StudyRecords) : TutorRequest
  Includes the complete gate and earlier task questions so the provider can propose fresh work.

attemptIsReady(data: GroundedTutoring.StudyRecord, dialogueLength: Number, reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag
  Requires a practice task, at least one learner answer, current dialogue length, and explicit review and assistance declarations.

sessionSubject(identity: SessionIdentity) : SessionOwner
  Extracts the owner from a successful Sessioning.use result. Only the Read endpoint's authenticated occurrence triggers recovery.

```
