import { createSkillMapping } from "../../src/concepts/SkillMapping.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, encoded, mode] = process.argv.slice(2);
if (!database?.startsWith("stillgotit_test_") || !encoded) throw new Error("Provide a test database and proposal input.");
const { client, db } = await connectMongo({ uri: process.env.MONGODB_TEST_URI, database });
try {
  const mapping = await createSkillMapping(db);
  const result = await mapping.propose(JSON.parse(encoded));
  // The write has committed, but this client never delivers its result.
  if (mode === "lose-reply") process.exit(73);
  console.log(JSON.stringify(result));
} finally { await client.close(); }
