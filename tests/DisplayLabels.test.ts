import { describe, expect, test } from "bun:test";
import { dayAfter, dayTime, planDay, planDayLabel, sessionLabels, sourceLabel } from "../frontend/src/labels.ts";
import { failureText } from "../frontend/src/api.ts";

describe("Readable plan dates", () => {
  test("a plan day shows its weekday and date in New York, whatever the computer's time zone", () => {
    expect(planDay("2026-10-23")).toBe("Fri, Oct 23");
    expect(planDay("2026-10-22")).toBe("Thu, Oct 22");
    // The day after daylight saving time starts still keeps its calendar date.
    expect(planDay("2026-03-08")).toBe("Sun, Mar 8");
    // A full timestamp is read as a New York time: 02:00 UTC on Oct 24 is still Oct 23 in New York.
    expect(planDay("2026-10-24T02:00:00Z")).toBe("Fri, Oct 23");
    expect(planDay("not a date")).toBe("not a date");
  });

  test("the current plan day reads as Today", () => {
    expect(planDayLabel("2026-10-22", "2026-10-22")).toBe("Today");
    expect(planDayLabel("2026-10-23", "2026-10-22")).toBe("Fri, Oct 23");
  });

  test("a day some days ahead is counted on the New York calendar, across changes of daylight saving time", () => {
    // 10:00 on Wednesday in New York: two days ahead is Friday.
    expect(dayAfter("2026-10-28T14:00:00Z", 2)).toBe("2026-10-30");
    expect(dayAfter("2026-10-28T14:00:00Z", 0)).toBe("2026-10-28");
    // 00:30 EDT on Saturday, October 31: two spans of 24 hours end at 23:30 EST on Sunday, but two days ahead is Monday.
    expect(dayAfter("2026-10-31T04:30:00Z", 2)).toBe("2026-11-02");
    // 23:30 EST on Saturday, March 13, 2027: one span of 24 hours ends on Monday, but one day ahead is Sunday.
    expect(dayAfter("2027-03-14T04:30:00Z", 1)).toBe("2027-03-14");
    // 21:00 in New York is already the next day in UTC; the day still counts from New York's date.
    expect(dayAfter("2026-10-29T01:00:00Z", 1)).toBe("2026-10-29");
    expect(planDay(dayTime("2026-11-01").toISOString())).toBe("Sun, Nov 1");
  });
});

describe("Readable source locations", () => {
  test("each imported location kind names the material and the place in it", () => {
    const key = "638f03e786ee0ccc";
    expect(sourceLabel(`${key}/page/1`, "Lecture 4")).toBe("Lecture 4 · Page 1");
    expect(sourceLabel(`${key}/slide/3`, "Slides")).toBe("Slides · Slide 3");
    expect(sourceLabel(`${key}/lines/1-100`, "Notes")).toBe("Notes · Lines 1–100");
    expect(sourceLabel(`${key}/cell/4`, "Notebook")).toBe("Notebook · Cell 4");
    expect(sourceLabel(`${key}/sheet/Budget/rows/1-40`, "Workbook")).toBe("Workbook · Sheet Budget");
    expect(sourceLabel(`${key}/sheet/Q3 Totals/rows/41-80`, "Workbook")).toBe("Workbook · Sheet Q3 Totals, rows 41–80");
    expect(sourceLabel(`${key}/image`, "Whiteboard")).toBe("Whiteboard · Image");
    expect(sourceLabel(`${key}/document`, "Reading")).toBe("Reading · Document");
    expect(sourceLabel("lecture/time/00:30-00:45", "Lecture video")).toBe("Lecture video · 00:30–00:45");
    expect(sourceLabel(`${key}/time/59:48-1:00:21`, "Lecture video")).toBe("Lecture video · 59:48–1:00:21");
  });

  test("the whole-material location, unknown kinds, and unknown titles still read plainly", () => {
    expect(sourceLabel("content", "Lecture 4")).toBe("Lecture 4 · Material text");
    expect(sourceLabel(`abc/region/2/3`, "Map")).toBe("Map · Region 2 3");
    expect(sourceLabel("abc/page/2")).toBe("Course material · Page 2");
    expect(sourceLabel("abc/page/2", "  ")).toBe("Course material · Page 2");
  });
});

describe("Conversation names", () => {
  test("lessons and practice are numbered separately in the order they were started", () => {
    const sessions = [{ session: "a", lesson: {} }, { session: "b", lesson: null }, { session: "c", lesson: {} }];
    expect(sessionLabels(sessions)).toEqual({ a: "Lesson 1", b: "Practice 1", c: "Lesson 2" });
  });

  test("starting another conversation never renames an earlier one", () => {
    const before = sessionLabels([{ session: "a", lesson: {} }]);
    const after = sessionLabels([{ session: "a", lesson: {} }, { session: "b", lesson: null }, { session: "c", lesson: {} }]);
    expect(after.a).toBe(before.a!);
    expect(after).toEqual({ a: "Lesson 1", b: "Practice 1", c: "Lesson 2" });
  });
});

describe("Error messages", () => {
  test("the server's explanation is shown when it sent one", () => {
    expect(failureText({ error: "INVALID_REQUEST", detail: "The tutor is busy right now. Wait a minute and try again." }))
      .toBe("The tutor is busy right now. Wait a minute and try again.");
    expect(failureText({ error: "INVALID_REQUEST" })).toBe("Check the field and try again.");
    expect(failureText({ error: "INVALID_REQUEST", detail: " " })).toBe("Check the field and try again.");
  });

  test("technical details written by the browser client are replaced with a plain message", () => {
    expect(failureText({ error: "BAD_JSON", detail: "Invalid JSON response from /learning/reply (status 524)." }))
      .toBe("The server did not answer. Check your connection and try again. Your saved work is still there.");
  });
});
