import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { MasteryEstimating, type Signal, type StartingBasis } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
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
  INVALID_INITIAL_CONFIDENCE: "Enter a confidence value from 0 to 100.",
  MASTERY_TRACK_EXISTS: "This skill version already has an estimate.",
  EVIDENCE_TRACK_UNAVAILABLE: "Set a starting estimate for this skill version first.",
  INVALID_MASTERY_EVIDENCE: "Provide a valid revision, attempt date, result, and assessment explanation.",
  EVIDENCE_TRACK_MISMATCH: "Keep this attempt with its original learner, skill, and requirements version.",
  EVIDENCE_DATE_MISMATCH: "Keep the original attempt date when applying a regrade.",
  EVIDENCE_REVISION_NOT_NEW: "This judgment revision has already been applied or replaced.",
  ADJUSTMENT_TRACK_UNAVAILABLE: "Choose a skill version with a starting estimate.",
  INVALID_MASTERY_ADJUSTMENT: "Enter a value from 0 to 100 and explain the adjustment.",
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

type EvidenceInput = Parameters<MasteryEstimating["acceptEvidence"]>[0];

const start = new Date("2026-09-01T12:00:00Z"), day = 86_400_000;
const at = (days: number) => new Date(start.getTime() + days * day);
/** Policy prototype-1 halves the estimate every 60 days without practice. */
const decay = (value: number, days: number) => value * 2 ** (-days / 60);
const sam = { learner: "sam", subject: "matrix-products", definition: "v1" };

function setup() {
  let now = start;
  const mastery = new MasteryEstimating(connection!.db, "MasteryEstimating", () => now);
  const estimate = async (days: number, identity = sam) => (await mastery._estimate({ ...identity, at: at(days) }))[0]!;
  return { mastery, estimate, setDay: (days: number) => { now = at(days); } };
}

function evidence(id: string, signal: Signal, performedAt: Date, overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return { ...sam, evidence: id, revision: 1, performedAt, signal, fresh: true, gateMet: false, attribution: `Assessment of ${id}`, ...overrides };
}

describe("MasteryEstimating", () => {
  test("principle: confidence decays, assisted and independent work restore it, a regrade replays, and an adjustment resets it", async () => {
    const { mastery, estimate, setDay } = setup();
    const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    expect(await mastery._track(sam)).toEqual([{ track, initialConfidence: 80, startingBasis: "SELF_REPORTED", initializedAt: start }]);
    expect(await estimate(0)).toMatchObject({ value: 80, ready: false, basis: expect.stringContaining("provisional") });

    // One half-life without practice halves the estimate.
    setDay(60);
    expect((await estimate(60)).value).toBeCloseTo(40);
    // Success with help restores half of the loss.
    await mastery.acceptEvidence(evidence("attempt-a", "SUPPORTED", at(60)));
    expect((await estimate(60)).value).toBeCloseTo(60);
    // Fresh independent work a day later adds the partial gain, which is still below readiness.
    setDay(61);
    await mastery.acceptEvidence(evidence("attempt-b", "INDEPENDENT", at(61)));
    expect(await estimate(61)).toMatchObject({ value: expect.closeTo(decay(60, 1) + 10, 9), ready: false });

    // A regrade replaces attempt-a at its original date, and the later gain is recalculated from there.
    const [original] = await mastery._inputs({ track });
    const regraded = await mastery.acceptEvidence(evidence("attempt-a", "SLIP", at(60), { revision: 2, attribution: "The regrade found one wrong entry." }));
    expect(regraded.input).toBe(original!.input);
    const afterSlip = decay(80, 60) - 5;
    expect((await estimate(61)).value).toBeCloseTo(decay(afterSlip, 1) + 10);
    expect((await mastery._inputs({ track })).map(({ evidence: id, revision, signal }) => [id, revision, signal]))
      .toEqual([["attempt-a", 2, "SLIP"], ["attempt-b", 1, "INDEPENDENT"]]);

    // A manual adjustment sets a new value. Time and later practice still change it.
    setDay(62);
    const reason = "I reviewed the chapter this morning.";
    const { adjustment } = await mastery.adjust({ ...sam, value: 60, reason });
    expect(await mastery._adjustments({ track })).toEqual([{ adjustment, value: 60, reason, at: at(62) }]);
    expect(await estimate(62)).toMatchObject({ value: 60, ready: false });
    expect((await estimate(63)).value).toBeCloseTo(decay(60, 1));
    setDay(63);
    await mastery.acceptEvidence(evidence("attempt-c", "INDEPENDENT", at(63), { gateMet: true }));
    expect(await estimate(63)).toMatchObject({ value: 95, ready: true });

    const [{ explanation }] = await mastery._explanation({ ...sam, at: at(63) });
    expect(explanation.evidence).toEqual([{ evidence: "attempt-a", revision: 2 }, { evidence: "attempt-b", revision: 1 }, { evidence: "attempt-c", revision: 1 }]);
    expect(explanation.changes.map(({ source }) => source)).toEqual(["attempt-a", "attempt-b", adjustment, "attempt-c"]);
    // An earlier query time uses only the evidence and adjustments dated by then.
    expect((await estimate(60)).value).toBeCloseTo(afterSlip);
    expect(await mastery._estimate({ ...sam, at: new Date(start.getTime() - 1) })).toEqual([]);
    const { tracks } = await mastery._progress({ learner: "sam" });
    expect(tracks.map(({ track: id, inputs, estimate: current }) => ({ id, inputs: inputs.length, value: current?.value, ready: current?.ready })))
      .toEqual([{ id: track, inputs: 3, value: 95, ready: true }]);
  });

  test("work done before setup calibrates the estimate from the attempt's date", async () => {
    const { mastery, estimate, setDay } = setup();
    setDay(10);
    await mastery.initialize({ ...sam, confidence: 50, basis: "SELF_REPORTED" });
    await mastery.acceptEvidence(evidence("earlier-exam", "INDEPENDENT", at(0), { gateMet: true }));
    // Replay starts at the earlier attempt, so the full gate applies there and then decays for 10 days.
    expect((await mastery._explanation({ ...sam, at: at(10) }))[0]!.explanation.replayStart).toEqual(at(0));
    expect(await estimate(10)).toMatchObject({ value: expect.closeTo(decay(95, 10), 9), ready: true });
    expect(await mastery._estimate({ ...sam, at: at(5) })).toEqual([]);
  });

  test("two learners keep separate estimates for the same skill", async () => {
    const { mastery, estimate } = setup();
    await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    const leo = { ...sam, learner: "leo" };
    await mastery.initialize({ ...leo, confidence: 80, basis: "SELF_REPORTED" });
    await mastery.acceptEvidence(evidence("leo-attempt", "GAP", start, { learner: "leo" }));
    expect((await estimate(0, leo)).value).toBe(60);
    await mastery.adjust({ ...leo, value: 30, reason: "I have not used this since last year." });
    expect((await estimate(0, leo)).value).toBe(30);
    expect((await estimate(0)).value).toBe(80);
    expect((await mastery._progress({ learner: "sam" })).tracks.map(({ inputs }) => inputs)).toEqual([[]]);
  });

  test("refuses an invalid starting confidence and a second track for the same requirements", async () => {
    const { mastery, setDay } = setup();
    const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    const before = await savedState();

    for (const confidence of [-1, 100.5, Number.NaN, Number.POSITIVE_INFINITY, "80" as unknown as number]) {
      await refuses(mastery.initialize({ ...sam, definition: "v2", confidence, basis: "SELF_REPORTED" }), "INVALID_INITIAL_CONFIDENCE");
    }
    await refuses(mastery.initialize({ ...sam, definition: "v2", confidence: 80, basis: "GUESSED" as unknown as StartingBasis }), "INVALID_INITIAL_CONFIDENCE");
    await refuses(mastery.initialize({ ...sam, confidence: 30, basis: "PREVIOUS_DEFINITION" }), "MASTERY_TRACK_EXISTS");
    expect(await savedState()).toEqual(before);
    expect(await mastery._track(sam)).toEqual([{ track, initialConfidence: 80, startingBasis: "SELF_REPORTED", initializedAt: start }]);

    // The bounds are valid scores. A new definition gets its own track.
    setDay(1);
    const { track: revised } = await mastery.initialize({ ...sam, definition: "v2", confidence: 100, basis: "PREVIOUS_DEFINITION" });
    await mastery.initialize({ ...sam, learner: "leo", confidence: 0, basis: "SELF_REPORTED" });
    expect((await mastery._tracks({ learner: "sam", subject: "matrix-products" })).map(({ track: id, definition }) => [id, definition]))
      .toEqual([[track, "v1"], [revised, "v2"]]);
  });

  test("refuses evidence for a missing track, invalid evidence, and conflicting regrades without changing the estimate", async () => {
    const { mastery, estimate, setDay } = setup();
    await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    await mastery.initialize({ ...sam, learner: "leo", confidence: 50, basis: "SELF_REPORTED" });
    setDay(2);
    await mastery.acceptEvidence(evidence("attempt-a", "SLIP", at(1)));
    const before = await savedState();
    const estimateBefore = await estimate(2);

    await refuses(mastery.acceptEvidence(evidence("attempt-b", "GAP", at(1), { definition: "v2" })), "EVIDENCE_TRACK_UNAVAILABLE");
    const invalidEvidence: Partial<EvidenceInput>[] = [
      { revision: 0 }, { revision: 1.5 }, { performedAt: at(3) }, { performedAt: new Date(Number.NaN) },
      { attribution: " " }, { attribution: 7 as unknown as string },
      { signal: "PASS" as unknown as Signal }, { fresh: "yes" as unknown as boolean },
      { signal: "SUPPORTED", gateMet: true }, { fresh: false, gateMet: true },
    ];
    for (const invalid of invalidEvidence) {
      await refuses(mastery.acceptEvidence(evidence("attempt-b", "INDEPENDENT", at(1), invalid)), "INVALID_MASTERY_EVIDENCE");
    }
    // Leo cannot move Sam's attempt to his own track.
    await refuses(mastery.acceptEvidence(evidence("attempt-a", "INDEPENDENT", at(1), { learner: "leo", revision: 2 })), "EVIDENCE_TRACK_MISMATCH");
    // A regrade keeps the original date and needs a newer revision. A repeated delivery is refused.
    await refuses(mastery.acceptEvidence(evidence("attempt-a", "INDEPENDENT", at(2), { revision: 2 })), "EVIDENCE_DATE_MISMATCH");
    await refuses(mastery.acceptEvidence(evidence("attempt-a", "SLIP", at(1))), "EVIDENCE_REVISION_NOT_NEW");
    expect(await savedState()).toEqual(before);
    expect(await estimate(2)).toEqual(estimateBefore);
  });

  test("refuses an adjustment without a track, with an invalid value, or without a reason", async () => {
    const { mastery, estimate } = setup();
    const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    const before = await savedState();

    await refuses(mastery.adjust({ ...sam, learner: "leo", value: 50, reason: "Prior coursework." }), "ADJUSTMENT_TRACK_UNAVAILABLE");
    const invalidAdjustments: [number, string][] = [
      [101, "Prior coursework."], [-1, "Prior coursework."], [Number.NaN, "Prior coursework."],
      [50, " "], [50, undefined as unknown as string],
    ];
    for (const [value, reason] of invalidAdjustments) {
      await refuses(mastery.adjust({ ...sam, value, reason }), "INVALID_MASTERY_ADJUSTMENT");
    }
    expect(await savedState()).toEqual(before);
    expect(await mastery._adjustments({ track })).toEqual([]);
    expect((await estimate(0)).value).toBe(80);
  });
});
