import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo } from "../src/storage/mongo.ts";

const { client, db } = await connectMongo();

try {
  const mapping = await createSkillMapping(db);
  const owner = "demo-learner";
  const course = (await mapping._courses({ owner })).find(
    (record) => record.title === "MIT 18.06SC Linear Algebra",
  );
  if (!course) throw new Error("Create the demo course first: bun run demo:course");
  const units = await mapping._units({ course: course.course });
  const sourceUnit = units.find((record) => record.title === "Matrix multiplication");
  if (!sourceUnit) throw new Error("Create the demo unit first: bun run demo:unit");
  const targetTitle = "Matrix dimensions";
  const targetUnit = units.find((record) => record.title === targetTitle) ?? {
    ...await mapping.addUnit({ owner, course: course.course, title: targetTitle }),
    title: targetTitle,
  };

  const originalTitle = "Matrix size checks";
  const editedTitle = "Check matrix product dimensions";
  let saved = (await mapping._skills({ unit: targetUnit.unit })).find(
    (record) => record.title === editedTitle,
  ) ?? (await mapping._skills({ unit: sourceUnit.unit })).find(
    (record) => record.title === originalTitle,
  );
  if (!saved) {
    const { skill } = await mapping.propose({
      owner,
      unit: sourceUnit.unit,
      title: originalTitle,
      outcome: "Determine whether two matrices can be multiplied.",
      gate: "Explain compatibility and give the product's dimensions for two fresh pairs of matrices.",
      // Placeholder identity for the concept demo. No file has been imported.
      materials: ["demo-material-edit-details"],
    });
    const [record] = await mapping._skill({ skill });
    if (!record) throw new Error("The demo skill was not found.");
    saved = { skill, ...record };
  }
  if (saved.status === "DRAFT") {
    await mapping.confirm({ owner, skill: saved.skill });
  }

  const [before] = await mapping._skill({ skill: saved.skill });
  if (!before) throw new Error("The skill was not found before editing.");
  const result = await mapping.editDetails({
    owner, skill: saved.skill, unit: targetUnit.unit, title: editedTitle,
  });
  const [after] = await mapping._skill({ skill: saved.skill });
  if (!after) throw new Error("The edited skill was not found.");
  console.log(JSON.stringify({
    skill: saved.skill,
    before,
    after,
    result,
    changed: before.unit !== after.unit || before.title !== after.title,
    sameRequirementsVersion: before.current === after.current,
    requirements: await mapping._version({ version: after.current }),
    materials: await mapping._materials({ skill: saved.skill }),
    sourceNote: "The material ID is a demo placeholder. No file has been imported.",
  }, null, 2));
} finally {
  await client.close();
}
