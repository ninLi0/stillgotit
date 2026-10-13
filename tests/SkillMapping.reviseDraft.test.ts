import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  DraftRevisionUnavailableError,
  DraftUnitMismatchError,
  InvalidDraftContentError,
  type SkillMapping,
} from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;
let mapping: SkillMapping;

const content = {
  title: "Multiply matrices",
  outcome: "Multiply compatible matrices and explain each entry.",
  gate: "Solve two fresh problems without hints and explain each step.",
  materials: ["source-b", "source-a", "source-b"],
};

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
  mapping = await createSkillMapping(connection.db);
});

afterAll(async () => {
  if (!connection) return;
  try {
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

async function makeDraft(concept = mapping) {
  const owner = randomUUID();
  const { course } = await concept.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await concept.addUnit({ owner, course, title: "Matrices" });
  const { skill } = await concept.propose({ owner, unit, ...content });
  const [record] = await concept._skill({ skill });
  return { owner, course, unit, skill, current: record!.current };
}

async function savedState(instanceName = "SkillMapping") {
  return Promise.all(["courses", "units", "skills", "versions"].map(
    (name) => connection!.db.collection(`${instanceName}.${name}`).find().sort({ _id: 1 }).toArray(),
  ));
}

async function versionCount(skill: string, instanceName = "SkillMapping") {
  return connection!.db.collection(`${instanceName}.versions`).countDocuments({ skill });
}

describe("SkillMapping draft revision", () => {
  test("edits the title, unit, and sources while keeping the requirements version", async () => {
    const { owner, course, unit, skill, current } = await makeDraft();
    const target = await mapping.addUnit({ owner, course, title: "Matrix operations" });
    const beforeVersion = await mapping._version({ version: current });
    const title = "Multiply compatible matrices";

    expect(await mapping.reviseDraft({
      ...content, owner, skill, unit: target.unit, title,
      materials: ["source-z", "source-c", "source-z"],
    })).toEqual({});

    expect(await mapping._skill({ skill })).toEqual([{
      unit: target.unit, title, current, status: "DRAFT",
    }]);
    expect(await mapping._skills({ unit })).toEqual([]);
    expect(await mapping._skills({ unit: target.unit })).toEqual([{
      skill, title, current, status: "DRAFT",
    }]);
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-c" }, { material: "source-z" },
    ]);
    expect(await mapping._prerequisites({ skill })).toEqual([]);
    expect(await mapping._version({ version: current })).toEqual(beforeVersion);
    expect(await versionCount(skill)).toBe(1);
  });

  test("accepts an unchanged draft and permits clearing sources without a new version", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    const before = await savedState();
    expect(await mapping.reviseDraft({ ...content, owner, skill, unit })).toEqual({});
    expect(await savedState()).toEqual(before);

    await mapping.reviseDraft({ ...content, owner, skill, unit, materials: [] });
    expect(await mapping._materials({ skill })).toEqual([]);
    expect((await mapping._skill({ skill }))[0]?.current).toBe(current);
    expect(await versionCount(skill)).toBe(1);
  });

  test.each(["outcome", "gate"] as const)("creates a new version when only the %s changes", async (field) => {
    const { owner, unit, skill, current } = await makeDraft();
    const previous = await mapping._version({ version: current });
    const revised = { ...content, [field]: `${content[field]} Explain the dimensions.` };

    expect(await mapping.reviseDraft({ ...revised, owner, skill, unit })).toEqual({});
    const [record] = await mapping._skill({ skill });
    expect(record!.current).not.toBe(current);
    expect(record!.status).toBe("DRAFT");
    expect(await mapping._version({ version: record!.current })).toEqual([{
      skill, outcome: revised.outcome, gate: revised.gate,
    }]);
    expect(await mapping._version({ version: current })).toEqual(previous);
    expect(await versionCount(skill)).toBe(2);
  });

  test("keeps history when the learner changes requirements back to earlier text", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    const gate = `${content.gate} Explain incompatible dimensions.`;
    await mapping.reviseDraft({ ...content, owner, skill, unit, gate });
    const [middle] = await mapping._skill({ skill });
    await mapping.reviseDraft({ ...content, owner, skill, unit });
    const [latest] = await mapping._skill({ skill });

    expect(new Set([current, middle!.current, latest!.current]).size).toBe(3);
    expect(await mapping._version({ version: current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await mapping._version({ version: middle!.current })).toEqual([{
      skill, outcome: content.outcome, gate,
    }]);
    expect(await mapping._version({ version: latest!.current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await versionCount(skill)).toBe(3);
  });

  test("refuses foreign, missing, confirmed, and archived skills before other checks", async () => {
    const draft = await makeDraft();
    const cases = [
      { owner: randomUUID(), skill: draft.skill },
      { owner: draft.owner, skill: randomUUID() },
    ];
    for (const status of ["CONFIRMED", "ARCHIVED"] as const) {
      const example = await makeDraft();
      await mapping.confirm({ owner: example.owner, skill: example.skill });
      if (status === "ARCHIVED") {
        // Seed an archived fixture for this action's status checks.
        await connection!.db.collection<{ _id: string; status: string }>("SkillMapping.skills")
          .updateOne({ _id: example.skill }, { $set: { status } });
      }
      cases.push({ owner: example.owner, skill: example.skill });
    }
    const before = await savedState();

    for (const identity of cases) {
      const result = mapping.reviseDraft({
        ...content, ...identity, unit: randomUUID(), title: "",
      });
      await expect(result).rejects.toBeInstanceOf(DraftRevisionUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "DRAFT_REVISION_UNAVAILABLE",
        message: "Choose one of your draft skills.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses unknown units and moves to any other course before checking text", async () => {
    const { owner, unit, skill } = await makeDraft();
    const otherCourse = await mapping.createCourse({ owner, title: "Mechanics" });
    const ownOtherUnit = await mapping.addUnit({ owner, course: otherCourse.course, title: "Motion" });
    const otherLearner = await makeDraft();
    const before = await savedState();

    for (const target of [ownOtherUnit.unit, otherLearner.unit, randomUUID()]) {
      const result = mapping.reviseDraft({ ...content, owner, skill, unit: target, gate: "" });
      await expect(result).rejects.toBeInstanceOf(DraftUnitMismatchError);
      await expect(result).rejects.toMatchObject({
        code: "DRAFT_UNIT_MISMATCH",
        message: "Choose a unit in the skill's course.",
      });
    }
    expect(await savedState()).toEqual(before);
    expect((await mapping._skill({ skill }))[0]?.unit).toBe(unit);
  });

  test("refuses blank titles, outcomes, or gates without changing saved state", async () => {
    const { owner, unit, skill } = await makeDraft();
    const before = await savedState();

    for (const blank of [{ title: "" }, { title: "\u00a0" }, { outcome: "   " }, { gate: "\n\t" }]) {
      const result = mapping.reviseDraft({ ...content, owner, skill, unit, ...blank });
      await expect(result).rejects.toBeInstanceOf(InvalidDraftContentError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_DRAFT_CONTENT",
        message: "Enter a skill title, outcome, and demonstration requirements.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test.each(["versions", "skills"])("rolls back all edits if the %s write fails", async (collection) => {
    const instanceName = `RevisionRollback_${collection}`;
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, unit, skill, current } = await makeDraft(concept);
    const before = await savedState(instanceName);
    const revised = { ...content, owner, skill, unit, title: "Edited title", gate: "Explain every dimension." };

    // Reject writes only in this test namespace within this generated database.
    await connection!.db.command({
      collMod: `${instanceName}.${collection}`,
      validator: { $jsonSchema: { required: ["forceTestFailure"] } },
      validationLevel: "strict",
      validationAction: "error",
    });
    const result = concept.reviseDraft(revised);
    await expect(result).rejects.toBeInstanceOf(MongoServerError);
    await expect(result).rejects.toMatchObject({ code: 121 });
    expect(await savedState(instanceName)).toEqual(before);

    await connection!.db.command({ collMod: `${instanceName}.${collection}`, validator: {} });
    await concept.reviseDraft(revised);
    const [record] = await concept._skill({ skill });
    expect(record!.title).toBe(revised.title);
    expect(record!.current).not.toBe(current);
    expect(await versionCount(skill, instanceName)).toBe(2);
  });

  test("concurrent identical edits from two clients create one new version", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    const revised = { ...content, owner, skill, unit, gate: "Solve two problems and explain each dimension." };
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.all([
        mapping.reviseDraft(revised),
        secondMapping.reviseDraft(revised),
      ]);
      expect(results).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }

    const [record] = await mapping._skill({ skill });
    expect(record!.current).not.toBe(current);
    expect(await mapping._version({ version: record!.current })).toEqual([{
      skill, outcome: content.outcome, gate: revised.gate,
    }]);
    expect(await mapping._version({ version: current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await versionCount(skill)).toBe(2);
  });

  test("reads the edited draft and its earlier requirements in another process", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    const gate = "Solve two fresh problems and explain incompatible dimensions.";
    await mapping.reviseDraft({ ...content, owner, skill, unit, gate, title: "Revised matrix skill" });
    const [record] = await mapping._skill({ skill });
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./fixtures/read-skill.ts", import.meta.url)),
      database,
      skill,
      current,
    ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      ...record,
      requirements: [{ skill, outcome: content.outcome, gate }],
      materials: [{ material: "source-a" }, { material: "source-b" }],
      prerequisites: [],
      previousRequirements: [{ skill, outcome: content.outcome, gate: content.gate }],
    });
  });
});
