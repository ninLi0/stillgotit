<script setup lang="ts">
import { computed, nextTick, reactive, ref, useId } from "vue";
import type { SliderWidget } from "../../src/answer-widgets.ts";
import { evaluateFormula, formulaText, parseFormula } from "../../src/widget-formula.ts";
import { formatResult, formatSliderValue, snapToStep } from "./widget-values.ts";

// A slider example: one native range input for each of the formula's one or two variables, the formula's result, and
// the formula itself. Arrow keys, Page Up and Down, Home and End move a focused slider, as on any range input. The
// result is announced as it changes. Nothing here leaves the page. "Back to the starting values" appears once a slider has
// moved; it gives way when used, so focus moves to the first slider rather than falling off the page.
const props = defineProps<{ widget: SliderWidget }>();
const id = useId();
const parsed = computed(() => parseFormula(props.widget.formula));
const starting = () => Object.fromEntries(props.widget.variables.map((item) => [item.name, snapToStep(item.value, item.min, item.max, item.step)]));
const values = reactive<Record<string, number>>(starting());
const result = computed(() => parsed.value.ok ? formatResult(evaluateFormula(parsed.value.tree, values)) : "not defined for these values");
const formula = computed(() => parsed.value.ok ? formulaText(parsed.value.tree) : props.widget.formula);
// How far along its range each slider is, which colors the part of the track left of the knob.
const fill = (item: SliderWidget["variables"][number]) => `${((values[item.name]! - item.min) / (item.max - item.min)) * 100}%`;
const moved = computed(() => props.widget.variables.some((item) => values[item.name] !== snapToStep(item.value, item.min, item.max, item.step)));

function move(name: string, event: Event) { values[name] = Number((event.target as HTMLInputElement).value); }
const root = ref<HTMLElement | null>(null);
async function reset() { Object.assign(values, starting()); await nextTick(); root.value?.querySelector<HTMLInputElement>("input[type=range]")?.focus(); }
</script>

<template>
  <div ref="root" class="slider-example">
    <div v-for="item in widget.variables" :key="item.name" class="slider-row">
      <label :for="`${id}-${item.name}`" class="slider-label">{{ item.label }} <span class="slider-name">({{ item.name }})</span></label>
      <div class="slider-control">
        <input :id="`${id}-${item.name}`" type="range" :min="item.min" :max="item.max" :step="item.step" :value="values[item.name]" :style="{ '--fill': fill(item) }"
          :aria-valuetext="formatSliderValue(values[item.name]!, item.step)" @input="move(item.name, $event)" />
        <output :for="`${id}-${item.name}`" class="slider-value">{{ formatSliderValue(values[item.name]!, item.step) }}</output>
      </div>
      <p class="slider-range" aria-hidden="true"><span>{{ formatSliderValue(item.min, item.step) }}</span><span>{{ formatSliderValue(item.max, item.step) }}</span></p>
    </div>
    <p class="slider-result" aria-live="polite" aria-atomic="true"><span class="result-label">{{ widget.output }}</span><output class="result-value">{{ result }}</output></p>
    <p class="slider-formula"><span class="sr-only">Formula: </span>{{ widget.output }} = {{ formula }}</p>
    <button v-if="moved" type="button" class="widget-quiet" @click="reset">Back to the starting values</button>
  </div>
</template>

<style scoped>
.slider-example{display:flex;flex-direction:column;gap:12px}
.slider-row{display:flex;flex-direction:column;gap:4px}
.slider-label{margin:0;font-size:13px;font-weight:600;color:var(--ink)}
.slider-name{font-weight:400;color:var(--muted)}
.slider-control{display:flex;align-items:center;gap:12px}
/* The range input is drawn here rather than by the browser, whose colors depend on the browser and the accent: a 6 px
   track in the inset grey, filled in the dawn edge color up to a white knob (the card color in dark mode) with a dark
   dawn ring, which keeps 10:1 against the card's background in both themes. Forced colors keep the system's own slider. */
.slider-control input[type=range]{--fill:0%;flex:1;min-width:0;width:auto;height:32px;min-height:32px;margin:0;padding:0;border:0;border-radius:0;background:transparent;-webkit-appearance:none;appearance:none;cursor:pointer}
.slider-control input[type=range]::-webkit-slider-runnable-track{height:6px;border-radius:999px;background:linear-gradient(to right,var(--dawn-edge) var(--fill),var(--inset-3) var(--fill))}
.slider-control input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;margin-top:-7px;border:2px solid var(--dawn-soft-text);border-radius:50%;background:var(--card)}
.slider-control input[type=range]::-moz-range-track{height:6px;border-radius:999px;background:var(--inset-3)}
.slider-control input[type=range]::-moz-range-progress{height:6px;border-radius:999px;background:var(--dawn-edge)}
.slider-control input[type=range]::-moz-range-thumb{box-sizing:border-box;width:20px;height:20px;border:2px solid var(--dawn-soft-text);border-radius:50%;background:var(--card)}
.slider-control input[type=range]:focus-visible{outline:2px solid var(--focus);outline-offset:3px;box-shadow:none}
@media (forced-colors: active){.slider-control input[type=range]{-webkit-appearance:auto;appearance:auto}}
.slider-value{flex:none;min-width:56px;padding:2px 8px;border-radius:8px;background:var(--card);box-shadow:0 0 0 1px var(--lesson-chip-line);font-size:14px;font-weight:700;text-align:center;font-variant-numeric:tabular-nums}
.slider-range{display:flex;justify-content:space-between;margin:0;padding-right:68px;font-size:11px;color:var(--muted)}
.slider-result{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:4px 12px;margin:2px 0 0;padding:10px 12px;border-radius:10px;background:var(--dawn-soft);color:var(--dawn-soft-text)}
.result-label{font-size:13px;font-weight:600}
.result-value{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.slider-example > .widget-quiet{align-self:flex-start}
.slider-formula{margin:0;font:13px/1.6 var(--font-mono);color:var(--soft);overflow-wrap:anywhere}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style>
