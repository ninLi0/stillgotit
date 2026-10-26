<script setup lang="ts">
import MasteryCells from "./MasteryCells.vue";
import PixelIcon from "./PixelIcon.vue";
import type { Stage } from "./pixel-art.ts";

// The Forest view's course summary (design/visual-design.md, "Charts and summaries"): the average over the skills
// with an estimate, as a number beside 20 mastery cells, and how many skills are mastered, growing, new and due
// today, each with its sprite. The Forest view computes every figure; this only lays them out.
defineProps<{ headingId: string; average: number | null; note: string; counts: { key: string; sprite: Stage; n: number; label: string }[] }>();
</script>

<template>
  <section class="course-progress" :aria-labelledby="headingId">
    <h3 :id="headingId" class="eyebrow">Course progress</h3>
    <div class="average">
      <span class="average-pct">{{ average === null ? "–" : `${average}%` }}</span>
      <span class="average-note"><template v-if="average !== null">average mastery<br /></template>{{ note }}</span>
    </div>
    <MasteryCells class="average-cells" :value="average" :cells="20" :height="10" off="var(--mastery-off-soft)" />
    <ul class="counts" aria-label="Skills by stage">
      <li v-for="c in counts" :key="c.key" class="count" :class="{ none: c.n === 0 }">
        <span class="count-figure"><PixelIcon :sprite="c.sprite" :size="21" /><strong>{{ c.n }}</strong></span>
        <span class="count-label">{{ c.label }}</span>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.course-progress .eyebrow { margin-bottom: 6px; }
.average { display: flex; align-items: baseline; gap: 10px; }
.average-pct { font-size: 34px; font-weight: 700; line-height: 1; letter-spacing: -1px; }
.average-note { font-size: 14px; line-height: 1.35; color: var(--muted); }
.course-progress .average-cells { margin-top: 10px; max-width: none; }
/* Two columns of small tiles, the number and sprite over the label, so a label never breaks inside a word at any
   width the aside takes: 280px or 340px beside the forest, or a full phone width below it. */
.counts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; margin: 12px 0 0; padding: 0; list-style: none; }
.count { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 7px 10px 8px; border-radius: 12px; background: var(--inset); }
.count-figure { display: flex; align-items: center; gap: 7px; }
.count strong { font-size: 17px; font-weight: 700; line-height: 1.2; }
.count-label { font-size: 12px; line-height: 1.3; color: var(--muted); }
.count.none strong { color: var(--muted); }
</style>
