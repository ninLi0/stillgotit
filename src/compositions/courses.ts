import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { each, former, no, view, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../concepts.ts";
import { courseInput, courseListOutput, recordOutput, validators } from "./reusable/inputs.ts";

const { Sessioning, SkillMapping } = concepts;

const OwnedCourse = view("(owner) owns (course) with (title)", ({ owner, course }, { title }) =>
  where(SkillMapping._course({ course }).is({ owner, title })),
).optional();

const CourseList = former("the courses belonging to (owner)", ({ owner }, { course, title }) =>
  each(SkillMapping._courses({ owner }).is({ course }))
    .where(OwnedCourse({ owner, course }).is({ title }))
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

export const composition = { OwnedCourse, CourseList, ListCourses, CreateCourse };
