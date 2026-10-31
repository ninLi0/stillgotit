import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Archiving } from "../src/concepts/Archiving/Archiving.ts";
import { archiving } from "../src/concepts/Archiving/registry.ts";
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

/** A clock the test moves by hand, so archive times are exact. */
function testClock(start = "2026-10-28T15:00:00Z") {
  let now = Date.parse(start);
  return { clock: () => new Date(now), advance: (ms: number) => { now += ms; } };
}
const onLaptop = (clock?: () => Date) => new Archiving<string, string>(laptop!.db, "ConversationArchiving", clock);
const onPhone = (clock?: () => Date) => new Archiving<string, string>(phone!.db, "ConversationArchiving", clock);

describe("Archiving principle", () => {
  test("an archived item leaves the owner's list, a repeated archive keeps its time, and restoring brings it back once", async () => {
    const time = testClock(), shelf = onLaptop(time.clock);
    // Maya lists three conversations and is done with the one about transposes, so she archives it.
    expect(await shelf._items({ owner: "maya" })).toEqual([]);
    expect(await shelf.archive({ owner: "maya", item: "transposes" })).toEqual({});
    const archivedAt = time.clock();
    expect(await shelf._archived({ owner: "maya", item: "transposes" })).toEqual([{ archivedAt }]);
    expect(await shelf._items({ owner: "maya" })).toEqual([{ item: "transposes", archivedAt }]);
    expect(await shelf._itemSet({ owner: "maya" })).toEqual({ items: ["transposes"] });
    // Sam has archived nothing; Maya's choice is hers alone.
    expect(await shelf._archived({ owner: "sam", item: "transposes" })).toEqual([]);
    expect(await shelf._itemSet({ owner: "sam" })).toEqual({ items: [] });
    // The reply was lost and her browser sends the archive again: nothing changes, and the first time is kept.
    time.advance(60_000);
    const before = await savedState();
    expect(await shelf.archive({ owner: "maya", item: "transposes" })).toEqual({});
    expect(await savedState()).toEqual(before);
    expect(await shelf._archived({ owner: "maya", item: "transposes" })).toEqual([{ archivedAt }]);
    // A week later she restores it, and it is no longer archived. Restoring a second time changes nothing.
    time.advance(7 * 86_400_000);
    expect(await shelf.restore({ owner: "maya", item: "transposes" })).toEqual({});
    expect(await shelf._archived({ owner: "maya", item: "transposes" })).toEqual([]);
    expect(await shelf._items({ owner: "maya" })).toEqual([]);
    const restored = await savedState();
    expect(await shelf.restore({ owner: "maya", item: "transposes" })).toEqual({});
    expect(await savedState()).toEqual(restored);
  });
});

describe("Archiving", () => {
  test("the registration matches the specification", () => {
    // registerConcept checks the class against the specification's actions and queries when the module loads.
    expect(archiving).toBeDefined();
  });

  test("items are listed most recently archived first, items archived together by item, and the set by item", async () => {
    const time = testClock(), shelf = onLaptop(time.clock);
    await shelf.archive({ owner: "maya", item: "c-oldest" });
    const first = time.clock();
    time.advance(1000);
    // Two items archived at the same moment are ordered by item.
    await shelf.archive({ owner: "maya", item: "b-same" });
    await shelf.archive({ owner: "maya", item: "a-same" });
    const second = time.clock();
    time.advance(1000);
    await shelf.archive({ owner: "maya", item: "d-newest" });
    const third = time.clock();
    await shelf.archive({ owner: "sam", item: "z-sams" });
    expect(await shelf._items({ owner: "maya" })).toEqual([
      { item: "d-newest", archivedAt: third }, { item: "a-same", archivedAt: second }, { item: "b-same", archivedAt: second }, { item: "c-oldest", archivedAt: first }]);
    expect(await shelf._itemSet({ owner: "maya" })).toEqual({ items: ["a-same", "b-same", "c-oldest", "d-newest"] });
    expect(await shelf._items({ owner: "sam" })).toEqual([{ item: "z-sams", archivedAt: third }]);
  });

  test("restoring one item leaves the owner's other items and other owners' items as they were", async () => {
    const shelf = onLaptop();
    for (const item of ["one", "two"]) await shelf.archive({ owner: "maya", item });
    await shelf.archive({ owner: "sam", item: "one" });
    await shelf.restore({ owner: "maya", item: "one" });
    expect((await shelf._items({ owner: "maya" })).map(({ item }) => item)).toEqual(["two"]);
    expect((await shelf._items({ owner: "sam" })).map(({ item }) => item)).toEqual(["one"]);
    // Restoring an item the owner never archived changes nothing, even when another owner archived it.
    const before = await savedState();
    await shelf.restore({ owner: "alex", item: "two" });
    expect(await savedState()).toEqual(before);
  });

  test("two concurrent archives of one item, from two processes, add one archived item", async () => {
    const [laptopShelf, phoneShelf] = [onLaptop(), onPhone()];
    await Promise.all([laptopShelf.archive({ owner: "maya", item: "transposes" }), phoneShelf.archive({ owner: "maya", item: "transposes" }),
      laptopShelf.archive({ owner: "maya", item: "transposes" })]);
    const saved = await laptop!.db.collection("conversationarchiving.items").find({}).toArray();
    expect(saved).toHaveLength(1);
    // A new instance, as after a restart, reads the same state.
    expect(await new Archiving<string, string>(laptop!.db, "ConversationArchiving")._itemSet({ owner: "maya" })).toEqual({ items: ["transposes"] });
  });

  test("a blank owner or item is refused before anything is saved", async () => {
    const shelf = onLaptop();
    for (const [owner, item] of [["", "item"], ["maya", " "], ["maya", undefined]] as const) {
      await expect(shelf.archive({ owner, item: item as unknown as string })).rejects.toThrow(TypeError);
      await expect(shelf.restore({ owner, item: item as unknown as string })).rejects.toThrow(TypeError);
      await expect(shelf._archived({ owner, item: item as unknown as string })).rejects.toThrow(TypeError);
    }
    await expect(shelf._items({ owner: "" })).rejects.toThrow(TypeError);
    await expect(shelf._itemSet({ owner: " " })).rejects.toThrow(TypeError);
    expect(await savedState()).toEqual({});
  });
});
