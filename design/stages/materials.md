# P2 learning journey

This stage connects course materials, skill review, tutoring, assessment, mastery, and a study budget. Concept implementations use the full specifications. The P2 screen focuses on one course and daily review; exam planning is not exposed yet.

```types
concrete TutorRequest
  A server-prepared generation request containing its purpose, owned sources, saved context, and optional learner work.
concrete TutorAnswer
  Validated generated text, citations, material identities, optional judgment values, and skill suggestions.
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

[CreateCourse](reaction:Courses.CreateCourse) calls `Sessioning.use`, requires that the user has no courses, and calls `SkillMapping.createCourse`. A nonempty course list returns `COURSE_EXISTS`. The host holds a per-user lock across this endpoint, including the final query and write. The lock covers the single Bun process used for P2; running multiple servers needs a database-level application constraint.

The course title must contain 1–160 characters after trimming. The Vue page shows the saved course without a page refresh. Reloading or restarting the server reads the same MongoDB records. It displays no invented skills or mastery values.

The [course composition](../compositions/courses.md) declares the course endpoints and their ownership rules.

## HTTP and UI

The API uses the reference HTTP adapter at `/api`. Cookies own `attempt` and `session`. The continuation wrapper also owns `recoveryKey`; the browser client omits that field from the generated input type. Input and result validation, exact request-origin checks, size limits, no-store responses, and no-referrer pages apply to the flow. Callback parameters are removed from the address before posting them. Session creation has no public endpoint accepting a local user ID.

The interface uses black, white, and gray. Avenir Next or the system sans-serif serves controls and conversations; Georgia serves Home headings. Home centers on a line-art skill tree. Selecting a leaf shows its outcome, estimate, and an Open lesson action. Course materials opens a separate setup view for importing sources and reviewing skills. The study plan is expandable on Home.

Learn opens a dedicated chat. A light sidebar holds conversations for the selected skill. The main area shows learner and tutor messages, source references, and assessments. A rounded composer combines text, photo attachments, voice transcription, reasoning effort, and Send. Speech remains editable before sending. Learning and independent practice are visibly distinct; assessment still requires explicit review of the complete attempt. Switching Home and Learn preserves the open conversation and unsent work. On narrow screens, conversation history becomes a compact horizontal list. Keyboard focus remains visible.

Validation covers a new sign-in, returning sign-in, a chosen username, interrupted linking, expiry, two learners' isolation, concurrent course creation, logout, and saved data after a new application instance starts. Local provider fixtures do not prove a live Commons account works.

## Materials and skills

[ReadCourse](reaction:Courses.ReadCourse) requires [OwnedCourse](view:Courses.OwnedCourse) and returns [Materials](former:Courses.Materials), [Units](former:Courses.Units), and [Skills](former:Courses.Skills). Skills include their current outcome, demonstration gate, and status. [OwnedUnit](view:Courses.OwnedUnit) joins a unit to its owned course. [OwnedSkill](view:Courses.OwnedSkill) joins a skill through that unit.

CourseList, Materials, Units, and Skills explicitly order their answers by course, material, unit, and skill identity, respectively. A changed database return order does not rearrange the lists or skill leaves.

[AddUnit](reaction:Courses.AddUnit) calls SkillMapping.addUnit with the session owner. [AddMaterial](reaction:Courses.AddMaterial) checks the session and owned course before saving host-prepared input. The public transport at `/api/courses/materials/add` accepts multipart uploads only, then invokes this private JSON endpoint. Browser calls to `/api/internal/*` are refused. The browser client excludes internal routes. The host retains originals, runs local extraction, saves SOURCES_SAVED and READY checkpoints, then calls the endpoint with its frozen input. The host supplies the import key; the browser cannot supply prepared content. A retried completed operation returns its material ID. [ReadMaterial](reaction:Courses.ReadMaterial) returns readable content and extraction limitations only to the material owner.

The [suggestion flow](reaction:Learning.Suggest) suggests skills from an owned readable material through the learner's connected ChatGPT account. Suggestions remain editable in the browser. [ProposeSkill](reaction:Courses.ProposeSkill) saves an accepted suggestion as a draft after joining the unit and material to the same learner and course. [EditDraft](reaction:Courses.EditDraft) applies learner changes after the same source check. [ConfirmSkill](reaction:Courses.ConfirmSkill) makes a draft active; the declared source view rechecks every saved source under the learner lock. [UnavailableSkillMaterial](view:Courses.UnavailableSkillMaterial) rejects a source outside the owner and course. A confirmation assigns no mastery score. [singleMaterial](computation:singleMaterial) builds the selected source set.

```computations
singleMaterial(material: GroundedTutoring.Material) : SkillMapping.MaterialSet
  Produces the one-element source set for the learner's selected import. One imported material can contain several files.

evidenceAttribution(origin: AssessmentReviewing.Origin, rationale: String) : String
  Identifies an AI assessment or learner correction alongside its saved explanation.
```

The [course composition](../compositions/courses.md) declares these endpoints and the saved request keys used to recover draft saves.

## Provider and file transport

ChatGPT plan access is separate from Commons identity. The host uses OpenAI's documented public-client OAuth flow with state, nonce, PKCE, a stable local host ID, and verified ID tokens. The loopback callback prepares credentials. Finalization also requires the original Commons owner and initiating browser cookie. Credentials are saved in protected local files and never returned to the browser. Account and model selection stay scoped to that owner. The provider follows the public Responses API contract with store false, streaming true, and a completed terminal event. No hosted deployment or ChatGPT conversation access is implied.

Host transport paths under /api/ai manage connection, status, accounts, models, and disconnection. /auth/chatgpt/return is the loopback OAuth callback. /api/courses/skills/suggest performs provider work without changing skills. /api/courses/materials/file checks the owner and material's exact file references before returning retained bytes. /api/learning/transcribe uses local Whisper and deletes temporary microphone audio after processing. These host services do not replace the declared concept mutations or perform file and provider work inside where conditions.

Uploads accept up to 12 files and 25 MB in total. PDF pages are retained as text and page images. Office rendering uses LibreOffice when available; extraction gaps are reported. Sheets, text, notebooks, images, audio, and bounded ZIP contents have separate reading paths. Source audio is retained. Large or unsupported inputs produce a clear refusal; upload acceptance alone does not establish extraction quality. File parsing limits are explicit in the processor. The browser displays original filenames and reported limitations.

## Learning application

[Learning flows](../compositions/learning.md), [shared reads](../compositions/learning-reads.md), [progress reactions](../compositions/progress.md), and [planning endpoints](../compositions/planning.md) define the rest of this stage. The host forwards JSON requests to these declared endpoints. It does not sequence tutoring, assessment, mastery, or planning actions.
