import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import {
  createSkillMapping,
  InvalidCourseTitleError,
  InvalidUnitTitleError,
  UnitCourseUnavailableError,
  type SkillMapping,
} from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { clearCollections } from "./fixtures/clear-collections.ts";

// Only this generated database is removed. The app database is never used.
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;
let skills: SkillMapping;

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
  skills = await createSkillMapping(connection.db);
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

describe("SkillMapping course storage", () => {
  test("creates a course and reads its owner and title", async () => {
    const owner = randomUUID();
    const title = "MIT 18.06SC Linear Algebra";
    const { course } = await skills.createCourse({ owner, title });

    expect(course).toBeString();
    expect(await skills._course({ course })).toEqual([{ owner, title }]);
    expect(await skills._courses({ owner })).toEqual([{ course, title, status: "ACTIVE" }]);
  });

  test("refuses blank titles without changing saved courses", async () => {
    const owner = randomUUID();
    await skills.createCourse({ owner, title: "Existing course" });
    const before = await skills._courses({ owner });

    for (const title of ["", "   ", "\n\t", "\u00a0"]) {
      const result = skills.createCourse({ owner, title });
      await expect(result).rejects.toBeInstanceOf(InvalidCourseTitleError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_COURSE_TITLE",
        message: "Enter a course title.",
      });
    }
    expect(await skills._courses({ owner })).toEqual(before);
  });

  test("lists only the requested owner's courses, in ID order", async () => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const titles = ["Linear Algebra", "Mechanics", "Java"];
    const expected = [];

    for (const title of titles) {
      const { course } = await skills.createCourse({ owner, title });
      expected.push({ course, title, status: "ACTIVE" as const });
    }
    const other = await skills.createCourse({ owner: otherOwner, title: "Biology" });
    expected.sort((a, b) => (a.course < b.course ? -1 : 1));

    expect(await skills._courses({ owner })).toEqual(expected);
    expect(await skills._courses({ owner: otherOwner })).toEqual([
      { course: other.course, title: "Biology", status: "ACTIVE" },
    ]);
  });

  test("returns no rows for an unknown course or owner", async () => {
    expect(await skills._course({ course: randomUUID() })).toEqual([]);
    expect(await skills._courses({ owner: randomUUID() })).toEqual([]);
  });

  test("keeps separate courses when requests arrive together", async () => {
    const owner = randomUUID();
    const created = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        skills.createCourse({ owner, title: `Course ${i}` }),
      ),
    );

    expect(new Set(created.map(({ course }) => course)).size).toBe(12);
    const rows = await skills._courses({ owner });
    expect(rows).toHaveLength(12);
    expect(rows.map(({ title }) => title).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `Course ${i}`).sort(),
    );
  });

  test("reads a saved course and its units in a separate Bun process", async () => {
    const owner = randomUUID();
    const title = "Linear Algebra";
    const { course } = await skills.createCourse({ owner, title });
    const unitTitle = "Matrix multiplication";
    const { unit } = await skills.addUnit({ owner, course, title: unitTitle });
    const child = Bun.spawn(
      [process.execPath, new URL("./fixtures/read-course.ts", import.meta.url).pathname, database, course],
      { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      course: [{ owner, title }],
      units: [{ unit, title: unitTitle, emphasized: false }],
    });
  });
});

describe("SkillMapping units", () => {
  test("adds a unit to an owned course without changing that course", async () => {
    const owner = randomUUID();
    const { course } = await skills.createCourse({ owner, title: "Linear Algebra" });
    const before = await skills._course({ course });
    const title = "Matrix multiplication";
    const { unit } = await skills.addUnit({ owner, course, title });

    expect(unit).toBeString();
    expect(await skills._unit({ unit })).toEqual([{ course, title }]);
    expect(await skills._units({ course })).toEqual([{ unit, title, emphasized: false }]);
    expect(await skills._course({ course })).toEqual(before);
  });

  test("refuses other learners and missing courses before checking the title", async () => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const { course } = await skills.createCourse({ owner, title: "Linear Algebra" });
    await skills.addUnit({ owner, course, title: "Existing unit" });
    const beforeUnits = await skills._units({ course });
    const beforeCourse = await skills._course({ course });
    const missingCourse = randomUUID();

    for (const target of [course, missingCourse]) {
      for (const title of ["Unauthorized unit", " "]) {
        const result = skills.addUnit({ owner: otherOwner, course: target, title });
        await expect(result).rejects.toBeInstanceOf(UnitCourseUnavailableError);
        await expect(result).rejects.toMatchObject({
          code: "UNIT_COURSE_UNAVAILABLE",
          message: "Choose one of your courses.",
        });
      }
    }

    expect(await skills._units({ course })).toEqual(beforeUnits);
    expect(await skills._course({ course })).toEqual(beforeCourse);
    expect(await skills._units({ course: missingCourse })).toEqual([]);
  });

  test("refuses blank unit titles without changing existing records", async () => {
    const owner = randomUUID();
    const { course } = await skills.createCourse({ owner, title: "Linear Algebra" });
    await skills.addUnit({ owner, course, title: "Existing unit" });
    const beforeUnits = await skills._units({ course });
    const beforeCourse = await skills._course({ course });

    for (const title of ["", "   ", "\n\t", "\u00a0"]) {
      const result = skills.addUnit({ owner, course, title });
      await expect(result).rejects.toBeInstanceOf(InvalidUnitTitleError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_UNIT_TITLE",
        message: "Enter a unit title.",
      });
    }

    expect(await skills._units({ course })).toEqual(beforeUnits);
    expect(await skills._course({ course })).toEqual(beforeCourse);
  });

  test("lists units in ID order and keeps courses separate", async () => {
    const owner = randomUUID();
    const otherOwner = randomUUID();
    const { course } = await skills.createCourse({ owner, title: "Linear Algebra" });
    const otherCourse = await skills.createCourse({ owner, title: "Mechanics" });
    const otherLearnerCourse = await skills.createCourse({
      owner: otherOwner,
      title: "Another learner's course",
    });
    const expected = [];
    for (const title of ["Matrix multiplication", "Linear maps", "Matrix multiplication"]) {
      const { unit } = await skills.addUnit({ owner, course, title });
      expected.push({ unit, title, emphasized: false });
    }
    const other = await skills.addUnit({
      owner,
      course: otherCourse.course,
      title: "Motion",
    });
    const otherLearnerUnit = await skills.addUnit({
      owner: otherOwner,
      course: otherLearnerCourse.course,
      title: "Energy",
    });
    expected.sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));

    expect(await skills._units({ course })).toEqual(expected);
    expect(await skills._units({ course: otherCourse.course })).toEqual([
      { unit: other.unit, title: "Motion", emphasized: false },
    ]);
    expect(await skills._units({ course: otherLearnerCourse.course })).toEqual([
      { unit: otherLearnerUnit.unit, title: "Energy", emphasized: false },
    ]);
  });

  test("returns no rows for an empty course or unknown course or unit", async () => {
    const { course } = await skills.createCourse({
      owner: randomUUID(),
      title: "An empty course",
    });

    expect(await skills._units({ course })).toEqual([]);
    expect(await skills._units({ course: randomUUID() })).toEqual([]);
    expect(await skills._unit({ unit: randomUUID() })).toEqual([]);
  });
});
