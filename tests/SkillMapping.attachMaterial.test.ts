import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  SkillMaterialUnavailableError,
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

describe("SkillMapping material attachment", () => {
  test("adds a source while preserving requirements, prerequisites, and unrelated records", async () => {
    const { owner, unit, skill, current: firstVersion } = await makeConfirmed();
    const revision = await mapping.reviseDefinition({
      owner, skill, outcome: content.outcome, gate: "Explain why matrix order matters.",
    });
    const material = "source-new";
    const prerequisite = await mapping.propose({
      ...content, owner, unit, title: "Read matrix dimensions",
      materials: [...content.materials, material],
    });
    await mapping.confirm({ owner, skill: prerequisite.skill });
    // Seed a valid prerequisite fixture only in this test DB.
    await connection!.db.collection<{ _id: string; prerequisites: string[] }>("SkillMapping.skills")
      .updateOne({ _id: skill }, { $set: { prerequisites: [prerequisite.skill] } });
    await makeConfirmed();
    const before = await savedState();

    expect(await mapping.attachMaterial({ owner, skill, material })).toEqual({});
    expect(await mapping._skill({ skill })).toEqual([{
      unit, title: content.title, current: revision.version, status: "CONFIRMED",
    }]);
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-a" }, { material: "source-b" }, { material },
    ]);
    expect(await mapping._version({ version: firstVersion })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await mapping._version({ version: revision.version })).toEqual([{
      skill, outcome: content.outcome, gate: "Explain why matrix order matters.",
    }]);
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === skill
        ? { ...row, materials: [...row.materials, material] } : row),
      before[3],
    ]);
  });

  test("accepts an existing source and repeated requests without duplicates or other changes", async () => {
    const { owner, skill } = await makeConfirmed();
    const before = await savedState();
    expect(await mapping.attachMaterial({ owner, skill, material: "source-a" })).toEqual({});
    expect(await savedState()).toEqual(before);

    const request = { owner, skill, material: "source-new" };
    expect(await mapping.attachMaterial(request)).toEqual({});
    const once = await savedState();
    expect(await mapping.attachMaterial(request)).toEqual({});
    expect(await mapping.attachMaterial(request)).toEqual({});
    expect(await savedState()).toEqual(once);
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-a" }, { material: "source-b" }, { material: "source-new" },
    ]);
  });

  test("refuses foreign, missing, draft, and archived skills without changing state", async () => {
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
      const result = mapping.attachMaterial({ ...identity, material: "source-new" });
      await expect(result).rejects.toBeInstanceOf(SkillMaterialUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_MATERIAL_UNAVAILABLE",
        message: "Choose one of your confirmed skills.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("keeps the saved state when MongoDB rejects an attachment and allows a later retry", async () => {
    const instanceName = "MaterialFailure";
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, skill } = await makeConfirmed(concept);
    const before = await savedState(instanceName);
    const request = { owner, skill, material: "source-new" };
    await connection!.db.command({
      collMod: `${instanceName}.skills`,
      validator: { materials: { $nin: [request.material] } },
      validationLevel: "strict",
      validationAction: "error",
    });
    try {
      const result = concept.attachMaterial(request);
      await expect(result).rejects.toBeInstanceOf(MongoServerError);
      await expect(result).rejects.toMatchObject({ code: 121 });
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: `${instanceName}.skills`, validator: {} });
    }
    expect(await concept.attachMaterial(request)).toEqual({});
    expect(await concept._materials({ skill })).toEqual([
      { material: "source-a" }, { material: "source-b" }, { material: request.material },
    ]);
  });

  test("keeps both different sources when separate clients attach them at the same time", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await Promise.all([
        mapping.attachMaterial({ owner, skill, material: "source-c" }),
        secondMapping.attachMaterial({ owner, skill, material: "source-d" }),
      ])).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-a" }, { material: "source-b" },
      { material: "source-c" }, { material: "source-d" },
    ]);
    expect((await mapping._skill({ skill }))[0]!.current).toBe(current);
  });

  test("keeps one source link when separate clients attach the same source at the same time", async () => {
    const { owner, skill } = await makeConfirmed();
    const request = { owner, skill, material: "source-new" };
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await Promise.all([
        mapping.attachMaterial(request), secondMapping.attachMaterial(request),
      ])).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-a" }, { material: "source-b" }, { material: "source-new" },
    ]);
  });

  test("keeps an attachment and a requirements revision made at the same time", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const gate = "Explain why matrix order matters.";
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const [attachment, revision] = await Promise.all([
        mapping.attachMaterial({ owner, skill, material: "source-new" }),
        secondMapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate }),
      ]);
      expect(attachment).toEqual({});
      expect(revision.previous).toBe(current);
      expect(revision.version).not.toBe(current);
      expect((await mapping._skill({ skill }))[0]!.current).toBe(revision.version);
      expect(await mapping._version({ version: revision.version })).toEqual([{
        skill, outcome: content.outcome, gate,
      }]);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._materials({ skill })).toEqual([
      { material: "source-a" }, { material: "source-b" }, { material: "source-new" },
    ]);
    expect(await mapping._version({ version: current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
  });

  test("reads the attached source with unchanged requirements from another process", async () => {
    const { owner, unit, skill, current } = await makeConfirmed();
    await mapping.attachMaterial({ owner, skill, material: "source-new" });
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./fixtures/read-skill.ts", import.meta.url)),
      database, skill,
    ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      unit, title: content.title, current, status: "CONFIRMED",
      requirements: [{ skill, outcome: content.outcome, gate: content.gate }],
      materials: [{ material: "source-a" }, { material: "source-b" }, { material: "source-new" }],
      prerequisites: [],
    });
  });
});
