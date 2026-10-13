# Sign-in and course creation

This stage connects the four implemented concepts to a Vue page. Materials and the four remaining learning concepts are not part of this stage.

```types
concrete MaterialReference
  An external source identity. No material upload endpoint exists in this stage.
```

```instances
instantiate Registering

instantiate Federating as CommonsFederating with
  User is Registering.User

instantiate Sessioning with
  Subject is Registering.User

instantiate SkillMapping with
  User is Registering.User
  Material is MaterialReference
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

```endpoints
Courses.ListCourses at /courses
Courses.CreateCourse at /courses/create
```

## HTTP and UI

The API uses the reference HTTP adapter at `/api`. Cookies own `attempt` and `session`. The continuation wrapper also owns `recoveryKey`; the browser client omits that field from the generated input type. Input and result validation, exact request-origin checks, size limits, no-store responses, and no-referrer pages apply to the flow. Callback parameters are removed from the address before posting them. Session creation has no public endpoint accepting a local user ID.

The page uses black, white, and gray: ink `#181818`, secondary text `#676767`, white `#ffffff`, paper `#f6f6f6`, and rules `#d8d8d8`. A small line-art tree carries the visual identity. Avenir Next or the system sans-serif serves controls; Georgia serves the main title. The layout has a quiet header, a left-aligned task column, and an empty tree area. On narrow screens, the task comes first. Labels remain separate from the drawing. Keyboard focus is visible and motion is optional.

Validation covers a new sign-in, returning sign-in, a chosen username, interrupted linking, expiry, two learners' isolation, concurrent course creation, logout, and saved data after a new application instance starts. Local provider fixtures do not prove a live Commons account works.
