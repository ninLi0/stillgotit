import { describe, expect, test } from "bun:test";
import { planDay, planDayLabel, sessionLabels, sourceLabel } from "../frontend/src/labels.ts";
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
});

describe("Readable source locations", () => {
  test("each imported location kind names the material and the place in it", () => {
    const key = "638f03e786ee0ccc";
    expect(sourceLabel(`${key}/page/1`, "Lecture 4")).toBe("Lecture 4, page 1");
    expect(sourceLabel(`${key}/slide/3`, "Slides")).toBe("Slides, slide 3");
    expect(sourceLabel(`${key}/lines/1-100`, "Notes")).toBe("Notes, lines 1–100");
    expect(sourceLabel(`${key}/cell/4`, "Notebook")).toBe("Notebook, cell 4");
    expect(sourceLabel(`${key}/sheet/Budget/rows/1-40`, "Workbook")).toBe("Workbook, sheet Budget");
    expect(sourceLabel(`${key}/sheet/Q3 Totals/rows/41-80`, "Workbook")).toBe("Workbook, sheet Q3 Totals, rows 41–80");
    expect(sourceLabel(`${key}/image`, "Whiteboard")).toBe("Whiteboard, image");
    expect(sourceLabel(`${key}/document`, "Reading")).toBe("Reading");
    expect(sourceLabel("lecture/time/00:30-00:45", "Lecture video")).toBe("Lecture video, 00:30–00:45");
  });

  test("the whole-material location, unknown kinds, and unknown titles still read plainly", () => {
    expect(sourceLabel("content", "Lecture 4")).toBe("Lecture 4");
    expect(sourceLabel(`abc/region/2/3`, "Map")).toBe("Map, region 2 3");
    expect(sourceLabel("abc/page/2")).toBe("Course material, page 2");
    expect(sourceLabel("abc/page/2", "  ")).toBe("Course material, page 2");
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
    expect(failureText({ error: "BAD_JSON", detail: "Invalid JSON response from /learning/lesson (status 524)." }))
      .toBe("The server did not answer. Check your connection and try again. Your saved work is still there.");
  });
});
