import { expect, test } from "bun:test";
import { activityLabel, continueOrder, requestSession, takeSession, type OpenSession } from "../frontend/src/continue-session.ts";

const row = (studySession: string, lastActive: string | null, kind: OpenSession["kind"] = "LESSON") =>
  ({ studySession, skill: "skill", title: "Products", kind, lastActive }) as OpenSession;

test("the Continue card lists sessions with a turn by latest turn, then the rest by newest start", () => {
  // The server answers in start order: a, b, c, d.
  const sessions = [row("a", "2026-10-20T15:00:00Z"), row("b", null), row("c", "2026-10-24T15:00:00Z"), row("d", null, "PRACTICE")];
  expect(continueOrder(sessions).map((session) => String(session.studySession))).toEqual(["c", "a", "d", "b"]);
  expect(continueOrder([])).toEqual([]);
});

test("a row says when it was last active in New York time, or what it is waiting for", () => {
  const now = new Date("2026-10-24T20:00:00Z");
  expect(activityLabel(row("a", "2026-10-24T19:05:00Z"), now)).toBe("Last active today at 3:05 PM");
  // 02:00 UTC on Oct 24 is still Oct 23 in New York.
  expect(activityLabel(row("a", "2026-10-24T02:00:00Z"), now)).toBe("Last active Oct 23");
  expect(activityLabel(row("a", null), now)).toBe("No questions yet");
  expect(activityLabel(row("a", null, "PRACTICE"), now)).toBe("No answer yet");
});

test("a requested session is taken once, and only by its own skill", () => {
  requestSession("skill-a", "session-1" as OpenSession["studySession"]);
  expect(takeSession("skill-b")).toBeNull();
  expect(String(takeSession("skill-a"))).toBe("session-1");
  expect(takeSession("skill-a")).toBeNull();
});
