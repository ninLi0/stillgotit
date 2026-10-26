import { shallowRef } from "vue";
import type { StillGotItHttp } from "../../generated/wire.ts";

/** One open lesson or practice task, as /learning/continue answers it. */
export type OpenSession = StillGotItHttp["/learning/continue"]["output"]["sessions"][number];

/**
 * The order Home's Continue card shows: sessions with a turn first, latest turn first, then sessions with no turn yet,
 * most recently started first. The server answers in session identity order, which is the order sessions were started.
 */
export function continueOrder(sessions: readonly OpenSession[]): OpenSession[] {
  const started = sessions.map((session, index) => ({ session, index }));
  return started.sort((a, b) => {
    const at = a.session.lastActive ? Date.parse(a.session.lastActive) : null, bt = b.session.lastActive ? Date.parse(b.session.lastActive) : null;
    if (at !== null && bt !== null) return bt - at || b.index - a.index;
    if (at !== null || bt !== null) return at !== null ? -1 : 1;
    return b.index - a.index;
  }).map(({ session }) => session);
}

const STUDY_TIME_ZONE = "America/New_York";
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: STUDY_TIME_ZONE });
const timeOfDay = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: STUDY_TIME_ZONE });
const shortDay = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: STUDY_TIME_ZONE });

/** "Last active today at 3:05 PM" or "Last active Oct 24"; for a session with no turn, what it is waiting for. */
export function activityLabel(session: Pick<OpenSession, "kind" | "lastActive">, now = new Date()): string {
  if (!session.lastActive) return session.kind === "LESSON" ? "No questions yet" : "No answer yet";
  const at = new Date(session.lastActive);
  return dayKey.format(at) === dayKey.format(now) ? `Last active today at ${timeOfDay.format(at)}` : `Last active ${shortDay.format(at)}`;
}

// The session a Continue row asked to open, until the study page of its skill shows it. The shell opens the skill as
// the tree's "Open lesson" does; the study page then takes this request for its own skill.
type Session = OpenSession["studySession"];
const requested = shallowRef<{ skill: string; session: Session } | null>(null);
/** Watched by the study page, so a page that is already open switches to the requested session. */
export const sessionRequest = requested;
export function requestSession(skill: string, session: Session) { requested.value = { skill, session }; }
/** The session requested for `skill`, taken once; null when none is waiting for this skill. */
export function takeSession(skill: string): Session | null {
  const request = requested.value;
  if (!request || request.skill !== skill) return null;
  requested.value = null;
  return request.session;
}
