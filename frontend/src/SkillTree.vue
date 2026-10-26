<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import InfoBubble from "./InfoBubble.vue";
import PixelIcon from "./PixelIcon.vue";
import { STAGE_LABELS, type Stage } from "./pixel-art.ts";
import { CELL, GROUND, HEIGHT, PLOT, average, drawGrove, growGrove, leafNear, shiftGrove, type GroveLeaf, type GroveTopic } from "./GroveScene.ts";

// The grove: one pixel tree per topic, each confirmed skill a leaf at a branch tip (design/revamp/README.md,
// "Tree view"). The canvas is decoration; every leaf is also a real button laid over it, so the grove works from the
// keyboard and with a screen reader. `units` names the topics, `due` lists the skills due today, and `courseId` keys
// the saved design seed; all three are optional.
const props = defineProps<{
  skills: { skill: string; title: string; status: string; mastery?: number; unit?: string }[];
  selected: string | null;
  units?: readonly { unit: string; title: string }[];
  due?: readonly string[];
  courseId?: string;
}>();
const emit = defineEmits<{ select: [skill: string]; plant: [] }>();

const INFO = "Each topic grows its own tree. Each confirmed skill is a leaf that grows as you master it: bud, sprout, leaf, then blossom. A coral flag means it’s due today. Select a leaf to see the skill.";
const legend = computed<Stage[]>(() => props.due === undefined ? ["bud", "sprout", "leaf", "full", "bloom"] : ["bud", "sprout", "leaf", "full", "bloom", "flag"]);

// Topics in course order, then any skill whose unit the `units` list does not name.
const topics = computed<GroveTopic[]>(() => {
  const due = new Set(props.due ?? []), confirmed = props.skills.filter((skill) => skill.status === "CONFIRMED");
  const titles = new Map((props.units ?? []).map((unit) => [unit.unit, unit.title]));
  const order = (props.units ?? []).map((unit) => unit.unit);
  for (const skill of confirmed) if (!order.includes(skill.unit ?? "")) order.push(skill.unit ?? "");
  let unnamed = 0;
  return order.map((id) => ({ id, skills: confirmed.filter((skill) => (skill.unit ?? "") === id) })).filter((topic) => topic.skills.length).map((topic) => ({
    id: topic.id || "grove",
    title: titles.get(topic.id) || (topic.id ? `Topic ${++unnamed}` : "Other skills"),
    skills: topic.skills.map((skill) => ({ skill: skill.skill, title: skill.title, mastery: skill.mastery ?? undefined, due: due.has(skill.skill) })),
  }));
});
const leafCount = computed(() => topics.value.reduce((sum, topic) => sum + topic.skills.length, 0));
const summary = computed(() => {
  const n = leafCount.value, m = topics.value.length;
  if (!n) return "No skills yet";
  const avg = average(topics.value.flatMap((topic) => topic.skills));
  return `${n} ${n === 1 ? "skill" : "skills"} in ${m} ${m === 1 ? "topic" : "topics"}${avg === undefined ? "" : ` · ${avg}%`}`;
});

// The design seed, saved per course so the grove looks the same after a reload.
const storageKey = computed(() => {
  const id = props.courseId ?? props.units?.[0]?.unit ?? props.skills.find((skill) => skill.unit)?.unit;
  return id ? `stillgotit.grove.${id}` : null;
});
const design = ref(1);
watch(storageKey, (key) => {
  let saved = NaN;
  try { if (key) saved = Number.parseInt(localStorage.getItem(key) ?? "", 10); } catch { /* storage unavailable */ }
  design.value = Number.isInteger(saved) && saved > 0 ? saved : 1;
}, { immediate: true });
function regrow() {
  design.value += 1;
  try { if (storageKey.value) localStorage.setItem(storageKey.value, String(design.value)); } catch { /* storage unavailable */ }
}

// Planks need to know their text width so a long topic name widens its slot instead of overlapping a neighbour.
// The widths are measured once the fonts have loaded.
const PLANK_MAX = 280;
const fontsVersion = ref(0);
let measure: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string) {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return text.length * 8;
  measure.font = font;
  return measure.measureText(text).width;
}
function plankCells(title: string, meta: string) {
  const text = Math.max(textWidth(title, '13px "Pixelify Sans", monospace'), textWidth(meta, '600 12px "Instrument Sans", sans-serif'));
  // 10px padding either side, then the 2px outline either side and a little air.
  return Math.ceil((Math.min(PLANK_MAX, Math.ceil(text) + 20) + 4 + 8) / CELL);
}
const grown = computed(() => { void fontsVersion.value; return growGrove(topics.value, design.value, plankCells); });

// Measured size of the scroll area; the grove fills it and scrolls when it is wider.
const scroller = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
const containerWidth = ref(0), dpr = ref(1);
const placed = computed(() => {
  const available = containerWidth.value || 760, cells = Math.floor(available / CELL), grove = grown.value;
  const fits = grove.width <= cells;
  return { grove: fits ? shiftGrove(grove, Math.floor((cells - grove.width) / 2)) : grove, cssWidth: fits ? available : grove.width * CELL };
});
const leaves = computed(() => placed.value.grove.trees.flatMap((tree) => tree.leaves));

const hover = ref<string | null>(null), focused = ref<string | null>(null);
const hot = computed(() => hover.value ?? focused.value);
const tagLeaf = computed<GroveLeaf | undefined>(() => {
  const id = hot.value ?? props.selected;
  return id ? leaves.value.find((leaf) => leaf.skill.skill === id) : undefined;
});
const percent = (skill: GroveLeaf["skill"]) => skill.mastery === undefined ? "new" : `${Math.round(skill.mastery)}%`;
const leafLabel = (skill: GroveLeaf["skill"]) =>
  `${skill.title}${skill.mastery === undefined ? ", no estimate yet" : `, estimated mastery ${Math.round(skill.mastery)} percent`}${skill.due ? ", due today" : ""}`;

// The hover tag sits above the leaf, below it when the leaf is near the top, and stays inside the grove.
const tagEl = ref<HTMLElement | null>(null), tagWidth = ref(0);
const tagStyle = computed(() => {
  const leaf = tagLeaf.value;
  if (!leaf) return {};
  const half = tagWidth.value / 2, width = placed.value.cssWidth;
  const left = half ? Math.min(Math.max(leaf.x * CELL + 2, half + 4), width - half - 4) : leaf.x * CELL + 2;
  const below = (leaf.y - 6) * CELL < 36;
  return { left: `${left}px`, top: `${(below ? leaf.y + 6 : leaf.y - 6) * CELL}px`, transform: below ? "translateX(-50%)" : "translate(-50%, -100%)" };
});
watch(tagLeaf, async () => { await nextTick(); tagWidth.value = tagEl.value?.offsetWidth ?? 0; }, { immediate: true });

function draw() {
  if (canvas.value) drawGrove(canvas.value, placed.value.grove, placed.value.cssWidth, dpr.value, props.selected, hot.value);
}
watch([placed, () => props.selected, hot, dpr], draw, { flush: "post" });

// Hit-testing happens in cell space: the nearest leaf within about five cells.
function leafAtPointer(event: MouseEvent) {
  const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
  return leafNear(placed.value.grove, (event.clientX - box.left) / CELL, (event.clientY - box.top) / CELL);
}
function onMove(event: MouseEvent) { const id = leafAtPointer(event)?.skill.skill ?? null; if (id !== hover.value) hover.value = id; }
function onClick(event: MouseEvent) { const leaf = leafAtPointer(event); if (leaf) emit("select", leaf.skill.skill); }

// When the selection changes from elsewhere (for example "Show on tree"), scroll its leaf into view.
watch([() => props.selected, placed], async () => {
  await nextTick();
  const box = scroller.value, leaf = leaves.value.find((item) => item.skill.skill === props.selected);
  if (!box || !leaf) return;
  const x = leaf.x * CELL;
  if (x - 24 < box.scrollLeft || x + 24 > box.scrollLeft + box.clientWidth) box.scrollLeft = Math.max(0, x - box.clientWidth / 2);
});

let observer: ResizeObserver | undefined;
function measureBox() { containerWidth.value = scroller.value?.clientWidth ?? 0; dpr.value = window.devicePixelRatio || 1; }
function fontsLoaded() { fontsVersion.value++; }
onMounted(() => {
  measureBox();
  if (typeof ResizeObserver !== "undefined" && scroller.value) { observer = new ResizeObserver(measureBox); observer.observe(scroller.value); }
  window.addEventListener("resize", measureBox);
  const fonts = document.fonts;
  if (fonts) {
    void Promise.all([fonts.load('13px "Pixelify Sans"'), fonts.load('600 12px "Instrument Sans"')]).then(fontsLoaded, () => undefined);
    fonts.addEventListener?.("loadingdone", fontsLoaded);
  }
  draw();
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", measureBox);
  document.fonts?.removeEventListener?.("loadingdone", fontsLoaded);
});
</script>

<template>
  <section class="grove" aria-label="Your skill grove">
    <header class="grove-head">
      <span class="grove-summary"><span class="eyebrow">{{ summary }}</span><InfoBubble :text="INFO" label="How the grove works" /></span>
      <div class="grove-tools">
        <ul class="legend" aria-label="Leaf key">
          <li v-for="stage in legend" :key="stage"><PixelIcon :sprite="stage" :size="14" />{{ STAGE_LABELS[stage] }}</li>
        </ul>
        <button v-if="leafCount" type="button" class="regrow" title="Draw the trees again. Your skills stay the same." @click="regrow">Regrow</button>
      </div>
    </header>
    <div ref="scroller" class="grove-scroll">
      <div class="grove-stage" role="group" aria-label="Each leaf is a confirmed skill. Select one to see it." :style="{ width: `${placed.cssWidth}px`, height: `${HEIGHT * CELL}px` }">
        <canvas ref="canvas" aria-hidden="true" :style="{ width: `${placed.cssWidth}px`, height: `${HEIGHT * CELL}px`, cursor: hover ? 'pointer' : 'default' }"
          @mousemove="onMove" @mouseleave="hover = null" @click="onClick" />
        <span v-for="tree in placed.grove.trees" :key="`plank-${tree.key}`" class="plank" aria-hidden="true" :style="{ left: `${tree.cx * CELL}px`, top: `${(GROUND + 4) * CELL}px`, maxWidth: '280px' }">
          <span class="plank-title">{{ tree.title }}</span><span class="plank-meta">{{ tree.meta }}</span>
        </span>
        <div v-for="tree in placed.grove.trees" :key="`leaves-${tree.key}`" role="group" :aria-label="`${tree.title}, ${tree.meta}`">
          <button v-for="leaf in tree.leaves" :key="leaf.skill.skill" type="button" class="leaf-button" :aria-label="leafLabel(leaf.skill)" :aria-pressed="selected === leaf.skill.skill"
            :style="{ left: `${(leaf.x - 5) * CELL}px`, top: `${(leaf.y - 5) * CELL}px` }"
            @click="emit('select', leaf.skill.skill)" @focus="focused = leaf.skill.skill" @blur="focused = null" />
        </div>
        <span v-if="tagLeaf" ref="tagEl" class="leaf-tag" aria-hidden="true" :style="tagStyle">{{ tagLeaf.skill.title }}<span class="leaf-tag-pct">{{ percent(tagLeaf.skill) }}</span></span>
        <button type="button" class="plant-plot" :style="{ left: `${placed.grove.plot * CELL}px`, top: `${(GROUND - PLOT) * CELL}px`, width: `${PLOT * CELL}px`, height: `${PLOT * CELL}px` }"
          @click="emit('plant')">+ Plant a topic</button>
      </div>
    </div>
    <div v-if="!leafCount && $slots.empty" class="grove-empty"><slot name="empty" /></div>
  </section>
</template>

<style scoped>
.grove { min-width: 0; border-radius: 24px; background: var(--card); box-shadow: 0 0 0 1px var(--line-faint), 0 12px 22px rgb(var(--shadow) / .06); padding: 14px; }
.grove-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 2px 6px 12px; }
.grove-summary { display: flex; align-items: center; gap: 4px; min-width: 0; }
.grove-summary .eyebrow { font-size: 12px; white-space: nowrap; }
.grove-tools { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.legend { display: flex; align-items: center; gap: 6px 14px; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; font-size: 12px; color: var(--muted); }
.legend li { display: flex; align-items: center; gap: 5px; white-space: nowrap; }
.regrow { display: flex; align-items: center; gap: 6px; border: 0; border-radius: 999px; background: var(--inset); color: var(--ink); padding: 6px 12px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.regrow:hover { background: var(--meadow-soft-hover); }
.grove-scroll { overflow-x: auto; overflow-y: hidden; border-radius: 18px; }
.grove-stage { position: relative; }
.grove-stage canvas { display: block; image-rendering: pixelated; }
.plank { position: absolute; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; padding: 4px 10px 5px; background: var(--plank);
  box-shadow: inset 0 -2px 0 var(--plank-edge), 0 0 0 2px var(--plank-ring); white-space: nowrap; pointer-events: none; }
.plank-title { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font: 400 13px/16px var(--font-display); color: var(--plank-ink); }
.plank-meta { font: 600 12px/15px var(--font-body); color: var(--plank-soft); font-variant-numeric: tabular-nums; }
/* Leaf buttons sit over their leaves for keyboard and screen-reader use; the pointer goes through to the canvas. */
.leaf-button { position: absolute; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 6px; background: transparent; pointer-events: none; }
.leaf-tag { position: absolute; z-index: 2; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: var(--tip); color: var(--tip-text);
  font-size: 12px; font-weight: 600; line-height: 1.3; white-space: nowrap; pointer-events: none; box-shadow: 0 6px 14px rgb(var(--shadow) / .2); font-variant-numeric: tabular-nums; }
.leaf-tag-pct { color: var(--tag-accent); }
.plant-plot { position: absolute; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding: 0 4px 32px; border: 2px dashed var(--dash);
  border-radius: 14px; background: var(--plot); font: 400 13px/16px var(--font-display); color: var(--soft); white-space: nowrap; }
.plant-plot:hover { background: var(--plot-hover); }
.grove-empty { display: flex; justify-content: center; padding: 12px 6px 2px; }
</style>
