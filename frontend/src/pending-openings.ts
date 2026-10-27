/**
 * Lesson openings still on their way, by skill. A new lesson is saved with the learner's request first, and the study
 * page then asks the tutor for its opening explanation. The wait is kept here, outside the page, because the page can be
 * made again while the opening is still coming: the shell keeps the study pages of a few skills and drops older ones,
 * and switching courses drops them all. A page made again finds the wait here and shows the request with the tutor's
 * dots until the answer lands, instead of a page that only says it is working.
 * A reload of the whole browser page forgets the wait. The server still finishes the opening, and the page's first read
 * waits for it, so the lesson has its explanation when the learner opens it.
 */
export interface PendingOpening<T = unknown> {
  /** The lesson whose opening is on its way. */
  lesson: string;
  /** The learner's request the lesson was saved with, shown while the opening is on its way. */
  request: string;
  /** When the opening was asked for, in milliseconds since the epoch. */
  since: number;
  /** Settles with the request for the opening: its answer once the opening is saved, or its failure. */
  done: Promise<T>;
}

const openings = new Map<string, PendingOpening>();

/** Asks for the opening of `lesson` in `skill` with `ask`, recording it as on its way until the answer settles. */
export function trackOpening<T>(skill: string, lesson: string, request: string, ask: () => Promise<T>): Promise<T> {
  const done = ask(), entry: PendingOpening<T> = { lesson, request, since: Date.now(), done };
  openings.set(skill, entry);
  const forget = () => { if (openings.get(skill) === entry) openings.delete(skill); };
  done.then(forget, forget);
  return done;
}

/** The opening still on its way in `skill`, if there is one. */
export function pendingOpening(skill: string): PendingOpening | undefined {
  return openings.get(skill);
}
