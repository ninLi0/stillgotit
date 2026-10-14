import { MaterialImportStore, type ImportIdentity, type ImportRequest } from "../../src/storage/MaterialImportStore.ts";
import { connectMongo } from "../../src/storage/mongo.ts";

const [database, name] = process.argv.slice(2);
if (!database?.startsWith("stillgotit_test_") || !name) {
  throw new Error("Provide a test database and store name.");
}
const input = JSON.parse(await Bun.stdin.text()) as ImportIdentity & { request: ImportRequest };
const { client, db } = await connectMongo({ uri: process.env.MONGODB_TEST_URI, database });
try {
  const store = new MaterialImportStore(db, name);
  console.log(JSON.stringify({
    found: await store.get({ owner: input.owner, requestId: input.requestId }),
    retried: await store.getOrCreate(input),
  }));
} finally {
  await client.close();
}
