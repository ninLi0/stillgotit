import { SkillMapping } from "../../src/concepts/SkillMapping.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, skill, previousVersion] = process.argv.slice(2);
if (!database || !skill) throw new Error("Provide a test database and skill ID.");

const { client, db } = await connectMongo({
  uri: process.env.MONGODB_TEST_URI,
  database,
});
try {
  const mapping = new SkillMapping(db);
  const [record] = await mapping._skill({ skill });
  if (!record) throw new Error("The saved skill was not found.");
  console.log(JSON.stringify({
    ...record,
    requirements: await mapping._version({ version: record.current }),
    materials: await mapping._materials({ skill }),
    prerequisites: await mapping._prerequisites({ skill }),
    previousRequirements: previousVersion
      ? await mapping._version({ version: previousVersion })
      : undefined,
  }));
} finally {
  await client.close();
}
