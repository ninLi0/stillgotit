import type { StillGotItHttp } from "../../generated/wire.ts";

/** One conversation as /learning/recent answers it, newest activity first. */
export type RecentSession = StillGotItHttp["/learning/recent"]["output"]["sessions"][number];
export type RecentLabel = "Today" | "Yesterday" | "Earlier this week" | "Earlier";
export type RecentGroup<Row> = { label: RecentLabel; rows: Row[] };

// Days are calendar days in New York, the study time zone that labels.ts and the plan use.
const STUDY_TIME_ZONE = "America/New_York";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: STUDY_TIME_ZONE });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: STUDY_TIME_ZONE });
const shortDateYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: STUDY_TIME_ZONE });
const DAY = 86_400_000;

/** A calendar day "YYYY-MM-DD" moved by whole days. Noon UTC keeps the arithmetic on the same calendar day. */
function shiftDay(day: string, days: number) {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, date + days, 12)).toISOString().slice(0, 10);
}
function weekday(day: string) { return new Date(`${day}T12:00:00Z`).getUTCDay(); }

/**
 * The sidebar's conversations grouped by the day of their last activity, as ChatGPT groups its recent chats: Today,
 * Yesterday, Earlier this week (since Monday), and Earlier. Rows keep the order they arrive in, and empty groups are left
 * out. A row with no recorded activity, which only a session saved before start times were kept can have, is Earlier.
 */
export function recentGroups<Row extends { lastActivity: string | null }>(rows: readonly Row[], now = new Date()): RecentGroup<Row>[] {
  const today = dayKey.format(now), yesterday = shiftDay(today, -1), monday = shiftDay(today, -((weekday(today) + 6) % 7));
  const groups: RecentGroup<Row>[] = [{ label: "Today", rows: [] }, { label: "Yesterday", rows: [] }, { label: "Earlier this week", rows: [] }, { label: "Earlier", rows: [] }];
  for (const row of rows) {
    const time = row.lastActivity ? Date.parse(row.lastActivity) : NaN;
    const day = Number.isFinite(time) ? dayKey.format(time) : "";
    const group = !day ? 3 : day >= today ? 0 : day === yesterday ? 1 : day >= monday ? 2 : 3;
    groups[group]!.rows.push(row);
  }
  return groups.filter((group) => group.rows.length);
}

/** How long ago a time was, in the short form a sidebar row has room for: "now", "5 min", "3 h", "2 d", then "Oct 12". */
export function shortAgo(at: string | null, now = new Date()): string {
  const time = at ? Date.parse(at) : NaN;
  if (!Number.isFinite(time)) return "";
  const elapsed = Math.max(0, now.getTime() - time);
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min`;
  if (elapsed < DAY) return `${Math.floor(elapsed / 3_600_000)} h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d`;
  return dayKey.format(time).slice(0, 4) === dayKey.format(now).slice(0, 4) ? shortDate.format(time) : shortDateYear.format(time);
}
