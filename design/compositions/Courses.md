# Courses, materials, and skill drafts

These flows describe the current P2 application. The [P2 stage](../stages/materials.md) binds the concept instances. Each endpoint calls `Sessioning.use` and uses the returned user for ownership checks. Application callers use HTTP or the exported runtime gateway, as described in the [runtime contract](../runtime.md).

## Reading course data

[ListCourses](reaction:Courses.ListCourses) returns [CourseList](former:Courses.CourseList) for the signed-in learner. [OwnedCourse](view:Courses.OwnedCourse) relates a course to its owner. [OwnedUnit](view:Courses.OwnedUnit) and [OwnedSkill](view:Courses.OwnedSkill) check ownership through the course.

[ReadCourse](reaction:Courses.ReadCourse) requires an owned course. It returns [Materials](former:Courses.Materials), [Units](former:Courses.Units), and [Skills](former:Courses.Skills). Skills include their status and current requirements. These three lists and CourseList sort by each record's unique identity. [ReadMaterial](reaction:Courses.ReadMaterial) returns source content, original-file references, and extraction limits after checking material and course ownership.

## Saving courses and materials

[CreateCourse](reaction:Courses.CreateCourse) calls `SkillMapping.createCourse` for the signed-in learner. A learner can have several courses, so a new course never replaces or blocks another. Like other course changes, it runs under the learner's lock. [AddUnit](reaction:Courses.AddUnit) calls `SkillMapping.addUnit`, which checks course ownership.

The public upload route at `/api/courses/materials/add` accepts multipart files. The host checks ownership, retains the files, and saves one import key and frozen prepared input. It then calls the private [AddMaterial](reaction:Courses.AddMaterial) endpoint. This endpoint rechecks session and course ownership before calling `GroundedTutoring.addMaterial`. A completed retry returns the saved material identity. Browser calls to `/api/internal/*` are refused. File processing and recovery-store writes run outside read-only `where` conditions. See the [import store](../material-import-store.md).

## Reviewing skills

[Suggest](reaction:Learning.Suggest) requests editable suggestions from one owned course material. It does not save skills. [ProposeSkill](reaction:Courses.ProposeSkill) saves one accepted suggestion through `SkillMapping.propose`. Its unit and material must belong to the same owned course. [singleMaterial](computation:singleMaterial) creates the source set; one material may contain several files.

Each draft save carries a `proposalKey`. SkillMapping writes one record at a time, in a fixed order. It first saves a receipt with the original input and the identities of the new skill and its first requirements version. It then saves that version, then the skill, and finally marks the receipt saved. A skill therefore never appears without its version. If a save stops partway, repeating the same key and input finishes it. Repeating the same key and input returns the same skill. Different content with that key is refused. Keys are scoped to the learner and grant no access. A retry preserves later edits or confirmation. If the draft was discarded, the saved receipt prevents its recreation and the retry is refused.

After choosing an existing unit or receiving a new unit's identity, the browser saves a frozen queue in session storage before sending any draft. Each queue entry has its own key and source. An acknowledged save removes that entry. A failed or lost reply leaves it available to retry, including after a page reload or server restart. A retry sends the original input.

[EditDraft](reaction:Courses.EditDraft) checks the chosen unit and material, then calls `SkillMapping.reviseDraft`. The action checks that the skill is an owned draft and stays within its course. [ConfirmSkill](reaction:Courses.ConfirmSkill) requires an owned skill with no [UnavailableSkillMaterial](view:Courses.UnavailableSkillMaterial), then calls `SkillMapping.confirm`. The action requires draft status and at least one source. Confirmation assigns no mastery score; confidence is recorded through the [learning flow](Learning.md).

Editing confirmed requirements is implemented in the concept but has no P2 endpoint or screen.

## Endpoints

The HTTP adapter adds `/api` to these paths. Skill suggestions belong to the [learning composition](Learning.md).

```endpoints
Courses.ListCourses at /courses
Courses.CreateCourse at /courses/create
Courses.ReadCourse at /courses/read
Courses.ReadMaterial at /courses/materials/read
Courses.AddUnit at /courses/units/add
Courses.AddMaterial at /internal/materials/add
Courses.ProposeSkill at /courses/skills/propose
Courses.EditDraft at /courses/skills/edit
Courses.ConfirmSkill at /courses/skills/confirm
```
