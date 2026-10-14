import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoServerError } from "mongodb";
import {
  createSkillMapping,
  InvalidSkillProposalError,
  InvalidSkillProposalKeyError,
  ProposalUnitUnavailableError,
  SkillProposalConflictError,
  SkillProposalDiscardedError,
  SkillMapping,
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

describe("SkillMapping proposal retries", () => {
  test("concurrent clients share one skill, version, and receipt", async () => {
    const { owner, unit } = await ownedUnit();
    const input = { owner, unit, proposalKey: randomUUID(), ...content };
    const second = await connectMongo({ uri, database });
    try {
      const peer = new SkillMapping(second.db);
      const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? peer : mapping).propose(input)));
      expect(new Set(results.map((result) => result.skill)).size).toBe(1);
      expect(await mapping._skills({ unit })).toHaveLength(1);
      expect(await connection!.db.collection("SkillMapping.versions").countDocuments({ skill: results[0]!.skill })).toBe(1);
      expect(await mapping.propose({ ...input, materials: ["source-a", "source-b"] })).toEqual(results[0]);
    } finally { await second.client.close(); }
  });

  test("changed inputs conflict, including competing first saves", async () => {
    const { owner, course, unit } = await ownedUnit(), otherUnit = await mapping.addUnit({ owner, course, title: "Other unit" });
    const input = { owner, unit, proposalKey: randomUUID(), ...content };
    const results = await Promise.allSettled([mapping.propose(input), mapping.propose({ ...input, title: "Different title" })]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(SkillProposalConflictError);
    expect(await mapping._skills({ unit })).toHaveLength(1);

    const stable = { ...input, proposalKey: randomUUID() };
    await mapping.propose(stable);
    const before = await savedState();
    for (const changed of [{ unit: otherUnit.unit }, { title: "Changed" }, { outcome: "Changed" }, { gate: "Changed" }, { materials: [] }]) {
      await expect(mapping.propose({ ...stable, ...changed })).rejects.toBeInstanceOf(SkillProposalConflictError);
    }
    expect(await savedState()).toEqual(before);
  });

  test("keys are required, scoped to the owner, and cannot reveal foreign skills", async () => {
    const first = await ownedUnit(), second = await ownedUnit(), proposalKey = randomUUID();
    for (const invalid of ["", " \n", "x".repeat(101)]) {
      await expect(mapping.propose({ ...first, ...content, proposalKey: invalid })).rejects.toBeInstanceOf(InvalidSkillProposalKeyError);
    }
    expect(await mapping._skills({ unit: first.unit })).toEqual([]);
    const saved = await mapping.propose({ ...first, ...content, proposalKey });
    await expect(mapping.propose({ owner: second.owner, unit: first.unit, ...content, proposalKey })).rejects.toBeInstanceOf(ProposalUnitUnavailableError);
    const separate = await mapping.propose({ ...second, ...content, proposalKey });
    expect(separate.skill).not.toBe(saved.skill);
    expect(await mapping._skills({ unit: second.unit })).toHaveLength(1);
  });

  test("replay preserves later edits and confirmation, and cannot recreate a discarded draft", async () => {
    const { owner, unit } = await ownedUnit(), input = { owner, unit, proposalKey: randomUUID(), ...content };
    const saved = await mapping.propose(input);
    await mapping.reviseDraft({ ...input, ...saved, title: "Revised title", gate: "Revised demonstration" });
    await mapping.confirm({ owner, ...saved });
    const before = await savedState();
    expect(await mapping.propose(input)).toEqual(saved);
    expect(await savedState()).toEqual(before);
    const removable = { ...input, proposalKey: randomUUID() }, draft = await mapping.propose(removable);
    await mapping.discardDraft({ owner, ...draft });
    await expect(mapping.propose(removable)).rejects.toBeInstanceOf(SkillProposalDiscardedError);
    expect(await mapping._skill(draft)).toEqual([]);
    expect(await mapping._skills({ unit })).toHaveLength(1);
    expect((await mapping.propose({ ...removable, proposalKey: randomUUID() })).skill).not.toBe(draft.skill);
  });

  test("a lost reply from a stopped process is recovered by a new process", async () => {
    const { owner, unit } = await ownedUnit(), input = { owner, unit, proposalKey: randomUUID(), ...content };
    async function invoke(mode: string) {
      const child = Bun.spawn([process.execPath, fileURLToPath(new URL("./fixtures/retry-skill.ts", import.meta.url)), database, JSON.stringify(input), mode],
        { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
      return Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    }
    const lost = await invoke("lose-reply");
    expect(lost).toEqual(["", "", 73]);
    const stored = await mapping._skills({ unit });
    expect(stored).toHaveLength(1);
    const [reply, error, code] = await invoke("retry");
    expect(error).toBe(""); expect(code).toBe(0);
    expect(JSON.parse(reply)).toEqual({ skill: stored[0]!.skill });
    expect(await mapping._skills({ unit })).toEqual(stored);
  });

  test("a failed version write rolls back its receipt so the same key can succeed later", async () => {
    const name = "RetryRollbackMapping", concept = await createSkillMapping(connection!.db, name);
    const { owner, unit } = await ownedUnit(concept), input = { owner, unit, proposalKey: randomUUID(), ...content };
    await connection!.db.command({ collMod: `${name}.versions`, validator: { $jsonSchema: { required: ["testFailure"] } }, validationLevel: "strict", validationAction: "error" });
    try {
      await expect(concept.propose(input)).rejects.toMatchObject({ code: 121 });
      expect(await concept._skills({ unit })).toEqual([]);
      expect(await connection!.db.collection(`${name}.proposals`).countDocuments()).toBe(0);
    } finally { await connection!.db.command({ collMod: `${name}.versions`, validator: {} }); }
    const result = await concept.propose(input);
    expect(await concept.propose(input)).toEqual(result);
    expect(await concept._skills({ unit })).toHaveLength(1);
  });
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
    const { skill } = await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
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
    const { skill } = await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content, materials: [] });

    expect((await mapping._skill({ skill }))[0]?.status).toBe("DRAFT");
    expect(await mapping._materials({ skill })).toEqual([]);
  });

  test("refuses another learner's unit and unknown units before checking text", async () => {
    const { owner, unit } = await ownedUnit();
    await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
    const otherOwner = randomUUID();
    const before = await savedState();

    for (const target of [unit, randomUUID()]) {
      for (const title of [content.title, ""]) {
        const result = mapping.propose({ proposalKey: crypto.randomUUID(),
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
    await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
    const before = await savedState();

    for (const blank of [{ title: "" }, { title: "\u00a0" }, { outcome: "   " }, { gate: "\n\t" }]) {
      const result = mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content, ...blank });
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
    const first = await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
    const [firstRecord] = await mapping._skill({ skill: first.skill });
    const firstVersion = await mapping._version({ version: firstRecord!.current });
    const second = await mapping.propose({ proposalKey: crypto.randomUUID(),
      owner, unit, ...content, outcome: "Explain which matrix dimensions are compatible.",
    });
    const [secondRecord] = await mapping._skill({ skill: second.skill });

    const otherUnit = await mapping.addUnit({ owner, course, title: "Vectors" });
    const otherSkill = await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit: otherUnit.unit, ...content });
    const otherLearner = await ownedUnit();
    const otherLearnerSkill = await mapping.propose({ proposalKey: crypto.randomUUID(), ...otherLearner, ...content });

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
    await concept.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
    const before = await savedState(instanceName);
    await connection!.db.command({
      collMod: `${instanceName}.versions`,
      validator: { $jsonSchema: { required: ["forceTestFailure"] } },
      validationLevel: "strict",
      validationAction: "error",
    });

    const result = concept.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
    await expect(result).rejects.toBeInstanceOf(MongoServerError);
    await expect(result).rejects.toMatchObject({ code: 121 });
    expect(await savedState(instanceName)).toEqual(before);

    await connection!.db.command({ collMod: `${instanceName}.versions`, validator: {} });
    const { skill } = await concept.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
    const [record] = await concept._skill({ skill });
    expect(await concept._version({ version: record!.current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);
    expect(await concept._skills({ unit })).toHaveLength(2);
  });

  test("reads the draft and its requirements from another Bun process", async () => {
    const { owner, unit } = await ownedUnit();
    const { skill } = await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit, ...content });
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
