import { describe, expect, test } from "bun:test";
import * as choice from "../frontend/src/tutor-choice.ts";

// The browser labels each tutor answer with the model and thinking level that produced it. These are the
// pure helpers behind that: which answers are new since the last read, the note taken from each reply,
// and the names shown for models and levels.

const turn = (turnIndex: number, speaker: "LEARNER" | "TUTOR", purpose = "RESPONSE") => ({ turnIndex, turn: { speaker, purpose, text: "t", media: [] } });
const session = (id: string, dialogue: unknown[]) => ({ session: id, dialogue });
const judgment = (id: string, origin: "AI" | "MANUAL") => ({ judgment: id, origin });

describe("Which answers get a tutor label", () => {
  test("new sessions, new tutor turns and new AI judgments are labelled; learner turns are not", () => {
    const previous = { sessions: [session("s1", [turn(0, "LEARNER"), turn(1, "TUTOR")])], cases: [{ case: "c1", judgment: judgment("j1", "AI"), history: [judgment("j1", "AI")] }] };
    const next = {
      sessions: [session("s1", [turn(0, "LEARNER"), turn(1, "TUTOR"), turn(2, "LEARNER"), turn(3, "TUTOR", "HINT")]), session("s2", [])],
      cases: [{ case: "c1", judgment: judgment("j2", "AI"), history: [judgment("j1", "AI"), judgment("j2", "AI")] },
        { case: "c2", judgment: judgment("j3", "MANUAL"), history: [judgment("j3", "MANUAL")] }],
    };
    expect(choice.newAnswers(previous as never, next as never).sort()).toEqual(["judgment:j2", "session:s2", "turn:s1:3"]);
  });

  test("a manual correction after an AI judgment is not labelled, and an identical read finds nothing new", () => {
    const before = { sessions: [], cases: [{ case: "c1", judgment: judgment("j1", "AI"), history: [judgment("j1", "AI")] }] };
    const corrected = { sessions: [], cases: [{ case: "c1", judgment: judgment("j2", "MANUAL"), history: [judgment("j1", "AI"), judgment("j2", "MANUAL")] }] };
    expect(choice.newAnswers(before as never, corrected as never)).toEqual([]);
    expect(choice.newAnswers(corrected as never, corrected as never)).toEqual([]);
  });
});

describe("The note taken from each reply", () => {
  test("the note is taken once, and replies without a tutor field leave it unchanged", () => {
    choice.noteTutor({ lesson: "x", tutor: { model: "gemini-3.8-flash", level: "MEDIUM" } });
    choice.noteTutor({ data: {} });
    expect(choice.takeTutor()).toEqual({ model: "gemini-3.8-flash", level: "MEDIUM" });
    expect(choice.takeTutor()).toBeNull();
  });
});

describe("Names shown for models and levels", () => {
  test("the label, the catalog name, the raw-id fallback for a retired model, and the level order", () => {
    expect(choice.tutorLabel({ model: "gemini-3.8-flash", level: "MEDIUM" } as never)).toBe("gemini-3.8-flash · Medium thinking");
    const record = { models: [{ model: "gemini-3.8-flash", name: "Gemini 3.8 Flash" }] };
    expect(choice.modelName("gemini-3.8-flash", record as never)).toBe("Gemini 3.8 Flash");
    expect(choice.modelName("gemini-retired", record as never)).toBe("gemini-retired");
    expect(choice.levelName("MINIMAL")).toBe("Minimal");
    expect(choice.orderedLevels(["HIGH", "LOW", "MINIMAL", "MEDIUM"] as never)).toEqual(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
  });
});
