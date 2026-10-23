import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

let connection: Awaited<ReturnType<typeof connectMongo>>;
beforeAll(async () => { connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` }); });
afterAll(async () => { if (connection) { await connection.db.dropDatabase(); await connection.client.close(); } });

async function setup() {
  const name = `Tutoring_${crypto.randomUUID()}`;
  const tutoring = new GroundedTutoring(connection.db, name);
  const { material } = await tutoring.addMaterial({ owner: "sam", importKey: "lesson", scope: "math", title: "Matrices", locator: "lesson", content: "Rows multiply columns.", originals: [], origin: "COURSE" });
  const context = { owner: "sam", topic: "matrix-products", definition: "v1", materials: [material], citations: [{ material, location: "content" }] };
  const { task } = await tutoring.prepareTask({ ...context, question: "Solve two new matrix products. Explain why order matters.", criteria: "Correct products and reasoning.", mode: "CHECK", fresh: true });
  return { name, tutoring, context, task };
}

describe("Grounded tutoring sessions", () => {
  test("lesson follow-ups keep sources and a fixed definition", async () => {
    const { tutoring, context } = await setup();
    const { lesson } = await tutoring.explain({ ...context, request: "Show an example.", explanation: "Match each row to each column." });
    await tutoring.respond({ owner: "sam", session: lesson, text: "Why does order matter?", media: [], channel: "TEXT" });
    await tutoring.answerLesson({ owner: "sam", lesson, text: "Changing the order changes which rows and columns are paired.", citations: context.citations, channel: "TEXT" });
    expect(await tutoring._lesson({ lesson })).toHaveLength(1);
    expect(await tutoring._task({ task: lesson })).toEqual([]);
    expect((await tutoring._dialogue({ session: lesson })).map(({ turn }) => turn.purpose)).toEqual(["RESPONSE", "EXPLANATION"]);
    expect((await tutoring._session({ session: lesson }))[0]!.definition).toBe("v1");
  });

  test("voice correction is append-only and review rejects a stale dialogue length", async () => {
    const { tutoring, task } = await setup();
    await tutoring.respond({ owner: "sam", session: task, text: "One times too.", media: [], channel: "VOICE" });
    expect((await tutoring._review({ task }))[0]!.ready).toBe(false);
    await tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 0, text: "One times two." });
    expect(await tutoring._voiceResponses({ session: task })).toEqual([{ turnIndex: 0, text: "One times two.", confirmed: true }]);
    expect((await tutoring._dialogue({ session: task }))[0]!.turn.text).toBe("One times too.");
    await expect(tutoring.confirmAttempt({ owner: "sam", task, dialogueLength: 1 })).rejects.toMatchObject({ code: "ATTEMPT_REVIEW_CHANGED" });
    await tutoring.confirmAttempt({ owner: "sam", task, dialogueLength: 2 });
    expect((await tutoring._review({ task }))[0]!.ready).toBe(true);
  });

  test("a CHECK hint requires a request and remains in saved dialogue", async () => {
    const { tutoring, task } = await setup();
    await expect(tutoring.giveHint({ owner: "sam", task, text: "Pair the first row with the first column.", channel: "TEXT" })).rejects.toMatchObject({ code: "HINT_NOT_REQUESTED" });
    await tutoring.requestHint({ owner: "sam", task });
    await tutoring.giveHint({ owner: "sam", task, text: "Pair the first row with the first column.", channel: "TEXT" });
    expect((await tutoring._dialogue({ session: task }))[0]!.turn.purpose).toBe("HINT");
    expect((await tutoring._task({ task }))[0]!.hintRequested).toBe(false);
    await tutoring.close({ owner: "sam", session: task });
    await expect(tutoring.respond({ owner: "sam", session: task, text: "New work", media: [], channel: "TEXT" })).rejects.toMatchObject({ code: "RESPONSE_SESSION_UNAVAILABLE" });
  });

  test("foreign sources, invented citations, and another learner's session are refused", async () => {
    const { tutoring, task, context } = await setup();
    await expect(tutoring.explain({ ...context, owner: "other", request: "Explain", explanation: "Example" })).rejects.toMatchObject({ code: "INVALID_LESSON_SOURCES" });
    await expect(tutoring.explain({ ...context, request: "Explain", explanation: "Example", citations: [{ ...context.citations[0]!, location: "invented" }] })).rejects.toMatchObject({ code: "INVALID_LESSON_SOURCES" });
    await expect(tutoring.respond({ owner: "other", session: task, text: "Change", media: [], channel: "TEXT" })).rejects.toMatchObject({ code: "RESPONSE_SESSION_UNAVAILABLE" });
    expect(await tutoring._dialogue({ session: task })).toEqual([]);
  });

  test("competing session objects append without losing responses; a new instance reads them", async () => {
    const { tutoring, task, name } = await setup();
    const other = new GroundedTutoring(connection.db, name);
    await Promise.all([tutoring, other].map((instance, i) => instance.respond({ owner: "sam", session: task, text: `Reasoning ${i}`, media: [], channel: "TEXT" })));
    const restarted = new GroundedTutoring(connection.db, name);
    expect((await restarted._dialogue({ session: task })).map(({ turn }) => turn.text).sort()).toEqual(["Reasoning 0", "Reasoning 1"]);
  });

  test("study lists sessions in the order they were started, after sessions saved with older random identities", async () => {
    // The interface numbers lessons and practice from this order, so a new session must never move an earlier one.
    let now = Date.parse("2026-10-22T15:00:00Z");
    const name = `Tutoring_${crypto.randomUUID()}`, tutoring = new GroundedTutoring(connection.db, name, () => new Date(now));
    const { material } = await tutoring.addMaterial({ owner: "sam", importKey: "lesson", scope: "math", title: "Matrices", locator: "lesson", content: "Rows multiply columns.", originals: [], origin: "COURSE" });
    const context = { owner: "sam", topic: "matrix-products", definition: "v1", materials: [material], citations: [{ material, location: "content" }] };
    const lessonText = { request: "Show an example.", explanation: "Match each row to each column." };
    const { lesson: first } = await tutoring.explain({ ...context, ...lessonText });
    // A lesson saved before identities were time-ordered. Its random identity sorts after every new one.
    const sessions = connection.db.collection<{ _id: string }>(`${name.toLowerCase()}.sessions`), legacy = "ffffffff-ffff-4fff-bfff-ffffffffffff";
    await sessions.insertOne({ ...(await sessions.findOne({ _id: first }))!, _id: legacy });
    now += 60_000; const { task } = await tutoring.prepareTask({ ...context, question: "Solve two new matrix products.", criteria: "Correct products.", mode: "CHECK", fresh: true });
    now += 60_000; const { lesson: second } = await tutoring.explain({ ...context, ...lessonText });
    expect([first, task, second].every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true);
    expect((await tutoring._study({ owner: "sam", topic: "matrix-products" })).sessions.map(({ session }): string => session)).toEqual([legacy, first, task, second]);
  });
});
