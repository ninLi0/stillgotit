import type { Db } from "mongodb";

// Empties every collection in a generated test database. Indexes stay in
// place, so each test starts from a clean state with the same concept.
export async function clearCollections(db: Db) {
  if (!db.databaseName.startsWith("stillgotit_test_")) {
    throw new Error("Only a generated test database can be cleared.");
  }
  const collections = await db.listCollections({ type: "collection" }, { nameOnly: true }).toArray();
  await Promise.all(collections
    .filter(({ name }) => !name.startsWith("system."))
    .map(({ name }) => db.collection(name).deleteMany({})));
}
