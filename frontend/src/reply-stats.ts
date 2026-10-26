/** Figures the lesson shows about the tutor's answers, read from the saved dialogue. */
type Turn = { speaker: string; purpose: string; at: string };

/**
 * How long a tutor reply took, in whole seconds, from the saved times: its server time minus that of the learner turn
 * it answers, the latest learner turn before it. Only lesson replies (EXPLANATION turns) answer a learner turn. A hint
 * answers a request for help, which the dialogue does not record, so a hint has no answer time. A reply to a question
 * that `retried` reports had to be retried has none either, since the gap includes the wait before the retry.
 * Null when the saved times cannot tell.
 */
export function answerSeconds(dialogue: readonly { turnIndex: number; turn: Turn }[], turnIndex: number,
  retried: (questionIndex: number) => boolean = () => false): number | null {
  const position = dialogue.findIndex((item) => item.turnIndex === turnIndex), reply = dialogue[position]?.turn;
  if (!reply || reply.speaker !== "TUTOR" || reply.purpose !== "EXPLANATION") return null;
  const asked = dialogue.slice(0, position).findLast((item) => item.turn.speaker === "LEARNER");
  if (!asked || retried(asked.turnIndex)) return null;
  const seconds = Math.round((Date.parse(reply.at) - Date.parse(asked.turn.at)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

type Cited = { material: string; location: string };
/**
 * Every source a skill's conversations cite, once each, for the rail's Taught from card: each lesson's or task's own
 * sources, then those its tutor replies cite. A material and location cited again is listed only the first time.
 */
export function citedSources<C extends Cited>(sessions: readonly { citations: readonly C[]; dialogue: readonly { turn: { speaker: string; citations: readonly C[] } }[] }[]): C[] {
  const seen = new Set<string>(), out: C[] = [];
  const add = (citation: C) => {
    const key = `${citation.material}\n${citation.location}`;
    if (!seen.has(key)) { seen.add(key); out.push(citation); }
  };
  for (const session of sessions) {
    session.citations.forEach(add);
    for (const item of session.dialogue) if (item.turn.speaker === "TUTOR") item.turn.citations.forEach(add);
  }
  return out;
}

type MarkStorage = Pick<Storage, "getItem" | "setItem">;

/** The browser's local storage, or null when it is blocked. */
export function localStore(): MarkStorage | null {
  try { return window.localStorage; } catch { return null; }
}

/**
 * Lesson questions this browser saw waiting without a reply, as "session:turnIndex". A reply that comes later came
 * from a retry, so its saved times measure the wait as well as the answer. The marks stay in local storage, so a
 * reload still knows, and only the newest `limit` are kept. A browser that never saw the question waiting cannot know.
 */
export class UnansweredQuestions {
  private static readonly key = "stillgotit-unanswered-questions";
  private readonly marks: string[];
  constructor(private readonly storage: MarkStorage | null, private readonly limit = 200) {
    let saved: unknown = [];
    try { saved = JSON.parse(storage?.getItem(UnansweredQuestions.key) ?? "[]"); } catch { /* Only this class writes the entry; an unreadable one starts empty. */ }
    this.marks = Array.isArray(saved) ? saved.filter((item): item is string => typeof item === "string") : [];
  }

  /** Every saved mark, oldest first. */
  list(): string[] { return [...this.marks]; }

  /** Saves a mark. The page keeps working when storage is blocked or full; the mark then lasts until reload. */
  add(mark: string): void {
    if (this.marks.includes(mark)) return;
    this.marks.push(mark);
    this.marks.splice(0, Math.max(0, this.marks.length - this.limit));
    try { this.storage?.setItem(UnansweredQuestions.key, JSON.stringify(this.marks)); } catch { /* Kept in memory only. */ }
  }
}
