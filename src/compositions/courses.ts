import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, each, former, is, no, now, reaction, returned, view, when, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations } from "../concepts.ts";
import { courseInput, courseListOutput, emphasisInput, prerequisitesInput, recordOutput, skillTextInput, validators, materialInput, proposalInput, proposalSaveInput, structuredOutput } from "./reusable/inputs.ts";

const { Sessioning, SkillMapping, Library, MasteryEstimating, StudyPlanning } = concepts;

const OwnedCourse = view("(owner) owns (course) with (title)", ({ owner, course }, { title }) =>
  where(SkillMapping._course({ course }).is({ owner, title })),
).optional();

// Every course in every status, so the page can list archived courses apart from current ones.
const CourseList = former("the courses belonging to (owner)", ({ owner }, { course, title, status }) =>
  each(SkillMapping._courses({ owner }).is({ course, status }))
    .where(OwnedCourse({ owner, course }).is({ title }))
    .arranged(course)
    .form({ course, title, status }),
);

const ListCourses = endpoint("/courses", ({ session, owner }) =>
  receive({ session })
    .then(Sessioning.use({ session }).responds({ subject: owner }))
    .then(respond({ courses: CourseList({ owner }) })),
  { validators: { ...validators, output: courseListOutput } },
);

const CreateCourse = endpoint("/courses/create", ({ session, title, owner, course }) =>
  receive({ session, title })
    .then(Sessioning.use({ session }).responds({ subject: owner }))
    .then(SkillMapping.createCourse({ owner, title }).responds({ course }))
    .then(respond({ course })),
  { validators: { ...validators, input: courseInput, output: recordOutput(["course"]) } },
);

const OwnedUnit = view("(owner) owns (unit) in (course)", ({ owner, unit }, { course }) =>
  where(SkillMapping._unit({ unit }).is({ course }), OwnedCourse({ owner, course })),
).optional();

const OwnedSkill = view("(owner) owns (skill) in (course)", ({ owner, skill }, { course, unit }) =>
  where(SkillMapping._skill({ skill }).is({ unit }), OwnedUnit({ owner, unit }).is({ course })),
).optional();

const Materials = former("the source summaries for (owner) in (course)", ({ owner, course }, { material, title, locator, origin }) =>
  each(Library._materials({ owner, scope: course }).is({ material, title, locator, origin }))
    .arranged(material)
    .form({ material, title, locator, origin }),
);

const Units = former("the units in (course)", ({ course }, { unit, title, emphasized }) =>
  each(SkillMapping._units({ course }).is({ unit, title, emphasized })).arranged(unit).form({ unit, title, emphasized }),
);

const Skills = former("the skill definitions in (course)", ({ course }, { unit, skill, title, current, status, outcome, gate }) =>
  each(SkillMapping._units({ course }).is({ unit }))
    .where(SkillMapping._skills({ unit }).is({ skill, title, current, status }), SkillMapping._version({ version: current }).is({ outcome, gate }))
    .arranged(skill)
    .form({ unit, skill, title, current, status, outcome, gate }),
);

// Link lists cover skills in every status, like Skills, so archived skills keep their history on the page.
// A selection has one arrangement key. Rows sort by skill and, within a skill, keep the query's order:
// _prerequisites and _materials return rows by the linked identity.
const Prerequisites = former("the prerequisite links in (course)", ({ course }, { unit, skill, prerequisite }) =>
  each(SkillMapping._units({ course }).is({ unit }))
    .where(SkillMapping._skills({ unit }).is({ skill }), SkillMapping._prerequisites({ skill }).is({ prerequisite }))
    .arranged(skill)
    .form({ skill, prerequisite }),
);

const SkillSources = former("the skill sources in (course)", ({ course }, { unit, skill, material }) =>
  each(SkillMapping._units({ course }).is({ unit }))
    .where(SkillMapping._skills({ unit }).is({ skill }), SkillMapping._materials({ skill }).is({ material }))
    .arranged(skill)
    .form({ skill, material }),
);

// Within a skill, rows keep the newest-first order of _versions; the first row is the current version.
const Versions = former("the requirements versions in (course)", ({ course }, { unit, skill, version, outcome, gate }) =>
  each(SkillMapping._units({ course }).is({ unit }))
    .where(SkillMapping._skills({ unit }).is({ skill }), SkillMapping._versions({ skill }).is({ version, outcome, gate }))
    .arranged(skill)
    .form({ skill, version, outcome, gate }),
);

// The read answers at the settlement frontier, after RepairRevisedTrack has finished.
const ReadCourse = endpoint("/courses/read", ({ session, course, owner }) =>
  receive({ session, course }).then(Sessioning.use({ session }).responds({ subject: owner })).afterFlowSettles().then(
    where(OwnedCourse({ owner, course })).then(respond({ materials: Materials({ owner, course }), units: Units({ course }), skills: Skills({ course }),
      prerequisites: Prerequisites({ course }), skillSources: SkillSources({ course }), versions: Versions({ course }) })).named("owned"),
    where(no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, output: structuredOutput } },
);

const AddUnit = endpoint("/courses/units/add", ({ session, course, title, owner, unit }) =>
  receive({ session, course, title }).then(Sessioning.use({ session }).responds({ subject: owner }))
    .then(SkillMapping.addUnit({ owner, course, title }).responds({ unit })).then(respond({ unit })),
  { validators: { ...validators, input: courseInput, output: recordOutput(["unit"]) } },
);

const ReadMaterial = endpoint("/courses/materials/read", ({ session, material, owner, course, title, locator, content, originals, origin }) =>
  receive({ session, material }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(Library._material({ material }).is({ owner, scope: course, title, locator, content, originals, origin }), OwnedCourse({ owner, course }))
      .then(respond({ title, locator, content, originals, origin })).named("owned"),
    where(no(Library._material({ material }).is({ owner }))).then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("missing"),
    where(Library._material({ material }).is({ owner, scope: course }), no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("course"),
  ), { validators: { ...validators, output: structuredOutput } },
);

const AddMaterial = endpoint("/internal/materials/add", ({ session, course, importKey, title, locator, content, originals, origin, owner, material }) =>
  receive({ session, course, importKey, title, locator, content, originals, origin })
    .then(Sessioning.use({ session }).responds({ subject: owner })).then(
      where(OwnedCourse({ owner, course }))
        .then(Library.add({ owner, scope: course, importKey, title, locator, content, originals, origin }).responds({ material }))
        .then(respond({ material })).named("owned"),
      where(no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    ), { validators: { ...validators, input: materialInput, output: recordOutput(["material"]) } },
);

// The graded-work check applies only to the learner's own material in the unit's course: graded work is evidence, not a teaching source.
const ProposeSkill = endpoint("/courses/skills/propose", ({ session, unit, proposalKey, material, materials, title, outcome, gate, owner, course, skill, materialTitle, graded }) =>
  receive({ session, unit, proposalKey, material, title, outcome, gate }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedUnit({ owner, unit }).is({ course }), Library._material({ material }).is({ owner, scope: course, title: materialTitle }),
      compute(computations.gradedTitle, { title: materialTitle }, graded), is.among(graded, [false]), compute(computations.singleMaterial, { material }, materials))
      .then(SkillMapping.propose({ owner, unit, proposalKey, title, outcome, gate, materials }).responds({ skill }))
      .then(respond({ skill })).named("owned"),
    where(no(OwnedUnit({ owner, unit }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedUnit({ owner, unit }).is({ course }), no(Library._material({ material }).is({ owner, scope: course })))
      .then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
    where(OwnedUnit({ owner, unit }).is({ course }), Library._material({ material }).is({ owner, scope: course, title: materialTitle }),
      compute(computations.gradedTitle, { title: materialTitle }, graded), is.among(graded, [true]))
      .then(respond({ error: "GRADED_MATERIAL_NOT_SOURCE" })).named("graded"),
  ), { validators: { ...validators, input: proposalSaveInput, output: recordOutput(["skill"]) } },
);

const UnavailableSkillMaterial = view("(skill) has a source outside (owner)'s (course)", ({ owner, skill, course }, {}, { material }) =>
  where(SkillMapping._materials({ skill }).is({ material }), no(Library._material({ material }).is({ owner, scope: course }))),
).holds();

const ConfirmSkill = endpoint("/courses/skills/confirm", ({ session, skill, owner, course }) =>
  receive({ session, skill }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill }).is({ course }), no(UnavailableSkillMaterial({ owner, skill, course })))
      .then(SkillMapping.confirm({ owner, skill }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedSkill({ owner, skill }).is({ course }), UnavailableSkillMaterial({ owner, skill, course })).then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
  ), { validators },
);

// A saved draft is removed with its versions. SkillMapping refuses any skill that is not a draft with its own code.
const DiscardDraft = endpoint("/courses/skills/discard", ({ session, skill, owner }) =>
  receive({ session, skill }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill })).then(SkillMapping.discardDraft({ owner, skill }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators },
);

// The same refusals as ProposeSkill, then the graded-work check for the learner's own material in that course.
const EditDraft = endpoint("/courses/skills/edit", ({ session, skill, unit, material, materials, title, outcome, gate, owner, course, materialTitle, graded }) =>
  receive({ session, skill, unit, material, title, outcome, gate }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedUnit({ owner, unit }).is({ course }), Library._material({ material }).is({ owner, scope: course, title: materialTitle }),
      compute(computations.gradedTitle, { title: materialTitle }, graded), is.among(graded, [false]), compute(computations.singleMaterial, { material }, materials))
      .then(SkillMapping.reviseDraft({ owner, skill, unit, title, outcome, gate, materials }).responds({}))
      .then(respond({})).named("owned"),
    where(no(OwnedUnit({ owner, unit }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedUnit({ owner, unit }).is({ course }), no(Library._material({ material }).is({ owner, scope: course })))
      .then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
    where(OwnedUnit({ owner, unit }).is({ course }), Library._material({ material }).is({ owner, scope: course, title: materialTitle }),
      compute(computations.gradedTitle, { title: materialTitle }, graded), is.among(graded, [true]))
      .then(respond({ error: "GRADED_MATERIAL_NOT_SOURCE" })).named("graded"),
  ), { validators: { ...validators, input: proposalInput } },
);

// Confirmed-skill and unit changes. Each requires an owned record first; an unknown record and another
// learner's record both get COURSE_UNAVAILABLE. The one SkillMapping action then enforces status and
// prerequisite rules, and its refusal is the endpoint's answer with the action's own code.
const EditSkillDetails = endpoint("/courses/skills/details", ({ session, skill, unit, title, owner }) =>
  receive({ session, skill, unit, title }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill })).then(SkillMapping.editDetails({ owner, skill, unit, title }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, input: skillTextInput } },
);

// RevisedTrack runs in this request's flow. The answer is formed when the revision returns, and the
// transport sends it once the flow has settled, so RevisedTrack has finished by then.
const ReviseSkill = endpoint("/courses/skills/revise", ({ session, skill, outcome, gate, owner, previous, version }) =>
  receive({ session, skill, outcome, gate }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill })).then(SkillMapping.reviseDefinition({ owner, skill, outcome, gate }).responds({ previous, version }))
      .then(respond({ previous, version })).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, input: skillTextInput, output: recordOutput(["previous", "version"]) } },
);

// The new version's track starts from the previous track's estimate at the flow's instant. Evidence is
// not copied. No previous track, or an existing track for the new version, means there is nothing to do.
const RevisedTrack = reaction(({ owner, skill, previous, version, at, confidence }) =>
  when(SkillMapping.reviseDefinition({ owner, skill }).responds({ previous, version }))
    .where(MasteryEstimating._track({ learner: owner, subject: skill, definition: previous }),
      no(MasteryEstimating._track({ learner: owner, subject: skill, definition: version })), now(at),
      MasteryEstimating._estimate({ learner: owner, subject: skill, definition: previous, at }).is({ value: confidence }))
    .then(MasteryEstimating.initialize({ learner: owner, subject: skill, definition: version, confidence, basis: "PREVIOUS_DEFINITION" })));

// Recovery for a revision whose track write failed. It runs on the course read's successful session check,
// outside the learner's lock, and starts a missing current-version track from the most recently started
// earlier track. An existing current-version track counts as done, so repeated reads add nothing. The
// reaction cannot read the request's course, so it looks at every course of the signed-in learner.
const RepairRevisedTrack = reaction(({ identity, owner, course, unit, skill, current, tracks, confidence }) =>
  when(returned({ concept: "Sessioning", action: "use", result: identity }, { by: "Courses.ReadCourse" }))
    .where(compute(computations.sessionSubject, { identity }, { owner }), SkillMapping._courses({ owner }).is({ course }), SkillMapping._units({ course }).is({ unit }),
      SkillMapping._skills({ unit }).is({ skill, current, status: "CONFIRMED" }), no(MasteryEstimating._track({ learner: owner, subject: skill, definition: current })),
      MasteryEstimating._progress({ learner: owner }).is({ tracks }), compute(computations.carriedEstimate, { tracks, skill, current }, { found: true, confidence }))
    .then(MasteryEstimating.initialize({ learner: owner, subject: skill, definition: current, confidence, basis: "PREVIOUS_DEFINITION" })));

// Like ProposeSkill, the material must belong to the learner and to the skill's course.
const AddSkillSource = endpoint("/courses/skills/sources/add", ({ session, skill, material, owner, course }) =>
  receive({ session, skill, material }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill }).is({ course }), Library._material({ material }).is({ owner, scope: course }))
      .then(SkillMapping.attachMaterial({ owner, skill, material }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedSkill({ owner, skill }).is({ course }), no(Library._material({ material }).is({ owner, scope: course })))
      .then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
  ), { validators },
);

const SetSkillPrerequisites = endpoint("/courses/skills/prerequisites", ({ session, skill, prerequisites, owner, required }) =>
  receive({ session, skill, prerequisites }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill }), compute(computations.prerequisiteSet, { prerequisites }, required))
      .then(SkillMapping.setPrerequisites({ owner, skill, prerequisites: required }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, input: prerequisitesInput } },
);

const ArchiveSkill = endpoint("/courses/skills/archive", ({ session, skill, owner }) =>
  receive({ session, skill }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill })).then(SkillMapping.archive({ owner, skill }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators },
);

const RestoreSkill = endpoint("/courses/skills/restore", ({ session, skill, owner }) =>
  receive({ session, skill }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill })).then(SkillMapping.restore({ owner, skill }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators },
);

// An activity in progress in the course is refused before archiving: the planning concept allows one in progress across
// all of a learner's courses, and one left running in an archived course would block work in every other course.
const CourseActivityInProgress = view("(owner) has an activity in progress in (course)", ({ owner, course }) =>
  where(StudyPlanning._next({ owner, scope: course }).is({ status: "IN_PROGRESS" })),
).holds();

const ArchiveCourse = endpoint("/courses/archive", ({ session, course, owner }) =>
  receive({ session, course }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedCourse({ owner, course }), no(CourseActivityInProgress({ owner, course })))
      .then(SkillMapping.archiveCourse({ owner, course }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedCourse({ owner, course }), CourseActivityInProgress({ owner, course })).then(respond({ error: "COURSE_ACTIVITY_IN_PROGRESS" })).named("busy"),
  ), { validators },
);

const RestoreCourse = endpoint("/courses/restore", ({ session, course, owner }) =>
  receive({ session, course }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedCourse({ owner, course })).then(SkillMapping.restoreCourse({ owner, course }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators },
);

const SetUnitEmphasis = endpoint("/courses/units/emphasis", ({ session, unit, emphasized, owner }) =>
  receive({ session, unit, emphasized }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedUnit({ owner, unit })).then(SkillMapping.setEmphasis({ owner, unit, emphasized }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedUnit({ owner, unit }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
  ), { validators: { ...validators, input: emphasisInput } },
);

export const composition = { OwnedCourse, OwnedUnit, OwnedSkill, CourseList, ListCourses, CreateCourse,
  UnavailableSkillMaterial, Materials, Units, Skills, Prerequisites, SkillSources, Versions, ReadCourse, ReadMaterial, AddUnit, AddMaterial, ProposeSkill, ConfirmSkill, DiscardDraft, EditDraft,
  EditSkillDetails, ReviseSkill, RevisedTrack, RepairRevisedTrack, AddSkillSource, SetSkillPrerequisites, ArchiveSkill, RestoreSkill, SetUnitEmphasis,
  CourseActivityInProgress, ArchiveCourse, RestoreCourse };
