<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import type { Stage } from "./pixel-art.ts";
import { drawTreePreview } from "./tree-draw.ts";
import type { TreeKind } from "./tree-kinds.ts";
import { currentTheme } from "./theme.ts";

// A small drawn picture of one tree kind on a strip of grass, for the tree picker and the topic's tree. It is
// decoration: the kind's name always sits next to it. `leaves` are sample leaf stages to hang on the tree.
const props = withDefaults(defineProps<{ kind: TreeKind; size?: number; leaves?: readonly Stage[] }>(), { size: 112, leaves: () => [] });
const canvas = ref<HTMLCanvasElement | null>(null);
// The preview is drawn in 2 px cells, so its size is a whole number of cells.
const css = computed(() => Math.floor(props.size / 2) * 2);
function draw() {
  if (canvas.value) drawTreePreview(canvas.value, props.kind, props.size, window.devicePixelRatio || 1, props.leaves);
}
onMounted(draw);
watch(() => [props.kind, props.size, props.leaves], draw, { flush: "post" });
// The preview is drawn by day or by night, so it draws again when the theme changes.
watch(currentTheme, draw, { flush: "post" });
</script>

<template>
  <canvas ref="canvas" class="tree-preview" aria-hidden="true" :style="{ width: `${css}px`, height: `${css}px` }" />
</template>

<style scoped>
.tree-preview { display: block; flex: none; image-rendering: pixelated; }
</style>
