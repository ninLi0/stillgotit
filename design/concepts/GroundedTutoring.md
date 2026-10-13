# GroundedTutoring

## Purpose

Help learners understand and practice a topic using sources they can inspect.

## Principle

A learner selects course material and starts a lesson with a free question or a study button. The tutor explains from those sources. The learner asks follow-up questions by voice and can correct transcription errors. The lesson can close without a transcript approval step. Later, the learner completes an independent practice task. A requested hint is recorded as help. The learner reviews the task's voice transcripts together before submitting work for assessment. The saved record preserves the requirements, sources, responses, and assistance used.

## Types

```types
external Learner
  The identity that owns materials and sessions.
external Scope
  The context to which source material belongs.
external Topic
  The subject being learned or practiced.
external Definition
  The fixed version of the requirements used in a session.
MaterialOrigin is COURSE or REFERENCE
  Material brought from the learner's course or chosen as a reference.
Mode is GUIDED or CHECK
  Guided coaching or an independent check with help only on request.
SessionStatus is OPEN or CLOSED
  Whether a session accepts new dialogue.
Channel is TEXT or VOICE
  Typed or transcribed speech. Retained attachments may accompany either.
opaque MediaValue
  A retained file reference with a name, media type, content locations, readable renditions, and any extraction limitations. Covers documents, slides, sheets, text, code, notebooks, images, uploaded source audio, and supported archive contents. Does not contain temporary microphone recordings. Its concrete representation is defined in design/material-data.md; the host verifies referenced files before supplying these values.
opaque MediaList
  An ordered sequence of MediaValue records. The order preserves pages, slides, files, or other supplied parts.
opaque MaterialSet
  A finite set of Material identities, with no duplicates or ordering.
opaque PassageRef
  An immutable Material identity and a location within that material. Locations may identify pages, paragraphs, slides, cells, image regions, code lines, notebook cells, or audio timestamps.
opaque PassageSet
  A finite set of PassageRef values, with no duplicates or ordering.
opaque DialogueTurn
  An immutable value containing speaker, purpose, text, media, channel, citations, server time, and an optional correction target. Purposes are RESPONSE, EXPLANATION, PROBE, CLARIFICATION, HINT, or CORRECTION. A correction targets an original learner voice response by its dialogue index.
```

## State

```state
a set of Materials with
  an owner Learner
  a scope Scope
  a title String
  a locator String
  a content String
  an originals seq of MediaValue
  an origin MaterialOrigin
a set of Sessions with
  an owner Learner
  a topic Topic
  a definition Definition
  a materials set of Materials
  a citations set of PassageRef
  a dialogue seq of DialogueTurn
  a checkedVoiceTurns set of Number
  a status SessionStatus
a set of Lesson Sessions with
  a request String
  an explanation String
a set of Practice Sessions with
  a question String
  a criteria String
  a mode Mode
  a fresh Flag
  a hintRequested Flag
Rule: each session is in exactly one of Lesson Sessions or Practice Sessions. A lesson means a member of Lesson Sessions; a task means a member of Practice Sessions.
Rule: an owner's open lesson or task must exist, have that owner and kind, and have status OPEN. An unknown session belongs to no owner.
Rule: source rules require a nonempty set of existing materials, all owned by the session owner and in the same scope. Citations are nonempty and identify valid locations in those materials.
Rule: material records, session sources, topic, definition, and opening content never change. Source edits produce a new Material. Dialogue is append-only while OPEN. CLOSED sessions cannot change.
Rule: materials contain readable text or readable retained media. Their file references preserve extraction limitations. Unreadable uploads do not become teaching material.
Rule: material inputs match their declared types and the material data representation. References are nonblank strings. Malformed material inputs are refused before any state change.
Rule: dialogue indices are zero-based and remain stable. checkedVoiceTurns contains only indices of learner RESPONSE turns with channel VOICE. The effective transcript is the latest CORRECTION for that response, or its original text when there is no correction.
Rule: ordinary lessons need no transcript confirmation. Assessment requires every voice response in the task to have its effective transcript confirmed. Closing a session alone does not submit work for assessment.
Rule: a PROBE asks for reasoning without correctness feedback, correction, or a solution method. A CLARIFICATION resolves input without solution content. Help that reveals a method or correction is a HINT, even when phrased as a question.
Rule: CHECK tasks withhold corrections before submission unless help is requested. GUIDED tasks permit coaching. Recorded hints stay in the dialogue and count as assistance; input corrections and neutral questions do not.
Rule: task criteria include both the task requirements and the full demonstration gate. A task may contain several problems and follow-up questions. Fresh work has not already been shown solved to the learner; different numbers alone do not establish freshness.
Rule: a voice response must contain a nonblank transcript. Microphone audio is temporary transcription input, not retained dialogue media. Uploaded source audio remains part of its Material.
Rule: blank text is empty or contains only whitespace. New identities are unique. now is server time. Refused actions change no state; unmentioned state stays unchanged.
```

## Actions

```actions
addMaterial(owner: Learner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin) : returns (material: Material)
  where material inputs do not match their declared types or representation, title or locator is blank, or neither content nor originals contains readable source material
  then
    refuses INVALID_TUTORING_MATERIAL "Provide a title, source location, and readable material."
  where material inputs match their declared types and representation, title and locator are not blank, and at least one of content or originals contains readable source material
  then
    create material with owner, scope, title, locator, content, originals, and origin
    returns material

explain(owner: Learner, topic: Topic, definition: Definition, request: String, explanation: String, materials: MaterialSet, citations: PassageSet) : returns (lesson: Session)
  where request or explanation is blank
  then
    refuses INVALID_LESSON_CONTENT "Provide a learning request and explanation."
  where request and explanation are not blank and the source rules do not hold
  then
    refuses INVALID_LESSON_SOURCES "Use your readable sources from one course and cite their content."
  where request and explanation are not blank and the source rules hold
  then
    create lesson in Lesson Sessions with owner, topic, definition, materials, citations, request, explanation, status OPEN, and empty dialogue and checkedVoiceTurns
    returns lesson

prepareTask(owner: Learner, topic: Topic, definition: Definition, question: String, criteria: String, materials: MaterialSet, citations: PassageSet, mode: Mode, fresh: Flag) : returns (task: Session)
  where question or criteria is blank
  then
    refuses INVALID_TASK_CONTENT "Provide a practice question and its assessment requirements."
  where question and criteria are not blank and the source rules do not hold
  then
    refuses INVALID_TASK_SOURCES "Use your readable sources from one course and cite their content."
  where question and criteria are not blank and the source rules hold
  then
    create task in Practice Sessions with owner, topic, definition, materials, citations, question, criteria, mode, fresh, status OPEN, empty dialogue and checkedVoiceTurns, and hintRequested false
    returns task

respond(owner: Learner, session: Session, text: String, media: MediaList, channel: Channel) : returns ()
  where session does not belong to owner or is not OPEN
  then
    refuses RESPONSE_SESSION_UNAVAILABLE "Choose one of your open sessions."
  where session belongs to owner and is OPEN, and ((text is blank and media is empty) or (channel is VOICE and text is blank))
  then
    refuses INVALID_LEARNER_RESPONSE "Provide a response. Spoken responses need a transcript."
  where session belongs to owner and is OPEN, (text is not blank or media is not empty), and (channel is TEXT or text is not blank)
  then
    append a learner RESPONSE with text, media, channel, empty citations, time now, and no correction target
    returns

answerLesson(owner: Learner, lesson: Session, text: String, citations: PassageSet, channel: Channel) : returns ()
  where lesson is not owner's open lesson
  then
    refuses LESSON_ANSWER_UNAVAILABLE "Choose one of your open lessons."
  where lesson is owner's open lesson, and (text is blank or citations are empty or do not identify valid locations in its materials)
  then
    refuses INVALID_LESSON_ANSWER "Provide an explanation with references to this lesson's sources."
  where lesson is owner's open lesson, text is not blank, and citations are nonempty and valid within its materials
  then
    append a tutor EXPLANATION with text, channel, citations, empty media, time now, and no correction target
    returns

askFollowup(owner: Learner, task: Session, question: String, channel: Channel) : returns ()
  where task is not owner's open task
  then
    refuses FOLLOWUP_TASK_UNAVAILABLE "Choose one of your open practice tasks."
  where task is owner's open task, and (question is blank or supplies feedback, a correction, or a solution method)
  then
    refuses INVALID_TASK_PROBE "Ask for reasoning without supplying feedback or a method."
  where task is owner's open task and question is nonblank and supplies no feedback, correction, or solution method
  then
    append a tutor PROBE with question as text, channel, empty media and citations, time now, and no correction target
    returns

clarifyInput(owner: Learner, session: Session, question: String, channel: Channel) : returns ()
  where session does not belong to owner or is not OPEN
  then
    refuses CLARIFICATION_SESSION_UNAVAILABLE "Choose one of your open sessions."
  where session belongs to owner and is OPEN, and (question is blank or supplies solution content)
  then
    refuses INVALID_INPUT_CLARIFICATION "Ask about the unclear input without supplying a solution."
  where session belongs to owner and is OPEN, and question is nonblank and supplies no solution content
  then
    append a tutor CLARIFICATION with question as text, channel, empty media and citations, time now, and no correction target
    returns

requestHint(owner: Learner, task: Session) : returns ()
  where task is not owner's open task
  then
    refuses HINT_REQUEST_UNAVAILABLE "Choose one of your open practice tasks."
  where task is owner's open task
  then
    set hintRequested to true
    returns

giveHint(owner: Learner, task: Session, text: String, channel: Channel) : returns ()
  where task is not owner's open task
  then
    refuses HINT_TASK_UNAVAILABLE "Choose one of your open practice tasks."
  where task is owner's open task and text is blank
  then
    refuses INVALID_HINT_TEXT "Provide the hint text."
  where task is owner's open task, text is not blank, mode is CHECK, and hintRequested is false
  then
    refuses HINT_NOT_REQUESTED "Wait for the learner to request help during an independent check."
  where task is owner's open task, text is not blank, and (mode is GUIDED or hintRequested is true)
  then
    append a tutor HINT with text, channel, empty media and citations, time now, and no correction target
    set hintRequested to false
    returns

confirmTranscript(owner: Learner, session: Session, turnIndex: Number, text: String) : returns ()
  where session does not belong to owner or is not OPEN
  then
    refuses TRANSCRIPT_SESSION_UNAVAILABLE "Choose one of your open sessions."
  where session belongs to owner and is OPEN, and turnIndex does not identify an original learner voice response
  then
    refuses TRANSCRIPT_TURN_UNAVAILABLE "Choose a spoken response from this session."
  where session belongs to owner and is OPEN, turnIndex identifies an original learner voice response, and text is blank
  then
    refuses INVALID_CONFIRMED_TRANSCRIPT "Provide the text that was spoken."
  where session belongs to owner and is OPEN, turnIndex identifies an original learner voice response, and text is not blank
  then
    if text differs from the effective transcript, append a learner CORRECTION with text, channel TEXT, empty media and citations, time now, and correction target turnIndex
    add turnIndex to checkedVoiceTurns
    returns

confirmAttempt(owner: Learner, task: Session, dialogueLength: Number) : returns ()
  where task is not owner's open task
  then
    refuses ATTEMPT_REVIEW_UNAVAILABLE "Choose one of your open practice tasks."
  where task is owner's open task and dialogueLength differs from the current dialogue length
  then
    refuses ATTEMPT_REVIEW_CHANGED "The conversation changed. Review the latest transcript."
  where task is owner's open task and dialogueLength equals the current dialogue length
  then
    add every original learner voice response index to checkedVoiceTurns, confirming its current effective transcript
    returns

close(owner: Learner, session: Session) : returns ()
  where session does not belong to owner or is not OPEN
  then
    refuses SESSION_CLOSE_UNAVAILABLE "Choose one of your open sessions."
  where session belongs to owner and is OPEN
  then
    set status to CLOSED
    returns
```

## Queries

```queries
_materials(owner: Learner, scope: Scope) : many (material: Material, title: String, locator: String, origin: MaterialOrigin)
  Returns the owner's materials in the scope, ordered by material identity. Returns no rows when none match.

_material(material: Material) : optional (owner: Learner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin)
  Returns the saved material and retained file references. Returns no row for an unknown material.

_sessions(owner: Learner, topic: Topic) : many (session: Session, definition: Definition, status: SessionStatus)
  Returns the owner's sessions for the topic in every status, ordered by session identity. Returns no rows when none match.

_session(session: Session) : optional (owner: Learner, topic: Topic, definition: Definition, status: SessionStatus)
  Returns the session's owner, topic, requirements version, and status. Returns no row for an unknown session.

_lesson(lesson: Session) : optional (request: String, explanation: String)
  Returns a lesson's opening request and explanation. Returns no row for an unknown session or a practice task.

_task(task: Session) : optional (question: String, criteria: String, mode: Mode, fresh: Flag, hintRequested: Flag)
  Returns a task's saved question, criteria, mode, freshness, and pending hint request. Returns no row for an unknown session or a lesson.

_sources(session: Session) : many (material: Material)
  Returns the session's material references, ordered by material identity. Returns no rows for an unknown session.

_citations(session: Session) : many (citation: PassageRef)
  Returns the opening citations, ordered by material identity and then location. Returns no rows for an unknown session. Later citations remain in dialogue turns.

_dialogue(session: Session) : many (turnIndex: Number, turn: DialogueTurn)
  Returns all turns in increasing index order, including original speech transcripts, corrections, and hints. Returns no rows for an unknown session or empty dialogue.

_voiceResponses(session: Session) : many (turnIndex: Number, text: String, confirmed: Flag)
  Returns each original learner voice response's index, effective transcript, and confirmation state, in increasing index order. Returns no rows for an unknown session or one without voice responses.

_review(task: Session) : optional (dialogueLength: Number, uncheckedVoiceCount: Number, ready: Flag)
  Returns the dialogue length and number of unchecked voice responses. ready is true only for an OPEN task with at least one learner response and no unchecked voice responses. Returns no row for an unknown session or a lesson. This query does not judge correctness or source quality.
```
