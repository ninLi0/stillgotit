/** Figures the lesson shows about the tutor's answers, read from the saved dialogue. */
type Turn = { speaker: string; purpose: string; at: string };

/**
 * How long a tutor reply took, in whole seconds: its server time minus that of the learner turn it answers, the latest
 * learner turn before it. Only lesson replies (EXPLANATION turns) answer a learner turn. A hint answers a request for
 * help, which the dialogue does not record, so a hint has no answer time. Null when the read cannot tell.
 */
export function answerSeconds(dialogue: readonly { turnIndex: number; turn: Turn }[], turnIndex: number): number | null {
  const position = dialogue.findIndex((item) => item.turnIndex === turnIndex), reply = dialogue[position]?.turn;
  if (!reply || reply.speaker !== "TUTOR" || reply.purpose !== "EXPLANATION") return null;
  const asked = dialogue.slice(0, position).findLast((item) => item.turn.speaker === "LEARNER")?.turn;
  if (!asked) return null;
  const seconds = Math.round((Date.parse(reply.at) - Date.parse(asked.at)) / 1000);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}
