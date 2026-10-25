# Signed-in access and course display

The Bun host reads the local session from an HttpOnly cookie. Each protected endpoint calls `Sessioning.use` and uses the returned user as its actor. Never read the actor from an editable request field. A Commons sign-in starts a local StillGotIt session; normal requests do not contact Commons again. See [accounts](reusable/accounts.md), [Commons sign-in](reusable/commons.md), and [runtime responsibilities](../runtime.md).

The ownership views join existing concept queries:

| View | Required relationship |
| --- | --- |
| [OwnedCourse](view:Access.OwnedCourse) | `SkillMapping._course` names the actor as owner. |
| [OwnedSkill](view:Access.OwnedSkill) | `_skill`, `_unit`, and `_course` lead to the actor's course. |
| [OwnedSession](view:Access.OwnedSession) | `GroundedTutoring._session` names the actor as owner, and its topic and version belong together. |
| [OwnedCase](view:Access.OwnedCase) | `AssessmentReviewing._case` names the actor as author, and its skill and version belong together. |
| [OwnedPlan](view:Access.OwnedPlan) | `StudyPlanning._plan` names the actor as owner and an owned course as scope. |

Ownership must hold before reading work, material, transcripts, or judgments into a response. A valid identifier alone does not grant access. Inaccessible records return the same unavailable result as missing records.

The accounts composition provides `/auth/me` for the current identity. [Course](reaction:Access.Course) returns [CoursePage](former:Access.CoursePage), which combines the owned course, units, skill versions, mastery estimates, and current study plan.

[CourseState](view:Access.CourseState) reads SkillMapping's course and skill queries, `MasteryEstimating._estimate`, and StudyPlanning's plan and budget queries. It uses one server time for a response. A skill without a mastery track displays **Not assessed**. Previous requirement versions remain available separately. Each skill has one leaf; layout positions are not stored as skill identities.

The course response shows whether evidence is still waiting for assessment or mastery synchronization. It does not present an old estimate as current while a known newer judgment remains unapplied. Reading the course does not create assessments or mutate scores.

```endpoints
Access.Course at /course
```

All endpoint inputs and outputs require runtime validation. Domain refusals use [RequestFailure](former:Access.RequestFailure) to return a stable code and a short explanation. Unexpected faults retain saved work and give a retry path.
