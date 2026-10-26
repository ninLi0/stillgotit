import { describe, expect, test } from "bun:test";
import { messageTime, secondsLabel, sourcesLabel, turnsLabel } from "../frontend/src/labels.ts";
import { UnansweredQuestions, answerSeconds, citedSources } from "../frontend/src/reply-stats.ts";

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

  test("a reply to a question that had to be retried has no answer time from the saved times", () => {
    const dialogue = [
      turn(0, "LEARNER", "RESPONSE", "2026-10-25T15:00:00.000Z"),
      turn(1, "TUTOR", "EXPLANATION", "2026-10-25T15:00:21.000Z"),
      turn(2, "LEARNER", "RESPONSE", "2026-10-25T15:01:00.000Z"),
      turn(3, "TUTOR", "EXPLANATION", "2026-10-25T15:01:04.000Z"),
    ];
    const retried = (question: number) => question === 0;
    expect(answerSeconds(dialogue, 1, retried)).toBeNull();
    expect(answerSeconds(dialogue, 3, retried)).toBe(4);
  });

  test("an unreadable or backwards time gives no answer time", () => {
    expect(answerSeconds([turn(0, "LEARNER", "RESPONSE", "not a time"), turn(1, "TUTOR", "EXPLANATION", "2026-10-25T15:00:05.000Z")], 1)).toBeNull();
    expect(answerSeconds([turn(0, "LEARNER", "RESPONSE", "2026-10-25T15:00:05.000Z"), turn(1, "TUTOR", "EXPLANATION", "2026-10-25T15:00:00.000Z")], 1)).toBeNull();
  });
});

describe("Sources in the rail", () => {
  const cite = (material: string, location: string) => ({ material, location });
  const said = (speaker: "LEARNER" | "TUTOR", ...citations: { material: string; location: string }[]) => ({ turn: { speaker, citations } });

  test("each conversation's own sources come first, then its replies' sources, each source once", () => {
    const sessions = [
      { citations: [cite("m1", "p/1")], dialogue: [said("LEARNER"), said("TUTOR", cite("m1", "p/1"), cite("m1", "p/3")), said("TUTOR", cite("m2", "s/2"))] },
      { citations: [cite("m2", "s/2"), cite("m3", "content")], dialogue: [said("TUTOR", cite("m1", "p/3"), cite("m3", "p/9"))] },
    ];
    expect(citedSources(sessions)).toEqual([cite("m1", "p/1"), cite("m1", "p/3"), cite("m2", "s/2"), cite("m3", "content"), cite("m3", "p/9")]);
    expect(citedSources([])).toEqual([]);
  });
});

describe("Questions seen without a reply", () => {
  const memory = () => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, values };
  };

  test("marks survive a reload, once each, keeping only the newest", () => {
    const storage = memory();
    const first = new UnansweredQuestions(storage, 3);
    for (const mark of ["a:0", "a:2", "a:0", "b:1", "c:4"]) first.add(mark);
    expect(first.list()).toEqual(["a:2", "b:1", "c:4"]);
    expect(new UnansweredQuestions(storage, 3).list()).toEqual(["a:2", "b:1", "c:4"]);
  });

  test("blocked or unreadable storage starts empty and still keeps marks until reload", () => {
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    const page = new UnansweredQuestions(blocked);
    page.add("a:0");
    expect(page.list()).toEqual(["a:0"]);
    const storage = memory();
    storage.setItem("stillgotit-unanswered-questions", "not json");
    expect(new UnansweredQuestions(storage).list()).toEqual([]);
    storage.setItem("stillgotit-unanswered-questions", JSON.stringify(["a:0", 7, null]));
    expect(new UnansweredQuestions(storage).list()).toEqual(["a:0"]);
    expect(new UnansweredQuestions(null).list()).toEqual([]);
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

  test("turn counts name one turn or several", () => {
    expect(turnsLabel(0)).toBe("0 turns");
    expect(turnsLabel(1)).toBe("1 turn");
    expect(turnsLabel(4)).toBe("4 turns");
  });

  test("a saved time reads as a New York date and time", () => {
    expect(messageTime("2026-10-25T19:04:00.000Z")).toBe("Oct 25, 3:04 PM");
    // Late evening in New York is already the next day in UTC.
    expect(messageTime(Date.UTC(2026, 0, 2, 3, 30))).toBe("Jan 1, 10:30 PM");
    expect(messageTime("not a time")).toBe("");
  });
});
