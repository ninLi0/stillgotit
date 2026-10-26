<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { api } from "./api.ts";
import { planDay, planDayLabel } from "./labels.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { beginRefusal, daysUntil, examProblem, examRefusal, failureMessage, PlanningFailure, removeRefusal, sentences, settle, tradeoffRefusal,
  type CourseSkill, type CourseUnit, type ExamInput, type PlanRead } from "./planning.ts";
import PlannerExams from "./PlannerExams.vue";
import TradeoffPanel from "./TradeoffPanel.vue";
import PlanSea from "./PlanSea.vue";
import PixelIcon from "./PixelIcon.vue";
import MasteryCells from "./MasteryCells.vue";
import InfoBubble from "./InfoBubble.vue";
// Where an error appears: the planner's message area, beside the next activity, or beside the exam form.
type Place = "top" | "activity" | "exams";
const props = defineProps<{ course: string; revision: number }>();
const emit = defineEmits<{ select: [skill: string] }>();
const current = shallowRef<PlanRead | null>(null), skills = shallowRef<CourseSkill[]>([]), units = shallowRef<CourseUnit[]>([]);
const minutes = ref(30), actualMinutes = ref(10), note = ref(""), busy = ref(false), error = ref(""), errorPlace = ref<Place>("top"), notice = ref("");
const noticeBox = ref<HTMLElement | null>(null), errorBox = ref<HTMLElement | null>(null), activityErrorBox = ref<HTMLElement | null>(null), settings = ref<HTMLDialogElement | null>(null);
const examsPanel = ref<InstanceType<typeof PlannerExams> | null>(null);
const data = computed(() => current.value?.data ?? null);
// The read lists zero or one pending proposal.
const proposal = computed(() => current.value?.proposal[0]);
// An activity error stays beside the activity; when the activity is gone it moves to the planner's message area.
const shownAt = computed<Place>(() => errorPlace.value === "activity" && !data.value?.next ? "top" : errorPlace.value);
async function saveSettings() { await save(); if (!error.value) settings.value?.close(); }
// Why a disabled action is unavailable. Empty when it is available.
const startReason = computed(() => {
  const next = data.value?.next, today = data.value?.today;
  if (!next || !today) return "";
  if (next.day > today) return `Scheduled for ${planDay(next.day)}. You can start it that day.`;
  if (next.day < today) return "This review was scheduled for an earlier day. Mark it missed or update the plan.";
  const left = data.value?.budget?.remainingMinutes;
  return typeof left === "number" && next.candidate.minutes > left ? `This review needs about ${next.candidate.minutes} minutes and ${Math.max(0, Math.round(left))} are left today. Raise your daily budget or update the plan.` : "";
});
const updateReason = computed(() => data.value?.next?.status === "IN_PROGRESS" ? "Finish or stop the current review first." : "");
const addExamReason = computed(() => !data.value?.preferences ? sentences.examBudget
  : skills.value.some((skill) => skill.status === "CONFIRMED") ? "" : "Confirm a skill first. An exam covers confirmed skills.");
// A cut names omitted work by its candidate key. Show that activity when a plan lists it, else the skill, else a plain label.
const cutRows = computed(() => {
  const read = current.value;
  if (!read) return [];
  const candidates = [...read.data.plan?.items ?? [], ...read.data.plan?.deferred ?? [], ...read.proposalItems].map((row) => row.candidate);
  const titles = new Map(skills.value.map((skill) => [skill.skill, skill.title]));
  return read.cuts.map(({ cut }) => ({ cut, label: candidates.find((candidate) => candidate.key === cut.candidateKey)?.activity ?? titles.get(cut.omittedScope) ?? (cut.omittedScope || "Exam preparation") }));
});
async function read() { const result = settle(await api.planning.read({ course: props.course })); current.value = result; if (result.data.preferences) { minutes.value = result.data.preferences.dailyMinutes; note.value = result.data.preferences.focusNote; } }
// The course's skills, for choosing what an exam covers and naming covered skills.
async function readCourse() { const result = settle(await api.courses.read({ course: props.course })); skills.value = result.skills; units.value = result.units; }
// After a failed change, read again so the screen shows saved state. Answers the re-read's own failure, or null.
async function reread(): Promise<unknown> { try { await read(); return null; } catch (problem) { return problem; } }
// The action returns the success message. Focus returns to the control the learner used, or to the message when that control is gone.
async function act(place: Place, action: () => Promise<string | void>) {
  const previous = focusedControl();
  busy.value = true; error.value = ""; notice.value = "";
  try { notice.value = (await action()) ?? ""; } catch (problem) { errorPlace.value = place; error.value = failureMessage(problem); }
  finally {
    busy.value = false; await nextTick();
    restoreFocus(previous, () => !error.value ? noticeBox.value : shownAt.value === "activity" ? activityErrorBox.value : shownAt.value === "exams" ? examsPanel.value?.alertBox() : errorBox.value);
  }
}
// Runs a change. A bare refusal is explained from a fresh read; any other failure still re-reads, since a lost answer may
// follow a saved change. `also` reads anything else the explanation needs.
async function change<T>(send: () => Promise<T>, explain: () => string, also: () => Promise<unknown> = async () => {}): Promise<T> {
  try { return await send(); } catch (problem) {
    const failed = await reread();
    if (!(problem instanceof PlanningFailure && problem.bare)) throw problem;
    if (failed) throw failed;
    await also().catch(() => {});
    throw new PlanningFailure(explain());
  }
}
// With a waiting proposal the plan has not changed yet, so the message says so.
const planOutcome = (saved: string) => proposal.value ? `${saved} A proposed plan is waiting for your decision.` : `${saved} Your plan is updated.`;
function examOutcome(saved: string, result: { refreshed: boolean; notice?: string }) { return result.refreshed ? planOutcome(saved) : `${saved} ${result.notice ?? sentences.refreshPending}`; }
// The first load is silent. After Try again the button is gone, so a message takes focus.
async function load(loaded = "") { await act("top", async () => { await Promise.all([read(), readCourse()]); return loaded; }); }
async function save() { await act("top", async () => { settle(await api.planning.configure({ course: props.course, dailyMinutes: minutes.value, focusNote: note.value })); await read(); return planOutcome("Daily budget saved."); }); }
async function start() {
  const next = data.value?.next; if (!next) return;
  await act("activity", async () => {
    await change(async () => settle(await api.planning.begin({ course: props.course, item: next.item })), () => beginRefusal(next.item, data.value!));
    emit("select", next.candidate.subject); await read();
    return "Review started. Come back here to record your time when you finish.";
  });
}
async function finish() { const item = data.value?.next?.item, spent = actualMinutes.value; if (item) await act("top", async () => { settle(await api.planning.finish({ course: props.course, item, actualMinutes: spent })); await read(); return `Review finished. ${spent} minutes recorded.`; }); }
async function stop() { const item = data.value?.next?.item, spent = actualMinutes.value; if (item) await act("top", async () => { settle(await api.planning.stop({ course: props.course, item, actualMinutes: spent })); await read(); return `Stopped for now. ${spent} minutes recorded.`; }); }
async function miss() { const item = data.value?.next?.item; if (item) await act("top", async () => { settle(await api.planning.miss({ course: props.course, item })); await read(); return "Marked as missed. This does not lower your mastery estimate."; }); }
async function propose() { await act("top", async () => { settle(await api.planning.propose({ course: props.course })); await read(); return proposal.value ? "A proposed plan is waiting for your decision." : "Plan updated from your progress."; }); }
// The page checks the concept's exam rules first, because an HTTP refusal does not carry its reason.
async function saveExam(input: ExamInput) {
  await act("exams", async () => {
    const problem = examProblem(input, data.value, skills.value);
    if (problem) throw new PlanningFailure(problem);
    const result = await change(async () => settle(await api.planning.exams.set({ course: props.course, date: input.date, covered: input.covered })),
      () => examRefusal(input, current.value!, skills.value), readCourse);
    await read(); examsPanel.value?.close();
    return examOutcome("Exam saved.", result);
  });
}
async function removeExam(date: string) {
  await act("exams", async () => {
    const result = await change(async () => settle(await api.planning.exams.remove({ course: props.course, date })), () => removeRefusal(date, current.value!));
    await read();
    return examOutcome("Exam removed.", result);
  });
}
async function decide(confirming: boolean) {
  const plan = proposal.value?.plan; if (!plan) return;
  const kept = data.value?.plan ? "Kept your current plan. Nothing was cut." : "Proposal declined. Nothing was cut, and no plan started.";
  await act("top", async () => {
    await change(async () => settle(confirming ? await api.planning.tradeoffs.confirm({ course: props.course, plan }) : await api.planning.tradeoffs.decline({ course: props.course, plan })),
      () => tradeoffRefusal(plan, proposal.value, confirming));
    await read();
    return confirming ? "Tradeoffs confirmed. Your plan is updated." : kept;
  });
}
// ---- Presentation for the Pixel Nature layout (design/revamp/README.md) ----
const BUDGETS = [15, 30, 45, 60];
const plannerNote = "A few minutes a day, within the budget you set. Each course has its own plan. Activity times and review intervals are initial estimates. Missing a review does not apply a mastery penalty.";
const savedBudget = computed(() => data.value?.preferences ? data.value.preferences.dailyMinutes : null);
const otherBudget = computed(() => savedBudget.value !== null && !BUDGETS.includes(savedBudget.value));
/** A segment saves that daily budget at once, with the saved focus note. "Other" opens the full study-time form. */
async function chooseBudget(value: number) { if (busy.value || value === savedBudget.value) return; minutes.value = value; await save(); }
function addDays(day: string, count: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + count, 12)).toISOString().slice(0, 10) : day;
}
type PlanItem = NonNullable<NonNullable<typeof data.value>["plan"]>["items"][number];
type Kind = "lesson" | "review" | "practice" | "prep";
function kindOf(item: { candidate: { activity: string; deadlineRefs: string[] } }): Kind {
  const activity = item.candidate.activity;
  return item.candidate.deadlineRefs.length ? "prep" : /^lesson/i.test(activity) ? "lesson" : /^review/i.test(activity) ? "review" : "practice";
}
// With a proposal waiting, an unfinished item it cuts or leaves out is shown with a dashed border.
const deferring = computed(() => {
  const read = current.value, out = new Set<string>();
  if (!read || !proposal.value) return out;
  const cut = new Set(read.cuts.map(({ cut }) => cut.candidateKey)), kept = new Set(read.proposalItems.map((row) => row.candidate.key));
  for (const item of read.data.plan?.items ?? []) if (item.status === "TODO" && (cut.has(item.candidate.key) || (kept.size > 0 && !kept.has(item.candidate.key)))) out.add(item.item);
  return out;
});
function meta(item: PlanItem) {
  const min = `${Math.round(item.candidate.minutes)} min`;
  if (item.status === "DONE") return `Done · ${Math.round(item.actualMinutes || item.candidate.minutes)} min`;
  if (item.status === "MISSED") return "Missed";
  if (item.status === "REPLACED") return "Replaced";
  if (item.status === "IN_PROGRESS") return `In progress · ${min}`;
  if (item.status === "STOPPED") return `Stopped · ${Math.round(item.actualMinutes)} min recorded`;
  if (data.value?.next?.item === item.item) return `Next up · ${min}`;
  if (deferring.value.has(item.item)) return `Would defer · ${min}`;
  return min;
}
const budgetMinutes = computed(() => data.value?.preferences?.dailyMinutes ?? 0);
const exams = computed(() => current.value?.exams ?? []);
const week = computed(() => {
  const today = data.value?.today; if (!today) return [];
  const items = data.value?.plan?.items ?? [];
  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(today, index), [dow = "", rest = ""] = planDay(day).split(", ");
    const dayItems = items.filter((item) => item.day === day);
    const total = dayItems.filter((item) => item.status !== "MISSED" && item.status !== "REPLACED").reduce((sum, item) => sum + item.candidate.minutes, 0);
    const exam = exams.value.find((row) => row.date === day);
    return { day, index, dow: index === 0 ? "Today" : dow, date: rest.split(" ")[1] ?? rest, label: planDay(day), items: dayItems, total: Math.round(total), exam };
  });
});
const examIndex = computed(() => { const hit = week.value.find((day) => day.exam); return hit ? hit.index : null; });
const seaExam = computed(() => examIndex.value === null ? null : week.value[examIndex.value]!);
// Plan items outside the seven days shown: earlier unfinished work and later days of the plan.
const outside = computed(() => {
  const days = new Set(week.value.map((day) => day.day));
  return (data.value?.plan?.items ?? []).filter((item) => !days.has(item.day));
});
// The week is drawn on the sea: the columns are measured so the boat, buoys and lighthouse sit at each day's horizon.
const weekList = ref<HTMLElement | null>(null), seaGeo = ref<{ width: number; height: number; horizon: number; centers: number[] }>({ width: 0, height: 0, horizon: 0, centers: [] });
let weekObserver: ResizeObserver | undefined;
function measureWeek() {
  const list = weekList.value; if (!list) { seaGeo.value = { width: 0, height: 0, horizon: 0, centers: [] }; return; }
  const base = list.getBoundingClientRect().left;
  const centers = Array.from(list.querySelectorAll<HTMLElement>(":scope > .day")).map((el) => { const box = el.getBoundingClientRect(); return box.left - base + box.width / 2; });
  const width = Math.max(list.clientWidth, list.scrollWidth), height = list.offsetHeight;
  const line = list.querySelector<HTMLElement>(":scope > .day > .horizon"), top = list.getBoundingClientRect().top;
  const horizon = line ? Math.round(line.getBoundingClientRect().top - top + line.offsetHeight * 0.55) : 0;
  const same = width === seaGeo.value.width && height === seaGeo.value.height && horizon === seaGeo.value.horizon && centers.length === seaGeo.value.centers.length && centers.every((c, i) => Math.abs(c - seaGeo.value.centers[i]!) <= 0.5);
  if (!same) seaGeo.value = { width, height, horizon, centers };
}
watch(weekList, (list) => { weekObserver?.disconnect(); weekObserver = undefined; if (list) { weekObserver = new ResizeObserver(measureWeek); weekObserver.observe(list); measureWeek(); } }, { flush: "post" });
watch(week, () => { void nextTick(measureWeek); }, { flush: "post" });
onBeforeUnmount(() => weekObserver?.disconnect());
function loadPct(total: number) { return budgetMinutes.value > 0 ? Math.min(100, total / budgetMinutes.value * 100) : 0; }
function dayName(day: string) { const away = data.value ? daysUntil(day, data.value.today) : null; return away === 0 ? "Today" : planDay(day); }
/** The shell's way in to the daily budget: the study-time dialog, the same one the "Other" segment opens. */
function openBudget() { if (settings.value && !settings.value.open) settings.value.showModal(); }
defineExpose({ openBudget });
onMounted(() => load());
// Progress changes elsewhere refresh the plan and skills without clearing the message from the learner's last plan action.
watch(() => props.revision, () => Promise.all([read(), readCourse()]).catch((problem) => { errorPlace.value = "top"; error.value = failureMessage(problem); }));
</script>
<template>
  <section class="planner" :aria-busy="busy">
    <div class="plan-head">
      <div class="plan-title"><PixelIcon name="calendar" :size="28" /><h2>This week</h2><InfoBubble :text="plannerNote" label="How the plan works" /></div>
      <div v-if="data" class="daily-time"><span id="daily-time-label" class="daily-label">Daily time</span>
        <div class="segments" role="group" aria-labelledby="daily-time-label">
          <button v-for="value in BUDGETS" :key="value" type="button" class="segment" :class="{ on: savedBudget === value }" :aria-pressed="savedBudget === value" :disabled="busy" @click="chooseBudget(value)">{{ value }} min</button>
          <button type="button" class="segment other" :class="{ on: otherBudget }" :aria-pressed="otherBudget" aria-haspopup="dialog" :disabled="busy" @click="settings?.showModal()">{{ otherBudget ? `${savedBudget} min` : 'Other' }}</button>
        </div>
      </div>
    </div>
    <div role="alert"><p v-if="error && shownAt === 'top'" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div><div role="status"><p v-if="notice" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
    <p v-if="!data && !error" class="hint loading">Loading your plan…</p><button v-if="!data && error && !busy" type="button" class="secondary ocean retry-load" @click="load('Your plan is loaded.')">Try again</button>
    <p v-if="data && !data.preferences" class="budget-row">Set a daily study time for this course to get a plan. <button type="button" class="link-button" @click="settings?.showModal()">Set study time</button></p>
    <Teleport to="body"><dialog ref="settings" class="settings-dialog" aria-labelledby="settings-title"><form class="settings-form" @submit.prevent="saveSettings"><h3 id="settings-title">Study time</h3><p class="hint">For this course only. Each course has its own plan.</p><label>Minutes a day<input v-model.number="minutes" type="number" min="0" max="1440" step="1" required :disabled="busy" /></label><label>Focus note<input v-model="note" maxlength="300" :disabled="busy" placeholder="Optional, for example: matrix products" /></label><div class="dialog-actions"><button type="button" class="quiet" @click="settings?.close()">Cancel</button><button class="primary ocean" :disabled="busy">Save</button></div></form></dialog></Teleport>
    <TradeoffPanel v-if="data && proposal" :proposal="proposal" :items="current!.proposalItems" :cuts="cutRows" :today="data.today" :has-active-plan="!!data.plan" :busy="busy" @confirm="decide(true)" @decline="decide(false)" />
    <div v-if="data?.next" class="next">
      <div class="next-body"><p class="eyebrow next-eyebrow">Next up · {{ planDayLabel(data.next.day, data.today) }} · {{ data.next.candidate.minutes }} min</p><h3>{{ data.next.candidate.activity }}</h3><p class="next-reason">{{ data.next.candidate.reason }}</p><p class="sr-only">About {{ data.next.candidate.minutes }} minutes</p></div>
      <div class="next-actions">
        <template v-if="data.next.status === 'IN_PROGRESS'"><p class="hint">In progress. Record actual time when you finish or stop.</p><label class="spent">Minutes spent<input v-model.number="actualMinutes" type="number" min="0" step="0.5" :disabled="busy" /></label><div class="actions"><button class="primary ocean" :disabled="busy" @click="finish">Finish review</button><button class="quiet" :disabled="busy" @click="stop">Stop for now</button></div></template>
        <template v-else><div class="actions"><button class="primary ocean" :disabled="busy || !!startReason" :aria-describedby="startReason ? 'start-reason' : undefined" @click="start">Start review</button><button v-if="data.next.day <= data.today" class="quiet" :disabled="busy" @click="miss">{{ data.next.day === data.today ? 'Missed today' : 'Mark as missed' }}</button><p v-if="startReason" id="start-reason" class="hint reason">{{ startReason }}</p></div></template>
        <div role="alert"><p v-if="error && shownAt === 'activity'" ref="activityErrorBox" class="error activity-error" tabindex="-1">{{ error }}</p></div>
      </div>
    </div><p v-else-if="data?.preferences" class="hint no-next">No review is scheduled. Update the plan after adding skills or completing practice.</p>
    <section v-if="data?.preferences" class="week-card" aria-label="This week">
    <div class="week-bar">
      <p v-if="data.budget" class="budget">{{ Math.round(data.budget.remainingMinutes) }} min left today <span>· {{ Math.round(data.budget.spentMinutes) }} min recorded</span></p><span v-else />
      <div class="update-wrap"><button class="secondary ocean update-plan" :disabled="busy || !!updateReason" :aria-describedby="updateReason ? 'update-reason' : undefined" @click="propose">Update plan</button><p v-if="updateReason" id="update-reason" class="hint reason">{{ updateReason }}</p></div>
    </div>
    <div class="week-scroll">
      <div class="voyage">
      <PlanSea class="sea" :exam-day="examIndex" :exam-title="seaExam ? 'Exam' : undefined" :exam-date="seaExam?.label" :width="seaGeo.width || undefined" :height="seaGeo.height || undefined" :centers="seaGeo.centers" :horizon="seaGeo.horizon" />
      <ol ref="weekList" class="week" aria-label="This week's plan">
        <li v-for="day in week" :key="day.day" class="day" :class="{ today: day.index === 0, exam: !!day.exam }" :aria-label="day.index === 0 ? `Today, ${day.label}` : day.label">
          <div class="day-top"><span class="dow" aria-hidden="true">{{ day.dow }}</span><span class="date" aria-hidden="true">{{ day.date }}</span></div>
          <div class="horizon" aria-hidden="true" />
          <div v-if="!day.exam" class="load"><MasteryCells :value="loadPct(day.total)" :cells="6" on="#1E6F96" off="#CFE7F2" :height="5" :label="`${day.total} of ${budgetMinutes} minutes planned`" /><span class="load-text">{{ day.total }} of {{ budgetMinutes }} min</span></div>
          <div v-else class="exam-mark"><span class="exam-title"><PixelIcon name="lighthouse" :size="22" /> Exam</span><span class="exam-covers">Covers {{ day.exam.covered.length }} {{ day.exam.covered.length === 1 ? 'skill' : 'skills' }}</span></div>
          <ul v-if="day.items.length" class="items">
            <li v-for="item in day.items" :key="item.item" class="item" :class="[kindOf(item), { next: data.next?.item === item.item, done: item.status === 'DONE', missed: item.status === 'MISSED' || item.status === 'REPLACED', deferring: deferring.has(item.item) }]">
              <span class="item-title"><span class="type-square" aria-hidden="true" />{{ item.candidate.activity }}</span>
              <span class="item-meta">{{ meta(item) }}</span>
            </li>
          </ul>
        </li>
      </ol>
      </div>
    </div>
    </section>
    <div v-if="data" class="below">
      <PlannerExams ref="examsPanel" :exams="current!.exams" :skills="skills" :units="units" :today="data.today" :busy="busy" :add-reason="addExamReason" :error="error && shownAt === 'exams' ? error : ''" @save="saveExam" @remove="removeExam" />
      <section v-if="data.plan" class="deferred" aria-labelledby="deferred-title">
        <h3 id="deferred-title">Doesn't fit this week</h3>
        <ul v-if="data.plan.deferred.length" class="rows"><li v-for="(item, index) in data.plan.deferred" :key="index"><span>{{ item.candidate.activity }}</span><span class="row-min">{{ item.candidate.minutes }} min</span></li></ul>
        <p v-else class="hint">Everything in your plan fits.</p>
        <template v-if="outside.length">
          <h4>Outside this week</h4>
          <ul class="rows"><li v-for="item in outside" :key="item.item"><span>{{ dayName(item.day) }} · {{ item.candidate.activity }} · {{ item.status.toLowerCase().replaceAll('_', ' ') }}</span><span class="row-min">{{ item.candidate.minutes }} min</span></li></ul>
        </template>
      </section>
    </div>
  </section>
</template>
<style scoped>
.planner{max-width:1220px;margin:0 auto;padding:30px 40px 56px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.plan-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:12px}
.plan-title{display:flex;align-items:center;gap:10px;flex:none}
.plan-title h2{margin:0;font-family:var(--font-display);font-weight:400;font-size:22px;white-space:nowrap}
.daily-time{display:flex;align-items:center;gap:10px}
.daily-label{font-size:13px;color:var(--muted);white-space:nowrap}
.segments{display:flex;padding:3px;border-radius:12px;background:#ECECE9}
.segment{white-space:nowrap;border:0;border-radius:9px;padding:6px 12px;min-height:32px;font-size:13px;font-weight:700;background:transparent;color:var(--muted)}
.segment:hover:not(:disabled){color:var(--ink)}
.segment.on{background:#FFFFFF;color:var(--ink);box-shadow:0 1px 2px rgba(20,20,20,.12)}
.segment.other:not(.on){font-weight:600}
.budget-row{margin:2px 0 12px;font-size:14px;color:var(--muted)}
.link-button{border:0;background:none;padding:0;font:inherit;font-weight:700;color:var(--ocean-soft-text);text-decoration:underline;text-underline-offset:3px}
.loading{margin:4px 0 0}.retry-load{margin:10px 0;min-height:36px;font-size:13px}
.error,.notice{margin:0 0 12px}
.no-next{margin:14px 0 0}
/* Next activity, with its actions */
.next{margin-top:14px;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;padding:16px 20px;border-radius:18px;background:#FFFFFF;border:2px solid #E3A233}
.next-eyebrow{color:#8A5A12}
.next h3{margin:4px 0 4px;font-family:var(--font-display);font-weight:400;font-size:20px;line-height:1.25;overflow-wrap:anywhere}
.next-reason{margin:0;font-size:13px;color:var(--muted)}
.next-actions{display:flex;flex-direction:column;align-items:flex-end;gap:6px}
.next-actions .hint{margin:0;font-size:12px}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:14px}
.actions .primary{min-height:42px;padding:0 16px;font-size:14px}
.spent{display:flex;align-items:center;gap:8px;margin:0;font-size:13px}
.spent input{width:80px;min-height:34px;padding:4px 8px;border-radius:10px}
.activity-error{margin:8px 0 0!important}
/* The week at sea: one picture where each day is a column of the water. */
.week-card{margin-top:16px}
.week-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 4px}
.budget{margin:0;font-size:13px;font-weight:700}
.budget span{font-weight:500;color:var(--muted)}
.update-plan{min-height:34px;padding:0 14px;font-size:13px}
.week-scroll{overflow-x:auto;margin-top:10px;padding-bottom:4px}
.voyage{position:relative;border-radius:22px;overflow:hidden;border:1px solid #CFE7F2;background:#9BD7EC}
.sea{position:absolute;left:0;top:0;height:100%;border:0;border-radius:0}
.week{position:relative;z-index:1;list-style:none;margin:0;padding:26px 12px 16px;display:grid;grid-template-columns:repeat(7,minmax(128px,1fr));gap:10px}
.day{display:flex;flex-direction:column;align-items:stretch;gap:8px;min-height:300px;min-width:0;padding:6px;border-radius:14px;color:var(--ink)}
.day.today{background:rgba(255,255,255,.26);box-shadow:inset 0 0 0 2px rgba(255,255,255,.85)}
.day-top{align-self:flex-start;display:flex;align-items:baseline;gap:8px;padding:3px 10px 4px;background:#E9D6A8;box-shadow:inset 0 -2px 0 #CDB884,0 0 0 2px #C08324}
.day.today .day-top{background:#FFF1C9;box-shadow:inset 0 -2px 0 #E7C676,0 0 0 2px #C08324}
.day.exam .day-top{background:#1E6F96;color:#FFFFFF;box-shadow:inset 0 -2px 0 #15516E,0 0 0 2px #0D3F58}
.dow{font-family:var(--font-display);font-size:11px;letter-spacing:1px;text-transform:uppercase}
.date{font-family:var(--font-display);font-size:20px;line-height:1}
.horizon{height:58px;flex:none}
.load{display:flex;flex-direction:column;gap:4px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.88)}
.load :deep(.mastery-cells){max-width:none}
.load-text{font-size:11px;font-weight:600;color:#1E5B78}
.exam-mark{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-radius:8px;background:#1E6F96;color:#FFFFFF}
.exam-title{display:flex;align-items:center;gap:6px;font-family:var(--font-display);font-size:18px}
.exam-covers{font-size:11px;font-weight:600;opacity:.9}
.items{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.item{display:flex;flex-direction:column;gap:6px;padding:8px 9px;border-radius:8px;border:1px solid rgba(13,63,88,.14);box-shadow:0 2px 0 rgba(13,63,88,.22);color:var(--ink);animation:sgRise var(--dur-enter) var(--ease-enter) both}
.item-title{font-size:12px;font-weight:650;line-height:1.35;text-wrap:pretty;overflow-wrap:anywhere}
.type-square{display:inline-block;width:7px;height:7px;margin:0 6px 1px 0;vertical-align:middle}
.item-meta{font-size:11px;font-weight:600;line-height:1.35;color:var(--muted);overflow-wrap:anywhere}
.item.lesson{background:#E3EEF3}.item.lesson .type-square{background:#2F7D9B}
.item.review{background:#F4F4F1}.item.review .type-square{background:#2F8A5F}
.item.practice{background:#FBF0D6}.item.practice .type-square{background:#E3A233}
.item.prep{background:#FBE6DC}.item.prep .type-square{background:#D9663A}
.item.next{border:2px solid #E3A233}.item.next .item-meta{color:var(--ink)}
.item.done{background:#F4F4F2}.item.done .type-square{background:#BDBDB8}.item.done .item-title{text-decoration:line-through}.item.done .item-meta{color:var(--strong)}
.item.missed .item-title{text-decoration:line-through;color:var(--muted)}
.item.deferring{border:1px dashed rgba(20,20,20,.4)}
/* Below the grid */
.below{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;margin-top:20px;align-items:start}
.deferred{background:#FFFFFF;border:1px solid var(--line);border-radius:18px;padding:20px 22px;min-width:0}
.deferred h3{margin:0 0 6px;font-family:var(--font-display);font-weight:400;font-size:21px}
.deferred h4{margin:14px 0 2px;font-family:var(--font-display);font-weight:400;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:var(--faint)}
.rows{list-style:none;margin:0;padding:0}
.rows li{display:flex;justify-content:space-between;gap:12px;padding:10px 0;border-top:1px solid var(--inset);font-size:13px;overflow-wrap:anywhere}
.row-min{color:var(--muted);flex:none}
.settings-dialog{border:0;border-radius:22px;padding:22px;width:min(360px,calc(100vw - 32px));box-shadow:0 20px 50px rgba(20,20,20,.25);color:var(--ink);background:#FFFFFF}.settings-dialog::backdrop{background:rgba(20,20,20,.35)}.settings-form{max-width:none}.settings-form h3{font-family:var(--font-display);font-weight:400;font-size:22px;margin:0 0 4px}.settings-form label{margin:14px 0 6px;font-size:13px;font-weight:700}.settings-form input{min-height:40px;font-size:14px;margin-top:6px;border-radius:10px}.dialog-actions{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:18px}.dialog-actions .primary{min-height:40px;padding:0 18px;font-size:14px}
@media(max-width:900px){.planner{padding:22px 18px 40px}}
@media(max-width:760px){.below{grid-template-columns:1fr}.next{grid-template-columns:1fr}.next-actions{align-items:flex-start}}
</style>
