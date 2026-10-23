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

const start = new Date("2026-09-01T12:00:00Z"), day = 86_400_000;
const at = (days: number) => new Date(start.getTime() + days * day);
/** Policy prototype-1 halves the estimate every 60 days without practice. */
const decay = (value: number, days: number) => value * 2 ** (-days / 60);
const sam = { learner: "sam", subject: "matrix-products", definition: "v1" };
const leo = { ...sam, learner: "leo" };

function setup() {
  let now = start;
  const mastery = new MasteryEstimating(connection!.db, "MasteryEstimating", () => now);
  const estimate = async (days: number, identity = sam) => (await mastery._estimate({ ...identity, at: at(days) }))[0]!;
  return { mastery, estimate, setDay: (days: number) => { now = at(days); } };
}

function evidence(id: string, signal: Signal, performedAt: Date, overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return { ...sam, evidence: id, revision: 1, performedAt, signal, fresh: true, gateMet: false, attribution: `Assessment of ${id}`, ...overrides };
}

const reviewed = "I reviewed the chapter this morning.";
function adjustment(adjustmentKey: string, value: number, reason = reviewed, overrides: Partial<AdjustInput> = {}): AdjustInput {
  return { ...sam, adjustmentKey, value, reason, ...overrides };
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
    const { adjustment: adjusted } = await mastery.adjust(adjustment("principle-adjustment", 60));
    expect(await mastery._adjustments({ track })).toEqual([{ adjustment: adjusted, value: 60, reason: reviewed, at: at(62) }]);
    expect(await estimate(62)).toMatchObject({ value: 60, ready: false });
    expect((await estimate(63)).value).toBeCloseTo(decay(60, 1));
    setDay(63);
    await mastery.acceptEvidence(evidence("attempt-c", "INDEPENDENT", at(63), { gateMet: true }));
    expect(await estimate(63)).toMatchObject({ value: 95, ready: true });

    const [{ explanation }] = await mastery._explanation({ ...sam, at: at(63) });
    expect(explanation.evidence).toEqual([{ evidence: "attempt-a", revision: 2 }, { evidence: "attempt-b", revision: 1 }, { evidence: "attempt-c", revision: 1 }]);
    expect(explanation.changes.map(({ source }) => source)).toEqual(["attempt-a", "attempt-b", adjusted, "attempt-c"]);
    // An earlier query time uses only the evidence and adjustments dated by then.
    expect((await estimate(60)).value).toBeCloseTo(afterSlip);
    expect(await mastery._estimate({ ...sam, at: new Date(start.getTime() - 1) })).toEqual([]);
    const { tracks } = await mastery._progress({ learner: "sam" });
    expect(tracks.map(({ track: id, inputs, adjustments, estimate: current }) => ({ id, inputs: inputs.length, adjustments, value: current?.value, ready: current?.ready })))
      .toEqual([{ id: track, inputs: 3, adjustments: [{ adjustment: adjusted, value: 60, reason: reviewed, at: at(62) }], value: 95, ready: true }]);
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
      expect(earlier.value).toBeCloseTo(decay(80, 5));
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

      const { tracks } = await mastery._progress({ learner: "sam" });
      expect(tracks).toEqual([
        {
          track, subject: "matrix-products", definition: "v1", initialConfidence: 80, startingBasis: "SELF_REPORTED", initializedAt: start,
          inputs: [{ input, evidence: "attempt-a", revision: 1, performedAt: at(2), signal: "SLIP", fresh: true, gateMet: false, attribution: "Assessment of attempt-a" }],
          adjustments: [
            { adjustment: first.adjustment, value: 40, reason: "First reason.", at: at(2) },
            { adjustment: second.adjustment, value: 70, reason: "Second reason.", at: at(2) },
          ],
          estimate: { value: expect.closeTo(decay(70, 2), 9), basis: expect.stringContaining("Your manual adjustments are included."), ready: false },
        },
        {
          track: revised, subject: "matrix-products", definition: "v2", initialConfidence: 60, startingBasis: "PREVIOUS_DEFINITION", initializedAt: at(1),
          inputs: [],
          adjustments: [{ adjustment: third.adjustment, value: 30, reason: "Third reason.", at: at(3) }],
          estimate: { value: expect.closeTo(decay(30, 1), 9), basis: expect.stringContaining("provisional"), ready: false },
        },
      ]);
      // The explanation reports the same order: the attempt, then both adjustments, then time.
      const [{ explanation }] = await mastery._explanation({ ...sam, at: at(4) });
      expect(explanation.changes.map(({ source, after }) => [source, after]))
        .toEqual([["attempt-a", expect.closeTo(decay(80, 2) - 5, 9)], [first.adjustment, 40], [second.adjustment, 70], ["time", expect.closeTo(decay(70, 2), 9)]]);
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
});
