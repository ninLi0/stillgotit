import type { MediaList } from "../../media.ts";

// `Material` is the concept's external source identity. Its content and access rules belong outside this concept,
// so the types below take it as a parameter, and the application binds it to the identity its material library issues.
export type Session = string & { readonly __brand: "TutoringSession" };
export type Mode = "GUIDED" | "CHECK";
export type Channel = "TEXT" | "VOICE";
export type SessionStatus = "OPEN" | "CLOSED";
export interface PassageRef<Material extends string = string> { material: Material; location: string }
export type PassageSet<Material extends string = string> = readonly PassageRef<Material>[];
export type MaterialSet<Material extends string = string> = readonly Material[];
export interface DialogueTurn<Material extends string = string> {
  speaker: "LEARNER" | "TUTOR";
  purpose: "RESPONSE" | "EXPLANATION" | "HINT" | "CORRECTION";
  text: string;
  media: MediaList;
  channel: Channel;
  citations: PassageSet<Material>;
  at: Date;
  correctionTarget?: number;
}
export interface SessionDocument<Learner extends string, Material extends string, Topic extends string, Definition extends string> {
  _id: Session; owner: Learner; topic: Topic; definition: Definition;
  kind: "LESSON" | "PRACTICE"; status: SessionStatus; materials: Material[]; citations: PassageRef<Material>[];
  dialogue: DialogueTurn<Material>[]; checkedVoiceTurns: number[]; revision: number;
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
