// The day a skill is due for review (design/compositions/LearningReads.md, "The review day"). The plan request
// (planRequest in learning.ts) and the memory read (reviewDay in memory.ts) both turn MasteryEstimating's due instant into
// a day with dueDay, so the Plan and the Memory view name the same day for it. The instant itself is the concept's: its
// reference point, the latest event of any kind including a manual adjustment, plus the memory's stability in days. These
// functions read nothing and compute no memory; they only place instants on calendar days.
//
// Days are calendar days in America/New_York, the study time zone, as the planning concept counts them. They are never
// counted as spans of 24 hours, because two such spans can end on the same New York date, or skip one, when they cross a
// change of daylight saving time.

const DAY = 86_400_000;

/** The study date, the calendar day in America/New_York written YYYY-MM-DD, on which an instant falls. */
export const studyDate = (at: Date) => new Date(at).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

/** A study date moved by whole calendar days. A study date has no time of day, so the arithmetic runs in UTC. */
export const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * DAY).toISOString().slice(0, 10);

/** The whole calendar days from one study date to another: 0 for the same day, 1 for the next. */
export const daysFrom = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY);

/** A study date, or `today` when that date has already passed. */
export const notBefore = (day: string, today: string) => (day < today ? today : day);

/** The review day of a due instant: the study date the instant falls on, or `today` when that date has already passed. */
export const dueDay = (due: Date, today: string) => notBefore(studyDate(due), today);
