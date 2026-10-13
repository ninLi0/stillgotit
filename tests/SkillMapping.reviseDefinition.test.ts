import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  InvalidSkillDefinitionError,
  SkillDefinitionUnavailableError,
  SkillDefinitionUnchangedError,
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
  materials: ["source-b", "source-a"],
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
  const { skill } = await concept.propose({ ...content, owner, unit });
  const [record] = await concept._skill({ skill });
  return { owner, course, unit, skill, current: record!.current };
}

async function makeConfirmed(concept = mapping) {
  const draft = await makeDraft(concept);
  await concept.confirm({ owner: draft.owner, skill: draft.skill });
  return draft;
}

async function savedState(instanceName = "SkillMapping") {
  return Promise.all(["courses", "units", "skills", "versions"].map(
    (name) => connection!.db.collection(`${instanceName}.${name}`).find().sort({ _id: 1 }).toArray(),
  ));
}

async function versionCount(skill: string, instanceName = "SkillMapping") {
  return connection!.db.collection(`${instanceName}.versions`).countDocuments({ skill });
}

describe("SkillMapping requirements revision", () => {
  test.each(["outcome", "gate", "both"])("creates a new version when %s changes and preserves other state", async (field) => {
    const { owner, unit, skill, current } = await makeConfirmed();
    const prerequisite = await mapping.propose({ ...content, owner, unit, title: "Read matrix dimensions" });
    await mapping.confirm({ owner, skill: prerequisite.skill });
    // Seed a valid prerequisite fixture only in this test DB.
    await connection!.db.collection<{ _id: string; prerequisites: string[] }>("SkillMapping.skills")
      .updateOne({ _id: skill }, { $set: { prerequisites: [prerequisite.skill] } });
    await makeConfirmed();
    const before = await savedState();
    const outcome = field === "gate" ? content.outcome : " Explain how matrix multiplication combines linear maps. ";
    const gate = field === "outcome" ? content.gate : "Explain why reversing the order can change the result.";

    const result = await mapping.reviseDefinition({ owner, skill, outcome, gate });
    expect(result.previous).toBe(current);
    expect(result.version).not.toBe(current);
    expect(await mapping._skill({ skill })).toEqual([{
      unit, title: content.title, current: result.version, status: "CONFIRMED",
    }]);
    expect(await mapping._version({ version: result.previous })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await mapping._version({ version: result.version })).toEqual([{ skill, outcome, gate }]);
    expect(await mapping._prerequisites({ skill })).toEqual([{ prerequisite: prerequisite.skill }]);
    const after = await savedState();
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2));
    expect(after[2]).toEqual(before[2]!.map(
      (row) => String(row._id) === skill ? { ...row, current: result.version } : row,
    ));
    expect(after[3]!.filter((row) => String(row._id) !== result.version)).toEqual(before[3]);
    expect(after[3]!.length).toBe(before[3]!.length + 1);
  });

  test("keeps draft history and creates a fresh version when returning to earlier text", async () => {
    const { owner, unit, skill, current: firstVersion } = await makeDraft();
    const draftGate = "Explain incompatible dimensions.";
    await mapping.reviseDraft({ ...content, owner, unit, skill, gate: draftGate });
    const secondVersion = (await mapping._skill({ skill }))[0]!.current;
    await mapping.confirm({ owner, skill });
    const revisedGate = "Explain why reversing matrix order can change the result.";
    const firstRevision = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate: revisedGate });
    const secondRevision = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate: content.gate });

    expect(firstRevision.previous).toBe(secondVersion);
    expect(secondRevision.previous).toBe(firstRevision.version);
    expect(new Set([firstVersion, secondVersion, firstRevision.version, secondRevision.version]).size).toBe(4);
    for (const [version, gate] of [
      [firstVersion, content.gate], [secondVersion, draftGate],
      [firstRevision.version, revisedGate], [secondRevision.version, content.gate],
    ] as const) {
      expect(await mapping._version({ version })).toEqual([{ skill, outcome: content.outcome, gate }]);
    }
    expect((await mapping._skill({ skill }))[0]?.current).toBe(secondRevision.version);
    expect(await versionCount(skill)).toBe(4);
  });

  test("refuses foreign, missing, draft, and archived skills before checking text", async () => {
    const confirmed = await makeConfirmed();
    const draft = await makeDraft();
    const archived = await makeConfirmed();
    // Seed an archived fixture for this action's status checks.
    await connection!.db.collection<{ _id: string; status: string }>("SkillMapping.skills")
      .updateOne({ _id: archived.skill }, { $set: { status: "ARCHIVED" } });
    const before = await savedState();
    for (const identity of [
      { owner: randomUUID(), skill: confirmed.skill },
      { owner: confirmed.owner, skill: randomUUID() },
      { owner: draft.owner, skill: draft.skill },
      { owner: archived.owner, skill: archived.skill },
    ]) {
      const result = mapping.reviseDefinition({ ...identity, outcome: "", gate: "" });
      await expect(result).rejects.toBeInstanceOf(SkillDefinitionUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_DEFINITION_UNAVAILABLE",
        message: "Choose one of your confirmed skills.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses blank outcomes and gates without changing saved records", async () => {
    const { owner, skill } = await makeConfirmed();
    const before = await savedState();
    for (const blank of [{ outcome: "" }, { outcome: "\u00a0" }, { gate: "  " }, { gate: "\n\t" }]) {
      const result = mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate: content.gate, ...blank });
      await expect(result).rejects.toBeInstanceOf(InvalidSkillDefinitionError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_SKILL_DEFINITION",
        message: "Enter an outcome and demonstration requirements.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses unchanged requirements, including a repeat of a successful revision", async () => {
    const { owner, skill } = await makeConfirmed();
    for (const gate of [content.gate, "Explain every dimension in the product."]) {
      if (gate !== content.gate) {
        await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate });
      }
      const before = await savedState();
      const result = mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate });
      await expect(result).rejects.toBeInstanceOf(SkillDefinitionUnchangedError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_DEFINITION_UNCHANGED",
        message: "Change the outcome or requirements to create a new version.",
      });
      expect(await savedState()).toEqual(before);
    }
  });

  test.each(["versions", "skills"])("rolls back all changes if the %s write fails", async (collection) => {
    const instanceName = `DefinitionRollback_${collection}`;
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, skill, current } = await makeConfirmed(concept);
    const before = await savedState(instanceName);
    const revision = { owner, skill, outcome: content.outcome, gate: "Explain incompatible dimensions." };
    await connection!.db.command({
      collMod: `${instanceName}.${collection}`,
      validator: { $jsonSchema: { required: ["forceTestFailure"] } },
      validationLevel: "strict",
      validationAction: "error",
    });
    try {
      const result = concept.reviseDefinition(revision);
      await expect(result).rejects.toBeInstanceOf(MongoServerError);
      await expect(result).rejects.toMatchObject({ code: 121 });
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: `${instanceName}.${collection}`, validator: {} });
    }
    const result = await concept.reviseDefinition(revision);
    expect(result.previous).toBe(current);
    expect((await concept._skill({ skill }))[0]?.current).toBe(result.version);
    expect(await versionCount(skill, instanceName)).toBe(2);
  });

  test("concurrent identical revisions create one version and one unchanged refusal", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const revision = { owner, skill, outcome: content.outcome, gate: "Explain each dimension." };
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.allSettled([
        mapping.reviseDefinition(revision), secondMapping.reviseDefinition(revision),
      ]);
      const accepted = results.filter((result) => result.status === "fulfilled");
      const rejected = results.filter((result) => result.status === "rejected");
      expect(accepted).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(SkillDefinitionUnchangedError);
      expect(accepted[0]!.value.previous).toBe(current);
      expect((await mapping._skill({ skill }))[0]?.current).toBe(accepted[0]!.value.version);
    } finally {
      await secondConnection.client.close();
    }
    expect(await versionCount(skill)).toBe(2);
  });

  test("concurrent different revisions return the version each one actually replaces", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const revisions = [
      { owner, skill, outcome: "Explain matrix products as linear maps.", gate: "Explain order of composition." },
      { owner, skill, outcome: "Explain row-column products.", gate: "Solve two products and justify each entry." },
    ];
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.all([
        mapping.reviseDefinition(revisions[0]!), secondMapping.reviseDefinition(revisions[1]!),
      ]);
      const first = results.find((result) => result.previous === current);
      expect(first).toBeDefined();
      const second = results.find((result) => result.version !== first!.version);
      expect(second?.previous).toBe(first!.version);
      expect((await mapping._skill({ skill }))[0]?.current).toBe(second!.version);
      expect(new Set([current, ...results.map((result) => result.version)]).size).toBe(3);
      for (const [index, result] of results.entries()) {
        expect(await mapping._version({ version: result.version })).toEqual([{
          skill, outcome: revisions[index]!.outcome, gate: revisions[index]!.gate,
        }]);
      }
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._version({ version: current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await versionCount(skill)).toBe(3);
  });

  test("reads the current and earlier requirements in another process", async () => {
    const { owner, unit, skill, current } = await makeConfirmed();
    const gate = "Explain why reversing the order can change the result.";
    const result = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate });
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./fixtures/read-skill.ts", import.meta.url)),
      database, skill, current,
    ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      unit, title: content.title, current: result.version, status: "CONFIRMED",
      requirements: [{ skill, outcome: content.outcome, gate }],
      materials: [{ material: "source-a" }, { material: "source-b" }],
      prerequisites: [],
      previousRequirements: [{ skill, outcome: content.outcome, gate: content.gate }],
    });
  });
});
