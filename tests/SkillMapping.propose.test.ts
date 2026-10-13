import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  InvalidSkillProposalError,
  ProposalUnitUnavailableError,
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

async function ownedUnit(concept = mapping) {
  const owner = randomUUID();
  const { course } = await concept.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await concept.addUnit({ owner, course, title: "Matrices" });
  return { owner, course, unit };
}

async function savedState(instanceName = "SkillMapping") {
  return Promise.all(["courses", "units", "skills", "versions"].map(
    (name) => connection!.db.collection(`${instanceName}.${name}`).find().sort({ _id: 1 }).toArray(),
  ));
}

describe("SkillMapping proposals", () => {
  test("creates a draft linked to its first requirements version", async () => {
    const { owner, course, unit } = await ownedUnit();
    const beforeCourse = await mapping._course({ course });
    const beforeUnit = await mapping._unit({ unit });
    const { skill } = await mapping.propose({ owner, unit, ...content });
    const [record] = await mapping._skill({ skill });

    expect(record).toEqual({
      unit,
      title: content.title,
      current: expect.any(String),
      status: "DRAFT",
    });
    expect(await mapping._version({ version: record!.current })).toEqual([{
      skill,
      outcome: content.outcome,
      gate: content.gate,
    }]);
    expect(await mapping._skills({ unit })).toEqual([{
      skill,
      title: content.title,
      current: record!.current,
      status: "DRAFT",
    }]);
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-a" },
      { material: "source-b" },
    ]);
    expect(await mapping._prerequisites({ skill })).toEqual([]);
    expect(await mapping._course({ course })).toEqual(beforeCourse);
    expect(await mapping._unit({ unit })).toEqual(beforeUnit);
  });

  test("allows a draft with no source references", async () => {
    const { owner, unit } = await ownedUnit();
    const { skill } = await mapping.propose({ owner, unit, ...content, materials: [] });

    expect((await mapping._skill({ skill }))[0]?.status).toBe("DRAFT");
    expect(await mapping._materials({ skill })).toEqual([]);
  });

  test("refuses another learner's unit and unknown units before checking text", async () => {
    const { owner, unit } = await ownedUnit();
    await mapping.propose({ owner, unit, ...content });
    const otherOwner = randomUUID();
    const before = await savedState();

    for (const target of [unit, randomUUID()]) {
      for (const title of [content.title, ""]) {
        const result = mapping.propose({
          ...content, owner: otherOwner, unit: target, title,
        });
        await expect(result).rejects.toBeInstanceOf(ProposalUnitUnavailableError);
        await expect(result).rejects.toMatchObject({
          code: "PROPOSAL_UNIT_UNAVAILABLE",
          message: "Choose a unit in one of your courses.",
        });
      }
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses blank titles, outcomes, or gates without changing any records", async () => {
    const { owner, unit } = await ownedUnit();
    await mapping.propose({ owner, unit, ...content });
    const before = await savedState();

    for (const blank of [{ title: "" }, { title: "\u00a0" }, { outcome: "   " }, { gate: "\n\t" }]) {
      const result = mapping.propose({ owner, unit, ...content, ...blank });
      await expect(result).rejects.toBeInstanceOf(InvalidSkillProposalError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_SKILL_PROPOSAL",
        message: "Enter a skill title, outcome, and demonstration requirements.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("keeps draft identities and versions separate and lists only the requested unit", async () => {
    const { owner, course, unit } = await ownedUnit();
    const first = await mapping.propose({ owner, unit, ...content });
    const [firstRecord] = await mapping._skill({ skill: first.skill });
    const firstVersion = await mapping._version({ version: firstRecord!.current });
    const second = await mapping.propose({
      owner, unit, ...content, outcome: "Explain which matrix dimensions are compatible.",
    });
    const [secondRecord] = await mapping._skill({ skill: second.skill });

    const otherUnit = await mapping.addUnit({ owner, course, title: "Vectors" });
    const otherSkill = await mapping.propose({ owner, unit: otherUnit.unit, ...content });
    const otherLearner = await ownedUnit();
    const otherLearnerSkill = await mapping.propose({ ...otherLearner, ...content });

    expect(first.skill).not.toBe(second.skill);
    expect(firstRecord!.current).not.toBe(secondRecord!.current);
    expect(await mapping._version({ version: firstRecord!.current })).toEqual(firstVersion);
    expect(await mapping._version({ version: secondRecord!.current })).toEqual([{
      skill: second.skill,
      outcome: "Explain which matrix dimensions are compatible.",
      gate: content.gate,
    }]);
    const expected = [
      { skill: first.skill, title: content.title, current: firstRecord!.current, status: "DRAFT" as const },
      { skill: second.skill, title: content.title, current: secondRecord!.current, status: "DRAFT" as const },
    ].sort((a, b) => (a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0));
    expect(await mapping._skills({ unit })).toEqual(expected);
    expect((await mapping._skills({ unit: otherUnit.unit })).map((row) => row.skill))
      .toEqual([otherSkill.skill]);
    expect((await mapping._skills({ unit: otherLearner.unit })).map((row) => row.skill))
      .toEqual([otherLearnerSkill.skill]);
  });

  test("returns no rows for an empty unit or missing skill, version, or unit", async () => {
    const { unit } = await ownedUnit();
    const unknown = randomUUID();

    expect(await mapping._skills({ unit })).toEqual([]);
    expect(await mapping._skills({ unit: unknown })).toEqual([]);
    expect(await mapping._skill({ skill: unknown })).toEqual([]);
    expect(await mapping._materials({ skill: unknown })).toEqual([]);
    expect(await mapping._prerequisites({ skill: unknown })).toEqual([]);
    expect(await mapping._version({ version: unknown })).toEqual([]);
  });

  test("rolls back the skill when its version write fails, then allows a fresh proposal", async () => {
    // Fault injection is limited to this test namespace in this generated database.
    const instanceName = "RollbackSkillMapping";
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, unit } = await ownedUnit(concept);
    await concept.propose({ owner, unit, ...content });
    const before = await savedState(instanceName);
    await connection!.db.command({
      collMod: `${instanceName}.versions`,
      validator: { $jsonSchema: { required: ["forceTestFailure"] } },
      validationLevel: "strict",
      validationAction: "error",
    });

    const result = concept.propose({ owner, unit, ...content });
    await expect(result).rejects.toBeInstanceOf(MongoServerError);
    await expect(result).rejects.toMatchObject({ code: 121 });
    expect(await savedState(instanceName)).toEqual(before);

    await connection!.db.command({ collMod: `${instanceName}.versions`, validator: {} });
    const { skill } = await concept.propose({ owner, unit, ...content });
    const [record] = await concept._skill({ skill });
    expect(await concept._version({ version: record!.current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await concept._skills({ unit })).toHaveLength(2);
  });

  test("reads the draft and its requirements from another Bun process", async () => {
    const { owner, unit } = await ownedUnit();
    const { skill } = await mapping.propose({ owner, unit, ...content });
    const [record] = await mapping._skill({ skill });
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./fixtures/read-skill.ts", import.meta.url)),
      database,
      skill,
    ], {
      env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      ...record,
      requirements: [{ skill, outcome: content.outcome, gate: content.gate }],
      materials: [{ material: "source-a" }, { material: "source-b" }],
      prerequisites: [],
    });
  });
});
