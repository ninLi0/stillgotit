import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Styling } from "../src/concepts/Styling/Styling.ts";
import { styling } from "../src/concepts/Styling/registry.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
// Two clients on the same database stand in for two server processes, or a laptop and a phone.
let laptop: Awaited<ReturnType<typeof connectMongo>> | undefined;
let phone: Awaited<ReturnType<typeof connectMongo>> | undefined;

beforeAll(async () => {
  laptop = await connectMongo({ uri, database });
  phone = await connectMongo({ uri, database });
});
// Every test starts from an empty database.
beforeEach(async () => { await laptop!.db.dropDatabase(); });
afterAll(async () => {
  try { if (laptop) await laptop.db.dropDatabase(); }
  finally { await Promise.all([laptop?.client.close(), phone?.client.close()]); }
});

// Raw reads only compare stored state before and after an action. Tests create records through actions.
async function savedState(): Promise<Record<string, Document[]>> {
  const collections = await laptop!.db.listCollections({}, { nameOnly: true }).toArray();
  return Object.fromEntries(await Promise.all(collections.map(async ({ name }) =>
    [name, await laptop!.db.collection(name).find().sort({ _id: 1 }).toArray()] as const)));
}
const savedCount = async () => Object.values(await savedState()).reduce((total, documents) => total + documents.length, 0);

const onLaptop = () => new Styling<string, string, string>(laptop!.db, "TreeStyling");
const onPhone = () => new Styling<string, string, string>(phone!.db, "TreeStyling");

describe("Styling", () => {
  test("the registration matches the specification", () => {
    // registerConcept checks the class against the specification's actions and queries when the module loads.
    expect(styling).toBeDefined();
  });

  test("choose then read, and a later choice for the same item replaces the earlier style", async () => {
    const styles = onLaptop();
    await styles.choose({ owner: "maya", item: "vectors", style: "willow" });
    expect(await styles._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "willow" }]);
    await styles.choose({ owner: "maya", item: "vectors", style: "pine" });
    await styles.choose({ owner: "maya", item: "vectors", style: "oak" });
    expect(await styles._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "oak" }]);
    expect(await styles._styles({ owner: "maya" })).toEqual([{ item: "vectors", style: "oak" }]);
    // Each owner and item pair has one style at a time, so replacing never adds a second record.
    expect(await savedCount()).toBe(1);
  });

  test("clear removes the style, and a clear with nothing saved succeeds without a change", async () => {
    const styles = onLaptop();
    // Nothing has ever been saved, not even the collection.
    const empty = await savedState();
    expect(await styles.clear({ owner: "maya", item: "vectors" })).toEqual({});
    expect(await savedState()).toEqual(empty);

    await styles.choose({ owner: "maya", item: "vectors", style: "willow" });
    await styles.choose({ owner: "maya", item: "matrices", style: "pine" });
    expect(await styles.clear({ owner: "maya", item: "vectors" })).toEqual({});
    expect(await styles._style({ owner: "maya", item: "vectors" })).toEqual([]);
    // Clearing again succeeds and changes nothing, and the other item keeps its style.
    const cleared = await savedState();
    expect(await styles.clear({ owner: "maya", item: "vectors" })).toEqual({});
    expect(await savedState()).toEqual(cleared);
    expect(await styles._style({ owner: "maya", item: "matrices" })).toEqual([{ style: "pine" }]);

    // A cleared item can be styled again.
    await styles.choose({ owner: "maya", item: "vectors", style: "cherry" });
    expect(await styles._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "cherry" }]);
  });

  test("two owners do not see or change each other's styles, even for the same item", async () => {
    const styles = onLaptop();
    // The same item key under two owners stands in for an application whose items are not unique across owners.
    await styles.choose({ owner: "maya", item: "shared", style: "willow" });
    await styles.choose({ owner: "sam", item: "shared", style: "palm" });
    expect(await styles._style({ owner: "maya", item: "shared" })).toEqual([{ style: "willow" }]);
    expect(await styles._style({ owner: "sam", item: "shared" })).toEqual([{ style: "palm" }]);

    await styles.choose({ owner: "sam", item: "shared", style: "baobab" });
    expect(await styles._style({ owner: "maya", item: "shared" })).toEqual([{ style: "willow" }]);
    await styles.clear({ owner: "sam", item: "shared" });
    expect(await styles._styles({ owner: "sam" })).toEqual([]);
    expect(await styles._styles({ owner: "maya" })).toEqual([{ item: "shared", style: "willow" }]);
    // Clearing for Leo, who never chose, leaves the others alone.
    await styles.clear({ owner: "leo", item: "shared" });
    expect(await styles._style({ owner: "maya", item: "shared" })).toEqual([{ style: "willow" }]);
    expect(await savedCount()).toBe(1);
  });

  test("_styles lists only the owner's items, ordered by item", async () => {
    const styles = onLaptop();
    expect(await styles._styles({ owner: "maya" })).toEqual([]);
    // Chosen out of order, so the ordering comes from the query and not from the order of the writes.
    await styles.choose({ owner: "maya", item: "unit-c", style: "spruce" });
    await styles.choose({ owner: "maya", item: "unit-a", style: "birch" });
    await styles.choose({ owner: "sam", item: "unit-b", style: "maple" });
    await styles.choose({ owner: "maya", item: "unit-b", style: "bonsai" });
    expect(await styles._styles({ owner: "maya" })).toEqual([
      { item: "unit-a", style: "birch" },
      { item: "unit-b", style: "bonsai" },
      { item: "unit-c", style: "spruce" },
    ]);
    expect(await styles._styles({ owner: "sam" })).toEqual([{ item: "unit-b", style: "maple" }]);
  });

  test("across clients the later write wins", async () => {
    const laptopStyles = onLaptop(), phoneStyles = onPhone();
    await laptopStyles.choose({ owner: "maya", item: "vectors", style: "willow" });
    await phoneStyles.choose({ owner: "maya", item: "vectors", style: "oak" });
    expect(await laptopStyles._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "oak" }]);
    await laptopStyles.clear({ owner: "maya", item: "vectors" });
    expect(await phoneStyles._style({ owner: "maya", item: "vectors" })).toEqual([]);
  });

  test("concurrent first choices from two clients leave exactly one saved style for each item", async () => {
    const laptopStyles = onLaptop(), phoneStyles = onPhone();
    // Many first-time items race at once, so both clients try to create the same record together.
    const items = Array.from({ length: 25 }, (_, index) => `unit-${String(index).padStart(2, "0")}`);
    const results = await Promise.all(items.flatMap((item) => [
      laptopStyles.choose({ owner: "maya", item, style: "willow" }),
      phoneStyles.choose({ owner: "maya", item, style: "oak" }),
    ]));
    expect(results).toEqual(Array.from({ length: items.length * 2 }, () => ({})));
    expect(await savedCount()).toBe(items.length);
    const listed = await laptopStyles._styles({ owner: "maya" });
    expect(listed.map(({ item }) => item)).toEqual(items);
    // The order of two concurrent writes is not observable, so each saved style is whichever write came last.
    for (const { style } of listed) expect(["willow", "oak"]).toContain(style);

    // A choice racing a clear leaves either that style or none, never anything else.
    await Promise.all(items.flatMap((item) => [
      laptopStyles.clear({ owner: "maya", item }),
      phoneStyles.choose({ owner: "maya", item, style: "palm" }),
    ]));
    for (const item of items) {
      expect([[], [{ style: "palm" }]]).toContainEqual(await phoneStyles._style({ owner: "maya", item }));
    }
    expect(await savedCount()).toBeLessThanOrEqual(items.length);
  });

  test("a fresh instance on the same database reads the saved styles", async () => {
    await onLaptop().choose({ owner: "maya", item: "vectors", style: "willow" });
    // A new instance on another client stands in for a restarted server.
    expect(await onPhone()._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "willow" }]);
  });

  test("styles are stored and returned unchanged", async () => {
    type Look = { kind: string; season: string };
    const styles = new Styling<string, string, Look>(laptop!.db, "TreeStyling");
    const look = { kind: "maple", season: "AUTUMN" };
    await styles.choose({ owner: "maya", item: "vectors", style: look });
    expect(await styles._style({ owner: "maya", item: "vectors" })).toEqual([{ style: { kind: "maple", season: "AUTUMN" } }]);
    // The concept never interprets a style. Validating it is the application's job.
    const unusual = { kind: "", season: "not a season" };
    await styles.choose({ owner: "maya", item: "vectors", style: unusual });
    expect(await styles._styles({ owner: "maya" })).toEqual([{ item: "vectors", style: unusual }]);
    expect(look).toEqual({ kind: "maple", season: "AUTUMN" });
  });

  test("instances with different names keep separate styles", async () => {
    const trees = new Styling<string, string, string>(laptop!.db, "TreeStyling");
    const other = new Styling<string, string, string>(laptop!.db, "OtherStyling");
    await trees.choose({ owner: "maya", item: "vectors", style: "willow" });
    expect(await other._styles({ owner: "maya" })).toEqual([]);
    await other.choose({ owner: "maya", item: "vectors", style: "blue" });
    await other.clear({ owner: "maya", item: "vectors" });
    expect(await trees._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "willow" }]);
    // The default name is the concept's own name.
    await new Styling<string, string, string>(laptop!.db).choose({ owner: "maya", item: "vectors", style: "pine" });
    expect(await trees._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "willow" }]);
    expect(await new Styling<string, string, string>(laptop!.db, "Styling")._style({ owner: "maya", item: "vectors" })).toEqual([{ style: "pine" }]);
  });
});
