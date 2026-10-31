<script setup lang="ts">
import { nextTick, ref } from "vue";
import type { ChoiceWidget } from "../../src/answer-widgets.ts";

// A choice example: the question (the example's title), two to five options, and, once the learner picks one, whether
// it was right and the tutor's one-sentence explanation. It stays on this page: nothing is sent to the server, saved, or
// counted as practice or evidence, and the estimate does not change. "Try again" clears the pick.
// After a pick the options stay focusable but no longer change the pick, so focus never falls off a disabled button.
const props = defineProps<{ widget: ChoiceWidget }>();
const picked = ref<string | null>(null);
const options = ref<HTMLElement | null>(null);

function pick(option: string) { if (picked.value === null) picked.value = option; }
async function again() { picked.value = null; await nextTick(); options.value?.querySelector<HTMLButtonElement>("button")?.focus(); }
const mark = (option: string) => picked.value === null ? "" : option === props.widget.answer ? "Correct answer" : option === picked.value ? "Your choice" : "";
</script>

<template>
  <div class="choice-example">
    <ul ref="options" class="choice-options">
      <li v-for="(option, index) in widget.options" :key="index">
        <button type="button" class="choice-option" :class="{ chosen: picked === option, right: picked !== null && option === widget.answer, wrong: picked === option && option !== widget.answer }"
          :aria-pressed="picked === option" :aria-disabled="picked !== null" @click="pick(option)">
          <span class="choice-letter" aria-hidden="true">{{ String.fromCharCode(65 + index) }}</span>
          <span class="choice-text">{{ option }}</span>
          <span v-if="mark(option)" class="choice-mark"><span aria-hidden="true">{{ option === widget.answer ? "✓ " : "✗ " }}</span>{{ mark(option) }}</span>
        </button>
      </li>
    </ul>
    <div role="status">
      <p v-if="picked !== null" class="choice-feedback" :class="{ right: picked === widget.answer }">
        <strong>{{ picked === widget.answer ? "Right." : `Not quite. The answer is “${widget.answer}”.` }}</strong> {{ widget.explanation }}
      </p>
    </div>
    <div v-if="picked !== null" class="choice-actions"><button type="button" class="widget-quiet" @click="again">Try again</button></div>
  </div>
</template>

<style scoped>
.choice-example{display:flex;flex-direction:column;gap:10px}
.choice-options{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.choice-option{display:flex;align-items:center;gap:10px;width:100%;padding:8px 12px;border:1px solid var(--lesson-chip-line);border-radius:10px;background:var(--card);color:var(--ink);font-size:14px;line-height:1.5;text-align:left}
.choice-option:hover:not([aria-disabled="true"]){border-color:var(--lesson-chip-hover);background:var(--lesson-source)}
.choice-option[aria-disabled="true"]{cursor:default}
.choice-option.chosen{box-shadow:0 0 0 1px var(--dawn-edge);border-color:var(--dawn-edge)}
.choice-option.right{border-color:var(--strong);background:var(--strong-wash)}
.choice-option.wrong{border-color:var(--coral-text);background:var(--coral-wash)}
/* The learner's pick keeps its doubled edge, in the color of its result. */
.choice-option.chosen.right{box-shadow:0 0 0 1px var(--strong)}
.choice-option.chosen.wrong{box-shadow:0 0 0 1px var(--coral-text)}
.choice-letter{flex:none;display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:var(--inset);color:var(--soft);font:500 13px/1 var(--font-display)}
.choice-text{flex:1;min-width:0;overflow-wrap:anywhere}
.choice-mark{flex:none;font-size:12px;font-weight:700}
.right .choice-mark{color:var(--strong)}
.wrong .choice-mark{color:var(--coral-text)}
.choice-feedback{margin:0;padding:10px 12px;border-radius:10px;background:var(--coral-wash);color:var(--coral-text);font-size:14px;line-height:1.6}
.choice-feedback.right{background:var(--strong-wash);color:var(--strong)}
.choice-actions{display:flex}
</style>
