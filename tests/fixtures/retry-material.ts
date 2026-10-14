import { GroundedTutoring } from "../../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, name] = process.argv.slice(2);
if (!database?.startsWith("stillgotit_test_") || !name) {
  throw new Error("Provide a test database and concept name.");
}
const input = JSON.parse(await Bun.stdin.text());
const { client, db } = await connectMongo({ uri: process.env.MONGODB_TEST_URI, database });
try {
  console.log(JSON.stringify(await new GroundedTutoring(db, name).addMaterial(input)));
} finally {
  await client.close();
}
