<!-- Generated from the StillGotIt assembly. Do not edit. -->
<!-- Manifest producer: @mit-sdg/sync-engine@1.1.0; concept specification: sync-engine.concept-specification@1; renderer: @mit-sdg/sync-engine@1.1.0. -->

# StillGotIt — assembled read-back

_Assembled by sync-engine from registered concepts and composition. Edit the concept_
_specifications and composition source, then regenerate this file._

## Concepts

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

- `CommonsFederating` — instance of `Federating` — [Sign-in and course creation](../design/stages/onboarding.md), line 13.
  - `User` is `Registering.User` — [Sign-in and course creation](../design/stages/onboarding.md), line 14.

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

- `Registering` — instance of `Registering` — [Sign-in and course creation](../design/stages/onboarding.md), line 11.

### Sessioning

Defined in [Sessioning](../design/concepts/Sessioning.md), line 1.

#### Actions

- `start(subject: Subject) : returns (session: Session, expiresAt: DateTime)`
- `use(session: Session) : returns (subject: Subject)`
  - Refuses `NOT_SIGNED_IN`: Your session has ended. Sign in again.
- `end(session: Session) : returns (session: Session)`
  - Refuses `NOT_SIGNED_IN`: Your session has ended. Sign in again.

#### Instances

- `Sessioning` — instance of `Sessioning` — [Sign-in and course creation](../design/stages/onboarding.md), line 16.
  - `Subject` is `Registering.User` — [Sign-in and course creation](../design/stages/onboarding.md), line 17.

### SkillMapping

Defined in [SkillMapping](../design/concepts/SkillMapping.md), line 1.

#### Actions

- `createCourse(owner: User, title: String) : returns (course: Course)`
  - Refuses `INVALID_COURSE_TITLE`: Enter a course title.
- `addUnit(owner: User, course: Course, title: String) : returns (unit: Unit)`
  - Refuses `UNIT_COURSE_UNAVAILABLE`: Choose one of your courses.
  - Refuses `INVALID_UNIT_TITLE`: Enter a unit title.
- `propose(owner: User, unit: Unit, title: String, outcome: String, gate: String, materials: MaterialSet) : returns (skill: Skill)`
  - Refuses `PROPOSAL_UNIT_UNAVAILABLE`: Choose a unit in one of your courses.
  - Refuses `INVALID_SKILL_PROPOSAL`: Enter a skill title, outcome, and demonstration requirements.
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

#### Instances

- `SkillMapping` — instance of `SkillMapping` — [Sign-in and course creation](../design/stages/onboarding.md), line 19.
  - `Material` is `MaterialReference` — [Sign-in and course creation](../design/stages/onboarding.md), line 21.
  - `User` is `Registering.User` — [Sign-in and course creation](../design/stages/onboarding.md), line 20.

## Application types

Concrete types:

- `MaterialReference` — [Sign-in and course creation](../design/stages/onboarding.md), line 6.

## Views

_Views name reusable conditions. Multiple `where` blocks are alternatives._

### (owner) owns (course) with (title)

Authored path: `Courses.OwnedCourse`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 49.

```view
(owner) owns (course) with (title) — inputs (owner, course); outputs (title); bindings () — answers at most one (title)
  where SkillMapping._course (course) has (owner, title)
```

## Formers

_Formers name result shapes evaluated when asked. The source former owns_
_the authored explanation; this section records the generated shape._

### the courses belonging to (owner)

Authored path: `Courses.CourseList`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 49.

```former
Former "the courses belonging to (owner)" — inputs (owner); bindings (course, title); promises exactly one record — forms:
  each SkillMapping._courses (owner) has (course)
    where view "(owner) owns (course) with (title)" with (course, owner) has (title)
    form a record of
      course
      title
```

## Reactions

### Courses.CreateCourse

Authored path: `Courses.CreateCourse`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 51.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 57.

```reaction
when RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  Sessioning.use (session)
```

### Courses.CreateCourse:existing#2

Authored path: `Courses.CreateCourse`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 51.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 57.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 51.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 57.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 51.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 57.

```reaction
when SkillMapping.createCourse (owner, title, course), asked by Courses.CreateCourse:first#2
where
  earlier, RequestBoundary.request (path: "/courses/create", requestId, session, title)
then
  RequestBoundary.respond (course, requestId)
```

### Courses.ListCourses

Authored path: `Courses.ListCourses`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 49.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 56.

```reaction
when RequestBoundary.request (path: "/courses", requestId, session)
then
  Sessioning.use (session)
```

### Courses.ListCourses#2

Authored path: `Courses.ListCourses`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 49.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 56.

```reaction
when Sessioning.use (session, subject: owner), asked by Courses.ListCourses
where
  earlier, RequestBoundary.request (path: "/courses", requestId, session)
then
  RequestBoundary.respond (courses: former "the courses belonging to (owner)" with (owner), requestId)
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

### reusable.accounts.identifying.Me

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 36.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 43.

```reaction
when RequestBoundary.request (path: "/auth/me", requestId, session)
then
  Sessioning.use (session)
```

### reusable.accounts.identifying.Me:known#2

Authored path: `reusable.accounts.identifying.Me`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 36.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 43.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 36.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 43.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 36.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 44.

```reaction
when RequestBoundary.request (path: "/auth/logout", requestId, session)
then
  Sessioning.end (session)
```

### reusable.accounts.leaving.SignOut#2

Authored path: `reusable.accounts.leaving.SignOut`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 36.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 44.

```reaction
when Sessioning.end (session), asked by reusable.accounts.leaving.SignOut
where
  earlier, RequestBoundary.request (path: "/auth/logout", requestId, session)
then
  RequestBoundary.respond (requestId)
```

### reusable.commons.finishing.ChooseUsername:expired

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
where
  no CommonsFederating._identity (attempt)
then
  RequestBoundary.respond (error: "SIGN_IN_EXPIRED", requestId)
```

### reusable.commons.finishing.ChooseUsername:new

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when Registering.register (recoveryKey, username, user), asked by reusable.commons.finishing.ChooseUsername:new
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ChooseUsername:new#3

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ChooseUsername:new#2
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:new#4

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:new#3
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ChooseUsername:recovered

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ChooseUsername:recovered
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ChooseUsername:recovered#3

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:recovered#2
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ChooseUsername:returning

Authored path: `reusable.commons.finishing.ChooseUsername`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 32.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 42.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ChooseUsername:returning
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/choose", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.FinishCommons

Authored path: `reusable.commons.finishing.FinishCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 26.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 40.

```reaction
when RequestBoundary.request (attempt, code, path: "/auth/commons/finish", requestId, state)
then
  CommonsFederating.finish (attempt, code, nonce: state)
```

### reusable.commons.finishing.FinishCommons#2

Authored path: `reusable.commons.finishing.FinishCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 26.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 40.

```reaction
when CommonsFederating.finish (attempt, code, nonce: state, username), asked by reusable.commons.finishing.FinishCommons
where
  earlier, RequestBoundary.request (attempt, code, path: "/auth/commons/finish", requestId, state)
then
  RequestBoundary.respond (requestId, username)
```

### reusable.commons.finishing.ResumeCommons:expired

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
where
  no CommonsFederating._identity (attempt)
then
  RequestBoundary.respond (error: "SIGN_IN_EXPIRED", requestId)
```

### reusable.commons.finishing.ResumeCommons:new

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when Registering.register (recoveryKey, username, user), asked by reusable.commons.finishing.ResumeCommons:new
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  CommonsFederating.link (attempt, user)
```

### reusable.commons.finishing.ResumeCommons:new#3

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ResumeCommons:new#2
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:new#4

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:new#3
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ResumeCommons:recovered

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when CommonsFederating.link (attempt, user), asked by reusable.commons.finishing.ResumeCommons:recovered
then
  Sessioning.start (subject: user)
```

### reusable.commons.finishing.ResumeCommons:recovered#3

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:recovered#2
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.finishing.ResumeCommons:returning

Authored path: `reusable.commons.finishing.ResumeCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

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
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 28.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 41.

```reaction
when Sessioning.start (subject: user, expiresAt, session), asked by reusable.commons.finishing.ResumeCommons:returning
where
  earlier, RequestBoundary.request (attempt, path: "/auth/commons/resume", recoveryKey, requestId, username)
then
  RequestBoundary.respond (expiresAt, requestId, session, user)
```

### reusable.commons.starting.StartCommons

Authored path: `reusable.commons.starting.StartCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 26.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 39.

```reaction
when RequestBoundary.request (path: "/auth/commons/start", requestId)
then
  CommonsFederating.start ()
```

### reusable.commons.starting.StartCommons#2

Authored path: `reusable.commons.starting.StartCommons`.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 26.
- Covered by [Sign-in and course creation](../design/stages/onboarding.md), line 39.

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
