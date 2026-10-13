# SkillMapping

## Purpose

Help learners identify what to learn and what counts as a successful demonstration.

## Principle

A learner creates a course and a unit, edits a proposed skill, and confirms it with a source. Later, the learner changes its demonstration requirements. The skill keeps its identity and receives a new requirements version. The earlier version remains readable. Renaming the skill or adding a source keeps its current version. Another learner cannot change these records.

## Types

```types
external User
  The identity that owns a course.
external Material
  A source reference. Its content and access rules belong outside this concept.
SkillStatus is DRAFT or CONFIRMED or ARCHIVED
  Whether a skill is proposed, active, or inactive.
opaque MaterialSet
  A finite set of Material identities, with no duplicates or ordering.
opaque SkillSet
  A finite set of Skill identities, with no duplicates or ordering.
```

## State

```state
a set of Courses with
  an owner User
  a title String
a set of Units with
  a course Course
  a title String
a set of Skills with
  a unit Unit
  a title String
  a materials set of Materials
  a prerequisites set of Skills
  a current Version
  a status SkillStatus
a set of Versions with
  a skill Skill
  an outcome String
  a gate String
Rule: each unit belongs to an existing course. Each skill belongs to an existing unit.
Rule: a unit or skill belongs to the owner of its course. An unknown record belongs to no owner.
Rule: a skill's current version belongs to that skill. Existing versions never change. Discarding a draft removes its versions; other actions preserve them.
Rule: an outcome describes the ability. A gate describes the complete demonstration required for that ability.
Rule: a confirmed skill's prerequisites are confirmed skills in the same course. A skill cannot require itself, and prerequisite links cannot form a cycle. Archived skills may retain links to archived prerequisites.
Rule: blank text is empty or contains only whitespace. Titles, outcomes, and gates are not blank.
Rule: new identities are unique. A refused action changes no state. Unmentioned state stays unchanged.
```

## Actions

```actions
createCourse(owner: User, title: String) : returns (course: Course)
  where title is blank
  then
    refuses INVALID_COURSE_TITLE "Enter a course title."
  where title is not blank
  then
    create course with owner and title
    returns course

addUnit(owner: User, course: Course, title: String) : returns (unit: Unit)
  where course does not belong to owner
  then
    refuses UNIT_COURSE_UNAVAILABLE "Choose one of your courses."
  where course belongs to owner and title is blank
  then
    refuses INVALID_UNIT_TITLE "Enter a unit title."
  where course belongs to owner and title is not blank
  then
    create unit with course and title
    returns unit

propose(owner: User, unit: Unit, title: String, outcome: String, gate: String, materials: MaterialSet) : returns (skill: Skill)
  where unit does not belong to owner
  then
    refuses PROPOSAL_UNIT_UNAVAILABLE "Choose a unit in one of your courses."
  where unit belongs to owner and at least one of title, outcome, and gate is blank
  then
    refuses INVALID_SKILL_PROPOSAL "Enter a skill title, outcome, and demonstration requirements."
  where unit belongs to owner and title, outcome, and gate are not blank
  then
    create skill with unit, title, materials, an empty prerequisites set, and status DRAFT
    create a version with skill, outcome, and gate, and make it the skill's current version
    returns skill

reviseDraft(owner: User, skill: Skill, unit: Unit, title: String, outcome: String, gate: String, materials: MaterialSet) : returns ()
  where skill does not belong to owner or is not DRAFT
  then
    refuses DRAFT_REVISION_UNAVAILABLE "Choose one of your draft skills."
  where skill is owner's draft and unit does not belong to that skill's course
  then
    refuses DRAFT_UNIT_MISMATCH "Choose a unit in the skill's course."
  where skill is owner's draft, unit belongs to its course, and at least one of title, outcome, and gate is blank
  then
    refuses INVALID_DRAFT_CONTENT "Enter a skill title, outcome, and demonstration requirements."
  where skill is owner's draft, unit belongs to its course, and title, outcome, and gate are not blank
  then
    replace the skill's unit, title, and materials
    if outcome or gate differs from its current version, create a version with skill, outcome, and gate, and make it current
    returns

discardDraft(owner: User, skill: Skill) : returns ()
  where skill does not belong to owner or is not DRAFT
  then
    refuses DRAFT_DISCARD_UNAVAILABLE "Only your draft skills can be discarded."
  where skill is owner's draft
  then
    remove skill and all its versions
    returns

confirm(owner: User, skill: Skill) : returns ()
  where skill does not belong to owner or is not DRAFT
  then
    refuses SKILL_CONFIRM_UNAVAILABLE "Choose one of your draft skills."
  where skill is owner's draft and its materials set is empty
  then
    refuses SKILL_SOURCE_REQUIRED "Add a source before confirming this skill."
  where skill is owner's draft and its materials set is not empty
  then
    set the skill's status to CONFIRMED
    returns

editDetails(owner: User, skill: Skill, unit: Unit, title: String) : returns ()
  where skill does not belong to owner or is not CONFIRMED
  then
    refuses SKILL_DETAILS_UNAVAILABLE "Choose one of your confirmed skills."
  where skill is owner's confirmed skill and unit does not belong to that skill's course
  then
    refuses SKILL_UNIT_MISMATCH "Choose a unit in the skill's course."
  where skill is owner's confirmed skill, unit belongs to its course, and title is blank
  then
    refuses INVALID_SKILL_TITLE "Enter a skill title."
  where skill is owner's confirmed skill, unit belongs to its course, and title is not blank
  then
    replace the skill's unit and title
    returns

reviseDefinition(owner: User, skill: Skill, outcome: String, gate: String) : returns (previous: Version, version: Version)
  where skill does not belong to owner or is not CONFIRMED
  then
    refuses SKILL_DEFINITION_UNAVAILABLE "Choose one of your confirmed skills."
  where skill is owner's confirmed skill and at least one of outcome and gate is blank
  then
    refuses INVALID_SKILL_DEFINITION "Enter an outcome and demonstration requirements."
  where skill is owner's confirmed skill, outcome and gate are not blank, and both match its current version
  then
    refuses SKILL_DEFINITION_UNCHANGED "Change the outcome or requirements to create a new version."
  where skill is owner's confirmed skill, outcome and gate are not blank, and at least one differs from its current version
  then
    save the skill's current version as previous
    create version with skill, outcome, and gate, and make it current
    returns previous, version

attachMaterial(owner: User, skill: Skill, material: Material) : returns ()
  where skill does not belong to owner or is not CONFIRMED
  then
    refuses SKILL_MATERIAL_UNAVAILABLE "Choose one of your confirmed skills."
  where skill is owner's confirmed skill
  then
    add material to the skill's materials set; an existing link stays unchanged
    returns

setPrerequisites(owner: User, skill: Skill, prerequisites: SkillSet) : returns ()
  where skill does not belong to owner or is not CONFIRMED
  then
    refuses SKILL_PREREQUISITES_UNAVAILABLE "Choose one of your confirmed skills."
  where skill is owner's confirmed skill and replacing its prerequisites would break a prerequisite rule
  then
    refuses INVALID_SKILL_PREREQUISITES "Use confirmed skills from this course, without self-dependencies or cycles."
  where skill is owner's confirmed skill and replacing its prerequisites would preserve every prerequisite rule
  then
    replace the skill's prerequisites
    returns

archive(owner: User, skill: Skill) : returns ()
  where skill does not belong to owner or is not CONFIRMED
  then
    refuses SKILL_ARCHIVE_UNAVAILABLE "Choose one of your confirmed skills."
  where skill is owner's confirmed skill and a confirmed skill lists it as a prerequisite
  then
    refuses SKILL_STILL_REQUIRED "Remove this skill from other active skills' prerequisites first."
  where skill is owner's confirmed skill and no confirmed skill lists it as a prerequisite
  then
    set the skill's status to ARCHIVED
    returns

restore(owner: User, skill: Skill) : returns ()
  where skill does not belong to owner or is not ARCHIVED
  then
    refuses SKILL_RESTORE_UNAVAILABLE "Choose one of your archived skills."
  where skill is owner's archived skill and restoring it would break a prerequisite rule
  then
    refuses SKILL_RESTORE_PREREQUISITES "Restore this skill's prerequisites before restoring the skill."
  where skill is owner's archived skill and restoring it would preserve every prerequisite rule
  then
    set the skill's status to CONFIRMED
    returns
```

## Queries

```queries
_courses(owner: User) : many (course: Course, title: String)
  Returns the owner's courses, ordered by course identity. Returns no rows when there are none.

_course(course: Course) : optional (owner: User, title: String)
  Returns the course's owner and title. Returns no row for an unknown course.

_units(course: Course) : many (unit: Unit, title: String)
  Returns the course's units, ordered by unit identity. Returns no rows for an unknown course or one with no units.

_unit(unit: Unit) : optional (course: Course, title: String)
  Returns the unit's course and title. Returns no row for an unknown unit.

_skills(unit: Unit) : many (skill: Skill, title: String, current: Version, status: SkillStatus)
  Returns the unit's skills in every status, ordered by skill identity. Returns no rows for an unknown unit or one with no skills.

_skill(skill: Skill) : optional (unit: Unit, title: String, current: Version, status: SkillStatus)
  Returns the skill's unit, title, current version, and status. Returns no row for an unknown skill.

_materials(skill: Skill) : many (material: Material)
  Returns the skill's source references, ordered by material identity. Returns no rows for an unknown skill or one with no sources.

_prerequisites(skill: Skill) : many (prerequisite: Skill)
  Returns direct prerequisites only, ordered by skill identity. Returns no rows for an unknown skill or one with no prerequisites.

_version(version: Version) : optional (skill: Skill, outcome: String, gate: String)
  Returns the version's skill, outcome, and gate, including earlier versions of an existing skill. Returns no row for an unknown or discarded version.
```
