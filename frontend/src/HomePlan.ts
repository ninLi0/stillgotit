import { computed, ref, shallowRef } from "vue";
import { api, unwrap } from "./api.ts";
import type { OpenSession } from "./continue-session.ts";
import { planDay } from "./labels.ts";
import { beginRefusal, daysUntil, failureMessage, PlanningFailure, settle, type PlanRead } from "./planning.ts";

/**
 * The plan as Home shows it: the next activity in the hero panel, today's minutes in the sidebar, the nearest exam on
 * the scene's sign, and each skill's status pill. Start and Skip use the same planning actions and refusal sentences as
 * the planner (StudyPlanner.vue), so a refused start still explains which rule applied. Home also lists the open lessons
 * and practice tasks the learner can continue; they are read whenever the plan is.
 */
export function useHomePlan(course: string) {
  const plan = shallowRef<PlanRead | null>(null), busy = ref(false), error = ref(""), notice = ref("");
  const data = computed(() => plan.value?.data ?? null);
  const next = computed(() => data.value?.next ?? null);
  const today = computed(() => data.value?.today ?? "");

  async function read() { plan.value = settle(await api.planning.read({ course })); }
  /** The open lessons and practice tasks for the Continue card. */
  const sessions = shallowRef<readonly OpenSession[]>([]);
  async function readSessions() { sessions.value = unwrap(await api.learning.continue({ course })).sessions; }
  /**
   * A background read of the plan and the open sessions. A plan failure shows its sentence but keeps the last plan on
   * screen. A failed sessions read keeps the last list; the plan's message already reports a lost connection.
   */
  async function load() {
    await Promise.all([read().catch((problem) => { error.value = failureMessage(problem); }), readSessions().catch(() => undefined)]);
  }

  // Why Start is unavailable, in the planner's words. Empty when it is available.
  const startReason = computed(() => {
    const item = next.value, day = today.value;
    if (!item || !day) return "";
    if (item.status === "IN_PROGRESS") return "This review is in progress. Record your time in Plan when you finish.";
    if (item.day > day) return `Scheduled for ${planDay(item.day)}. You can start it that day.`;
    if (item.day < day) return "This review was scheduled for an earlier day. Mark it missed or update the plan.";
    const left = data.value?.budget?.remainingMinutes;
    return typeof left === "number" && item.candidate.minutes > left ? `This review needs about ${item.candidate.minutes} minutes and ${Math.max(0, Math.round(left))} are left today. Raise your daily budget or update the plan.` : "";
  });

  async function act(work: () => Promise<string>) {
    busy.value = true; error.value = ""; notice.value = "";
    try { notice.value = await work(); } catch (problem) { error.value = failureMessage(problem); }
    finally { busy.value = false; }
  }
  /** Begins the next activity and opens its skill. A bare refusal is explained from a fresh read. */
  async function start(open: (skill: string) => void) {
    const item = next.value; if (!item) return;
    await act(async () => {
      try { settle(await api.planning.begin({ course, item: item.item })); }
      catch (problem) {
        let failed: unknown = null;
        try { await read(); } catch (again) { failed = again; }
        if (!(problem instanceof PlanningFailure && problem.bare)) throw problem;
        if (failed) throw failed;
        throw new PlanningFailure(beginRefusal(item.item, data.value!));
      }
      open(item.candidate.subject); await read();
      return "Review started. Record your time in Plan when you finish.";
    });
  }
  async function miss() {
    const item = next.value; if (!item) return;
    await act(async () => { settle(await api.planning.miss({ course, item: item.item })); await read(); return "Marked as missed. This does not lower your mastery estimate."; });
  }

  /** Today's minutes against the daily budget, or null before a budget is set. */
  const minutes = computed(() => {
    const d = data.value; if (!d?.preferences) return null;
    const total = d.preferences.dailyMinutes, spent = Math.round(d.budget?.spentMinutes ?? 0);
    return { spent, total };
  });
  /** The nearest exam on or after today. */
  const exam = computed(() => {
    const day = today.value; if (!day || !plan.value) return null;
    const upcoming = plan.value.exams.filter((item) => item.date >= day).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!upcoming) return null;
    const days = daysUntil(upcoming.date, day) ?? 0;
    return { date: upcoming.date, days, covered: upcoming.covered.length };
  });
  /** Days from today to the exam, at most 6 posts, for the scene's path. */
  const days = computed(() => exam.value ? Math.max(1, Math.min(6, exam.value.days)) : 5);

  /** Each skill's open plan item (TODO or IN_PROGRESS) that comes first. */
  const nextBySkill = computed(() => {
    const out = new Map<string, string>();
    for (const item of data.value?.plan?.items ?? []) {
      if (item.status !== "TODO" && item.status !== "IN_PROGRESS") continue;
      const skill = item.candidate.subject, seen = out.get(skill);
      if (!seen || item.day < seen) out.set(skill, item.day);
    }
    return out;
  });

  return { plan, data, next, today, busy, error, notice, startReason, minutes, exam, days, nextBySkill, sessions, load, start, miss };
}
