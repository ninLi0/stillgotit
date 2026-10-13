import { RegistrationRecoveryStore } from "../../src/storage/RegistrationRecoveryStore.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";

const [database, name, provider, subject] = process.argv.slice(2);
if (!database?.startsWith("stillgotit_test_") || !name || !provider || !subject) {
  throw new Error("Provide a test database, store name, provider, and subject.");
}

const { client, db } = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database });
try {
  const store = new RegistrationRecoveryStore(db, provider, name);
  console.log(JSON.stringify(await store.getOrCreate({ subject })));
} finally {
  await client.close();
}
