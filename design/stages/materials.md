# P2 learning journey

This stage connects course materials, skill review, tutoring, assessment, mastery, and a study budget. Concept implementations use the full specifications. The screen shows one course at a time, and a menu in the header switches courses or starts a new one. Learners can record exam dates for a course and confirm or decline a proposed plan that would cut exam preparation.

```types
concrete TutorRequest
  A server-prepared generation request containing its purpose, owned sources, saved context, and optional learner work. Once withChoice has added it, the request also carries the validated tutor model and thinking level; the Gemini transport refuses a tutor request without that pair.
concrete TutorAnswer
  Validated generated text, citations, material identities, optional judgment values, and skill suggestions.
concrete TutorChoice
  One offered tutor model name and one thinking level that model supports, validated on the server against the tutor catalog.
```

```instances
instantiate Registering

instantiate Federating as CommonsFederating with
  User is Registering.User

instantiate Sessioning with
  Subject is Registering.User

instantiate SkillMapping with
  User is Registering.User
  Material is GroundedTutoring.Material

instantiate GroundedTutoring with
  Learner is Registering.User
  Scope is SkillMapping.Course
  Topic is SkillMapping.Skill
  Definition is SkillMapping.Version

instantiate AssessmentReviewing with
  Author is Registering.User
  Subject is SkillMapping.Skill
  Definition is SkillMapping.Version
  Task is GroundedTutoring.Session

instantiate MasteryEstimating with
  Learner is Registering.User
  Subject is SkillMapping.Skill
  Definition is SkillMapping.Version
  Evidence is AssessmentReviewing.Case

instantiate StudyPlanning with
  Learner is Registering.User
  Scope is SkillMapping.Course
  Subject is SkillMapping.Skill
  Definition is SkillMapping.Version

instantiate Generating as TutorGenerating with
  Owner is Registering.User
  Request is TutorRequest
  Answer is TutorAnswer

instantiate Preferring as TutorPreferring with
  User is Registering.User
  Option is TutorChoice

```

## Accounts

[StartCommons](reaction:reusable.commons.starting.StartCommons) creates a temporary attempt. The HTTP adapter stores it in an HttpOnly cookie. [FinishCommons](reaction:reusable.commons.finishing.FinishCommons) checks the callback's state and code and saves confirmation. It returns the suggested username, but does not yet issue a local session.

The browser then calls [ResumeCommons](reaction:reusable.commons.finishing.ResumeCommons). The host reads `_identity` using the cookie's attempt. If no local link exists, it calls `RegistrationRecoveryStore.getOrCreate` with the verified subject. The host replaces any caller-supplied recovery key and username with its own values. This write occurs outside reactions and queries.

ResumeCommons rechecks `_identity`. An existing link supplies the local user. Otherwise, it reads `_byRecoveryKey` and reuses that user, or calls `register` with the saved key and suggested username. It then calls `link`. Only a verified link can lead to `Sessioning.start`. The response contains the linked user and new session.

A name conflict lets the student submit [ChooseUsername](reaction:reusable.commons.finishing.ChooseUsername), which uses the same continuation with a chosen name. A saved account keeps its existing name. A competing registration or link permits one reread and retry of the continuation. A consumed code is never automatically submitted again.

The host checks the live clock after slow work and after the continuation returns. If the attempt expires, it withholds session cookies and tries to end any newly created session. The engine uses uncached queries for this stage. Its flow-start time is not used to extend a sign-in deadline. Sessions are not exactly-once: a lost reply can leave an undisclosed session until cleanup or expiry.

[Me](reaction:reusable.accounts.identifying.Me) calls `Sessioning.use`, then reads the saved username. A missing local account returns `NOT_SIGNED_IN`. [SignOut](reaction:reusable.accounts.leaving.SignOut) ends the session and clears its cookie.

```endpoints
reusable.commons.starting.StartCommons at /auth/commons/start
reusable.commons.finishing.FinishCommons at /auth/commons/finish
reusable.commons.finishing.ResumeCommons at /auth/commons/resume
reusable.commons.finishing.ChooseUsername at /auth/commons/choose
reusable.accounts.identifying.Me at /auth/me
reusable.accounts.leaving.SignOut at /auth/logout
```

## Courses

[ListCourses](reaction:Courses.ListCourses) calls `Sessioning.use` and returns [CourseList](former:Courses.CourseList). The list contains only the session user's courses. [OwnedCourse](view:Courses.OwnedCourse) relates a course to its owner and title. No request field can choose the owner.

[CreateCourse](reaction:Courses.CreateCourse) calls `Sessioning.use` and then `SkillMapping.createCourse`. A learner can have several courses. Each request makes a new course owned by the session user. The host runs this endpoint under a per-user lock, like other course changes.

The course title must contain 1–160 characters after trimming. The Vue page shows the saved course without a page refresh. Reloading or restarting the server reads the same MongoDB records. It displays no invented skills or mastery values.

The [course composition](../compositions/Courses.md) declares the course endpoints and their ownership rules.

## HTTP and UI

The API uses the reference HTTP adapter at `/api`. Cookies own `attempt` and `session`. The continuation wrapper also owns `recoveryKey`; the browser client omits that field from the generated input type. Input and result validation, exact request-origin checks, size limits, no-store responses, and no-referrer pages apply to the flow. Callback parameters are removed from the address before posting them. Session creation has no public endpoint accepting a local user ID.

The interface uses black, white, and gray. Avenir Next or the system sans-serif serves controls and conversations; Georgia serves Home headings. Home centers on a line-art skill tree. Selecting a leaf shows its outcome, estimate, and an Open lesson action. Course materials opens a separate setup view for importing sources and reviewing skills. The study plan is expandable on Home.

Learn opens a dedicated chat. A light sidebar holds conversations for the selected skill. The main area shows learner and tutor messages, source references, and assessments. A rounded composer combines text, photo attachments, voice transcription, and Send. Speech remains editable before sending. Learning and independent practice are visibly distinct; assessment still requires explicit review of the complete attempt. Switching Home and Learn preserves the open conversation and unsent work. On narrow screens, conversation history becomes a compact horizontal list. Keyboard focus remains visible.

Validation covers a new sign-in, returning sign-in, a chosen username, interrupted linking, expiry, two learners' isolation, concurrent course creation, logout, and saved data after a new application instance starts. Local provider fixtures do not prove a live Commons account works.

## Materials and skills

[ReadCourse](reaction:Courses.ReadCourse) requires [OwnedCourse](view:Courses.OwnedCourse) and returns [Materials](former:Courses.Materials), [Units](former:Courses.Units), and [Skills](former:Courses.Skills). Skills include their current outcome, demonstration gate, and status. [OwnedUnit](view:Courses.OwnedUnit) joins a unit to its owned course. [OwnedSkill](view:Courses.OwnedSkill) joins a skill through that unit.

CourseList, Materials, Units, and Skills explicitly order their answers by course, material, unit, and skill identity, respectively. A changed database return order does not rearrange the lists or skill leaves.

[AddUnit](reaction:Courses.AddUnit) calls SkillMapping.addUnit with the session owner. [AddMaterial](reaction:Courses.AddMaterial) checks the session and owned course before saving host-prepared input. The public transport at `/api/courses/materials/add` accepts multipart uploads only, then invokes this private JSON endpoint. Browser calls to `/api/internal/*` are refused. The browser client excludes internal routes. The host retains originals, runs local extraction, saves SOURCES_SAVED and READY checkpoints, then calls the endpoint with its frozen input. The host supplies the import key; the browser cannot supply prepared content. A retried completed operation returns its material ID. [ReadMaterial](reaction:Courses.ReadMaterial) returns readable content and extraction limitations only to the material owner.

The [suggestion flow](reaction:Learning.Suggest) suggests skills from an owned readable material by asking the AI tutor, Google Gemini. Suggestions remain editable in the browser. [ProposeSkill](reaction:Courses.ProposeSkill) saves an accepted suggestion as a draft after joining the unit and material to the same learner and course. [EditDraft](reaction:Courses.EditDraft) applies learner changes after the same source check. [ConfirmSkill](reaction:Courses.ConfirmSkill) makes a draft active; the declared source view rechecks every saved source under the learner lock. [UnavailableSkillMaterial](view:Courses.UnavailableSkillMaterial) rejects a source outside the owner and course. A confirmation assigns no mastery score. [singleMaterial](computation:singleMaterial) builds the selected source set.

```computations
singleMaterial(material: GroundedTutoring.Material) : SkillMapping.MaterialSet
  Produces the one-element source set for the learner's selected import. One imported material can contain several files.

evidenceAttribution(origin: AssessmentReviewing.Origin, rationale: String) : String
  Identifies an AI assessment or learner correction alongside its saved explanation.
```

The [course composition](../compositions/Courses.md) declares these endpoints and the saved request keys used to recover draft saves.

## Provider and file transport

The host calls Google's Gemini API with one server-side key, which never reaches the browser. Every learner uses the same server key, so there is no per-learner account to connect. Each learner chooses the tutor model and thinking level in the Tutor panel; the [tutor settings](../compositions/Settings.md) describe the catalog, the saved choice, and how every tutor request uses it. Gemini returns JSON that matches a schema, and the host still checks each answer and its citations. When a call fails, the learner sees a plain reason, such as a busy service or a missing key, and the server log keeps Google's own message for the app owner. [Runtime responsibilities](../runtime.md) describe the details.

/api/ai/status reports whether the AI tutor is available and, if not, why. /api/courses/skills/suggest asks the tutor for skills without changing any. /api/courses/materials/file checks the owner and the material's exact file references before returning saved bytes. /api/learning/transcribe sends a microphone recording to Gemini and returns the transcript; the recording is never stored. These host services do not replace the declared concept mutations or perform file and provider work inside where conditions.

Uploads accept up to 12 files and 25 MB in total. PDF pages are read as text, and the original PDF is retained. Word, PowerPoint, and Excel text is read without images or charts, and that gap is reported. Text, notebooks, and PNG, JPEG, or WebP images have separate reading paths. ZIP archives, audio, and other unsupported types are refused. Large or unsupported inputs produce a clear refusal; upload acceptance alone does not establish extraction quality. File parsing limits are explicit in the importer. The browser displays original filenames and reported limitations.

## Learning application

[Learning flows](../compositions/Learning.md), [shared reads](../compositions/LearningReads.md), [progress reactions](../compositions/Progress.md), [planning endpoints](../compositions/Planning.md), and [tutor settings](../compositions/Settings.md) define the rest of this stage. The host forwards JSON requests to these declared endpoints. It does not sequence tutoring, assessment, mastery, or planning actions.
