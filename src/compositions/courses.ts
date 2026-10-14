import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, each, former, no, view, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations } from "../concepts.ts";
import { courseInput, courseListOutput, recordOutput, validators, materialInput, proposalInput, proposalSaveInput, structuredOutput } from "./reusable/inputs.ts";

const { Sessioning, SkillMapping, GroundedTutoring } = concepts;

const OwnedCourse = view("(owner) owns (course) with (title)", ({ owner, course }, { title }) =>
  where(SkillMapping._course({ course }).is({ owner, title })),
).optional();

const CourseList = former("the courses belonging to (owner)", ({ owner }, { course, title }) =>
  each(SkillMapping._courses({ owner }).is({ course }))
    .where(OwnedCourse({ owner, course }).is({ title }))
    .arranged(course)
    .form({ course, title }),
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
    .then(
      where(no(SkillMapping._courses({ owner })))
        .then(SkillMapping.createCourse({ owner, title }).responds({ course }))
        .then(respond({ course }))
        .named("first"),
      where(SkillMapping._courses({ owner }))
        .then(respond({ error: "COURSE_EXISTS" }))
        .named("existing"),
    ),
  { validators: { ...validators, input: courseInput, output: recordOutput(["course"]) } },
);

const OwnedUnit = view("(owner) owns (unit) in (course)", ({ owner, unit }, { course }) =>
  where(SkillMapping._unit({ unit }).is({ course }), OwnedCourse({ owner, course })),
).optional();

const OwnedSkill = view("(owner) owns (skill) in (course)", ({ owner, skill }, { course, unit }) =>
  where(SkillMapping._skill({ skill }).is({ unit }), OwnedUnit({ owner, unit }).is({ course })),
).optional();

const Materials = former("the source summaries for (owner) in (course)", ({ owner, course }, { material, title, locator, origin }) =>
  each(GroundedTutoring._materials({ owner, scope: course }).is({ material, title, locator, origin }))
    .arranged(material)
    .form({ material, title, locator, origin }),
);

const Units = former("the units in (course)", ({ course }, { unit, title }) =>
  each(SkillMapping._units({ course }).is({ unit, title })).arranged(unit).form({ unit, title }),
);

const Skills = former("the skill definitions in (course)", ({ course }, { unit, skill, title, current, status, outcome, gate }) =>
  each(SkillMapping._units({ course }).is({ unit }))
    .where(SkillMapping._skills({ unit }).is({ skill, title, current, status }), SkillMapping._version({ version: current }).is({ outcome, gate }))
    .arranged(skill)
    .form({ unit, skill, title, current, status, outcome, gate }),
);

const ReadCourse = endpoint("/courses/read", ({ session, course, owner }) =>
  receive({ session, course }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedCourse({ owner, course })).then(respond({ materials: Materials({ owner, course }), units: Units({ course }), skills: Skills({ course }) })).named("owned"),
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
    where(GroundedTutoring._material({ material }).is({ owner, scope: course, title, locator, content, originals, origin }), OwnedCourse({ owner, course }))
      .then(respond({ title, locator, content, originals, origin })).named("owned"),
    where(no(GroundedTutoring._material({ material }).is({ owner }))).then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("missing"),
    where(GroundedTutoring._material({ material }).is({ owner, scope: course }), no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("course"),
  ), { validators: { ...validators, output: structuredOutput } },
);

const AddMaterial = endpoint("/internal/materials/add", ({ session, course, importKey, title, locator, content, originals, origin, owner, material }) =>
  receive({ session, course, importKey, title, locator, content, originals, origin })
    .then(Sessioning.use({ session }).responds({ subject: owner })).then(
      where(OwnedCourse({ owner, course }))
        .then(GroundedTutoring.addMaterial({ owner, scope: course, importKey, title, locator, content, originals, origin }).responds({ material }))
        .then(respond({ material })).named("owned"),
      where(no(OwnedCourse({ owner, course }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    ), { validators: { ...validators, input: materialInput, output: recordOutput(["material"]) } },
);

const ProposeSkill = endpoint("/courses/skills/propose", ({ session, unit, proposalKey, material, materials, title, outcome, gate, owner, course, skill }) =>
  receive({ session, unit, proposalKey, material, title, outcome, gate }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedUnit({ owner, unit }).is({ course }), GroundedTutoring._material({ material }).is({ owner, scope: course }),
      compute(computations.singleMaterial, { material }, materials))
      .then(SkillMapping.propose({ owner, unit, proposalKey, title, outcome, gate, materials }).responds({ skill }))
      .then(respond({ skill })).named("owned"),
    where(no(OwnedUnit({ owner, unit }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedUnit({ owner, unit }).is({ course }), no(GroundedTutoring._material({ material }).is({ owner, scope: course })))
      .then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
  ), { validators: { ...validators, input: proposalSaveInput, output: recordOutput(["skill"]) } },
);

const UnavailableSkillMaterial = view("(skill) has a source outside (owner)'s (course)", ({ owner, skill, course }, {}, { material }) =>
  where(SkillMapping._materials({ skill }).is({ material }), no(GroundedTutoring._material({ material }).is({ owner, scope: course }))),
).holds();

const ConfirmSkill = endpoint("/courses/skills/confirm", ({ session, skill, owner, course }) =>
  receive({ session, skill }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedSkill({ owner, skill }).is({ course }), no(UnavailableSkillMaterial({ owner, skill, course })))
      .then(SkillMapping.confirm({ owner, skill }).responds({})).then(respond({})).named("owned"),
    where(no(OwnedSkill({ owner, skill }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedSkill({ owner, skill }).is({ course }), UnavailableSkillMaterial({ owner, skill, course })).then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
  ), { validators },
);

const EditDraft = endpoint("/courses/skills/edit", ({ session, skill, unit, material, materials, title, outcome, gate, owner, course }) =>
  receive({ session, skill, unit, material, title, outcome, gate }).then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(OwnedUnit({ owner, unit }).is({ course }), GroundedTutoring._material({ material }).is({ owner, scope: course }),
      compute(computations.singleMaterial, { material }, materials))
      .then(SkillMapping.reviseDraft({ owner, skill, unit, title, outcome, gate, materials }).responds({}))
      .then(respond({})).named("owned"),
    where(no(OwnedUnit({ owner, unit }))).then(respond({ error: "COURSE_UNAVAILABLE" })).named("missing"),
    where(OwnedUnit({ owner, unit }).is({ course }), no(GroundedTutoring._material({ material }).is({ owner, scope: course })))
      .then(respond({ error: "MATERIAL_UNAVAILABLE" })).named("source"),
  ), { validators: { ...validators, input: proposalInput } },
);

export const composition = { OwnedCourse, OwnedUnit, OwnedSkill, CourseList, ListCourses, CreateCourse,
  UnavailableSkillMaterial, Materials, Units, Skills, ReadCourse, ReadMaterial, AddUnit, AddMaterial, ProposeSkill, ConfirmSkill, EditDraft };
