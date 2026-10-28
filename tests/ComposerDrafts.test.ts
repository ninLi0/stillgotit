import { describe, expect, test } from "bun:test";
import { ComposerDrafts, DRAFTS_KEY, DRAFT_LIMIT, DRAFT_MAX_AGE, conversationSlot, isEmptyDraft, joinDrafts, newConversationSlot,
  sentAsLesson, sentInConversation, settleSending, slotSession, type ComposerDraft } from "../frontend/src/composer-drafts.ts";

// The lesson's message box keeps what a learner writes in the browser's local storage, by learner and conversation,
// until the server accepts the message. These tests use a stand-in for local storage and a clock the test moves.

function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}
function clock(start = Date.parse("2026-10-28T12:00:00Z")) {
  const time = { now: start };
  return { time, now: () => time.now };
}
const draft = (text: string, more: Partial<ComposerDraft> = {}): ComposerDraft => ({ text, channel: "TEXT", files: [], sending: null, ...more });
const lessonA = conversationSlot("01a18182-23a4-7d6f-ae48-64c91e343cdb"), lessonB = conversationSlot("01a18182-2525-79bf-b481-fd926902c733");
const newMatrices = newConversationSlot("skill-matrices");

describe("Draft keys", () => {
  test("a draft belongs to one learner, and another learner on the same browser never reads it", () => {
    const storage = memory(), ada = new ComposerDrafts(storage, "ada"), ben = new ComposerDrafts(storage, "ben");
    ada.save(lessonA, draft("Why does the order matter?"));
    expect(ben.read(lessonA)).toBeNull();
    ben.save(lessonA, draft("Ben's own question"));
    expect(ada.read(lessonA)?.text).toBe("Why does the order matter?");
    expect(ben.read(lessonA)?.text).toBe("Ben's own question");
    // Removing one learner's draft leaves the other's.
    ben.remove(lessonA);
    expect(ben.read(lessonA)).toBeNull();
    expect(ada.read(lessonA)?.text).toBe("Why does the order matter?");
  });

  test("each conversation and each skill's new conversation has its own draft", () => {
    const storage = memory(), drafts = new ComposerDrafts(storage, "ada");
    drafts.save(lessonA, draft("For lesson A"));
    drafts.save(lessonB, draft("For lesson B"));
    drafts.save(newMatrices, draft("To start a new lesson"));
    expect(drafts.read(lessonA)?.text).toBe("For lesson A");
    expect(drafts.read(lessonB)?.text).toBe("For lesson B");
    expect(drafts.read(newMatrices)?.text).toBe("To start a new lesson");
    expect(drafts.read(newConversationSlot("skill-dimensions"))).toBeNull();
    expect(slotSession(lessonA)).toBe("01a18182-23a4-7d6f-ae48-64c91e343cdb");
    expect(slotSession(newMatrices)).toBeNull();
  });
});

describe("Restoring a draft", () => {
  test("a reload reads back the text, the channel, and the names of attached files, and a later save replaces it", () => {
    const storage = memory();
    new ComposerDrafts(storage, "ada").save(lessonA, draft("I said this aloud", { channel: "VOICE", files: ["work.jpg", "notes.pdf"] }));
    const reloaded = new ComposerDrafts(storage, "ada");
    expect(reloaded.read(lessonA)).toEqual({ text: "I said this aloud", channel: "VOICE", files: ["work.jpg", "notes.pdf"], sending: null });
    reloaded.save(lessonA, draft("I said this aloud, and then typed more"));
    expect(new ComposerDrafts(storage, "ada").read(lessonA)?.text).toBe("I said this aloud, and then typed more");
  });

  test("an empty or blank draft is removed, and an empty box with no draft writes nothing", () => {
    const storage = memory(), drafts = new ComposerDrafts(storage, "ada");
    drafts.save(lessonA, draft(""));
    expect(storage.values.has(DRAFTS_KEY)).toBe(false);
    drafts.save(lessonA, draft("Half a question"));
    drafts.save(lessonA, draft("  \n "));
    expect(drafts.read(lessonA)).toBeNull();
    // A draft with only the names of files that were attached still says something, so it stays.
    drafts.save(lessonA, draft("", { files: ["work.jpg"] }));
    expect(drafts.read(lessonA)?.files).toEqual(["work.jpg"]);
    expect(isEmptyDraft(draft(" "))).toBe(true);
    expect(isEmptyDraft(draft("", { sending: { text: "On its way", channel: "TEXT", files: [], after: 0 } }))).toBe(false);
  });

  test("what the page reads is a copy, so changing it changes nothing saved", () => {
    const storage = memory(), drafts = new ComposerDrafts(storage, "ada");
    drafts.save(lessonA, draft("Kept", { files: ["work.jpg"] }));
    const read = drafts.read(lessonA)!;
    read.files.push("other.png"); read.text = "Changed";
    expect(drafts.read(lessonA)).toEqual(draft("Kept", { files: ["work.jpg"] }));
  });
});

describe("A message on its way", () => {
  const sending = { text: "Why does the order matter?", channel: "TEXT" as const, files: ["work.jpg"], after: 2 };

  test("the draft keeps the message while it is on its way, and lets it go once the server accepts it", () => {
    const storage = memory(), drafts = new ComposerDrafts(storage, "ada");
    // Sending empties the box, but the draft still holds the message.
    drafts.save(lessonA, draft("", { sending }));
    expect(drafts.read(lessonA)?.sending).toEqual(sending);
    // Accepted, with nothing written since: the draft is gone.
    drafts.save(lessonA, draft(""));
    expect(drafts.read(lessonA)).toBeNull();
    // Accepted while the learner wrote the next message: only that stays.
    drafts.save(lessonA, draft("A follow-up", { sending }));
    drafts.save(lessonA, settleSending(drafts.read(lessonA)!, true));
    expect(drafts.read(lessonA)).toEqual(draft("A follow-up"));
  });

  test("a message the server did not accept returns ahead of what was written since, with its files' names and channel", () => {
    expect(settleSending(draft("Written while waiting", { files: ["later.png"], sending }), false))
      .toEqual({ text: "Why does the order matter?\n\nWritten while waiting", channel: "TEXT", files: ["work.jpg", "later.png"], sending: null });
    expect(settleSending(draft("", { sending: { ...sending, channel: "VOICE" } }), false))
      .toEqual({ text: "Why does the order matter?", channel: "VOICE", files: ["work.jpg"], sending: null });
    // A draft with nothing on its way is unchanged either way.
    expect(settleSending(draft("Just a draft"), false)).toEqual(draft("Just a draft"));
    expect(settleSending(draft("Just a draft"), true)).toEqual(draft("Just a draft"));
  });

  test("after a reload, the conversation's saved turns tell whether the message arrived", () => {
    const turn = (speaker: string, text: string) => ({ turn: { speaker, text } });
    const before = [turn("LEARNER", "First"), turn("TUTOR", "An answer")];
    expect(sentInConversation(before, sending)).toBe(false);
    expect(sentInConversation([...before, turn("LEARNER", "Why does the order matter?")], sending)).toBe(true);
    // The same words from the tutor, or an earlier identical question, are not this message.
    expect(sentInConversation([...before, turn("TUTOR", "Why does the order matter?")], sending)).toBe(false);
    expect(sentInConversation([turn("LEARNER", "Why does the order matter?"), turn("TUTOR", "An answer")], sending)).toBe(false);
  });

  test("after a reload, a new conversation's first message arrived when a later lesson has it as its request", () => {
    const first = { text: "  Explain matrix products.  ", channel: "TEXT" as const, files: [], after: 1 };
    const sessions = [{ lesson: { request: "Explain matrix products." } }, { lesson: null }];
    expect(sentAsLesson(sessions, first)).toBe(false);
    expect(sentAsLesson([...sessions, { lesson: { request: "Explain matrix products." } }], first)).toBe(true);
    expect(sentAsLesson([...sessions, { lesson: { request: "Something else" } }], first)).toBe(false);
  });

  test("pieces of a draft join with a blank line, and a blank piece adds nothing", () => {
    expect(joinDrafts("Sent first", "Written since")).toBe("Sent first\n\nWritten since");
    expect(joinDrafts("Sent first", "  ")).toBe("Sent first");
    expect(joinDrafts("", "Written since")).toBe("Written since");
  });
});

describe("Draft storage limits", () => {
  test("a draft left untouched for seven days is dropped, and saving again restarts its seven days", () => {
    const storage = memory(), { time, now } = clock(), drafts = new ComposerDrafts(storage, "ada", now);
    drafts.save(lessonA, draft("An old draft"));
    drafts.save(lessonB, draft("Another old draft"));
    time.now += DRAFT_MAX_AGE;
    expect(drafts.read(lessonA)?.text).toBe("An old draft");
    drafts.save(lessonB, draft("Edited on the last day"));
    time.now += 1;
    expect(drafts.read(lessonA)).toBeNull();
    expect(drafts.read(lessonB)?.text).toBe("Edited on the last day");
    // The next save leaves the expired draft out of storage, including another learner's.
    new ComposerDrafts(storage, "ben", now).save(newMatrices, draft("Ben's draft"));
    const stored = JSON.parse(storage.values.get(DRAFTS_KEY)!) as { slot: string; learner: string }[];
    expect(stored.map((item) => `${item.learner} ${item.slot}`).sort()).toEqual([`ada ${lessonB}`, `ben ${newMatrices}`]);
  });

  test("opening a conversation saves its draft unchanged, which does not restart its seven days", () => {
    const storage = memory(), { time, now } = clock(), drafts = new ComposerDrafts(storage, "ada", now);
    drafts.save(lessonA, draft("Written on Monday", { files: ["work.jpg"] }));
    time.now += DRAFT_MAX_AGE - 1000;
    drafts.save(lessonA, drafts.read(lessonA)!);
    time.now += 2000;
    expect(drafts.read(lessonA)).toBeNull();
  });

  test("at most fifty drafts are kept in all, and the oldest go first", () => {
    const storage = memory(), { time, now } = clock(), ada = new ComposerDrafts(storage, "ada", now), ben = new ComposerDrafts(storage, "ben", now);
    for (let index = 0; index < DRAFT_LIMIT + 5; index++) {
      time.now += 1000;
      (index % 2 ? ben : ada).save(conversationSlot(`session-${index}`), draft(`Draft ${index}`));
    }
    const stored = JSON.parse(storage.values.get(DRAFTS_KEY)!) as unknown[];
    expect(stored).toHaveLength(DRAFT_LIMIT);
    for (let index = 0; index < 5; index++) expect((index % 2 ? ben : ada).read(conversationSlot(`session-${index}`))).toBeNull();
    expect(ada.read(conversationSlot("session-6"))?.text).toBe("Draft 6");
    expect(ben.read(conversationSlot(`session-${DRAFT_LIMIT + 3}`))?.text).toBe(`Draft ${DRAFT_LIMIT + 3}`);
    // Editing an old draft makes it the newest, so it is kept when the next one arrives.
    time.now += 1000; ada.save(conversationSlot("session-6"), draft("Draft 6, edited"));
    time.now += 1000; ada.save(conversationSlot("one more"), draft("One more"));
    expect(ada.read(conversationSlot("session-6"))?.text).toBe("Draft 6, edited");
    expect(ben.read(conversationSlot("session-5"))).toBeNull();
  });
});

describe("When storage is unavailable", () => {
  test("no storage at all: nothing is read, and saving does nothing without failing", () => {
    const drafts = new ComposerDrafts(null, "ada");
    expect(() => drafts.save(lessonA, draft("Kept on the page only"))).not.toThrow();
    expect(drafts.read(lessonA)).toBeNull();
    expect(() => drafts.remove(lessonA)).not.toThrow();
  });

  test("storage that refuses to be read is never overwritten, so no other draft is lost", () => {
    const storage = memory();
    new ComposerDrafts(storage, "ada").save(lessonA, draft("Saved before the failure"));
    const saved = storage.values.get(DRAFTS_KEY);
    const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: (key: string, value: string) => storage.setItem(key, value) };
    const drafts = new ComposerDrafts(blocked, "ada");
    expect(drafts.read(lessonA)).toBeNull();
    drafts.save(lessonB, draft("Written while storage was blocked"));
    expect(storage.values.get(DRAFTS_KEY)).toBe(saved);
  });

  test("storage that is full keeps what it had, and the save does not fail", () => {
    const storage = memory(), drafts = new ComposerDrafts(storage, "ada");
    drafts.save(lessonA, draft("Fits"));
    const full = { getItem: storage.getItem, setItem: () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); } };
    expect(() => new ComposerDrafts(full, "ada").save(lessonB, draft("Too much"))).not.toThrow();
    expect(drafts.read(lessonA)?.text).toBe("Fits");
    expect(drafts.read(lessonB)).toBeNull();
  });

  test("an unreadable or malformed entry is ignored, and the next save starts over", () => {
    const storage = memory(), drafts = new ComposerDrafts(storage, "ada");
    storage.setItem(DRAFTS_KEY, "not json");
    expect(drafts.read(lessonA)).toBeNull();
    storage.setItem(DRAFTS_KEY, JSON.stringify({ not: "a list" }));
    expect(drafts.read(lessonA)).toBeNull();
    const good = { learner: "ada", slot: lessonA, text: "Good", channel: "TEXT", files: [], sending: null, savedAt: Date.now() };
    storage.setItem(DRAFTS_KEY, JSON.stringify([
      { ...good, slot: lessonB, channel: "SHOUT" }, { ...good, slot: newMatrices, files: [7] }, null, "text",
      { ...good, slot: "sending", sending: { text: "x", channel: "TEXT", files: [], after: -1 } }, good]));
    expect(drafts.read(lessonA)?.text).toBe("Good");
    expect(drafts.read(lessonB)).toBeNull();
    expect(drafts.read(newMatrices)).toBeNull();
    expect(drafts.read("sending")).toBeNull();
    drafts.save(newMatrices, draft("Fresh"));
    expect((JSON.parse(storage.values.get(DRAFTS_KEY)!) as unknown[])).toHaveLength(2);
  });
});
