<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { api } from "./api.ts";
import { planDay, planDayLabel } from "./labels.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { beginRefusal, examProblem, examRefusal, failureMessage, PlanningFailure, removeRefusal, sentences, settle, tradeoffRefusal,
  type CourseSkill, type CourseUnit, type ExamInput, type PlanRead } from "./planning.ts";
import PlannerExams from "./PlannerExams.vue";
import TradeoffPanel from "./TradeoffPanel.vue";
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
onMounted(() => load());
// Progress changes elsewhere refresh the plan and skills without clearing the message from the learner's last plan action.
watch(() => props.revision, () => Promise.all([read(), readCourse()]).catch((problem) => { errorPlace.value = "top"; error.value = failureMessage(problem); }));
</script>
<template>
  <section class="planner" :aria-busy="busy"><h2>Your next review</h2><p class="hint planner-subtitle">A few minutes a day, within the budget you set.</p><div role="alert"><p v-if="error && shownAt === 'top'" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div><div role="status"><p v-if="notice" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
    <p v-if="!data && !error" class="hint loading">Loading your plan…</p><button v-if="!data && error && !busy" type="button" class="small-button retry-load" @click="load('Your plan is loaded.')">Try again</button>
    <p v-if="data" class="budget-row">{{ data.preferences ? `${minutes} min a day for this course` : 'Set a daily study time for this course to get a plan.' }} <button type="button" class="link-button" @click="settings?.showModal()">{{ data.preferences ? 'Change' : 'Set study time' }}</button></p>
    <Teleport to="body"><dialog ref="settings" class="settings-dialog" aria-labelledby="settings-title"><form class="settings-form" @submit.prevent="saveSettings"><h3 id="settings-title">Study time</h3><p class="hint">For this course only. Each course has its own plan.</p><label>Minutes a day<input v-model.number="minutes" type="number" min="0" max="1440" step="1" required :disabled="busy" /></label><label>Focus note<input v-model="note" maxlength="300" :disabled="busy" placeholder="Optional, for example: matrix products" /></label><div class="dialog-actions"><button type="button" class="quiet" @click="settings?.close()">Cancel</button><button class="primary" :disabled="busy">Save</button></div></form></dialog></Teleport>
    <TradeoffPanel v-if="data && proposal" :proposal="proposal" :items="current!.proposalItems" :cuts="cutRows" :today="data.today" :has-active-plan="!!data.plan" :busy="busy" @confirm="decide(true)" @decline="decide(false)" />
    <p v-if="data?.budget" class="budget">{{ Math.round(data.budget.remainingMinutes) }} min left today <span>· {{ Math.round(data.budget.spentMinutes) }} min recorded</span></p>
    <div v-if="data?.next" class="next"><p class="date">{{ planDayLabel(data.next.day, data.today) }}</p><h3>{{ data.next.candidate.activity }}</h3><p>{{ data.next.candidate.reason }}</p><p class="hint">About {{ data.next.candidate.minutes }} minutes</p>
      <template v-if="data.next.status === 'IN_PROGRESS'"><p class="hint">In progress. Record actual time when you finish or stop.</p><label>Minutes spent<input v-model.number="actualMinutes" type="number" min="0" step="0.5" :disabled="busy" /></label><div class="actions"><button class="primary" :disabled="busy" @click="finish">Finish review</button><button class="quiet" :disabled="busy" @click="stop">Stop for now</button></div></template>
      <template v-else><div class="actions"><button class="primary" :disabled="busy || !!startReason" :aria-describedby="startReason ? 'start-reason' : undefined" @click="start">Start review</button><button v-if="data.next.day <= data.today" class="quiet" :disabled="busy" @click="miss">{{ data.next.day === data.today ? 'Missed today' : 'Mark as missed' }}</button></div><p v-if="startReason" id="start-reason" class="hint reason">{{ startReason }}</p></template>
      <div role="alert"><p v-if="error && shownAt === 'activity'" ref="activityErrorBox" class="error activity-error" tabindex="-1">{{ error }}</p></div>
    </div><p v-else-if="data?.preferences" class="hint">No review is scheduled. Update the plan after adding skills or completing practice.</p>
    <template v-if="data?.preferences"><button class="small-button update-plan" :disabled="busy || !!updateReason" :aria-describedby="updateReason ? 'update-reason' : undefined" @click="propose">Update plan</button><p v-if="updateReason" id="update-reason" class="hint reason">{{ updateReason }}</p></template>
    <PlannerExams v-if="data" ref="examsPanel" :exams="current!.exams" :skills="skills" :units="units" :today="data.today" :busy="busy" :add-reason="addExamReason" :error="error && shownAt === 'exams' ? error : ''" @save="saveExam" @remove="removeExam" />
    <details v-if="data?.plan"><summary>Week and deferred work</summary><ul><li v-for="item in data.plan.items" :key="item.item">{{ planDayLabel(item.day, data.today) }} · {{ item.candidate.activity }} · {{ item.status.toLowerCase().replaceAll('_',' ') }}</li><li v-for="(item,index) in data.plan.deferred" :key="index">Does not fit: {{ item.candidate.activity }} ({{ item.candidate.minutes }} min)</li></ul><p class="hint">Activity times and review intervals are initial estimates. Missing a review does not apply a mastery penalty.</p></details>
  </section>
</template>
<style scoped>
.planner { padding:26px 0; margin-top:24px; border-top:1px solid var(--line); }h2 { font:27px Georgia,serif; margin:0; }h3 { font-size:17px; margin:0 0 10px; }summary { cursor:pointer; margin:14px 0 6px; padding:8px 0; font-size:13px; list-style:none; display:flex; justify-content:space-between; align-items:center; color:var(--ink); }summary::-webkit-details-marker { display:none; }summary::after { content:"›"; color:var(--muted); font-size:18px; line-height:1; transition:transform 150ms; }details[open]>summary::after { transform:rotate(90deg); }.budget { font-weight:600; font-size:14px; padding-top:15px; }.budget span { font-weight:400; color:var(--muted); font-size:12px; }.next { background:var(--wash); padding:20px; border-radius:8px; }.next p { font-size:13px; }.date { text-transform:uppercase; font-size:11px!important; letter-spacing:1px; color:var(--muted); }.actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin-top:16px; }.update-plan { margin:14px 0; }label { margin:14px 0 6px; }li { font-size:12px; margin:8px 0; }ul { padding-left:18px; }
.budget-row{margin:2px 0 10px;font-size:13px;line-height:1.5;color:var(--muted)}.link-button{border:0;background:none;padding:0;font:inherit;color:var(--primary);text-decoration:underline;text-underline-offset:3px}
.settings-dialog{border:0;border-radius:16px;padding:22px;width:min(360px,calc(100vw - 32px));box-shadow:0 20px 50px rgba(23,35,64,.25);color:var(--ink);background:var(--surface)}.settings-dialog::backdrop{background:rgba(23,35,64,.35)}.settings-form{max-width:none}.settings-form h3{font:22px Georgia,serif;margin:0 0 4px}.settings-form label{margin:14px 0 6px;font-size:13px}.settings-form input{min-height:40px;font-size:14px;margin-top:6px}.dialog-actions{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:18px}.dialog-actions .primary{min-height:40px;padding:6px 18px;font-size:14px}
.budget-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;max-width:none;margin-bottom:10px}.minutes-field{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:400;color:var(--muted)}.minutes-field input{width:64px;min-height:34px;padding:4px 8px;font-size:14px;border-radius:8px;text-align:center}.note-field{grid-column:1/-1;min-height:34px;padding:4px 10px;font-size:13px;border-radius:8px}.budget-form .primary{min-height:34px;padding:4px 14px;font-size:13px}
.next{background:var(--wash);padding:14px;border-radius:12px}.next h3{font-size:15px;margin:2px 0 6px}.next p{margin:4px 0}.budget{padding-top:4px;font-size:13px}.actions .primary{min-height:36px;padding:6px 14px;font-size:14px}
.activity-error{margin:12px 0 0!important}.loading{margin:4px 0 0}.retry-load{margin:10px 0}
</style>
