/**
 * What the lesson page offers, in place of the message box, for a finished lesson (design/compositions/Learning.md,
 * "Continuing a finished lesson"). A learner can continue a finished lesson: the server reopens it, and the next
 * question is answered in the same conversation. An archived lesson is read-only until it is restored, so the page
 * offers "Restore conversation" for it instead, and a practice task never reopens.
 */
export type FinishedLessonOffer = "continue" | "sources-gone";

/** The parts of a saved session this needs, as /learning/read returns them. */
export type FinishedLessonSession = { lesson: object | null; status: "OPEN" | "CLOSED"; materials: readonly string[] };

/**
 * "continue" for a finished lesson the learner can continue; "sources-gone" for a finished lesson whose every material
 * was deleted, where the tutor could not answer a new question, so the page explains that and offers only a new
 * conversation; null for everything else: an open conversation, a practice task, or an archived conversation.
 * `deleted` holds the course materials the learner deleted.
 */
export function finishedLessonOffer(session: FinishedLessonSession, archived: boolean, deleted: ReadonlySet<string>): FinishedLessonOffer | null {
  if (!session.lesson || session.status !== "CLOSED" || archived) return null;
  const sourcesGone = session.materials.length > 0 && session.materials.every((material) => deleted.has(material));
  return sourcesGone ? "sources-gone" : "continue";
}
