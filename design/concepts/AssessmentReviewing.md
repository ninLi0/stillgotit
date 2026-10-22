# AssessmentReviewing

## Purpose

Give learners an assessment they can inspect and correct without losing the original work.

## Principle

A learner submits reviewed work or imports graded coursework. The work and its requirements become a saved case. An assessment creates a judgment with a result and explanation. The learner can clarify the same work, request a regrade, or correct the judgment manually. A new judgment becomes effective while earlier judgments remain readable. A changed solution needs a new attempt. An imported course grade remains separate from the app's judgment.

## Types

```types
external Author
  The identity that owns submitted work.
external Subject
  The ability assessed by a case.
external Definition
  The fixed version of the requirements used to assess the work.
external Task
  The practice task that produced submitted work.
Result is INDEPENDENT or SUPPORTED or SLIP or GAP or UNCERTAIN
  INDEPENDENT means successful work without help. SUPPORTED means successful work with help. SLIP means a sound method with a small execution error. GAP means a gap in understanding or application. UNCERTAIN means too little reliable evidence to judge.
Help is NONE or HINT or UNKNOWN
  No assistance, recorded or declared assistance, or unknown assistance. Corrections to a transcript are not help.
Origin is AI or MANUAL
  Whether the judgment came from an automated assessment or a learner's manual correction.
opaque ResponseValue
  An immutable copy of reviewed work: text, confirmed speech transcripts, retained attachment references, and the ordered conversation with its corrections and hints. Attachments preserve their readable content, source locations, and extraction limits. The record includes source references and the reviewed dialogue length when available. It excludes temporary microphone recordings.
opaque ClarificationValue
  Text and optional retained attachments that explain the original work. A clearer image or correction of a transcription error may clarify that work. A changed solution or new answer is not a clarification.
opaque CaseRecords
  Cases with original work, clarifications, judgment history, and effective judgment.
opaque CaseRecord
  One case with original work, clarifications, judgment history, and effective judgment.
```

## State

```state
a set of Cases with
  an author Author
  a subject Subject
  a definition Definition
  a sourceKey String
  an optional task Task
  a question String
  a criteria String
  a response ResponseValue
  a clarifications seq of ClarificationValue
  a help Help
  a fresh Flag
  a performedAt DateTime
  an imported Flag
  an originalMark String
  an originalFeedback String
  unique author and subject and sourceKey
a set of Judgments with
  a case Case
  a revision Number
  a result Result
  a gateMet Flag
  a rationale String
  an origin Origin
  a recordedAt DateTime
  unique case and revision
Rule: each present task has at most one case. A source key is unused when no case has that author, subject, and sourceKey. An unknown case belongs to no author.
Rule: case fields never change except for append-only clarifications. Retained attachment references identify fixed content. Clarifying work does not change its original record or its effective judgment.
Rule: every judgment belongs to an existing case. Judgments never change. Their revisions are consecutive positive integers starting at 1. The highest revision for a case is its effective judgment. A case without judgments has no effective judgment.
Rule: work rules require nonblank sourceKey, question, and criteria, a response containing work, and performedAt no later than now. criteria includes the task requirements and the full demonstration gate.
Rule: judgment rules require INDEPENDENT to have help NONE. gateMet may be true only for fresh INDEPENDENT work that fulfills the complete saved gate. Unknown assistance cannot establish an independent result. Uncertain freshness is recorded as fresh false.
Rule: judgment rules use the case's saved help, freshness, requirements, work, and clarifications. A manual correction follows the same rules as an automated judgment. Clarifications may explain existing work but cannot replace it with a new solution.
Rule: imported cases have no task and preserve the original mark and feedback. Other cases have a task, imported false, and empty originalMark and originalFeedback. The original course grade and the app's judgment are separate records.
Rule: a refused or failed regrade leaves the effective judgment unchanged. A successful regrade adds a revision to the same case; it does not create another attempt.
Rule: blank text is empty or contains only whitespace. now is server time. New identities are unique. Refused actions change no state; unmentioned state stays unchanged.
```

## Actions

```actions
submit(author: Author, subject: Subject, definition: Definition, sourceKey: String, task: Task, question: String, criteria: String, response: ResponseValue, help: Help, fresh: Flag, performedAt: DateTime) : returns (case: Case)
  where the work rules do not hold
  then
    refuses INVALID_ASSESSMENT_WORK "Provide the work, question, requirements, source key, and a valid attempt date."
  where the work rules hold and the source key is already used
  then
    refuses ASSESSMENT_SOURCE_USED "This work already has an assessment case for this skill."
  where the work rules hold, the source key is unused, and task already has a case
  then
    refuses ASSESSMENT_TASK_USED "This practice task has already been submitted."
  where the work rules hold, the source key is unused, and task has no case
  then
    create case with author, subject, definition, sourceKey, task, question, criteria, response, help, fresh, performedAt, imported false, empty clarifications, and empty originalMark and originalFeedback
    returns case

assess(case: Case, result: Result, gateMet: Flag, rationale: String) : returns (judgment: Judgment)
  where case does not exist
  then
    refuses ASSESSMENT_CASE_UNAVAILABLE "Choose an existing assessment case."
  where case exists and already has a judgment
  then
    refuses ASSESSMENT_ALREADY_JUDGED "Use a regrade to change an existing judgment."
  where case exists, has no judgment, and (rationale is blank or the judgment rules do not hold)
  then
    refuses INVALID_INITIAL_JUDGMENT "Provide an explanation and a result consistent with the saved work and assistance."
  where case exists, has no judgment, rationale is not blank, and the judgment rules hold
  then
    create judgment with case, revision 1, result, gateMet, rationale, origin AI, and recordedAt now
    returns judgment

importGraded(author: Author, subject: Subject, definition: Definition, sourceKey: String, question: String, criteria: String, response: ResponseValue, help: Help, fresh: Flag, performedAt: DateTime, mark: String, feedback: String, result: Result, gateMet: Flag, rationale: String) : returns (case: Case, judgment: Judgment)
  where the work rules do not hold or mark or rationale is blank
  then
    refuses INVALID_GRADED_WORK "Provide the graded work, original mark, requirements, attempt date, and assessment explanation."
  where the work rules hold, mark and rationale are not blank, and the source key is already used
  then
    refuses GRADED_SOURCE_USED "This work already has an assessment case for this skill."
  where the work rules hold, mark and rationale are not blank, the source key is unused, and the judgment rules do not hold for the supplied work
  then
    refuses INVALID_IMPORTED_JUDGMENT "Use a result consistent with the imported work and assistance."
  where the work rules hold, mark and rationale are not blank, the source key is unused, and the judgment rules hold for the supplied work
  then
    create case with author, subject, definition, sourceKey, question, criteria, response, help, fresh, performedAt, imported true, no task, empty clarifications, mark as originalMark, and feedback as originalFeedback
    create judgment with case, revision 1, result, gateMet, rationale, origin AI, and recordedAt now
    returns case, judgment

clarify(author: Author, case: Case, clarification: ClarificationValue) : returns ()
  where case does not belong to author
  then
    refuses CLARIFICATION_CASE_UNAVAILABLE "Choose one of your assessment cases."
  where case belongs to author, and ((clarification has neither an explanation nor a readable attachment) or clarification does not concern only the original work)
  then
    refuses INVALID_WORK_CLARIFICATION "Clarify the original work. Submit a new attempt for a changed solution."
  where case belongs to author, (clarification contains an explanation or readable attachment), and it only concerns the original work
  then
    append clarification to the case's clarifications
    returns

revise(author: Author, case: Case, basedOn: Judgment, result: Result, gateMet: Flag, rationale: String, origin: Origin) : returns (judgment: Judgment)
  where case does not belong to author
  then
    refuses REVISION_CASE_UNAVAILABLE "Choose one of your assessment cases."
  where case belongs to author and basedOn is not its effective judgment
  then
    refuses JUDGMENT_REVISION_OUTDATED "Review the current judgment before submitting a revision."
  where case belongs to author, basedOn is its effective judgment, and (rationale is blank or the judgment rules do not hold)
  then
    refuses INVALID_REVISED_JUDGMENT "Provide an explanation and a result consistent with the saved work and assistance."
  where case belongs to author, basedOn is its effective judgment, rationale is not blank, and the judgment rules hold
  then
    create judgment with case, revision one greater than basedOn, result, gateMet, rationale, origin, and recordedAt now
    returns judgment
```

## Queries

```queries
_cases(author: Author, subject: Subject) : many (case: Case, definition: Definition, performedAt: DateTime, imported: Flag)
  Returns the author's cases for the subject across all requirement versions, ordered by performedAt and then case identity. Returns no rows when none match.

_case(case: Case) : optional (author: Author, subject: Subject, definition: Definition, sourceKey: String, task?: Task, help: Help, fresh: Flag, performedAt: DateTime, imported: Flag)
  Returns the case's identity fields, recorded assistance, freshness, and attempt date. Omits task for imported work. Returns no row for an unknown case.

_work(case: Case) : optional (question: String, criteria: String, response: ResponseValue, originalMark: String, originalFeedback: String)
  Returns the fixed question, requirements, reviewed work, and original course grade. The original mark and feedback are empty for practice cases. Returns no row for an unknown case.

_clarifications(case: Case) : many (index: Number, clarification: ClarificationValue)
  Returns the case's clarifications in append order with stable zero-based indices. Returns no rows for an unknown case or one without clarifications.

_judgments(case: Case) : many (judgment: Judgment, revision: Number, result: Result, gateMet: Flag, rationale: String, origin: Origin, recordedAt: DateTime)
  Returns every judgment for the case in increasing revision order. Returns no rows for an unknown case or one that has not been assessed.

_judgment(judgment: Judgment) : optional (case: Case, revision: Number, result: Result, gateMet: Flag, rationale: String, origin: Origin, recordedAt: DateTime)
  Returns the saved judgment and its case. Returns no row for an unknown judgment.

_effectiveJudgment(case: Case) : optional (judgment: Judgment, revision: Number, result: Result, gateMet: Flag, rationale: String, origin: Origin, recordedAt: DateTime)
  Returns the judgment with the highest revision for the case. Returns no row for an unknown case or one that has not been assessed.

_byTask(author: Author, task: Task) : optional (case: Case)
  Returns the author's saved case for the task, or no row. The submission flow uses this to recover an already-saved attempt after an interrupted reply.

_history(author: Author, subject: Subject) : one (cases: CaseRecords)
  Returns this author's cases for the subject in performedAt order, or an empty list. Reads only assessment state.

_caseData(case: Case) : optional (data: CaseRecord)
  Returns this case with its original work and judgment history. Returns no row for an unknown case. The application checks ownership.
```
