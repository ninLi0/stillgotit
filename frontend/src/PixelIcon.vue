<script setup lang="ts">
import { computed } from "vue";
import { ICONS, SPRITES, iconRects, type IconName, type Stage } from "./pixel-art.ts";

// One pixel icon (12×12) or mastery sprite (7×7) drawn as crisp SVG rectangles. Decorative by default; pass a label
// when the icon carries meaning on its own.
const props = withDefaults(defineProps<{ name?: IconName; sprite?: Stage; rows?: readonly string[]; size?: number; label?: string }>(), { size: 24 });
const grid = computed(() => props.rows ?? (props.sprite ? SPRITES[props.sprite] : ICONS[props.name ?? "leaf"]));
const cells = computed(() => grid.value[0]?.length ?? 12);
const runs = computed(() => iconRects(grid.value));
</script>

<template>
  <svg class="pixel-icon" :viewBox="`0 0 ${cells} ${grid.length}`" :width="size" :height="size" shape-rendering="crispEdges"
    :aria-hidden="label ? undefined : 'true'" :role="label ? 'img' : undefined" :aria-label="label || undefined">
    <rect v-for="(r, i) in runs" :key="i" :x="r.x" :y="r.y" :width="r.w" height="1" :fill="r.fill" />
  </svg>
</template>

<style scoped>
.pixel-icon { display: inline-block; vertical-align: middle; flex: none; }
</style>
