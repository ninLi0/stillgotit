# Application identities

All six learning concepts use `Registering.User` as their learner identity; for the Library, the MaterialKeeping instance, that identity is the owner of each material. The server gets that identity from `Sessioning.use`. A browser request cannot choose its acting learner. A course, material, skill, requirements version, practice task, or assessment case keeps its owning concept's identity when another concept refers to it. Titles, email addresses, and tree positions are not identity keys.

```instances
instantiate Registering

instantiate Federating as CommonsFederating with
  User is Registering.User

instantiate Sessioning with
  Subject is Registering.User

instantiate SkillMapping with
  User is Registering.User
  Material is Library.Material

instantiate MaterialKeeping as Library with
  Owner is Registering.User
  Scope is SkillMapping.Course

instantiate GroundedTutoring with
  Learner is Registering.User
  Material is Library.Material
  Topic is SkillMapping.Skill
  Definition is SkillMapping.Version

instantiate AssessmentReviewing with
  Author is Registering.User
  Subject is SkillMapping.Skill
  Definition is SkillMapping.Version
  Task is GroundedTutoring.PracticeSessions

instantiate MasteryEstimating with
  Learner is Registering.User
  Subject is SkillMapping.Skill
  Definition is SkillMapping.Version
  Evidence is AssessmentReviewing.Case

instantiate Budgeting as StudyPlanning with
  Owner is Registering.User
  Scope is SkillMapping.Course
  Subject is SkillMapping.Skill
  Definition is SkillMapping.Version
```

This domain inventory has nine application instances: six learning concepts and three account concepts. Learners and courses are records in their state; creating a course does not create another engine instance. The current inventory is in stages/materials.md. It binds thirteen instances: these nine, the stateless TutorGenerating provider adapter, TutorPreferring, which keeps each learner's tutor choice, ViewPreferring, which keeps each learner's home view, and TreeStyling, which keeps the kind of tree each learner chose for each topic.

The practice-task binding requires membership in `GroundedTutoring.PracticeSessions`. Its actions take the parent `Session` type, so the application must check task membership before submitting an assessment. A lesson cannot serve as an assessed task.

An assessment case identifies one attempt against one skill version. All its judgment revisions use that same case as mastery evidence. A changed skill version gets a new mastery track and does not inherit the previous version's evidence.

`AssessmentReviewing.Result` and `MasteryEstimating.Signal` have the same five labels. The application maps each label explicitly and rejects an unknown label. It does not convert a model-provided percentage into mastery directly.

The course composition and request admission use three application-owned values. [prerequisiteSet](compositions/Courses.md) reads a SkillList, [carriedEstimate](compositions/Courses.md) returns a CarriedEstimate, and [prerequisiteToPractice](compositions/LearningAccess.md) returns a PrerequisiteChoice.

```types
concrete SkillList
  The skill identities one request lists, in the order sent. An identity may repeat, and the list may be empty.
concrete CarriedEstimate
  Two fields. found is a Flag that says whether the skill has a track for an earlier version. When found is true, confidence is that track's current estimate, a Number from 0 through 100; otherwise confidence is absent.
concrete PrerequisiteChoice
  Two fields. found is a Flag that says whether a prerequisite that is not ready blocks practice. When found is true, title is the String title of the prerequisite to work on first; otherwise title is absent.
```
