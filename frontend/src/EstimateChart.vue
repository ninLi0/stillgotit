<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import PixelIcon from "./PixelIcon.vue";
import { CHART, KIND_MARKS, KIND_NAMES, layoutChart, type ChartPoint } from "./estimate-chart.ts";
import { planDay } from "./labels.ts";
import { readCurve, timeToReach } from "./motion.ts";
import { MARKS, PAL, iconRects, ringOf, type MarkName } from "./pixel-art.ts";

// The estimate over time (design/visual-design.md, "Charts and summaries"). A stepped line in the mastery green runs
// from the starting point through every change to now; time without practice lowers it in falling stairs. Markers
// show the starting point, each assessed attempt and each adjustment. Each marker is a button whose label says what
// its tooltip shows, and a visually hidden table lists every row, so nothing is reachable only by pointing.
// When the chart appears (the evidence opening), the line draws itself from the starting point to today on the
// entrance curve, and each marker and the value now appear as the line reaches them (design/visual-design.md,
// "Motion"). Nothing in the chart moves after that.
const props = defineProps<{ points: ChartPoint[]; provisional: boolean; labelledby?: string }>();

// When, as a share of the draw duration, the line arrives at a marker. The line's last few pixels land so softly that
// a marker waiting for them would look late, so a marker at the very end appears when 98% of the line is drawn.
const entrance = readCurve("--ease-enter");
function arrives(reach: number) { return { "--arrive": timeToReach(entrance, Math.min(reach, 0.98)).toFixed(3) }; }

const box = ref<HTMLElement | null>(null);
const width = ref(260);
let observer: ResizeObserver | null = null;
function measure() {
  const w = Math.floor(box.value?.clientWidth ?? 0);
  if (w > 0 && w !== width.value) width.value = w;
}
const layout = computed(() => layoutChart(props.points, width.value));

const glyphs = Object.fromEntries((Object.keys(MARKS) as MarkName[]).map((name) => [name, { mark: iconRects(MARKS[name]), ring: iconRects(ringOf(MARKS[name])) }])) as Record<MarkName, { mark: ReturnType<typeof iconRects>; ring: ReturnType<typeof iconRects> }>;

function percent(value: number) { return `${Math.round(value)}%`; }
function values(point: ChartPoint) { return point.before === null ? percent(point.after) : `${percent(point.before)} → ${percent(point.after)}`; }
function spoken(point: ChartPoint) {
  const change = point.before === null ? percent(point.after) : `from ${percent(point.before)} to ${percent(point.after)}`;
  return `${planDay(point.at)}: ${point.label}, ${change}`;
}

// The date row: the first day on the left, the last on the right ("Today" when it is today), once if they match.
const dates = computed(() => {
  const first = props.points[0], last = props.points.at(-1);
  if (!first || !last) return { first: "", last: "" };
  const today = planDay(new Date().toISOString()), from = planDay(first.at), to = planDay(last.at);
  const name = (day: string) => (day === today ? "Today" : day);
  return { first: name(from), last: props.points.length > 1 && to !== from ? name(to) : "" };
});
// The legend names only the marks this chart draws. The stair appears wherever time lowered the estimate.
const legend = computed(() => {
  const kinds = new Set(props.points.map((p) => p.kind));
  const lowered = props.points.some((p, i) => i > 0 && p.kind !== "TIME" && p.before !== null && Math.round(p.before) < Math.round(props.points[i - 1]!.after));
  const items: { mark: MarkName; text: string }[] = [{ mark: "start", text: KIND_NAMES.START }];
  if (kinds.has("ATTEMPT")) items.push({ mark: "attempt", text: KIND_NAMES.ATTEMPT });
  if (kinds.has("ADJUSTMENT")) items.push({ mark: "adjustment", text: KIND_NAMES.ADJUSTMENT });
  if (kinds.has("TIME") || lowered) items.push({ mark: "time", text: KIND_NAMES.TIME });
  return items;
});
const note = computed(() => {
  if (!props.provisional) return "";
  return props.points.some((p) => p.kind === "ADJUSTMENT")
    ? "No assessed attempt yet, so only your adjustments and time have moved it."
    : "No assessed attempt yet, so only time has moved it.";
});

// ---- Tooltip: shown on hover, on keyboard focus, or after a tap; Escape hides it ----
const hovered = ref<number | null>(null), focused = ref<number | null>(null), pinned = ref<number | null>(null), dismissed = ref(false);
const active = computed(() => (dismissed.value ? null : hovered.value ?? focused.value ?? pinned.value));
const tip = computed(() => {
  const marker = layout.value.markers.find((m) => m.index === active.value);
  if (!marker) return null;
  const below = marker.y < 64, left = Math.min(Math.max(marker.x, 74), layout.value.width - 74);
  return { point: marker.point, below, style: { left: `${left}px`, top: `${below ? marker.y + 14 : marker.y - 14}px` } };
});
function enter(index: number) { hovered.value = index; dismissed.value = false; }
function focus(index: number) { focused.value = index; dismissed.value = false; }
function tap(index: number) {
  pinned.value = pinned.value === index ? null : index;
  dismissed.value = false;
  if (pinned.value !== null) document.addEventListener("pointerdown", outside, true);
}
function outside(event: Event) {
  if (box.value?.contains(event.target as Node)) return;
  pinned.value = null;
  document.removeEventListener("pointerdown", outside, true);
}
function escape(event: KeyboardEvent) {
  if (active.value === null) return;
  // The first Escape hides the tooltip; the next one reaches the rail, which closes it on narrow screens.
  event.stopPropagation();
  dismissed.value = true; pinned.value = null;
}

onMounted(() => {
  measure();
  if (box.value && typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(measure); observer.observe(box.value); }
});
onBeforeUnmount(() => { observer?.disconnect(); document.removeEventListener("pointerdown", outside, true); });
</script>

<template>
  <figure class="estimate-chart rise" :aria-labelledby="labelledby">
    <div ref="box" class="chart-box" :style="{ height: `${layout.height}px` }">
      <svg class="chart-svg" :width="layout.width" :height="layout.height" :viewBox="`0 0 ${layout.width} ${layout.height}`" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
        <rect v-for="t in layout.ticks" :key="`line-${t.value}`" class="rule" :x="layout.plot.left" :y="t.y" :width="layout.plot.right - layout.plot.left" height="1" />
        <rect class="rule" :x="layout.plot.left" :y="layout.plot.bottom" :width="layout.plot.right - layout.plot.left" height="1" />
        <text v-for="t in layout.ticks" :key="`label-${t.value}`" class="tick" :x="layout.plot.left - 6" :y="t.y + 4" text-anchor="end">{{ t.value }}%</text>
        <path class="line" :d="layout.path" :stroke="PAL.m" pathLength="1" />
        <g v-for="m in layout.markers" :key="m.index" class="marker" :class="{ on: active === m.index }" :transform="`translate(${m.x - 5} ${m.y - 5})`">
          <g class="arrive" :style="arrives(m.reach)">
            <g class="ring" transform="translate(-2 -2)"><rect v-for="(r, i) in glyphs[KIND_MARKS[m.point.kind]].ring" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" /></g>
            <rect v-for="(r, i) in glyphs[KIND_MARKS[m.point.kind]].mark" :key="`m${i}`" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
          </g>
        </g>
        <text class="now arrive" :style="arrives(1)" :x="layout.end.x + 10" :y="layout.end.y + 4">{{ percent(layout.end.value) }}</text>
        <text class="day" :x="layout.plot.left + CHART.inset - 4" :y="layout.axisY">{{ dates.first }}</text>
        <text v-if="dates.last" class="day" :x="layout.end.x + 4" :y="layout.axisY" text-anchor="end">{{ dates.last }}</text>
      </svg>
      <button v-for="m in layout.markers" :key="`hit-${m.index}`" type="button" class="hit"
        :style="{ left: `${m.x - m.hit / 2}px`, top: `${m.y - CHART.hit / 2}px`, width: `${m.hit}px`, height: `${CHART.hit}px` }"
        :aria-label="spoken(m.point)" @pointerenter="enter(m.index)" @pointerleave="hovered = null" @focus="focus(m.index)" @blur="focused = null"
        @click="tap(m.index)" @keydown.esc="escape" />
      <div v-if="tip" class="tip" :class="{ below: tip.below }" :style="tip.style" aria-hidden="true">
        <strong>{{ values(tip.point) }}</strong><span>{{ tip.point.label }}</span><span class="tip-day">{{ planDay(tip.point.at) }}</span>
      </div>
    </div>
    <p v-if="note" class="note">{{ note }}</p>
    <ul class="legend" aria-hidden="true">
      <li v-for="item in legend" :key="item.mark"><PixelIcon :rows="MARKS[item.mark]" :size="10" />{{ item.text }}</li>
    </ul>
    <table class="sr-only">
      <caption>Estimate over time, one row per change</caption>
      <thead><tr><th scope="col">Date</th><th scope="col">Event</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
      <tbody>
        <tr v-for="(p, i) in points" :key="i"><td>{{ planDay(p.at) }}</td><td>{{ p.label }}</td><td>{{ p.before === null ? "None" : percent(p.before) }}</td><td>{{ percent(p.after) }}</td></tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
/* Lines are 1px hairlines in the ring grey, the estimate is a 2px line, and markers carry a 2px ring in the card color. */
.estimate-chart{margin:4px 0 0}
.chart-box{position:relative;width:100%}
.chart-svg{display:block;overflow:visible}
.rule{fill:var(--ring)}
.tick,.day{font-size:11px;fill:var(--muted)}
.now{font-size:12px;font-weight:700;fill:var(--ink)}
.line{fill:none;stroke:var(--mastery-on);stroke-width:2;stroke-linecap:square;stroke-linejoin:miter;animation:sgDraw var(--dur-draw) var(--ease-enter)}
/* Markers and the value now fade in as the line reaches them; --arrive is that moment as a share of the draw. */
.arrive{animation:sgFade var(--dur-quick) var(--ease-enter) calc(var(--dur-draw) * var(--arrive, 0)) both}
.ring rect{fill:var(--card)}
.marker.on .ring rect{fill:var(--dawn-soft)}
.hit{position:absolute;padding:0;border:0;border-radius:4px;background:transparent;cursor:default}
.tip{position:absolute;z-index:3;display:flex;flex-direction:column;gap:1px;width:max-content;max-width:180px;padding:7px 10px;border-radius:10px;background:var(--tip);color:var(--tip-text);font-size:12px;line-height:1.35;transform:translate(-50%,-100%);pointer-events:none;box-shadow:0 10px 24px rgb(var(--shadow) / .22)}
.tip.below{transform:translateX(-50%)}
.tip strong{font-size:13px;font-weight:700}
.tip-day{color:var(--ring)}
.note{margin:4px 0 0;color:var(--soft);font-size:12px;line-height:1.45}
.legend{display:flex;flex-wrap:wrap;gap:4px 12px;margin:6px 0 0;padding:0;list-style:none;color:var(--muted);font-size:11px;line-height:1.4}
.legend li{display:inline-flex;align-items:center;gap:5px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
