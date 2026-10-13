import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  InvalidSkillPrerequisitesError,
  SkillPrerequisitesUnavailableError,
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
    // Domain-state comparisons omit the internal transaction marker.
    // Rollback checks include it so a leaked lock write cannot pass.
    const options = name === "courses" && !includeLock
      ? { projection: { prerequisiteLock: 0 } } : {};
    return connection!.db.collection(`${instanceName}.${name}`).find({}, options).sort({ _id: 1 }).toArray();
  }));
}

describe("SkillMapping prerequisites", () => {
  test("sets unique confirmed prerequisites across course units and preserves other domain state", async () => {
    const { owner, course, unit } = await makeCourse();
    const target = await makeSkill(owner, unit);
    await mapping.reviseDefinition({ ...content, owner, skill: target.skill, gate: "Explain why matrix order matters." });
    const first = await makeSkill(owner, unit);
    const otherUnit = await mapping.addUnit({ owner, course, title: "Foundations" });
    const second = await makeSkill(owner, otherUnit.unit);
    const dependent = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: dependent.skill, prerequisites: [target.skill] });
    const foreign = await makeCourse();
    await makeSkill(foreign.owner, foreign.unit);
    const before = await savedState();
    const prerequisites = [first.skill, second.skill].sort();

    expect(await mapping.setPrerequisites({
      owner, skill: target.skill, prerequisites: [second.skill, first.skill, second.skill],
    })).toEqual({});
    expect(await mapping._prerequisites({ skill: target.skill })).toEqual(
      prerequisites.map((prerequisite) => ({ prerequisite })),
    );
    expect(await mapping._prerequisites({ skill: dependent.skill })).toEqual([{ prerequisite: target.skill }]);
    expect(await mapping._course({ course })).toEqual([{ owner, title: "Linear Algebra" }]);
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.map((row) => String(row._id) === target.skill ? { ...row, prerequisites } : row),
      before[3],
    ]);
  });

  test("replaces the full set, accepts reordered repeats, and clears it with an empty set", async () => {
    const { owner, unit } = await makeCourse();
    const target = await makeSkill(owner, unit);
    const first = await makeSkill(owner, unit);
    const second = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [first.skill, second.skill] });
    const before = await savedState();
    expect(await mapping.setPrerequisites({
      owner, skill: target.skill, prerequisites: [second.skill, first.skill, first.skill],
    })).toEqual({});
    expect(await savedState()).toEqual(before);
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [second.skill] });
    expect(await mapping._prerequisites({ skill: target.skill })).toEqual([{ prerequisite: second.skill }]);
    expect(await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [] })).toEqual({});
    expect(await mapping._prerequisites({ skill: target.skill })).toEqual([]);
    const cleared = await savedState();
    expect(await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [] })).toEqual({});
    expect(await savedState()).toEqual(cleared);
  });

  test("refuses missing, foreign, draft, and archived targets before validating prerequisites", async () => {
    const { owner, unit } = await makeCourse();
    const confirmed = await makeSkill(owner, unit);
    const draft = await mapping.propose({ ...content, owner, unit });
    const archived = await makeSkill(owner, unit);
    // Seed an archived fixture for this action's status checks.
    await connection!.db.collection<{ _id: string; status: string }>("SkillMapping.skills")
      .updateOne({ _id: archived.skill }, { $set: { status: "ARCHIVED" } });
    const before = await savedState("SkillMapping", true);
    for (const identity of [
      { owner, skill: randomUUID() },
      { owner: randomUUID(), skill: confirmed.skill },
      { owner, skill: draft.skill },
      { owner, skill: archived.skill },
    ]) {
      const result = mapping.setPrerequisites({ ...identity, prerequisites: [randomUUID()] });
      await expect(result).rejects.toBeInstanceOf(SkillPrerequisitesUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_PREREQUISITES_UNAVAILABLE",
        message: "Choose one of your confirmed skills.",
      });
    }
    expect(await savedState("SkillMapping", true)).toEqual(before);
  });

  test("refuses invalid prerequisites without saving any part of a mixed set", async () => {
    const { owner, unit } = await makeCourse();
    const target = await makeSkill(owner, unit);
    const valid = await makeSkill(owner, unit);
    const draft = await mapping.propose({ ...content, owner, unit });
    const archived = await makeSkill(owner, unit);
    await connection!.db.collection<{ _id: string; status: string }>("SkillMapping.skills")
      .updateOne({ _id: archived.skill }, { $set: { status: "ARCHIVED" } });
    const ownOtherCourse = await makeCourse(mapping, owner);
    const ownOtherSkill = await makeSkill(owner, ownOtherCourse.unit);
    const foreign = await makeCourse();
    const foreignSkill = await makeSkill(foreign.owner, foreign.unit);
    const before = await savedState("SkillMapping", true);
    for (const invalid of [randomUUID(), draft.skill, archived.skill, ownOtherSkill.skill, foreignSkill.skill]) {
      const result = mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [valid.skill, invalid] });
      await expect(result).rejects.toBeInstanceOf(InvalidSkillPrerequisitesError);
      await expect(result).rejects.toMatchObject({
        code: "INVALID_SKILL_PREREQUISITES",
        message: "Use confirmed skills from this course, without self-dependencies or cycles.",
      });
      expect(await savedState("SkillMapping", true)).toEqual(before);
    }
  });

  test("refuses a skill that requires itself", async () => {
    const { owner, unit } = await makeCourse();
    const { skill } = await makeSkill(owner, unit);
    const before = await savedState("SkillMapping", true);
    await expect(mapping.setPrerequisites({ owner, skill, prerequisites: [skill] }))
      .rejects.toBeInstanceOf(InvalidSkillPrerequisitesError);
    expect(await savedState("SkillMapping", true)).toEqual(before);
  });

  test("refuses direct and longer cycles, including when replacing an existing link", async () => {
    const { owner, unit } = await makeCourse();
    const a = await makeSkill(owner, unit);
    const b = await makeSkill(owner, unit);
    const c = await makeSkill(owner, unit);
    const d = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: a.skill, prerequisites: [b.skill] });
    const beforeDirect = await savedState("SkillMapping", true);
    await expect(mapping.setPrerequisites({ owner, skill: b.skill, prerequisites: [a.skill] }))
      .rejects.toBeInstanceOf(InvalidSkillPrerequisitesError);
    expect(await savedState("SkillMapping", true)).toEqual(beforeDirect);

    await mapping.setPrerequisites({ owner, skill: b.skill, prerequisites: [c.skill] });
    await mapping.setPrerequisites({ owner, skill: c.skill, prerequisites: [d.skill] });
    const beforeLong = await savedState("SkillMapping", true);
    await expect(mapping.setPrerequisites({ owner, skill: c.skill, prerequisites: [a.skill] }))
      .rejects.toBeInstanceOf(InvalidSkillPrerequisitesError);
    expect(await savedState("SkillMapping", true)).toEqual(beforeLong);
    await mapping.setPrerequisites({ owner, skill: b.skill, prerequisites: [] });
    expect(await mapping.setPrerequisites({ owner, skill: c.skill, prerequisites: [a.skill] })).toEqual({});
  });

  test("allows shared foundations and returns only direct prerequisites", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const left = await makeSkill(owner, unit);
    const right = await makeSkill(owner, unit);
    const target = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill: left.skill, prerequisites: [foundation.skill] });
    await mapping.setPrerequisites({ owner, skill: right.skill, prerequisites: [foundation.skill] });
    expect(await mapping.setPrerequisites({
      owner, skill: target.skill, prerequisites: [left.skill, right.skill],
    })).toEqual({});
    expect(await mapping._prerequisites({ skill: target.skill })).toEqual(
      [left.skill, right.skill].sort().map((prerequisite) => ({ prerequisite })),
    );
  });

  for (const rejectedWrite of ["courses", "skills"] as const) {
    test(`rolls back all storage changes when MongoDB rejects the ${rejectedWrite} write`, async () => {
      const instanceName = `PrerequisitesFailure_${rejectedWrite}`;
      const concept = await createSkillMapping(connection!.db, instanceName);
      const { owner, unit } = await makeCourse(concept);
      const target = await makeSkill(owner, unit, concept);
      const prerequisite = await makeSkill(owner, unit, concept);
      const request = { owner, skill: target.skill, prerequisites: [prerequisite.skill] };
      const before = await savedState(instanceName, true);
      await connection!.db.command({
        collMod: `${instanceName}.${rejectedWrite}`,
        validator: { forceTestFailure: { $exists: true } },
        validationLevel: "strict",
        validationAction: "error",
      });
      try {
        const result = concept.setPrerequisites(request);
        await expect(result).rejects.toBeInstanceOf(MongoServerError);
        await expect(result).rejects.toMatchObject({ code: 121 });
        expect(await savedState(instanceName, true)).toEqual(before);
      } finally {
        await connection!.db.command({ collMod: `${instanceName}.${rejectedWrite}`, validator: {} });
      }
      expect(await concept.setPrerequisites(request)).toEqual({});
      expect(await concept._prerequisites({ skill: target.skill })).toEqual([{ prerequisite: prerequisite.skill }]);
    });
  }

  for (const indirect of [false, true]) {
    test(`rejects one of two overlapping edits that together create a ${indirect ? "longer" : "two-skill"} cycle`, async () => {
      const { owner, unit } = await makeCourse();
      const a = await makeSkill(owner, unit);
      const b = await makeSkill(owner, unit);
      let firstPrerequisite = b.skill;
      let secondPrerequisite = a.skill;
      if (indirect) {
        const c = await makeSkill(owner, unit);
        const d = await makeSkill(owner, unit);
        await mapping.setPrerequisites({ owner, skill: c.skill, prerequisites: [b.skill] });
        await mapping.setPrerequisites({ owner, skill: d.skill, prerequisites: [a.skill] });
        firstPrerequisite = c.skill;
        secondPrerequisite = d.skill;
      }
      const secondConnection = await connectMongo({ uri, database });
      try {
        const secondMapping = await createSkillMapping(secondConnection.db);
        const results = await withOverlappingSkillReads(database, [a.skill, b.skill], () => Promise.allSettled([
          mapping.setPrerequisites({ owner, skill: a.skill, prerequisites: [firstPrerequisite] }),
          secondMapping.setPrerequisites({ owner, skill: b.skill, prerequisites: [secondPrerequisite] }),
        ]));
        expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
        const failure = results.find((result) => result.status === "rejected");
        expect(failure?.reason).toBeInstanceOf(InvalidSkillPrerequisitesError);
        expect(failure?.reason.code).toBe("INVALID_SKILL_PREREQUISITES");
        const saved = [
          await mapping._prerequisites({ skill: a.skill }),
          await mapping._prerequisites({ skill: b.skill }),
        ];
        expect(saved).toEqual(results[0]!.status === "fulfilled"
          ? [[{ prerequisite: firstPrerequisite }], []]
          : [[], [{ prerequisite: secondPrerequisite }]]);
      } finally {
        await secondConnection.client.close();
      }
    });
  }

  test("keeps both valid edits made to different skills from separate clients", async () => {
    const { owner, unit } = await makeCourse();
    const foundation = await makeSkill(owner, unit);
    const a = await makeSkill(owner, unit);
    const b = await makeSkill(owner, unit);
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await withOverlappingSkillReads(database, [a.skill, b.skill], () => Promise.all([
        mapping.setPrerequisites({ owner, skill: a.skill, prerequisites: [foundation.skill] }),
        secondMapping.setPrerequisites({ owner, skill: b.skill, prerequisites: [foundation.skill] }),
      ]))).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._prerequisites({ skill: a.skill })).toEqual([{ prerequisite: foundation.skill }]);
    expect(await mapping._prerequisites({ skill: b.skill })).toEqual([{ prerequisite: foundation.skill }]);
  });

  test("concurrent replacements keep one complete set instead of merging requests", async () => {
    const { owner, unit } = await makeCourse();
    const target = await makeSkill(owner, unit);
    const first = await makeSkill(owner, unit);
    const second = await makeSkill(owner, unit);
    const third = await makeSkill(owner, unit);
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      expect(await Promise.all([
        mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [first.skill] }),
        secondMapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [second.skill, third.skill] }),
      ])).toEqual([{}, {}]);
    } finally {
      await secondConnection.client.close();
    }
    const saved = (await mapping._prerequisites({ skill: target.skill })).map(({ prerequisite }) => prerequisite);
    expect([[first.skill], [second.skill, third.skill].sort()]).toContainEqual(saved);
    expect((await mapping._skill({ skill: target.skill }))[0]!.current).toBe(target.current);
  });

  test("reads saved prerequisites and unchanged requirements from another process", async () => {
    const { owner, unit } = await makeCourse();
    const { skill, current } = await makeSkill(owner, unit);
    const prerequisite = await makeSkill(owner, unit);
    await mapping.setPrerequisites({ owner, skill, prerequisites: [prerequisite.skill] });
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
      materials: [{ material: "source-a" }],
      prerequisites: [{ prerequisite: prerequisite.skill }],
    });
  });
});
