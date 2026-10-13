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
  const unit = (await mapping._units({ course: course.course })).find(
    (record) => record.title === "Matrix multiplication",
  );
  if (!unit) throw new Error("Create the demo unit first: bun run demo:unit");

  const title = "Interpret a matrix product";
  let saved = (await mapping._skills({ unit: unit.unit })).find((record) => record.title === title);
  if (!saved) {
    const { skill } = await mapping.propose({
      owner,
      unit: unit.unit,
      title,
      outcome: "Explain how rows and columns produce each entry of a matrix product.",
      gate: "Solve two fresh problems without hints and explain each entry.",
      // Placeholder identity for the concept demo. No file has been imported.
      materials: ["demo-material-product-lesson"],
    });
    const [record] = await mapping._skill({ skill });
    if (!record) throw new Error("The demo skill was not found.");
    saved = { skill, ...record };
  }
  if (saved.status === "DRAFT") {
    await mapping.confirm({ owner, skill: saved.skill });
  }
  const [before] = await mapping._skill({ skill: saved.skill });
  if (!before) throw new Error("The skill was not found before attachment.");
  const beforeMaterials = await mapping._materials({ skill: saved.skill });
  const material = "demo-material-product-exercises";
  const result = await mapping.attachMaterial({ owner, skill: saved.skill, material });
  const [after] = await mapping._skill({ skill: saved.skill });
  if (!after) throw new Error("The skill was not found after attachment.");

  console.log(JSON.stringify({
    skill: saved.skill,
    status: after.status,
    material,
    result,
    beforeMaterials,
    afterMaterials: await mapping._materials({ skill: saved.skill }),
    beforeVersion: before.current,
    afterVersion: after.current,
    newVersionCreated: before.current !== after.current,
    sourceNote: "Both material IDs are demo placeholders. No files have been imported.",
  }, null, 2));
} finally {
  await client.close();
}
