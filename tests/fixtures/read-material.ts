import { MaterialKeeping, type Material } from "../../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, name, material] = process.argv.slice(2);
if (!database?.startsWith("stillgotit_test_") || !name || !material) {
  throw new Error("Provide a test database, concept name, and material ID.");
}

const { client, db } = await connectMongo({ uri: process.env.MONGODB_TEST_URI, database });
try {
  const library = new MaterialKeeping(db, name);
  const [saved] = await library._material({ material: material as Material });
  if (!saved) throw new Error("The saved material was not found.");
  console.log(JSON.stringify({
    saved,
    materials: await library._materials({ owner: saved.owner, scope: saved.scope }),
  }));
} finally {
  await client.close();
}
