import { describe, expect, test } from "bun:test";
import { changeText, provisionalText, startText, timingText, type Case, type Change } from "../frontend/src/evidence-text.ts";

// The evidence panel under a skill ("How the estimate got here", EstimatePanel.vue) says each fact once: a row's sentence
// carries its values, its timing adds only what the sentence does not say, and the provisional line is not repeated
// under the chart.
const change = (kind: Change["kind"], before: number, after: number, days: number, decay: number, source = ""): Change =>
  ({ at: "2026-10-19T12:00:00.000Z", kind, source, before, after, decay, days, reason: kind === "ADJUSTMENT" ? "I solved the set on paper." : "" });
const noCases = new Map<string, Case>();

describe("The starting point's row", () => {
  test("one sentence gives the starting value and where it came from", () => {
    expect(startText({ confidence: 50, startingBasis: "SELF_REPORTED" })).toBe("The estimate started at 50%, your reported starting confidence.");
    expect(startText({ confidence: 61.6, startingBasis: "PREVIOUS_DEFINITION" })).toBe("The estimate started at 62%, carried over from an earlier version of this skill.");
  });

  test("the source is no longer a separate sentence under the row", () => {
    const text = startText({ confidence: 50, startingBasis: "SELF_REPORTED" });
    expect(text).not.toContain("Your reported starting confidence.");
    expect(text.match(/50%/g)).toHaveLength(1);
  });
});

describe("A change's timing", () => {
  test("a row for time without practice gives only the days, because its sentence already says how far time lowered it", () => {
    const time = change("TIME", 50, 38, 6, 12);
    expect(changeText(time, noCases, {})).toBe("Time without practice lowered it from 50% to 38%.");
    expect(timingText(time, 0)).toBe("6 days after the starting point.");
    expect(timingText(change("TIME", 50, 49.4, 1, 0.6), 2)).toBe("1 day after the previous change.");
  });

  test("the removed sentence about time's drop is gone from a time row", () => {
    expect(timingText(change("TIME", 50, 38, 6, 12), 0)).not.toContain("Time lowered it");
    expect(timingText(change("TIME", 50, 38, 6, 12), 0)).not.toContain("12 points");
  });

  test("an attempt or an adjustment still says how much time lowered the estimate before it, which no other line says", () => {
    expect(timingText(change("ATTEMPT", 45, 95, 3, 5, "case-1"), 1)).toBe("3 days after the previous change. Time lowered it 5 points before this.");
    expect(timingText(change("ADJUSTMENT", 49, 70, 1, 1), 1)).toBe("1 day after the previous change. Time lowered it 1 point before this.");
    expect(timingText(change("ADJUSTMENT", 49.8, 70, 2, 0.2), 1)).toBe("2 days after the previous change. Time lowered it less than 1 point before this.");
    // Small decay on the same day is left out.
    expect(timingText(change("ATTEMPT", 49.8, 95, 0, 0.2, "case-1"), 0)).toBe("Less than a day after the starting point.");
  });
});

describe("The provisional line", () => {
  test("it says why the estimate is provisional and what has moved it, in one sentence", () => {
    expect(provisionalText([])).toBe("No assessed attempt has counted yet, so only time has moved it.");
    expect(provisionalText([change("TIME", 50, 38, 6, 12)])).toBe("No assessed attempt has counted yet, so only time has moved it.");
    expect(provisionalText([change("TIME", 50, 48, 2, 2), change("ADJUSTMENT", 48, 70, 0, 0)])).toBe("No assessed attempt has counted yet, so only your adjustments and time have moved it.");
  });

  test("the chart's separate note and the old second sentence are gone", () => {
    for (const changes of [[], [change("ADJUSTMENT", 50, 70, 0, 0)]]) {
      expect(provisionalText(changes)).not.toContain("No assessed attempt yet,");
      expect(provisionalText(changes)).not.toContain("toward this estimate yet");
    }
  });
});
