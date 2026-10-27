import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { Document } from "mongodb";
import { MasteryEstimating, type Signal, type StartingBasis } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import {
  D0, D0raw, DAY, DECAY, type Grade, R, S0, W, daysBetween, g0, gradeOf, lapseS, leftAlone, nextD, review, sameDayS, seed, successFactor,
} from "./fixtures/fsrs.ts";

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
  INVALID_ADJUSTMENT_KEY: "Provide a nonblank adjustment key.",
  ADJUSTMENT_KEY_CONFLICT: "Use the original skill, value, and reason when retrying this adjustment.",
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
type AdjustInput = Parameters<MasteryEstimating["adjust"]>[0];

const start = new Date("2026-09-01T12:00:00Z"), day = DAY;
const at = (days: number) => new Date(start.getTime() + days * day);
/** Fresh independent work without the full gate adds up to 10, but not past 79 or past the highest value reached before. */
const partialGain = (value: number, highest: number) => Math.max(value, Math.min(Math.max(79, highest), value + 10));
/** The concept and the test each round a fractional day count to whole milliseconds, so two instants match within one. */
function sameInstant(actual: Date, expected: number) {
  expect(Math.abs(actual.getTime() - expected)).toBeLessThanOrEqual(1);
}
const sam = { learner: "sam", subject: "matrix-products", definition: "v1" };
const leo = { ...sam, learner: "leo" };

function setup() {
  let now = start;
  const mastery = new MasteryEstimating(connection!.db, "MasteryEstimating", () => now);
  const estimate = async (days: number, identity = sam) => (await mastery._estimate({ ...identity, at: at(days) }))[0]!;
  const explain = async (when: Date, identity = sam) => (await mastery._explanation({ ...identity, at: when }))[0]!.explanation;
  return { mastery, estimate, explain, setDay: (days: number) => { now = at(days); } };
}

function evidence(id: string, signal: Signal, performedAt: Date, overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return { ...sam, evidence: id, revision: 1, performedAt, signal, fresh: true, gateMet: false, attribution: `Assessment of ${id}`, ...overrides };
}

const reviewed = "I reviewed the chapter this morning.";
function adjustment(adjustmentKey: string, value: number, reason = reviewed, overrides: Partial<AdjustInput> = {}): AdjustInput {
  return { ...sam, adjustmentKey, value, reason, ...overrides };
}

describe("MasteryEstimating", () => {
  test("principle: confidence fades without practice, assisted and independent work restore it, a regrade replays, and an adjustment resets it", async () => {
    const { mastery, estimate, explain, setDay } = setup();
    const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    expect(await mastery._track(sam)).toEqual([{ track, initialConfidence: 80, startingBasis: "SELF_REPORTED", initializedAt: start }]);
    expect(await estimate(0)).toMatchObject({ value: 80, ready: false, basis: expect.stringContaining("provisional") });

    // Sixty days without practice lower the estimate along the forgetting curve of the memory that 80 seeds.
    const seeded = seed(80), faded = 80 * R(60, seeded.stability);
    setDay(60);
    expect((await estimate(60)).value).toBeCloseTo(faded, 9);
    // Success with help restores half of the loss. It counts as a Hard review, so the memory becomes more stable.
    await mastery.acceptEvidence(evidence("attempt-a", "SUPPORTED", at(60)));
    const helped = (faded + 80) / 2, afterHelp = review(seeded, gradeOf("SUPPORTED"), 60);
    expect((await estimate(60)).value).toBeCloseTo(helped, 9);
    expect((await explain(at(60))).stability).toBeCloseTo(afterHelp.stability, 9);
    expect(afterHelp.stability).toBeGreaterThan(seeded.stability);
    // Fresh independent work a day later adds the partial gain, which reaches readiness.
    setDay(61);
    await mastery.acceptEvidence(evidence("attempt-b", "INDEPENDENT", at(61)));
    expect(await estimate(61)).toMatchObject({ value: expect.closeTo(partialGain(helped * R(1, afterHelp.stability), 80), 9), ready: true });

    // A regrade replaces attempt-a at its original date, and the later gain is recalculated from there.
    // The slip leaves the estimate below the readiness minimum.
    const [original] = await mastery._inputs({ track });
    const regraded = await mastery.acceptEvidence(evidence("attempt-a", "SLIP", at(60), { revision: 2, attribution: "The regrade found one wrong entry." }));
    expect(regraded.input).toBe(original!.input);
    const afterSlip = faded - 5, slipped = review(seeded, gradeOf("SLIP"), 60);
    const afterIndependent = review(slipped, gradeOf("INDEPENDENT"), 1);
    expect(await estimate(61)).toMatchObject({ value: expect.closeTo(partialGain(afterSlip * R(1, slipped.stability), 80), 9), ready: false });
    expect((await explain(at(61))).stability).toBeCloseTo(afterIndependent.stability, 9);
    expect((await mastery._inputs({ track })).map(({ evidence: id, revision, signal }) => [id, revision, signal]))
      .toEqual([["attempt-a", 2, "SLIP"], ["attempt-b", 1, "INDEPENDENT"]]);

    // A manual adjustment sets a new value. Time and later practice still change it, and the memory keeps its stability.
    setDay(62);
    const { adjustment: adjusted } = await mastery.adjust(adjustment("principle-adjustment", 60));
    expect(await mastery._adjustments({ track })).toEqual([{ adjustment: adjusted, value: 60, reason: reviewed, at: at(62) }]);
    expect(await estimate(62)).toMatchObject({ value: 60, ready: false });
    expect((await estimate(63)).value).toBeCloseTo(60 * R(1, afterIndependent.stability), 9);
    setDay(63);
    await mastery.acceptEvidence(evidence("attempt-c", "INDEPENDENT", at(63), { gateMet: true }));
    expect(await estimate(63)).toMatchObject({ value: 95, ready: true });

    const [{ explanation }] = await mastery._explanation({ ...sam, at: at(63) });
    expect(explanation.evidence).toEqual([{ evidence: "attempt-a", revision: 2 }, { evidence: "attempt-b", revision: 1 }, { evidence: "attempt-c", revision: 1 }]);
    expect(explanation.changes.map(({ source }) => source)).toEqual(["attempt-a", "attempt-b", adjusted, "attempt-c"]);
    // The last review counts its days from the adjustment, the last event before it.
    expect(explanation.stability).toBeCloseTo(review(afterIndependent, gradeOf("INDEPENDENT"), daysBetween(at(63), at(62))).stability, 9);
    // An earlier query time uses only the evidence and adjustments dated by then.
    expect((await estimate(60)).value).toBeCloseTo(afterSlip, 9);
    expect(await mastery._estimate({ ...sam, at: new Date(start.getTime() - 1) })).toEqual([]);
    const { tracks } = await mastery._progress({ learner: "sam" });
    expect(tracks.map(({ track: id, inputs, adjustments, estimate: current }) => ({ id, inputs: inputs.length, adjustments, value: current?.value, ready: current?.ready })))
      .toEqual([{ id: track, inputs: 3, adjustments: [{ adjustment: adjusted, value: 60, reason: reviewed, at: at(62) }], value: 95, ready: true }]);
  });

  test("_policy reports the policy's settings and _withoutPractice gives the curve a track's estimate follows with no evidence", async () => {
    const { mastery, estimate, setDay } = setup();
    const policy = { policy: "fsrs-1", desiredRetention: 0.9, readinessMinimum: 70, readinessDays: 14, parameters: W };
    expect(await mastery._policy()).toEqual(policy);
    // The same curve as a track left alone, from any starting value, with no track and no stored state.
    await mastery.initialize({ ...sam, confidence: 90, basis: "SELF_REPORTED" });
    for (const days of [0, 1, 3, 7, 14, 30, 60, 90, 180]) {
      const { value } = await mastery._withoutPractice({ confidence: 90, days });
      expect(value).toBeCloseTo((await estimate(days)).value, 9);
      expect(value).toBeCloseTo(leftAlone(90, days), 9);
    }
    // A lower starting confidence seeds a less stable memory, so it keeps a smaller share after the same time.
    const kept = async (confidence: number) => (await mastery._withoutPractice({ confidence, days: 30 })).value / confidence;
    expect(await kept(40)).toBeCloseTo(R(30, S0(2)), 9);
    expect(await kept(40)).toBeLessThan(await kept(90));
    // Out-of-range input is clamped and then follows the clamped value's curve. Input that is not a number answers 0.
    expect(await mastery._withoutPractice({ confidence: 140, days: -5 })).toEqual({ value: 100 });
    expect((await mastery._withoutPractice({ confidence: 140, days: 10 })).value).toBeCloseTo(leftAlone(100, 10), 9);
    expect(await mastery._withoutPractice({ confidence: -3, days: 10 })).toEqual({ value: 0 });
    expect(await mastery._withoutPractice({ confidence: Number.NaN, days: 10 })).toEqual({ value: 0 });
    expect(await mastery._withoutPractice({ confidence: 80, days: Number.POSITIVE_INFINITY })).toEqual({ value: 0 });
    // Both queries read no state: the track's estimate is unchanged, and a later day changes neither answer.
    setDay(30);
    expect(await mastery._withoutPractice({ confidence: 90, days: 0 })).toEqual({ value: 90 });
    expect(await mastery._policy()).toEqual(policy);
  });

  test("work done before setup calibrates the estimate from the attempt's date", async () => {
    const { mastery, estimate, explain, setDay } = setup();
    setDay(10);
    await mastery.initialize({ ...sam, confidence: 50, basis: "SELF_REPORTED" });
    await mastery.acceptEvidence(evidence("earlier-exam", "INDEPENDENT", at(0), { gateMet: true }));
    // Replay starts at the earlier attempt, so the full gate applies there, and the estimate fades for 10 days from it.
    // The attempt is a Good review on the day the memory that 50 seeds begins.
    const explanation = await explain(at(10));
    const memory = review(seed(50), gradeOf("INDEPENDENT"), 0);
    expect(explanation.replayStart).toEqual(at(0));
    expect(explanation.stability).toBeCloseTo(memory.stability, 9);
    expect(await estimate(10)).toMatchObject({ value: expect.closeTo(95 * R(10, memory.stability), 9), ready: true });
    expect(await mastery._estimate({ ...sam, at: at(5) })).toEqual([]);
  });

  test("two learners keep separate estimates for the same skill", async () => {
    const { mastery, estimate } = setup();
    await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
    await mastery.initialize({ ...leo, confidence: 80, basis: "SELF_REPORTED" });
    await mastery.acceptEvidence(evidence("leo-attempt", "GAP", start, { learner: "leo" }));
    expect((await estimate(0, leo)).value).toBe(60);
    await mastery.adjust(adjustment("leo-adjustment", 30, "I have not used this since last year.", { learner: "leo" }));
    expect((await estimate(0, leo)).value).toBe(30);
    expect((await estimate(0)).value).toBe(80);
    expect((await mastery._progress({ learner: "sam" })).tracks.map(({ inputs, adjustments }) => ({ inputs, adjustments })))
      .toEqual([{ inputs: [], adjustments: [] }]);
    expect(await mastery._progress({ learner: "kim" })).toEqual({ tracks: [] });
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

    await refuses(mastery.adjust(adjustment("new-key", 50, "Prior coursework.", { learner: "leo" })), "ADJUSTMENT_TRACK_UNAVAILABLE");
    await refuses(mastery.adjust(adjustment("new-key", 50, "Prior coursework.", { definition: "v2" })), "ADJUSTMENT_TRACK_UNAVAILABLE");
    const invalidAdjustments: [number, string][] = [
      [101, "Prior coursework."], [-1, "Prior coursework."], [Number.NaN, "Prior coursework."], [Number.POSITIVE_INFINITY, "Prior coursework."],
      ["50" as unknown as number, "Prior coursework."], [50, " "], [50, ""], [50, undefined as unknown as string],
    ];
    for (const [value, reason] of invalidAdjustments) {
      await refuses(mastery.adjust({ ...sam, adjustmentKey: "new-key", value, reason }), "INVALID_MASTERY_ADJUSTMENT");
    }
    expect(await savedState()).toEqual(before);
    expect(await mastery._adjustments({ track })).toEqual([]);
    expect((await estimate(0)).value).toBe(80);

    // A refused request reserves nothing, so the same key works once the input is valid. The bounds are valid scores.
    const { adjustment: zero } = await mastery.adjust(adjustment("new-key", 0, "Prior coursework."));
    const { adjustment: full } = await mastery.adjust(adjustment("other-key", 100, "Prior coursework."));
    expect((await mastery._adjustments({ track })).map(({ adjustment: id, value }) => [id, value])).toEqual([[zero, 0], [full, 100]]);
  });

  describe("adjustment keys", () => {
    test("a new key appends one adjustment and the estimate changes, but an adjustment alone never makes the skill ready", async () => {
      const { mastery, estimate, setDay } = setup();
      const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      setDay(10);
      const result = await mastery.adjust(adjustment("key-first", 40));
      expect(result).toEqual({ adjustment: expect.any(String) });
      expect(await mastery._adjustments({ track })).toEqual([{ adjustment: result.adjustment, value: 40, reason: reviewed, at: at(10) }]);
      expect(await estimate(10)).toEqual({ value: 40, ready: false, basis: expect.stringContaining("Your manual adjustments are included.") });

      // Each new key appends another adjustment, even with the same value and reason.
      setDay(11);
      const second = await mastery.adjust(adjustment("key-second", 100));
      const third = await mastery.adjust(adjustment("key-third", 100));
      expect(new Set([result.adjustment, second.adjustment, third.adjustment]).size).toBe(3);
      expect((await mastery._adjustments({ track })).map(({ adjustment: id }) => id)).toEqual([result.adjustment, second.adjustment, third.adjustment]);
      // Manual adjustments alone cannot establish readiness, even at 100.
      expect(await estimate(11)).toMatchObject({ value: 100, ready: false });

      // A query before an adjustment neither uses it nor mentions it.
      const earlier = await estimate(5);
      expect(earlier.value).toBeCloseTo(leftAlone(80, 5), 9);
      expect(earlier.basis).not.toContain("manual adjustments");
    });

    test("repeating a key with the same skill, value, and reason returns the same adjustment and changes nothing", async () => {
      const { mastery, estimate, setDay } = setup();
      const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      setDay(1);
      const first = await mastery.adjust(adjustment("key-retry", 40));
      setDay(2);
      const later = await mastery.adjust(adjustment("key-later", 65, "A later adjustment."));
      const before = await savedState();
      const estimateBefore = await estimate(3);

      // A retry after a lost reply, at a later time, answers the original adjustment and does not move it.
      setDay(3);
      expect(await mastery.adjust(adjustment("key-retry", 40))).toEqual(first);
      expect(await mastery.adjust(adjustment("key-later", 65, "A later adjustment."))).toEqual(later);
      expect(await savedState()).toEqual(before);
      expect(await mastery._adjustments({ track })).toEqual([
        { adjustment: first.adjustment, value: 40, reason: reviewed, at: at(1) },
        { adjustment: later.adjustment, value: 65, reason: "A later adjustment.", at: at(2) },
      ]);
      expect(await estimate(3)).toEqual(estimateBefore);

      // Saved keys persist: another instance on the same database answers the retry the same way.
      const restarted = new MasteryEstimating(connection!.db, "MasteryEstimating", () => at(4));
      expect(await restarted.adjust(adjustment("key-retry", 40))).toEqual(first);
      expect(await savedState()).toEqual(before);
    });

    test("refuses a key reused with a different skill, value, or reason and changes nothing", async () => {
      const { mastery } = setup();
      const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      await mastery.initialize({ ...sam, definition: "v2", confidence: 50, basis: "PREVIOUS_DEFINITION" });
      await mastery.initialize({ ...sam, subject: "determinants", confidence: 50, basis: "SELF_REPORTED" });
      const { adjustment: saved } = await mastery.adjust(adjustment("key-used", 40));
      const before = await savedState();

      const conflicts: AdjustInput[] = [
        adjustment("key-used", 41),
        adjustment("key-used", 40, "Another reason."),
        // The reason must match exactly.
        adjustment("key-used", 40, `${reviewed} `),
        adjustment("key-used", 40, reviewed.toLowerCase()),
        // Another requirements version of the same skill, and another skill.
        adjustment("key-used", 40, reviewed, { definition: "v2" }),
        adjustment("key-used", 40, reviewed, { subject: "determinants" }),
        // The saved key decides before the missing track or the invalid value.
        adjustment("key-used", 40, reviewed, { definition: "v3" }),
        adjustment("key-used", 140),
        adjustment("key-used", 40, " "),
      ];
      for (const conflict of conflicts) await refuses(mastery.adjust(conflict), "ADJUSTMENT_KEY_CONFLICT");
      expect(await savedState()).toEqual(before);
      expect((await mastery._adjustments({ track })).map(({ adjustment: id }) => id)).toEqual([saved]);

      // A key belongs to one learner. Leo can use the same key for his own track.
      await mastery.initialize({ ...leo, confidence: 80, basis: "SELF_REPORTED" });
      const { adjustment: leos } = await mastery.adjust(adjustment("key-used", 70, "Different input.", { learner: "leo" }));
      expect(leos).not.toBe(saved);
      expect(await mastery.adjust(adjustment("key-used", 40))).toEqual({ adjustment: saved });
    });

    test("refuses a blank key before any other check and changes nothing", async () => {
      const { mastery } = setup();
      const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      const before = await savedState();

      for (const adjustmentKey of ["", "   ", "\n\t", undefined as unknown as string, 7 as unknown as string]) {
        await refuses(mastery.adjust(adjustment(adjustmentKey, 50)), "INVALID_ADJUSTMENT_KEY");
      }
      // The blank key is reported even when the track is missing or the value and reason are invalid.
      await refuses(mastery.adjust(adjustment(" ", 50, reviewed, { learner: "leo" })), "INVALID_ADJUSTMENT_KEY");
      await refuses(mastery.adjust(adjustment("", 500, "")), "INVALID_ADJUSTMENT_KEY");
      expect(await savedState()).toEqual(before);
      expect(await mastery._adjustments({ track })).toEqual([]);
    });

    test("_progress lists each track's adjustments in append order with identity, value, reason, and time", async () => {
      const { mastery, setDay } = setup();
      const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      setDay(1);
      const { track: revised } = await mastery.initialize({ ...sam, definition: "v2", confidence: 60, basis: "PREVIOUS_DEFINITION" });
      setDay(2);
      const { input } = await mastery.acceptEvidence(evidence("attempt-a", "SLIP", at(2)));
      // Two adjustments at one instant keep their append order, and the later one decides the estimate.
      const first = await mastery.adjust(adjustment("key-alpha", 40, "First reason."));
      const second = await mastery.adjust(adjustment("key-beta", 70, "Second reason."));
      setDay(3);
      const third = await mastery.adjust(adjustment("key-gamma", 30, "Third reason.", { definition: "v2" }));
      setDay(4);

      // The first track's slip is a Hard review two days after the start. The adjustments keep its memory.
      // The second track has only its seeded memory, with the reference point moved to its adjustment.
      const slipped = review(seed(80), gradeOf("SLIP"), 2);
      const { tracks } = await mastery._progress({ learner: "sam" });
      expect(tracks).toEqual([
        {
          track, subject: "matrix-products", definition: "v1", initialConfidence: 80, startingBasis: "SELF_REPORTED", initializedAt: start,
          inputs: [{ input, evidence: "attempt-a", revision: 1, performedAt: at(2), signal: "SLIP", fresh: true, gateMet: false, attribution: "Assessment of attempt-a" }],
          adjustments: [
            { adjustment: first.adjustment, value: 40, reason: "First reason.", at: at(2) },
            { adjustment: second.adjustment, value: 70, reason: "Second reason.", at: at(2) },
          ],
          estimate: {
            value: expect.closeTo(70 * R(2, slipped.stability), 9), basis: expect.stringContaining("Your manual adjustments are included."), ready: false,
            stability: expect.closeTo(slipped.stability, 9), due: expect.any(Date),
          },
        },
        {
          track: revised, subject: "matrix-products", definition: "v2", initialConfidence: 60, startingBasis: "PREVIOUS_DEFINITION", initializedAt: at(1),
          inputs: [],
          adjustments: [{ adjustment: third.adjustment, value: 30, reason: "Third reason.", at: at(3) }],
          estimate: {
            value: expect.closeTo(30 * R(1, S0(g0(60))), 9), basis: expect.stringContaining("provisional"), ready: false,
            stability: S0(g0(60)), due: expect.any(Date),
          },
        },
      ]);
      // Each track is due one stability after its last event.
      sameInstant(tracks[0]!.estimate!.due, at(2).getTime() + slipped.stability * day);
      sameInstant(tracks[1]!.estimate!.due, at(3).getTime() + S0(g0(60)) * day);
      // The explanation reports the same order: the attempt, then both adjustments, then time.
      const [{ explanation }] = await mastery._explanation({ ...sam, at: at(4) });
      expect(explanation.changes.map(({ source, after }) => [source, after])).toEqual([
        ["attempt-a", expect.closeTo(80 * R(2, S0(g0(80))) - 5, 9)], [first.adjustment, 40], [second.adjustment, 70],
        ["time", expect.closeTo(70 * R(2, slipped.stability), 9)],
      ]);
      // _adjustments reports the same rows.
      expect(await mastery._adjustments({ track })).toEqual(tracks[0]!.adjustments);
      expect(await mastery._adjustments({ track: "unknown" })).toEqual([]);

      // No query returns an adjustment key.
      const reads = [
        tracks, await mastery._adjustments({ track }), await mastery._adjustments({ track: revised }),
        await mastery._explanation({ ...sam, at: at(4) }), await mastery._estimate({ ...sam, at: at(4) }),
        await mastery._tracks({ learner: "sam", subject: "matrix-products" }), await mastery._track(sam),
      ];
      expect(JSON.stringify(reads)).not.toMatch(/key-|adjustmentKey/);
    });

    test("competing requests with one key save at most one adjustment", async () => {
      const { mastery } = setup();
      const { track } = await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      const { track: revised } = await mastery.initialize({ ...sam, definition: "v2", confidence: 80, basis: "PREVIOUS_DEFINITION" });

      // Identical requests all answer the one saved adjustment.
      const same = await Promise.all(Array.from({ length: 8 }, () => mastery.adjust(adjustment("key-same", 40))));
      expect(new Set(same.map(({ adjustment: id }) => id)).size).toBe(1);
      expect(await mastery._adjustments({ track })).toHaveLength(1);

      // Requests with one key on two tracks: one track gets the adjustment, and requests for the other are conflicts.
      const settled = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
        mastery.adjust(adjustment("key-split", 40, reviewed, { definition: index % 2 ? "v2" : "v1" }))));
      const saved = [...await mastery._adjustments({ track }), ...await mastery._adjustments({ track: revised })]
        .filter(({ adjustment: id }) => id !== same[0]!.adjustment);
      expect(saved).toHaveLength(1);
      const answered = settled.filter((outcome) => outcome.status === "fulfilled");
      expect(answered.length).toBeGreaterThan(0);
      for (const outcome of answered) expect(outcome.value).toEqual({ adjustment: saved[0]!.adjustment });
      for (const outcome of settled.filter((result) => result.status === "rejected")) {
        expect(outcome.reason).toMatchObject({ code: "ADJUSTMENT_KEY_CONFLICT", message: messages.ADJUSTMENT_KEY_CONFLICT });
      }
      expect(settled.filter((outcome) => outcome.status === "rejected")).toHaveLength(4);
    });
  });

  // Each expectation here comes from the published FSRS-6 formulas and default parameters in tests/fixtures/fsrs.ts.
  describe("FSRS-6 anchors", () => {
    test("the forgetting curve keeps 90 percent after one stability, and a track reports that retention there", async () => {
      expect(DECAY).toBe(-0.1542);
      for (const stability of [S0(1), S0(2), S0(3), S0(4), 1, 30, 365]) expect(R(stability, stability)).toBeCloseTo(0.9, 12);
      const { mastery, explain } = setup();
      await mastery.initialize({ ...sam, confidence: 90, basis: "SELF_REPORTED" });
      const explanation = await explain(at(S0(4)));
      expect(explanation.retention).toBeCloseTo(0.9, 9);
      expect(explanation.value).toBeCloseTo(81, 6);
    });

    test("a starting confidence seeds the published first stability and difficulty of its rating", async () => {
      // The first stabilities are w0 through w3. The first difficulty is w4 - exp(w5 * (G - 1)) + 1, clamped to 1 through 10.
      expect(([1, 2, 3, 4] as const).map(S0)).toEqual([0.212, 1.2931, 2.3065, 8.2956]);
      for (const grade of [1, 2, 3, 4] as const) {
        expect(D0(grade)).toBeCloseTo(Math.min(10, Math.max(1, 6.4133 - Math.exp(0.8334 * (grade - 1)) + 1)), 12);
      }
      // Again starts at w4 itself, and Easy falls below 1 before the clamp.
      expect(D0(1)).toBeCloseTo(6.4133, 12);
      expect(D0raw(4)).toBeLessThan(1);
      expect(D0(4)).toBe(1);

      const { mastery, explain } = setup();
      for (const [confidence, grade] of [[10, 1], [30, 2], [60, 3], [90, 4]] as const) {
        const identity = { ...sam, definition: `seeded-at-${confidence}` };
        await mastery.initialize({ ...identity, confidence, basis: "SELF_REPORTED" });
        expect(g0(confidence)).toBe(grade);
        const explanation = await explain(start, identity);
        expect(explanation).toMatchObject({ value: confidence, retention: 1, stability: S0(grade), changes: [] });
        expect(explanation.difficulty).toBeCloseTo(D0(grade), 12);
        sameInstant(explanation.due, start.getTime() + S0(grade) * day);
      }
    });

    test("the starting confidences 20, 50, and 80 each begin a higher first rating than one point less", async () => {
      const { mastery, explain } = setup();
      const ratings: [number, Grade][] = [[19, 1], [20, 2], [49, 2], [50, 3], [79, 3], [80, 4]];
      for (const [confidence, grade] of ratings) {
        const identity = { ...sam, definition: `boundary-${confidence}` };
        await mastery.initialize({ ...identity, confidence, basis: "SELF_REPORTED" });
        expect(g0(confidence)).toBe(grade);
        expect((await explain(start, identity)).stability).toBe(S0(grade));
        // _withoutPractice seeds its curve the same way.
        expect((await mastery._withoutPractice({ confidence, days: 10 })).value).toBeCloseTo(confidence * R(10, S0(grade)), 9);
      }
    });

    test("a Good review exactly one stability after the start multiplies stability by the success factor at 90 percent retention", async () => {
      const { mastery, explain, setDay } = setup();
      await mastery.initialize({ ...sam, confidence: 60, basis: "SELF_REPORTED" });
      const { stability, difficulty } = seed(60);
      setDay(stability);
      await mastery.acceptEvidence(evidence("good-review", "INDEPENDENT", at(stability)));
      expect(daysBetween(at(stability), start)).toBe(stability);

      // At retention 0.9 the factor is exp(w8) * (11 - D) * S^-w9 * (exp(0.1 * w10) - 1) + 1.
      const factor = Math.exp(1.8722) * (11 - difficulty) * stability ** -0.1666 * (Math.exp(0.1 * 0.796) - 1) + 1;
      expect(successFactor(stability, difficulty, stability, 3)).toBeCloseTo(factor, 12);
      const explanation = await explain(at(stability));
      expect(explanation.stability / stability).toBeCloseTo(successFactor(stability, difficulty, stability, 3), 9);
      // Good moves difficulty only by the small pull toward the first difficulty of Easy.
      expect(explanation.difficulty).toBeCloseTo(nextD(difficulty, 3), 12);
      expect(nextD(difficulty, 3)).toBeCloseTo(W[7]! * D0raw(4) + (1 - W[7]!) * difficulty, 12);
      // The estimate kept 90 percent of 60, then gained 10.
      expect(explanation.value).toBeCloseTo(partialGain(60 * 0.9, 60), 9);
    });

    test("a lapse a day or more later takes the smaller of the long-term lapse stability and the short-term bound", async () => {
      const { mastery, explain, setDay } = setup();
      const { stability, difficulty } = seed(10);
      const bound = stability / Math.exp(W[17]! * W[18]!);
      const longTerm = (days: number) =>
        W[11]! * difficulty ** -W[12]! * ((stability + 1) ** W[13]! - 1) * Math.exp((1 - R(days, stability)) * W[14]!);
      // One day after the start the long-term formula is smaller. A year after, retention has fallen so far that the bound is smaller.
      expect(longTerm(1)).toBeLessThan(bound);
      expect(longTerm(365)).toBeGreaterThan(bound);

      const afterADay = { ...sam, definition: "lapse-after-a-day" }, afterAYear = { ...sam, definition: "lapse-after-a-year" };
      await mastery.initialize({ ...afterADay, confidence: 10, basis: "SELF_REPORTED" });
      await mastery.initialize({ ...afterAYear, confidence: 10, basis: "SELF_REPORTED" });
      setDay(365);
      await mastery.acceptEvidence(evidence("gap-after-a-day", "GAP", at(1), afterADay));
      await mastery.acceptEvidence(evidence("gap-after-a-year", "GAP", at(365), afterAYear));
      const early = await explain(at(1), afterADay), late = await explain(at(365), afterAYear);
      expect(early.stability).toBeCloseTo(lapseS(stability, difficulty, 1), 12);
      expect(early.stability).toBeCloseTo(longTerm(1), 12);
      expect(late.stability).toBeCloseTo(lapseS(stability, difficulty, 365), 12);
      expect(late.stability).toBeCloseTo(bound, 12);
      for (const explanation of [early, late]) {
        expect(explanation.difficulty).toBeCloseTo(nextD(difficulty, 1), 12);
        // The gap loss of 20 takes a faded 10 to 0.
        expect(explanation.value).toBe(0);
      }
    });

    test("a review less than a day after the last event uses the same-day formula", async () => {
      const { mastery, explain, setDay } = setup();
      const low = { ...sam, definition: "good-the-same-day" }, middle = { ...sam, definition: "hard-the-same-day" };
      await mastery.initialize({ ...low, confidence: 10, basis: "SELF_REPORTED" });
      await mastery.initialize({ ...middle, confidence: 60, basis: "SELF_REPORTED" });
      // Six hours after the start.
      setDay(0.25);
      await mastery.acceptEvidence(evidence("good-the-same-day", "INDEPENDENT", at(0.25), low));
      await mastery.acceptEvidence(evidence("hard-the-same-day", "SUPPORTED", at(0.25), middle));
      const good = await explain(at(0.25), low), hard = await explain(at(0.25), middle);

      // Good multiplies a small stability by exp(w17 * w18) * S^-w19, which is above 1. Hard lowers stability.
      expect(good.stability).toBeCloseTo(sameDayS(S0(1), 3), 12);
      expect(good.stability).toBeCloseTo(S0(1) * Math.exp(0.5425 * 0.0912) * S0(1) ** -0.0658, 12);
      expect(good.stability).toBeGreaterThan(S0(1));
      expect(hard.stability).toBeCloseTo(sameDayS(S0(3), 2), 12);
      expect(hard.stability).toBeLessThan(S0(3));
      // The formula for a day or more would give a different stability.
      expect(good.stability).not.toBeCloseTo(S0(1) * successFactor(S0(1), D0(1), 0.25, 3), 3);
      expect(good.difficulty).toBeCloseTo(nextD(D0(1), 3), 12);
      expect(hard.difficulty).toBeCloseTo(nextD(D0(3), 2), 12);
    });

    test("due is the last event plus the stability in days, whatever the query time", async () => {
      const { mastery, explain, setDay } = setup();
      await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      setDay(3);
      await mastery.acceptEvidence(evidence("attempt-a", "INDEPENDENT", at(3)));
      const memory = review(seed(80), gradeOf("INDEPENDENT"), 3);
      const soon = await explain(at(10)), later = await explain(at(40));
      expect(soon.stability).toBeCloseTo(memory.stability, 9);
      sameInstant(soon.due, at(3).getTime() + memory.stability * day);
      expect(later.due).toEqual(soon.due);
      // At the due instant the retention is the desired retention.
      expect((await explain(soon.due)).retention).toBeCloseTo(0.9, 9);
    });

    test("an adjustment moves the reference point and leaves stability and difficulty unchanged", async () => {
      const { mastery, explain, setDay } = setup();
      await mastery.initialize({ ...sam, confidence: 80, basis: "SELF_REPORTED" });
      setDay(2);
      await mastery.acceptEvidence(evidence("attempt-a", "INDEPENDENT", at(2)));
      setDay(5);
      await mastery.adjust(adjustment("reference-point", 50));
      const memory = review(seed(80), gradeOf("INDEPENDENT"), 2);

      // Just before the adjustment, the reference point is the attempt.
      const before = await explain(new Date(at(5).getTime() - 1));
      expect(before.stability).toBeCloseTo(memory.stability, 9);
      expect(before.difficulty).toBeCloseTo(memory.difficulty, 12);
      sameInstant(before.due, at(2).getTime() + memory.stability * day);
      // At the adjustment, the estimate is the adjusted value and the memory is the same.
      const after = await explain(at(5));
      expect(after).toMatchObject({ value: 50, retention: 1, stability: before.stability, difficulty: before.difficulty });
      sameInstant(after.due, at(5).getTime() + memory.stability * day);
      // A week later, the adjusted value has followed the curve from the adjustment.
      const later = await explain(at(12));
      expect(later.value).toBeCloseTo(50 * R(7, memory.stability), 9);
      expect(later.retention).toBeCloseTo(R(7, memory.stability), 12);
      expect(later.due).toEqual(after.due);
    });

    test("_policy reports fsrs-1 with the 21 published parameters, and _withoutPractice keeps 90 percent after one stability", async () => {
      const { mastery } = setup();
      const policy = await mastery._policy();
      expect(policy).toMatchObject({ policy: "fsrs-1", desiredRetention: 0.9, readinessMinimum: 70, readinessDays: 14 });
      expect(policy.parameters).toHaveLength(21);
      expect(policy.parameters).toEqual(W);
      expect((await mastery._withoutPractice({ confidence: 100, days: S0(4) })).value).toBeCloseTo(90, 9);
    });
  });
});
