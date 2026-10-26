import { MongoClient } from "mongodb";

// Drops the `stillgotit_test_<id>` databases that interrupted test runs or stopped fixtures left behind.
// A test file drops its own database when it finishes, so these only pile up after a run is killed.
// Too many of them push the local MongoDB container past its open-file limit, and every suite then fails.
// `--list` prints the count without dropping anything. The app's own database is never touched.
const list = process.argv.includes("--list");
const client = new MongoClient("mongodb://127.0.0.1:27017/?directConnection=true", { serverSelectionTimeoutMS: 20_000 });

try {
  await client.connect();
  const { databases } = await client.db("admin").command({ listDatabases: 1, nameOnly: true });
  const names = (databases as { name: string }[]).map((entry) => entry.name).filter((name) => name.startsWith("stillgotit_test_"));
  if (list) { console.log(`${names.length} leftover test database(s).`); }
  else {
    for (const name of names) await client.db(name).dropDatabase();
    console.log(`Dropped ${names.length} leftover test database(s).`);
  }
} finally {
  await client.close();
}
