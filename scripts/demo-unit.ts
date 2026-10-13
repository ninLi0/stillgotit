import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo } from "../src/storage/mongo.ts";

const { client, db } = await connectMongo();

try {
  const skills = await createSkillMapping(db);
  const owner = "demo-learner";
  const [course] = await skills._courses({ owner });
  if (!course) {
    throw new Error("Create the demo course first: bun run demo:course");
  }

  const title = "Matrix multiplication";
  let units = await skills._units({ course: course.course });
  if (!units.some((unit) => unit.title === title)) {
    await skills.addUnit({ owner, course: course.course, title });
    console.log("Created the demo unit.");
    units = await skills._units({ course: course.course });
  } else {
    console.log("Read the saved demo unit.");
  }

  console.log(JSON.stringify({ ...course, units }, null, 2));
} finally {
  await client.close();
}
