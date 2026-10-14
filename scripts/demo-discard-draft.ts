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

  // This run creates and discards its own draft.
  const content = {
    title: "Temporary matrix skill",
    outcome: "Identify compatible matrix dimensions.",
    gate: "Explain whether two given matrices can be multiplied.",
    materials: [],
  };
  const { skill } = await mapping.propose({ proposalKey: crypto.randomUUID(), owner, unit: unit.unit, ...content });
  const firstVersion = (await mapping._skill({ skill }))[0]!.current;
  await mapping.reviseDraft({
    ...content, owner, skill, unit: unit.unit,
    gate: "Explain whether two given matrices can be multiplied and give the result's dimensions.",
  });
  const [before] = await mapping._skill({ skill });
  if (!before) throw new Error("The temporary draft was not found.");
  const versions = [firstVersion, before.current];
  const beforeRequirements = await Promise.all(
    versions.map((version) => mapping._version({ version })),
  );
  const result = await mapping.discardDraft({ owner, skill });
  console.log(JSON.stringify({
    skill,
    before,
    beforeRequirements,
    result,
    afterSkill: await mapping._skill({ skill }),
    afterRequirements: await Promise.all(
      versions.map((version) => mapping._version({ version })),
    ),
    remainingSkills: await mapping._skills({ unit: unit.unit }),
  }, null, 2));
} finally {
  await client.close();
}
