<script setup lang="ts">
import { computed, nextTick, onMounted, ref, shallowRef, watch } from "vue";
import { api, unwrap } from "./api.ts";
import { planDay, planDayLabel } from "./labels.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
type PlanData = StillGotItHttp["/planning/read"]["output"]["data"];
const props = defineProps<{ course: string; revision: number }>();
const emit = defineEmits<{ select: [skill: string] }>();
const data = shallowRef<PlanData | null>(null), minutes = ref(30), actualMinutes = ref(10), note = ref(""), busy = ref(false), error = ref(""), notice = ref("");
const noticeBox = ref<HTMLElement | null>(null), errorBox = ref<HTMLElement | null>(null), settings = ref<HTMLDialogElement | null>(null);
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
async function read() { data.value = unwrap(await api.planning.read({ course: props.course })).data; if (data.value.preferences) { minutes.value = data.value.preferences.dailyMinutes; note.value = data.value.preferences.focusNote; } }
// `success` is shown after the change. Focus returns to the control the learner used, or to the result when that control is gone.
async function act(action: () => Promise<void>, success = "") {
  const previous = focusedControl();
  busy.value = true; error.value = ""; notice.value = "";
  try { await action(); await read(); notice.value = success; } catch (e) { error.value = e instanceof Error ? e.message : "The plan could not update."; }
  finally { busy.value = false; await nextTick(); restoreFocus(previous, () => error.value ? errorBox.value : noticeBox.value); }
}
async function save() { await act(async () => { unwrap(await api.planning.configure({ course: props.course, dailyMinutes: minutes.value, focusNote: note.value })); }, "Daily budget saved. Your plan is updated."); }
async function start() { const next = data.value?.next; if (!next) return; await act(async () => { unwrap(await api.planning.begin({ course: props.course, item: next.item })); emit("select", next.candidate.subject); }, "Review started. Come back here to record your time when you finish."); }
async function finish() { const item = data.value?.next?.item, spent = actualMinutes.value; if (item) await act(async () => { unwrap(await api.planning.finish({ course: props.course, item, actualMinutes: spent })); }, `Review finished. ${spent} minutes recorded.`); }
async function stop() { const item = data.value?.next?.item, spent = actualMinutes.value; if (item) await act(async () => { unwrap(await api.planning.stop({ course: props.course, item, actualMinutes: spent })); }, `Stopped for now. ${spent} minutes recorded.`); }
async function miss() { const item = data.value?.next?.item; if (item) await act(async () => { unwrap(await api.planning.miss({ course: props.course, item })); }, "Marked as missed. This does not lower your mastery estimate."); }
async function propose() { await act(async () => { unwrap(await api.planning.propose({ course: props.course })); }, "Plan updated from your progress."); }
onMounted(() => act(read));
// Progress changes elsewhere refresh the plan without clearing the message from the learner's last plan action.
watch(() => props.revision, () => read().catch((e) => { error.value = e instanceof Error ? e.message : "The plan could not be refreshed."; }));
</script>
<template>
  <section class="planner"><h2>Your next review</h2><p class="hint planner-subtitle">A few minutes a day, within the budget you set.</p><div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div><div role="status"><p v-if="notice" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
    <p v-if="data" class="budget-row">{{ data.preferences ? `${minutes} min a day for this course` : 'Set a daily study time for this course to get a plan.' }} <button type="button" class="link-button" @click="settings?.showModal()">{{ data.preferences ? 'Change' : 'Set study time' }}</button></p>
    <Teleport to="body"><dialog ref="settings" class="settings-dialog" aria-labelledby="settings-title"><form class="settings-form" @submit.prevent="saveSettings"><h3 id="settings-title">Study time</h3><p class="hint">For this course only. Each course has its own plan.</p><label>Minutes a day<input v-model.number="minutes" type="number" min="0" max="1440" step="1" required :disabled="busy" /></label><label>Focus note<input v-model="note" maxlength="300" :disabled="busy" placeholder="Optional, for example: matrix products" /></label><div class="dialog-actions"><button type="button" class="quiet" @click="settings?.close()">Cancel</button><button class="primary" :disabled="busy">Save</button></div></form></dialog></Teleport>
    <p v-if="data?.budget" class="budget">{{ Math.round(data.budget.remainingMinutes) }} min left today <span>· {{ Math.round(data.budget.spentMinutes) }} min recorded</span></p>
    <div v-if="data?.next" class="next"><p class="date">{{ planDayLabel(data.next.day, data.today) }}</p><h3>{{ data.next.candidate.activity }}</h3><p>{{ data.next.candidate.reason }}</p><p class="hint">About {{ data.next.candidate.minutes }} minutes</p>
      <template v-if="data.next.status === 'IN_PROGRESS'"><p class="hint">In progress. Record actual time when you finish or stop.</p><label>Minutes spent<input v-model.number="actualMinutes" type="number" min="0" step="0.5" :disabled="busy" /></label><div class="actions"><button class="primary" :disabled="busy" @click="finish">Finish review</button><button class="quiet" :disabled="busy" @click="stop">Stop for now</button></div></template>
      <template v-else><div class="actions"><button class="primary" :disabled="busy || !!startReason" :aria-describedby="startReason ? 'start-reason' : undefined" @click="start">Start review</button><button v-if="data.next.day <= data.today" class="quiet" :disabled="busy" @click="miss">{{ data.next.day === data.today ? 'Missed today' : 'Mark as missed' }}</button></div><p v-if="startReason" id="start-reason" class="hint reason">{{ startReason }}</p></template>
    </div><p v-else-if="data?.preferences" class="hint">No review is scheduled. Update the plan after adding skills or completing practice.</p>
    <template v-if="data?.preferences"><button class="small-button update-plan" :disabled="busy || !!updateReason" :aria-describedby="updateReason ? 'update-reason' : undefined" @click="propose">Update plan</button><p v-if="updateReason" id="update-reason" class="hint reason">{{ updateReason }}</p></template>
    <details v-if="data?.plan"><summary>Week and deferred work</summary><ul><li v-for="item in data.plan.items" :key="item.item">{{ planDayLabel(item.day, data.today) }} · {{ item.candidate.activity }} · {{ item.status.toLowerCase().replaceAll('_',' ') }}</li><li v-for="(item,index) in data.plan.deferred" :key="index">Does not fit: {{ item.candidate.activity }} ({{ item.candidate.minutes }} min)</li></ul><p class="hint">Activity times and review intervals are initial estimates. Missing a review does not apply a mastery penalty.</p></details>
  </section>
</template>
<style scoped>
.planner { padding:26px 0; margin-top:24px; border-top:1px solid var(--line); }h2 { font:27px Georgia,serif; margin:0; }h3 { font-size:17px; margin:0 0 10px; }summary { cursor:pointer; margin:14px 0 6px; padding:8px 0; font-size:13px; list-style:none; display:flex; justify-content:space-between; align-items:center; color:var(--ink); }summary::-webkit-details-marker { display:none; }summary::after { content:"›"; color:var(--muted); font-size:18px; line-height:1; transition:transform 150ms; }details[open]>summary::after { transform:rotate(90deg); }.budget { font-weight:600; font-size:14px; padding-top:15px; }.budget span { font-weight:400; color:var(--muted); font-size:12px; }.next { background:var(--wash); padding:20px; border-radius:8px; }.next p { font-size:13px; }.date { text-transform:uppercase; font-size:11px!important; letter-spacing:1px; color:var(--muted); }.actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin-top:16px; }.update-plan { margin:14px 0; }label { margin:14px 0 6px; }li { font-size:12px; margin:8px 0; }ul { padding-left:18px; }
.budget-row{margin:2px 0 10px;font-size:13px;line-height:1.5;color:var(--muted)}.link-button{border:0;background:none;padding:0;font:inherit;color:var(--primary);text-decoration:underline;text-underline-offset:3px}
.settings-dialog{border:0;border-radius:16px;padding:22px;width:min(360px,calc(100vw - 32px));box-shadow:0 20px 50px rgba(23,35,64,.25);color:var(--ink);background:var(--surface)}.settings-dialog::backdrop{background:rgba(23,35,64,.35)}.settings-form{max-width:none}.settings-form h3{font:22px Georgia,serif;margin:0 0 4px}.settings-form label{margin:14px 0 6px;font-size:13px}.settings-form input{min-height:40px;font-size:14px;margin-top:6px}.dialog-actions{display:flex;justify-content:flex-end;align-items:center;gap:16px;margin-top:18px}.dialog-actions .primary{min-height:40px;padding:6px 18px;font-size:14px}
.budget-form{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;align-items:center;max-width:none;margin-bottom:10px}.minutes-field{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;font-weight:400;color:var(--muted)}.minutes-field input{width:64px;min-height:34px;padding:4px 8px;font-size:14px;border-radius:8px;text-align:center}.note-field{grid-column:1/-1;min-height:34px;padding:4px 10px;font-size:13px;border-radius:8px}.budget-form .primary{min-height:34px;padding:4px 14px;font-size:13px}
.next{background:var(--wash);padding:14px;border-radius:12px}.next h3{font-size:15px;margin:2px 0 6px}.next p{margin:4px 0}.budget{padding-top:4px;font-size:13px}.actions .primary{min-height:36px;padding:6px 14px;font-size:14px}
</style>
