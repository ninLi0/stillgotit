import type { TutorRequest } from "../learning-data.ts";

/**
 * How the tutor writes a lesson answer: `plain` text, or `interactive`, which lets it add one interactive example
 * (src/answer-widgets.ts). The set is fixed in code, so it cannot change while the server runs.
 */
export type AnswerStyle = "plain" | "interactive";

/** The offered answer styles. */
export const ANSWER_STYLES: readonly AnswerStyle[] = Object.freeze(["plain", "interactive"]);

/** The style a learner has when they have chosen none: plain text, the tutor's answers as they were before examples. */
export const DEFAULT_ANSWER_STYLE: AnswerStyle = "plain";

/** Holds when style is exactly one of the offered answer styles, including case. */
export function answerStyleOffered({ style }: { style: string }): boolean {
  return (ANSWER_STYLES as readonly string[]).includes(style);
}

/** Names an offered answer style. Flows use it only after answerStyleOffered holds. */
export function offeredAnswerStyle({ style }: { style: string }): AnswerStyle {
  if (!answerStyleOffered({ style })) throw new Error("offeredAnswerStyle requires an offered answer style.");
  return style as AnswerStyle;
}

/** The answer style that applies when nothing is saved: plain text. */
export function defaultAnswerStyle(_input: Record<string, never>): AnswerStyle {
  return DEFAULT_ANSWER_STYLE;
}

/**
 * Marks a prepared lesson request for interactive examples when the style is `interactive`. With `plain`, the request
 * comes back unchanged, the same object with no new field, so a learner who never turned examples on sends exactly the
 * request they sent before.
 */
export function withAnswerStyle({ request, style }: { request: TutorRequest; style: AnswerStyle }): TutorRequest {
  if (!answerStyleOffered({ style })) throw new Error("A lesson request can use only an offered answer style.");
  if (request.kind !== "LESSON" && request.kind !== "REPLY") throw new Error("Only a lesson's opening and its replies can carry an answer style.");
  return style === "interactive" ? { ...request, style: "interactive" } : request;
}
