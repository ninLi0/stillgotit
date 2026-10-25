import { Budgeting } from "../src/concepts/Budgeting/Budgeting.ts";
import { MasteryEstimating } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
// The first five tests adapt ConceptBox's Registering tests. See THIRD_PARTY_NOTICES.md.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { ActionRefusal } from "@mit-sdg/sync-engine/assembly";
import { assembleApplication } from "../src/assembly.ts";
import { FederatingConcept } from "../src/concepts/Federating/Federating.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import {
  InvalidUsername,
  RegisteringConcept,
  type User,
  UsernameTaken,
} from "../src/concepts/Registering/Registering.ts";
import { createSkillMapping } from "../src/concepts/SkillMapping.ts";
import { SessioningConcept } from "../src/concepts/Sessioning/Sessioning.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

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
  return { name, registering: new RegisteringConcept(connection!.db, name) };
}

function success<T extends object>(result: T | ActionRefusal): T {
  if ("error" in result) throw new Error(`Unexpected refusal: ${result.error}`);
  return result as T;
}

describe("Registering", () => {
  test("its principle: Sam finds Maya by her username, and Ben registers another when hers is taken", async () => {
    const { registering } = setup();

    const { user: maya } = await registering.register({ username: "maya", recoveryKey: "maya-key" });
    expect(await registering._byUsername({ username: "maya" })).toEqual([{ user: maya }]);
    expect(await registering._username({ user: maya })).toEqual([{ username: "maya" }]);

    const taken = registering.register({ username: "maya", recoveryKey: "ben-key" });
    await expect(taken).rejects.toThrow(UsernameTaken);
    await expect(taken).rejects.toThrow("That username is taken.");
    const { user: ben } = await registering.register({ username: "ben", recoveryKey: "ben-key" });
    expect(ben).not.toBe(maya);
  });

  test("a username must have 3 to 32 ASCII letters, digits, underscores, or hyphens", async () => {
    const { registering } = setup();
    for (const username of ["ma", "x".repeat(33), "maya lee", "maya!", "", "Māya"]) {
      await expect(registering.register({ username, recoveryKey: "invalid-name-key" })).rejects.toThrow(InvalidUsername);
      expect(await registering._byUsername({ username })).toEqual([]);
      expect(await registering._byRecoveryKey({ recoveryKey: "invalid-name-key" })).toEqual([]);
    }
    for (const username of ["abc", "x".repeat(32), "maya_lee-2"]) {
      const { user } = await registering.register({ username, recoveryKey: randomUUID() });
      expect(await registering._byUsername({ username })).toEqual([{ user }]);
    }
  });

  test("usernames are case-sensitive, so `Maya` is a different username from `maya`", async () => {
    const { registering } = setup();
    const { user: maya } = await registering.register({ username: "maya", recoveryKey: "maya-key" });
    const { user: other } = await registering.register({ username: "Maya", recoveryKey: "other-key" });
    expect(other).not.toBe(maya);
    expect(await registering._byUsername({ username: "maya" })).toEqual([{ user: maya }]);
    expect(await registering._byUsername({ username: "Maya" })).toEqual([{ user: other }]);
  });

  test("two clients registering one username at once produce one user and one USERNAME_TAKEN refusal", async () => {
    const { name, registering } = setup();
    const secondConnection = await connectMongo({ uri, database });
    try {
      const second = new RegisteringConcept(secondConnection.db, name);
      const outcomes = await Promise.allSettled([
        registering.register({ username: "maya", recoveryKey: "first-key" }),
        second.register({ username: "maya", recoveryKey: "second-key" }),
      ]);
      const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const losers = outcomes.filter((outcome) => outcome.status === "rejected");
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0]!.reason).toBeInstanceOf(UsernameTaken);
      const saved = [{ user: winners[0]!.value.user }];
      expect(await registering._byUsername({ username: "maya" })).toEqual(saved);
      expect(await second._byUsername({ username: "maya" })).toEqual(saved);
    } finally {
      await secondConnection.client.close();
    }
  });

  test("queries return no row for an unknown user, username, or recovery key", async () => {
    const { registering } = setup();
    expect(await registering._username({ user: "missing" as User })).toEqual([]);
    expect(await registering._byUsername({ username: "nobody" })).toEqual([]);
    expect(await registering._byRecoveryKey({ recoveryKey: "unknown-key" })).toEqual([]);
  });

  test("a new client reads the saved user after the writer closes; another namespace stays separate", async () => {
    const name = `Registering_${randomUUID()}`;
    const writer = await connectMongo({ uri, database });
    let saved: { user: User };
    try {
      saved = await new RegisteringConcept(writer.db, name).register({ username: "maya", recoveryKey: "maya-key" });
    } finally {
      await writer.client.close();
    }

    const reader = await connectMongo({ uri, database });
    try {
      const restored = new RegisteringConcept(reader.db, name);
      expect(await restored._byUsername({ username: "maya" })).toEqual([saved]);
      expect(await restored._username(saved)).toEqual([{ username: "maya" }]);
      expect(await restored._byRecoveryKey({ recoveryKey: "maya-key" })).toEqual([saved]);
      expect(await restored.register({ username: "maya", recoveryKey: "maya-key" })).toEqual(saved);
      await expect(restored.register({ username: "maya", recoveryKey: "other-key" })).rejects.toThrow(UsernameTaken);

      const isolated = new RegisteringConcept(reader.db, `${name}_other`);
      expect(await isolated._byUsername({ username: "maya" })).toEqual([]);
      expect(await isolated._byRecoveryKey({ recoveryKey: "maya-key" })).toEqual([]);
      expect((await isolated.register({ username: "maya", recoveryKey: "maya-key" })).user).not.toBe(saved.user);
      expect(await restored._byUsername({ username: "maya" })).toEqual([saved]);
    } finally {
      await reader.client.close();
    }
  });

  test("the engine returns declared refusals and a registered user can own a course", async () => {
    const application = assembleApplication({
      Registering: new RegisteringConcept(connection!.db),
      CommonsFederating: new FederatingConcept<User>(connection!.db, new MemoryProvider(), "CommonsFederating"),
      Sessioning: new SessioningConcept<User>(connection!.db),
      SkillMapping: await createSkillMapping(connection!.db),
      AssessmentReviewing: new AssessmentReviewing(connection!.db),
      MasteryEstimating: new MasteryEstimating(connection!.db),
      StudyPlanning: new Budgeting(connection!.db, "StudyPlanning"),
      GroundedTutoring: new GroundedTutoring(connection!.db),
    });
    try {
      const { Registering: accounts, SkillMapping: skills } = application.concepts;
      expect(await accounts.register({ username: "x", recoveryKey: "maya-key" })).toEqual({
        error: "INVALID_USERNAME",
        detail: "A username must have 3 to 32 letters, digits, underscores, or hyphens.",
      });
      expect(await accounts._byUsername({ username: "x" })).toEqual([]);
      expect(await accounts.register({ username: "maya", recoveryKey: " \t" })).toEqual({
        error: "INVALID_RECOVERY_KEY", detail: "Provide a nonblank recovery key.",
      });
      const { user } = success(await accounts.register({ username: "maya", recoveryKey: "maya-key" }));
      expect(await accounts._username({ user })).toEqual([{ username: "maya" }]);
      expect(await accounts._byRecoveryKey({ recoveryKey: "maya-key" })).toEqual([{ user }]);
      expect(await accounts.register({ username: "maya", recoveryKey: "maya-key" })).toEqual({ user });
      expect(await accounts.register({ username: "ben", recoveryKey: "maya-key" })).toEqual({
        error: "RECOVERY_KEY_CONFLICT", detail: "This recovery key already belongs to a different username.",
      });
      expect(await accounts.register({ username: "maya", recoveryKey: "ben-key" })).toEqual({
        error: "USERNAME_TAKEN", detail: "That username is taken.",
      });
      const { course } = success(await skills.createCourse({ owner: user, title: "Linear Algebra" }));
      expect(await skills._course({ course })).toEqual([{ owner: user, title: "Linear Algebra" }]);

      const other = success(await accounts.register({ username: "ben", recoveryKey: "ben-key" }));
      expect(await skills.addUnit({ owner: other.user, course, title: "Matrices" })).toEqual({
        error: "UNIT_COURSE_UNAVAILABLE", detail: "Choose one of your courses.",
      });
      expect(await skills._units({ course })).toEqual([]);
      expect(Object.keys(application.publicInterface.routes)).toContain("/courses");
    } finally {
      await application.beginDrain();
    }
  });
});
