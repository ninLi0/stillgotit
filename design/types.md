# Application identities

All five learning concepts use `Registering.User` as their learner identity. The server gets that identity from `Sessioning.use`. A browser request cannot choose its acting learner. A course, skill, requirements version, practice task, or assessment case keeps its owning concept's identity when another concept refers to it. Titles, email addresses, and tree positions are not identity keys.

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
  Task is GroundedTutoring.PracticeSessions

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
```

These are eight planned application instances: five learning concepts and three account concepts. Learners and courses are records in their state; creating a course does not create another engine instance. The current implementation stage selects only the instances whose code is ready.

The practice-task binding requires membership in `GroundedTutoring.PracticeSessions`. Its actions take the parent `Session` type, so the application must check task membership before submitting an assessment. A lesson cannot serve as an assessed task.

An assessment case identifies one attempt against one skill version. All its judgment revisions use that same case as mastery evidence. A changed skill version gets a new mastery track and does not inherit the previous version's evidence.

`AssessmentReviewing.Result` and `MasteryEstimating.Signal` have the same five labels. The application maps each label explicitly and rejects an unknown label. It does not convert a model-provided percentage into mastery directly.
