<script setup lang="ts">
import { onMounted, ref, shallowRef, watch } from "vue";
import { api, unwrap } from "./api.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
type PlanData = StillGotItHttp["/planning/read"]["output"]["data"];
const props = defineProps<{ course: string; revision: number }>();
const emit = defineEmits<{ select: [skill: string] }>();
const data = shallowRef<PlanData | null>(null), minutes = ref(30), actualMinutes = ref(10), note = ref(""), busy = ref(false), error = ref("");
async function read() { data.value = unwrap(await api.planning.read({ course: props.course })).data; if (data.value.preferences) { minutes.value = data.value.preferences.dailyMinutes; note.value = data.value.preferences.focusNote; } }
async function act(action: () => Promise<void>) { busy.value = true; error.value = ""; try { await action(); await read(); } catch (e) { error.value = e instanceof Error ? e.message : "The plan could not update."; } finally { busy.value = false; } }
async function save() { await act(async () => { unwrap(await api.planning.configure({ course: props.course, dailyMinutes: minutes.value, focusNote: note.value })); }); }
async function start() { const next = data.value?.next; if (!next) return; await act(async () => { unwrap(await api.planning.begin({ course: props.course, item: next.item })); emit("select", next.candidate.subject); }); }
async function finish() { const item = data.value?.next?.item; if (item) await act(async () => { unwrap(await api.planning.finish({ course: props.course, item, actualMinutes: actualMinutes.value })); }); }
async function stop() { const item = data.value?.next?.item; if (item) await act(async () => { unwrap(await api.planning.stop({ course: props.course, item, actualMinutes: actualMinutes.value })); }); }
async function miss() { const item = data.value?.next?.item; if (item) await act(async () => { unwrap(await api.planning.miss({ course: props.course, item })); }); }
async function propose() { await act(async () => { unwrap(await api.planning.propose({ course: props.course })); }); }
onMounted(() => act(read)); watch(() => props.revision, () => act(read));
</script>
<template>
  <section class="planner"><h2>Your next review</h2><p class="hint">One course. A budget you can keep.</p><p v-if="error" class="error" role="alert">{{ error }}</p>
    <details :open="!data?.preferences"><summary>Daily time budget</summary><form @submit.prevent="save"><label>Minutes per day<input v-model.number="minutes" type="number" min="0" max="1440" step="1" required :disabled="busy" /></label><label>Focus note<input v-model="note" maxlength="300" :disabled="busy" placeholder="For example: matrix products this week" /></label><button class="primary" :disabled="busy">Save and plan</button></form></details>
    <p v-if="data?.budget" class="budget">{{ Math.round(data.budget.remainingMinutes) }} min left today <span>· {{ Math.round(data.budget.spentMinutes) }} min recorded</span></p>
    <div v-if="data?.next" class="next"><p class="date">{{ data.next.day === data.today ? 'Today' : data.next.day }}</p><h3>{{ data.next.candidate.activity }}</h3><p>{{ data.next.candidate.reason }}</p><p class="hint">About {{ data.next.candidate.minutes }} minutes</p>
      <template v-if="data.next.status === 'IN_PROGRESS'"><p class="hint">In progress. Record actual time when you finish or stop.</p><label>Minutes spent<input v-model.number="actualMinutes" type="number" min="0" step="0.5" :disabled="busy" /></label><div class="actions"><button class="primary" :disabled="busy" @click="finish">Finish review</button><button class="quiet" :disabled="busy" @click="stop">Stop for now</button></div></template>
      <div v-else class="actions"><button class="primary" :disabled="busy || data.next.day !== data.today" @click="start">Start review</button><button v-if="data.next.day <= data.today" class="quiet" :disabled="busy" @click="miss">Missed today</button></div>
    </div><p v-else-if="data?.preferences" class="hint">No review is scheduled. Update the plan after adding skills or completing practice.</p>
    <button v-if="data?.preferences" class="quiet update-plan" :disabled="busy || data.next?.status === 'IN_PROGRESS'" @click="propose">Update plan from progress</button>
    <details v-if="data?.plan"><summary>Week and deferred work</summary><ul><li v-for="item in data.plan.items" :key="item.item">{{ item.day }} · {{ item.candidate.activity }} · {{ item.status.toLowerCase().replaceAll('_',' ') }}</li><li v-for="(item,index) in data.plan.deferred" :key="index">Does not fit: {{ item.candidate.activity }} ({{ item.candidate.minutes }} min)</li></ul><p class="hint">Activity times and review intervals are initial estimates. Missing a review does not apply a mastery penalty.</p></details>
  </section>
</template>
<style scoped>
.planner { padding:26px 0; margin-top:24px; border-top:1px solid #d8d8d8; }h2 { font:27px Georgia,serif; margin:0; }h3 { font-size:17px; margin:0 0 10px; }summary { cursor:pointer; margin:18px 0; font-size:13px; text-decoration:underline; text-underline-offset:3px; }.budget { font-weight:600; font-size:14px; padding-top:15px; }.budget span { font-weight:400; color:#676767; font-size:12px; }.next { background:#f6f6f6; padding:20px; border-radius:8px; }.next p { font-size:13px; }.date { text-transform:uppercase; font-size:11px!important; letter-spacing:1px; color:#676767; }.actions { display:flex; flex-wrap:wrap; align-items:center; gap:14px; margin-top:16px; }.update-plan { margin:14px 0; }label { margin:14px 0 6px; }li { font-size:12px; margin:8px 0; }ul { padding-left:18px; }
</style>
