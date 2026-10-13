import { createSkillMapping, InvalidSkillPrerequisitesError } from "../src/concepts/SkillMapping.ts";
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

  async function ensureSkill(title: string, outcome: string, gate: string) {
    let saved = (await mapping._skills({ unit: unit!.unit })).find((record) => record.title === title);
    if (!saved) {
      const { skill } = await mapping.propose({
        owner, unit: unit!.unit, title, outcome, gate,
        // Placeholder identity for the concept demo. No file has been imported.
        materials: ["demo-material-prerequisites"],
      });
      const [record] = await mapping._skill({ skill });
      if (!record) throw new Error("The demo skill was not found.");
      saved = { skill, ...record };
    }
    if (saved.status === "DRAFT") {
      await mapping.confirm({ owner, skill: saved.skill });
    }
    return saved;
  }

  const foundation = await ensureSkill(
    "Read matrix rows and columns",
    "Identify a matrix's rows, columns, and dimensions.",
    "Identify the dimensions and requested entries in two fresh matrices without hints.",
  );
  const target = await ensureSkill(
    "Compute a matrix product",
    "Multiply compatible matrices using row and column products.",
    "Solve two fresh problems without hints and explain each entry.",
  );
  const before = await mapping._prerequisites({ skill: target.skill });
  const result = await mapping.setPrerequisites({
    owner, skill: target.skill, prerequisites: [foundation.skill],
  });

  let cycleRefusal: { code: string; message: string } | undefined;
  try {
    await mapping.setPrerequisites({ owner, skill: foundation.skill, prerequisites: [target.skill] });
    throw new Error("The cycle should have been refused.");
  } catch (error) {
    if (!(error instanceof InvalidSkillPrerequisitesError)) throw error;
    cycleRefusal = { code: error.code, message: error.message };
  }

  const [after] = await mapping._skill({ skill: target.skill });
  if (!after) throw new Error("The skill was not found after setting prerequisites.");
  console.log(JSON.stringify({
    skill: { id: target.skill, title: target.title, status: after.status },
    prerequisite: { id: foundation.skill, title: foundation.title },
    result,
    beforePrerequisites: before,
    afterPrerequisites: await mapping._prerequisites({ skill: target.skill }),
    foundationPrerequisites: await mapping._prerequisites({ skill: foundation.skill }),
    beforeVersion: target.current,
    afterVersion: after.current,
    newVersionCreated: target.current !== after.current,
    cycleRefusal,
    sourceNote: "The material ID is a demo placeholder. No file has been imported.",
  }, null, 2));
} finally {
  await client.close();
}
