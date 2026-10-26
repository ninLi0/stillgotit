<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from "vue";
import PixelIcon from "./PixelIcon.vue";
import { arrivalStyle, useBoxWidth } from "./box-width.ts";
import { CHART, KIND_MARKS, KIND_NAMES, valueY, type ChartPoint } from "./estimate-chart.ts";
import { planDay } from "./labels.ts";
import { DEFAULT_LINE, HORIZON, THRESHOLD_LINE, layoutShaped, type DayValue, type TimedValue } from "./memory-chart.ts";
import { MARKS, PAL, SPRITES, iconRects, ringOf, type MarkName } from "./pixel-art.ts";

// "How your curve was shaped" on the Memory view (design/visual-design.md, "Charts and summaries"). One skill's estimate
// from its starting point to today, as the evidence chart draws it, continued past today by its projection on a pale
// band, over the curve it would have followed left alone from the same starting point. Markers show the starting point,
// each assessed attempt and each adjustment; a flag marks the review day. Each marker and the flag is a button whose
// label says what its tooltip shows, and a visually hidden table lists every value. The line draws itself once, from the
// starting point to the last projected day, and nothing moves after that.
const props = defineProps<{ points: ChartPoint[]; asOf: string; estimate: number; projection: DayValue[]; reviewBy: DayValue | null;
  leftAlone: TimedValue[]; threshold: number; labelledby?: string }>();

const box = ref<HTMLElement | null>(null);
const width = useBoxWidth(box, 520);
const arrives = arrivalStyle();
const layout = computed(() => layoutShaped({ past: props.points, asOf: props.asOf, estimate: props.estimate, projection: props.projection,
  reviewBy: props.reviewBy, leftAlone: props.leftAlone, threshold: props.threshold }, width.value));
const glyphs = Object.fromEntries((Object.keys(MARKS) as MarkName[]).map((name) => [name, { mark: iconRects(MARKS[name]), ring: iconRects(ringOf(MARKS[name])) }])) as Record<MarkName, { mark: ReturnType<typeof iconRects>; ring: ReturnType<typeof iconRects> }>;
const flag = iconRects(SPRITES.flag);

const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const dayAt = (days: number) => new Date(Date.parse(props.asOf) + days * 86_400_000);
function percent(value: number) { return `${Math.round(value)}%`; }
function values(point: ChartPoint) { return point.before === null ? percent(point.after) : `${percent(point.before)} → ${percent(point.after)}`; }
function spoken(point: ChartPoint) {
  const change = point.before === null ? percent(point.after) : `from ${percent(point.before)} to ${percent(point.after)}`;
  return `${planDay(point.at)}: ${point.label}, ${change}`;
}
const reviewText = computed(() => {
  const f = layout.value.flag;
  return f ? `Review by ${planDay(dayAt(f.days).toISOString())}: below ${props.threshold}% in ${f.days} ${f.days === 1 ? "day" : "days"}` : "";
});
// The date row: the starting point's day on the left when there is room for it, "Today" at the split, and the last
// projected day on the right.
const dates = computed(() => {
  const l = layout.value, first = props.points[0];
  const start = first && l.split - l.frame.inner.left >= 72 && short.format(new Date(first.at)) !== short.format(new Date(props.asOf)) ? short.format(new Date(first.at)) : "";
  return { start, end: short.format(dayAt(HORIZON)) };
});
const legend = computed(() => {
  const kinds = new Set(props.points.map((p) => p.kind));
  const items: { mark: MarkName; text: string }[] = [{ mark: "start", text: KIND_NAMES.START }];
  if (kinds.has("ATTEMPT")) items.push({ mark: "attempt", text: KIND_NAMES.ATTEMPT });
  if (kinds.has("ADJUSTMENT")) items.push({ mark: "adjustment", text: KIND_NAMES.ADJUSTMENT });
  return items;
});

// ---- Tooltip: a marker's change or the review day, on hover, focus or tap; Escape hides it ----
type Target = number | "flag";
const hovered = ref<Target | null>(null), focused = ref<Target | null>(null), pinned = ref<Target | null>(null), dismissed = ref(false);
const active = computed(() => (dismissed.value ? null : hovered.value ?? focused.value ?? pinned.value));
const tip = computed(() => {
  const l = layout.value;
  if (active.value === "flag" && l.flag) {
    return { title: `Review by ${short.format(dayAt(l.flag.days))}`, lines: [`Below ${props.threshold}% in ${l.flag.days} ${l.flag.days === 1 ? "day" : "days"}`], below: true,
      style: { left: `${Math.min(Math.max(l.flag.x, 84), l.frame.width - 84)}px`, top: `${l.flag.y + 10}px` } };
  }
  const marker = l.markers.find((m) => m.index === active.value);
  if (!marker) return null;
  const below = marker.y < 64, left = Math.min(Math.max(marker.x, 84), l.frame.width - 84);
  return { title: values(marker.point), lines: [marker.point.label, planDay(marker.point.at)], below, style: { left: `${left}px`, top: `${below ? marker.y + 14 : marker.y - 14}px` } };
});
function enter(target: Target) { hovered.value = target; dismissed.value = false; }
function focus(target: Target) { focused.value = target; dismissed.value = false; }
function tap(target: Target) {
  pinned.value = pinned.value === target ? null : target;
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
  event.stopPropagation();
  dismissed.value = true; pinned.value = null;
}
onBeforeUnmount(() => document.removeEventListener("pointerdown", outside, true));
</script>

<template>
  <figure class="memory-shaped" :aria-labelledby="labelledby">
    <div ref="box" class="chart-box" :style="{ height: `${layout.frame.height}px` }">
      <svg class="chart-svg" :width="layout.frame.width" :height="layout.frame.height" :viewBox="`0 0 ${layout.frame.width} ${layout.frame.height}`" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
        <rect class="band" :x="layout.split" :y="layout.frame.plot.top - 4" :width="layout.frame.plot.right - layout.split" :height="layout.frame.plot.bottom - layout.frame.plot.top + 4" />
        <rect v-for="t in layout.ticks" :key="`rule-${t.value}`" class="rule" :x="layout.frame.plot.left" :y="t.y" :width="layout.frame.plot.right - layout.frame.plot.left" height="1" />
        <rect class="rule" :x="layout.frame.plot.left" :y="layout.frame.plot.bottom" :width="layout.frame.plot.right - layout.frame.plot.left" height="1" />
        <text v-for="t in layout.ticks" :key="`tick-${t.value}`" class="tick" :x="layout.frame.plot.left - 6" :y="t.y + 4" text-anchor="end">{{ t.value }}%</text>
        <rect class="today" :x="layout.split" :y="layout.frame.plot.top - 4" width="1" :height="layout.frame.plot.bottom - layout.frame.plot.top + 4" />
        <path class="threshold" :d="`M ${layout.frame.plot.left} ${layout.threshold.y + 0.5} H ${layout.frame.plot.right}`" :stroke="THRESHOLD_LINE" />
        <text class="threshold-label halo" :x="layout.frame.plot.right" :y="layout.threshold.y - 5" text-anchor="end">Review below {{ threshold }}%</text>
        <path class="alone" :d="layout.leftAlone" :stroke="DEFAULT_LINE" />
        <path class="line" :d="layout.path" :stroke="PAL.m" pathLength="1" />
        <g v-for="m in layout.markers" :key="m.index" class="marker" :class="{ on: active === m.index }" :transform="`translate(${m.x - 5} ${m.y - 5})`">
          <g class="arrive" :style="arrives(m.reach)">
            <g class="ring" transform="translate(-2 -2)"><rect v-for="(r, i) in glyphs[KIND_MARKS[m.point.kind]].ring" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" /></g>
            <rect v-for="(r, i) in glyphs[KIND_MARKS[m.point.kind]].mark" :key="`m${i}`" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
          </g>
        </g>
        <text class="now halo arrive" :style="arrives(layout.todayReach)" :x="layout.split + 6" :y="valueY(estimate) - 7">{{ percent(estimate) }}</text>
        <g v-if="layout.flag" class="arrive" :style="arrives(layout.flag.reach)">
          <text class="flag-label halo" :class="{ on: active === 'flag' }" :x="Math.min(Math.max(layout.flag.x, layout.frame.plot.left + 30), layout.frame.plot.right - 30)" :y="layout.threshold.y + 17" text-anchor="middle">{{ short.format(dayAt(layout.flag.days)) }}</text>
          <g :transform="`translate(${layout.flag.x - 7} ${layout.flag.y - 12}) scale(2)`"><rect v-for="(r, k) in flag" :key="k" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" /></g>
        </g>
        <text class="day" :x="layout.frame.inner.left - 4" :y="layout.frame.axisY">{{ dates.start }}</text>
        <text class="day today-label" :x="layout.split" :y="layout.frame.axisY" :text-anchor="layout.split - layout.frame.inner.left < 24 ? 'start' : 'middle'">Today</text>
        <text class="day" :x="layout.frame.inner.right + 4" :y="layout.frame.axisY" text-anchor="end">{{ dates.end }}</text>
      </svg>
      <button v-for="m in layout.markers" :key="`hit-${m.index}`" type="button" class="hit"
        :style="{ left: `${m.x - m.hit / 2}px`, top: `${m.y - CHART.hit / 2}px`, width: `${m.hit}px`, height: `${CHART.hit}px` }"
        :aria-label="spoken(m.point)" @pointerenter="enter(m.index)" @pointerleave="hovered = null" @focus="focus(m.index)" @blur="focused = null"
        @click="tap(m.index)" @keydown.esc="escape" />
      <button v-if="layout.flag" type="button" class="hit" :style="{ left: `${layout.flag.x - 12}px`, top: `${layout.flag.y - 16}px`, width: '24px', height: '24px' }"
        :aria-label="reviewText" @pointerenter="enter('flag')" @pointerleave="hovered = null" @focus="focus('flag')" @blur="focused = null"
        @click="tap('flag')" @keydown.esc="escape" />
      <div v-if="tip" class="tip" :class="{ below: tip.below }" :style="tip.style" aria-hidden="true">
        <strong>{{ tip.title }}</strong><span v-for="(line, i) in tip.lines" :key="i" :class="{ 'tip-day': i === tip.lines.length - 1 && tip.lines.length > 1 }">{{ line }}</span>
      </div>
    </div>
    <ul class="legend" aria-hidden="true">
      <li><svg width="16" height="10" class="key"><rect x="0" y="4" width="16" height="2" :fill="PAL.m" /></svg>Your estimate</li>
      <li><svg width="16" height="10" class="key"><rect x="0" y="5" width="16" height="1" :fill="DEFAULT_LINE" /></svg>Left alone from the starting point</li>
      <li><svg width="16" height="10" class="key"><rect x="0" y="0" width="16" height="10" class="band" /></svg>Ahead, without practice</li>
      <li v-for="item in legend" :key="item.mark"><PixelIcon :rows="MARKS[item.mark]" :size="10" />{{ item.text }}</li>
      <li v-if="layout.flag"><PixelIcon sprite="flag" :size="14" />Review day</li>
    </ul>
    <table class="sr-only">
      <caption>The estimate from its starting point, then ahead without practice, beside the curve left alone</caption>
      <thead><tr><th scope="col">When</th><th scope="col">What happened</th><th scope="col">Estimate</th></tr></thead>
      <tbody>
        <tr v-for="(p, i) in points" :key="`p${i}`"><td>{{ planDay(p.at) }}</td><td>{{ p.label }}</td><td>{{ values(p) }}</td></tr>
        <tr><td>Today</td><td>Estimate now</td><td>{{ percent(estimate) }}</td></tr>
        <tr v-for="p in projection" :key="`f${p.days}`"><td>{{ planDay(dayAt(p.days).toISOString()) }}</td><td>In {{ p.days }} {{ p.days === 1 ? "day" : "days" }} without practice</td><td>{{ percent(p.value) }}</td></tr>
        <tr v-for="(p, i) in leftAlone" :key="`a${i}`"><td>{{ i === 1 ? "Today" : planDay(p.at) }}</td><td>Left alone from the starting point</td><td>{{ percent(p.value) }}</td></tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
/* The estimate chart's look, with the days ahead on a pale band right of the "Today" rule. */
.memory-shaped{margin:0}
.chart-box{position:relative;width:100%}
.chart-svg{display:block;overflow:visible}
.band{fill:var(--inset)}
.rule{fill:var(--ring)}
.today{fill:var(--faint)}
.tick,.day{font-size:11px;fill:var(--muted)}
.today-label{font-weight:700;fill:var(--ink)}
.now{font-size:12px;font-weight:700;fill:var(--ink)}
.threshold{fill:none;stroke-width:1;stroke-dasharray:4 3}
.threshold-label,.flag-label{font-size:11px;font-weight:600;fill:var(--soft)}
.flag-label.on{fill:var(--ink)}
.halo{paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round}
.alone{fill:none;stroke-width:1;stroke-linecap:square}
.line{fill:none;stroke-width:2;stroke-linecap:square;stroke-linejoin:miter;animation:sgDraw var(--dur-draw) var(--ease-enter)}
.arrive{animation:sgFade var(--dur-quick) var(--ease-enter) calc(var(--dur-draw) * var(--arrive, 0)) both}
.marker.on .ring rect{fill:var(--dawn-soft)}
.hit{position:absolute;padding:0;border:0;border-radius:4px;background:transparent;cursor:default}
.tip{position:absolute;z-index:3;display:flex;flex-direction:column;gap:1px;width:max-content;max-width:180px;padding:7px 10px;border-radius:10px;background:var(--tip);color:var(--tip-text);font-size:12px;line-height:1.35;transform:translate(-50%,-100%);pointer-events:none;box-shadow:0 10px 24px rgb(var(--shadow) / .22)}
.tip.below{transform:translateX(-50%)}
.tip strong{font-size:13px;font-weight:700}
.tip-day{color:var(--ring)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 0;padding:0;list-style:none;color:var(--muted);font-size:12px;line-height:1.4}
.legend li{display:inline-flex;align-items:center;gap:5px}
.key{flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
