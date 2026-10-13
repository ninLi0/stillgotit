import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  DraftDiscardUnavailableError,
  DraftRevisionUnavailableError,
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

describe("SkillMapping draft discard", () => {
  test("removes a draft and its first version without changing other records", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    await mapping.propose({ owner, unit, ...content });
    await makeDraft();
    const before = await savedState();

    expect(await mapping.discardDraft({ owner, skill })).toEqual({});
    expect(await mapping._skill({ skill })).toEqual([]);
    expect(await mapping._version({ version: current })).toEqual([]);
    expect(await mapping._materials({ skill })).toEqual([]);
    expect(await mapping._prerequisites({ skill })).toEqual([]);
    expect((await mapping._skills({ unit })).some((row) => row.skill === skill)).toBe(false);
    expect(await savedState()).toEqual([
      before[0], before[1],
      before[2]!.filter((row) => String(row._id) !== skill),
      before[3]!.filter((row) => row.skill !== skill),
    ]);
  });

  test("removes every requirements version after edits and a move within the course", async () => {
    const { owner, course, unit, skill, current } = await makeDraft();
    const target = await mapping.addUnit({ owner, course, title: "Matrix operations" });
    const versions = [current];
    for (const gate of ["Explain incompatible dimensions.", "Explain noncommutative products."]) {
      await mapping.reviseDraft({ ...content, owner, skill, unit: target.unit, gate });
      versions.push((await mapping._skill({ skill }))[0]!.current);
    }
    expect(await versionCount(skill)).toBe(3);

    await mapping.discardDraft({ owner, skill });
    expect(await mapping._skill({ skill })).toEqual([]);
    expect(await mapping._skills({ unit })).toEqual([]);
    expect(await mapping._skills({ unit: target.unit })).toEqual([]);
    expect(await versionCount(skill)).toBe(0);
    for (const version of versions) {
      expect(await mapping._version({ version })).toEqual([]);
    }
    expect(await mapping._unit({ unit: target.unit })).toEqual([{
      course, title: "Matrix operations",
    }]);
  });

  test("refuses foreign, missing, confirmed, and archived skills without changing state", async () => {
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
      const result = mapping.discardDraft(identity);
      await expect(result).rejects.toBeInstanceOf(DraftDiscardUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "DRAFT_DISCARD_UNAVAILABLE",
        message: "Only your draft skills can be discarded.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses a repeated discard because the draft no longer exists", async () => {
    const { owner, skill } = await makeDraft();
    await mapping.discardDraft({ owner, skill });
    const before = await savedState();

    await expect(mapping.discardDraft({ owner, skill })).rejects.toBeInstanceOf(DraftDiscardUnavailableError);
    expect(await savedState()).toEqual(before);
  });

  test("rolls back the skill deletion when deleting its versions fails", async () => {
    const instanceName = "DiscardRollback";
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, unit, skill } = await makeDraft(concept);
    await concept.reviseDraft({ ...content, owner, unit, skill, gate: "Explain the dimensions." });
    const before = await savedState(instanceName);
    const versions = `${instanceName}.versions`;
    const backing = `${instanceName}.savedVersions`;

    // A read-only view makes MongoDB reject the second delete. Only this test's
    // namespace changes; its original version documents remain in the backing collection.
    await connection!.db.collection(versions).rename(backing);
    await connection!.db.createCollection(versions, { viewOn: backing });
    try {
      const result = concept.discardDraft({ owner, skill });
      await expect(result).rejects.toBeInstanceOf(MongoServerError);
      await expect(result).rejects.toMatchObject({ code: 166 });
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.collection(versions).drop();
      await connection!.db.collection(backing).rename(versions);
    }

    await concept.discardDraft({ owner, skill });
    expect(await concept._skill({ skill })).toEqual([]);
    expect(await versionCount(skill, instanceName)).toBe(0);
  });

  test("two concurrent discards produce one success and one refusal", async () => {
    const { owner, skill } = await makeDraft();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.allSettled([
        mapping.discardDraft({ owner, skill }),
        secondMapping.discardDraft({ owner, skill }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toEqual([
        { status: "fulfilled", value: {} },
      ]);
      const rejected = results.filter((result) => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(DraftDiscardUnavailableError);
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._skill({ skill })).toEqual([]);
    expect(await versionCount(skill)).toBe(0);
  });

  test("a concurrent revision cannot leave versions behind after discard", async () => {
    const { owner, unit, skill } = await makeDraft();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const [revision, discard] = await Promise.allSettled([
        mapping.reviseDraft({ ...content, owner, unit, skill, gate: "Explain each dimension." }),
        secondMapping.discardDraft({ owner, skill }),
      ]);
      expect(discard).toEqual({ status: "fulfilled", value: {} });
      if (revision!.status === "rejected") {
        expect(revision.reason).toBeInstanceOf(DraftRevisionUnavailableError);
      } else {
        expect(revision!.value).toEqual({});
      }
    } finally {
      await secondConnection.client.close();
    }
    expect(await mapping._skill({ skill })).toEqual([]);
    expect(await versionCount(skill)).toBe(0);
  });

  test("reads the discarded skill and versions as absent in another process", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    await mapping.reviseDraft({ ...content, owner, unit, skill, gate: "Explain incompatible dimensions." });
    const latest = (await mapping._skill({ skill }))[0]!.current;
    await mapping.discardDraft({ owner, skill });
    const child = Bun.spawn([
      process.execPath,
      fileURLToPath(new URL("./fixtures/read-discarded-skill.ts", import.meta.url)),
      database, unit, skill, current, latest,
    ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);

    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      skill: [], skills: [], versions: [[], []], materials: [], prerequisites: [],
    });
  });
});
