import { describe, expect, test } from "bun:test";
import { addDays, daysFrom, dueDay, studyDate } from "../src/computations/review-day.ts";
import { planRequest } from "../src/computations/learning.ts";
import { memoryCurve, reviewDay } from "../src/computations/memory.ts";
import type { EstimateExplanation, ProgressRow } from "../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { dayAfter } from "../frontend/src/labels.ts";

// The review day (design/compositions/LearningReads.md, "The review day"): the plan request and the memory read place
// MasteryEstimating's due instant on a New York calendar day with the same dueDay, so they always name the same day.
const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
/** An explanation that only the review day reads: its due instant. */
const explained = (due: Date) => ({ due } as EstimateExplanation);

describe("Study days are New York calendar days", () => {
  test("an instant falls on its New York date, on both sides of each change of daylight saving time", () => {
    // Daylight saving time ends at 2:00 on Sunday, November 1, 2026, and starts at 2:00 on Sunday, March 14, 2027.
    expect(studyDate(at("2026-11-01T04:30:00Z"))).toBe("2026-11-01"); // 00:30 EDT
    expect(studyDate(at("2026-11-02T04:30:00Z"))).toBe("2026-11-01"); // 23:30 EST, 24 hours later and still November 1
    expect(studyDate(at("2027-03-14T04:30:00Z"))).toBe("2027-03-13"); // 23:30 EST
    expect(studyDate(at("2027-03-15T04:30:00Z"))).toBe("2027-03-15"); // 00:30 EDT, 24 hours later and two dates on
  });

  test("days are added and counted on the calendar", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2027-03-13", 2)).toBe("2027-03-15");
    expect(daysFrom("2026-10-31", "2026-11-02")).toBe(2);
    expect(daysFrom("2027-03-13", "2027-03-15")).toBe(2);
    expect(daysFrom("2026-10-28", "2026-10-28")).toBe(0);
  });

  test("a due instant's review day is the date it falls on, or today once that date has passed", () => {
    expect(dueDay(at("2026-10-30T21:21:00Z"), "2026-10-28")).toBe("2026-10-30");
    expect(dueDay(at("2026-10-28T19:00:00Z"), "2026-10-28")).toBe("2026-10-28");
    expect(dueDay(at("2026-10-26T12:00:00Z"), "2026-10-28")).toBe("2026-10-28");
  });
});

describe("The memory read's review day", () => {
  test("it is the due instant's calendar day, not the first whole 24 hours after the read at or after it", () => {
    // Read at 10:00 on Wednesday; the memory is due at 17:21 on Friday. Friday is two calendar days away. Rounding the 2.3
    // days up to whole spans of 24 hours, as the read used to, named Saturday, a day after the Plan's Friday.
    const read = at("2026-10-28T14:00:00Z"), due = at("2026-10-30T21:21:00Z");
    expect(reviewDay({ at: read, explanation: explained(due) })).toEqual({ day: "2026-10-30", days: 2, instant: new Date(read.getTime() + 2 * DAY) });
    // Due later today: the day is today, no days away, and the estimate is read at the read's own instant.
    expect(reviewDay({ at: read, explanation: explained(at("2026-10-28T19:05:00Z")) })).toEqual({ day: "2026-10-28", days: 0, instant: read });
    // Already due: today again, and memoryCurve answers no review day.
    expect(reviewDay({ at: read, explanation: explained(at("2026-10-28T09:00:00Z")) })).toEqual({ day: "2026-10-28", days: 0, instant: read });
  });

  test("it counts calendar days across the end and the start of daylight saving time", () => {
    // Read at 00:30 EDT on Saturday, October 31. A memory due at 23:15 EST on Sunday is one calendar day away; 47.75
    // hours round up to two spans of 24 hours, which used to say "in 2 days" for Sunday.
    const fall = at("2026-10-31T04:30:00Z");
    expect(reviewDay({ at: fall, explanation: explained(at("2026-11-01T04:45:00Z")) })).toMatchObject({ day: "2026-11-01", days: 1 });
    expect(reviewDay({ at: fall, explanation: explained(at("2026-11-02T04:15:00Z")) })).toMatchObject({ day: "2026-11-01", days: 1 });
    expect(reviewDay({ at: fall, explanation: explained(at("2026-11-02T05:15:00Z")) })).toMatchObject({ day: "2026-11-02", days: 2 });
    // Read at 23:30 EST on Saturday, March 13. A memory due at 23:45 EDT on Sunday is on Sunday, one day away; one span of
    // 24 hours after the read ends at 00:30 EDT on Monday, the day the read used to name.
    const spring = at("2027-03-14T04:30:00Z");
    expect(reviewDay({ at: spring, explanation: explained(at("2027-03-15T03:45:00Z")) })).toMatchObject({ day: "2027-03-14", days: 1 });
  });

  test("memoryCurve answers the review day it was given, and none once the due instant has passed", () => {
    const read = at("2026-10-28T14:00:00Z"), samples = { v1: 9, v3: 8, v7: 7, v14: 6, v30: 5, v60: 4, v90: 3 };
    const ahead = { value: 10, due: at("2026-10-30T21:21:00Z") } as EstimateExplanation;
    expect(memoryCurve({ at: read, explanation: ahead, day: "2026-10-30", days: 2, reviewValue: 8.5, ...samples })).toMatchObject({
      estimate: 10, reviewBy: { day: "2026-10-30", days: 2, value: 8.5 }, belowNow: false });
    const passed = { value: 10, due: at("2026-10-28T13:00:00Z") } as EstimateExplanation;
    expect(memoryCurve({ at: read, explanation: passed, day: "2026-10-28", days: 0, reviewValue: 10, ...samples })).toMatchObject({ reviewBy: null, belowNow: true });
  });
});

describe("The Plan and the Memory view name the same review day", () => {
  const skills = [{ skill: "s", title: "Products", current: "v1", status: "CONFIRMED", prerequisites: [] }] as never;
  /** A track whose latest result is an independent success, with the concept's due instant. */
  const track = (due: Date): ProgressRow => ({
    track: "t", subject: "s", definition: "v1", initialConfidence: 80, startingBasis: "SELF_REPORTED", initializedAt: at("2026-09-01T12:00:00Z"),
    inputs: [{ input: "i", evidence: "case", revision: 1, performedAt: at("2026-09-01T12:00:00Z"), signal: "INDEPENDENT", fresh: true, gateMet: true, attribution: "AI assessment" }],
    adjustments: [], estimate: { value: 90, basis: "", ready: true, stability: 2.3, due },
  });
  const planDay = (read: Date, due: Date) => planRequest({ skills, tracks: [track(due)], schedule: { today: studyDate(read), plans: [], deadlines: [] } as never }).candidates[0]?.earliestDay;

  test("for reads every 90 minutes around both changes of daylight saving time and due instants up to five days ahead", () => {
    let compared = 0;
    for (const start of ["2026-10-30T00:00:00Z", "2027-03-12T00:00:00Z"]) {
      for (let read = Date.parse(start); read < Date.parse(start) + 4 * DAY; read += 90 * 60_000) {
        for (let ahead = -1.5 * DAY; ahead <= 5 * DAY; ahead += 97 * 60_000) {
          const instant = new Date(read), due = new Date(read + ahead), memory = reviewDay({ at: instant, explanation: explained(due) });
          // A due instant that has passed is "Due now" in the Memory view and today in the Plan.
          expect(planDay(instant, due)).toBe(memory.day);
          expect(memory.days).toBe(daysFrom(studyDate(instant), memory.day));
          // The page counts its dates the same way, so its "in N days" lands on the read's day.
          expect(dayAfter(instant.toISOString(), memory.days)).toBe(memory.day);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(10_000);
  });
});
