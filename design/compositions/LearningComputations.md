# Learning computations

These functions are pure calculations over values supplied by queries and action records. They do not read databases, change state, call providers, or start other actions.

- **SkillContext**: One current skill, its course, requirements, source identities, and prerequisites.
- **SourceSelection**: The selected source records and a flag saying whether every requested source was found.
- **StudyDetail**: The selected skill, matching track and estimate, sessions, and assessment cases.
- **EstimateTimeline**: The estimate's starting point, its ordered changes with time, source, values before and after, time decay, and each adjustment's reason, the attempts that did not count, a provisional flag, and the concept's basis sentence. It is null when the skill's current definition has no explanation.
- **SkillProgress**: Skill identities paired with optional current estimates.
- **AttachmentList**: The material identities a learner attaches to one response, in the order attached. It may be empty.
- **ResponseInput**: Validated response text, channel, the retained files of every attachment in order, and a validity flag.
- **SubmissionInput**: Original work, its stable source key, effective help, and declared freshness.
- **AttemptClarification**: A reason concerning the original work, with no new solution or attachments.
- **EvidenceUpdate**: Whether a saved judgment needs to replace or create a mastery contribution.
- **ReviewProposal**: Candidates, horizon end, explanation, and a fingerprint of the current evidence, manual adjustments, and requirements.
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

gradeRequest(selected: Library.SourceRecords, data: AssessmentReviewing.CaseRecord) : TutorRequest
  Prepares the immutable assessment work and clarifications for grading. It does not call a provider.

hasLessonQuestion(data: GroundedTutoring.StudyRecord) : Flag
  Requires a lesson whose latest turn is a learner response.

itemSubject(candidate: StudyPlanning.Candidate) : ItemSubject
  Extracts the activity's saved skill and requirement version for validation.

lessonRequest(selected: Library.SourceRecords, context: SkillContext, request: String) : TutorRequest
  Prepares the selected outcome and learner question for a cited lesson.

planDetail(schedule: StudyPlanning.ScheduleValue) : PlanDetail
  Selects the active plan and totals scheduled and deferred minutes.

planRequest(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, schedule: StudyPlanning.ScheduleValue) : ReviewProposal
  Builds ten-minute review candidates within seven days, or through the day before the nearest active exam when that is later. Independent success on distinct days extends review intervals from one to three to seven days. Missed activities do not change mastery. Reads the active exams and saved plans from the schedule. Marks preparation for the nearest active exam, including prerequisites of its covered skills, under separate exam keys, and carries its unfinished preparation forward unchanged, as the planning composition describes. The fingerprint excludes continuous time decay but includes evidence revisions, each track's manual adjustments, requirement versions, and prerequisites.
  A candidate's key names the skill, its definition, the latest informative evidence and its revision, and, once the track has an adjustment, its latest adjustment. StudyPlanning accepts a reused key only with an identical candidate, so a new adjustment needs a new key before the candidate's priority can follow the adjusted estimate. Skills without adjustments keep the keys they have today.
  After an adjustment, the skill's candidate takes its priority from the adjusted estimate and its reason from the concept's readiness. Its earliest and latest days still follow the latest evidence, because an adjustment is not practice. An activity already finished for the same evidence within its window is not offered again because of an adjustment.

prerequisitesReady(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill) : Flag
  Traverses prerequisite identities in the supplied map, requiring confirmed definitions and ready estimates. A visited set bounds cycles.

progressRows(skills: SkillMapping.SkillMapRows, tracks: MasteryEstimating.ProgressRows) : SkillProgress
  Pairs each course skill with its estimate for the current definition.

responseInput(data: GroundedTutoring.StudyRecord, text: String, channel: GroundedTutoring.Channel, attachments: AttachmentList, sources: Library.SourceRecords) : ResponseInput
  Checks each listed material against the supplied sources, which are the learner's own materials in the session's course, and treats a list that names one material twice as invalid. One failing entry makes the whole response invalid. Rejects a response with neither text nor an attachment. The media are the retained files of each listed material in list order, keeping each material's own file order.

reviewApproved(reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag
  Requires explicit whole-attempt review and Boolean freshness and outside-help declarations.

selectSkill(skills: SkillMapping.SkillMapRows, skill: SkillMapping.Skill) : SkillContext
  Selects the current skill from the owned course map.

selectSkillMaterials(context: SkillContext) : GroundedTutoring.MaterialSet
  Returns the current skill's material identities.

selectSources(sources: Library.SourceRecords, materials: GroundedTutoring.MaterialSet) : SourceSelection
  Selects the requested material identities and checks that none are missing. The flows pass the learner's own materials in one course as the sources, so a valid selection also means that every requested material belongs to the learner and to that course, which GroundedTutoring no longer checks itself.

sessionMaterials(data: GroundedTutoring.StudyRecord) : GroundedTutoring.MaterialSet
  Returns the source identities fixed when the session was created.

sessionRequest(selected: Library.SourceRecords, data: GroundedTutoring.StudyRecord, kind: String) : TutorRequest
  Prepares saved dialogue and sources for a lesson reply or requested hint.

studyDetail(context: SkillContext, tracks: MasteryEstimating.ProgressRows, sessions: GroundedTutoring.StudyRecords, cases: AssessmentReviewing.CaseRecords) : StudyDetail
  Matches the current skill definition to its track; retains original session and assessment history. Cases pass through unchanged, including the original mark and feedback of an imported case.

estimateTimeline(explanation?: MasteryEstimating.EstimateExplanation, tracks: MasteryEstimating.ProgressRows) : EstimateTimeline
  Returns null when explanation is absent, which happens when the current definition has no track or the track starts after the read's instant. SkillData still returns its one record in that case.
  Otherwise selects what the skill page shows from the concept's explanation. It keeps the concept's order and recomputes no score, decay, or readiness.
  The start is the replay start date, the initial confidence, and the starting basis, SELF_REPORTED or PREVIOUS_DEFINITION.
  The changes have one row for each change the concept reports, in the concept's order: by time; at one instant, assessed attempts by evidence identity and then adjustments in the order they were made; last, the time decay up to the read's instant when that instant is later than the last event.
  Each row has at, kind, source, before, after, decay, days, and reason. Kind comes from matching the change's source by identity, in this order. A source listed in the explanation's evidence is an ATTEMPT, and the source is that assessment case. A source equal to an adjustment identity in the supplied tracks is an ADJUSTMENT; the source is that adjustment, and reason is the reason saved with it. Adjustment identities are unique, so the computation does not need to choose a track first. The concept marks its time-decay change up to the read's instant with the source `time`; that row is TIME, with an empty source. Assessment cases and adjustments are separate identities, so no source matches both. A source that matches none of these is a fault, not a guess. Reason is empty except on adjustment rows.
  An attempt or adjustment row folds in the decay before it: before is the value after time decay, just before the event, and decay is the amount time removed since the previous row. In the time row, before is the value at the previous row and decay is before minus after.
  Days is the number of whole days, rounded down, since the previous row, or since the replay start for the first row. Values stay unrounded; the page rounds them for display.
  Ignored lists each attempt the concept did not count, with the concept's reason, in the concept's order. Provisional is true when no row is an attempt. Basis is the concept's basis sentence, unchanged.

submissionInput(data: GroundedTutoring.StudyRecord, unseen: Flag, outsideHelp: Flag) : SubmissionInput
  Uses corrected transcripts, saved attachments, and recorded hints. Converts dates to JSON values. Outside help prevents independent classification; the learner's freshness claim can only reduce the task's freshness.

suggestRequest(selected: Library.SourceRecords) : TutorRequest
  Prepares one owned source for editable skill suggestions.

taskRequest(selected: Library.SourceRecords, context: SkillContext, sessions: GroundedTutoring.StudyRecords) : TutorRequest
  Includes the complete gate and earlier task questions so the provider can propose fresh work.

attemptIsReady(data: GroundedTutoring.StudyRecord, dialogueLength: Number, reviewed: Flag, unseen: Flag, outsideHelp: Flag) : Flag
  Requires a practice task, at least one learner answer, current dialogue length, and explicit review and assistance declarations.

sessionSubject(identity: SessionIdentity) : SessionOwner
  Extracts the owner from a successful Sessioning.use result. Only the Read endpoint's authenticated occurrence triggers recovery.

```
