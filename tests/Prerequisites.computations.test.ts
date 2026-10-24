import { describe, expect, test } from "bun:test";
import { carriedEstimate, prerequisiteSet, prerequisitesReady, prerequisiteToPractice } from "../src/computations/learning.ts";
import type { SkillRows, Tracks } from "../src/learning-data.ts";

type Status = "DRAFT" | "CONFIRMED" | "ARCHIVED";
/** Course skills as SkillMapping._map returns them; each skill's current version is `${skill}-v`. */
function skills(rows: [skill: string, prerequisites: string[], status?: Status][]): SkillRows {
  return rows.map(([skill, prerequisites, status = "CONFIRMED"]) => ({ skill, title: `Title ${skill}`, current: `${skill}-v`, status,
    unit: "unit", course: "course", outcome: "", gate: "", materials: [], prerequisites }));
}
/** Tracks on each skill's current version; the listed skills have a ready estimate. */
function ready(...ids: string[]): Tracks {
  return ids.map((id) => track(id, `${id}-v`, new Date(0), { value: 95, ready: true }));
}
function track(subject: string, definition: string, initializedAt: Date, estimate: { value: number; ready: boolean } | null, id = `${subject}:${definition}`): Tracks[number] {
  return { track: id, subject, definition, initialConfidence: 50, startingBasis: "SELF_REPORTED", initializedAt, inputs: [], adjustments: [],
    estimate: estimate && { ...estimate, basis: "" } } as Tracks[number];
}

describe("prerequisitesReady", () => {
  test("keeps its rule: confirmed prerequisites with ready current-version estimates, all the way down", () => {
    const map = skills([["a", ["b", "c"]], ["b", ["d"]], ["c", ["d"]], ["d", []]]);
    expect(prerequisitesReady({ skills: map, tracks: ready("b", "c", "d"), skill: "a" })).toBe(true);
    // A diamond whose shared prerequisite is not ready fails through both paths.
    expect(prerequisitesReady({ skills: map, tracks: ready("b", "c"), skill: "a" })).toBe(false);
    // A track for an earlier version does not count, and neither does an archived prerequisite.
    expect(prerequisitesReady({ skills: map, tracks: [...ready("c", "d"), track("b", "b-old", new Date(0), { value: 95, ready: true })], skill: "a" })).toBe(false);
    expect(prerequisitesReady({ skills: skills([["a", ["b"]], ["b", [], "ARCHIVED"]]), tracks: ready("b"), skill: "a" })).toBe(false);
    // A skill without prerequisites is ready to practice; an unknown skill is not.
    expect(prerequisitesReady({ skills: map, tracks: [], skill: "d" })).toBe(true);
    expect(prerequisitesReady({ skills: map, tracks: [], skill: "missing" })).toBe(false);
    // A cycle, which SkillMapping never saves, cannot recurse forever.
    expect(prerequisitesReady({ skills: skills([["a", ["b"]], ["b", ["a"]]]), tracks: ready("a", "b"), skill: "a" })).toBe(true);
  });
});

describe("prerequisiteToPractice", () => {
  test("finds nothing when every direct prerequisite is ready", () => {
    expect(prerequisiteToPractice({ skills: skills([["a", ["b"]], ["b", []]]), tracks: ready("b"), skill: "a" })).toEqual({ found: false });
    expect(prerequisiteToPractice({ skills: skills([["a", []]]), tracks: [], skill: "a" })).toEqual({ found: false });
  });
  test("follows not-ready prerequisites by lowest identity to one whose own prerequisites are ready", () => {
    const map = skills([["a", ["c", "b"]], ["b", ["e", "d"]], ["c", []], ["d", []], ["e", []]]);
    expect(prerequisiteToPractice({ skills: map, tracks: [], skill: "a" })).toEqual({ found: true, title: "Title d" });
    // A ready prerequisite is skipped; the walk stops where the remaining prerequisites are ready.
    expect(prerequisiteToPractice({ skills: map, tracks: ready("d"), skill: "a" })).toEqual({ found: true, title: "Title e" });
    expect(prerequisiteToPractice({ skills: map, tracks: ready("d", "e"), skill: "a" })).toEqual({ found: true, title: "Title b" });
    expect(prerequisiteToPractice({ skills: map, tracks: ready("b", "d", "e"), skill: "a" })).toEqual({ found: true, title: "Title c" });
  });
  test("names a ready-looking prerequisite whose own prerequisites are not ready, by the same rule", () => {
    // b has a ready estimate, but its prerequisite c does not, so b is not ready and c is named.
    const map = skills([["a", ["b"]], ["b", ["c"]], ["c", []]]);
    expect(prerequisitesReady({ skills: map, tracks: ready("b"), skill: "a" })).toBe(false);
    expect(prerequisiteToPractice({ skills: map, tracks: ready("b"), skill: "a" })).toEqual({ found: true, title: "Title c" });
  });
  test("stops on a cycle, which SkillMapping never saves", () => {
    expect(prerequisiteToPractice({ skills: skills([["a", ["b"]], ["b", ["c"]], ["c", ["b"]]]), tracks: [], skill: "a" })).toEqual({ found: true, title: "Title c" });
  });
});

describe("prerequisiteSet", () => {
  test("keeps each identity once and gives the empty set for an empty list", () => {
    expect(prerequisiteSet({ prerequisites: ["c", "a", "c", "b", "a"] })).toEqual(["a", "b", "c"]);
    expect(prerequisiteSet({ prerequisites: [] })).toEqual([]);
  });
});

describe("carriedEstimate", () => {
  test("carries the current estimate of the most recently started earlier track", () => {
    const tracks = [
      track("s", "v1", new Date(1000), { value: 40, ready: false }),
      track("s", "v2", new Date(3000), { value: 70, ready: false }),
      track("s", "v3", new Date(5000), { value: 90, ready: true }),
      track("other", "o1", new Date(9000), { value: 10, ready: false }),
    ];
    // The current version's own track is never carried.
    expect(carriedEstimate({ tracks, skill: "s", current: "v3" })).toEqual({ found: true, confidence: 70 });
    expect(carriedEstimate({ tracks, skill: "s", current: "v4" })).toEqual({ found: true, confidence: 90 });
  });
  test("breaks a start-time tie by the larger track identity", () => {
    const tracks = [track("s", "v1", new Date(1000), { value: 30, ready: false }, "track-b"), track("s", "v2", new Date(1000), { value: 60, ready: false }, "track-a")];
    expect(carriedEstimate({ tracks, skill: "s", current: "v3" })).toEqual({ found: true, confidence: 30 });
  });
  test("finds nothing without an earlier track or without its estimate", () => {
    expect(carriedEstimate({ tracks: [track("s", "v1", new Date(0), { value: 50, ready: false })], skill: "s", current: "v1" })).toEqual({ found: false });
    expect(carriedEstimate({ tracks: [], skill: "s", current: "v1" })).toEqual({ found: false });
    expect(carriedEstimate({ tracks: [track("s", "v1", new Date(0), null)], skill: "s", current: "v2" })).toEqual({ found: false });
  });
});
