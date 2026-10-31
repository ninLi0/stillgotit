import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { GroundedTutoring } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { MaterialKeeping, type Material, type MaterialImport } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import type { Channel, Mode, PassageRef, Session } from "../src/concepts/GroundedTutoring/dialogue.ts";
import type { MediaValue } from "../src/media.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

beforeAll(async () => { connection = await connectMongo({ uri, database }); });
// Every test starts from an empty database.
beforeEach(async () => { await connection!.db.dropDatabase(); });
afterAll(async () => {
  if (!connection) return;
  try { await connection.db.dropDatabase(); }
  finally { await connection.client.close(); }
});

const messages = {
  INVALID_LESSON_CONTENT: "Provide a learning request and explanation.",
  INVALID_LESSON_SOURCES: "Use your readable sources from one course and cite their content.",
  LESSON_EXPLANATION_UNAVAILABLE: "Choose one of your open lessons that is waiting for its explanation.",
  INVALID_LESSON_EXPLANATION: "Provide an explanation with references to this lesson's sources.",
  INVALID_TASK_CONTENT: "Provide a practice question and its assessment requirements.",
  INVALID_TASK_SOURCES: "Use your readable sources from one course and cite their content.",
  RESPONSE_SESSION_UNAVAILABLE: "Choose one of your open sessions.",
  INVALID_LEARNER_RESPONSE: "Provide a response. Spoken responses need a transcript.",
  LESSON_ANSWER_UNAVAILABLE: "Choose one of your open lessons.",
  INVALID_LESSON_ANSWER: "Provide an explanation with references to this lesson's sources.",
  HINT_REQUEST_UNAVAILABLE: "Choose one of your open practice tasks.",
  HINT_TASK_UNAVAILABLE: "Choose one of your open practice tasks.",
  INVALID_HINT_TEXT: "Provide the hint text.",
  HINT_NOT_REQUESTED: "Wait for the learner to request help during an independent check.",
  TRANSCRIPT_SESSION_UNAVAILABLE: "Choose one of your open sessions.",
  TRANSCRIPT_TURN_UNAVAILABLE: "Choose a spoken response from this session.",
  INVALID_CONFIRMED_TRANSCRIPT: "Provide the text that was spoken.",
  ATTEMPT_REVIEW_UNAVAILABLE: "Choose one of your open practice tasks.",
  ATTEMPT_REVIEW_CHANGED: "The conversation changed. Review the latest transcript.",
  SESSION_CLOSE_UNAVAILABLE: "Choose one of your open sessions.",
  LESSON_REOPEN_UNAVAILABLE: "Choose one of your finished lessons.",
} as const;

async function refuses(action: Promise<unknown>, code: keyof typeof messages) {
  await expect(action).rejects.toMatchObject({ code, message: messages[code] });
}

// Raw reads only compare stored state before and after an action. Tests create records through actions.
async function savedState(): Promise<Record<string, Document[]>> {
  const collections = await connection!.db.listCollections({}, { nameOnly: true }).toArray();
  return Object.fromEntries(await Promise.all(collections.map(async ({ name }) =>
    [name, await connection!.db.collection(name).find().sort({ _id: 1 }).toArray()] as const)));
}

const start = new Date("2026-10-13T14:00:00Z");

function setup() {
  let now = start;
  const tutoring = new GroundedTutoring(connection!.db, "GroundedTutoring", () => now);
  // The learner's materials are kept by a separate concept, as in the application.
  const library = new MaterialKeeping(connection!.db, "Library");
  // Each call moves the injected clock forward one minute and returns the new time.
  const tick = () => { now = new Date(now.getTime() + 60_000); return now; };
  return { tutoring, library, tick };
}

const slides: MediaValue = {
  file: "retained-week-3-slides", name: "week-3.pdf", mediaType: "application/pdf",
  renditions: [{ kind: "TEXT", location: "slides/4", text: "AB and BA usually differ." }], limitations: [],
};
const photo: MediaValue = {
  file: "retained-work-photo", name: "work.jpg", mediaType: "image/jpeg",
  renditions: [{ kind: "IMAGE", location: "photo/whole", file: "retained-work-photo-readable", mediaType: "image/jpeg" }], limitations: [],
};

function notes(overrides: Partial<MaterialImport> = {}): MaterialImport {
  return {
    owner: "sam", importKey: "week-3-notes", scope: "linear-algebra", title: "Matrix products", locator: "course:week-3",
    content: "Entry (i, j) of AB combines row i of A with column j of B.", originals: [slides], origin: "COURSE", ...overrides,
  };
}

/** Adds the learner's course notes and returns the session fields that cite them. */
async function sources(library: MaterialKeeping, owner = "sam") {
  const { material } = await library.add(notes({ owner }));
  return { owner, topic: "matrix-products", definition: "v1", materials: [material], citations: [{ material, location: "content" }] };
}

const lessonText = {
  request: "Why does the order of a matrix product matter?",
  explanation: "Each entry pairs a row of the left matrix with a column of the right matrix.",
};

type LessonInput = { owner: string; topic: string; definition: string; materials: readonly string[]; citations: readonly PassageRef[]; request: string; explanation: string };
/** Saves a lesson from the learner's request, then the tutor's opening explanation, as the Lesson and Reply flows do. */
async function explainedLesson(tutoring: GroundedTutoring, { citations, explanation, ...requested }: LessonInput) {
  const { lesson } = await tutoring.requestLesson(requested);
  await tutoring.explainLesson({ owner: requested.owner, lesson, explanation, citations });
  return { lesson };
}
const taskText = {
  question: "For A = [[1, 2], [3, 4]] and B = [[5, 6], [7, 8]], compute AB and BA. Explain why they differ.",
  criteria: "Both products are correct and the explanation names the row-column pairing. Gate: two fresh products without hints.",
};

describe("GroundedTutoring principle", () => {
  test("a cited lesson with a corrected voice question closes, then a CHECK task records a requested hint and a reviewed attempt", async () => {
    const { tutoring, library, tick } = setup();
    const context = await sources(library);
    const material = context.materials[0]!;

    // Lesson: it is saved with the learner's request first, and no question can come before the tutor's opening explanation.
    const { citations: _cited, ...requested } = context;
    const { lesson } = await tutoring.requestLesson({ ...requested, request: lessonText.request });
    expect(await tutoring._lesson({ lesson })).toEqual([{ request: lessonText.request, explanation: "" }]);
    expect(await tutoring._citations({ session: lesson })).toEqual([]);
    await refuses(tutoring.respond({ owner: "sam", session: lesson, text: "Is it ready yet?", media: [], channel: "TEXT" }), "RESPONSE_SESSION_UNAVAILABLE");
    // The tutor explains from the learner's sources.
    await tutoring.explainLesson({ owner: "sam", lesson, explanation: lessonText.explanation, citations: context.citations });
    const askedAt = tick();
    await tutoring.respond({ owner: "sam", session: lesson, text: "Does a b equal b a for mattresses?", media: [], channel: "VOICE" });
    const correctedAt = tick();
    await tutoring.confirmTranscript({ owner: "sam", session: lesson, turnIndex: 0, text: "Does AB equal BA for matrices?" });
    const answeredAt = tick();
    const answerCitations = [{ material, location: "slides/4" }];
    await tutoring.answerLesson({ owner: "sam", lesson, text: "Usually not. The slides show a pair where AB and BA differ.", citations: answerCitations, channel: "TEXT" });
    const followUpAt = tick();
    await tutoring.respond({ owner: "sam", session: lesson, text: "So the order is part of the problem.", media: [], channel: "VOICE" });
    // The lesson closes without approving its second transcript.
    await tutoring.close({ owner: "sam", session: lesson });

    expect(await tutoring._session({ session: lesson })).toEqual([{ owner: "sam", topic: "matrix-products", definition: "v1", status: "CLOSED" }]);
    expect(await tutoring._lesson({ lesson })).toEqual([lessonText]);
    expect(await tutoring._sources({ session: lesson })).toEqual([{ material }]);
    expect(await tutoring._citations({ session: lesson })).toEqual([{ citation: { material, location: "content" } }]);
    expect(await tutoring._dialogue({ session: lesson })).toEqual([
      { turnIndex: 0, turn: { speaker: "LEARNER", purpose: "RESPONSE", text: "Does a b equal b a for mattresses?", media: [], channel: "VOICE", citations: [], at: askedAt } },
      { turnIndex: 1, turn: { speaker: "LEARNER", purpose: "CORRECTION", text: "Does AB equal BA for matrices?", media: [], channel: "TEXT", citations: [], at: correctedAt, correctionTarget: 0 } },
      { turnIndex: 2, turn: { speaker: "TUTOR", purpose: "EXPLANATION", text: "Usually not. The slides show a pair where AB and BA differ.", media: [], channel: "TEXT", citations: answerCitations, at: answeredAt } },
      { turnIndex: 3, turn: { speaker: "LEARNER", purpose: "RESPONSE", text: "So the order is part of the problem.", media: [], channel: "VOICE", citations: [], at: followUpAt } },
    ]);
    expect(await tutoring._voiceResponses({ session: lesson })).toEqual([
      { turnIndex: 0, text: "Does AB equal BA for matrices?", confirmed: true },
      { turnIndex: 3, text: "So the order is part of the problem.", confirmed: false },
    ]);
    expect(await tutoring._review({ task: lesson })).toEqual([]);

    // Practice: an independent check where the learner asks for one hint.
    const { task } = await tutoring.prepareTask({ ...context, ...taskText, mode: "CHECK", fresh: true });
    await tutoring.requestHint({ owner: "sam", task });
    expect(await tutoring._task({ task })).toEqual([{ ...taskText, mode: "CHECK", fresh: true, hintRequested: true }]);
    const hintAt = tick();
    await tutoring.giveHint({ owner: "sam", task, text: "Start with the first row of A and the first column of B.", channel: "TEXT" });
    const responseAt = tick();
    await tutoring.respond({ owner: "sam", session: task, text: "AB is 19 22 43 50 and BA is 23 34 31 46.", media: [], channel: "VOICE" });
    expect(await tutoring._review({ task })).toEqual([{ dialogueLength: 2, uncheckedVoiceCount: 1, ready: false }]);

    // Reviewing the attempt confirms its transcripts and saves the learner's declaration.
    const before = await savedState();
    await tutoring.confirmAttempt({ owner: "sam", task, dialogueLength: 2, unseen: true, outsideHelp: false });
    expect(await tutoring._review({ task })).toEqual([{ dialogueLength: 2, uncheckedVoiceCount: 0, ready: true }]);
    // No query returns the declaration, so the stored task record is compared directly.
    expect(await savedState()).toEqual({
      ...before,
      "groundedtutoring.sessions": before["groundedtutoring.sessions"]!.map((row) => row._id === task
        ? { ...row, checkedVoiceTurns: [1], attemptReview: { dialogueLength: 2, unseen: true, outsideHelp: false }, revision: row.revision + 1 }
        : row),
    });

    await tutoring.close({ owner: "sam", session: task });
    expect(await tutoring._review({ task })).toEqual([{ dialogueLength: 2, uncheckedVoiceCount: 0, ready: false }]);
    // The requested hint stays in the saved dialogue as help.
    expect(await tutoring._dialogue({ session: task })).toEqual([
      { turnIndex: 0, turn: { speaker: "TUTOR", purpose: "HINT", text: "Start with the first row of A and the first column of B.", media: [], channel: "TEXT", citations: [], at: hintAt } },
      { turnIndex: 1, turn: { speaker: "LEARNER", purpose: "RESPONSE", text: "AB is 19 22 43 50 and BA is 23 34 31 46.", media: [], channel: "VOICE", citations: [], at: responseAt } },
    ]);
    expect(await tutoring._task({ task })).toEqual([{ ...taskText, mode: "CHECK", fresh: true, hintRequested: false }]);
    const { sessions } = await tutoring._study({ owner: "sam", topic: "matrix-products" });
    expect(sessions.map(({ session }) => session)).toEqual([lesson, task].sort());
    expect(sessions.map(({ status }) => status)).toEqual(["CLOSED", "CLOSED"]);
    expect(sessions.find(({ session }) => session === task)!.dialogue.map(({ turn }) => turn.purpose)).toEqual(["HINT", "RESPONSE"]);
  });

  test("a GUIDED task accepts hints without a request, while each CHECK hint uses up the pending request", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const { task: guided } = await tutoring.prepareTask({ ...context, ...taskText, mode: "GUIDED", fresh: true });
    await tutoring.giveHint({ owner: "sam", task: guided, text: "Pair row one of A with column one of B.", channel: "TEXT" });
    await tutoring.giveHint({ owner: "sam", task: guided, text: "Now swap the order and compare.", channel: "VOICE" });
    expect((await tutoring._dialogue({ session: guided })).map(({ turn }) => [turn.speaker, turn.purpose, turn.channel]))
      .toEqual([["TUTOR", "HINT", "TEXT"], ["TUTOR", "HINT", "VOICE"]]);
    expect((await tutoring._task({ task: guided }))[0]!.hintRequested).toBe(false);

    const { task: check } = await tutoring.prepareTask({ ...context, ...taskText, mode: "CHECK", fresh: true });
    // Asking twice before the hint arrives still leaves one pending request.
    await tutoring.requestHint({ owner: "sam", task: check });
    await tutoring.requestHint({ owner: "sam", task: check });
    expect((await tutoring._task({ task: check }))[0]!.hintRequested).toBe(true);
    await tutoring.giveHint({ owner: "sam", task: check, text: "Pair row one of A with column one of B.", channel: "TEXT" });
    const before = await savedState();
    await refuses(tutoring.giveHint({ owner: "sam", task: check, text: "Now swap the order and compare.", channel: "TEXT" }), "HINT_NOT_REQUESTED");
    expect(await savedState()).toEqual(before);
    expect((await tutoring._dialogue({ session: check })).map(({ turn }) => turn.purpose)).toEqual(["HINT"]);
  });

  test("re-adding material with the same import key returns the same source for later sessions", async () => {
    const { tutoring, library } = setup();
    const first = await library.add(notes());
    const context = { owner: "sam", topic: "matrix-products", definition: "v1", materials: [first.material], citations: [{ material: first.material, location: "content" }] };
    const { lesson } = await explainedLesson(tutoring, { ...context, ...lessonText });

    const again = await library.add(notes());
    expect(again).toEqual(first);
    const { task } = await tutoring.prepareTask({ ...context, materials: [again.material],
      citations: [{ material: again.material, location: "slides/4" }], ...taskText, mode: "CHECK", fresh: true });
    expect(await tutoring._sources({ session: task })).toEqual(await tutoring._sources({ session: lesson }));
    const { importKey: _, ...data } = notes();
    expect(await library._sourceSet({ owner: "sam", scope: "linear-algebra" })).toEqual({ sources: [{ material: first.material, data }] });
  });

  test("another learner cannot add to, review, or close a learner's sessions", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const { lesson } = await explainedLesson(tutoring, { ...context, ...lessonText });
    const { task } = await tutoring.prepareTask({ ...context, ...taskText, mode: "CHECK", fresh: true });
    const { citations: _cited, ...requested } = context;
    const { lesson: waiting } = await tutoring.requestLesson({ ...requested, request: lessonText.request });
    await tutoring.respond({ owner: "sam", session: lesson, text: "Does AB equal BA?", media: [], channel: "VOICE" });
    await tutoring.requestHint({ owner: "sam", task });
    await tutoring.respond({ owner: "sam", session: task, text: "AB is 19 22 43 50.", media: [], channel: "VOICE" });
    // Leo has his own copy of the notes. A session that names his copy cannot cite Sam's copy.
    // Whether a session's materials are the learner's own is checked by the compositions before this concept is called,
    // and tests/Learning.http.test.ts covers another learner's material on the course endpoints.
    const leo = await sources(library, "leo");
    const before = await savedState();

    await refuses(tutoring.respond({ owner: "leo", session: task, text: "BA is the same.", media: [], channel: "TEXT" }), "RESPONSE_SESSION_UNAVAILABLE");
    await refuses(tutoring.answerLesson({ owner: "leo", lesson, text: "Usually not.", citations: context.citations, channel: "TEXT" }), "LESSON_ANSWER_UNAVAILABLE");
    await refuses(tutoring.requestHint({ owner: "leo", task }), "HINT_REQUEST_UNAVAILABLE");
    await refuses(tutoring.giveHint({ owner: "leo", task, text: "Start with row one.", channel: "TEXT" }), "HINT_TASK_UNAVAILABLE");
    await refuses(tutoring.confirmTranscript({ owner: "leo", session: lesson, turnIndex: 0, text: "Does AB equal BA?" }), "TRANSCRIPT_SESSION_UNAVAILABLE");
    await refuses(tutoring.confirmAttempt({ owner: "leo", task, dialogueLength: 1, unseen: true, outsideHelp: false }), "ATTEMPT_REVIEW_UNAVAILABLE");
    await refuses(tutoring.close({ owner: "leo", session: lesson }), "SESSION_CLOSE_UNAVAILABLE");
    await refuses(tutoring.explainLesson({ owner: "leo", lesson: waiting, explanation: lessonText.explanation, citations: context.citations }), "LESSON_EXPLANATION_UNAVAILABLE");
    await refuses(tutoring.explainLesson({ owner: "leo", lesson: waiting, explanation: lessonText.explanation, citations: leo.citations }), "LESSON_EXPLANATION_UNAVAILABLE");
    await refuses(tutoring.prepareTask({ ...leo, citations: context.citations, ...taskText, mode: "GUIDED", fresh: true }), "INVALID_TASK_SOURCES");
    expect(await savedState()).toEqual(before);

    // Sam's pending hint request survived Leo's refused hint.
    await tutoring.giveHint({ owner: "sam", task, text: "Start with the first row of A.", channel: "TEXT" });
    expect((await tutoring._dialogue({ session: task })).map(({ turn }) => turn.purpose)).toEqual(["RESPONSE", "HINT"]);
    expect(await tutoring._sessions({ owner: "leo", topic: "matrix-products" })).toEqual([]);
    expect((await tutoring._sessions({ owner: "sam", topic: "matrix-products" })).map(({ session }) => session))
      .toEqual([lesson, task, waiting].sort());
  });

  test("refuses blank lesson or task content and invalid sources without creating a session", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const [material] = context.materials;
    const { material: inverses } = await library.add(notes({ importKey: "week-4-notes", title: "Inverses", originals: [] }));
    const before = await savedState();

    const { citations: _cited, ...requested } = context;
    await refuses(tutoring.requestLesson({ ...requested, request: " " }), "INVALID_LESSON_CONTENT");
    await refuses(tutoring.requestLesson({ ...requested, request: lessonText.request, topic: "" }), "INVALID_LESSON_CONTENT");
    await refuses(tutoring.requestLesson({ ...requested, request: lessonText.request, definition: "\n" }), "INVALID_LESSON_CONTENT");
    await refuses(tutoring.prepareTask({ ...context, ...taskText, question: "", mode: "CHECK", fresh: true }), "INVALID_TASK_CONTENT");
    await refuses(tutoring.prepareTask({ ...context, ...taskText, criteria: "\n", mode: "CHECK", fresh: true }), "INVALID_TASK_CONTENT");
    await refuses(tutoring.prepareTask({ ...context, ...taskText, mode: "COACH" as unknown as Mode, fresh: true }), "INVALID_TASK_CONTENT");
    await refuses(tutoring.prepareTask({ ...context, ...taskText, mode: "CHECK", fresh: "yes" as unknown as boolean }), "INVALID_TASK_CONTENT");
    // The concept checks only what it can see: the session's own material set and the shape of each citation. Ownership,
    // a shared course, and whether a cited location exists in its material are checked by the compositions and the host,
    // so a material from another learner or course, or an invented location, no longer appears in this list.
    const invalidSources: { owner?: string; materials?: Material[]; citations?: PassageRef[] }[] = [
      { materials: [], citations: [] },
      { citations: [] },
      { materials: [material!, material!] },
      { citations: [{ material: inverses, location: "content" }] },
      { materials: [randomUUID() as Material] },
      { citations: [{ material: material!, location: " " }] },
      { citations: [{ material: material!, location: "content" }, { material: material!, location: "content" }] },
      { owner: " " },
    ];
    for (const invalid of invalidSources) {
      await refuses(tutoring.prepareTask({ ...context, ...taskText, mode: "CHECK", fresh: true, ...invalid }), "INVALID_TASK_SOURCES");
    }
    // A lesson is saved before it has citations, so its request is checked only against the material rules. Its
    // explanation's citations are checked when it is explained (see the next test).
    const invalidMaterials: { owner?: string; materials?: Material[] }[] = [
      { materials: [] }, { materials: [material!, material!] }, { materials: [" " as Material] }, { owner: " " },
    ];
    for (const invalid of invalidMaterials) {
      await refuses(tutoring.requestLesson({ ...requested, request: lessonText.request, ...invalid }), "INVALID_LESSON_SOURCES");
    }
    expect(await savedState()).toEqual(before);
    expect(await tutoring._sessions({ owner: "sam", topic: "matrix-products" })).toEqual([]);
  });

  test("an unexplained lesson refuses dialogue until it takes one valid explanation, only from its owner while open", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const [material] = context.materials;
    const { material: inverses } = await library.add(notes({ importKey: "week-4-notes", title: "Inverses", originals: [] }));
    const { citations, ...requested } = context;
    const { lesson } = await tutoring.requestLesson({ ...requested, request: lessonText.request });
    const { task } = await tutoring.prepareTask({ ...context, ...taskText, mode: "GUIDED", fresh: true });
    const { lesson: closed } = await tutoring.requestLesson({ ...requested, request: "A lesson finished before its explanation arrived." });
    await tutoring.close({ owner: "sam", session: closed });
    const before = await savedState();

    // Nothing joins the dialogue before the opening explanation.
    await refuses(tutoring.respond({ owner: "sam", session: lesson, text: "Why?", media: [], channel: "TEXT" }), "RESPONSE_SESSION_UNAVAILABLE");
    await refuses(tutoring.answerLesson({ owner: "sam", lesson, text: "Usually not.", citations, channel: "TEXT" }), "LESSON_ANSWER_UNAVAILABLE");
    // Only the owner's open lesson that is still unexplained takes an explanation.
    for (const [owner, target] of [["leo", lesson], ["sam", task], ["sam", closed], ["sam", randomUUID() as Session]] as const) {
      await refuses(tutoring.explainLesson({ owner, lesson: target, explanation: lessonText.explanation, citations }), "LESSON_EXPLANATION_UNAVAILABLE");
    }
    // A blank explanation, or citations that break the source rules for the lesson's own materials, are refused.
    await refuses(tutoring.explainLesson({ owner: "sam", lesson, explanation: " ", citations }), "INVALID_LESSON_EXPLANATION");
    const invalidCitations: PassageRef[][] = [
      [], [{ material: inverses, location: "content" }], [{ material: material!, location: " " }], [citations[0]!, citations[0]!],
    ];
    for (const invalid of invalidCitations) {
      await refuses(tutoring.explainLesson({ owner: "sam", lesson, explanation: lessonText.explanation, citations: invalid }), "INVALID_LESSON_EXPLANATION");
    }
    expect(await savedState()).toEqual(before);
    expect(await tutoring._lesson({ lesson })).toEqual([{ request: lessonText.request, explanation: "" }]);

    await tutoring.explainLesson({ owner: "sam", lesson, explanation: lessonText.explanation, citations });
    expect(await tutoring._lesson({ lesson })).toEqual([lessonText]);
    expect(await tutoring._citations({ session: lesson })).toEqual([{ citation: citations[0] }]);
    expect(await tutoring._dialogue({ session: lesson })).toEqual([]);
    // The explanation is set once.
    const explained = await savedState();
    await refuses(tutoring.explainLesson({ owner: "sam", lesson, explanation: "A second opening.", citations }), "LESSON_EXPLANATION_UNAVAILABLE");
    expect(await savedState()).toEqual(explained);
    // Now the lesson takes questions and answers.
    await tutoring.respond({ owner: "sam", session: lesson, text: "Why?", media: [], channel: "TEXT" });
    await tutoring.answerLesson({ owner: "sam", lesson, text: "Usually not.", citations, channel: "TEXT" });
    expect((await tutoring._dialogue({ session: lesson })).map(({ turn }) => turn.purpose)).toEqual(["RESPONSE", "EXPLANATION"]);
  });

  test("refuses blank or malformed dialogue additions without changing the open sessions", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const { material: inverses } = await library.add(notes({ importKey: "week-4-notes", title: "Inverses" }));
    const { lesson } = await explainedLesson(tutoring, { ...context, ...lessonText });
    const { task } = await tutoring.prepareTask({ ...context, ...taskText, mode: "GUIDED", fresh: true });
    await tutoring.respond({ owner: "sam", session: task, text: "AB is 19 22 43 50.", media: [], channel: "TEXT" });
    await tutoring.giveHint({ owner: "sam", task, text: "Now try BA.", channel: "TEXT" });
    await tutoring.respond({ owner: "sam", session: task, text: "BA is 23 34 31 46.", media: [], channel: "VOICE" });
    await tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 2, text: "BA is 23, 34, 31, 46." });
    const before = await savedState();

    await refuses(tutoring.respond({ owner: "sam", session: task, text: " ", media: [], channel: "TEXT" }), "INVALID_LEARNER_RESPONSE");
    // A spoken response needs a transcript even when it has an attachment.
    await refuses(tutoring.respond({ owner: "sam", session: task, text: "", media: [photo], channel: "VOICE" }), "INVALID_LEARNER_RESPONSE");
    await refuses(tutoring.respond({ owner: "sam", session: task, text: "BA", media: [], channel: "VIDEO" as unknown as Channel }), "INVALID_LEARNER_RESPONSE");
    await refuses(tutoring.answerLesson({ owner: "sam", lesson, text: " ", citations: context.citations, channel: "TEXT" }), "INVALID_LESSON_ANSWER");
    await refuses(tutoring.answerLesson({ owner: "sam", lesson, text: "Usually not.", citations: [], channel: "TEXT" }), "INVALID_LESSON_ANSWER");
    await refuses(tutoring.answerLesson({ owner: "sam", lesson, text: "Usually not.", citations: [{ material: inverses, location: "content" }], channel: "TEXT" }), "INVALID_LESSON_ANSWER");
    await refuses(tutoring.giveHint({ owner: "sam", task, text: "", channel: "TEXT" }), "INVALID_HINT_TEXT");
    // Only index 2 is an original spoken response. 0 is typed, 1 is a hint, and 3 is a correction.
    for (const turnIndex of [0, 1, 3, 4, -1, 1.5]) {
      await refuses(tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex, text: "BA is 23 34 31 46." }), "TRANSCRIPT_TURN_UNAVAILABLE");
    }
    await refuses(tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 2, text: "  " }), "INVALID_CONFIRMED_TRANSCRIPT");
    await refuses(tutoring.confirmAttempt({ owner: "sam", task, dialogueLength: 3, unseen: true, outsideHelp: false }), "ATTEMPT_REVIEW_CHANGED");
    expect(await savedState()).toEqual(before);

    // A typed response may consist of an attachment alone.
    await tutoring.respond({ owner: "sam", session: task, text: "", media: [photo], channel: "TEXT" });
    expect((await tutoring._dialogue({ session: task })).at(-1)!.turn).toMatchObject({ purpose: "RESPONSE", text: "", media: [photo] });
  });

  test("refuses actions on a closed, unknown, or wrong kind of session", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const { lesson } = await explainedLesson(tutoring, { ...context, ...lessonText });
    const { task } = await tutoring.prepareTask({ ...context, ...taskText, mode: "GUIDED", fresh: true });
    const { lesson: closedLesson } = await explainedLesson(tutoring, { ...context, ...lessonText });
    await tutoring.close({ owner: "sam", session: closedLesson });
    const { task: closedTask } = await tutoring.prepareTask({ ...context, ...taskText, mode: "GUIDED", fresh: true });
    await tutoring.respond({ owner: "sam", session: closedTask, text: "AB is 19 22 43 50.", media: [], channel: "VOICE" });
    await tutoring.close({ owner: "sam", session: closedTask });
    const unknown = randomUUID() as Session;
    const before = await savedState();

    // Lessons and tasks accept different actions.
    await refuses(tutoring.answerLesson({ owner: "sam", lesson: task, text: "Usually not.", citations: context.citations, channel: "TEXT" }), "LESSON_ANSWER_UNAVAILABLE");
    await refuses(tutoring.requestHint({ owner: "sam", task: lesson }), "HINT_REQUEST_UNAVAILABLE");
    await refuses(tutoring.giveHint({ owner: "sam", task: lesson, text: "Pair rows with columns.", channel: "TEXT" }), "HINT_TASK_UNAVAILABLE");
    await refuses(tutoring.confirmAttempt({ owner: "sam", task: lesson, dialogueLength: 0 }), "ATTEMPT_REVIEW_UNAVAILABLE");
    // Closed and unknown sessions accept nothing, including a second close.
    for (const [session, length] of [[closedLesson, 0], [closedTask, 1], [unknown, 0]] as const) {
      await refuses(tutoring.respond({ owner: "sam", session, text: "A late answer.", media: [], channel: "TEXT" }), "RESPONSE_SESSION_UNAVAILABLE");
      await refuses(tutoring.answerLesson({ owner: "sam", lesson: session, text: "Usually not.", citations: context.citations, channel: "TEXT" }), "LESSON_ANSWER_UNAVAILABLE");
      await refuses(tutoring.explainLesson({ owner: "sam", lesson: session, explanation: "A late opening.", citations: context.citations }), "LESSON_EXPLANATION_UNAVAILABLE");
      await refuses(tutoring.requestHint({ owner: "sam", task: session }), "HINT_REQUEST_UNAVAILABLE");
      await refuses(tutoring.giveHint({ owner: "sam", task: session, text: "Pair rows with columns.", channel: "TEXT" }), "HINT_TASK_UNAVAILABLE");
      await refuses(tutoring.confirmTranscript({ owner: "sam", session, turnIndex: 0, text: "AB is 19 22 43 50." }), "TRANSCRIPT_SESSION_UNAVAILABLE");
      await refuses(tutoring.confirmAttempt({ owner: "sam", task: session, dialogueLength: length }), "ATTEMPT_REVIEW_UNAVAILABLE");
      await refuses(tutoring.close({ owner: "sam", session }), "SESSION_CLOSE_UNAVAILABLE");
    }
    // Only a closed lesson reopens: an open lesson, an open or closed task, and an unknown session are refused.
    for (const session of [lesson, task, closedTask, unknown]) await refuses(tutoring.reopenLesson({ owner: "sam", lesson: session }), "LESSON_REOPEN_UNAVAILABLE");
    expect(await savedState()).toEqual(before);
  });

  test("a finished lesson reopens for its owner with only its status changed, takes dialogue again, and can be finished and reopened again", async () => {
    const { tutoring, library, tick } = setup();
    const context = await sources(library);
    const { lesson } = await explainedLesson(tutoring, { ...context, ...lessonText });
    const askedAt = tick();
    await tutoring.respond({ owner: "sam", session: lesson, text: "Does AB equal BA?", media: [], channel: "VOICE" });
    const answeredAt = tick();
    await tutoring.answerLesson({ owner: "sam", lesson, text: "Usually not.", citations: context.citations, channel: "TEXT" });
    const whileOpen = await tutoring._sessionData({ session: lesson });
    await tutoring.close({ owner: "sam", session: lesson });
    // Leo has his own closed lesson, which Sam cannot reopen either.
    const leo = await sources(library, "leo");
    const { lesson: leosLesson } = await explainedLesson(tutoring, { ...leo, ...lessonText });
    await tutoring.close({ owner: "leo", session: leosLesson });
    const closed = await savedState();

    // Another learner cannot reopen the lesson, in either direction, and nothing changes.
    await refuses(tutoring.reopenLesson({ owner: "leo", lesson }), "LESSON_REOPEN_UNAVAILABLE");
    await refuses(tutoring.reopenLesson({ owner: "sam", lesson: leosLesson }), "LESSON_REOPEN_UNAVAILABLE");
    expect(await savedState()).toEqual(closed);

    await tutoring.reopenLesson({ owner: "sam", lesson });
    // Only the status changes; the stored record also moves its revision, as every change does. The request, opening
    // explanation, citations, sources, definition, and dialogue read exactly as they did before the lesson was finished.
    expect(await savedState()).toEqual({
      ...closed,
      "groundedtutoring.sessions": closed["groundedtutoring.sessions"]!.map((row) => row._id === lesson ? { ...row, status: "OPEN", revision: row.revision + 1 } : row),
    });
    expect(await tutoring._sessionData({ session: lesson })).toEqual(whileOpen);
    expect(await tutoring._session({ session: lesson })).toEqual([{ owner: "sam", topic: "matrix-products", definition: "v1", status: "OPEN" }]);
    // A lesson that is open again cannot be reopened a second time.
    await refuses(tutoring.reopenLesson({ owner: "sam", lesson }), "LESSON_REOPEN_UNAVAILABLE");

    // The reopened lesson takes dialogue again after its earlier turns, which keep their indices.
    const correctedAt = tick();
    await tutoring.confirmTranscript({ owner: "sam", session: lesson, turnIndex: 0, text: "Does AB equal BA for matrices?" });
    const laterAt = tick();
    await tutoring.respond({ owner: "sam", session: lesson, text: "When do AB and BA agree?", media: [], channel: "TEXT" });
    const laterAnswerAt = tick();
    await tutoring.answerLesson({ owner: "sam", lesson, text: "When the two matrices commute.", citations: context.citations, channel: "TEXT" });
    expect((await tutoring._dialogue({ session: lesson })).map(({ turnIndex, turn }) => [turnIndex, turn.purpose, turn.text, turn.at])).toEqual([
      [0, "RESPONSE", "Does AB equal BA?", askedAt],
      [1, "EXPLANATION", "Usually not.", answeredAt],
      [2, "CORRECTION", "Does AB equal BA for matrices?", correctedAt],
      [3, "RESPONSE", "When do AB and BA agree?", laterAt],
      [4, "EXPLANATION", "When the two matrices commute.", laterAnswerAt],
    ]);

    // It can be finished and continued again, any number of times.
    await tutoring.close({ owner: "sam", session: lesson });
    await refuses(tutoring.respond({ owner: "sam", session: lesson, text: "One more?", media: [], channel: "TEXT" }), "RESPONSE_SESSION_UNAVAILABLE");
    await tutoring.reopenLesson({ owner: "sam", lesson });
    await tutoring.respond({ owner: "sam", session: lesson, text: "One more?", media: [], channel: "TEXT" });
    expect(await tutoring._dialogue({ session: lesson })).toHaveLength(6);
    expect((await tutoring._session({ session: leosLesson }))[0]!.status).toBe("CLOSED");
  });

  test("a lesson finished before its opening explanation reopens still waiting for it, and then takes it", async () => {
    const { tutoring, library } = setup();
    const { citations, ...requested } = await sources(library);
    const { lesson } = await tutoring.requestLesson({ ...requested, request: lessonText.request });
    await tutoring.close({ owner: "sam", session: lesson });
    await tutoring.reopenLesson({ owner: "sam", lesson });
    expect(await tutoring._lesson({ lesson })).toEqual([{ request: lessonText.request, explanation: "" }]);
    expect(await tutoring._citations({ session: lesson })).toEqual([]);
    // It is unexplained again, so no question comes before the opening explanation.
    await refuses(tutoring.respond({ owner: "sam", session: lesson, text: "Why?", media: [], channel: "TEXT" }), "RESPONSE_SESSION_UNAVAILABLE");
    await tutoring.explainLesson({ owner: "sam", lesson, explanation: lessonText.explanation, citations });
    expect(await tutoring._lesson({ lesson })).toEqual([lessonText]);
    await tutoring.respond({ owner: "sam", session: lesson, text: "Why?", media: [], channel: "TEXT" });
    expect(await tutoring._dialogue({ session: lesson })).toHaveLength(1);
  });

  test("repeated transcript confirmations add a correction only for changed text, and later speech needs another review", async () => {
    const { tutoring, library } = setup();
    const context = await sources(library);
    const { task } = await tutoring.prepareTask({ ...context, ...taskText, mode: "CHECK", fresh: true });
    await tutoring.respond({ owner: "sam", session: task, text: "AB is 19 22 43 50.", media: [], channel: "VOICE" });
    await tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 0, text: "AB is 19 22 43 50." });
    expect(await tutoring._dialogue({ session: task })).toHaveLength(1);
    await tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 0, text: "AB is 19, 22, 43, 50." });
    await tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 0, text: "AB is [[19, 22], [43, 50]]." });
    await tutoring.confirmTranscript({ owner: "sam", session: task, turnIndex: 0, text: "AB is [[19, 22], [43, 50]]." });
    expect((await tutoring._dialogue({ session: task })).map(({ turn }) => [turn.purpose, turn.text, turn.correctionTarget])).toEqual([
      ["RESPONSE", "AB is 19 22 43 50.", undefined],
      ["CORRECTION", "AB is 19, 22, 43, 50.", 0],
      ["CORRECTION", "AB is [[19, 22], [43, 50]].", 0],
    ]);
    expect(await tutoring._voiceResponses({ session: task })).toEqual([{ turnIndex: 0, text: "AB is [[19, 22], [43, 50]].", confirmed: true }]);
    expect(await tutoring._review({ task })).toEqual([{ dialogueLength: 3, uncheckedVoiceCount: 0, ready: true }]);

    await tutoring.respond({ owner: "sam", session: task, text: "BA is 23 34 31 46.", media: [], channel: "VOICE" });
    expect(await tutoring._review({ task })).toEqual([{ dialogueLength: 4, uncheckedVoiceCount: 1, ready: false }]);
    await tutoring.confirmAttempt({ owner: "sam", task, dialogueLength: 4 });
    expect(await tutoring._review({ task })).toEqual([{ dialogueLength: 4, uncheckedVoiceCount: 0, ready: true }]);
  });
});
