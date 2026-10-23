import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { Preferring } from "../src/concepts/Preferring/Preferring.ts";
import { preferring } from "../src/concepts/Preferring/registry.ts";
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

type Pace = "QUICK" | "BALANCED" | "THOROUGH";
const onLaptop = () => new Preferring<string, Pace>(laptop!.db, "TutorPreferring");
const onPhone = () => new Preferring<string, Pace>(phone!.db, "TutorPreferring");

describe("Preferring", () => {
  test("the registration matches the specification", () => {
    // registerConcept checks the class against the specification's actions and queries when the module loads.
    expect(preferring).toBeDefined();
  });

  test("principle: a choice follows its user to every device, repeats change nothing, and clearing restores no choice", async () => {
    const laptopPreferring = onLaptop(), phonePreferring = onPhone();
    // Maya has chosen nothing, so the application would use its own default.
    expect(await laptopPreferring._choice({ user: "maya" })).toEqual([]);

    expect(await laptopPreferring.set({ user: "maya", option: "THOROUGH" })).toEqual({});
    expect(await phonePreferring._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    // Sam still has no choice. Maya's choice is hers alone.
    expect(await phonePreferring._choice({ user: "sam" })).toEqual([]);

    // The reply was lost, so the laptop sends the same choice again. Nothing changes.
    const before = await savedState();
    expect(await laptopPreferring.set({ user: "maya", option: "THOROUGH" })).toEqual({});
    expect(await savedState()).toEqual(before);

    expect(await laptopPreferring.set({ user: "maya", option: "QUICK" })).toEqual({});
    expect(await laptopPreferring._choice({ user: "maya" })).toEqual([{ option: "QUICK" }]);
    expect(await phonePreferring._choice({ user: "maya" })).toEqual([{ option: "QUICK" }]);

    expect(await phonePreferring.clear({ user: "maya" })).toEqual({});
    expect(await laptopPreferring._choice({ user: "maya" })).toEqual([]);
    expect(await savedCount()).toBe(0);
    // Clearing a second time succeeds and changes nothing.
    const cleared = await savedState();
    expect(await phonePreferring.clear({ user: "maya" })).toEqual({});
    expect(await savedState()).toEqual(cleared);
    expect(await laptopPreferring._choice({ user: "maya" })).toEqual([]);
  });

  test("set then read, and a later set replaces the earlier option", async () => {
    const preferences = onLaptop();
    await preferences.set({ user: "maya", option: "BALANCED" });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "BALANCED" }]);
    await preferences.set({ user: "maya", option: "THOROUGH" });
    await preferences.set({ user: "maya", option: "QUICK" });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "QUICK" }]);
    // Each user has one option at a time, so replacing never adds a second record.
    expect(await savedCount()).toBe(1);
  });

  test("clear removes the choice, and a clear with nothing saved succeeds without a change", async () => {
    const preferences = onLaptop();
    // Nothing has ever been saved, not even the collection.
    const empty = await savedState();
    expect(await preferences.clear({ user: "maya" })).toEqual({});
    expect(await savedState()).toEqual(empty);

    await preferences.set({ user: "maya", option: "THOROUGH" });
    expect(await preferences.clear({ user: "maya" })).toEqual({});
    expect(await preferences._choice({ user: "maya" })).toEqual([]);
    expect(await preferences.clear({ user: "maya" })).toEqual({});
    expect(await preferences._choice({ user: "maya" })).toEqual([]);

    // A cleared user can choose again.
    await preferences.set({ user: "maya", option: "QUICK" });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "QUICK" }]);
  });

  test("two users do not see or change each other's choice", async () => {
    const preferences = onLaptop();
    await preferences.set({ user: "maya", option: "THOROUGH" });
    await preferences.set({ user: "sam", option: "QUICK" });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    expect(await preferences._choice({ user: "sam" })).toEqual([{ option: "QUICK" }]);

    await preferences.set({ user: "sam", option: "BALANCED" });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    await preferences.clear({ user: "sam" });
    expect(await preferences._choice({ user: "sam" })).toEqual([]);
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    // Clearing Leo, who never chose, leaves both others alone.
    await preferences.clear({ user: "leo" });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    expect(await savedCount()).toBe(1);
  });

  test("across clients the later write wins", async () => {
    const laptopPreferring = onLaptop(), phonePreferring = onPhone();
    await laptopPreferring.set({ user: "maya", option: "THOROUGH" });
    await phonePreferring.set({ user: "maya", option: "QUICK" });
    expect(await laptopPreferring._choice({ user: "maya" })).toEqual([{ option: "QUICK" }]);
    await laptopPreferring.clear({ user: "maya" });
    expect(await phonePreferring._choice({ user: "maya" })).toEqual([]);
  });

  test("concurrent sets from two clients leave exactly one saved choice", async () => {
    const laptopPreferring = onLaptop(), phonePreferring = onPhone();
    // Many first-time users race at once, so both clients try to create the same user's record together.
    const users = Array.from({ length: 25 }, (_, index) => `learner-${index}`);
    const results = await Promise.all(users.flatMap((user) => [
      laptopPreferring.set({ user, option: "THOROUGH" }),
      phonePreferring.set({ user, option: "QUICK" }),
    ]));
    expect(results).toEqual(Array.from({ length: users.length * 2 }, () => ({})));
    expect(await savedCount()).toBe(users.length);
    for (const user of users) {
      // The order of two concurrent writes is not observable, so the saved choice is whichever write came last.
      const [saved] = await laptopPreferring._choice({ user });
      expect(["THOROUGH", "QUICK"]).toContain(saved!.option);
      expect(await laptopPreferring._choice({ user })).toEqual([saved!]);
      expect(await phonePreferring._choice({ user })).toEqual([saved!]);
    }

    // A set racing a clear leaves either that option or no choice, never anything else.
    await Promise.all(users.flatMap((user) => [
      laptopPreferring.clear({ user }),
      phonePreferring.set({ user, option: "BALANCED" }),
    ]));
    for (const user of users) {
      expect([[], [{ option: "BALANCED" }]]).toContainEqual(await phonePreferring._choice({ user }));
    }
    expect(await savedCount()).toBeLessThanOrEqual(users.length);
  });

  test("a fresh instance on the same database reads the saved choice", async () => {
    await onLaptop().set({ user: "maya", option: "THOROUGH" });
    // A new instance on another client stands in for a restarted server.
    expect(await onPhone()._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    expect(await new Preferring<string, Pace>(laptop!.db, "TutorPreferring")._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
  });

  test("options are stored and returned unchanged", async () => {
    type Choice = { model: string; level: string };
    const preferences = new Preferring<string, Choice>(laptop!.db, "TutorPreferring");
    const option = { model: "Any Model-1.0", level: "MEDIUM" };
    await preferences.set({ user: "maya", option });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: { model: "Any Model-1.0", level: "MEDIUM" } }]);
    // The concept never interprets an option. Validating it is the application's job.
    const unusual = { model: "", level: "not a level" };
    await preferences.set({ user: "maya", option: unusual });
    expect(await preferences._choice({ user: "maya" })).toEqual([{ option: unusual }]);
    expect(option).toEqual({ model: "Any Model-1.0", level: "MEDIUM" });
  });

  test("instances with different names keep separate choices", async () => {
    const tutor = new Preferring<string, string>(laptop!.db, "TutorPreferring");
    const other = new Preferring<string, string>(laptop!.db, "OtherPreferring");
    await tutor.set({ user: "maya", option: "THOROUGH" });
    expect(await other._choice({ user: "maya" })).toEqual([]);
    await other.set({ user: "maya", option: "dark" });
    await other.clear({ user: "maya" });
    expect(await tutor._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    // The default name is the concept's own name.
    await new Preferring<string, string>(laptop!.db).set({ user: "maya", option: "QUICK" });
    expect(await tutor._choice({ user: "maya" })).toEqual([{ option: "THOROUGH" }]);
    expect(await new Preferring<string, string>(laptop!.db, "Preferring")._choice({ user: "maya" })).toEqual([{ option: "QUICK" }]);
  });
});
