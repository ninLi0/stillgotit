import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  DraftDiscardUnavailableError,
  DraftRevisionUnavailableError,
  SkillConfirmUnavailableError,
  SkillSourceRequiredError,
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

async function makeDraft(concept = mapping, materials = content.materials) {
  const owner = randomUUID();
  const { course } = await concept.createCourse({ owner, title: "Linear Algebra" });
  const { unit } = await concept.addUnit({ owner, course, title: "Matrices" });
  const { skill } = await concept.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit, materials });
  const [record] = await concept._skill({ skill });
  return { owner, course, unit, skill, current: record!.current };
}

async function savedState(instanceName = "SkillMapping") {
  return Promise.all(["courses", "units", "skills", "versions"].map(
    (name) => connection!.db.collection(`${instanceName}.${name}`).find().sort({ _id: 1 }).toArray(),
  ));
}

describe("SkillMapping confirmation", () => {
  test("confirms an owned draft while preserving its details, versions, and other records", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    await mapping.reviseDraft({ ...content, owner, unit, skill, gate: "Explain incompatible dimensions." });
    const [draft] = await mapping._skill({ skill });
    await mapping.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit });
    await makeDraft();
    const before = await savedState();

    expect(await mapping.confirm({ owner, skill })).toEqual({});
    expect(await mapping._skill({ skill })).toEqual([{ ...draft!, status: "CONFIRMED" }]);
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

  test("refuses a draft without sources, then accepts it after a source is added", async () => {
    const { owner, unit, skill, current } = await makeDraft(mapping, []);
    const before = await savedState();
    const result = mapping.confirm({ owner, skill });
    await expect(result).rejects.toBeInstanceOf(SkillSourceRequiredError);
    await expect(result).rejects.toMatchObject({
      code: "SKILL_SOURCE_REQUIRED",
      message: "Add a source before confirming this skill.",
    });
    expect(await savedState()).toEqual(before);

    await mapping.reviseDraft({ ...content, owner, unit, skill, materials: ["source-a"] });
    expect(await mapping.confirm({ owner, skill })).toEqual({});
    expect(await mapping._skill({ skill })).toEqual([{
      unit, title: content.title, current, status: "CONFIRMED",
    }]);
    expect(await mapping._materials({ skill })).toEqual([{ material: "source-a" }]);
  });

  test("refuses foreign, missing, confirmed, and archived skills before checking sources", async () => {
    const foreign = await makeDraft(mapping, []);
    const confirmed = await makeDraft();
    await mapping.confirm({ owner: confirmed.owner, skill: confirmed.skill });
    const archived = await makeDraft();
    await mapping.confirm({ owner: archived.owner, skill: archived.skill });
    // Seed an archived fixture for this action's status checks.
    await connection!.db.collection<{ _id: string; status: string }>("SkillMapping.skills")
      .updateOne({ _id: archived.skill }, { $set: { status: "ARCHIVED" } });
    const before = await savedState();

    for (const identity of [
      { owner: randomUUID(), skill: foreign.skill },
      { owner: foreign.owner, skill: randomUUID() },
      { owner: confirmed.owner, skill: confirmed.skill },
      { owner: archived.owner, skill: archived.skill },
    ]) {
      const result = mapping.confirm(identity);
      await expect(result).rejects.toBeInstanceOf(SkillConfirmUnavailableError);
      await expect(result).rejects.toMatchObject({
        code: "SKILL_CONFIRM_UNAVAILABLE",
        message: "Choose one of your draft skills.",
      });
    }
    expect(await savedState()).toEqual(before);
  });

  test("refuses draft edits, draft removal, and a second confirmation after success", async () => {
    const { owner, unit, skill } = await makeDraft();
    await mapping.confirm({ owner, skill });
    const before = await savedState();

    await expect(mapping.confirm({ owner, skill })).rejects.toBeInstanceOf(SkillConfirmUnavailableError);
    await expect(mapping.reviseDraft({ ...content, owner, unit, skill, materials: [] }))
      .rejects.toBeInstanceOf(DraftRevisionUnavailableError);
    await expect(mapping.discardDraft({ owner, skill })).rejects.toBeInstanceOf(DraftDiscardUnavailableError);
    expect(await savedState()).toEqual(before);
  });

  test("leaves the draft intact when MongoDB rejects the status update", async () => {
    const instanceName = "ConfirmFailure";
    const concept = await createSkillMapping(connection!.db, instanceName);
    const { owner, skill } = await makeDraft(concept);
    const before = await savedState(instanceName);
    await connection!.db.command({
      collMod: `${instanceName}.skills`,
      validator: { status: "DRAFT" },
      validationLevel: "strict",
      validationAction: "error",
    });
    try {
      const result = concept.confirm({ owner, skill });
      await expect(result).rejects.toBeInstanceOf(MongoServerError);
      await expect(result).rejects.toMatchObject({ code: 121 });
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: `${instanceName}.skills`, validator: {} });
    }
    await concept.confirm({ owner, skill });
    expect((await concept._skill({ skill }))[0]?.status).toBe("CONFIRMED");
  });

  test("two concurrent confirmations produce one success and one refusal", async () => {
    const { owner, skill } = await makeDraft();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const results = await Promise.allSettled([
        mapping.confirm({ owner, skill }),
        secondMapping.confirm({ owner, skill }),
      ]);
      expect(results.filter((result) => result.status === "fulfilled")).toEqual([
        { status: "fulfilled", value: {} },
      ]);
      const rejected = results.filter((result) => result.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect(rejected[0]!.reason).toBeInstanceOf(SkillConfirmUnavailableError);
    } finally {
      await secondConnection.client.close();
    }
    expect((await mapping._skill({ skill }))[0]?.status).toBe("CONFIRMED");
  });

  test("a concurrent source removal cannot produce a confirmed skill with no sources", async () => {
    const { owner, unit, skill } = await makeDraft();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const [confirmation, removal] = await Promise.allSettled([
        mapping.confirm({ owner, skill }),
        secondMapping.reviseDraft({ ...content, owner, unit, skill, materials: [] }),
      ]);
      if (confirmation!.status === "fulfilled") {
        expect(confirmation.value).toEqual({});
        expect(removal!.status).toBe("rejected");
        if (removal!.status === "rejected") {
          expect(removal.reason).toBeInstanceOf(DraftRevisionUnavailableError);
        }
        expect((await mapping._skill({ skill }))[0]?.status).toBe("CONFIRMED");
        expect(await mapping._materials({ skill })).toEqual([
          { material: "source-a" }, { material: "source-b" },
        ]);
      } else {
        expect(confirmation!.reason).toBeInstanceOf(SkillSourceRequiredError);
        expect(removal).toEqual({ status: "fulfilled", value: {} });
        expect((await mapping._skill({ skill }))[0]?.status).toBe("DRAFT");
        expect(await mapping._materials({ skill })).toEqual([]);
      }
    } finally {
      await secondConnection.client.close();
    }
  });

  test("a concurrent discard either removes the draft or is refused after confirmation", async () => {
    const { owner, skill, current } = await makeDraft();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const secondMapping = await createSkillMapping(secondConnection.db);
      const [confirmation, discard] = await Promise.allSettled([
        mapping.confirm({ owner, skill }),
        secondMapping.discardDraft({ owner, skill }),
      ]);
      if (confirmation!.status === "fulfilled") {
        expect(confirmation.value).toEqual({});
        expect(discard!.status).toBe("rejected");
        if (discard!.status === "rejected") {
          expect(discard.reason).toBeInstanceOf(DraftDiscardUnavailableError);
        }
        expect((await mapping._skill({ skill }))[0]?.status).toBe("CONFIRMED");
        expect(await mapping._version({ version: current })).toEqual([{
          skill, outcome: content.outcome, gate: content.gate,
        }]);
      } else {
        expect(confirmation!.reason).toBeInstanceOf(SkillConfirmUnavailableError);
        expect(discard).toEqual({ status: "fulfilled", value: {} });
        expect(await mapping._skill({ skill })).toEqual([]);
        expect(await mapping._version({ version: current })).toEqual([]);
      }
    } finally {
      await secondConnection.client.close();
    }
  });

  test("reads the confirmed skill and its unchanged requirements in another process", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    await mapping.confirm({ owner, skill });
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
      materials: [{ material: "source-a" }, { material: "source-b" }],
      prerequisites: [],
    });
  });
});
