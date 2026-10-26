<script setup lang="ts">
import { computed } from "vue";
import { secondsLabel, sourcesLabel } from "./labels.ts";
// One line under a tutor answer: "Answered in 7 s · 2 sources · Gemini 3.8 Flash · Medium thinking".
// `seconds` is the answer time, `sources` the number of sources the answer cites, and `tutor` the model and level label.
// A part the page cannot tell is left out, and the line is left out when no part is known.
const props = defineProps<{ seconds?: number | null; sources?: number; tutor?: string }>();
const parts = computed(() => [
  props.seconds === null || props.seconds === undefined ? "" : `Answered in ${secondsLabel(props.seconds)}`,
  props.sources ? sourcesLabel(props.sources) : "",
  props.tutor ?? "",
].filter(Boolean));
</script>

<template>
  <p v-if="parts.length" class="reply-meta">{{ parts.join(" · ") }}</p>
</template>

<style scoped>
.reply-meta{margin:8px 0 0;font-size:11px;line-height:1.5;color:var(--faint);overflow-wrap:anywhere}
</style>
