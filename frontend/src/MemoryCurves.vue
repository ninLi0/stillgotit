<script setup lang="ts">
import { computed, ref } from "vue";
import PixelIcon from "./PixelIcon.vue";
import { arrivalStyle, useBoxWidth } from "./box-width.ts";
import { DEFAULT_LINE, HORIZON, STAGE_LINES, THRESHOLD_LINE, layoutSkills, type DayValue } from "./memory-chart.ts";
import { SPRITES, STAGE_LABELS, iconRects, stageOf } from "./pixel-art.ts";

// "Your skills" on the Memory view (design/visual-design.md, "Charts and summaries"): every skill's projected estimate
// from today to 90 days ahead, each in its growth stage's green, over the default curve from 100% (a 1 px slate line), with a flag on each
// skill's review day, when its memory's retention falls to the policy's desired retention. A flag is a button: hovering, focusing or tapping it names the skills and the
// day and brings their lines forward, and a visually hidden table lists every value. `active` names the skills the view
// brings forward from outside, such as a hovered row of the "Review by" list. The lines draw themselves once when the
// view opens, and nothing moves after that.
export type CurveSkill = { skill: string; title: string; estimate: number; projection: DayValue[]; reviewBy: DayValue | null };
const props = defineProps<{ skills: CurveSkill[]; reference: DayValue[]; threshold: number; asOf: string; active: readonly string[] | null; labelledby?: string }>();
const emit = defineEmits<{ highlight: [skills: string[] | null] }>();

const box = ref<HTMLElement | null>(null);
const width = useBoxWidth(box, 520);
const arrives = arrivalStyle();
const short = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
const long = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
const dayAt = (days: number) => new Date(Date.parse(props.asOf) + days * 86_400_000);
const layout = computed(() => layoutSkills(props.skills, props.reference, props.threshold, width.value, (days) => short.format(dayAt(days))));
const flag = iconRects(SPRITES.flag);
const titles = computed(() => new Map(props.skills.map((s) => [s.skill, s.title])));
function percent(value: number) { return `${Math.round(value)}%`; }
function spoken(skills: string[], days: number) {
  return `${skills.map((id) => titles.value.get(id)).join(", ")}: below ${props.threshold}% on ${long.format(dayAt(days))}, in ${days} ${days === 1 ? "day" : "days"}`;
}
// The legend names the stages drawn, then the default curve, the threshold and the flag.
const stages = computed(() => (["sprout", "leaf", "full", "bloom"] as const).filter((stage) => props.skills.some((s) => stageOf(s.estimate) === stage)));

// ---- Tooltip and highlight: a flag's skills on hover, focus or tap; Escape hides it ----
const hovered = ref<number | null>(null), focused = ref<number | null>(null), pinned = ref<number | null>(null);
const shown = computed(() => hovered.value ?? focused.value ?? pinned.value);
const tip = computed(() => {
  const f = shown.value === null ? null : layout.value.flags[shown.value];
  if (!f) return null;
  const left = Math.min(Math.max(f.x, 90), layout.value.frame.width - 90), below = f.y < 70;
  return { flag: f, below, style: { left: `${left}px`, top: `${below ? f.y + 10 : f.y - 16}px` } };
});
function show(index: number | null, how: "hover" | "focus" | "tap") {
  if (how === "hover") hovered.value = index; else if (how === "focus") focused.value = index; else pinned.value = pinned.value === index ? null : index;
  const f = shown.value === null ? null : layout.value.flags[shown.value];
  emit("highlight", f ? [...f.skills] : null);
}
function hide(event: KeyboardEvent) {
  if (shown.value === null) return;
  event.stopPropagation();
  hovered.value = focused.value = pinned.value = null;
  emit("highlight", null);
}
</script>

<template>
  <figure class="memory-curves" :aria-labelledby="labelledby">
    <div ref="box" class="chart-box" :style="{ height: `${layout.frame.height}px` }">
      <svg class="chart-svg" :width="layout.frame.width" :height="layout.frame.height" :viewBox="`0 0 ${layout.frame.width} ${layout.frame.height}`" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
        <rect v-for="t in layout.ticks" :key="`rule-${t.value}`" class="rule" :x="layout.frame.plot.left" :y="t.y" :width="layout.frame.plot.right - layout.frame.plot.left" height="1" />
        <rect class="rule" :x="layout.frame.plot.left" :y="layout.frame.plot.bottom" :width="layout.frame.plot.right - layout.frame.plot.left" height="1" />
        <text v-for="t in layout.ticks" :key="`tick-${t.value}`" class="tick" :x="layout.frame.plot.left - 6" :y="t.y + 4" text-anchor="end">{{ t.value }}%</text>
        <path class="threshold" :d="`M ${layout.frame.plot.left} ${layout.threshold.y + 0.5} H ${layout.frame.plot.right}`" :stroke="THRESHOLD_LINE" />
        <text class="threshold-label halo" :x="layout.frame.plot.right" :y="layout.threshold.y - 5" text-anchor="end">Not ready below {{ threshold }}%</text>
        <path class="reference" :d="layout.reference" :stroke="DEFAULT_LINE" />
        <path v-for="line in layout.lines" :key="line.skill" class="line" :class="{ dim: !!active && !active.includes(line.skill), lit: !!active?.includes(line.skill) }" :d="line.d" :stroke="line.color" pathLength="1" />
        <g v-for="(f, i) in layout.flags" :key="f.days" class="arrive" :style="arrives(f.reach)">
          <rect v-if="f.lane > 0" class="leader" :x="f.x" :y="layout.threshold.y + 4" width="1" :height="f.lane * 13 + 2" />
          <text class="flag-label halo" :class="{ on: shown === i }" :x="Math.min(Math.max(f.x, layout.frame.plot.left + 20), layout.frame.plot.right - 20)" :y="layout.threshold.y + 17 + f.lane * 13" text-anchor="middle">{{ f.label }}</text>
          <g :transform="`translate(${f.x - 7} ${f.y - 12}) scale(2)`"><rect v-for="(r, k) in flag" :key="k" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" /></g>
        </g>
        <text v-for="d in layout.days" :key="d.days" class="day" :x="d.x" :y="layout.frame.axisY" :text-anchor="d.days === 0 ? 'start' : d.days === HORIZON ? 'end' : 'middle'">{{ d.days === 0 ? "Today" : short.format(dayAt(d.days)) }}</text>
      </svg>
      <button v-for="(f, i) in layout.flags" :key="`hit-${f.days}`" type="button" class="hit" :style="{ left: `${f.x - 12}px`, top: `${f.y - 16}px` }"
        :aria-label="spoken(f.skills, f.days)" @pointerenter="show(i, 'hover')" @pointerleave="show(null, 'hover')" @focus="show(i, 'focus')" @blur="show(null, 'focus')"
        @click="show(i, 'tap')" @keydown.esc="hide" />
      <div v-if="tip" class="tip" :class="{ below: tip.below }" :style="tip.style" aria-hidden="true">
        <strong>{{ long.format(dayAt(tip.flag.days)) }}</strong>
        <span v-for="id in tip.flag.skills" :key="id">{{ titles.get(id) }}</span>
        <span class="tip-note">Below {{ threshold }}% in {{ tip.flag.days }} {{ tip.flag.days === 1 ? "day" : "days" }}</span>
      </div>
    </div>
    <ul class="legend" aria-hidden="true">
      <li v-for="stage in stages" :key="stage"><svg width="16" height="10" class="key"><rect x="0" y="4" width="16" height="2" :fill="STAGE_LINES[stage]" /></svg><PixelIcon :sprite="stage" :size="14" />{{ STAGE_LABELS[stage] }}</li>
      <li><svg width="16" height="10" class="key"><rect x="0" y="5" width="16" height="1" :fill="DEFAULT_LINE" /></svg>Default curve from 100%</li>
      <li><svg width="16" height="10" class="key"><rect x="0" y="5" width="5" height="1" :fill="THRESHOLD_LINE" /><rect x="8" y="5" width="5" height="1" :fill="THRESHOLD_LINE" /></svg>Not ready below {{ threshold }}%</li>
      <li><PixelIcon sprite="flag" :size="14" />Review day</li>
    </ul>
    <table class="sr-only">
      <caption>Projected estimate of each skill without practice</caption>
      <thead><tr><th scope="col">Skill</th><th scope="col">Today</th><th v-for="p in skills[0]?.projection ?? []" :key="p.days" scope="col">In {{ p.days }} {{ p.days === 1 ? "day" : "days" }}</th><th scope="col">Review by</th></tr></thead>
      <tbody>
        <tr v-for="s in skills" :key="s.skill"><th scope="row">{{ s.title }}</th><td>{{ percent(s.estimate) }}</td><td v-for="p in s.projection" :key="p.days">{{ percent(p.value) }}</td>
          <td>{{ s.reviewBy ? long.format(dayAt(s.reviewBy.days)) : "Now" }}</td></tr>
      </tbody>
    </table>
  </figure>
</template>

<style scoped>
/* The estimate chart's look: 1px ring-grey rules, 2px lines, whole pixels, marks in a halo of the card's color. */
.memory-curves{margin:0}
.chart-box{position:relative;width:100%}
.chart-svg{display:block;overflow:visible}
.rule{fill:var(--ring)}
.tick,.day{font-size:11px;fill:var(--muted)}
.threshold{fill:none;stroke-width:1;stroke-dasharray:4 3}
.threshold-label,.flag-label{font-size:11px;font-weight:600;fill:var(--soft)}
.flag-label.on{fill:var(--ink)}
.halo{paint-order:stroke;stroke:var(--card);stroke-width:3px;stroke-linejoin:round}
.leader{fill:var(--faint)}
.reference{fill:none;stroke-width:1;stroke-linecap:square}
.line{fill:none;stroke-width:2;stroke-linecap:square;stroke-linejoin:miter;animation:sgDraw var(--dur-draw) var(--ease-enter);transition:opacity var(--dur-quick) var(--ease-enter)}
.line.dim{opacity:.25}
.line.lit{stroke-width:3}
.arrive{animation:sgFade var(--dur-quick) var(--ease-enter) calc(var(--dur-draw) * var(--arrive, 0)) both}
.hit{position:absolute;width:24px;height:24px;padding:0;border:0;border-radius:4px;background:transparent;cursor:default}
.tip{position:absolute;z-index:3;display:flex;flex-direction:column;gap:1px;width:max-content;max-width:200px;padding:7px 10px;border-radius:10px;background:var(--tip);color:var(--tip-text);font-size:12px;line-height:1.35;transform:translate(-50%,-100%);pointer-events:none;box-shadow:0 10px 24px rgb(var(--shadow) / .22)}
.tip.below{transform:translateX(-50%)}
.tip strong{font-size:13px;font-weight:700}
.tip-note{color:var(--ring)}
.legend{display:flex;flex-wrap:wrap;gap:4px 14px;margin:8px 0 0;padding:0;list-style:none;color:var(--muted);font-size:12px;line-height:1.4}
.legend li{display:inline-flex;align-items:center;gap:5px}
.key{flex:none}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
