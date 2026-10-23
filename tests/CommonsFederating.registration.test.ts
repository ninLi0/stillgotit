import { StudyPlanning } from "../src/concepts/StudyPlanning/StudyPlanning.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Collection, type Db, type Document, type Filter } from "mongodb";
import type { ActionRefusal } from "@mit-sdg/sync-engine/assembly";
import { assembleApplication } from "../src/assembly.ts";
import { type Attempt, FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { type Identity, MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "../src/concepts/Registering/Registering.ts";
import { SessioningConcept } from "../src/concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const SAM = { subject: "u7f3", username: "sam" };
const expired = { error: "SIGN_IN_EXPIRED", detail: "This sign-in has expired. Start again." };
const refused = { error: "SIGN_IN_REFUSED", detail: "The other site didn't confirm this sign-in. Start again." };
const notConfirmed = { error: "NOT_CONFIRMED", detail: "This sign-in hasn't been confirmed." };
const alreadyLinked = { error: "ALREADY_LINKED", detail: "This account on the other site is already linked." };
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
const applications: ReturnType<typeof assembleApplication>[] = [];
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredAttempt {
  _id: Attempt;
  nonce: string;
  verifier: string;
  expiresAt: Date;
  subject?: string;
  username?: string;
}

beforeAll(async () => {
  connection = await connectMongo({ uri, database });
});

afterAll(async () => {
  if (!connection) return;
  try {
    for (const application of applications) await application.beginDrain();
    await connection.db.dropDatabase();
  } finally {
    await connection.client.close();
  }
});

function success<T extends object>(result: T | ActionRefusal): T {
  if ("error" in result) throw new Error(`Unexpected refusal: ${result.error}`);
  return result as T;
}

async function setup() {
  const name = `CommonsAccounts_${randomUUID()}`;
  // Advancing this clock keeps expiry tests independent of background deletion.
  let now = new Date();
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const provider = new MemoryProvider();
  const assembleFor = async (db: Db, commons = provider) => assembleApplication({
    Registering: new RegisteringConcept(db, name),
    CommonsFederating: new FederatingConcept<User>(db, commons, name, clock),
    Sessioning: new SessioningConcept<User>(db, name, clock),
    SkillMapping: await createSkillMapping(db, name),
    AssessmentReviewing: new AssessmentReviewing(db),
    MasteryEstimating: new MasteryEstimating(db),
    StudyPlanning: new StudyPlanning(db),
    GroundedTutoring: new GroundedTutoring(db, name),
  });
  const application = await assembleFor(connection!.db);
  applications.push(application);
  const federating = application.concepts.CommonsFederating;

  async function approved(identity: Identity = SAM) {
    const { attempt, address } = success(await federating.start({}));
    const { code, state } = provider.approve(address, identity);
    return { attempt, nonce: state, code };
  }

  async function confirmed(identity: Identity = SAM) {
    const request = await approved(identity);
    expect(await federating.finish(request)).toEqual({ username: identity.username });
    return { attempt: request.attempt };
  }

  // Test account keys only. The sign-in host's verified identity-to-key mapping is still pending.
  const register = async (username = "sam") => success(await application.concepts.Registering.register({
    username, recoveryKey: randomUUID(),
  }));
  return {
    name, clock, advance, provider, application, assembleFor, federating, approved, confirmed, register,
    attempts: connection!.db.collection<StoredAttempt>(`${name.toLowerCase()}.attempts`),
    links: connection!.db.collection<{ subject: string; user: User }>(`${name.toLowerCase()}.links`),
    sessions: connection!.db.collection(`${name.toLowerCase()}.sessions`),
  };
}

function settle<T>(operation: Promise<T>): Promise<PromiseSettledResult<T>> {
  return operation.then(
    (value) => ({ status: "fulfilled", value }),
    (reason: unknown) => ({ status: "rejected", reason }),
  );
}

function pause(label: string) {
  const arrived = Promise.withResolvers<void>();
  const released = Promise.withResolvers<void>();
  const timeout = setTimeout(() => arrived.reject(new Error(`${label} did not arrive.`)), 5_000);
  return {
    arrived: arrived.promise,
    async hold() {
      clearTimeout(timeout);
      arrived.resolve();
      await released.promise;
    },
    release() {
      clearTimeout(timeout);
      released.resolve();
    },
  };
}

describe("CommonsFederating framework registration", () => {
  test("links a registered user and finds that same course owner from a new engine after a Commons name change", async () => {
    const { application, assembleFor, provider, federating, sessions, links } = await setup();
    const started = success(await federating.start({}));
    expect(started.expiresAt).toBeInstanceOf(Date);
    expect(await federating._identity(started)).toEqual([]);
    expect(await federating._user(started)).toEqual([]);
    expect(await federating._linkable(started)).toEqual({ linkable: false });
    const approval = provider.approve(started.address, SAM);
    const identity = success(await federating.finish({
      attempt: started.attempt, nonce: approval.state, code: approval.code,
    }));
    expect(identity).toEqual({ username: SAM.username });
    expect(await federating._identity(started)).toEqual([{ ...SAM, expiresAt: started.expiresAt }]);
    expect(await federating._linkable(started)).toEqual({ linkable: true });
    expect(await sessions.countDocuments()).toBe(0);

    // These are explicit engine calls, not an implemented sign-in composition.
    const { user } = success(await application.concepts.Registering.register({ ...identity, recoveryKey: "sam-key" }));
    expect(await federating.link({ attempt: started.attempt, user })).toEqual({ user });
    expect(await federating._user(started)).toEqual([{ user }]);
    expect(await federating._linkable(started)).toEqual({ linkable: false });
    expect(await sessions.countDocuments()).toBe(0);
    const { session } = success(await application.concepts.Sessioning.start({ subject: user }));
    const { subject } = success(await application.concepts.Sessioning.use({ session }));
    const { course } = success(await application.concepts.SkillMapping.createCourse({
      owner: subject, title: "Linear Algebra",
    }));
    await application.beginDrain();

    const secondConnection = await connectMongo({ uri, database });
    let second: ReturnType<typeof assembleApplication> | undefined;
    try {
      const freshProvider = new MemoryProvider();
      second = await assembleFor(secondConnection.db, freshProvider);
      const returning = second.concepts.CommonsFederating;
      expect(await returning._identity(started)).toEqual([{ ...SAM, expiresAt: started.expiresAt }]);
      expect(await returning._user(started)).toEqual([{ user }]);
      const next = success(await returning.start({}));
      const renamed = freshProvider.approve(next.address, { ...SAM, username: "sam-renamed" });
      expect(await returning.finish({ attempt: next.attempt, nonce: renamed.state, code: renamed.code }))
        .toEqual({ username: "sam-renamed" });
      expect(await returning._user(next)).toEqual([{ user }]);
      expect(await returning._identity(next))
        .toEqual([{ subject: SAM.subject, username: "sam-renamed", expiresAt: next.expiresAt }]);
      expect(await returning._identity(started)).toEqual([{ ...SAM, expiresAt: started.expiresAt }]);
      expect(await returning._linkable(next)).toEqual({ linkable: false });
      expect(await second.concepts.Registering._username({ user })).toEqual([{ username: "sam" }]);
      expect(await second.concepts.Registering._byUsername({ username: "sam-renamed" })).toEqual([]);
      expect(await second.concepts.Sessioning.use({ session })).toEqual({ subject: user });
      expect(await second.concepts.SkillMapping._course({ course }))
        .toEqual([{ owner: user, title: "Linear Algebra" }]);
      expect(Object.keys(second.concepts).sort())
        .toEqual(["AssessmentReviewing", "CommonsFederating", "GroundedTutoring", "MasteryEstimating", "Registering", "Sessioning", "SkillMapping", "StudyPlanning", "TutorGenerating", "TutorPreferring"]);
      expect(Object.keys(second.publicInterface.routes)).toContain("/courses");
      expect(await links.countDocuments()).toBe(1);
    } finally {
      if (second) await second.beginDrain();
      await secondConnection.client.close();
    }
  });

  test("identity lookup through the engine rejects a result delivered at expiry without changing state", async () => {
    const { federating, confirmed, advance, attempts, links, sessions, provider } = await setup();
    const request = await confirmed();
    const before = await attempts.find().toArray();
    const original = Collection.prototype.findOne;
    const gate = pause("The identity read");
    let held = false;
    const read = spyOn(Collection.prototype, "findOne").mockImplementation(
      async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
        const record = await original.call(this, filter, options);
        if (!held && this.dbName === database && this.collectionName === attempts.collectionName
          && filter._id === request.attempt) {
          held = true;
          await gate.hold();
        }
        return record as T | null;
      },
    );
    const redeem = spyOn(provider, "redeem");
    const pending = settle(federating._identity(request));
    try {
      await gate.arrived;
      advance(10 * MINUTE);
      gate.release();
      expect(await pending).toEqual({ status: "fulfilled", value: [] });
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
      expect(await sessions.countDocuments()).toBe(0);
      expect(redeem).not.toHaveBeenCalled();
    } finally {
      gate.release();
      await pending;
      read.mockRestore();
      redeem.mockRestore();
    }
  });

  test("returns all four declared refusals and preserves the original link", async () => {
    const { federating, approved, confirmed, register, attempts, links } = await setup();
    const { user } = await register();
    const other = await register("leo");
    const request = await approved();
    const before = await attempts.find().toArray();
    const unknown = { attempt: "unknown-attempt" as Attempt };
    expect(await federating._user(unknown)).toEqual([]);
    expect(await federating._linkable(unknown)).toEqual({ linkable: false });
    expect(await federating.link({ ...unknown, user })).toEqual(notConfirmed);
    expect(await federating.link({ attempt: request.attempt, user })).toEqual(notConfirmed);
    expect(await federating.finish({ ...request, nonce: "wrong-nonce" })).toEqual(expired);
    expect(await federating.finish({ ...request, code: "invalid-code" })).toEqual(refused);
    expect(await attempts.find().toArray()).toEqual(before);
    expect(await links.countDocuments()).toBe(0);

    expect(await federating.finish(request)).toEqual({ username: SAM.username });
    expect(await federating.finish(request)).toEqual(expired);
    expect(await federating.link({ attempt: request.attempt, user })).toEqual({ user });
    const saved = await links.find().toArray();
    const next = await confirmed();
    expect(await federating.link({ ...next, user: other.user })).toEqual(alreadyLinked);
    expect(await links.find().toArray()).toEqual(saved);
    expect(await federating._user(next)).toEqual([{ user }]);
  });

  test.each(["finish", "link"] as const)("%s refuses exactly at expiry through the engine", async (action) => {
    const { federating, approved, register, advance, attempts, links } = await setup();
    const { user } = await register();
    const request = await approved();
    if (action === "link") expect(await federating.finish(request)).toEqual({ username: SAM.username });
    const before = await attempts.find().toArray();
    advance(10 * MINUTE);
    const result = action === "finish"
      ? await federating.finish(request)
      : await federating.link({ attempt: request.attempt, user });
    expect(result).toEqual(expired);
    expect(await attempts.find().toArray()).toEqual(before);
    expect(await links.countDocuments()).toBe(0);
    expect(await federating._linkable(request)).toEqual({ linkable: false });
  });

  test("a provider reply at expiry returns SIGN_IN_EXPIRED through the engine without confirmation", async () => {
    const { federating, approved, provider, advance, attempts, links } = await setup();
    const request = await approved();
    const before = await attempts.find().toArray();
    const redeemCode = provider.redeem.bind(provider);
    const gate = pause("Provider reply");
    const redeem = spyOn(provider, "redeem").mockImplementation(async (input) => {
      const identity = await redeemCode(input);
      await gate.hold();
      return identity;
    });
    const pending = settle(federating.finish(request));
    try {
      await gate.arrived;
      advance(10 * MINUTE);
      gate.release();
      expect(await pending).toEqual({ status: "fulfilled", value: expired });
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
    } finally {
      gate.release();
      await pending;
      redeem.mockRestore();
    }
  });

  test("a link insert that finishes at expiry is removed and returns SIGN_IN_EXPIRED through the engine", async () => {
    const { federating, confirmed, register, advance, attempts, links } = await setup();
    const { user } = await register();
    const request = await confirmed();
    const before = await attempts.find().toArray();
    const original = Collection.prototype.insertOne;
    const gate = pause("Link insert");
    const insert = spyOn(Collection.prototype, "insertOne").mockImplementation(
      async function(this: Collection, document, options) {
        const result = await original.call(this, document, options);
        if (this.dbName === database && this.collectionName === links.collectionName) await gate.hold();
        return result;
      },
    );
    const pending = settle(federating.link({ ...request, user }));
    try {
      await gate.arrived;
      expect(await links.countDocuments()).toBe(1);
      advance(10 * MINUTE);
      gate.release();
      expect(await pending).toEqual({ status: "fulfilled", value: expired });
      expect(await federating._user(request)).toEqual([]);
      expect(await links.countDocuments()).toBe(0);
      expect(await attempts.find().toArray()).toEqual(before);
    } finally {
      gate.release();
      await pending;
      insert.mockRestore();
    }
  });

  test("unexpected database faults reject the engine call, and a later link can succeed", async () => {
    const { federating, confirmed, register, attempts, links } = await setup();
    const { user } = await register();
    const request = await confirmed();
    const before = await attempts.find().toArray();
    await connection!.db.command({
      collMod: links.collectionName,
      validator: { user: { $ne: user } },
      validationLevel: "strict", validationAction: "error",
    });
    try {
      await expect(federating.link({ ...request, user })).rejects.toMatchObject({ code: 121 });
      expect(await attempts.find().toArray()).toEqual(before);
      expect(await links.countDocuments()).toBe(0);
      expect(await federating._linkable(request)).toEqual({ linkable: true });
    } finally {
      await connection!.db.command({ collMod: links.collectionName, validator: {} });
    }
    expect(await federating.link({ ...request, user })).toEqual({ user });
    expect(await federating._user(request)).toEqual([{ user }]);
  });

  test("two engines linking one Commons subject return one success and one ALREADY_LINKED refusal", async () => {
    const { federating, assembleFor, confirmed, register, attempts, links } = await setup();
    const sam = await register();
    const leo = await register("leo");
    const first = await confirmed();
    const secondAttempt = await confirmed();
    const before = await attempts.find().sort({ _id: 1 }).toArray();
    const secondConnection = await connectMongo({ uri, database });
    let second: ReturnType<typeof assembleApplication> | undefined;
    try {
      second = await assembleFor(secondConnection.db);
      const outcomes = await Promise.all([
        federating.link({ ...first, user: sam.user }),
        second.concepts.CommonsFederating.link({ ...secondAttempt, user: leo.user }),
      ]);
      const winners = outcomes.filter((outcome) => !("error" in outcome));
      expect(winners).toHaveLength(1);
      expect(outcomes.filter((outcome) => "error" in outcome)).toEqual([alreadyLinked]);
      const { user } = success<{ user: User }>(winners[0]!);
      expect(await federating._user(first)).toEqual([{ user }]);
      expect(await second.concepts.CommonsFederating._user(secondAttempt)).toEqual([{ user }]);
      expect(await links.countDocuments()).toBe(1);
      expect(await attempts.find().sort({ _id: 1 }).toArray()).toEqual(before);
    } finally {
      if (second) await second.beginDrain();
      await secondConnection.client.close();
    }
  });
});
