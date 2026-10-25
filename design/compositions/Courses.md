# Courses, materials, and skills

These flows describe the current application. The [application stage](../stages/materials.md) binds the concept instances. Each endpoint calls `Sessioning.use` and uses the returned user for ownership checks. Application callers use HTTP or the exported runtime gateway, as described in the [runtime contract](../runtime.md).

## Reading course data

[ListCourses](reaction:Courses.ListCourses) returns [CourseList](former:Courses.CourseList) for the signed-in learner. [OwnedCourse](view:Courses.OwnedCourse) relates a course to its owner. [OwnedUnit](view:Courses.OwnedUnit) and [OwnedSkill](view:Courses.OwnedSkill) check ownership through the course.

[ReadCourse](reaction:Courses.ReadCourse) requires an owned course. It returns [Materials](former:Courses.Materials), [Units](former:Courses.Units), [Skills](former:Courses.Skills), [Prerequisites](former:Courses.Prerequisites), [SkillSources](former:Courses.SkillSources), and [Versions](former:Courses.Versions). Units include whether the learner marked each one as emphasized by the professor. Skills include every status with their current requirements, so the page can list archived skills apart from active ones. Prerequisites has one row for each skill and direct prerequisite. SkillSources has one row for each skill and attached material. Versions has one row for each skill and requirements version, with its outcome and gate, from `SkillMapping._versions`. A skill's rows run newest first: the first is its current version, and the page labels the others “Previous definition”. A list is empty when the course has no such records. CourseList, Materials, Units, and Skills sort by each record's unique identity. The two link lists sort by skill identity, then by the linked identity. Versions sorts by skill identity and, within each skill, keeps the newest-first order that `SkillMapping._versions` returns. The read answers only after [RepairRevisedTrack](reaction:Courses.RepairRevisedTrack), described below, has finished. [ReadMaterial](reaction:Courses.ReadMaterial) returns source content, original-file references, and extraction limits after checking material and course ownership.

## Saving courses and materials

[CreateCourse](reaction:Courses.CreateCourse) calls `SkillMapping.createCourse` for the signed-in learner. A learner can have several courses, so a new course never replaces or blocks another. Like other course changes, it runs under the learner's lock. [AddUnit](reaction:Courses.AddUnit) calls `SkillMapping.addUnit`, which checks course ownership.

The public upload route at `/api/courses/materials/add` accepts multipart files. The host checks ownership, retains the files, and saves one import key and frozen prepared input. It then calls the private [AddMaterial](reaction:Courses.AddMaterial) endpoint. An import with a recording or video reaches this endpoint only after transcription, as the [materials composition](Materials.md) describes. This endpoint rechecks session and course ownership before calling `Library.add`. Library is the application's instance of [MaterialKeeping](../concepts/MaterialKeeping.md), the concept that keeps each learner's materials. A completed retry returns the saved material identity. Browser calls to `/api/internal/*` are refused. File processing and recovery-store writes run outside read-only `where` conditions. See the [import store](../material-import-store.md).

## Reviewing skills

[Suggest](reaction:Learning.Suggest) requests editable suggestions from one owned course material with the learner's [tutor choice](Settings.md), and returns the model and thinking level that produced them. It does not save skills. [ProposeSkill](reaction:Courses.ProposeSkill) saves one accepted suggestion through `SkillMapping.propose`. Its unit and material must belong to the same owned course. A unit outside the learner's courses answers `COURSE_UNAVAILABLE`, and any other material answers `MATERIAL_UNAVAILABLE`, whatever its title. Only after both checks pass does ProposeSkill answer `GRADED_MATERIAL_NOT_SOURCE` for the learner's own material with a [graded title](computation:gradedTitle), because graded work cannot be a source. [singleMaterial](computation:singleMaterial) creates the source set; one material may contain several files.

Each draft save carries a `proposalKey`, which the browser generates and SkillMapping stores on the skill that the save creates. Each course and key pair identifies at most one skill. Repeating a save with the same key therefore returns the skill that the first save created and creates nothing, whatever that skill's content has become, so a retry preserves later edits or confirmation. The skill keeps its key when the learner moves it to another unit of the course, so a draft moved between a lost reply and the retry is still found and returned, and no second draft appears. SkillMapping saves the requirements version before the skill, so a skill never appears without its version, and if a save stops between the two writes, its retry creates the skill once. A key grants no access, because the unit must still belong to the learner. A key is remembered only while its skill exists, so replaying the save of a discarded draft would create the draft again. No endpoint discards a draft, so the app cannot reach this case. A used key sent with different content returns the existing skill instead of being refused. The browser generates a new key for every draft and never changes the content saved with it, so this case does not arise in practice.

After choosing an existing unit or receiving a new unit's identity, the browser saves a frozen queue in session storage before sending any draft. Each queue entry has its own key and source. An acknowledged save removes that entry. A failed or lost reply leaves it available to retry, including after a page reload or server restart. A retry sends the original input.

[EditDraft](reaction:Courses.EditDraft) checks the chosen unit and material with the same refusals as ProposeSkill. Only for the learner's own material in that course does it then answer `GRADED_MATERIAL_NOT_SOURCE` for graded work. When the material is not graded work, it calls `SkillMapping.reviseDraft`. The action checks that the skill is an owned draft and stays within its course. [ConfirmSkill](reaction:Courses.ConfirmSkill) requires an owned skill with no [UnavailableSkillMaterial](view:Courses.UnavailableSkillMaterial), then calls `SkillMapping.confirm`. The action requires draft status and at least one source. Confirmation assigns no mastery score; confidence is recorded through the [learning flow](Learning.md).

## Managing confirmed skills and units

After confirming a skill, the learner keeps it accurate with the endpoints below. Each takes the session and names the one skill or unit it changes; no request field names an owner. Each skill endpoint first requires [OwnedSkill](view:Courses.OwnedSkill), and the unit endpoint requires [OwnedUnit](view:Courses.OwnedUnit). An unknown record and another learner's record both get `COURSE_UNAVAILABLE` and change nothing, so a caller cannot tell them apart. An owned request calls one SkillMapping action. That action checks ownership again and enforces the status and prerequisite rules. Its refusal reaches the learner with the action's own code and message, and changes nothing. Like other course changes, these endpoints run under the learner's lock.

Each endpoint answers after its action's write, so a success means the change is saved. If a reply is lost, the change stays saved, and the page's next course read shows it. Repeating a request either succeeds again without a further change or is refused because the change already holds, as each paragraph states.

[EditSkillDetails](reaction:Courses.EditSkillDetails) takes `skill`, `unit`, and `title` and calls `SkillMapping.editDetails`. The action renames the skill or moves it to another unit of the same course. It refuses a skill that is not confirmed, a unit outside the skill's course, and a blank title. Sending the saved unit and title again succeeds and changes nothing. The skill keeps its requirements version, sources, prerequisites, and history. The answer has no fields.

[ReviseSkill](reaction:Courses.ReviseSkill) takes `skill`, `outcome`, and `gate` and calls `SkillMapping.reviseDefinition`. The action refuses a skill that is not confirmed, a blank outcome or gate, and requirements equal to the current version. On success, a new version becomes current. The skill keeps its identity, title, unit, sources, prerequisites, and status. The new version records the earlier one as its previous version. The earlier version stays readable and appears in the course read's version history. Practice sessions and assessment cases keep the version they used. A practice session that is open on the earlier version stays open and keeps that version. The answer contains `previous` and `version`, and it is sent only after [RevisedTrack](reaction:Courses.RevisedTrack) has finished. Repeating a saved revision is refused as unchanged; the next course read shows the saved version.

[RevisedTrack](reaction:Courses.RevisedTrack): when `SkillMapping.reviseDefinition` returns `previous` and `version` for an owner and skill, where `MasteryEstimating._track` finds the owner's track for that skill and `previous` and finds none yet for `version`, and `MasteryEstimating._estimate` gives the `previous` track's value at the flow's instant, then `MasteryEstimating.initialize` starts a track for the owner, the skill, and `version`, with that value as confidence and basis `PREVIOUS_DEFINITION`. The new track has no evidence, so its explanation says that a new check is needed. Evidence is not copied. The earlier track and its evidence stay unchanged, and regrading old work changes only that track. When the earlier version has no track, nothing happens; the learner sets a starting confidence for the new version as for any confirmed skill. An existing track for `version` counts as already done: if a course read's repair saved it first, RevisedTrack does nothing and ReviseSkill still succeeds. Like any new track, this one also prompts ReplanAfterConfidence in the [progress composition](Progress.md), which watches every `MasteryEstimating.initialize`.

SkillMapping saves the revision before MasteryEstimating saves the track, and the two writes cannot be undone together. If the track write fails, the revision stays saved, and ReviseSkill still answers with the saved versions; the failure is logged, and the next course read repairs the track. [RepairRevisedTrack](reaction:Courses.RepairRevisedTrack) closes that gap on the next course read. When ReadCourse's session check succeeds, it looks at each confirmed skill in every course of the signed-in learner, not only the course being read. If the skill's current version has no track and the learner has a track for an earlier version, [carriedEstimate](computation:carriedEstimate) picks the most recently started earlier track and its current estimate. `MasteryEstimating.initialize` then starts the current version's track from that value with basis `PREVIOUS_DEFINITION`. The read does not take the learner's lock. Like RevisedTrack, the repair treats an existing track for the current version as already done, whether RevisedTrack or a confidence report saved it, so it does nothing then, and repeated reads never add another track.

Both reactions look for that track just before saving one, and MasteryEstimating keeps at most one track per learner, skill, and version. If two requests both look before either saves, which needs a course read from another page in the same moment as a revision or a confidence report, one track is saved. When the request that lost is a revision, it still succeeds: its answer was fixed when the revision was saved, and a later refusal from the track reaction does not change it. When it is a course read or a confidence report, that request is refused with "This skill version already has an estimate." The saved state is still correct, and the next course read shows it.

Between a failed RevisedTrack and the next course read, other pages show the new version without an estimate, and a starting confidence the learner reports in that time is kept; the repair leaves it alone. If the track write fails and the skill is revised again before any course read, the second RevisedTrack finds no track for its previous version and does nothing. The next course read then carries the estimate of the most recently started earlier track, measured at that read.

```computations
carriedEstimate(tracks: MasteryEstimating.ProgressRows, skill: SkillMapping.Skill, current: SkillMapping.Version) : CarriedEstimate
  Finds the learner's most recently started track for the skill whose definition is not current, by initializedAt and then track identity, and gives that track's current estimate as confidence. Answers found false when the skill has no such track.
```

[AddSkillSource](reaction:Courses.AddSkillSource) takes `skill` and `material`. Like ProposeSkill, it reads `Library._material` and requires a material that belongs to the learner and to the skill's course. A material that is unknown, another learner's, or from another course gets `MATERIAL_UNAVAILABLE`, and nothing changes. Otherwise it calls `SkillMapping.attachMaterial`, which refuses a skill that is not confirmed. Attaching a material the skill already has succeeds and changes nothing. The skill keeps its current version. The answer has no fields. No endpoint removes a source.

[SetSkillPrerequisites](reaction:Courses.SetSkillPrerequisites) takes `skill` and `prerequisites`, a list of skill identities. [prerequisiteSet](computation:prerequisiteSet) turns the list into a set: a repeated identity counts once, and an empty list gives the empty set. The endpoint calls `SkillMapping.setPrerequisites` with that set, which replaces the skill's whole prerequisite set, so the empty set clears it. The action refuses a skill that is not confirmed. It also refuses a set that contains the skill itself, a skill that is not a confirmed skill in the same course, or a link that would form a cycle. Another learner's skill is refused the same way. Sending the saved set again succeeds and changes nothing. The answer has no fields. While a prerequisite is not ready, [practice admission](LearningAccess.md) names the prerequisite to work on first.

```computations
prerequisiteSet(prerequisites: SkillList) : SkillMapping.SkillSet
  Produces the set of distinct skill identities in the request's list. A repeated identity counts once, the order is dropped, and an empty list gives the empty set. It checks no ownership or status; setPrerequisites does.
```

[ArchiveSkill](reaction:Courses.ArchiveSkill) takes `skill` and calls `SkillMapping.archive`. The action refuses a skill that is not confirmed, including one already archived. It also refuses a skill that another confirmed skill lists as a prerequisite. An archived skill keeps its versions, sources, prerequisites, sessions, assessment cases, and mastery tracks. It leaves the active skill lists and the skill tree. Lessons and practice require a confirmed skill, so they are refused while it is archived. Plan proposals consider only confirmed skills, so the next replan leaves it out. Until then the active plan may still list its activity, and starting that activity is refused. The answer has no fields.

[RestoreSkill](reaction:Courses.RestoreSkill) takes `skill` and calls `SkillMapping.restore`. The action refuses a skill that is not archived, including one already restored. It also refuses a restore that would break a prerequisite rule, such as one whose prerequisite is still archived. A restored skill returns with its current version, sources, prerequisites, and mastery tracks, and the next replan considers it again. The answer has no fields.

[SetUnitEmphasis](reaction:Courses.SetUnitEmphasis) takes `unit` and `emphasized`, which is true or false, and calls `SkillMapping.setEmphasis`. Setting the saved value again succeeds and changes nothing. The answer has no fields. Only the course read and the course page use the flag; planning does not use it yet.

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
Courses.EditSkillDetails at /courses/skills/details
Courses.ReviseSkill at /courses/skills/revise
Courses.AddSkillSource at /courses/skills/sources/add
Courses.SetSkillPrerequisites at /courses/skills/prerequisites
Courses.ArchiveSkill at /courses/skills/archive
Courses.RestoreSkill at /courses/skills/restore
Courses.SetUnitEmphasis at /courses/units/emphasis
```
