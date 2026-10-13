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

  const title = "Identify compatible matrix dimensions";
  let saved = (await mapping._skills({ unit: unit.unit })).find((record) => record.title === title);
  if (!saved) {
    const { skill } = await mapping.propose({
      owner,
      unit: unit.unit,
      title,
      outcome: "Identify compatible matrix dimensions and the dimensions of their product.",
      gate: "Explain whether two given matrices can be multiplied and give the result's dimensions.",
      // Placeholder identity for the concept demo. No file has been imported.
      materials: ["demo-material-matrix-dimensions"],
    });
    const [record] = await mapping._skill({ skill });
    if (!record) throw new Error("The demo skill was not found.");
    saved = { skill, ...record };
  }

  const beforeStatus = saved.status;
  if (saved.status === "DRAFT") {
    await mapping.confirm({ owner, skill: saved.skill });
  } else if (saved.status !== "CONFIRMED") {
    throw new Error("This demo skill is archived. It cannot be confirmed as a draft.");
  }
  const [after] = await mapping._skill({ skill: saved.skill });
  if (!after) throw new Error("The confirmed skill was not found.");
  console.log(JSON.stringify({
    skill: saved.skill,
    beforeStatus,
    afterStatus: after.status,
    confirmedNow: beforeStatus === "DRAFT",
    beforeVersion: saved.current,
    afterVersion: after.current,
    requirements: await mapping._version({ version: after.current }),
    materials: await mapping._materials({ skill: saved.skill }),
    sourceNote: "The material ID is a demo placeholder. File import and source access checks are not implemented yet.",
  }, null, 2));
} finally {
  await client.close();
}
