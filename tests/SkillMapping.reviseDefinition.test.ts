import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Collection, MongoServerError } from "mongodb";
import {
  createSkillMapping,
  InvalidSkillDefinitionError,
  SkillDefinitionUnavailableError,
  SkillDefinitionUnchangedError,
  type SkillMapping,
} from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { clearCollections } from "./fixtures/clear-collections.ts";

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

beforeEach(async () => {
  // Each test starts from empty collections in this file's database.
  await clearCollections(connection!.db);
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

async function savedVersion(version: string) {
  return connection!.db
    .collection<{ _id: string; skill: string; outcome: string; gate: string; previous?: string }>("SkillMapping.versions")
    .findOne({ _id: version });
}

async function versionCount(skill: string, instanceName = "SkillMapping") {
  return connection!.db.collection(`${instanceName}.versions`).countDocuments({ skill });
}

describe("SkillMapping requirements revision", () => {
  test.each(["outcome", "gate", "both"])("creates a new version when %s changes and preserves other state", async (field) => {
    const { owner, unit, skill, current } = await makeConfirmed();
    const prerequisite = await mapping.propose({ proposalKey: crypto.randomUUID(), ...content, owner, unit, title: "Read matrix dimensions" });
    await mapping.confirm({ owner, skill: prerequisite.skill });
    await mapping.setPrerequisites({ owner, skill, prerequisites: [prerequisite.skill] });
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
    // The new version carries the version it replaced.
    expect(await savedVersion(result.version)).toEqual({
      _id: result.version, skill, outcome, gate, previous: current,
    });
    expect(await mapping._versions({ skill })).toEqual([
      { version: result.version, outcome, gate },
      { version: current, outcome: content.outcome, gate: content.gate },
    ]);
  });

  test("saves the replaced version in the one write that saves the new version", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const gate = "Explain incompatible dimensions.";
    const writes: string[] = [];
    const spies = (["insertOne", "insertMany", "updateOne", "updateMany", "replaceOne", "deleteOne", "deleteMany"] as const)
      .map((method) => {
        const original = Collection.prototype[method] as (...args: unknown[]) => unknown;
        return spyOn(Collection.prototype, method).mockImplementation(function (this: Collection, ...args: unknown[]) {
          writes.push(`${method} ${this.collectionName}`);
          return original.apply(this, args);
        } as never);
      });
    let result: { previous: string; version: string };
    try {
      result = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate });
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
    // One write saves the new version with its link; one write makes it current.
    expect(writes).toEqual(["insertOne SkillMapping.versions", "updateOne SkillMapping.skills"]);
    expect(await savedVersion(result!.version)).toEqual({
      _id: result!.version, skill, outcome: content.outcome, gate, previous: current,
    });
  });

  test("lists a skill's versions newest first through each replaced version", async () => {
    const { owner, unit, skill, current } = await makeConfirmed();
    const gates = ["Explain incompatible dimensions.", "Explain why order matters.", "Explain each entry's sum."];
    const revisions = [];
    for (const gate of gates) {
      revisions.push(await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate }));
    }
    expect(revisions.map((revision) => revision.previous))
      .toEqual([current, revisions[0]!.version, revisions[1]!.version]);
    const history = [
      { version: revisions[2]!.version, outcome: content.outcome, gate: gates[2] },
      { version: revisions[1]!.version, outcome: content.outcome, gate: gates[1] },
      { version: revisions[0]!.version, outcome: content.outcome, gate: gates[0] },
      { version: current, outcome: content.outcome, gate: content.gate },
    ];
    expect(await mapping._versions({ skill })).toEqual(history);

    // Renaming, moving, adding a source, and archiving keep the history.
    const { course } = (await mapping._unit({ unit }))[0]!;
    const target = await mapping.addUnit({ owner, course, title: "Products" });
    await mapping.editDetails({ owner, skill, unit: target.unit, title: "Matrix products" });
    await mapping.attachMaterial({ owner, skill, material: "source-c" });
    await mapping.archive({ owner, skill });
    expect(await mapping._versions({ skill })).toEqual(history);

    // Another skill's history is separate.
    const other = await makeConfirmed();
    expect(await mapping._versions({ skill: other.skill })).toEqual([
      { version: other.current, outcome: content.outcome, gate: content.gate },
    ]);
  });

  test("lists only the current version of a draft, and no rows for unknown or discarded skills", async () => {
    const { owner, unit, skill, current } = await makeDraft();
    expect(await mapping._versions({ skill })).toEqual([
      { version: current, outcome: content.outcome, gate: content.gate },
    ]);

    // A draft revision replaces the version without recording it as previous.
    const gate = "Explain incompatible dimensions.";
    await mapping.reviseDraft({ ...content, owner, unit, skill, gate });
    const [draft] = await mapping._skill({ skill });
    expect(draft!.current).not.toBe(current);
    expect(await mapping._versions({ skill })).toEqual([
      { version: draft!.current, outcome: content.outcome, gate },
    ]);
    // So the confirmed skill's history starts from the version it was confirmed with.
    await mapping.confirm({ owner, skill });
    const revision = await mapping.reviseDefinition({ owner, skill, outcome: content.outcome, gate: content.gate });
    expect(await mapping._versions({ skill })).toEqual([
      { version: revision.version, outcome: content.outcome, gate: content.gate },
      { version: draft!.current, outcome: content.outcome, gate },
    ]);
    expect(await mapping._version({ version: current })).toEqual([
      { skill, outcome: content.outcome, gate: content.gate },
    ]);

    expect(await mapping._versions({ skill: randomUUID() })).toEqual([]);
    const discarded = await makeDraft();
    await mapping.discardDraft({ owner: discarded.owner, skill: discarded.skill });
    expect(await mapping._versions({ skill: discarded.skill })).toEqual([]);
  });

  test("lists no rows, rather than failing, when a draft is discarded between the history's reads", async () => {
    const { owner, skill } = await makeDraft();
    const originalFindOne = Collection.prototype.findOne as (...args: unknown[]) => Promise<unknown>;
    // The history reads the skill, then the draft is discarded before its versions are read.
    const read = spyOn(Collection.prototype, "findOne")
      .mockImplementationOnce(async function (this: Collection, ...args: unknown[]) {
        const record = await originalFindOne.apply(this, args);
        await mapping.discardDraft({ owner, skill });
        return record;
      } as never);
    try {
      expect(await mapping._versions({ skill })).toEqual([]);
    } finally {
      read.mockRestore();
    }
    expect(await mapping._skill({ skill })).toEqual([]);
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
    // Returning to earlier text is still a new entry in the history. The draft's
    // first version was replaced by reviseDraft, so the history ends before it.
    expect(await mapping._versions({ skill })).toEqual([
      { version: secondRevision.version, outcome: content.outcome, gate: content.gate },
      { version: firstRevision.version, outcome: content.outcome, gate: revisedGate },
      { version: secondVersion, outcome: content.outcome, gate: draftGate },
    ]);
  });

  test("refuses foreign, missing, draft, and archived skills before checking text", async () => {
    const confirmed = await makeConfirmed();
    const draft = await makeDraft();
    const archived = await makeConfirmed();
    await mapping.archive({ owner: archived.owner, skill: archived.skill });
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

  test.each(["versions", "skills"])("a failed %s write keeps the current version and a retry saves one new version", async (collection) => {
    const instanceName = `DefinitionFailure_${collection}`;
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
      expect((await concept._skill({ skill }))[0]?.current).toBe(current);
      expect(await concept._version({ version: current })).toEqual([{
        skill, outcome: content.outcome, gate: content.gate,
      }]);
      // A version saved before a rejected skill write never became current, so it is removed.
      expect(await savedState(instanceName)).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: `${instanceName}.${collection}`, validator: {} });
    }
    const result = await concept.reviseDefinition(revision);
    expect(result.previous).toBe(current);
    expect((await concept._skill({ skill }))[0]?.current).toBe(result.version);
    expect(await versionCount(skill, instanceName)).toBe(2);
    expect(await concept._versions({ skill })).toEqual([
      { version: result.version, outcome: content.outcome, gate: revision.gate },
      { version: current, outcome: content.outcome, gate: content.gate },
    ]);
  });

  test("a request that stops before switching versions leaves the old version current", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const revision = { owner, skill, outcome: content.outcome, gate: "Explain incompatible dimensions." };
    // Simulate a process that stops right after saving the new version: neither
    // the switch nor the removal of the unused version runs.
    const update = spyOn(Collection.prototype, "updateOne")
      .mockImplementationOnce(async () => { throw new Error("Stopped before the switch."); });
    const remove = spyOn(Collection.prototype, "deleteOne")
      .mockImplementationOnce(async () => { throw new Error("Stopped before the removal."); });
    try {
      await expect(mapping.reviseDefinition(revision)).rejects.toThrow("Stopped before the switch.");
    } finally {
      update.mockRestore();
      remove.mockRestore();
    }
    expect((await mapping._skill({ skill }))[0]?.current).toBe(current);
    expect(await mapping._version({ version: current })).toEqual([{
      skill, outcome: content.outcome, gate: content.gate,
    }]);

    const result = await mapping.reviseDefinition(revision);
    expect(result.previous).toBe(current);
    expect((await mapping._skill({ skill }))[0]?.current).toBe(result.version);
    // The stopped attempt left one unused version. No action returned its
    // identity and the skill never used it, so no query reaches it.
    expect(await versionCount(skill)).toBe(3);
    expect(await mapping._versions({ skill })).toEqual([
      { version: result.version, outcome: content.outcome, gate: revision.gate },
      { version: current, outcome: content.outcome, gate: content.gate },
    ]);
  });

  test("a lost reply followed by another revision keeps the replaced version in the history", async () => {
    const { owner, skill, current } = await makeConfirmed();
    const first = { owner, skill, outcome: content.outcome, gate: "Explain incompatible dimensions." };
    const second = { owner, skill, outcome: content.outcome, gate: "Explain why order matters." };
    const originalUpdate = Collection.prototype.updateOne as (...args: unknown[]) => Promise<unknown>;
    let later: { previous: string; version: string } | undefined;
    // The first switch applies, but its reply is lost. Before the first
    // request checks whether its new version is in use, another revision
    // replaces that version.
    const update = spyOn(Collection.prototype, "updateOne")
      .mockImplementationOnce(async function (this: Collection, ...args: unknown[]) {
        await originalUpdate.apply(this, args);
        later = await mapping.reviseDefinition(second);
        throw new Error("Lost reply.");
      } as never);
    try {
      await expect(mapping.reviseDefinition(first)).rejects.toThrow("Lost reply.");
    } finally {
      update.mockRestore();
    }

    const replaced = later!.previous;
    expect(replaced).not.toBe(current);
    expect(await mapping._version({ version: replaced })).toEqual([
      { skill, outcome: content.outcome, gate: first.gate },
    ]);
    expect(await mapping._versions({ skill })).toEqual([
      { version: later!.version, outcome: content.outcome, gate: second.gate },
      { version: replaced, outcome: content.outcome, gate: first.gate },
      { version: current, outcome: content.outcome, gate: content.gate },
    ]);
    expect(await versionCount(skill)).toBe(3);
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
      expect(await mapping._versions({ skill })).toEqual([
        { version: accepted[0]!.value.version, outcome: content.outcome, gate: revision.gate },
        { version: current, outcome: content.outcome, gate: content.gate },
      ]);
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
      // The revision that lost the first race read again, so its saved link
      // names the version that actually preceded it. Both clients read the same history.
      const contentOf = (version: string) => {
        const index = results.findIndex((result) => result.version === version);
        return { outcome: revisions[index]!.outcome, gate: revisions[index]!.gate };
      };
      const history = [
        { version: second!.version, ...contentOf(second!.version) },
        { version: first!.version, ...contentOf(first!.version) },
        { version: current, outcome: content.outcome, gate: content.gate },
      ];
      expect(await mapping._versions({ skill })).toEqual(history);
      expect(await secondMapping._versions({ skill })).toEqual(history);
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
