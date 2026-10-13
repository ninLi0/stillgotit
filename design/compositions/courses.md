# Course materials and confirmed skills

Every request calls `Sessioning.use` and uses its returned user in the relevant ownership view. P2 allows one course per learner. The [CreateCourse](reaction:Courses.CreateCourse) boundary checks `SkillMapping._courses` and calls `createCourse` only when none exists. The host holds the learner's mutation lock across that check and action; two concurrent requests cannot both create a course.

[AddUnit](reaction:Courses.AddUnit) checks [OwnedCourse](view:Access.OwnedCourse) and calls `SkillMapping.addUnit`.

The [AddMaterial](reaction:Courses.AddMaterial) boundary accepts an upload or source reference. File processing finishes before `GroundedTutoring.addMaterial` runs. [ReadableMaterial](view:Courses.ReadableMaterial) supplies the owned course, retained originals, readable content, locations, and extraction limits. A stored file that has not been read is not ready for teaching. Keep uploaded source audio; temporary microphone audio follows the separate transcription rule.

[ProposeSkills](reaction:Courses.ProposeSkills) requests skill suggestions from the selected course materials. A suggestion supplies a title, outcome, full demonstration requirements, and source references. [SkillSources](view:Courses.SkillSources) checks every reference against `GroundedTutoring._material`: it must belong to the learner and the same course. Each accepted suggestion calls `SkillMapping.propose` and remains a draft.

[EditDraft](reaction:Courses.EditDraft) rechecks ownership and every selected source through SkillSources, then applies the learner's changes through `SkillMapping.reviseDraft`. [ConfirmSkill](reaction:Courses.ConfirmSkill) rechecks sources and calls `SkillMapping.confirm`. Neither operation assigns a mastery percentage. The learner reports confidence through the [progress flow](progress.md).

[ReviseRequirements](reaction:Courses.ReviseRequirements) calls `SkillMapping.reviseDefinition` for an owned confirmed skill. Existing lessons and attempts keep their saved requirements. The new version triggers the mastery and planning reactions; it is not a failed attempt.

[CourseChange](former:Courses.CourseChange) returns saved identities and state after these operations. [SkillDrafts](former:Courses.SkillDrafts) returns the proposed skills for learner review. Delayed AI suggestions must still match the source selection and request that produced them. Save valid drafts incrementally; retries reuse the request's saved draft identities instead of proposing them again.

```endpoints
Courses.CreateCourse at /courses/create
Courses.AddUnit at /courses/units/add
Courses.AddMaterial at /courses/materials/add
Courses.ProposeSkills at /courses/skills/propose
Courses.EditDraft at /courses/skills/edit
Courses.ConfirmSkill at /courses/skills/confirm
Courses.ReviseRequirements at /courses/skills/requirements
```
