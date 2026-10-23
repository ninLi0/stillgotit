/** Display labels for stored values. They change only what people read; saved values stay as they are. */

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
 * A cited source location as readable text, such as "Lecture 4, page 1".
 * Locations look like `key/page/N`, `key/image`, `key/lines/A-B`, `key/cell/N`, `key/document`,
 * `key/slide/N`, or `key/sheet/NAME/rows/A-B` (see design/material-data.md). `content` means the material's full text.
 */
export function sourceLabel(location: string, materialTitle?: string): string {
  const title = materialTitle?.trim() || "Course material";
  const slash = location.indexOf("/");
  if (location === "content" || slash < 0) return title;
  const part = location.slice(slash + 1);
  let match: RegExpExecArray | null;
  if ((match = /^page\/(\d+)$/.exec(part))) return `${title}, page ${match[1]}`;
  if ((match = /^slide\/(\d+)$/.exec(part))) return `${title}, slide ${match[1]}`;
  if ((match = /^cell\/(\d+)$/.exec(part))) return `${title}, cell ${match[1]}`;
  if ((match = /^lines\/(\d+)-(\d+)$/.exec(part))) return `${title}, lines ${match[1]}–${match[2]}`;
  if ((match = /^sheet\/(.+)\/rows\/(\d+)-(\d+)$/.exec(part))) {
    return match[2] === "1" ? `${title}, sheet ${match[1]}` : `${title}, sheet ${match[1]}, rows ${match[2]}–${match[3]}`;
  }
  if ((match = /^time\/([\d:]+)-([\d:]+)$/.exec(part))) return `${title}, ${match[1]}–${match[2]}`;
  if (part === "image") return `${title}, image`;
  if (part === "document") return title;
  return `${title}, ${part.replaceAll("/", " ")}`;
}

/**
 * Sidebar names for a skill's conversations: "Lesson 1", "Lesson 2", … and "Practice 1", … counted separately.
 * Sessions arrive in the order they were started, so a new conversation never renumbers an earlier one.
 */
export function sessionLabels(sessions: readonly { session: string; lesson: unknown }[]): Record<string, string> {
  let lessons = 0, practice = 0;
  return Object.fromEntries(sessions.map((item) => [item.session, item.lesson ? `Lesson ${++lessons}` : `Practice ${++practice}`]));
}
