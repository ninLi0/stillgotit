import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { estimateTimeline, planRequest, responseInput } from "../src/computations/learning.ts";
import type { EstimateExplanation, ProgressRow } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";

const DAY = 86_400_000, start = new Date("2026-10-13T12:00:00Z");
const after = (days: number) => new Date(start.getTime() + days * DAY);

describe("responseInput", () => {
  const file = (name: string) => ({ file: `files/${name}`, name, mediaType: "image/png", renditions: [], limitations: [] });
  const sources = [
    { material: "a", data: { originals: [file("a-1.png"), file("a-2.png")] } },
    { material: "b", data: { originals: [file("b-1.png")] } },
  ] as never;
  const respond = (text: string, attachments: unknown) => responseInput({ data: {} as never, text, channel: "TEXT", attachments: attachments as string[], sources });

  test("keeps list order and each material's own file order", () => {
    expect(respond("", ["b", "a"])).toEqual({ valid: true, text: "", channel: "TEXT", media: [file("b-1.png"), file("a-1.png"), file("a-2.png")] });
    expect(respond("Only text", []).valid).toBe(true);
  });
  test("one failing entry invalidates the whole response", () => {
    for (const attachments of [["a", "a"], ["a", "unknown"], ["unknown"], "a"]) expect(respond("Text", attachments)).toMatchObject({ valid: false, media: [] });
    expect(respond("   ", []).valid).toBe(false);
  });
});

describe("estimateTimeline", () => {
  const explanation = (changes: EstimateExplanation["changes"], extra: Partial<EstimateExplanation> = {}): EstimateExplanation => ({
    policy: "prototype-1", initialConfidence: 60, startingBasis: "PREVIOUS_DEFINITION", replayStart: start,
    evidence: [{ evidence: "case-1", revision: 1 }, { evidence: "case-2", revision: 1 }], ignored: [{ evidence: "case-2", reason: "Too little evidence to change the score." }],
    changes, value: 0, ready: false, basis: "The concept's own sentence.", ...extra,
  });
  const tracks = [
    { adjustments: [{ adjustment: "other-track-adjustment", value: 10, reason: "Unrelated", at: start }] },
    { adjustments: [{ adjustment: "adj-1", value: 80, reason: "I redid the problem set.", at: after(3.9) }] },
  ] as unknown as ProgressRow[];

  test("is null without an explanation", () => {
    expect(estimateTimeline({ explanation: undefined, tracks })).toBeNull();
    expect(estimateTimeline({ explanation: null, tracks })).toBeNull();
  });
  test("labels each change by its source and folds the decay before it", () => {
    const timeline = estimateTimeline({ tracks, explanation: explanation([
      { at: after(1.5), source: "case-1", before: 60, decayed: 59, after: 79 },
      { at: after(3.9), source: "adj-1", before: 79, decayed: 77, after: 80 },
      { at: after(10.99), source: "time", before: 80, decayed: 73, after: 73 },
    ]) });
    expect(timeline).toEqual({
      start: { at: start, confidence: 60, startingBasis: "PREVIOUS_DEFINITION" },
      changes: [
        { at: after(1.5), kind: "ATTEMPT", source: "case-1", before: 59, after: 79, decay: 1, days: 1, reason: "" },
        { at: after(3.9), kind: "ADJUSTMENT", source: "adj-1", before: 77, after: 80, decay: 2, days: 2, reason: "I redid the problem set." },
        { at: after(10.99), kind: "TIME", source: "", before: 80, after: 73, decay: 7, days: 7, reason: "" },
      ],
      ignored: [{ evidence: "case-2", reason: "Too little evidence to change the score." }],
      provisional: false, basis: "The concept's own sentence.",
    });
  });
  test("is provisional without an attempt row and refuses to guess an unknown source", () => {
    const adjusted = estimateTimeline({ tracks, explanation: explanation([{ at: after(3.9), source: "adj-1", before: 60, decayed: 57, after: 80 }]) });
    expect(adjusted).toMatchObject({ provisional: true, changes: [{ kind: "ADJUSTMENT", days: 3 }] });
    expect(() => estimateTimeline({ tracks, explanation: explanation([{ at: after(1), source: "unknown", before: 60, decayed: 59, after: 59 }]) })).toThrow();
  });
});

describe("planRequest", () => {
  const skills = [{ skill: "s", title: "Products", current: "v1", status: "CONFIRMED", prerequisites: [] }] as never;
  const input = { input: "i", evidence: "case-1", revision: 1, performedAt: new Date("2026-10-22T16:00:00Z"), signal: "INDEPENDENT", fresh: true, gateMet: true, attribution: "AI assessment" };
  const track = (adjustments: ProgressRow["adjustments"], value: number) => ({ track: "t", subject: "s", definition: "v1", initialConfidence: 50, startingBasis: "SELF_REPORTED",
    initializedAt: new Date("2026-10-20T16:00:00Z"), inputs: [input], adjustments, estimate: { value, basis: "", ready: value >= 70 } }) as ProgressRow;
  const schedule = (plans: unknown[] = []) => ({ today: "2026-10-23", plans, deadlines: [] }) as never;
  const adjustment = { adjustment: "adj-1", value: 40, reason: "Not sure any more.", at: new Date("2026-10-23T15:00:00Z") };
  const plan = (candidate: unknown, status = "TODO") => ({ status: "ACTIVE", items: [{ candidate, status }], deferred: [] });

  test("skills without adjustments keep today's keys and fingerprint", () => {
    const unadjusted = track([], 95), result = planRequest({ skills, tracks: [unadjusted], schedule: schedule() });
    expect(result.candidates).toMatchObject([{ key: "s:v1:case-1:1:2026-10-23", priority: 5, earliestDay: "2026-10-23", latestDay: "2026-10-29" }]);
    const { track: id, inputs, initialConfidence, startingBasis, initializedAt } = unadjusted;
    expect(result.basis).toBe(createHash("sha256").update(JSON.stringify({ day: "2026-10-23", skills: [["s", "v1", [], { track: id, inputs, initialConfidence, startingBasis, initializedAt }]] })).digest("hex"));
  });
  test("an adjustment gives a new key, priority from the adjusted estimate, days from the evidence, and a new fingerprint", () => {
    const before = planRequest({ skills, tracks: [track([], 95)], schedule: schedule() }), saved = before.candidates[0]!;
    const result = planRequest({ skills, tracks: [track([adjustment], 40)], schedule: schedule([plan(saved)]) });
    expect(result.candidates).toEqual([{ ...saved, key: "s:v1:case-1:1:adj-1:2026-10-23", priority: 60, reason: "This skill needs fresh independent evidence." }]);
    expect(result.basis).not.toBe(before.basis);
    // The adjusted candidate is reused unchanged until the next adjustment.
    const again = planRequest({ skills, tracks: [track([adjustment], 39)], schedule: schedule([plan(saved), plan(result.candidates[0])]) });
    expect(again.candidates).toEqual(result.candidates);
    const later = { ...adjustment, adjustment: "adj-2", value: 30 };
    expect(planRequest({ skills, tracks: [track([adjustment, later], 30)], schedule: schedule([plan(result.candidates[0])]) }).candidates[0]!.key).toBe("s:v1:case-1:1:adj-2:2026-10-23");
  });
  test("an adjustment on a later day keeps the evidence's review window", () => {
    const saved = planRequest({ skills, tracks: [track([], 95)], schedule: schedule() }).candidates[0]!;
    expect(saved).toMatchObject({ earliestDay: "2026-10-23", latestDay: "2026-10-29" });
    const later = { ...adjustment, at: new Date("2026-10-25T15:00:00Z") };
    const result = planRequest({ skills, tracks: [track([later], 40)], schedule: { today: "2026-10-25", plans: [plan(saved)], deadlines: [] } as never });
    expect(result.candidates).toEqual([{ ...saved, key: "s:v1:case-1:1:adj-1:2026-10-25", priority: 60, reason: "This skill needs fresh independent evidence." }]);
    // A second adjustment still copies the evidence's window, not the previous adjustment's day.
    const second = { ...later, adjustment: "adj-2", value: 90, at: new Date("2026-10-27T15:00:00Z") };
    const again = planRequest({ skills, tracks: [track([later, second], 90)], schedule: { today: "2026-10-27", plans: [plan(saved), plan(result.candidates[0])], deadlines: [] } as never });
    expect(again.candidates).toEqual([{ ...saved, key: "s:v1:case-1:1:adj-2:2026-10-27", priority: 10, reason: "A later fresh check will test retention." }]);
    // Once the evidence's window has passed, the adjusted review gets the window an unadjusted one would get.
    const expired = planRequest({ skills, tracks: [track([later], 40)], schedule: { today: "2026-10-30", plans: [plan(saved)], deadlines: [] } as never });
    expect(expired.candidates).toMatchObject([{ key: "s:v1:case-1:1:adj-1:2026-10-30", earliestDay: "2026-10-30", latestDay: "2026-11-05" }]);
  });
  test("work finished for the same evidence within its window is not offered again because of an adjustment", () => {
    const saved = planRequest({ skills, tracks: [track([], 95)], schedule: schedule() }).candidates[0]!;
    expect(planRequest({ skills, tracks: [track([adjustment], 40)], schedule: schedule([plan(saved, "DONE")]) }).candidates).toEqual([]);
    // Once its window has passed, the review can be offered again, as without an adjustment.
    const expired = { ...saved, latestDay: "2026-10-22" };
    expect(planRequest({ skills, tracks: [track([adjustment], 40)], schedule: schedule([plan(expired, "DONE")]) }).candidates).toHaveLength(1);
  });
});
