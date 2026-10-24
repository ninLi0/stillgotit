<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { api, errorMessage, failureText } from "./api.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { planDay, resultLabels } from "./labels.ts";
import { PendingAdjustment, sessionStore, type AdjustmentInput } from "./pending-adjustment.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];
type Change = NonNullable<SkillData["explanation"]>["changes"][number];
type Case = SkillData["cases"][number];
// `sessionLabels` names conversations, such as "Practice 2". `reload` reads the skill again and rejects when that read fails.
const props = defineProps<{ skill: string; data: SkillData; sessionLabels: Record<string, string>; busy: boolean; reload: () => Promise<void> }>();
const emit = defineEmits<{ changed: []; openSession: [session: string] }>();

// The concept's sentences. HTTP replies carry only a code, so the page checks the value and reason before sending.
const INVALID_ADJUSTMENT = "Enter a value from 0 to 100 and explain the adjustment.";
const KEY_CONFLICT = "Use the original skill, value, and reason when retrying this adjustment.";
const SAVED_OR_NOT = "The timeline below shows whether your adjustment was saved. Sending it again will not add it twice.";

const store = computed(() => new PendingAdjustment(sessionStore(), props.skill));
// A number field may hand back a number, so the value is read through String().
const valueText = ref<string | number>(""), reasonText = ref(""), adjustOpen = ref(false), sending = ref(false);
const problem = ref(""), saved = ref(""), valueInvalid = ref(false), reasonInvalid = ref(false), waiting = ref<AdjustmentInput | null>(null);
const valueInput = ref<HTMLInputElement | null>(null), problemBox = ref<HTMLElement | null>(null), savedBox = ref<HTMLElement | null>(null);
const entered = computed(() => {
  const text = String(valueText.value).trim();
  return { text, value: Number(text), reason: reasonText.value.trim() };
});
// The learner is about to resend the unanswered adjustment: same value, same reason, same key.
const retrying = computed(() => !!waiting.value && entered.value.text !== "" &&
  entered.value.value === waiting.value.value && entered.value.reason === waiting.value.reason);

/** An unanswered adjustment from before a reload comes back with its value and reason, ready to send again. */
function restore() {
  waiting.value = store.value.read();
  adjustOpen.value = !!waiting.value;
  valueText.value = waiting.value ? String(waiting.value.value) : "";
  reasonText.value = waiting.value?.reason ?? "";
  problem.value = ""; saved.value = ""; valueInvalid.value = false; reasonInvalid.value = false;
}
watch(() => props.skill, restore, { immediate: true });

async function toggleAdjust() {
  adjustOpen.value = !adjustOpen.value;
  problem.value = ""; valueInvalid.value = false; reasonInvalid.value = false;
  if (!adjustOpen.value) return;
  saved.value = "";
  if (!waiting.value && entered.value.text === "" && props.data.estimate) valueText.value = String(Math.round(props.data.estimate.value));
  await nextTick();
  valueInput.value?.focus();
}

async function sendAdjustment() {
  if (sending.value || props.busy) return;
  problem.value = ""; saved.value = "";
  const { text, value, reason } = entered.value;
  valueInvalid.value = text === "" || !Number.isFinite(value) || value < 0 || value > 100;
  reasonInvalid.value = !reason;
  if (valueInvalid.value || reasonInvalid.value) { problem.value = INVALID_ADJUSTMENT; return; }
  let input: AdjustmentInput;
  try { input = store.value.prepare(value, reason); }
  catch (failure) { problem.value = failure instanceof Error ? failure.message : "This adjustment could not be prepared. Try again."; return; }
  waiting.value = input;
  const previous = focusedControl();
  sending.value = true;
  try {
    let failure = "";
    try {
      const result = await api.learning.adjust(input);
      if ("error" in result) {
        const detail = (result as { detail?: unknown }).detail;
        // On this endpoint, CONFLICT can only mean the key was used with different input.
        failure = result.error === "CONFLICT" && !(typeof detail === "string" && detail.trim()) ? KEY_CONFLICT : failureText(result);
      }
    } catch {
      failure = errorMessage("NETWORK_ERROR");
    }
    if (failure) {
      // The adjustment may still have been saved, so the key, value, and reason stay for a retry.
      problem.value = `${failure} ${SAVED_OR_NOT}`;
      await props.reload().catch(() => undefined);
    } else {
      store.value.finish(input.adjustmentKey);
      waiting.value = null; adjustOpen.value = false; valueText.value = ""; reasonText.value = "";
      try {
        await props.reload(); await nextTick();
        saved.value = props.data.estimate ? `Adjustment saved. Your estimate is now ${Math.round(props.data.estimate.value)}%.` : "Adjustment saved.";
      } catch {
        saved.value = "Adjustment saved. The page could not refresh, so reload it to see the new estimate.";
      }
    }
    emit("changed");
  } finally {
    sending.value = false;
    await nextTick();
    restoreFocus(previous, () => problem.value ? problemBox.value : savedBox.value);
  }
}

const casesById = computed(() => new Map(props.data.cases.map((item) => [item.case, item])));
/** Imported graded work has no practice task and keeps its original mark. */
function isImported(item: Case) { return item.task === null && item.work.originalMark.trim() !== ""; }
function caseName(item: Case | undefined) {
  if (!item) return "";
  if (isImported(item)) return `Imported · original mark ${item.work.originalMark.trim()}`;
  return item.task ? props.sessionLabels[item.task] ?? "Practice" : "Assessment";
}
function result(item: Case | undefined) { return item?.judgment ? resultLabels[item.judgment.result] ?? "" : ""; }
function percent(value: number) { return `${Math.round(value)}%`; }
function points(amount: number) { const whole = Math.round(amount); return whole < 1 ? "less than 1 point" : whole === 1 ? "1 point" : `${whole} points`; }
function kindLabel(change: Change) {
  if (change.kind === "ATTEMPT") {
    const item = casesById.value.get(change.source);
    return ["Assessed attempt", caseName(item), result(item)].filter(Boolean).join(" · ");
  }
  return change.kind === "ADJUSTMENT" ? "Your adjustment" : "Time without practice";
}
/** Days since the previous row and the decay folded into this row. Small same-day decay is left out. */
function timing(change: Change, index: number) {
  const since = index === 0 ? "the starting point" : "the previous change";
  const gap = change.days < 1 ? `Less than a day after ${since}.` : `${change.days === 1 ? "1 day" : `${change.days} days`} after ${since}.`;
  const decay = Math.round(change.decay) >= 1 || (change.decay > 0 && change.days >= 1) ? points(change.decay) : "";
  if (!decay) return gap;
  return change.kind === "TIME" ? `${gap} Time lowered it ${decay}.` : `${gap} Time lowered it ${decay} before this.`;
}
const startText = computed(() => props.data.explanation?.start.startingBasis === "PREVIOUS_DEFINITION"
  ? "Carried over from an earlier version of this skill." : "Your reported starting confidence.");
// The readiness sentence above often repeats the explanation's basis sentence. Show it once.
const basisText = computed(() => {
  const basis = props.data.explanation?.basis.trim() ?? "";
  return basis && basis !== props.data.estimate?.basis.trim() ? basis : "";
});
function openCase(item: Case) { if (item.task) emit("openSession", item.task); }
</script>

<template>
  <section class="estimate-panel" aria-labelledby="estimate-heading">
    <div class="estimate-top">
      <div class="estimate-figure">
        <h2 id="estimate-heading" class="eyebrow rail-title">Evidence<span class="sr-only"> · {{ data.estimate ? `${percent(data.estimate.value)} estimated mastery` : 'No estimate yet' }}</span></h2>
        <p v-if="data.estimate" class="readiness">{{ data.estimate.basis }}</p>
      </div>
      <button v-if="data.track" type="button" class="adjust-toggle" :aria-expanded="adjustOpen" aria-controls="adjust-form" :disabled="sending" @click="toggleAdjust">Adjust estimate</button>
    </div>

    <form v-if="data.track" v-show="adjustOpen" id="adjust-form" class="adjust-form" novalidate @submit.prevent="sendAdjustment">
      <p v-if="waiting && !problem" class="waiting-note">Your last adjustment got no answer. The timeline below shows whether it was saved. Send it again to finish. It will not be added twice.</p>
      <div class="adjust-fields">
        <div class="value-field">
          <label for="adjust-value">New estimate</label>
          <div class="value-input"><input id="adjust-value" ref="valueInput" v-model="valueText" type="number" inputmode="decimal" min="0" max="100" step="any" :disabled="sending" :aria-invalid="valueInvalid" :aria-describedby="problem ? 'adjust-range adjust-problem' : 'adjust-range'" /><span aria-hidden="true">%</span></div>
          <p id="adjust-range" class="hint">From 0 to 100</p>
        </div>
        <div class="reason-field">
          <label for="adjust-reason">Reason</label>
          <textarea id="adjust-reason" v-model="reasonText" rows="2" :disabled="sending" :aria-invalid="reasonInvalid" :aria-describedby="problem ? 'adjust-problem' : undefined" placeholder="For example: I solved the problem set on paper without help." />
        </div>
      </div>
      <p class="hint">An adjustment never marks a skill as ready by itself.</p>
      <button class="primary dawn" :disabled="sending || busy">{{ retrying ? 'Send adjustment again' : 'Save adjustment' }}</button>
      <div role="alert"><p v-if="problem" id="adjust-problem" ref="problemBox" class="error" tabindex="-1">{{ problem }}</p></div>
    </form>
    <div role="status"><p v-if="sending" class="working-note">Saving your adjustment…</p><p v-else-if="saved" ref="savedBox" class="notice" tabindex="-1">{{ saved }}</p></div>

    <template v-if="data.explanation">
      <h3>How the estimate got here</h3>
      <p v-if="basisText" class="basis">{{ basisText }}</p>
      <p v-if="data.explanation.provisional" class="basis"><span class="provisional">Provisional</span>No assessed attempt has counted toward this estimate yet.</p>
      <ol class="timeline">
        <li class="row kind-start">
          <span class="row-date">{{ planDay(data.explanation.start.at) }}</span>
          <div class="row-body"><strong>Starting point</strong><p>{{ startText }}</p></div>
          <span class="row-value">{{ percent(data.explanation.start.confidence) }}</span>
        </li>
        <li v-for="(change, index) in data.explanation.changes" :key="`${index}:${change.kind}:${change.source}`" class="row" :class="`kind-${change.kind.toLowerCase()}`">
          <span class="row-date">{{ planDay(change.at) }}</span>
          <div class="row-body">
            <strong>{{ kindLabel(change) }}</strong>
            <p v-if="change.kind === 'ADJUSTMENT' && change.reason" class="row-reason">“{{ change.reason }}”</p>
            <p>{{ timing(change, index) }}</p>
          </div>
          <span class="row-value"><span class="sr-only">From </span>{{ percent(change.before) }}<span aria-hidden="true"> → </span><span class="sr-only"> to </span>{{ percent(change.after) }}</span>
        </li>
      </ol>
      <template v-if="data.explanation.ignored.length">
        <h3>Attempts that did not count</h3>
        <ul class="ignored">
          <li v-for="(item, index) in data.explanation.ignored" :key="`${index}:${item.evidence}`"><strong>{{ caseName(casesById.get(item.evidence)) || 'An attempt' }}</strong>{{ item.reason }}</li>
        </ul>
      </template>
    </template>

    <template v-if="data.cases.length">
      <h3>Assessment history</h3>
      <ol class="case-history">
        <li v-for="item in data.cases" :key="item.case" :class="{ imported: isImported(item) }">
          <div class="case-line"><span class="row-date">{{ planDay(item.performedAt) }}</span><strong>{{ caseName(item) }}</strong></div>
          <template v-if="isImported(item)">
            <p v-if="item.work.originalFeedback.trim()" class="case-note"><span>Grader's feedback</span>{{ item.work.originalFeedback }}</p>
            <p class="case-note"><span>StillGotIt's judgment</span>{{ item.judgment ? `${result(item)}. ${item.judgment.rationale}` : 'Assessment pending.' }}</p>
          </template>
          <p v-else class="case-note">{{ item.judgment ? result(item) : 'Assessment pending.' }}<button v-if="item.task && sessionLabels[item.task]" type="button" class="case-open" @click="openCase(item)">Open {{ sessionLabels[item.task] }}</button></p>
        </li>
      </ol>
    </template>
  </section>
</template>

<style scoped>
/* The Evidence card of the Learn rail (design/revamp/README.md): a lavender rail with square nodes. */
.estimate-panel{font-size:13px;overflow-wrap:anywhere}
.estimate-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
.estimate-figure{min-width:0}
.rail-title{color:#7A7397}
.readiness{margin:8px 0 0;color:var(--soft);font-size:12px;line-height:1.5}
.adjust-toggle{flex:none;border:0;border-radius:999px;background:var(--dawn-soft);color:var(--dawn-soft-text);padding:4px 10px;font-size:12px;font-weight:700;white-space:nowrap}
.adjust-toggle:hover:not(:disabled){background:#DEDAFF}
.adjust-form{max-width:none;margin:12px 0 6px;padding:12px;background:#FAF9FE;border:1px solid #ECE9F5;border-radius:14px}
.adjust-fields{display:grid;grid-template-columns:1fr;gap:10px}
.adjust-form label{font-size:12px;font-weight:600;margin:0 0 6px}
.value-input{display:flex;align-items:center;gap:8px;max-width:140px}
.value-input input{min-height:38px;padding:6px 10px;font-variant-numeric:tabular-nums;border-radius:10px}
.adjust-form .hint{font-size:12px;margin:6px 0 0}
.adjust-form textarea{display:block;width:100%;min-height:42px;padding:8px 10px;border:1px solid var(--ring);border-radius:10px;font:inherit;font-size:13px;background:#FFFFFF;color:var(--ink);resize:vertical}
.adjust-form [aria-invalid="true"]{border-color:var(--coral);border-width:2px}
.adjust-form .primary{min-height:38px;margin-top:12px;padding:0 14px;font-size:13px}
.adjust-form .error{margin:12px 0 0}
.waiting-note{margin:0 0 10px;padding:8px 10px;border-left:3px solid var(--dawn-edge);background:#FFFFFF;border-radius:4px;font-size:12px}
.working-note{margin:10px 0 0;color:var(--muted)}
.notice{margin:10px 0 0}
h3{font-family:var(--font-display);font-weight:500;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#7A7397;margin:16px 0 6px}
.basis{margin:0 0 6px;color:var(--soft);line-height:1.5;font-size:12px}
.provisional{display:inline-block;margin-right:6px;padding:0 7px;border-radius:999px;font-size:11px;font-weight:700;color:var(--dawn-soft-text);background:var(--dawn-soft)}
.timeline{list-style:none;margin:10px 0 0 4px;padding:0;border-left:2px solid #E3DEF7}
.row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"body date" "body value";gap:0 8px;padding:0 0 12px 14px;line-height:1.35}
.row::before{content:"";position:absolute;left:-6px;top:5px;width:10px;height:10px;background:#A79CEE}
.kind-start::before{background:#D6D1F2}
.kind-time::before{background:#E3DEF7}
.row-date{grid-area:date;color:#8A8A86;font-size:12px;white-space:nowrap;text-align:right}
.row-body{grid-area:body;min-width:0}
.row-body strong{font-weight:700}
.row-body p{margin:2px 0 0;color:var(--faint);font-size:12px;line-height:1.4}
.row-body .row-reason{color:var(--ink);font-style:italic}
.row-value{grid-area:value;font-weight:700;white-space:nowrap;font-variant-numeric:tabular-nums;text-align:right;font-size:12px}
.ignored{margin:0;padding-left:16px;font-size:12px}
.ignored li{margin:0 0 6px}
.ignored strong{margin-right:6px}
.case-history{list-style:none;margin:0;padding:0}
.case-history li{padding:8px 0;border-top:1px solid #EEEBF5}
.case-history li:first-child{border-top:0}
.case-line{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline}
.case-line .row-date{text-align:left}
.case-note{margin:4px 0 0;color:var(--muted);font-size:12px}
.case-note span{display:block;font-size:11px;font-weight:700;color:var(--ink);margin-top:6px}
.imported{padding-left:10px!important;border-left:3px solid #A79CEE}
.case-open{border:0;background:transparent;padding:0 0 0 8px;font-size:12px;font-weight:600;color:var(--dawn-soft-text);text-decoration:underline;text-underline-offset:3px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
