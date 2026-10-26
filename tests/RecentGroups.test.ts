import { expect, test } from "bun:test";
import { recentGroups, shortAgo } from "../frontend/src/recent-groups.ts";

const row = (id: string, lastActivity: string | null) => ({ id, lastActivity });
const shape = (groups: ReturnType<typeof recentGroups<ReturnType<typeof row>>>) => groups.map((group) => [group.label, group.rows.map((item) => item.id)]);

test("conversations group by their last activity's day in New York, keeping the order they arrive in", () => {
  // Wednesday, October 28, 2026, at noon in New York.
  const now = new Date("2026-10-28T16:00:00Z");
  const rows = [
    row("this-morning", "2026-10-28T13:30:00Z"),
    // 03:00 UTC on Oct 28 is still Oct 27 in New York, so it was yesterday there.
    row("late-last-night", "2026-10-28T03:00:00Z"),
    row("monday", "2026-10-26T14:00:00Z"),
    row("sunday", "2026-10-25T14:00:00Z"),
    row("no-time", null),
    row("earlier-today", "2026-10-28T04:30:00Z"),
  ];
  expect(shape(recentGroups(rows, now))).toEqual([
    ["Today", ["this-morning", "earlier-today"]],
    ["Yesterday", ["late-last-night"]],
    ["Earlier this week", ["monday"]],
    ["Earlier", ["sunday", "no-time"]],
  ]);
  expect(recentGroups([], now)).toEqual([]);
});

test("the week starts on Monday, so on a Monday nothing is earlier this week", () => {
  const monday = new Date("2026-10-26T16:00:00Z");
  expect(shape(recentGroups([row("sunday", "2026-10-25T16:00:00Z"), row("saturday", "2026-10-24T16:00:00Z")], monday)))
    .toEqual([["Yesterday", ["sunday"]], ["Earlier", ["saturday"]]]);
  // On Sunday, November 1, Monday through Friday are earlier this week and Saturday is yesterday.
  const sunday = new Date("2026-11-01T17:00:00Z");
  expect(shape(recentGroups([row("saturday", "2026-10-31T16:00:00Z"), row("tuesday", "2026-10-27T16:00:00Z"), row("monday", "2026-10-26T05:00:00Z"), row("last-sunday", "2026-10-26T03:00:00Z")], sunday)))
    .toEqual([["Yesterday", ["saturday"]], ["Earlier this week", ["tuesday", "monday"]], ["Earlier", ["last-sunday"]]]);
});

test("a time a little in the future, from a clock that runs ahead, counts as today", () => {
  const now = new Date("2026-10-28T16:00:00Z");
  expect(shape(recentGroups([row("ahead", "2026-10-28T16:00:05Z")], now))).toEqual([["Today", ["ahead"]]]);
});

test("a row's time is short: now, minutes, hours, days, then the date", () => {
  const now = new Date("2026-10-28T16:00:00Z");
  expect(shortAgo("2026-10-28T15:59:30Z", now)).toBe("now");
  expect(shortAgo("2026-10-28T16:00:30Z", now)).toBe("now");
  expect(shortAgo("2026-10-28T15:55:00Z", now)).toBe("5 min");
  expect(shortAgo("2026-10-28T13:00:00Z", now)).toBe("3 h");
  expect(shortAgo("2026-10-26T15:00:00Z", now)).toBe("2 d");
  expect(shortAgo("2026-10-12T15:00:00Z", now)).toBe("Oct 12");
  expect(shortAgo("2025-10-12T15:00:00Z", now)).toBe("Oct 12, 2025");
  expect(shortAgo(null, now)).toBe("");
});
