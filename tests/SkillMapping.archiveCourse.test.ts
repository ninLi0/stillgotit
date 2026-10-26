import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createSkillMapping,
  CourseArchiveUnavailableError,
  CourseRestoreUnavailableError,
  type SkillMapping,
} from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { clearCollections } from "./fixtures/clear-collections.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;
let mapping: SkillMapping;

const content = {
  title: "Multiply matrices",
  outcome: "Multiply compatible matrices and explain each entry.",
  gate: "Solve two fresh problems without hints and explain each step.",
  materials: ["source-a"],
};

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
  mapping = await createSkillMapping(connection.db);
});

beforeEach(async () => {
  // Each test starts from empty collections in this file's database.
  await clearCollections(connection!.db);
});

afterAll(async () => {
  if (!connection) return;
  try {
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

/** A course with a unit, a confirmed skill with a revised definition, a draft, and an archived skill. */
async function makeCourse(owner = randomUUID()) {
  const { course } = await mapping.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await mapping.addUnit({ owner, course, title: "Matrices" });
  await mapping.setEmphasis({ owner, unit, emphasized: true });
  const { skill } = await mapping.propose({ proposalKey: randomUUID(), owner, unit, ...content });
  await mapping.confirm({ owner, skill });
  await mapping.reviseDefinition({ owner, skill, outcome: "A revised outcome", gate: "A revised gate" });
  const { skill: draft } = await mapping.propose({ proposalKey: randomUUID(), owner, unit, ...content, title: "A draft" });
  const { skill: archived } = await mapping.propose({ proposalKey: randomUUID(), owner, unit, ...content, title: "Set aside" });
  await mapping.confirm({ owner, skill: archived });
  await mapping.archive({ owner, skill: archived });
  return { owner, course, unit, skill, draft, archived };
}

/** Every stored record except course statuses, for "nothing else changed" checks. */
async function savedRecords() {
  const [courses, ...rest] = await Promise.all(["courses", "units", "skills", "versions"].map(
    (name) => connection!.db.collection(`SkillMapping.${name}`).find().sort({ _id: 1 }).toArray(),
  ));
  return [courses!.map(({ status: _status, ...course }) => course), ...rest];
}

/** Everything the queries show for a course, for "still readable" checks. */
async function courseView(course: string) {
  const units = await mapping._units({ course });
  const skills = (await Promise.all(units.map(({ unit }) => mapping._skills({ unit })))).flat();
  const details = await Promise.all(skills.map(async ({ skill }) => ({
    skill,
    materials: await mapping._materials({ skill }),
    prerequisites: await mapping._prerequisites({ skill }),
    versions: await mapping._versions({ skill }),
  })));
  return { course: await mapping._course({ course }), units, skills, details, map: await mapping._map({ course }) };
}

describe("SkillMapping course archive and restore", () => {
  test("a new course is active, and _courses reports each course's status", async () => {
    const owner = randomUUID();
    const { course } = await mapping.createCourse({ owner, title: "Linear Algebra" });
    expect(await mapping._courses({ owner })).toEqual([{ course, title: "Linear Algebra", status: "ACTIVE" }]);
  });

  test("archiving changes only the course's status and keeps it readable; restoring brings it back", async () => {
    const { owner, course, unit, draft } = await makeCourse();
    const other = await makeCourse(owner);
    const records = await savedRecords(), view = await courseView(course);

    expect(await mapping.archiveCourse({ owner, course })).toEqual({});
    const rows = await mapping._courses({ owner });
    expect(rows.find((row) => row.course === course)).toEqual({ course, title: "Linear Algebra", status: "ARCHIVED" });
    expect(rows.find((row) => row.course === other.course)).toEqual({ course: other.course, title: "Linear Algebra", status: "ACTIVE" });
    // Units, skills in every status, versions, sources, and links stay, and every query answers as before.
    expect(await savedRecords()).toEqual(records);
    expect(await courseView(course)).toEqual(view);
    // Other actions treat an archived course like an active one.
    const { unit: added } = await mapping.addUnit({ owner, course, title: "Added while archived" });
    expect(await mapping._unit({ unit: added })).toEqual([{ course, title: "Added while archived" }]);
    expect(await mapping.discardDraft({ owner, skill: draft })).toEqual({});
    expect((await mapping._skills({ unit })).some((row) => row.skill === draft)).toBe(false);

    expect(await mapping.restoreCourse({ owner, course })).toEqual({});
    expect((await mapping._courses({ owner })).find((row) => row.course === course)!.status).toBe("ACTIVE");
  });

  test("refuses another learner's course, an unknown course, and the wrong status, changing nothing", async () => {
    const { owner, course } = await makeCourse();
    const outsider = randomUUID();
    const before = await connection!.db.collection("SkillMapping.courses").find().sort({ _id: 1 }).toArray();

    for (const attempt of [
      () => mapping.archiveCourse({ owner: outsider, course }),
      () => mapping.archiveCourse({ owner, course: randomUUID() }),
    ]) {
      const refused = attempt();
      await expect(refused).rejects.toBeInstanceOf(CourseArchiveUnavailableError);
      await expect(refused).rejects.toMatchObject({ code: "COURSE_ARCHIVE_UNAVAILABLE", message: "Choose one of your active courses." });
    }
    for (const attempt of [
      () => mapping.restoreCourse({ owner, course }),
      () => mapping.restoreCourse({ owner: outsider, course }),
      () => mapping.restoreCourse({ owner, course: randomUUID() }),
    ]) {
      const refused = attempt();
      await expect(refused).rejects.toBeInstanceOf(CourseRestoreUnavailableError);
      await expect(refused).rejects.toMatchObject({ code: "COURSE_RESTORE_UNAVAILABLE", message: "Choose one of your archived courses." });
    }
    expect(await connection!.db.collection("SkillMapping.courses").find().sort({ _id: 1 }).toArray()).toEqual(before);

    // Archiving twice is refused, and so is another learner's restore of the archived course.
    await mapping.archiveCourse({ owner, course });
    await expect(mapping.archiveCourse({ owner, course })).rejects.toBeInstanceOf(CourseArchiveUnavailableError);
    await expect(mapping.restoreCourse({ owner: outsider, course })).rejects.toBeInstanceOf(CourseRestoreUnavailableError);
    expect((await mapping._courses({ owner }))[0]!.status).toBe("ARCHIVED");
  });

  test("of two archive requests that arrive together, one archives and the other is refused", async () => {
    const { owner, course } = await makeCourse();
    const results = await Promise.allSettled([mapping.archiveCourse({ owner, course }), mapping.archiveCourse({ owner, course })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find((result) => result.status === "rejected")).toMatchObject({ reason: expect.any(CourseArchiveUnavailableError) });
    expect((await mapping._courses({ owner }))[0]!.status).toBe("ARCHIVED");
  });

  test("a course saved before statuses existed is active and can be archived", async () => {
    const owner = randomUUID(), course = randomUUID();
    await connection!.db.collection<{ _id: string; owner: string; title: string }>("SkillMapping.courses").insertOne({ _id: course, owner, title: "Saved earlier" });
    expect(await mapping._courses({ owner })).toEqual([{ course, title: "Saved earlier", status: "ACTIVE" }]);
    await expect(mapping.restoreCourse({ owner, course })).rejects.toBeInstanceOf(CourseRestoreUnavailableError);
    expect(await mapping.archiveCourse({ owner, course })).toEqual({});
    expect(await mapping._courses({ owner })).toEqual([{ course, title: "Saved earlier", status: "ARCHIVED" }]);
  });
});
