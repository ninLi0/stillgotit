import { Budgeting } from "../src/concepts/Budgeting/Budgeting.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Collection, type Document, type Filter } from "mongodb";
import { assembleApplication } from "../src/assembly.ts";
import { FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import {
  InvalidRecoveryKey,
  RecoveryKeyConflict,
  RegisteringConcept,
  type User,
  UsernameTaken,
} from "../src/concepts/Registering/Registering.ts";
import { SessioningConcept } from "../src/concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredUser {
  _id: User;
  username: string;
  recoveryKey?: string;
}

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
});

afterAll(async () => {
  if (!connection) return;
  try {
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

function setup() {
  const name = `Registering_${randomUUID()}`;
  return {
    name,
    registering: new RegisteringConcept(connection!.db, name),
    records: connection!.db.collection<StoredUser>(`${name.toLowerCase()}.users`),
  };
}

// Hold both real initial reads until each client has seen the key as unused.
// The inserts must then compete at the database, not pass through a local queue.
async function race(
  fixture: ReturnType<typeof setup>,
  inputs: [{ username: string; recoveryKey: string }, { username: string; recoveryKey: string }],
) {
  const secondConnection = await connectMongo({ uri, database });
  const second = new RegisteringConcept(secondConnection.db, fixture.name);
  const original = Collection.prototype.findOne;
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(() => ready.reject(new Error("Both registration reads must arrive.")), 5_000);
  let reads = 0;
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const record = await original.call(this, filter, options);
      if (this.dbName === database && this.collectionName === fixture.records.collectionName
        && filter.recoveryKey !== undefined && reads < 2) {
        expect(record).toBeNull();
        reads += 1;
        if (reads === 2) ready.resolve();
        await ready.promise;
      }
      return record as T | null;
    },
  );
  try {
    const outcomes = await Promise.allSettled([
      fixture.registering.register(inputs[0]), second.register(inputs[1]),
    ]);
    expect(reads).toBe(2);
    return outcomes;
  } finally {
    clearTimeout(timeout);
    read.mockRestore();
    await secondConnection.client.close();
  }
}

describe("Registering recovery", () => {
  test("matching retries return one saved user without changing the account", async () => {
    const { registering, records } = setup();
    const input = { username: "sam", recoveryKey: "R9" };
    const { user } = await registering.register(input);
    const before = [{ _id: user, ...input }];
    expect(await records.find().toArray()).toEqual(before);
    expect(await registering.register(input)).toEqual({ user });
    expect(await registering.register(input)).toEqual({ user });
    expect(await registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([{ user }]);
    expect(await records.find().toArray()).toEqual(before);
  });

  test("blank or missing recovery keys save nothing, and a valid key can follow", async () => {
    const { registering, records } = setup();
    for (const recoveryKey of ["", " ", "\t\n", "\u00a0", undefined, null, 42]) {
      await expect(registering.register({ username: "sam", recoveryKey: recoveryKey as string }))
        .rejects.toThrow(InvalidRecoveryKey);
      expect(await records.countDocuments()).toBe(0);
    }
    const saved = await registering.register({ username: "sam", recoveryKey: "R9" });
    expect(await registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([saved]);
  });

  test("a used key refuses a changed username, including when that name is also taken", async () => {
    const { registering, records } = setup();
    const saved = await registering.register({ username: "sam", recoveryKey: "R9" });
    await registering.register({ username: "other", recoveryKey: "other-key" });
    const before = await records.find().toArray();
    for (const username of ["sam2", "Sam", "other"]) {
      await expect(registering.register({ username, recoveryKey: "R9" })).rejects.toThrow(RecoveryKeyConflict);
      expect(await records.find().toArray()).toEqual(before);
    }
    expect(await registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([saved]);
    expect(await registering._username(saved)).toEqual([{ username: "sam" }]);
  });

  test("a username conflict does not claim the account or reserve the unused key", async () => {
    const { registering, records } = setup();
    const original = await registering.register({ username: "sam", recoveryKey: "R9" });
    const before = await records.find().toArray();
    await expect(registering.register({ username: "sam", recoveryKey: "R10" })).rejects.toThrow(UsernameTaken);
    expect(await registering._byRecoveryKey({ recoveryKey: "R10" })).toEqual([]);
    expect(await records.find().toArray()).toEqual(before);
    const next = await registering.register({ username: "sam2", recoveryKey: "R10" });
    expect(next.user).not.toBe(original.user);
    expect(await registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([original]);
    expect(await registering._byRecoveryKey({ recoveryKey: "R10" })).toEqual([next]);
  });

  test("keys compare exactly without case folding or trimming", async () => {
    const { registering, records } = setup();
    const first = await registering.register({ username: "sam", recoveryKey: "R9" });
    const second = await registering.register({ username: "ben", recoveryKey: "r9" });
    const third = await registering.register({ username: "maya", recoveryKey: " R9 " });
    expect(new Set([first.user, second.user, third.user]).size).toBe(3);
    expect(await registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([first]);
    expect(await registering._byRecoveryKey({ recoveryKey: "r9" })).toEqual([second]);
    expect(await registering._byRecoveryKey({ recoveryKey: " R9 " })).toEqual([third]);
    expect(await records.countDocuments()).toBe(3);
  });

  test("two clients with identical requests both return the same user", async () => {
    const fixture = setup();
    const input = { username: "sam", recoveryKey: "R9" };
    const outcomes = await race(fixture, [input, input]);
    expect(outcomes.every((outcome) => outcome.status === "fulfilled")).toBe(true);
    const [saved] = await fixture.records.find().toArray();
    expect(await fixture.records.countDocuments()).toBe(1);
    expect(outcomes).toEqual([
      { status: "fulfilled", value: { user: saved!._id } },
      { status: "fulfilled", value: { user: saved!._id } },
    ]);
    expect(await fixture.registering._byRecoveryKey(input)).toEqual([{ user: saved!._id }]);
  });

  test("two clients with one key and different names create one user and one key conflict", async () => {
    const fixture = setup();
    const outcomes = await race(fixture, [
      { username: "sam", recoveryKey: "R9" }, { username: "ben", recoveryKey: "R9" },
    ]);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const losers = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reason).toBeInstanceOf(RecoveryKeyConflict);
    expect(await fixture.records.countDocuments()).toBe(1);
    expect(await fixture.registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([winners[0]!.value]);
  });

  test("two clients with one name and different keys create one user and one username conflict", async () => {
    const fixture = setup();
    const outcomes = await race(fixture, [
      { username: "sam", recoveryKey: "R9" }, { username: "sam", recoveryKey: "R10" },
    ]);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const losers = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reason).toBeInstanceOf(UsernameTaken);
    expect(await fixture.records.countDocuments()).toBe(1);
    const saved = await fixture.records.findOne({ _id: winners[0]!.value.user });
    const unusedKey = saved!.recoveryKey === "R9" ? "R10" : "R9";
    expect(await fixture.registering._byRecoveryKey({ recoveryKey: unusedKey })).toEqual([]);
  });

  test("a committed insert with a lost reply is recovered after reconnecting", async () => {
    const { name, records } = setup();
    const writer = await connectMongo({ uri, database });
    const input = { username: "sam", recoveryKey: "R9" };
    const lostReply = new Error("Simulated lost registration reply.");
    const original = Collection.prototype.insertOne;
    let intercepted = false;
    const insert = spyOn(Collection.prototype, "insertOne").mockImplementation(
      async function(this: Collection, document, options) {
        const result = await original.call(this, document, options);
        if (this.dbName === database && this.collectionName === records.collectionName && !intercepted) {
          intercepted = true;
          throw lostReply;
        }
        return result;
      },
    );
    try {
      await expect(new RegisteringConcept(writer.db, name).register(input)).rejects.toBe(lostReply);
      expect(intercepted).toBe(true);
    } finally {
      insert.mockRestore();
      await writer.client.close();
    }

    const before = await records.find().toArray();
    expect(before).toHaveLength(1);
    expect(before[0]).toEqual({ _id: expect.any(String), ...input });
    const reader = await connectMongo({ uri, database });
    try {
      const restored = new RegisteringConcept(reader.db, name);
      expect(await restored._byRecoveryKey(input)).toEqual([{ user: before[0]!._id }]);
      expect(await restored.register(input)).toEqual({ user: before[0]!._id });
      expect(await records.find().toArray()).toEqual(before);
    } finally {
      await reader.client.close();
    }
  });

  test("a rejected insert saves neither account nor key and allows a later retry", async () => {
    const { registering, records } = setup();
    const input = { username: "sam", recoveryKey: "R9" };
    await connection!.db.createCollection(records.collectionName, {
      validator: { username: { $ne: "sam" } }, validationAction: "error",
    });
    await expect(registering.register(input)).rejects.toMatchObject({ code: 121 });
    expect(await registering._byRecoveryKey(input)).toEqual([]);
    expect(await registering._byUsername(input)).toEqual([]);
    expect(await records.countDocuments()).toBe(0);
    await connection!.db.command({ collMod: records.collectionName, validator: {} });
    const saved = await registering.register(input);
    expect(await records.find().toArray()).toEqual([{ _id: saved.user, ...input }]);
  });

  test("an unrelated unique-index failure remains a database error", async () => {
    const { registering, records } = setup();
    // All concept writes omit this field. This test-only index permits one missing value.
    await records.createIndex({ testConstraint: 1 }, { unique: true });
    const original = await registering.register({ username: "sam", recoveryKey: "R9" });
    const next = { username: "ben", recoveryKey: "R10" };
    await expect(registering.register(next)).rejects.toMatchObject({ code: 11000, keyPattern: { testConstraint: 1 } });
    expect(await registering._byRecoveryKey(next)).toEqual([]);
    expect(await registering._byUsername(next)).toEqual([]);
    expect(await records.countDocuments()).toBe(1);
    await records.dropIndex("testConstraint_1");
    expect((await registering.register(next)).user).not.toBe(original.user);
  });

  test("older accounts without keys remain readable and cannot be claimed by username", async () => {
    const { registering, records } = setup();
    const older: StoredUser[] = [
      { _id: randomUUID() as User, username: "maya" },
      { _id: randomUUID() as User, username: "ben" },
    ];
    await records.insertMany(older);
    // This also proves that multiple older rows do not prevent index creation.
    const sam = await registering.register({ username: "sam", recoveryKey: "R9" });
    for (const account of older) {
      expect(await registering._username({ user: account._id })).toEqual([{ username: account.username }]);
      expect(await registering._byUsername(account)).toEqual([{ user: account._id }]);
      await expect(registering.register({ username: account.username, recoveryKey: "unrelated-key" }))
        .rejects.toThrow(UsernameTaken);
      expect(await records.findOne({ _id: account._id })).toEqual(account);
    }
    for (const recoveryKey of ["unknown", "", " \t", undefined, null]) {
      expect(await registering._byRecoveryKey({ recoveryKey: recoveryKey as string })).toEqual([]);
    }
    expect(await registering._byRecoveryKey({ recoveryKey: "R9" })).toEqual([sam]);
    expect(await records.countDocuments()).toBe(3);
  });

  test("the engine propagates a database failure and later returns the same recovered account", async () => {
    const { name, registering, records } = setup();
    await connection!.db.createCollection(records.collectionName, {
      validator: { username: { $ne: "sam" } }, validationAction: "error",
    });
    const application = assembleApplication({
      Registering: registering,
      CommonsFederating: new FederatingConcept<User>(connection!.db, new MemoryProvider(), name),
      Sessioning: new SessioningConcept<User>(connection!.db, name),
      SkillMapping: await createSkillMapping(connection!.db, name),
      AssessmentReviewing: new AssessmentReviewing(connection!.db),
      MasteryEstimating: new MasteryEstimating(connection!.db),
      StudyPlanning: new Budgeting(connection!.db, "StudyPlanning"),
      GroundedTutoring: new GroundedTutoring(connection!.db, name),
    });
    try {
      const accounts = application.concepts.Registering;
      const input = { username: "sam", recoveryKey: "R9" };
      await expect(accounts.register(input)).rejects.toMatchObject({ code: 121 });
      expect(await accounts._byRecoveryKey(input)).toEqual([]);
      await connection!.db.command({ collMod: records.collectionName, validator: {} });
      const saved = await accounts.register(input);
      if ("error" in saved) throw new Error(`Unexpected refusal: ${saved.error}`);
      expect(await accounts.register(input)).toEqual(saved);
      expect(await accounts._byRecoveryKey(input)).toEqual([saved]);
      expect(await records.countDocuments()).toBe(1);
      expect(Object.keys(application.publicInterface.routes)).toContain("/courses");
    } finally {
      await application.beginDrain();
    }
  });
});
