import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  UnitEmphasisUnavailableError,
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

// A course with two units and a confirmed skill in the first unit.
async function makeCourse(concept = mapping) {
  const owner = randomUUID();
  const { course } = await concept.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await concept.addUnit({ owner, course, title: "Matrices" });
  const other = await concept.addUnit({ owner, course, title: "Eigenvalues" });
  const { skill } = await concept.propose({ proposalKey: randomUUID(), ...content, owner, unit });
  await concept.confirm({ owner, skill });
  return { owner, course, unit, otherUnit: other.unit, skill };
}

function byUnit<T extends { unit: string }>(rows: T[]) {
  return rows.sort((a, b) => (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));
}

async function savedState(instanceName = "SkillMapping") {
  return Promise.all(["courses", "units", "skills", "versions"].map(
    (name) => connection!.db.collection(`${instanceName}.${name}`).find().sort({ _id: 1 }).toArray(),
  ));
}

describe("SkillMapping unit emphasis", () => {
  test("a new unit is not emphasized, and setting the flag shows in _units and changes nothing else", async () => {
    const { owner, course, unit, otherUnit } = await makeCourse();
    expect(await mapping._units({ course })).toEqual(byUnit([
      { unit, title: "Matrices", emphasized: false },
      { unit: otherUnit, title: "Eigenvalues", emphasized: false },
    ]));
    await makeCourse();
    const before = await savedState();

    expect(await mapping.setEmphasis({ owner, unit, emphasized: true })).toEqual({});
    expect(await mapping._units({ course })).toEqual(byUnit([
      { unit, title: "Matrices", emphasized: true },
      { unit: otherUnit, title: "Eigenvalues", emphasized: false },
    ]));
    // _unit keeps its declared row shape.
    expect(await mapping._unit({ unit })).toEqual([{ course, title: "Matrices" }]);
    expect(await savedState()).toEqual([
      before[0],
      before[1]!.map((row) => String(row._id) === unit ? { ...row, emphasized: true } : row),
      before[2],
      before[3],
    ]);
  });

  test("setting the saved value again succeeds and changes nothing", async () => {
    const { owner, course, unit } = await makeCourse();
    for (const emphasized of [false, true]) {
      if (emphasized) await mapping.setEmphasis({ owner, unit, emphasized });
      const before = await savedState();
      expect(await mapping.setEmphasis({ owner, unit, emphasized })).toEqual({});
      expect(await mapping.setEmphasis({ owner, unit, emphasized })).toEqual({});
      expect(await savedState()).toEqual(before);
      expect((await mapping._units({ course })).find((row) => row.unit === unit)?.emphasized).toBe(emphasized);
    }
  });

  test("setting the flag back to false clears it", async () => {
    const { owner, course, unit, otherUnit } = await makeCourse();
    const before = await savedState();
    await mapping.setEmphasis({ owner, unit, emphasized: true });
    await mapping.setEmphasis({ owner, unit: otherUnit, emphasized: true });
    expect(await mapping.setEmphasis({ owner, unit, emphasized: false })).toEqual({});

    expect(await mapping._units({ course })).toEqual(byUnit([
      { unit, title: "Matrices", emphasized: false },
      { unit: otherUnit, title: "Eigenvalues", emphasized: true },
    ]));
    expect(await savedState()).toEqual([
      before[0],
      before[1]!.map((row) => String(row._id) === otherUnit ? { ...row, emphasized: true } : row),
      before[2],
      before[3],
    ]);
  });

  test("refuses another learner, a missing unit, and another learner's unit without changing anything", async () => {
    const mine = await makeCourse();
    const theirs = await makeCourse();
    await mapping.setEmphasis({ owner: theirs.owner, unit: theirs.unit, emphasized: true });
    const before = await savedState();

    for (const emphasized of [true, false]) {
      for (const identity of [
        { owner: randomUUID(), unit: mine.unit },
        { owner: theirs.owner, unit: mine.unit },
        { owner: mine.owner, unit: theirs.unit },
        { owner: mine.owner, unit: randomUUID() },
        // A course is not a unit.
        { owner: mine.owner, unit: mine.course },
      ]) {
        const result = mapping.setEmphasis({ ...identity, emphasized });
        await expect(result).rejects.toBeInstanceOf(UnitEmphasisUnavailableError);
        await expect(result).rejects.toMatchObject({
          code: "UNIT_EMPHASIS_UNAVAILABLE",
          message: "Choose a unit in one of your courses.",
        });
      }
    }
    expect(await savedState()).toEqual(before);

    // The refusals leave the owner's own change available.
    expect(await mapping.setEmphasis({ owner: mine.owner, unit: mine.unit, emphasized: true })).toEqual({});
    expect((await mapping._units({ course: mine.course })).find((row) => row.unit === mine.unit)?.emphasized)
      .toBe(true);
    expect((await mapping._units({ course: theirs.course })).find((row) => row.unit === theirs.unit)?.emphasized)
      .toBe(true);
  });

  test("treats a value that is not a flag as a fault and saves nothing", async () => {
    const { owner, unit } = await makeCourse();
    const before = await savedState();
    for (const emphasized of ["true", 1, null, undefined]) {
      const result = mapping.setEmphasis({ owner, unit, emphasized: emphasized as unknown as boolean });
      await expect(result).rejects.toBeInstanceOf(TypeError);
      await expect(result).rejects.not.toBeInstanceOf(UnitEmphasisUnavailableError);
    }
    expect(await savedState()).toEqual(before);
  });

  test("keeps the saved flag when MongoDB rejects the write, and a retry saves it", async () => {
    const instanceName = "EmphasisFailure";
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, course, unit } = await makeCourse(concept);
    const before = await savedState(instanceName);
    await connection!.db.command({
      collMod: `${instanceName}.units`,
      validator: { emphasized: { $ne: true } },
      validationLevel: "strict",
      validationAction: "error",
    });
    try {
      const result = concept.setEmphasis({ owner, unit, emphasized: true });
      await expect(result).rejects.toBeInstanceOf(MongoServerError);
      await expect(result).rejects.toMatchObject({ code: 121 });
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: `${instanceName}.units`, validator: {} });
    }
    expect(await concept.setEmphasis({ owner, unit, emphasized: true })).toEqual({});
    expect((await concept._units({ course })).find((row) => row.unit === unit)?.emphasized).toBe(true);
  });

  test("concurrent settings each succeed and save one complete value per unit", async () => {
    const { owner, course, unit, otherUnit } = await makeCourse();
    const before = await savedState();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await Promise.all([
        mapping.setEmphasis({ owner, unit, emphasized: true }),
        secondMapping.setEmphasis({ owner, unit, emphasized: false }),
        mapping.setEmphasis({ owner, unit: otherUnit, emphasized: true }),
        secondMapping.setEmphasis({ owner, unit: otherUnit, emphasized: true }),
      ])).toEqual([{}, {}, {}, {}]);
      // A second client reads the same saved flags.
      expect(await secondMapping._units({ course })).toEqual(await mapping._units({ course }));
    } finally {
      await secondConnection.client.close();
    }
    const rows = await mapping._units({ course });
    const saved = rows.find((row) => row.unit === unit)!.emphasized;
    expect(typeof saved).toBe("boolean");
    expect(rows.find((row) => row.unit === otherUnit)?.emphasized).toBe(true);
    expect(await savedState()).toEqual([
      before[0],
      before[1]!.map((row) => String(row._id) === unit
        ? { ...row, emphasized: saved }
        : String(row._id) === otherUnit ? { ...row, emphasized: true } : row),
      before[2],
      before[3],
    ]);
  });

  test("reads the saved flag in another process", async () => {
    const { owner, course, unit, otherUnit } = await makeCourse();
    await mapping.setEmphasis({ owner, unit: otherUnit, emphasized: true });
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./fixtures/read-course.ts", import.meta.url)),
      database, course,
    ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      course: [{ owner, title: "Linear Algebra" }],
      units: byUnit([
        { unit, title: "Matrices", emphasized: false },
        { unit: otherUnit, title: "Eigenvalues", emphasized: true },
      ]),
    });
  });
});
