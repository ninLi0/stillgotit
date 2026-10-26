import { Budgeting } from "../src/concepts/Budgeting/Budgeting.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { MaterialKeeping } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ActionRefusal } from "@mit-sdg/sync-engine/assembly";
import type { Db } from "mongodb";
import { assembleApplication } from "../src/assembly.ts";
import { TreeStyling } from "../src/concepts.ts";
import { FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "../src/concepts/Registering/Registering.ts";
import { SessioningConcept, type Session } from "../src/concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
const notSignedIn = { error: "NOT_SIGNED_IN", detail: "Your session has ended. Sign in again." };
const applications: ReturnType<typeof assembleApplication>[] = [];
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

interface StoredSession {
  _id: Session;
  subject: User;
  lastUsed: Date;
  expiresAt: Date;
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
  const name = `Accounts_${randomUUID()}`;
  // Advance only the concept's clock, so expiry checks happen before MongoDB cleanup.
  const started = new Date();
  let now = started;
  const clock = () => now;
  const advance = (milliseconds: number) => (now = new Date(now.getTime() + milliseconds));
  const collectionName = `${name.toLowerCase()}.sessions`;
  const assembleFor = async (db: Db) => assembleApplication({
    Registering: new RegisteringConcept(db, name),
    CommonsFederating: new FederatingConcept<User>(db, new MemoryProvider(), name, clock),
    Sessioning: new SessioningConcept<User>(db, name, clock),
    SkillMapping: await createSkillMapping(db, name),
    AssessmentReviewing: new AssessmentReviewing(db),
    MasteryEstimating: new MasteryEstimating(db),
    StudyPlanning: new Budgeting(db, "StudyPlanning"),
    Library: new MaterialKeeping(db, name),
    GroundedTutoring: new GroundedTutoring(db, name),
    TreeStyling: new TreeStyling(db, "TreeStyling"),
  });
  const application = await assembleFor(connection!.db);
  applications.push(application);
  const { user } = success(await application.concepts.Registering.register({ username: "maya", recoveryKey: "maya-key" }));
  return {
    application, assembleFor, user, started, clock, advance, collectionName,
    sessions: application.concepts.Sessioning,
    records: connection!.db.collection<StoredSession>(collectionName),
  };
}

describe("Sessioning framework registration", () => {
  test("a session identifies a registered course owner and logout persists across engines", async () => {
    const { application, assembleFor, sessions, records, user, started, clock, advance } = await setup();
    const laptop = success(await sessions.start({ subject: user }));
    const phone = success(await sessions.start({ subject: user }));
    expect(laptop.session).not.toBe(phone.session);
    expect(laptop.expiresAt).toEqual(new Date(started.getTime() + 90 * DAY));
    advance(MINUTE);
    const { subject } = success(await sessions.use({ session: laptop.session }));
    expect(subject).toBe(user);
    expect(await records.findOne({ _id: laptop.session })).toEqual({
      _id: laptop.session, subject: user, lastUsed: clock(), expiresAt: laptop.expiresAt,
    });
    const { course } = success(await application.concepts.SkillMapping.createCourse({
      owner: subject, title: "Linear Algebra",
    }));

    const secondConnection = await connectMongo({ uri, database });
    let second: ReturnType<typeof assembleApplication> | undefined;
    try {
      second = await assembleFor(secondConnection.db);
      expect(await second.concepts.Registering._username({ user })).toEqual([{ username: "maya" }]);
      expect(await second.concepts.SkillMapping._course({ course }))
        .toEqual([{ owner: user, title: "Linear Algebra" }]);
      expect(await second.concepts.Sessioning.use({ session: laptop.session })).toEqual({ subject: user });
      expect(await second.concepts.Sessioning.end({ session: laptop.session }))
        .toEqual({ session: laptop.session });
      expect(Object.keys(second.publicInterface.routes)).toContain("/courses");
    } finally {
      if (second) await second.beginDrain();
      await secondConnection.client.close();
    }

    expect(await records.findOne({ _id: laptop.session })).toBeNull();
    expect(await sessions.use({ session: laptop.session })).toEqual(notSignedIn);
    expect(await sessions.end({ session: laptop.session })).toEqual(notSignedIn);
    expect(await sessions.use({ session: phone.session })).toEqual({ subject: user });
    expect(await application.concepts.Registering._username({ user })).toEqual([{ username: "maya" }]);
    expect(await application.concepts.SkillMapping._course({ course }))
      .toEqual([{ owner: user, title: "Linear Algebra" }]);
  });

  test.each(["unknown", "idle", "expired"] as const)(
    "%s sessions return declared refusals without changing saved state",
    async (condition) => {
      const { sessions, records, user, advance } = await setup();
      const { session } = success(await sessions.start({ subject: user }));
      if (condition === "idle") advance(7 * DAY);
      if (condition === "expired") {
        // Keep the idle limit from masking the fixed 90-day expiry.
        for (let day = 6; day <= 84; day += 6) {
          advance(6 * DAY);
          expect(await sessions.use({ session })).toEqual({ subject: user });
        }
        advance(6 * DAY);
      }
      const target = condition === "unknown" ? "unknown-session" as Session : session;
      const before = await records.find().toArray();
      expect(await sessions.use({ session: target })).toEqual(notSignedIn);
      expect(await sessions.end({ session: target })).toEqual(notSignedIn);
      expect(await records.find().toArray()).toEqual(before);
    },
  );

  test("database faults still reject the engine call and later valid calls succeed", async () => {
    const { sessions, records, user, collectionName, started, clock, advance } = await setup();
    const { session, expiresAt } = success(await sessions.start({ subject: user }));
    const before = await records.findOne({ _id: session });
    await connection!.db.command({
      collMod: collectionName,
      validator: { lastUsed: { $eq: started } },
      validationLevel: "strict", validationAction: "error",
    });
    advance(MINUTE);
    try {
      await expect(sessions.use({ session })).rejects.toMatchObject({ code: 121 });
      expect(await records.findOne({ _id: session })).toEqual(before);
    } finally {
      await connection!.db.command({ collMod: collectionName, validator: {} });
    }
    expect(await sessions.use({ session })).toEqual({ subject: user });
    expect(await records.findOne({ _id: session })).toEqual({
      _id: session, subject: user, lastUsed: clock(), expiresAt,
    });
  });

  test("two simultaneous engine calls to end return one success and one refusal", async () => {
    const { sessions, records, user } = await setup();
    const { session } = success(await sessions.start({ subject: user }));
    const outcomes = await Promise.all([sessions.end({ session }), sessions.end({ session })]);
    expect(outcomes.filter((outcome) => "session" in outcome)).toEqual([{ session }]);
    expect(outcomes.filter((outcome) => "error" in outcome)).toEqual([notSignedIn]);
    expect(await records.findOne({ _id: session })).toBeNull();
    expect(await sessions.use({ session })).toEqual(notSignedIn);
  });
});
