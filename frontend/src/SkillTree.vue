<script setup lang="ts">
import { computed } from "vue";
import TreeMark from "./TreeMark.vue";
const props = defineProps<{ skills: { skill: string; title: string; status: string; mastery?: number }[]; selected: string | null }>();
const emit = defineEmits<{ select: [skill: string] }>();
const positions = [
  [224, 190, -37], [456, 222, 39], [166, 309, -56], [518, 334, 54],
  [345, 111, 3], [128, 174, -43], [541, 169, 40], [284, 305, -24],
];
const leaves = computed(() => props.skills.filter((skill) => skill.status === "CONFIRMED").map((skill, index) => {
  const point = positions[index % positions.length]!;
  return { ...skill, x: point[0]!, y: point[1]! + Math.floor(index / positions.length) * 350, angle: point[2]!,
    lines: wrap(skill.title) };
}));
const height = computed(() => 560 + Math.floor(Math.max(0, leaves.value.length - 1) / positions.length) * 350);
function wrap(title: string) {
  const words = title.split(" "), lines: string[] = []; let line = "";
  for (const word of words) { if (line.length + word.length > 24 && line) { lines.push(line); line = word; } else line += (line ? " " : "") + word; }
  if (line) lines.push(line); return lines;
}
</script>
<template>
  <figure class="living-tree">
    <div v-if="!leaves.length" class="empty-tree"><TreeMark /><p>Your next skill starts here.</p></div>
    <template v-else>
      <svg :viewBox="`0 0 700 ${height}`" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Your skill tree. Each leaf is a confirmed skill.">
        <defs><radialGradient id="tree-ground"><stop offset="0" stop-color="#f1f1f1"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
        <ellipse cx="350" :cy="height - 54" rx="190" ry="30" fill="url(#tree-ground)" />
        <path :d="`M347 ${height - 55} C367 ${height - 175},325 264,347 122 M352 ${height - 60} C371 ${height - 176},335 272,350 137`" class="trunk"/>
        <path :d="`M349 ${height - 92} Q329 ${height - 58} 290 ${height - 49} M351 ${height - 91} Q374 ${height - 56} 407 ${height - 50} M349 ${height - 65} L342 ${height - 42}`" class="branch"/>
        <g v-for="leaf in leaves" :key="leaf.skill">
          <path :d="`M350 ${Math.min(height - 115, leaf.y + 155)} C${leaf.x} ${leaf.y + 122},${leaf.x + (leaf.x < 350 ? 26 : -26)} ${leaf.y + 62},${leaf.x} ${leaf.y + 26}`" class="branch" :class="{ active: selected === leaf.skill }" />
          <g role="button" tabindex="0" :aria-label="`${leaf.title}${leaf.mastery === undefined ? ', no estimate yet' : `, estimated mastery ${Math.round(leaf.mastery)} percent`}`" :aria-pressed="selected === leaf.skill" class="skill-leaf" :class="{ selected: selected === leaf.skill }" @click="emit('select', leaf.skill)" @keydown.enter.prevent="emit('select', leaf.skill)" @keydown.space.prevent="emit('select', leaf.skill)">
            <title>{{ leaf.title }}</title><circle :cx="leaf.x" :cy="leaf.y" r="43" class="leaf-focus"/>
            <g :transform="`translate(${leaf.x} ${leaf.y}) rotate(${leaf.angle})`"><path d="M0 29 C-35 10,-27 -23,7 -39 C34 -9,28 16,0 29Z" :fill="leaf.mastery === undefined ? '#fff' : `rgb(${248 - leaf.mastery * 1.65},${248 - leaf.mastery * 1.65},${248 - leaf.mastery * 1.65})`" class="leaf-shape"/><path d="M0 28 Q4 0 7 -36 M3 9 L-14 -6 M5 -4 L20 -15" class="vein"/></g>
            <text :x="leaf.x" :y="leaf.y + 60" text-anchor="middle"><tspan v-for="(line, i) in leaf.lines" :key="i" :x="leaf.x" :dy="i ? 17 : 0">{{ line }}</tspan></text>
          </g>
        </g>
      </svg>
      <figcaption>One leaf, one skill. Select a leaf to begin.</figcaption>
    </template>
  </figure>
</template>
<style scoped>
.living-tree{margin:0;min-height:470px;position:relative}.living-tree svg{display:block;width:100%;max-height:600px;overflow:visible}.trunk,.branch{fill:none;stroke:#b0b0b0;stroke-linecap:round}.trunk{stroke-width:1.5}.branch{stroke-width:1.15}.branch.active{stroke:#555}.skill-leaf{cursor:pointer;outline:none}.leaf-shape{stroke:#777;stroke-width:1.05}.vein{fill:none;stroke:#888;stroke-width:.65}.leaf-focus{fill:transparent;stroke:transparent;stroke-width:1}.skill-leaf:hover .leaf-focus{fill:#f2f2f2}.skill-leaf.selected .leaf-focus,.skill-leaf:focus-visible .leaf-focus{stroke:#333;stroke-dasharray:2 5;fill:#f7f7f7}.skill-leaf.selected .leaf-shape{stroke:#222;stroke-width:1.8}text{fill:#777;font:12px "Avenir Next",sans-serif}.selected text{fill:#222;font-weight:600}figcaption{text-align:center;font-size:11px;color:#aaa;margin:0}.empty-tree{max-width:340px;margin:20px auto;text-align:center;color:#aaa}.empty-tree :deep(svg){height:350px}.empty-tree p{font-size:13px}@media(max-width:650px){.living-tree{min-height:340px}.living-tree svg{max-height:420px}text{font-size:13px}}
</style>
