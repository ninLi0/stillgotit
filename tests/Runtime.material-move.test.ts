import { afterAll, expect, spyOn, test } from "bun:test";
import type { Db } from "mongodb";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { Material } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// The deployed app saved materials in GroundedTutoring's collection. The runtime moves them once to the Library's collection.
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const owner = "learner-sam" as User, scope = "course-linear-algebra";
const saved = {
  _id: crypto.randomUUID() as Material, owner, importKey: "import-week-3", scope, title: "Week 3 notes", locator: "upload:week-3",
  content: "Entry (i, j) of AB combines row i of A with column j of B.", originals: [], origin: "COURSE" as const,
};

/** A new test database that holds one material in GroundedTutoring's collection, with the indexes GroundedTutoring created. */
async function deployed() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  cleanups.push(async () => { await connection.db.dropDatabase(); await connection.client.close(); });
  const former = connection.db.collection<typeof saved>("groundedtutoring.materials");
  await former.createIndexes([
    { key: { owner: 1, scope: 1, _id: 1 } },
    { key: { owner: 1, importKey: 1 }, unique: true, partialFilterExpression: { importKey: { $type: "string" } } },
  ]);
  await former.insertOne(saved);
  return connection.db;
}

/** Starts the runtime on the database and returns it with every line it logged while starting. */
async function start(database: Db) {
  const log = spyOn(console, "log").mockImplementation(() => {});
  try {
    const runtime = await createRuntime({ database, provider: new MemoryProvider(), providerOrigin: "https://commons.example", publicOrigin: "http://localhost:5173" });
    cleanups.push(() => runtime.gateway.beginDrain());
    return { runtime, logged: log.mock.calls.map((call) => call.join(" ")) };
  } finally {
    log.mockRestore();
  }
}

/** Every document in one of the two material collections. */
async function rows(database: Db, name: "groundedtutoring.materials" | "library.materials") {
  return database.collection<typeof saved>(name).find().toArray();
}

async function materialCollections(database: Db) {
  return (await database.listCollections({}, { nameOnly: true }).toArray()).map(({ name }) => name).filter((name) => name.endsWith(".materials")).sort();
}

test("a material saved under GroundedTutoring moves to the Library and stays readable and retryable", async () => {
  const database = await deployed();
  const { runtime, logged } = await start(database);
  expect(logged).toEqual(["Moved the saved materials from groundedtutoring.materials to library.materials."]);
  expect(await materialCollections(database)).toEqual(["library.materials"]);
  expect(await rows(database, "library.materials")).toEqual([saved]);

  const library = runtime.application.concepts.Library, { _id: material, importKey, ...data } = saved;
  expect(await library._materials({ owner, scope })).toEqual([{ material, title: saved.title, locator: saved.locator, origin: saved.origin }]);
  expect(await library._material({ material })).toEqual([data]);
  // The import key moved with the material, so a retry of the original import still returns it.
  expect(await library.add({ ...data, importKey })).toEqual({ material });
  expect(await rows(database, "library.materials")).toEqual([saved]);
});

test("a later start, or a former collection that appears again after the move, changes nothing", async () => {
  const database = await deployed();
  await start(database);
  const again = await start(database);
  expect(again.logged).toEqual([]);
  expect(await rows(database, "library.materials")).toEqual([saved]);

  // A former collection that appears after the move is left alone, because the Library already has its own.
  const stray = { ...saved, _id: crypto.randomUUID() as Material, importKey: "import-week-4", title: "Week 4 notes" };
  await database.collection<typeof stray>("groundedtutoring.materials").insertOne(stray);
  expect((await start(database)).logged).toEqual([]);
  expect(await materialCollections(database)).toEqual(["groundedtutoring.materials", "library.materials"]);
  expect(await rows(database, "groundedtutoring.materials")).toEqual([stray]);
  expect(await rows(database, "library.materials")).toEqual([saved]);
});

test("a database without the former collection starts with no move", async () => {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  cleanups.push(async () => { await connection.db.dropDatabase(); await connection.client.close(); });
  expect((await start(connection.db)).logged).toEqual([]);
  expect(await materialCollections(connection.db)).toEqual([]);
});
