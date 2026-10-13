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
  const draft = (await mapping._skills({ unit: unit.unit })).find(
    (record) => record.title === "Multiply matrices" && record.status === "DRAFT",
  );
  if (!draft) throw new Error("Create the demo draft first: bun run demo:skill");
  const [before] = await mapping._version({ version: draft.current });
  if (!before) throw new Error("The draft's requirements were not found.");

  const addition = "Explain why an incompatible pair cannot be multiplied.";
  const gate = before.gate.includes(addition) ? before.gate : `${before.gate} ${addition}`;
  const materials = (await mapping._materials({ skill: draft.skill })).map((row) => row.material);
  await mapping.reviseDraft({
    owner,
    skill: draft.skill,
    unit: unit.unit,
    title: draft.title,
    outcome: before.outcome,
    gate,
    materials,
  });
  const [after] = await mapping._skill({ skill: draft.skill });
  if (!after) throw new Error("The revised draft was not found.");
  console.log(JSON.stringify({
    skill: draft.skill,
    status: after.status,
    beforeVersion: draft.current,
    afterVersion: after.current,
    newVersionCreated: draft.current !== after.current,
    beforeRequirements: await mapping._version({ version: draft.current }),
    afterRequirements: await mapping._version({ version: after.current }),
  }, null, 2));
} finally {
  await client.close();
}
