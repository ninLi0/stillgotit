import { shallowRef } from "vue";
import type { StillGotItHttp } from "../../generated/wire.ts";

/** The record every tutor settings endpoint answers with: the offered models, the choice that applies, its status, and the default. */
export type TutorSettings = StillGotItHttp["/settings/tutor"]["output"]["settings"];
export type TutorModel = TutorSettings["models"][number];
export type TutorLevel = TutorModel["levels"][number];
/** The model and thinking level that wrote one tutor answer. */
export type TutorUsed = StillGotItHttp["/learning/lesson"]["output"]["tutor"];
type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];

/**
 * The latest settings record the page received. The Tutor panel reads it after sign-in and each time it opens.
 * The message box's tutor button and the answer labels show this record; it is empty until the first read answers.
 */
export const tutorSettings = shallowRef<TutorSettings | null>(null);

const levelOrder: readonly string[] = ["MINIMAL", "LOW", "MEDIUM", "HIGH"];
const levelNames: Record<string, string> = { MINIMAL: "Minimal", LOW: "Low", MEDIUM: "Medium", HIGH: "High" };

/** A thinking level as people read it, such as "Medium" for MEDIUM. */
export function levelName(level: string): string {
  return levelNames[level] ?? level;
}

/** A model's levels in the order Minimal, Low, Medium, High. */
export function orderedLevels(levels: readonly TutorLevel[]): TutorLevel[] {
  return [...levels].sort((a, b) => levelOrder.indexOf(a) - levelOrder.indexOf(b));
}

/**
 * A model's shown name from the latest record, such as "Gemini 3.8 Flash". A saved model that is no longer offered
 * is missing from the record, so its Gemini name is shown instead.
 */
export function modelName(model: string, settings: TutorSettings | null = tutorSettings.value): string {
  return settings?.models.find((offer) => offer.model === model)?.name ?? model;
}

/**
 * What the message box's tutor button shows for a settings record: the model and level that apply, in full, and the
 * sentence that names them for screen readers and the tooltip. Before the first read it shows "Tutor", and for a saved
 * choice that is no longer offered it asks the learner to choose again.
 */
export function tutorPick(settings: TutorSettings | null): { model: string; level: string; label: string } {
  if (!settings) return { model: "Tutor", level: "", label: "Choose the tutor model" };
  if (settings.status === "RETIRED") return { model: "Tutor: choose again", level: "", label: "Tutor: choose again. Your saved model is no longer offered." };
  const model = modelName(settings.choice.model, settings), level = levelName(settings.choice.level);
  return { model, level, label: `${model}, ${level} thinking. Choose the tutor model` };
}

/** The label under a tutor answer: "{model} · {level} thinking". */
export function tutorLabel(tutor: TutorUsed): string {
  return `${modelName(tutor.model)} · ${levelName(tutor.level)} thinking`;
}

// Each tutor answer names the model and thinking level that wrote it. The server does not store that, so the page labels
// only answers that arrive while it is open. `unwrap` notes the latest one, and the view that asked takes it when it
// shows the answer: the course page as soon as the suggestions arrive, and a skill page at the read that follows. If two
// views' requests finish at the same moment, a later note replaces an earlier one, so an answer can miss its label.
let latestTutor: TutorUsed | null = null;

/** Notes the model and level when a successful result is a tutor answer. Other results leave the note as it is. */
export function noteTutor(result: object): void {
  if (!("tutor" in result)) return;
  const tutor = result.tutor as Partial<TutorUsed> | null | undefined;
  if (typeof tutor?.model === "string" && typeof tutor.level === "string") latestTutor = { model: tutor.model, level: tutor.level };
}

/** Returns the noted model and level and clears the note, so one answer's label is never given to a later answer. */
export function takeTutor(): TutorUsed | null {
  const tutor = latestTutor;
  latestTutor = null;
  return tutor;
}

/** Names one answer on a skill page: a lesson explanation or practice task, a tutor turn, or a judgment. */
export function answerKey(kind: "session" | "turn" | "judgment", ...parts: (string | number)[]): string {
  return [kind, ...parts].join(":");
}

/**
 * The answers in `next` that `previous` did not have: new lessons and practice tasks, new tutor turns (replies and
 * hints), and new tutor judgments. The learner's own turns and corrections are never tutor answers.
 */
export function newAnswers(previous: SkillData, next: SkillData): string[] {
  const seen = new Set<string>();
  for (const session of previous.sessions) {
    seen.add(answerKey("session", session.session));
    for (const item of session.dialogue) seen.add(answerKey("turn", session.session, item.turnIndex));
  }
  for (const item of previous.cases) {
    if (item.judgment) seen.add(answerKey("judgment", item.judgment.judgment));
    for (const judgment of item.history) seen.add(answerKey("judgment", judgment.judgment));
  }
  const found: string[] = [];
  const add = (key: string) => { if (!seen.has(key)) found.push(key); };
  for (const session of next.sessions) {
    add(answerKey("session", session.session));
    for (const item of session.dialogue) if (item.turn.speaker === "TUTOR") add(answerKey("turn", session.session, item.turnIndex));
  }
  for (const item of next.cases) if (item.judgment?.origin === "AI") add(answerKey("judgment", item.judgment.judgment));
  return found;
}
