<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import type { StepsWidget } from "../../src/answer-widgets.ts";

// A steps example: an ordered list that starts with its first step. "Show next step" reveals one more, "Show all" reveals
// the rest, and "Start over" goes back to the first. Each new step is announced. A learner who asked their device for
// reduced motion sees every step at once, with no controls, because revealing them one by one is a kind of motion.
const props = defineProps<{ widget: StepsWidget }>();
const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const count = ref(reduced ? props.widget.steps.length : 1);
// Only the steps the learner reveals rise into place; those shown from the start are simply there.
const startCount = count.value;
const shown = computed(() => props.widget.steps.slice(0, count.value));
const done = computed(() => count.value >= props.widget.steps.length);
const nextButton = ref<HTMLButtonElement | null>(null), againButton = ref<HTMLButtonElement | null>(null);

// When the last step appears, the reveal buttons give way to "Start over", which takes the focus they had.
async function reveal(all: boolean) {
  count.value = all ? props.widget.steps.length : Math.min(props.widget.steps.length, count.value + 1);
  if (done.value) { await nextTick(); againButton.value?.focus(); }
}
async function restart() { count.value = 1; await nextTick(); nextButton.value?.focus(); }
</script>

<template>
  <div class="steps-example">
    <ol class="steps-list" aria-live="polite" aria-relevant="additions">
      <li v-for="(step, index) in shown" :key="index" class="steps-item" :class="{ rise: index >= startCount }"><span class="steps-number" aria-hidden="true">{{ index + 1 }}</span><span class="steps-text"><span class="sr-only">Step {{ index + 1 }}: </span>{{ step }}</span></li>
    </ol>
    <div v-if="!reduced" class="steps-actions">
      <template v-if="!done">
        <button ref="nextButton" type="button" class="widget-action" @click="reveal(false)">Show next step</button>
        <button type="button" class="widget-quiet" @click="reveal(true)">Show all</button>
      </template>
      <button v-else ref="againButton" type="button" class="widget-quiet" @click="restart">Start over</button>
      <span class="steps-count">Step {{ count }} of {{ widget.steps.length }}</span>
    </div>
  </div>
</template>

<style scoped>
.steps-example{display:flex;flex-direction:column;gap:10px}
.steps-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.steps-item{display:flex;align-items:flex-start;gap:10px;font-size:14px;line-height:1.6}
.steps-number{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;margin-top:1px;border-radius:7px;background:var(--dawn-soft);color:var(--dawn-soft-text);font:500 13px/1 var(--font-display)}
.steps-text{min-width:0;overflow-wrap:anywhere}
.steps-actions{display:flex;flex-wrap:wrap;align-items:center;gap:6px 14px}
.steps-count{margin-left:auto;font-size:12px;color:var(--muted)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
</style>
