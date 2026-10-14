import { createSkillMapping, SkillDefinitionUnchangedError } from "../src/concepts/SkillMapping.ts";
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

  const title = "Explain matrix multiplication";
  let saved = (await mapping._skills({ unit: unit.unit })).find((record) => record.title === title);
  if (!saved) {
    const { skill } = await mapping.propose({ proposalKey: crypto.randomUUID(),
      owner,
      unit: unit.unit,
      title,
      outcome: "Multiply compatible matrices and explain each entry.",
      gate: "Solve two fresh problems without hints and explain each step.",
      // Placeholder identity for the concept demo. No file has been imported.
      materials: ["demo-material-requirements-revision"],
    });
    const [record] = await mapping._skill({ skill });
    if (!record) throw new Error("The demo skill was not found.");
    saved = { skill, ...record };
  }
  if (saved.status === "DRAFT") {
    await mapping.confirm({ owner, skill: saved.skill });
  }
  const [before] = await mapping._skill({ skill: saved.skill });
  if (!before) throw new Error("The skill was not found before revision.");
  const [requirements] = await mapping._version({ version: before.current });
  if (!requirements) throw new Error("The current requirements were not found.");
  const addition = "Explain why reversing the order can change the result.";
  const gate = requirements.gate.includes(addition) ? requirements.gate : `${requirements.gate} ${addition}`;

  let result: { previous: string; version: string } | undefined;
  let refusal: { code: string; message: string } | undefined;
  try {
    result = await mapping.reviseDefinition({
      owner, skill: saved.skill, outcome: requirements.outcome, gate,
    });
  } catch (error) {
    if (!(error instanceof SkillDefinitionUnchangedError)) throw error;
    refusal = { code: error.code, message: error.message };
  }
  const [after] = await mapping._skill({ skill: saved.skill });
  if (!after) throw new Error("The skill was not found after revision.");
  console.log(JSON.stringify({
    skill: saved.skill,
    status: after.status,
    result,
    refusal,
    beforeVersion: before.current,
    afterVersion: after.current,
    newVersionCreated: before.current !== after.current,
    beforeRequirements: await mapping._version({ version: before.current }),
    afterRequirements: await mapping._version({ version: after.current }),
    sourceNote: "The material ID is a demo placeholder. No file has been imported.",
  }, null, 2));
} finally {
  await client.close();
}
