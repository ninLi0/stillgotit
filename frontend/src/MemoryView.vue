<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch } from "vue";
import MasteryCells from "./MasteryCells.vue";
import MemoryCurves, { type CurveSkill } from "./MemoryCurves.vue";
import MemoryShaped from "./MemoryShaped.vue";
import PixelIcon from "./PixelIcon.vue";
import { api, unwrap } from "./api.ts";
import { arrivalStyle, useBoxWidth } from "./box-width.ts";
import { KIND_MARKS, KIND_NAMES, type ChartPoint } from "./estimate-chart.ts";
import { changeText, kindLabel, type SkillData } from "./evidence-text.ts";
import { planDay, sessionLabels } from "./labels.ts";
import { DEFAULT_LINE, HORIZON, THRESHOLD_LINE, layoutDefault, reviewOrder, standing } from "./memory-chart.ts";
import { MARKS, stageOf } from "./pixel-art.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";

// The Memory view (design/visual-design.md, "Charts and summaries"; design/compositions/LearningReads.md, "Memory
// curves"). It opens with the default curve every estimate follows without practice, then shows where each skill's
// estimate is heading, the day to review each one by, and how one skill's curve was shaped by its evidence. Every
// value comes from the memory read and the skill read; the page draws them and computes no estimate of its own.
const props = defineProps<{ course: string }>();
const emit = defineEmits<{ open: [skill: string]; navigate: [view: "setup"] }>();

type MemoryData = StillGotItHttp["/learning/memory"]["output"];
type MemorySkill = MemoryData["skills"][number];
// The reads are replaced whole, never changed in place, so shallow refs hold them.
const data = shallowRef<MemoryData | null>(null), loading = ref(true), problem = ref("");
async function load() {
  loading.value = true; problem.value = "";
  try { data.value = unwrap(await api.learning.memory({ course: props.course })); }
  catch (failure) { problem.value = failure instanceof Error ? failure.message : "Your memory curves could not be loaded. Try again."; }
  finally { loading.value = false; }
}
onMounted(load);

const policy = computed(() => data.value?.policy ?? null);
const threshold = computed(() => policy.value?.reviewThreshold ?? 70);
/** The retention at which a review is due, as a whole percent: 90 under the current policy. */
const retention = computed(() => Math.round((policy.value?.desiredRetention ?? 0.9) * 100));
const skills = computed<MemorySkill[]>(() => data.value?.skills ?? []);
function percent(value: number) { return `${Math.round(value)}%`; }
function days(count: number) { return `${count} ${count === 1 ? "day" : "days"}`; }

// ---- The default curve ----
const introBox = ref<HTMLElement | null>(null);
const introWidth = useBoxWidth(introBox, 360);
const arrives = arrivalStyle();
const intro = computed(() => policy.value ? layoutDefault(policy.value.reference, threshold.value, introWidth.value) : null);
/** The reference curve's last answered day, for the sentence "so 100% today is N% in 90 days". */
const farthest = computed(() => policy.value?.reference.filter((row) => row.days <= HORIZON).at(-1) ?? null);

// ---- Your skills ----
const curves = computed<CurveSkill[]>(() => skills.value.flatMap((s) => (s.estimate === null || !s.projection ? [] : [{
  skill: s.skill, title: s.title, estimate: s.estimate, projection: s.projection, reviewBy: s.reviewBy,
}])));
const flagged = ref<string[] | null>(null), hoveredRow = ref<string | null>(null);
const highlighted = computed(() => (hoveredRow.value ? [hoveredRow.value] : flagged.value));

// ---- Review by ----
const rows = computed(() => reviewOrder(skills.value));
function dayText(row: MemorySkill) {
  const state = standing(row);
  if (state === "DUE") return { text: "Due now", detail: `Retention under ${retention.value}%` };
  if (state === "COMING") return { text: `By ${planDay(row.reviewBy!.at)}`, detail: `In ${days(row.reviewBy!.days)}` };
  if (state === "HOLDS") return { text: `By ${planDay(row.reviewBy!.at)}`, detail: `More than ${HORIZON} days away` };
  return { text: "No starting point yet", detail: "" };
}

// ---- How your curve was shaped ----
const chosen = ref<string | null>(null);
watch(rows, (now) => {
  if (chosen.value && now.some((row) => row.skill === chosen.value)) return;
  chosen.value = (now.find((row) => row.estimate !== null) ?? now[0])?.skill ?? null;
}, { immediate: true });
const chosenSkill = computed(() => skills.value.find((s) => s.skill === chosen.value) ?? null);
const read = shallowRef<SkillData | null>(null), reading = ref(false), readProblem = ref("");
let readToken = 0;
async function loadRead() {
  const skill = chosenSkill.value, token = ++readToken;
  read.value = null; readProblem.value = "";
  if (!skill || skill.estimate === null) return;
  reading.value = true;
  try {
    const result = unwrap(await api.learning.read({ skill: skill.skill })).data;
    if (token === readToken) read.value = result;
  } catch (failure) {
    if (token === readToken) readProblem.value = failure instanceof Error ? failure.message : "This skill's evidence could not be loaded. Try again.";
  } finally { if (token === readToken) reading.value = false; }
}
watch(chosen, loadRead);
const labels = computed(() => sessionLabels(read.value?.sessions ?? []));
const cases = computed(() => new Map((read.value?.cases ?? []).map((item) => [item.case, item])));
const points = computed<ChartPoint[]>(() => {
  const explanation = read.value?.explanation;
  if (!explanation) return [];
  return [{ at: explanation.start.at, kind: "START", before: null, after: explanation.start.confidence, label: KIND_NAMES.START },
    ...explanation.changes.map((change): ChartPoint => ({ at: change.at, kind: change.kind, before: change.before, after: change.after, label: kindLabel(change, cases.value, labels.value) }))];
});
const evidence = computed(() => (read.value?.explanation?.changes ?? []).map((change, index) => ({
  key: `${index}:${change.kind}:${change.source}`, mark: KIND_MARKS[change.kind], name: KIND_NAMES[change.kind], day: planDay(change.at), text: changeText(change, cases.value, labels.value),
})));
/** Where the estimate stands against the curve it would have followed left alone, in whole points as the chart labels show them. */
const summary = computed(() => {
  const s = chosenSkill.value, start = s?.leftAlone?.[0], alone = s?.leftAlone?.[1];
  if (!s || s.estimate === null || !start || !alone) return null;
  const now = Math.round(s.estimate), left = Math.round(alone.value), gap = now - left;
  const first = `Today the estimate is ${now}%. Left alone since its starting point of ${percent(start.value)} on ${planDay(start.at)}, it would be ${left}%.`;
  const second = gap > 0 ? `The changes below have kept it ${gap} ${gap === 1 ? "point" : "points"} above that.`
    : gap < 0 ? `The changes below have left it ${-gap} ${gap === -1 ? "point" : "points"} below that.`
    : evidence.value.some((row) => row.mark !== "time") ? "It is where time alone would have left it." : "Nothing but time has moved it yet.";
  const state = standing(s);
  const third = state === "DUE" ? `Its retention has already fallen to ${retention.value}%, so it is due for review.`
    : `Without practice its retention falls to ${retention.value}% on ${planDay(s.reviewBy!.at)}, in ${days(s.reviewBy!.days)}, so review it by then.`;
  return [first, second, third];
});
</script>

<template>
  <section class="memory-view" aria-labelledby="memory-title">
    <header class="memory-head">
      <PixelIcon name="memory" :size="24" /><h1 id="memory-title" class="display memory-title" tabindex="-1">Memory</h1>
      <span v-if="data" class="hint memory-count">{{ skills.length }} {{ skills.length === 1 ? "skill" : "skills" }}</span>
    </header>

    <p v-if="loading && !data" class="hint loading" role="status">Loading your memory curves…</p>
    <div v-else-if="problem && !data" class="load-problem" role="alert">
      <p class="error">{{ problem }}</p>
      <button type="button" class="secondary dawn" @click="load">Try again</button>
    </div>
    <div v-else-if="data && policy" class="memory-grid">
      <!-- 1. The default curve: what every estimate does without practice. -->
      <section class="card memory-card intro" aria-labelledby="intro-heading">
        <h2 id="intro-heading" class="display card-title">The default curve</h2>
        <p class="lead">Without practice, an estimate follows the forgetting curve of FSRS, a spaced repetition model. It falls fastest at first and more slowly as the memory grows stable<template v-if="farthest">, so 100% today is {{ percent(farthest.value) }} in {{ days(farthest.days) }}</template>.</p>
        <p class="lead">The day to review a skill by is the day its memory's retention falls to {{ retention }}%. Below {{ threshold }}%, a skill no longer counts as ready.</p>
        <p class="lead">Practice that goes well lifts the estimate and makes the memory last longer, and the fall starts again from the new value. A slip or a gap lowers it.</p>
        <figure class="intro-chart" aria-labelledby="intro-heading">
          <div ref="introBox" class="chart-box" :style="{ height: `${intro?.frame.height ?? 154}px` }">
            <svg v-if="intro" class="chart-svg" :width="intro.frame.width" :height="intro.frame.height" :viewBox="`0 0 ${intro.frame.width} ${intro.frame.height}`" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
              <rect v-for="t in intro.ticks" :key="`rule-${t.value}`" class="rule" :x="intro.frame.plot.left" :y="t.y" :width="intro.frame.plot.right - intro.frame.plot.left" height="1" />
              <rect class="rule" :x="intro.frame.plot.left" :y="intro.frame.plot.bottom" :width="intro.frame.plot.right - intro.frame.plot.left" height="1" />
              <text class="tick" :x="intro.frame.plot.left - 6" :y="intro.frame.plot.top + 4" text-anchor="end">100%</text>
              <text v-for="t in intro.ticks" :key="`tick-${t.value}`" class="tick" :x="intro.frame.plot.left - 6" :y="t.y + 4" text-anchor="end">{{ t.value }}%</text>
              <path class="threshold" :d="`M ${intro.frame.plot.left} ${intro.threshold.y + 0.5} H ${intro.frame.plot.right}`" :stroke="THRESHOLD_LINE" />
              <text class="threshold-label halo" :x="intro.frame.plot.right" :y="intro.threshold.y - 5" text-anchor="end">Not ready below {{ threshold }}%</text>
              <path class="line" :d="intro.path" :stroke="DEFAULT_LINE" pathLength="1" />
              <text v-if="intro.end" class="end arrive" :style="arrives(1)" :x="intro.end.x + 8" :y="intro.end.y + 4">{{ percent(intro.end.value) }}</text>
              <text v-for="d in intro.days" :key="d.days" class="day" :x="d.x" :y="intro.frame.axisY" :text-anchor="d.days === 0 ? 'start' : d.days === HORIZON ? 'end' : 'middle'">{{ d.days === 0 ? "Start" : `${d.days} days` }}</text>
            </svg>
          </div>
          <table class="sr-only">
            <caption>The default curve: an estimate of 100% left without practice</caption>
            <thead><tr><th scope="col">Days without practice</th><th scope="col">Estimate</th></tr></thead>
            <tbody><tr v-for="p in policy.reference" :key="p.days"><td>{{ p.days }}</td><td>{{ percent(p.value) }}</td></tr></tbody>
          </table>
        </figure>
      </section>

      <!-- 2. Your skills: every skill's estimate from today, if it is left alone. -->
      <section class="card memory-card skills" aria-labelledby="skills-heading">
        <h2 id="skills-heading" class="display card-title">Your skills</h2>
        <template v-if="curves.length">
          <p class="lead">Each line is one skill's estimate from today if you do not practise it. A flag marks its review day, when its retention falls to {{ retention }}%.</p>
          <MemoryCurves :skills="curves" :reference="policy.reference" :threshold="threshold" :as-of="data.asOf" :active="highlighted" labelledby="skills-heading" @highlight="flagged = $event" />
        </template>
        <div v-else-if="skills.length" class="empty">
          <p class="lead">None of your skills has a starting point yet. Open a skill's lesson and say how confident you feel, and its curve appears here.</p>
          <button type="button" class="secondary dawn" @click="emit('open', rows[0]!.skill)">Open {{ rows[0]!.title }}</button>
        </div>
        <div v-else class="empty">
          <p class="lead">Your skills' curves appear here once you confirm a skill. Add material, use Find skills, and confirm the skills you want to study.</p>
          <button type="button" class="primary sand" @click="emit('navigate', 'setup')">Go to Materials</button>
        </div>
      </section>

      <!-- 3. Review by: the skills in the order their reviews come due. -->
      <section v-if="rows.length" class="card memory-card review" aria-labelledby="review-heading">
        <h2 id="review-heading" class="display card-title">Review by</h2>
        <p class="lead">Skills already due come first, then the next reviews in order.</p>
        <ol class="review-rows">
          <li v-for="row in rows" :key="row.skill" class="review-row" :class="{ lit: highlighted?.includes(row.skill) }"
            @pointerenter="hoveredRow = row.skill" @pointerleave="hoveredRow = null" @focusin="hoveredRow = row.skill" @focusout="hoveredRow = null">
            <PixelIcon class="row-sprite" :sprite="stageOf(row.estimate)" :size="22" />
            <div class="row-text">
              <strong class="row-title">{{ row.title }}</strong>
              <small class="row-unit">{{ row.unitTitle }}</small>
              <MasteryCells class="row-cells" :value="row.estimate" :height="5" />
            </div>
            <span class="row-value" aria-hidden="true">{{ row.estimate === null ? "–" : percent(row.estimate) }}</span>
            <span class="row-day">
              <span v-if="standing(row) === 'DUE'" class="pill coral">{{ dayText(row).text }}</span>
              <span v-else class="day-text" :class="{ quietly: standing(row) !== 'COMING' }">{{ dayText(row).text }}</span>
              <small v-if="dayText(row).detail" class="day-detail">{{ dayText(row).detail }}</small>
            </span>
            <button type="button" class="quiet row-open" :aria-label="`Open ${row.title}`" @click="emit('open', row.skill)">Open</button>
          </li>
        </ol>
      </section>

      <!-- 4. How your curve was shaped: one skill's path from its starting point, beside the curve left alone. -->
      <section v-if="rows.length" class="card memory-card shaped" aria-labelledby="shaped-heading">
        <div class="shaped-top">
          <h2 id="shaped-heading" class="display card-title">How your curve was shaped</h2>
          <label class="chooser"><span>Skill</span>
            <select v-model="chosen">
              <option v-for="row in rows" :key="row.skill" :value="row.skill">{{ row.title }}{{ row.estimate === null ? " (no starting point yet)" : "" }}</option>
            </select>
          </label>
        </div>
        <template v-if="chosenSkill && chosenSkill.estimate !== null">
          <div v-if="summary" class="summary">
            <p v-for="(line, i) in summary" :key="i" class="lead">{{ line }}</p>
          </div>
          <p v-if="reading" class="hint loading" role="status">Loading this skill's evidence…</p>
          <div v-else-if="readProblem" role="alert" class="load-problem"><p class="error">{{ readProblem }}</p><button type="button" class="secondary dawn" @click="loadRead">Try again</button></div>
          <template v-else-if="read?.explanation && chosenSkill.projection && chosenSkill.leftAlone">
            <MemoryShaped :key="chosenSkill.skill" :points="points" :as-of="data.asOf" :estimate="chosenSkill.estimate" :projection="chosenSkill.projection"
              :review-by="chosenSkill.reviewBy" :left-alone="chosenSkill.leftAlone" :threshold="threshold" labelledby="shaped-heading" />
            <h3 class="rows-title">What moved it</h3>
            <ol class="evidence-rows">
              <li class="evidence-row">
                <span class="evidence-day">{{ planDay(read.explanation.start.at) }}</span>
                <PixelIcon :rows="MARKS.start" :size="10" :label="KIND_NAMES.START" />
                <span class="evidence-text">The estimate started at {{ percent(read.explanation.start.confidence) }}.</span>
              </li>
              <li v-for="row in evidence" :key="row.key" class="evidence-row">
                <span class="evidence-day">{{ row.day }}</span>
                <PixelIcon :rows="MARKS[row.mark]" :size="10" :label="row.name" />
                <span class="evidence-text">{{ row.text }}</span>
              </li>
            </ol>
          </template>
          <button type="button" class="secondary dawn shaped-open" @click="emit('open', chosenSkill.skill)">Open {{ chosenSkill.title }}</button>
        </template>
        <div v-else-if="chosenSkill" class="empty">
          <p class="lead">{{ chosenSkill.title }} has no starting point yet, so it has no curve. Open its lesson and say how confident you feel to start one.</p>
          <button type="button" class="secondary dawn" @click="emit('open', chosenSkill.skill)">Open {{ chosenSkill.title }}</button>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
/* The Memory view lives in the dawn biome, the lesson's family, because it reads the same evidence the lesson's
   evidence panel shows (design/visual-design.md, "Biomes"). */
.memory-view { max-width: 1220px; margin: 0 auto; }
.memory-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.memory-title { margin: 0; font-size: 22px; }
.memory-count { margin: 0; }
.memory-grid { display: grid; grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); gap: 16px; align-items: start; }
@media (max-width: 1100px) { .memory-grid { grid-template-columns: minmax(0, 1fr); } }
.memory-card { padding: 20px 22px 22px; min-width: 0; }
.card-title { margin: 0 0 8px; font-size: 20px; }
.lead { margin: 0 0 6px; color: var(--soft); font-size: 14px; line-height: 1.5; }
.empty { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.load-problem { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; }
.load-problem .error { margin: 0; }

/* The default curve's chart: the estimate chart's look. */
.intro-chart { margin: 12px 0 0; }
.chart-box { position: relative; width: 100%; }
.chart-svg { display: block; overflow: visible; }
.rule { fill: var(--ring); }
.tick, .day { font-size: 11px; fill: var(--muted); }
.threshold { fill: none; stroke-width: 1; stroke-dasharray: 4 3; }
.threshold-label { font-size: 11px; font-weight: 600; fill: var(--soft); }
.halo { paint-order: stroke; stroke: var(--card); stroke-width: 3px; stroke-linejoin: round; }
.end { font-size: 12px; font-weight: 700; fill: var(--ink); }
.line { fill: none; stroke-width: 2; stroke-linecap: square; stroke-linejoin: miter; animation: sgDraw var(--dur-draw) var(--ease-enter); }
.arrive { animation: sgFade var(--dur-quick) var(--ease-enter) calc(var(--dur-draw) * var(--arrive, 0)) both; }

/* Review by */
.review-rows { list-style: none; margin: 10px 0 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
/* Two lines per skill, so the row fits the narrow column: the skill and its value now, then the review day and Open. */
.review-row { display: grid; grid-template-columns: 26px minmax(0, 1fr) auto; grid-template-areas: "sprite text value" ". day open"; align-items: center; gap: 4px 10px; padding: 10px 10px; border-radius: 12px; transition: background-color var(--dur-quick) var(--ease-enter); }
.review-row:hover, .review-row.lit { background: var(--dawn-soft); }
.row-sprite { grid-area: sprite; align-self: start; margin-top: 1px; }
.row-text { grid-area: text; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
.row-title { font-size: 14px; overflow-wrap: anywhere; }
.row-unit { color: var(--muted); font-size: 12px; overflow-wrap: anywhere; }
.row-cells { max-width: 140px; }
.row-value { grid-area: value; align-self: start; font-size: 14px; font-weight: 700; text-align: right; }
.row-day { grid-area: day; display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
.day-text { font-size: 13px; font-weight: 700; color: var(--dawn-soft-text); }
.day-text.quietly { font-weight: 600; color: var(--muted); }
.day-detail { color: var(--muted); font-size: 12px; }
.row-open { grid-area: open; }
@media (max-width: 560px) { .review-row { padding: 10px 6px; } }

/* How your curve was shaped */
.shaped-top { display: flex; align-items: flex-end; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 8px; }
.shaped-top .card-title { margin: 0; }
.chooser { display: flex; flex-direction: column; gap: 4px; margin: 0; font-size: 12px; font-weight: 600; color: var(--muted); min-width: 0; max-width: 100%; }
.chooser select { min-height: 38px; max-width: 100%; padding: 6px 10px; border: 1px solid var(--faint); border-radius: 10px; background: var(--field); color: var(--ink); font-size: 14px; font-weight: 600; }
.summary { margin: 4px 0 12px; }
.rows-title { margin: 18px 0 6px; font-size: 14px; }
.evidence-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.evidence-row { display: grid; grid-template-columns: 92px 12px minmax(0, 1fr); align-items: baseline; gap: 10px; font-size: 13px; color: var(--soft); }
.evidence-day { color: var(--muted); font-size: 12px; white-space: nowrap; }
.evidence-text { overflow-wrap: anywhere; }
.shaped-open { margin-top: 16px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; }
</style>
