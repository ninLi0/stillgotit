/**
 * What a learner has written in the lesson's message box and not sent yet, kept in the browser's local storage so that a
 * reload, a new sign-in, or a visit to another conversation does not lose it. Each draft belongs to one learner and one
 * conversation: a saved conversation, or the new conversation of a skill that has not started yet. A learner never sees
 * another learner's drafts, even on a shared browser, because every draft is stored with the learner's username and only
 * that learner's drafts are read.
 *
 * Files are not kept. A draft remembers only the names of the files that were attached, so the page can say they need to
 * be attached again. A message on its way to the server is kept with its draft until the server accepts it, so a reload
 * in the meantime cannot lose it either; the page settles it when it next reads the conversation.
 *
 * Storage is bounded: a draft left untouched for seven days is dropped, and at most fifty drafts are kept in all, the
 * oldest going first. When the browser blocks storage, nothing is saved and the page keeps its drafts in memory as before.
 */
export type DraftChannel = "TEXT" | "VOICE";

/** A message that was on its way to the server when the draft was last saved. */
export interface SendingDraft {
  text: string;
  channel: DraftChannel;
  /** The names of the files that went with it. The files themselves are not kept. */
  files: string[];
  /**
   * How much of the conversation the page knew when it sent the message: the number of dialogue turns, or for the first
   * message of a new conversation, the number of the skill's conversations. Only what comes after it can be this message.
   */
  after: number;
}

export interface ComposerDraft {
  text: string;
  channel: DraftChannel;
  /** The names of the files attached to the draft. The files themselves are not kept. */
  files: string[];
  sending: SendingDraft | null;
}

type StoredDraft = ComposerDraft & { learner: string; slot: string; savedAt: number };
type DraftStorage = Pick<Storage, "getItem" | "setItem">;

export const DRAFTS_KEY = "stillgotit-composer-drafts";
export const DRAFT_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const DRAFT_LIMIT = 50;

/** The draft of a saved conversation. */
export function conversationSlot(session: string): string { return `session:${session}`; }
/** The draft of a skill's new conversation, before its first message starts it. */
export function newConversationSlot(skill: string): string { return `new:${skill}`; }
/** The conversation a slot names, or null for a new conversation. */
export function slotSession(slot: string): string | null { return slot.startsWith("session:") ? slot.slice("session:".length) : null; }

/** A draft with nothing in it, which is removed rather than kept. */
export function isEmptyDraft(draft: ComposerDraft): boolean {
  return !draft.text.trim() && !draft.files.length && !draft.sending;
}

/** Two pieces of a draft, the earlier first, with a blank line between them. A blank piece adds nothing. */
export function joinDrafts(first: string, then: string): string {
  if (!then.trim()) return first;
  if (!first.trim()) return then;
  return `${first}\n\n${then}`;
}

/**
 * The draft once the server's answer to the message on its way is known. An accepted message leaves the draft. A message
 * the server never accepted returns to the box ahead of anything written since, as it does after a failed send, with
 * its files' names, and it keeps the channel it was sent with.
 */
export function settleSending(draft: ComposerDraft, accepted: boolean): ComposerDraft {
  const sending = draft.sending;
  if (!sending) return draft;
  if (accepted) return { ...draft, sending: null };
  return { text: joinDrafts(sending.text, draft.text), channel: sending.channel, files: [...sending.files, ...draft.files], sending: null };
}

/** Whether a conversation's saved turns show that the server accepted a message: a learner turn with its exact text, after the turns the page knew of. */
export function sentInConversation(dialogue: readonly { turn: { speaker: string; text: string } }[], sending: Pick<SendingDraft, "text" | "after">): boolean {
  return dialogue.slice(sending.after).some((item) => item.turn.speaker === "LEARNER" && item.turn.text === sending.text);
}

/** Whether a skill's conversations show that the server started a lesson with a message as its request, after the conversations the page knew of. */
export function sentAsLesson(sessions: readonly { lesson?: { request: string } | null }[], sending: Pick<SendingDraft, "text" | "after">): boolean {
  const request = sending.text.trim();
  return sessions.slice(sending.after).some((session) => session.lesson?.request === request);
}

function sameDraft(a: ComposerDraft, b: ComposerDraft): boolean {
  const sending = (draft: ComposerDraft) => draft.sending && [draft.sending.text, draft.sending.channel, draft.sending.files, draft.sending.after];
  return JSON.stringify([a.text, a.channel, a.files, sending(a)]) === JSON.stringify([b.text, b.channel, b.files, sending(b)]);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isChannel(value: unknown): value is DraftChannel { return value === "TEXT" || value === "VOICE"; }
function isSending(value: unknown): value is SendingDraft {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.text === "string" && isChannel(item.channel) && isStrings(item.files) &&
    typeof item.after === "number" && Number.isInteger(item.after) && item.after >= 0;
}
function isStored(value: unknown): value is StoredDraft {
  if (value === null || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return typeof item.learner === "string" && typeof item.slot === "string" && typeof item.text === "string" && isChannel(item.channel) &&
    isStrings(item.files) && (item.sending === null || isSending(item.sending)) && typeof item.savedAt === "number" && Number.isFinite(item.savedAt);
}

/** One learner's drafts in the browser's storage. `now` gives the time in milliseconds, for the seven-day limit. */
export class ComposerDrafts {
  constructor(private readonly storage: DraftStorage | null, private readonly learner: string, private readonly now: () => number = Date.now) {}

  /** Every learner's drafts that are still fresh, or null when storage cannot be read, so that nothing is overwritten. */
  private all(): StoredDraft[] | null {
    if (!this.storage) return null;
    let text: string | null;
    try { text = this.storage.getItem(DRAFTS_KEY); } catch { return null; }
    let value: unknown = [];
    try { value = JSON.parse(text ?? "[]"); } catch { /* Only this module writes the entry. An unreadable one starts empty. */ }
    const now = this.now();
    return Array.isArray(value) ? value.filter((item): item is StoredDraft => isStored(item) && now - item.savedAt <= DRAFT_MAX_AGE) : [];
  }

  /** This learner's draft for a conversation, or null when there is none, it has expired, or storage is unavailable. */
  read(slot: string): ComposerDraft | null {
    const found = this.all()?.find((item) => item.learner === this.learner && item.slot === slot);
    if (!found) return null;
    return { text: found.text, channel: found.channel, files: [...found.files],
      sending: found.sending ? { ...found.sending, files: [...found.sending.files] } : null };
  }

  /**
   * Saves this learner's draft for a conversation, or removes it when it is empty. Expired drafts are dropped, and the
   * newest fifty are kept. When storage is blocked or full, nothing changes and the page keeps the draft in memory.
   */
  save(slot: string, draft: ComposerDraft): void {
    const all = this.all();
    if (!all) return;
    const kept = all.filter((item) => !(item.learner === this.learner && item.slot === slot));
    // A save that changes nothing writes nothing, so reopening a conversation does not restart its draft's seven days,
    // and an empty box with no saved draft never writes to storage.
    const saved = all.find((item) => item.learner === this.learner && item.slot === slot);
    if (isEmptyDraft(draft) ? !saved : saved && sameDraft(saved, draft)) return;
    if (!isEmptyDraft(draft)) {
      kept.push({ learner: this.learner, slot, text: draft.text, channel: draft.channel, files: [...draft.files],
        sending: draft.sending ? { ...draft.sending, files: [...draft.sending.files] } : null, savedAt: this.now() });
    }
    kept.sort((a, b) => b.savedAt - a.savedAt);
    try { this.storage?.setItem(DRAFTS_KEY, JSON.stringify(kept.slice(0, DRAFT_LIMIT))); } catch { /* Kept in memory only. */ }
  }

  /** Removes this learner's draft for a conversation. */
  remove(slot: string): void {
    this.save(slot, { text: "", channel: "TEXT", files: [], sending: null });
  }
}
