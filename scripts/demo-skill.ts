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

  const title = "Multiply matrices";
  let saved = (await mapping._skills({ unit: unit.unit })).find(
    (record) => record.title === title,
  );
  if (!saved) {
    const { skill } = await mapping.propose({ proposalKey: crypto.randomUUID(),
      owner,
      unit: unit.unit,
      title,
      outcome: "Multiply compatible matrices and explain how each entry is calculated.",
      gate: "Solve two fresh matrix multiplication problems without hints. Show each step, give correct results, and explain the dimensions and row-column products.",
      materials: [],
    });
    const [record] = await mapping._skill({ skill });
    if (!record) throw new Error("The saved draft was not found.");
    saved = { skill, title: record.title, current: record.current, status: record.status };
    console.log("Created the draft skill. Add a source before confirmation.");
  } else {
    console.log("Read the saved draft skill.");
  }

  const [requirements] = await mapping._version({ version: saved.current });
  console.log(JSON.stringify({
    course: course.title,
    unit: unit.title,
    ...saved,
    requirements,
    materials: await mapping._materials({ skill: saved.skill }),
    prerequisites: await mapping._prerequisites({ skill: saved.skill }),
  }, null, 2));
} finally {
  await client.close();
}
