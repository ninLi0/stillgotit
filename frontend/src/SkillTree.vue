<script setup lang="ts">
import { computed } from "vue";
import TreeMark from "./TreeMark.vue";
const props = defineProps<{ skills: { skill: string; title: string; status: string; mastery?: number }[]; selected: string | null }>();
const emit = defineEmits<{ select: [skill: string] }>();
type Slot = { path: string; cx: number; cy: number; lx: number; ly: number; anchor: "start" | "middle" | "end"; above?: boolean };
// A small leaf growing from a twig tip at the given angle (degrees clockwise from straight up).
function leafAt(x: number, y: number, angle: number): Slot {
  const turn = (angle * Math.PI) / 180, point = (px: number, py: number): [number, number] => [x + px * Math.cos(turn) - py * Math.sin(turn), y + px * Math.sin(turn) + py * Math.cos(turn)];
  const at = (px: number, py: number) => point(px, py).map((value) => value.toFixed(1)).join(" "), tip = point(4, -42), mid = point(3, -21);
  return { path: `M${at(0, 0)}C${at(-10, -15)} ${at(-7, -31)} ${at(4, -42)}C${at(15, -27)} ${at(11, -11)} ${at(0, 0)}Z`, cx: mid[0], cy: mid[1],
    lx: tip[0] + (tip[0] < 200 ? -8 : 8), ly: tip[1], anchor: tip[0] < 200 ? "end" : "start" };
}
// Leaf slots on the home page's tree drawing: its six large leaves first, then leaves at the twig tips.
const slots: Slot[] = [
  { path: "M201 106C189 79 193 61 208 45C221 67 216 90 201 106Z", cx: 204, cy: 76, lx: 206, ly: 34, anchor: "middle", above: true },
  { path: "M139 138C119 133 109 116 111 96C131 105 141 120 139 138Z", cx: 125, cy: 117, lx: 104, ly: 102, anchor: "end" },
  { path: "M274 166C273 142 285 126 305 122C301 145 288 159 274 166Z", cx: 289, cy: 144, lx: 312, ly: 130, anchor: "start" },
  { path: "M128 232C107 224 101 203 107 186C126 197 134 214 128 232Z", cx: 117, cy: 209, lx: 98, ly: 196, anchor: "end" },
  { path: "M291 253C286 230 295 212 314 204C317 228 306 245 291 253Z", cx: 302, cy: 229, lx: 322, ly: 222, anchor: "start" },
  { path: "M242 96C233 76 239 57 256 44C264 65 255 84 242 96Z", cx: 249, cy: 70, lx: 266, ly: 52, anchor: "start" },
  leafAt(75, 234, -105), leafAt(339, 250, 100), leafAt(99, 113, -55), leafAt(320, 157, 70), leafAt(276, 77, 35),
];
const leaves = computed(() => props.skills.filter((skill) => skill.status === "CONFIRMED").slice(0, slots.length).map((skill, index) => {
  const slot = slots[index]!, lines = [...wrap(skill.title), skill.mastery === undefined ? "new" : `${Math.round(skill.mastery)}%`];
  // Labels above a leaf grow upward; side labels are centered on the leaf tip.
  const top = slot.above ? slot.ly - (lines.length - 1) * 18 : slot.ly - ((lines.length - 1) * 18) / 2;
  return { ...skill, ...slot, lines, top };
}));
const empty = computed(() => slots.slice(leaves.value.length));
function wrap(title: string) {
  const words = title.split(" "), lines: string[] = []; let line = "";
  for (const word of words) { if (line.length + word.length > 18 && line) { lines.push(line); line = word; } else line += (line ? " " : "") + word; }
  if (line) lines.push(line); return lines;
}
</script>
<template>
  <figure class="living-tree">
    <div v-if="!leaves.length" class="empty-tree"><TreeMark /><p>Your next skill starts here.</p><slot name="empty" /></div>
    <template v-else>
      <svg viewBox="-100 -30 600 482" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Your skill tree. Each filled leaf is a confirmed skill.">
        <g class="drawing" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M201 410C205 358 193 316 200 269C204 226 190 181 202 107" stroke-width="3" />
          <path d="M201 313C165 298 142 271 128 232M198 271C236 241 262 215 274 166M199 224C170 205 143 181 139 137M202 180C232 158 242 130 242 96M195 356C241 326 277 297 291 253" stroke-width="2" />
          <path d="M142 263C114 269 90 252 75 234M155 281C149 242 159 221 167 205M255 210C284 202 312 181 320 157M265 191C248 176 249 154 258 139M164 186C166 158 159 143 151 128M143 155C117 147 103 131 99 113M234 142C217 126 213 112 217 94M240 121C262 109 274 93 276 77M273 288C309 285 329 269 339 250M276 282C261 260 256 241 262 226" stroke-width="1.4" />
          <path d="M196 382C178 401 160 410 142 414M204 396C221 407 239 416 260 420M199 406L193 431M194 354C184 368 180 377 179 389" stroke-width="1.4" />
          <path v-for="slot in empty" :key="slot.path" :d="slot.path" class="empty-leaf" />
        </g>
        <g v-for="leaf in leaves" :key="leaf.skill" role="button" tabindex="0" :aria-label="`${leaf.title}${leaf.mastery === undefined ? ', no estimate yet' : `, estimated mastery ${Math.round(leaf.mastery)} percent`}`" :aria-pressed="selected === leaf.skill" class="skill-leaf" :class="{ selected: selected === leaf.skill }" @click="emit('select', leaf.skill)" @keydown.enter.prevent="emit('select', leaf.skill)" @keydown.space.prevent="emit('select', leaf.skill)">
          <title>{{ leaf.title }}</title><circle :cx="leaf.cx" :cy="leaf.cy" r="31" class="leaf-focus"/>
          <path :d="leaf.path" :fill="leaf.mastery === undefined ? '#d6e4f5' : `rgba(40,84,154,${(0.22 + leaf.mastery * 0.0078).toFixed(3)})`" class="leaf-shape"/>
          <text :x="leaf.lx" :y="leaf.top" :text-anchor="leaf.anchor"><tspan v-for="(line, i) in leaf.lines" :key="i" :x="leaf.lx" :dy="i ? 18 : 0" :class="{ 'leaf-score': i === leaf.lines.length - 1 }">{{ line }}</tspan></text>
        </g>
      </svg>
      <figcaption>Each filled leaf is a skill. Darker leaves are stronger. Select one to begin.</figcaption>
    </template>
  </figure>
</template>
<style scoped>
.living-tree{margin:0 auto;position:relative;background:var(--surface);border-radius:310px 310px 24px 24px;padding:40px 16px 20px;box-shadow:0 1px 2px rgba(23,35,64,.04),0 12px 32px rgba(23,35,64,.06)}.living-tree svg{display:block;width:100%;max-height:600px;overflow:visible}.drawing{stroke:var(--ink)}.empty-leaf{stroke-width:1.2;opacity:.4}.skill-leaf{cursor:pointer;outline:none}.leaf-shape{stroke:var(--ink);stroke-width:1.3}.leaf-focus{fill:transparent;stroke:transparent}.skill-leaf:hover .leaf-focus{fill:var(--wash)}.skill-leaf.selected .leaf-focus{fill:var(--light)}.skill-leaf:focus-visible .leaf-focus{fill:var(--light);stroke:var(--primary);stroke-width:1.5;stroke-dasharray:3 3}.skill-leaf.selected .leaf-shape{stroke:var(--primary);stroke-width:2}text{fill:var(--ink);font:600 16px "Avenir Next","Nunito Sans",sans-serif;paint-order:stroke;stroke:var(--surface);stroke-width:5px;stroke-linejoin:round}.leaf-score{font-weight:500;fill:var(--primary)}.selected text{fill:var(--primary)}figcaption{text-align:center;font-size:12px;color:var(--muted);margin:10px 0 0}.empty-tree{max-width:340px;margin:0 auto;text-align:center;color:var(--ink)}.empty-tree :deep(svg){height:400px;max-width:100%}.empty-tree p{font-size:13px;color:var(--muted)}@media(max-width:650px){.living-tree{padding:28px 4px 14px;border-radius:200px 200px 18px 18px}.empty-tree :deep(svg){height:300px}text{font-size:15px}}
</style>
