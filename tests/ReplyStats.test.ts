import { describe, expect, test } from "bun:test";
import { secondsLabel, sourcesLabel } from "../frontend/src/labels.ts";
import { answerSeconds } from "../frontend/src/reply-stats.ts";

const turn = (turnIndex: number, speaker: "LEARNER" | "TUTOR", purpose: string, at: string) =>
  ({ turnIndex, turn: { speaker, purpose, at } });

describe("Answer time", () => {
  test("a lesson reply took the time since the learner's latest question", () => {
    const dialogue = [
      turn(0, "LEARNER", "RESPONSE", "2026-10-25T15:00:00.000Z"),
      turn(1, "TUTOR", "EXPLANATION", "2026-10-25T15:00:07.400Z"),
      turn(2, "LEARNER", "RESPONSE", "2026-10-25T15:03:00.000Z"),
      turn(3, "LEARNER", "RESPONSE", "2026-10-25T15:04:00.000Z"),
      turn(4, "TUTOR", "EXPLANATION", "2026-10-25T15:04:12.600Z"),
    ];
    expect(answerSeconds(dialogue, 1)).toBe(7);
    // Two questions in a row: the reply answers the later one.
    expect(answerSeconds(dialogue, 4)).toBe(13);
  });

  test("hints, learner turns, and replies with no question before them have no answer time", () => {
    const dialogue = [
      turn(0, "TUTOR", "EXPLANATION", "2026-10-25T15:00:05.000Z"),
      turn(1, "LEARNER", "RESPONSE", "2026-10-25T15:01:00.000Z"),
      turn(2, "TUTOR", "HINT", "2026-10-25T15:04:00.000Z"),
    ];
    expect(answerSeconds(dialogue, 0)).toBeNull();
    expect(answerSeconds(dialogue, 1)).toBeNull();
    expect(answerSeconds(dialogue, 2)).toBeNull();
    expect(answerSeconds(dialogue, 9)).toBeNull();
  });

  test("an unreadable or backwards time gives no answer time", () => {
    expect(answerSeconds([turn(0, "LEARNER", "RESPONSE", "not a time"), turn(1, "TUTOR", "EXPLANATION", "2026-10-25T15:00:05.000Z")], 1)).toBeNull();
    expect(answerSeconds([turn(0, "LEARNER", "RESPONSE", "2026-10-25T15:00:05.000Z"), turn(1, "TUTOR", "EXPLANATION", "2026-10-25T15:00:00.000Z")], 1)).toBeNull();
  });
});

describe("Reply labels", () => {
  test("waits read in whole seconds, then minutes and seconds", () => {
    expect(secondsLabel(0)).toBe("0 s");
    expect(secondsLabel(7.4)).toBe("7 s");
    expect(secondsLabel(59)).toBe("59 s");
    expect(secondsLabel(60)).toBe("1 min");
    expect(secondsLabel(125)).toBe("2 min 5 s");
  });

  test("source counts name one source or several", () => {
    expect(sourcesLabel(1)).toBe("1 source");
    expect(sourcesLabel(2)).toBe("2 sources");
  });
});
