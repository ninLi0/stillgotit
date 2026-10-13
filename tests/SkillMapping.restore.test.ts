import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  SkillRestorePrerequisitesError,
  SkillRestoreUnavailableError,
  type SkillMapping,
} from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { withOverlappingSkillReads } from "./fixtures/overlap-skill-reads.ts";

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

afterAll(async () => {
  if (!connection) return;
  try {
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

async function makeCourse(concept = mapping, owner = randomUUID()) {
  const { course } = await concept.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await concept.addUnit({ owner, course, title: "Matrices" });
  return { owner, course, unit };
}

async function makeSkill(owner: string, unit: string, concept = mapping) {
  const { skill } = await concept.propose({ ...content, owner, unit });
  await concept.confirm({ owner, skill });
  const [record] = await concept._skill({ skill });
  return { skill, current: record!.current };
}

async function savedState(instanceName = "SkillMapping", includeLock = false) {
  return Promise.all(["courses", "units", "skills", "versions"].map((name) => {
    // Domain comparisons omit internal metadata. Rollback checks include it.
    const options = name === "courses" && !includeLock
      ? { projection: { prerequisiteLock: 0 } } : {};
    return connection!.db.collection(`${instanceName}.${name}`).find({}, options).sort({ _id: 1 }).toArray();
  }));
}

describe("SkillMapping restore", () => {
  test("restores a skill with no prerequisites and preserves all other domain state", async () => {
    const { owner, unit } = await makeCourse();
    const { skill, current } = await makeSkill(owner, unit);
    const revision = await mapping.reviseDefinition({
      ...content, owner, skill, gate: "Explain why matrix order matters.",
    });
    await mapping.attachMaterial({ owner, skill, material: "source-b" });
    await mapping.archive({ owner, skill });
    const foreign = await makeCourse();
    await makeSkill(foreign.owner, foreign.unit);
    const before = await savedState();

    expect(await mapping.restore({ owner, skill })).toEqual({});
    expect(await mapping._skill({ skill })).toEqual([{
      unit, title: content.title, current: revision.version, status: "CONFIRMED",
    }]);
    expect((await mapping._skills({ unit })).find((row) => row.skill === skill)?.status).toBe("CONFIRMED");
    expect(await mapping._version({ version: current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === skill ? { ...row, status: "CONFIRMED" } : row),
      before[3],
    ]);
  });

  test("accepts confirmed prerequisites across units and shared foundations without restoring dependents", async () => {
    const { owner, course, unit } = await makeCourse();
    const otherUnit = await mapping.addUnit({ owner, course, title: "Foundations" });
    const foundation = await makeSkill(owner, otherUnit.unit);
    const left = await makeSkill(owner, unit);
    const right = await makeSkill(owner, otherUnit.unit);
    const target = await makeSkill(owner, unit);
    const dependent = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: left.skill, prerequisites: [foundation.skill] });
    await mapping.setPrerequisites({ owner, skill: right.skill, prerequisites: [foundation.skill] });
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [left.skill, right.skill] });
    await mapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [target.skill] });
    await mapping.archive({ owner, skill: dependent.skill });
    await mapping.archive({ owner, skill: target.skill });
    const before = await savedState();

    expect(await mapping.restore({ owner, skill: target.skill })).toEqual({});
    expect((await mapping._skill({ skill: dependent.skill }))[0]!.status).toBe("ARCHIVED");
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === target.skill ? { ...row, status: "CONFIRMED" } : row),
      before[3],
    ]);
  });

  test("refuses unknown, foreign, draft, and already confirmed skills before prerequisite checks", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const archived = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: archived.skill, prerequisites: [foundation.skill] });
    await mapping.archive({ owner, skill: archived.skill });
    await mapping.archive({ owner, skill: foundation.skill });
    const draft = await mapping.propose({ ...content, owner, unit });
    const confirmed = await makeSkill(owner, unit);
    const restored = await makeSkill(owner, unit);
    await mapping.archive({ owner, skill: restored.skill });
    await mapping.restore({ owner, skill: restored.skill });
    const before = await savedState("SkillMapping", true);

    for (const identity of [
      { owner, skill: randomUUID() },
      { owner: randomUUID(), skill: archived.skill },
      { owner, skill: draft.skill },
      { owner, skill: confirmed.skill },
      { owner, skill: restored.skill },
    ]) {
      const result = mapping.restore(identity);
      await expect(result).rejects.toBeInstanceOf(SkillRestoreUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_RESTORE_UNAVAILABLE",
        message: "Choose one of your archived skills.",
      });
    }
    expect(await savedState("SkillMapping", true)).toEqual(before);
  });

  test("requires restoring an archived prerequisite chain from the foundation upward", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const middle = await makeSkill(owner, unit);
    const target = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: middle.skill, prerequisites: [foundation.skill] });
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [middle.skill] });
    for (const { skill } of [target, middle, foundation]) await mapping.archive({ owner, skill });

    for (const { skill } of [target, middle]) {
      const before = await savedState("SkillMapping", true);
      const result = mapping.restore({ owner, skill });
      await expect(result).rejects.toBeInstanceOf(SkillRestorePrerequisitesError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_RESTORE_PREREQUISITES",
        message: "Restore this skill's prerequisites before restoring the skill.",
      });
      expect(await savedState("SkillMapping", true)).toEqual(before);
    }
    expect(await mapping.restore({ owner, skill: foundation.skill })).toEqual({});
    expect((await mapping._skill({ skill: middle.skill }))[0]!.status).toBe("ARCHIVED");
    await expect(mapping.restore({ owner, skill: target.skill })).rejects.toBeInstanceOf(SkillRestorePrerequisitesError);
    expect(await mapping.restore({ owner, skill: middle.skill })).toEqual({});
    expect(await mapping.restore({ owner, skill: target.skill })).toEqual({});
    for (const { skill, current } of [foundation, middle, target]) {
      expect(await mapping._skill({ skill })).toEqual([{
        unit, title: content.title, current, status: "CONFIRMED",
      }]);
    }
  });

  test("refuses invalid saved references, self-dependencies, and chains back to the target", async () => {
    const { owner, unit } = await makeCourse();
    const target = await makeSkill(owner, unit);
    const valid = await makeSkill(owner, unit);
    const draft = await mapping.propose({ ...content, owner, unit });
    const ownOtherCourse = await makeCourse(mapping, owner);
    const ownOtherSkill = await makeSkill(owner, ownOtherCourse.unit);
    const foreign = await makeCourse();
    const foreignSkill = await makeSkill(foreign.owner, foreign.unit);
    const cycle = await makeSkill(owner, unit);
    await mapping.archive({ owner, skill: target.skill });
    const skills = connection!.db.collection<{ _id: string; prerequisites: string[] }>("SkillMapping.skills");
    // These invalid links cannot be created through the actions. Seed them
    // only in this test DB to ensure restoration refuses these links.
    await skills.updateOne({ _id: cycle.skill }, { $set: { prerequisites: [target.skill] } });
    try {
      for (const invalid of [randomUUID(), draft.skill, ownOtherSkill.skill, foreignSkill.skill, target.skill, cycle.skill]) {
        await skills.updateOne({ _id: target.skill }, { $set: { prerequisites: [valid.skill, invalid] } });
        const before = await savedState("SkillMapping", true);
        await expect(mapping.restore({ owner, skill: target.skill })).rejects.toMatchObject({
          code: "SKILL_RESTORE_PREREQUISITES",
          message: "Restore this skill's prerequisites before restoring the skill.",
        });
        expect(await savedState("SkillMapping", true)).toEqual(before);
      }
    } finally {
      await skills.updateOne({ _id: target.skill }, { $set: { prerequisites: [] } });
      await skills.updateOne({ _id: cycle.skill }, { $set: { prerequisites: [] } });
    }
  });

  for (const rejectedWrite of ["courses", "skills"] as const) {
    test(`rolls back all storage changes when MongoDB rejects the ${rejectedWrite} write`, async () => {
      const instanceName = `RestoreFailure_${rejectedWrite}`;
      const concept = await createSkillMapping(connection!.db, instanceName);
      const { owner, unit } = await makeCourse(concept);
      const { skill } = await makeSkill(owner, unit, concept);
      await concept.archive({ owner, skill });
      const before = await savedState(instanceName, true);
      await connection!.db.command({
        collMod: `${instanceName}.${rejectedWrite}`,
        validator: { forceTestFailure: { $exists: true } },
        validationLevel: "strict",
        validationAction: "error",
      });
      try {
        const result = concept.restore({ owner, skill });
        await expect(result).rejects.toBeInstanceOf(MongoServerError);
        await expect(result).rejects.toMatchObject({ code: 121 });
        expect(await savedState(instanceName, true)).toEqual(before);
      } finally {
        await connection!.db.command({ collMod: `${instanceName}.${rejectedWrite}`, validator: {} });
      }
      expect(await concept.restore({ owner, skill })).toEqual({});
      expect((await concept._skill({ skill }))[0]!.status).toBe("CONFIRMED");
    });
  }

  test("two concurrent restores produce one success and one unavailable refusal", async () => {
    const { owner, unit } = await makeCourse();
    const { skill, current } = await makeSkill(owner, unit);
    await mapping.archive({ owner, skill });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.allSettled([
        mapping.restore({ owner, skill }), secondMapping.restore({ owner, skill }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toEqual([{ status: "fulfilled", value: {} }]);
      expect(results.find((result) => result.status === "rejected")?.reason)
        .toBeInstanceOf(SkillRestoreUnavailableError);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._skill({ skill })).toEqual([{
      unit, title: content.title, current, status: "CONFIRMED",
    }]);
  });

  test("restoration and prerequisite archival cannot leave an active skill requiring an archived skill", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const target = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [foundation.skill] });
    await mapping.archive({ owner, skill: target.skill });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await withOverlappingSkillReads(database, [target.skill, foundation.skill], () => Promise.allSettled([
        mapping.restore({ owner, skill: target.skill }),
        secondMapping.archive({ owner, skill: foundation.skill }),
      ]));
      if (results[0]!.status === "fulfilled") {
        expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "SKILL_STILL_REQUIRED" } });
        expect((await mapping._skill({ skill: target.skill }))[0]!.status).toBe("CONFIRMED");
        expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("CONFIRMED");
      } else {
        expect(results[0]).toMatchObject({ status: "rejected", reason: { code: "SKILL_RESTORE_PREREQUISITES" } });
        expect(results[1]).toEqual({ status: "fulfilled", value: {} });
        expect((await mapping._skill({ skill: target.skill }))[0]!.status).toBe("ARCHIVED");
        expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("ARCHIVED");
      }
      expect(await mapping._prerequisites({ skill: target.skill })).toEqual([{ prerequisite: foundation.skill }]);
    } finally {
      await secondConnection.client.close();
    }
  });

  test("a restore during prerequisite restoration succeeds or can be retried afterward", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const target = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [foundation.skill] });
    await mapping.archive({ owner, skill: target.skill });
    await mapping.archive({ owner, skill: foundation.skill });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await withOverlappingSkillReads(database, [target.skill, foundation.skill], () => Promise.allSettled([
        mapping.restore({ owner, skill: target.skill }),
        secondMapping.restore({ owner, skill: foundation.skill }),
      ]));
      expect(results[1]).toEqual({ status: "fulfilled", value: {} });
      expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("CONFIRMED");
      if (results[0]!.status === "rejected") {
        expect(results[0]).toMatchObject({ reason: { code: "SKILL_RESTORE_PREREQUISITES" } });
        expect((await mapping._skill({ skill: target.skill }))[0]!.status).toBe("ARCHIVED");
        expect(await mapping.restore({ owner, skill: target.skill })).toEqual({});
      }
      expect((await mapping._skill({ skill: target.skill }))[0]!.status).toBe("CONFIRMED");
    } finally {
      await secondConnection.client.close();
    }
  });

  test("keeps both valid restores made to independent skills in the same course", async () => {
    const { owner, unit } = await makeCourse();
    const first = await makeSkill(owner, unit);
    const second = await makeSkill(owner, unit);
    await mapping.archive({ owner, skill: first.skill });
    await mapping.archive({ owner, skill: second.skill });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await withOverlappingSkillReads(database, [first.skill, second.skill], () => Promise.all([
        mapping.restore({ owner, skill: first.skill }),
        secondMapping.restore({ owner, skill: second.skill }),
      ]))).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }
    for (const { skill, current } of [first, second]) {
      expect(await mapping._skill({ skill })).toEqual([{
        unit, title: content.title, current, status: "CONFIRMED",
      }]);
    }
  });

  test("reads the restored skill and its unchanged version history from another process", async () => {
    const { owner, unit } = await makeCourse();
    const { skill, current } = await makeSkill(owner, unit);
    const foundation = await makeSkill(owner, unit);
    const gate = "Explain why matrix order matters.";
    const revision = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate });
    await mapping.setPrerequisites({ owner, skill, prerequisites: [foundation.skill] });
    await mapping.archive({ owner, skill });
    await mapping.restore({ owner, skill });
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
      unit, title: content.title, current: revision.version, status: "CONFIRMED",
      requirements: [{ skill, outcome: content.outcome, gate }],
      materials: [{ material: "source-a" }],
      prerequisites: [{ prerequisite: foundation.skill }],
      previousRequirements: [{ skill, outcome: content.outcome, gate: content.gate }],
    });
  });
});
