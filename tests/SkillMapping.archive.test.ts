import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  SkillArchiveUnavailableError,
  SkillStillRequiredError,
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

async function makeCourse(concept = mapping) {
  const owner = randomUUID();
  const { course } = await concept.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await concept.addUnit({ owner, course, title: "Matrices" });
  return { owner, course, unit };
}

async function makeSkill(owner: string, unit: string, concept = mapping) {
  const { skill } = await concept.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit });
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

describe("SkillMapping archive", () => {
  test("archives an owned skill while preserving its history, sources, links, and unrelated records", async () => {
    const { owner, unit } = await makeCourse();
    const target = await makeSkill(owner, unit);
    const foundation = await makeSkill(owner, unit);
    const revision = await mapping.reviseDefinition({
      ...content, owner, skill: target.skill, gate: "Explain why matrix order matters.",
    });
    await mapping.attachMaterial({ owner, skill: target.skill, material: "source-b" });
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [foundation.skill] });
    const foreign = await makeCourse();
    await makeSkill(foreign.owner, foreign.unit);
    const before = await savedState();

    expect(await mapping.archive({ owner, skill: target.skill })).toEqual({});
    expect(await mapping._skill({ skill: target.skill })).toEqual([{
      unit, title: content.title, current: revision.version, status: "ARCHIVED",
    }]);
    expect((await mapping._skills({ unit })).find((row) => row.skill === target.skill)?.status).toBe("ARCHIVED");
    expect(await mapping._version({ version: target.current })).toEqual([{
      skill: target.skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === target.skill ? { ...row, status: "ARCHIVED" } : row),
      before[3],
    ]);
  });

  test("refuses unknown, foreign, draft, and already archived skills without changing storage", async () => {
    const { owner, unit } = await makeCourse();
    const confirmed = await makeSkill(owner, unit);
    const draft = await mapping.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit });
    const archived = await makeSkill(owner, unit);
    await mapping.archive({ owner, skill: archived.skill });
    const before = await savedState("SkillMapping", true);

    for (const identity of [
      { owner, skill: randomUUID() },
      { owner: randomUUID(), skill: confirmed.skill },
      { owner, skill: draft.skill },
      { owner, skill: archived.skill },
    ]) {
      const result = mapping.archive(identity);
      await expect(result).rejects.toBeInstanceOf(SkillArchiveUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_ARCHIVE_UNAVAILABLE",
        message: "Choose one of your confirmed skills.",
      });
    }
    expect(await savedState("SkillMapping", true)).toEqual(before);
  });

  test("refuses while any confirmed skill requires it, including skills in another unit", async () => {
    const { owner, course, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const first = await makeSkill(owner, unit);
    const otherUnit = await mapping.addUnit({ owner, course, title: "Applications" });
    const second = await makeSkill(owner, otherUnit.unit);
    await mapping.setPrerequisites({ owner, skill: first.skill, prerequisites: [foundation.skill] });
    await mapping.setPrerequisites({ owner, skill: second.skill, prerequisites: [foundation.skill] });

    for (const dependent of [first, second]) {
      const before = await savedState("SkillMapping", true);
      const result = mapping.archive({ owner, skill: foundation.skill });
      await expect(result).rejects.toBeInstanceOf(SkillStillRequiredError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_STILL_REQUIRED",
        message: "Remove this skill from other active skills' prerequisites first.",
      });
      expect(await savedState("SkillMapping", true)).toEqual(before);
      await mapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [] });
    }
    expect(await mapping.archive({ owner, skill: foundation.skill })).toEqual({});
  });

  test("allows archival when only archived skills retain links to the prerequisite", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const dependent = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [foundation.skill] });
    await mapping.archive({ owner, skill: dependent.skill });
    expect(await mapping.archive({ owner, skill: foundation.skill })).toEqual({});
    expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([{ prerequisite: foundation.skill }]);
    for (const { skill, current } of [foundation, dependent]) {
      expect(await mapping._skill({ skill })).toEqual([{
        unit, title: content.title, current, status: "ARCHIVED",
      }]);
    }
  });

  test("refuses edits to an archived skill and new active links to it", async () => {
    const { owner, unit } = await makeCourse();
    const { skill } = await makeSkill(owner, unit);
    const active = await makeSkill(owner, unit);
    await mapping.archive({ owner, skill });
    const before = await savedState("SkillMapping", true);
    const requests: [() => Promise<unknown>, string][] = [
      [() => mapping.editDetails({ owner, skill, unit, title: "Matrix products" }), "SKILL_DETAILS_UNAVAILABLE"],
      [() => mapping.reviseDefinition({ ...content, owner, skill }), "SKILL_DEFINITION_UNAVAILABLE"],
      [() => mapping.attachMaterial({ owner, skill, material: "source-new" }), "SKILL_MATERIAL_UNAVAILABLE"],
      [() => mapping.setPrerequisites({ owner, skill, prerequisites: [] }), "SKILL_PREREQUISITES_UNAVAILABLE"],
      [() => mapping.setPrerequisites({ owner, skill: active.skill, prerequisites: [skill] }), "INVALID_SKILL_PREREQUISITES"],
    ];
    for (const [request, code] of requests) {
      await expect(request()).rejects.toMatchObject({ code });
    }
    expect(await savedState("SkillMapping", true)).toEqual(before);
  });

  for (const rejectedWrite of ["courses", "skills"] as const) {
    test(`rolls back all storage changes when MongoDB rejects the ${rejectedWrite} write`, async () => {
      const instanceName = `ArchiveFailure_${rejectedWrite}`;
      const concept = await createSkillMapping(connection!.db, instanceName);
      const { owner, unit } = await makeCourse(concept);
      const { skill } = await makeSkill(owner, unit, concept);
      const before = await savedState(instanceName, true);
      await connection!.db.command({
        collMod: `${instanceName}.${rejectedWrite}`,
        validator: { forceTestFailure: { $exists: true } },
        validationLevel: "strict",
        validationAction: "error",
      });
      try {
        const result = concept.archive({ owner, skill });
        await expect(result).rejects.toBeInstanceOf(MongoServerError);
        await expect(result).rejects.toMatchObject({ code: 121 });
        expect(await savedState(instanceName, true)).toEqual(before);
      } finally {
        await connection!.db.command({ collMod: `${instanceName}.${rejectedWrite}`, validator: {} });
      }
      expect(await concept.archive({ owner, skill })).toEqual({});
      expect((await concept._skill({ skill }))[0]!.status).toBe("ARCHIVED");
    });
  }

  test("two concurrent archive requests produce one success and one unavailable refusal", async () => {
    const { owner, unit } = await makeCourse();
    const { skill, current } = await makeSkill(owner, unit);
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.allSettled([
        mapping.archive({ owner, skill }), secondMapping.archive({ owner, skill }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toEqual([{ status: "fulfilled", value: {} }]);
      expect(results.find((result) => result.status === "rejected")?.reason)
        .toBeInstanceOf(SkillArchiveUnavailableError);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._skill({ skill })).toEqual([{
      unit, title: content.title, current, status: "ARCHIVED",
    }]);
  });

  test("a concurrent new prerequisite link cannot leave an active skill requiring an archived skill", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const dependent = await makeSkill(owner, unit);
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await withOverlappingSkillReads(database, [foundation.skill, dependent.skill], () => Promise.allSettled([
        mapping.archive({ owner, skill: foundation.skill }),
        secondMapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [foundation.skill] }),
      ]));
      if (results[0]!.status === "fulfilled") {
        expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "INVALID_SKILL_PREREQUISITES" } });
        expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("ARCHIVED");
        expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([]);
      } else {
        expect(results[0]).toMatchObject({ status: "rejected", reason: { code: "SKILL_STILL_REQUIRED" } });
        expect(results[1]).toEqual({ status: "fulfilled", value: {} });
        expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("CONFIRMED");
        expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([{ prerequisite: foundation.skill }]);
      }
      expect((await mapping._skill({ skill: dependent.skill }))[0]!.status).toBe("CONFIRMED");
    } finally {
      await secondConnection.client.close();
    }
  });

  test("an archive during prerequisite removal succeeds or remains safely retryable", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const dependent = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [foundation.skill] });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await withOverlappingSkillReads(database, [foundation.skill, dependent.skill], () => Promise.allSettled([
        mapping.archive({ owner, skill: foundation.skill }),
        secondMapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [] }),
      ]));
      expect(results[1]).toEqual({ status: "fulfilled", value: {} });
      expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([]);
      if (results[0]!.status === "rejected") {
        expect(results[0]).toMatchObject({ reason: { code: "SKILL_STILL_REQUIRED" } });
        expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("CONFIRMED");
        expect(await mapping.archive({ owner, skill: foundation.skill })).toEqual({});
      }
      expect((await mapping._skill({ skill: foundation.skill }))[0]!.status).toBe("ARCHIVED");
    } finally {
      await secondConnection.client.close();
    }
  });

  test("concurrent archives of linked skills preserve the prerequisite rule", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const dependent = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [foundation.skill] });
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await withOverlappingSkillReads(database, [foundation.skill, dependent.skill], () => Promise.allSettled([
        mapping.archive({ owner, skill: foundation.skill }),
        secondMapping.archive({ owner, skill: dependent.skill }),
      ]));
      expect(results[1]).toEqual({ status: "fulfilled", value: {} });
      expect((await mapping._skill({ skill: dependent.skill }))[0]!.status).toBe("ARCHIVED");
      if (results[0]!.status === "rejected") {
        expect(results[0]).toMatchObject({ reason: { code: "SKILL_STILL_REQUIRED" } });
      }
      expect((await mapping._skill({ skill: foundation.skill }))[0]!.status)
        .toBe(results[0]!.status === "fulfilled" ? "ARCHIVED" : "CONFIRMED");
      expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([{ prerequisite: foundation.skill }]);
    } finally {
      await secondConnection.client.close();
    }
  });

  test("reads an archived skill with its sources, prerequisites, and version history in another process", async () => {
    const { owner, unit } = await makeCourse();
    const { skill, current } = await makeSkill(owner, unit);
    const foundation = await makeSkill(owner, unit);
    const gate = "Explain why matrix order matters.";
    const revision = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate });
    await mapping.setPrerequisites({ owner, skill, prerequisites: [foundation.skill] });
    await mapping.archive({ owner, skill });
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
      unit, title: content.title, current: revision.version, status: "ARCHIVED",
      requirements: [{ skill, outcome: content.outcome, gate }],
      materials: [{ material: "source-a" }],
      prerequisites: [{ prerequisite: foundation.skill }],
      previousRequirements: [{ skill, outcome: content.outcome, gate: content.gate }],
    });
  });
});
