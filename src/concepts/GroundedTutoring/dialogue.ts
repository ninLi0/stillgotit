import type { Material } from "./GroundedTutoring.ts";
import type { MediaList } from "./media.ts";

export type Session = string & { readonly __brand: "TutoringSession" };
export type Mode = "GUIDED" | "CHECK";
export type Channel = "TEXT" | "VOICE";
export type SessionStatus = "OPEN" | "CLOSED";
export interface PassageRef { material: Material; location: string }
export type PassageSet = readonly PassageRef[];
export type MaterialSet = readonly Material[];
export interface DialogueTurn {
  speaker: "LEARNER" | "TUTOR";
  purpose: "RESPONSE" | "EXPLANATION" | "HINT" | "CORRECTION";
  text: string;
  media: MediaList;
  channel: Channel;
  citations: PassageSet;
  at: Date;
  correctionTarget?: number;
}
export interface SessionDocument<Learner extends string, Topic extends string, Definition extends string> {
  _id: Session; owner: Learner; topic: Topic; definition: Definition;
  kind: "LESSON" | "PRACTICE"; status: SessionStatus; materials: Material[]; citations: PassageRef[];
  dialogue: DialogueTurn[]; checkedVoiceTurns: number[]; revision: number;
  attemptReview?: { dialogueLength: number; unseen: boolean; outsideHelp: boolean };
  request?: string; explanation?: string; question?: string; criteria?: string; mode?: Mode; fresh?: boolean; hintRequested?: boolean;
}

export function effectiveVoice(record: { dialogue: DialogueTurn[]; checkedVoiceTurns: number[] }) {
  return record.dialogue.flatMap((turn, turnIndex) => {
    if (turn.speaker !== "LEARNER" || turn.purpose !== "RESPONSE" || turn.channel !== "VOICE") return [];
    const correction = record.dialogue.findLast((item) => item.speaker === "LEARNER" && item.purpose === "CORRECTION" && item.correctionTarget === turnIndex);
    return [{ turnIndex, text: correction?.text ?? turn.text, confirmed: record.checkedVoiceTurns.includes(turnIndex) }];
  });
}
