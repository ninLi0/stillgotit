import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo } from "../src/storage/mongo.ts";

const { client, db } = await connectMongo();

try {
  const skills = await createSkillMapping(db);
  const owner = "demo-learner";
  let courses = await skills._courses({ owner });

  if (courses.length === 0) {
    await skills.createCourse({
      owner,
      title: "MIT 18.06SC Linear Algebra",
    });
    console.log("Created the demo course.");
    courses = await skills._courses({ owner });
  } else {
    console.log("Read the saved demo course.");
  }

  console.log(JSON.stringify(courses, null, 2));
} finally {
  await client.close();
}
