<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import EstimateChart from "./EstimateChart.vue";
import PixelIcon from "./PixelIcon.vue";
import { api, errorMessage, failureText } from "./api.ts";
import { KIND_MARKS, KIND_NAMES, type ChartPoint } from "./estimate-chart.ts";
import { MARKS } from "./pixel-art.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { planDay } from "./labels.ts";
import { isImported, caseName as nameOf, resultName, changeText as sentence, kindLabel as markLabel, type Case, type Change, type SkillData } from "./evidence-text.ts";
import { PendingAdjustment, sessionStore, type AdjustmentInput } from "./pending-adjustment.ts";
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
// The wording is shared with the Memory view (evidence-text.ts).
function caseName(item: Case | undefined) { return nameOf(item, props.sessionLabels); }
function result(item: Case | undefined) { return resultName(item); }
function percent(value: number) { return `${Math.round(value)}%`; }
function points(amount: number) { const whole = Math.round(amount); return whole < 1 ? "less than 1 point" : whole === 1 ? "1 point" : `${whole} points`; }
function kindLabel(change: Change) { return markLabel(change, casesById.value, props.sessionLabels); }
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

// ---- The evidence timeline's rows: a date, a mark for the kind, a plain sentence, and the values in their own column ----
/** "Tue, Oct 13" as the date over the weekday; a date planDay could not read stays whole. */
function dateParts(at: string) {
  const [weekday, day] = planDay(at).split(", ");
  return day ? { day, weekday } : { day: weekday ?? "", weekday: "" };
}
function changeText(change: Change) { return sentence(change, casesById.value, props.sessionLabels); }
/** The starting point's date and one row per change, in the concept's order. */
const startDate = computed(() => dateParts(props.data.explanation?.start.at ?? ""));
const changeRows = computed(() => (props.data.explanation?.changes ?? []).map((change, index) => ({
  key: `${index}:${change.kind}:${change.source}`, change, date: dateParts(change.at), text: changeText(change), detail: timing(change, index),
})));
/** Each attempt that did not count, named as the timeline has always named it, with the case's date when it is known. */
const ignoredRows = computed(() => (props.data.explanation?.ignored ?? []).map((row, index) => {
  const item = casesById.value.get(row.evidence);
  return { key: `${index}:${row.evidence}`, reason: row.reason, date: item ? dateParts(item.performedAt) : null,
    name: [caseName(item) || "An attempt", result(item)].filter(Boolean).join(" · ") };
}));
// The readiness sentence above often repeats the explanation's basis sentence. Show it once.
const basisText = computed(() => {
  const basis = props.data.explanation?.basis.trim() ?? "";
  return basis && basis !== props.data.estimate?.basis.trim() ? basis : "";
});
function openCase(item: Case) { if (item.task) emit("openSession", item.task); }
/** While the chart's line draws itself, the timeline's rows rise one after another, each a sixth of the entrance
 * later than the row above; rows past the seventh rise with the seventh, so the stagger stays short. */
function stagger(row: number) { return { "--row": Math.min(row, 6) }; }
/** The chart's points: the starting point, then every change in the concept's order, with the timeline's own labels. */
const chartPoints = computed<ChartPoint[]>(() => {
  const explanation = props.data.explanation;
  if (!explanation) return [];
  return [{ at: explanation.start.at, kind: "START", before: null, after: explanation.start.confidence, label: "Starting point" },
    ...explanation.changes.map((change): ChartPoint => ({ at: change.at, kind: change.kind, before: change.before, after: change.after, label: kindLabel(change) }))];
});
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
      <h3 id="estimate-chart-heading">Estimate over time</h3>
      <EstimateChart :points="chartPoints" :provisional="data.explanation.provisional" labelledby="estimate-chart-heading" />
      <h3>How the estimate got here</h3>
      <p v-if="basisText" class="basis">{{ basisText }}</p>
      <p v-if="data.explanation.provisional" class="basis"><span class="provisional">Provisional</span>No assessed attempt has counted toward this estimate yet.</p>
      <!-- One row per change: the date, the kind's mark, a plain sentence with its timing, and the values, which the
           sentence also says, so screen readers skip the values column. -->
      <ol class="rows timeline">
        <li class="row" :style="stagger(0)">
          <span class="row-when"><span>{{ startDate.day }}</span><span class="row-weekday">{{ startDate.weekday }}</span></span>
          <span class="row-mark"><PixelIcon :rows="MARKS.start" :size="10" :label="KIND_NAMES.START" /></span>
          <p class="row-text">The estimate started at {{ percent(data.explanation.start.confidence) }}.</p>
          <span class="row-values" aria-hidden="true"><strong>{{ percent(data.explanation.start.confidence) }}</strong></span>
          <div class="row-more"><p class="row-detail">{{ startText }}</p></div>
        </li>
        <li v-for="({ key, change, date, text, detail }, index) in changeRows" :key="key" class="row" :style="stagger(index + 1)">
          <span class="row-when"><span>{{ date.day }}</span><span class="row-weekday">{{ date.weekday }}</span></span>
          <span class="row-mark"><PixelIcon :rows="MARKS[KIND_MARKS[change.kind]]" :size="10" :label="KIND_NAMES[change.kind]" /></span>
          <p class="row-text">{{ text }}</p>
          <span class="row-values" aria-hidden="true"><strong>{{ percent(change.after) }}</strong><span>from {{ percent(change.before) }}</span></span>
          <div class="row-more">
            <p v-if="change.kind === 'ADJUSTMENT' && change.reason" class="row-reason">“{{ change.reason }}”</p>
            <p class="row-detail">{{ detail }}</p>
          </div>
        </li>
      </ol>
      <template v-if="ignoredRows.length">
        <h3>Attempts that did not count</h3>
        <ul class="rows ignored">
          <li v-for="(item, index) in ignoredRows" :key="item.key" class="row" :style="stagger(changeRows.length + 1 + index)">
            <span class="row-when"><template v-if="item.date"><span>{{ item.date.day }}</span><span class="row-weekday">{{ item.date.weekday }}</span></template></span>
            <span class="row-mark"><PixelIcon :rows="MARKS.ignored" :size="10" label="Did not count" /></span>
            <p class="row-text">{{ item.name }}</p>
            <span class="row-values" aria-hidden="true"><span>No change</span></span>
            <div class="row-more"><p class="row-detail">{{ item.reason }}</p></div>
          </li>
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
.rail-title{color:var(--estimate-eyebrow)}
.readiness{margin:8px 0 0;color:var(--soft);font-size:12px;line-height:1.5}
.adjust-toggle{flex:none;border:0;border-radius:999px;background:var(--dawn-soft);color:var(--dawn-soft-text);padding:4px 10px;font-size:12px;font-weight:700;white-space:nowrap}
.adjust-toggle:hover:not(:disabled){background:var(--dawn-nav)}
.adjust-form{max-width:none;margin:12px 0 6px;padding:12px;background:var(--lesson-rail);border:1px solid var(--lesson-card-ring);border-radius:14px}
.adjust-fields{display:grid;grid-template-columns:1fr;gap:10px}
.adjust-form label{font-size:12px;font-weight:600;margin:0 0 6px}
.value-input{display:flex;align-items:center;gap:8px;max-width:140px}
.value-input input{min-height:38px;padding:6px 10px;font-variant-numeric:tabular-nums;border-radius:10px}
.adjust-form .hint{font-size:12px;margin:6px 0 0}
.adjust-form textarea{display:block;width:100%;min-height:42px;padding:8px 10px;border:1px solid var(--ring);border-radius:10px;font:inherit;font-size:13px;background:var(--field);color:var(--ink);resize:vertical}
.adjust-form [aria-invalid="true"]{border-color:var(--coral);border-width:2px}
.adjust-form .primary{min-height:38px;margin-top:12px;padding:0 14px;font-size:13px}
.adjust-form .error{margin:12px 0 0}
.waiting-note{margin:0 0 10px;padding:8px 10px;border-left:3px solid var(--dawn-edge);background:var(--card);border-radius:4px;font-size:12px}
.working-note{margin:10px 0 0;color:var(--muted)}
.notice{margin:10px 0 0}
h3{font-family:var(--font-display);font-weight:500;font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--estimate-eyebrow);margin:16px 0 6px}
.basis{margin:0 0 6px;color:var(--soft);line-height:1.5;font-size:12px}
.provisional{display:inline-block;margin-right:6px;padding:0 7px;border-radius:999px;font-size:11px;font-weight:700;color:var(--dawn-soft-text);background:var(--dawn-soft)}
/* Evidence rows: the date, the kind's mark on a lavender rail, the sentence, and the values. The date and values
   columns have fixed widths so the attempts that did not count line up under the same columns. */
.rows{list-style:none;margin:10px 0 0;padding:0}
.row{position:relative;display:grid;grid-template-columns:38px 10px minmax(0,1fr) 52px;grid-template-areas:"date mark text values" "date mark more more";gap:0 8px;padding:0 0 12px;line-height:1.35;animation:sgRise var(--dur-enter) var(--ease-enter) calc(var(--row, 0) * var(--dur-enter) / 6) both}
.timeline .row:not(:last-child)::before{content:"";position:absolute;left:50px;top:14px;bottom:-3px;width:2px;background:var(--estimate-track)}
.row-when{grid-area:date;display:flex;flex-direction:column;color:var(--ink);font-size:11px;font-weight:600;line-height:1.35;white-space:nowrap}
.row-weekday{color:var(--muted);font-weight:400}
.row-mark{grid-area:mark;display:flex;padding-top:3px}
.row-text{grid-area:text;min-width:0;margin:0;color:var(--ink);font-size:12px;line-height:1.4}
/* The reason and the timing run under the values column too, so they wrap less in the narrow rail. */
.row-more{grid-area:more;min-width:0}
.row-more p{margin:2px 0 0;font-size:12px;line-height:1.4}
.row-detail{color:var(--faint)}
.row-reason{color:var(--ink);font-style:italic}
.row-values{grid-area:values;display:flex;flex-direction:column;align-items:flex-end;color:var(--muted);font-size:11px;line-height:1.35;text-align:right;white-space:nowrap}
.row-values strong{color:var(--ink);font-size:13px;font-weight:700;line-height:1.25}
.row-date{color:var(--dim);font-size:12px;white-space:nowrap}
.case-history{list-style:none;margin:0;padding:0}
.case-history li{padding:8px 0;border-top:1px solid var(--lesson-divider)}
.case-history li:first-child{border-top:0}
.case-line{display:flex;flex-wrap:wrap;gap:2px 10px;align-items:baseline}
.case-line .row-date{text-align:left}
.case-note{margin:4px 0 0;color:var(--muted);font-size:12px}
.case-note span{display:block;font-size:11px;font-weight:700;color:var(--ink);margin-top:6px}
.imported{padding-left:10px!important;border-left:3px solid var(--estimate-imported)}
.case-open{border:0;background:transparent;padding:0 0 0 8px;font-size:12px;font-weight:600;color:var(--dawn-soft-text);text-decoration:underline;text-underline-offset:3px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
