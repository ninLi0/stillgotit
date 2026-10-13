import {
  createSkillMapping,
  SkillRestorePrerequisitesError,
  SkillRestoreUnavailableError,
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
  const skills = await mapping._skills({ unit: unit.unit });
  const target = skills.find((record) => record.title === "Square a matrix");
  const foundation = skills.find((record) => record.title === "Identify square matrices");
  if (!target || !foundation) {
    throw new Error("Create the archived demo skill first: bun run demo:archive-skill");
  }

  let prerequisiteRefusal: { code: string; message: string } | undefined;
  if (target.status === "ARCHIVED") {
    // Prepare the blocked case using only the previous demo's foundation.
    if (foundation.status === "CONFIRMED") {
      await mapping.archive({ owner, skill: foundation.skill });
    }
    try {
      await mapping.restore({ owner, skill: target.skill });
      throw new Error("Restoring before the foundation should have been refused.");
    } catch (error) {
      if (!(error instanceof SkillRestorePrerequisitesError)) throw error;
      prerequisiteRefusal = { code: error.code, message: error.message };
    }
    await mapping.restore({ owner, skill: foundation.skill });
  }

  let result: Record<string, never> | undefined;
  let repeatRefusal: { code: string; message: string } | undefined;
  try {
    result = await mapping.restore({ owner, skill: target.skill });
  } catch (error) {
    if (!(error instanceof SkillRestoreUnavailableError)) throw error;
    repeatRefusal = { code: error.code, message: error.message };
  }
  const [after] = await mapping._skill({ skill: target.skill });
  if (!after) throw new Error("The skill was not found after restoration.");
  console.log(JSON.stringify({
    skill: { id: target.skill, title: target.title },
    prerequisiteRefusal,
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
