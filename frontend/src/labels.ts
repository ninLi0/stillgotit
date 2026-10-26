/** Display labels for stored values. They change only what people read; saved values stay as they are. */
import { placeLabel } from "./locations.ts";

const STUDY_TIME_ZONE = "America/New_York";
const dayFormat = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: STUDY_TIME_ZONE });

/** A plan day such as "2026-10-23" as "Fri, Oct 23". Plan days are calendar days in New York. */
export function planDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  // Noon UTC falls on the same calendar day in New York, so the weekday and date stay correct.
  if (match) return dayFormat.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
  const time = Date.parse(day);
  return Number.isNaN(time) ? day : dayFormat.format(new Date(time));
}

/** Assessment results as the learner reads them. */
export const resultLabels: Record<string, string> = {
  INDEPENDENT: "Independent success", SUPPORTED: "Success with help", SLIP: "Small execution error",
  GAP: "Needs more understanding", UNCERTAIN: "More evidence needed",
};

/** "Today" for the current plan day; otherwise the readable date. */
export function planDayLabel(day: string, today: string): string {
  return day === today ? "Today" : planDay(day);
}

/**
 * A citation as readable text: the material title and the place label of its location, such as
 * "Lecture 4 · Page 3" or "Lecture recording · 12:30–12:45". locations.ts reads the place from the location.
 */
export function sourceLabel(location: string, materialTitle?: string): string {
  return `${materialTitle?.trim() || "Course material"} · ${placeLabel(location)}`;
}

/** A wait in whole seconds, such as "7 s", or "2 min 5 s" from a minute up. */
export function secondsLabel(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds)), minutes = Math.floor(whole / 60), rest = whole % 60;
  return minutes ? `${minutes} min${rest ? ` ${rest} s` : ""}` : `${whole} s`;
}

/** How many sources one answer cites: "1 source", "2 sources". */
export function sourcesLabel(count: number): string {
  return `${count} ${count === 1 ? "source" : "sources"}`;
}

/**
 * Sidebar names for a skill's conversations: "Lesson 1", "Lesson 2", … and "Practice 1", … counted separately.
 * Sessions arrive in the order they were started, so a new conversation never renumbers an earlier one.
 */
export function sessionLabels(sessions: readonly { session: string; lesson: unknown }[]): Record<string, string> {
  let lessons = 0, practice = 0;
  return Object.fromEntries(sessions.map((item) => [item.session, item.lesson ? `Lesson ${++lessons}` : `Practice ${++practice}`]));
}
