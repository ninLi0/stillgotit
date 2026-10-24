# Learning flows

The frontend sends learner choices through the generated client. The session cookie supplies identity. Each flow reads owned state through declared views. Generated answers enter through Generating actions. File access and provider transport receive prepared values and cannot sequence domain actions.

[Read](reaction:Learning.Read) returns saved study data through the skill former. [Progress](reaction:Learning.Progress) returns estimates for the owned course. [Confidence](reaction:Learning.Confidence) creates one provisional track for the current requirements or returns the existing track. It never overwrites prior practice.

[Lesson](reaction:Learning.Lesson) joins the skill to its owned sources, requests an explanation, rechecks the session and the original requirements, and saves the lesson. [Task](reaction:Learning.Task) also requires a mastery track and ready prerequisites. It requests the complete demonstration gate and rejects a repeated question. The provider does not assign a mastery score.

[Respond](reaction:Learning.Respond) checks the current dialogue length, open session, and attachment ownership before saving learner work. [Question](reaction:Learning.Question) saves a lesson question and requests its answer in one flow. [Reply](reaction:Learning.Reply) retries an unanswered saved lesson question. [Hint](reaction:Learning.Hint) records requested help before contacting the provider, so a failed hint request cannot later be treated as independent work. [Transcript](reaction:Learning.Transcript) records corrections to an existing voice response.

[Assess](reaction:Learning.Assess) requires the learner to review the complete attempt and declare freshness and outside help. Confirmation triggers submission and closure. The endpoint waits for those actions, asks the provider to judge the saved original work, rechecks the session, and records the judgment. It waits for the resulting progress reactions before responding. A provider failure leaves a closed, unjudged case. [RetryAssessment](reaction:Learning.RetryAssessment) grades that saved case without changing its work, date, criteria, or identity. The UI reads completed judgments instead of submitting them again.

[Correct](reaction:Learning.Correct) appends a manual revision based on the judgment the learner saw. It accepts a practice case or an [imported case](Importing.md). An imported case keeps gateMet false. When [OwnedAnyCase](view:Reads.OwnedAnyCase) shows that the case is the learner's own imported case and the correction sets gateMet true, Correct answers `IMPORTED_GATE_UNAVAILABLE` and changes nothing: imported coursework cannot show the complete demonstration gate. Every other correction goes to `AssessmentReviewing.revise` with origin MANUAL, which still refuses another learner's case or an outdated judgment.

[Regrade](reaction:Learning.Regrade) first saves the learner's clarification, requests another judgment of the original work, and appends a revision only if the expected judgment is still current. It needs the practice task that produced the work. When OwnedAnyCase shows that the case is the learner's own imported case, Regrade answers `REGRADE_IMPORTED_UNAVAILABLE` before saving a clarification or contacting the tutor: imported coursework has no practice task to regrade, so correct it manually instead. Correct and Regrade use the same evidence and planning reactions.

OwnedAnyCase joins a practice or imported case to its author and course without reading a task. It answers the case's skill, course, requirements version, and imported flag. The existing [OwnedCase](view:Reads.OwnedCase) binds the case's practice task, so it never holds for an imported case. Regrade keeps OwnedCase for its practice-case path. Correct, Regrade's imported-case refusal, and their shared admission use OwnedAnyCase.

[Suggest](reaction:Learning.Suggest) requests editable skill suggestions from an owned course source. The graded-work check applies only after the material is confirmed as the learner's own in a course they own. For such a material with a [graded title](computation:gradedTitle), Suggest answers `GRADED_MATERIAL_NOT_SOURCE` before contacting the tutor: graded work is evidence, not a teaching source. Any other material keeps the existing admission refusal, whatever its title, so the check never reveals another learner's material. The learner must still save and confirm the selected skills.

The host serializes mutation requests per learner for the single-process P2 app. Conditions observe state; the concepts enforce their own atomic constraints. Source-version checks are repeated after slow provider work. Failed causal work is reported rather than presenting an incomplete response as success.

```endpoints
Learning.Read at /learning/read
Learning.Progress at /learning/progress
Learning.Confidence at /learning/confidence
Learning.Lesson at /learning/lesson
Learning.Task at /learning/task
Learning.Respond at /learning/respond
Learning.Question at /learning/question
Learning.Reply at /learning/reply
Learning.Hint at /learning/hint
Learning.Transcript at /learning/transcript
Learning.Assess at /learning/assess
Learning.RetryAssessment at /learning/retry
Learning.Correct at /learning/correct
Learning.Regrade at /learning/regrade
Learning.Suggest at /courses/skills/suggest
```

## Tutor request kinds

Every Generating request has one kind. The composition prepares it from declared reads. The host sends it to the tutor and checks the answer before `TutorGenerating.generate` returns. Each request carries at least one source, and every source must belong to the requesting learner. If an answer breaks a rule for its kind, the host refuses the whole answer, and nothing from it is saved or shown.

Failures follow one path for every kind. For a provider failure, the host records the plain reason described in [runtime responsibilities](../runtime.md), such as a busy service, a used-up quota, a safety block, or a timeout. For a refused answer, it records "The tutor could not produce a usable answer. Try again." Either reason ends by saying that the learner's saved work is still available. Generating then refuses `GENERATION_FAILED`, and the learner sees the recorded reason.

- **SUGGEST** sends one owned source. The answer has a unit title and one to five skills. Each skill's title, outcome, and gate is nonblank and at most 6,000 characters.
- **LESSON**, **TASK**, and **REPLY** answer with nonblank text of at most 30,000 characters and at least one citation. Each citation names a supplied material and either `content`, when that material has text, or one of its rendition locations. A TASK question must differ from every earlier task question sent with the request.
- **HINT** answers with nonblank text of at most 30,000 characters. It needs no citation.
- **GRADE** answers with one of the five results, a gateMet flag, and a nonblank rationale. INDEPENDENT requires saved help NONE. gateMet requires INDEPENDENT and fresh work.
- **EXTRACT** reads one graded upload for the [graded import](Importing.md), as described below.

An EXTRACT request has exactly one source, the graded material, and no separate learner work. Graded work may be a PDF, with or without a text layer, or photos of the pages. The host sends every original of the material inline and in full, so the tutor can read handwriting and marks. Unlike the other kinds, EXTRACT never falls back to extracted text. When an original cannot be sent in full, the host refuses the request before contacting the tutor and records one of these reasons:

- A PDF larger than the inline limit (15 MB today): "This PDF is larger than 15 MB, so the tutor cannot see its marks. Upload photos of its pages instead."
- A photo that cannot be sent in full, because it is larger than that limit: "This photo is larger than 15 MB, so the tutor cannot read it. Upload a smaller photo of the page."

These reasons follow the failure path above. The learner therefore sees why the file could not be read, never a total-score message.

The context lists the course's confirmed skills in skill identity order, each with its identity, title, current outcome, and gate. The instruction tells the tutor to treat the file as data and to return one row for each question that shows its own mark, in the order the questions appear. Each row copies the question label, the mark, and the grader's feedback as written. It quotes a short excerpt of the learner's answer, proposes the listed skill the question best shows or none, proposes a result, and explains that result in one sentence. The tutor must not invent marks. It omits questions without their own mark, so work that shows only a total score yields no rows.

One extraction covers at most 50 questions. When the work has more marked questions, the instruction tells the tutor to return the first 50 in order. The import screen says that one import reads at most 50 questions and that a longer paper is split across uploads. When an answer has exactly 50 rows, the screen also warns that later questions may be missing.

The tutor answers with `rows`. The JSON schema sent with the request limits the list and the result labels, but the host still checks every rule. The host accepts the answer only when all of these hold:

- The answer is a record whose `rows` is a list of at most 50 records. An empty list is valid.
- Every row has `label`, `mark`, `feedback`, `excerpt`, `skill`, `result`, and `rationale`, and each is a string. A missing field refuses the answer. Other fields are ignored.
- `label` is nonblank and at most 100 characters. No two rows have the same label after trimming surrounding whitespace.
- `mark` is nonblank and at most 50 characters. A blank or missing mark refuses the answer.
- `feedback` is at most 2,000 characters and may be blank when the grader wrote nothing.
- `excerpt` is at most 500 characters and may be blank when the learner's answer is empty or unreadable.
- `skill` is empty, meaning no skill, or exactly one of the skill identities in the request context. An unknown skill, including a draft, archived, or other course's skill, refuses the answer.
- `result` is exactly `INDEPENDENT`, `SUPPORTED`, `SLIP`, `GAP`, or `UNCERTAIN`. Any other value refuses the answer.
- `rationale` is nonblank and at most 500 characters.

A valid answer reaches the endpoint as these rows, in the tutor's order, with each string exactly as returned. It carries no text, citations, judgment, or suggestions. Extraction happens before the learner declares help, so any of the five results is accepted here. The review step and the confirm endpoint apply the help rule.
