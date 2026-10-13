import { SkillMapping } from "../../src/concepts/SkillMapping.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, course] = process.argv.slice(2);
if (!database || !course) throw new Error("Provide a test database and course ID.");

const { client, db } = await connectMongo({
  uri: process.env.MONGODB_TEST_URI,
  database,
});
try {
  const skills = new SkillMapping(db);
  console.log(JSON.stringify({
    course: await skills._course({ course }),
    units: await skills._units({ course }),
  }));
} finally {
  await client.close();
}
