import { StudyPlanning } from "../src/concepts/StudyPlanning/StudyPlanning.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ActionRefusal } from "@mit-sdg/sync-engine/assembly";
import { assembleApplication } from "../src/assembly.ts";
import { FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "../src/concepts/Registering/Registering.ts";
import { SessioningConcept } from "../src/concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;
let application: ReturnType<typeof assembleApplication>;

function success<T extends object>(result: T | ActionRefusal): T {
  if ("error" in result) throw new Error(`Unexpected refusal: ${result.error}`);
  return result as T;
}

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
  application = assembleApplication({
    Registering: new RegisteringConcept(connection.db),
    CommonsFederating: new FederatingConcept<User>(connection.db, new MemoryProvider(), "CommonsFederating"),
    Sessioning: new SessioningConcept<User>(connection.db),
    SkillMapping: await createSkillMapping(connection.db),
    AssessmentReviewing: new AssessmentReviewing(connection.db),
    MasteryEstimating: new MasteryEstimating(connection.db),
    StudyPlanning: new StudyPlanning(connection.db),
    GroundedTutoring: new GroundedTutoring(connection.db),
  });
});

afterAll(async () => {
  if (!connection) return;
  try {
    if (application) await application.beginDrain();
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

describe("SkillMapping framework registration", () => {
  test("runs the skill lifecycle through the engine and preserves saved history", async () => {
    const skills = application.concepts.SkillMapping;
    const owner = randomUUID();
    const { course } = success(await skills.createCourse({ owner, title: "Linear Algebra" }));
    const { unit } = success(await skills.addUnit({ owner, course, title: "Matrices" }));
    const otherUnit = success(await skills.addUnit({ owner, course, title: "Review" }));
    expect(await skills._courses({ owner })).toEqual([{ course, title: "Linear Algebra" }]);
    expect(await skills._course({ course })).toEqual([{ owner, title: "Linear Algebra" }]);
    expect(await skills._unit({ unit })).toEqual([{ course, title: "Matrices" }]);
    expect(await skills._units({ course })).toHaveLength(2);

    const draft = {
      owner, unit, title: "Multiply matrices", outcome: "Compute a product.",
      gate: "Solve two fresh problems.", materials: ["test-source"],
    };
    const { skill } = success(await skills.propose({ ...draft, proposalKey: crypto.randomUUID() }));
    const [proposed] = await skills._skill({ skill });
    expect(await skills.reviseDraft({ ...draft, skill, gate: "Explain two fresh products." }))
      .toEqual({});
    const [revised] = await skills._skill({ skill });
    expect(revised!.current).not.toBe(proposed!.current);
    expect(await skills.confirm({ owner, skill })).toEqual({});
    expect(await skills.editDetails({ owner, skill, unit: otherUnit.unit, title: "Matrix products" }))
      .toEqual({});
    const definition = success(await skills.reviseDefinition({
      owner, skill, outcome: "Compute and explain a product.", gate: "Explain three fresh products.",
    }));
    expect(definition.previous).toBe(revised!.current);
    expect(await skills._version({ version: proposed!.current })).toEqual([{
      skill, outcome: draft.outcome, gate: draft.gate,
    }]);
    expect(await skills._version({ version: definition.previous })).toEqual([{
      skill, outcome: draft.outcome, gate: "Explain two fresh products.",
    }]);
    expect(await skills.attachMaterial({ owner, skill, material: "extra-source" })).toEqual({});
    expect(await skills._materials({ skill })).toEqual([
      { material: "extra-source" }, { material: "test-source" },
    ]);

    const foundation = success(await skills.propose({ proposalKey: crypto.randomUUID(), ...draft, title: "Read rows and columns" }));
    expect(await skills.confirm({ owner, skill: foundation.skill })).toEqual({});
    expect(await skills.setPrerequisites({ owner, skill, prerequisites: [foundation.skill] }))
      .toEqual({});
    expect(await skills._prerequisites({ skill })).toEqual([{ prerequisite: foundation.skill }]);
    expect(await skills.archive({ owner, skill: foundation.skill })).toEqual({
      error: "SKILL_STILL_REQUIRED",
      detail: "Remove this skill from other active skills' prerequisites first.",
    });
    expect(await skills.archive({ owner, skill })).toEqual({});
    expect(await skills.restore({ owner, skill })).toEqual({});

    const temporary = success(await skills.propose({ proposalKey: crypto.randomUUID(), ...draft, title: "Discard this draft" }));
    const [temporaryRecord] = await skills._skill({ skill: temporary.skill });
    expect(await skills.discardDraft({ owner, skill: temporary.skill })).toEqual({});
    expect(await skills._skill({ skill: temporary.skill })).toEqual([]);
    expect(await skills._version({ version: temporaryRecord!.current })).toEqual([]);
    expect(await skills._skills({ unit: otherUnit.unit })).toEqual([{
      skill, title: "Matrix products", current: definition.version, status: "CONFIRMED",
    }]);

    // A second client and assembly must read MongoDB, not the first engine's memory.
    const secondConnection = await connectMongo({ uri, database });
    let second: ReturnType<typeof assembleApplication> | undefined;
    try {
      second = assembleApplication({
        Registering: new RegisteringConcept(secondConnection.db),
        CommonsFederating: new FederatingConcept<User>(secondConnection.db, new MemoryProvider(), "CommonsFederating"),
        Sessioning: new SessioningConcept<User>(secondConnection.db),
        SkillMapping: await createSkillMapping(secondConnection.db),
        AssessmentReviewing: new AssessmentReviewing(secondConnection.db),
        MasteryEstimating: new MasteryEstimating(secondConnection.db),
        StudyPlanning: new StudyPlanning(secondConnection.db),
        GroundedTutoring: new GroundedTutoring(secondConnection.db),
      });
      expect(await second.concepts.SkillMapping._skill({ skill }))
        .toEqual(await skills._skill({ skill }));
      expect(await second.concepts.SkillMapping._version({ version: definition.version }))
        .toEqual([{ skill, outcome: "Compute and explain a product.", gate: "Explain three fresh products." }]);
      expect(Object.keys(second.publicInterface.routes)).toContain("/courses");
    } finally {
      if (second) await second.beginDrain();
      await secondConnection.client.close();
    }
  });

  test("returns declared refusals without changing state and accepts later valid actions", async () => {
    const skills = application.concepts.SkillMapping;
    const owner = randomUUID();
    expect(await skills.createCourse({ owner, title: " \n\t" })).toEqual({
      error: "INVALID_COURSE_TITLE", detail: "Enter a course title.",
    });
    expect(await skills._courses({ owner })).toEqual([]);
    const { course } = success(await skills.createCourse({ owner, title: "Physics" }));
    expect(await skills.addUnit({ owner: randomUUID(), course, title: "Motion" })).toEqual({
      error: "UNIT_COURSE_UNAVAILABLE", detail: "Choose one of your courses.",
    });
    expect(await skills._units({ course })).toEqual([]);
    const { unit } = success(await skills.addUnit({ owner, course, title: "Motion" }));
    const { skill } = success(await skills.propose({ proposalKey: crypto.randomUUID(),
      owner, unit, title: "Explain motion", outcome: "Describe motion.",
      gate: "Explain two examples.", materials: [],
    }));
    const before = await skills._skill({ skill });
    expect(await skills.confirm({ owner, skill })).toEqual({
      error: "SKILL_SOURCE_REQUIRED", detail: "Add a source before confirming this skill.",
    });
    expect(await skills._skill({ skill })).toEqual(before);
    expect(await skills._materials({ skill })).toEqual([]);
  });

  test("keeps database faults distinct from declared refusals", async () => {
    const skills = application.concepts.SkillMapping;
    const owner = randomUUID();
    // Reject one marked record in this test database, without changing the concept.
    await connection!.db.command({
      collMod: "SkillMapping.courses",
      validator: { title: { $ne: "Force a database fault" } },
      validationLevel: "strict", validationAction: "error",
    });
    try {
      await expect(skills.createCourse({ owner, title: "Force a database fault" }))
        .rejects.toMatchObject({ code: 121 });
      expect(await skills._courses({ owner })).toEqual([]);
    } finally {
      await connection!.db.command({ collMod: "SkillMapping.courses", validator: {} });
    }
    const { course } = success(await skills.createCourse({ owner, title: "Recovery" }));
    expect(await skills._course({ course })).toEqual([{ owner, title: "Recovery" }]);
  });
});
