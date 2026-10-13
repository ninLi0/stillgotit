import {
  createSkillMapping,
  SkillArchiveUnavailableError,
  SkillStillRequiredError,
} from "../src/concepts/SkillMapping.ts";
import { connectMongo } from "../src/storage/mongo.ts";

const { client, db } = await connectMongo();

try {
  const mapping = await createSkillMapping(db);
  const owner = "demo-learner";
  const course = (await mapping._courses({ owner })).find(
    (record) => record.title === "MIT 18.06SC Linear Algebra",
  );
  if (!course) throw new Error("Create the demo course first: bun run demo:course");
  const unit = (await mapping._units({ course: course.course })).find(
    (record) => record.title === "Matrix multiplication",
  );
  if (!unit) throw new Error("Create the demo unit first: bun run demo:unit");
  const unitId = unit.unit;

  async function ensureSkill(title: string, outcome: string, gate: string) {
    let saved = (await mapping._skills({ unit: unitId })).find((record) => record.title === title);
    if (!saved) {
      const { skill } = await mapping.propose({
        owner, unit: unitId, title, outcome, gate,
        // Placeholder identity for the concept demo. No file has been imported.
        materials: ["demo-material-archive"],
      });
      const [record] = await mapping._skill({ skill });
      if (!record) throw new Error("The demo skill was not found.");
      saved = { skill, ...record };
    }
    if (saved.status === "DRAFT") {
      await mapping.confirm({ owner, skill: saved.skill });
    }
    const [record] = await mapping._skill({ skill: saved.skill });
    if (!record) throw new Error("The demo skill was not found.");
    return { skill: saved.skill, ...record };
  }

  const foundation = await ensureSkill(
    "Identify square matrices",
    "Identify whether a matrix has the same number of rows and columns.",
    "Classify two fresh matrices and explain the dimensions without hints.",
  );
  const target = await ensureSkill(
    "Square a matrix",
    "Compute the product of a square matrix with itself.",
    "Square two fresh matrices without hints and explain each entry.",
  );

  let requiredRefusal: { code: string; message: string } | undefined;
  if (target.status === "CONFIRMED") {
    await mapping.setPrerequisites({ owner, skill: target.skill, prerequisites: [foundation.skill] });
    try {
      await mapping.archive({ owner, skill: foundation.skill });
      throw new Error("Archiving the required foundation should have been refused.");
    } catch (error) {
      if (!(error instanceof SkillStillRequiredError)) throw error;
      requiredRefusal = { code: error.code, message: error.message };
    }
  }

  let result: Record<string, never> | undefined;
  let repeatRefusal: { code: string; message: string } | undefined;
  try {
    result = await mapping.archive({ owner, skill: target.skill });
  } catch (error) {
    if (!(error instanceof SkillArchiveUnavailableError)) throw error;
    repeatRefusal = { code: error.code, message: error.message };
  }
  const [after] = await mapping._skill({ skill: target.skill });
  if (!after) throw new Error("The skill was not found after archival.");
  console.log(JSON.stringify({
    skill: { id: target.skill, title: target.title },
    requiredRefusal,
    result,
    repeatRefusal,
    beforeStatus: target.status,
    afterStatus: after.status,
    beforeVersion: target.current,
    afterVersion: after.current,
    materials: await mapping._materials({ skill: target.skill }),
    prerequisites: await mapping._prerequisites({ skill: target.skill }),
    foundation: await mapping._skill({ skill: foundation.skill }),
    sourceNote: "The material ID is a demo placeholder. No file has been imported.",
  }, null, 2));
} finally {
  await client.close();
}
