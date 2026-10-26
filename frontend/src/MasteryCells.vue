<script setup lang="ts">
import { computed } from "vue";
import { cellsOf } from "./pixel-art.ts";

// Mastery as N square cells, never a smooth bar (design/revamp/README.md). `value` is a percentage; undefined shows
// every cell empty. The default colours are the Home and Learn greens; the planner passes its blues. Colours are CSS
// values, so the tokens in style.css can change them with the theme.
const props = withDefaults(defineProps<{ value?: number | null; cells?: number; on?: string; off?: string; height?: number; gap?: number; label?: string }>(),
  { cells: 10, on: "var(--mastery-on)", off: "var(--mastery-off)", height: 6, gap: 2 });
const squares = computed(() => cellsOf(props.value ?? 0, props.cells, props.on, props.off));
const text = computed(() => props.label ?? (props.value === undefined || props.value === null ? "No estimate yet" : `${Math.round(props.value)}% estimated mastery`));
</script>

<template>
  <span class="mastery-cells" role="img" :aria-label="text" :style="{ gap: `${gap}px` }">
    <span v-for="(c, i) in squares" :key="i" class="cell" :style="{ background: c.bg, height: `${height}px` }" />
  </span>
</template>

<style scoped>
.mastery-cells { display: inline-flex; align-items: center; width: 100%; max-width: 220px; }
.cell { flex: 1 1 0; min-width: 4px; border-radius: 1px; }
</style>
