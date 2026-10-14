import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  InvalidSkillTitleError,
  SkillDetailsUnavailableError,
  SkillUnitMismatchError,
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
  const { skill } = await concept.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit });
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

describe("SkillMapping confirmed skill details", () => {
  test("renames and moves a skill while preserving versions, sources, prerequisites, and other records", async () => {
    const { owner, course, unit, skill, current: firstVersion } = await makeDraft();
    await mapping.reviseDraft({ ...content, owner, unit, skill, gate: "Explain incompatible dimensions." });
    await mapping.confirm({ owner, skill });
    const [record] = await mapping._skill({ skill });
    const target = await mapping.addUnit({ owner, course, title: "Matrix operations" });
    const prerequisite = await mapping.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit: target.unit, title: "Read matrix dimensions" });
    const dependent = await mapping.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit, title: "Compose linear maps" });
    await mapping.confirm({ owner, skill: prerequisite.skill });
    await mapping.confirm({ owner, skill: dependent.skill });
    // Seed valid prerequisite fixtures only in this test DB.
    const skills = connection!.db.collection<{ _id: string; prerequisites: string[] }>("SkillMapping.skills");
    await skills.updateOne({ _id: skill }, { $set: { prerequisites: [prerequisite.skill] } });
    await skills.updateOne({ _id: dependent.skill }, { $set: { prerequisites: [skill] } });
    await makeConfirmed();
    const before = await savedState();
    const title = "Multiply compatible matrices";

    expect(await mapping.editDetails({ owner, skill, unit: target.unit, title })).toEqual({});
    expect(await mapping._skill({ skill })).toEqual([{
      unit: target.unit, title, current: record!.current, status: "CONFIRMED",
    }]);
    expect((await mapping._skills({ unit })).some((row) => row.skill === skill)).toBe(false);
    expect((await mapping._skills({ unit: target.unit })).find((row) => row.skill === skill)?.title).toBe(title);
    expect(await mapping._version({ version: firstVersion })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await mapping._prerequisites({ skill })).toEqual([{ prerequisite: prerequisite.skill }]);
    expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([{ prerequisite: skill }]);
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === skill ? { ...row, unit: target.unit, title } : row),
      before[3],
    ]);
  });

  test("allows title-only edits, unit-only edits, and an unchanged request", async () => {
    const { owner, course, unit, skill, current } = await makeConfirmed();
    const title = "  Matrix products  ";
    await mapping.editDetails({ owner, skill, unit, title });
    expect(await mapping._skill({ skill })).toEqual([{ unit, title, current, status: "CONFIRMED" }]);

    const target = await mapping.addUnit({ owner, course, title: "Products" });
    await mapping.editDetails({ owner, skill, unit: target.unit, title });
    expect(await mapping._skill({ skill })).toEqual([{
      unit: target.unit, title, current, status: "CONFIRMED",
    }]);
    const before = await savedState();
    expect(await mapping.editDetails({ owner, skill, unit: target.unit, title })).toEqual({});
    expect(await savedState()).toEqual(before);
  });

  test("refuses foreign, missing, draft, and archived skills before other checks", async () => {
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
      const result = mapping.editDetails({ ...identity, unit: randomUUID(), title: "" });
      await expect(result).rejects.toBeInstanceOf(SkillDetailsUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_DETAILS_UNAVAILABLE",
        message: "Choose one of your confirmed skills.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses unknown units and every move to another course before checking the title", async () => {
    const { owner, skill } = await makeConfirmed();
    const ownCourse = await mapping.createCourse({ owner, title: "Mechanics" });
    const ownUnit = await mapping.addUnit({ owner, course: ownCourse.course, title: "Motion" });
    const foreign = await makeConfirmed();
    const before = await savedState();

    for (const unit of [ownUnit.unit, foreign.unit, randomUUID()]) {
      const result = mapping.editDetails({ owner, skill, unit, title: "" });
      await expect(result).rejects.toBeInstanceOf(SkillUnitMismatchError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_UNIT_MISMATCH",
        message: "Choose a unit in the skill's course.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses blank titles without changing saved records", async () => {
    const { owner, unit, skill } = await makeConfirmed();
    const before = await savedState();
    for (const title of ["", "   ", "\n\t", "\u00a0"]) {
      const result = mapping.editDetails({ owner, skill, unit, title });
      await expect(result).rejects.toBeInstanceOf(InvalidSkillTitleError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_SKILL_TITLE",
        message: "Enter a skill title.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("keeps the old title and unit when MongoDB rejects an edit", async () => {
    const instanceName = "DetailsFailure";
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, course, skill, current } = await makeConfirmed(concept);
    const target = await concept.addUnit({ owner, course, title: "Products" });
    const before = await savedState(instanceName);
    const edit = { owner, skill, unit: target.unit, title: "Matrix products" };
    await connection!.db.command({
      collMod: `${instanceName}.skills`,
      validator: { title: content.title },
      validationLevel: "strict",
      validationAction: "error",
    });
    try {
      const result = concept.editDetails(edit);
      await expect(result).rejects.toBeInstanceOf(MongoServerError);
      await expect(result).rejects.toMatchObject({ code: 121 });
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: `${instanceName}.skills`, validator: {} });
    }
    await concept.editDetails(edit);
    expect(await concept._skill({ skill })).toEqual([{
      unit: target.unit, title: edit.title, current, status: "CONFIRMED",
    }]);
  });

  test("concurrent edits save one complete title-and-unit pair and keep the version", async () => {
    const { owner, course, skill, current } = await makeConfirmed();
    const first = await mapping.addUnit({ owner, course, title: "Products" });
    const second = await mapping.addUnit({ owner, course, title: "Operations" });
    const edits = [
      { owner, skill, unit: first.unit, title: "Matrix products" },
      { owner, skill, unit: second.unit, title: "Matrix operations" },
    ];
    const before = await savedState();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await Promise.all([
        mapping.editDetails(edits[0]!), secondMapping.editDetails(edits[1]!),
      ])).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }
    const [record] = await mapping._skill({ skill });
    expect(edits.some((edit) => edit.unit === record!.unit && edit.title === record!.title)).toBe(true);
    expect(record!.current).toBe(current);
    expect(record!.status).toBe("CONFIRMED");
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === skill ? { ...row, unit: record!.unit, title: record!.title } : row),
      before[3],
    ]);
  });

  test("reads the new title and unit with the same requirements in another process", async () => {
    const { owner, course, skill, current } = await makeConfirmed();
    const target = await mapping.addUnit({ owner, course, title: "Products" });
    const title = "Matrix products";
    await mapping.editDetails({ owner, skill, unit: target.unit, title });
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
      unit: target.unit, title, current, status: "CONFIRMED",
      requirements: [{ skill, outcome: content.outcome, gate: content.gate }],
      materials: [{ material: "source-a" }, { material: "source-b" }],
      prerequisites: [],
    });
  });
});
