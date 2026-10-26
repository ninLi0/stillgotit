import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Styling } from "../src/concepts/Styling/Styling.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
// Two clients on the same database stand in for Maya's laptop and her phone.
let laptop: Awaited<ReturnType<typeof connectMongo>> | undefined;
let phone: Awaited<ReturnType<typeof connectMongo>> | undefined;

beforeAll(async () => {
  laptop = await connectMongo({ uri, database });
  phone = await connectMongo({ uri, database });
});
beforeEach(async () => { await laptop!.db.dropDatabase(); });
afterAll(async () => {
  try { if (laptop) await laptop.db.dropDatabase(); }
  finally { await Promise.all([laptop?.client.close(), phone?.client.close()]); }
});

// Raw reads only compare stored state before and after an action. The story creates records through actions.
async function savedState(): Promise<Record<string, Document[]>> {
  const collections = await laptop!.db.listCollections({}, { nameOnly: true }).toArray();
  return Object.fromEntries(await Promise.all(collections.map(async ({ name }) =>
    [name, await laptop!.db.collection(name).find().sort({ _id: 1 }).toArray()] as const)));
}

describe("Styling principle", () => {
  test("a style chosen for one item follows its owner to every device, replaces only that item's style, and clears back to none", async () => {
    const onLaptop = new Styling<string, string, string>(laptop!.db, "TreeStyling");
    const onPhone = new Styling<string, string, string>(phone!.db, "TreeStyling");

    // Maya has two topics, Vectors and Matrices, and has chosen nothing, so the application draws its own defaults.
    expect(await onLaptop._style({ owner: "maya", item: "vectors" })).toEqual([]);
    expect(await onLaptop._style({ owner: "maya", item: "matrices" })).toEqual([]);
    expect(await onLaptop._styles({ owner: "maya" })).toEqual([]);

    // On her laptop she chooses willow for Vectors. Her phone sees it too, and Matrices still has no style.
    expect(await onLaptop.choose({ owner: "maya", item: "vectors", style: "willow" })).toEqual({});
    expect(await onPhone._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "willow" }]);
    expect(await onPhone._style({ owner: "maya", item: "matrices" })).toEqual([]);
    // Sam chose nothing. Maya's choice is hers alone.
    expect(await onPhone._styles({ owner: "sam" })).toEqual([]);
    expect(await onPhone._style({ owner: "sam", item: "vectors" })).toEqual([]);

    // She chooses pine for Matrices, and both items are now listed, ordered by item.
    expect(await onPhone.choose({ owner: "maya", item: "matrices", style: "pine" })).toEqual({});
    expect(await onLaptop._styles({ owner: "maya" })).toEqual([
      { item: "matrices", style: "pine" },
      { item: "vectors", style: "willow" },
    ]);

    // The reply to that choice was lost, so the laptop sends pine for Matrices again. Nothing changes.
    const before = await savedState();
    expect(await onLaptop.choose({ owner: "maya", item: "matrices", style: "pine" })).toEqual({});
    expect(await savedState()).toEqual(before);

    // Later she chooses oak for Vectors, which replaces willow and leaves Matrices as it was.
    expect(await onLaptop.choose({ owner: "maya", item: "vectors", style: "oak" })).toEqual({});
    expect(await onPhone._styles({ owner: "maya" })).toEqual([
      { item: "matrices", style: "pine" },
      { item: "vectors", style: "oak" },
    ]);

    // Finally she clears Vectors. It has no style again, so the application's default applies, and Matrices keeps pine.
    expect(await onPhone.clear({ owner: "maya", item: "vectors" })).toEqual({});
    expect(await onLaptop._style({ owner: "maya", item: "vectors" })).toEqual([]);
    expect(await onLaptop._styles({ owner: "maya" })).toEqual([{ item: "matrices", style: "pine" }]);

    // Clearing Vectors a second time changes nothing.
    const cleared = await savedState();
    expect(await onLaptop.clear({ owner: "maya", item: "vectors" })).toEqual({});
    expect(await savedState()).toEqual(cleared);
    expect(await onPhone._styles({ owner: "maya" })).toEqual([{ item: "matrices", style: "pine" }]);
  });
});
