import { SkillMapping } from "../../src/concepts/SkillMapping.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, unit, skill, ...versions] = process.argv.slice(2);
if (!database || !unit || !skill) throw new Error("Provide a test database, unit, and skill ID.");

const { client, db } = await connectMongo({
  uri: process.env.MONGODB_TEST_URI,
  database,
});
try {
  const mapping = new SkillMapping(db);
  console.log(JSON.stringify({
    skill: await mapping._skill({ skill }),
    skills: await mapping._skills({ unit }),
    versions: await Promise.all(versions.map((version) => mapping._version({ version }))),
    materials: await mapping._materials({ skill }),
    prerequisites: await mapping._prerequisites({ skill }),
  }));
} finally {
  await client.close();
}
