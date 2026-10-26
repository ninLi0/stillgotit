<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, onUnmounted, ref, useId, watch } from "vue";
import CourseProgress from "./CourseProgress.vue";
import InfoBubble from "./InfoBubble.vue";
import MasteryCells from "./MasteryCells.vue";
import PixelIcon from "./PixelIcon.vue";
import { cloudPlaces, drawLand, drawSky, hitForest, layoutForest, plotX, type ForestLayout, type ForestLeaf } from "./ForestScene.ts";
import { focusedControl } from "./focus.ts";
import { rng, stageOf, type Stage } from "./pixel-art.ts";
import { cloudDrift, cloudRects, snapStyle, sprite, type Sprite } from "./scene-motion.ts";
import type { ForestProps, ViewSkill, ViewUnit } from "./revamp-types.ts";
import { averageEstimate } from "../../src/computations/course-score.ts";

// The course forest (design/revamp/README.md, "Forest view"): a full-screen overlay with one pixel tree per topic.
// Each leaf is a skill drawn as its mastery sprite. The canvas is for looking and pointing; every skill is also a
// button in the topics list, so the keyboard reaches everything. The parent owns the selected skill and the design
// seed; this view owns only which topic is picked out (it dims the other trees and opens that topic in the list).
const props = withDefaults(defineProps<ForestProps>(), { selected: null });
const emit = defineEmits<{ close: []; open: [skill: string]; practice: [skill: string]; select: [skill: string | null]; plant: []; regrow: [] }>();

const titleId = useId();
const root = ref<HTMLElement | null>(null);
const title = ref<HTMLElement | null>(null);
const scroller = ref<HTMLElement | null>(null);
const canvas = ref<HTMLCanvasElement | null>(null);
const topic = ref<string | null>(null);
const hover = ref<string | null>(null);
const pointing = ref(false);
const view = ref({ w: 0, h: 0, dpr: 1 });

const INFO = "Each tree is a topic and each leaf on it is one of its skills, drawn as a sprite that shows your estimate, from a bud (no estimate yet) to a bloom (80% and up).";

function hasEstimate(s: ViewSkill): s is ViewSkill & { mastery: number } { return typeof s.mastery === "number"; }
// The same average as the course confidence in the course menu (src/computations/course-score.ts).
function average(skills: readonly ViewSkill[]): number | null { return averageEstimate(skills.map((s) => s.mastery)); }
function plural(n: number, word: string) { return `${n} ${word}${n === 1 ? "" : "s"}`; }
function statusText(s: ViewSkill) { return s.dueToday ? "Due today" : hasEstimate(s) ? `${Math.round(s.mastery)}%` : "New"; }
function statusClass(s: ViewSkill) { return s.dueToday ? "due" : hasEstimate(s) ? "" : "new"; }

const units = computed(() => props.units.filter((u) => u.skills.length > 0));
const skills = computed(() => units.value.flatMap((u) => u.skills));
const empty = computed(() => skills.value.length === 0);
const counts = computed(() => {
  const all = skills.value;
  const rows: { key: string; sprite: Stage; n: number; label: string }[] = [
    { key: "mastered", sprite: "bloom", n: all.filter((s) => hasEstimate(s) && s.mastery >= 80).length, label: "mastered" },
    { key: "growing", sprite: "leaf", n: all.filter((s) => hasEstimate(s) && s.mastery < 80).length, label: "growing" },
    { key: "new", sprite: "bud", n: all.filter((s) => !hasEstimate(s)).length, label: "new" },
    { key: "due", sprite: "flag", n: all.filter((s) => s.dueToday).length, label: "due today" },
  ];
  return rows;
});
const courseAverage = computed(() => average(skills.value));
const estimated = computed(() => skills.value.filter(hasEstimate).length);
const courseNote = computed(() => {
  const total = skills.value.length;
  if (!total) return "No skills yet";
  if (!estimated.value) return `No estimates yet across ${plural(total, "skill")}`;
  return estimated.value === total ? `across ${plural(total, "skill")}` : `across the ${estimated.value} of ${plural(total, "skill")} with an estimate`;
});
const topics = computed(() => units.value.map((u) => ({ unit: u.unit, title: u.title, skills: u.skills, avg: average(u.skills), open: topic.value === u.unit })));
const current = computed<{ skill: ViewSkill; unit: ViewUnit } | null>(() => {
  if (!props.selected) return null;
  for (const u of props.units) for (const s of u.skills) if (s.skill === props.selected) return { skill: s, unit: u };
  return null;
});

// ---- Canvas ----
// 5px cells, 4px when the canvas is under 760px wide; each cell is a whole number of device pixels.
const cellPx = computed(() => Math.max(1, Math.round((view.value.w < 760 ? 4 : 5) * view.value.dpr)));
const cell = computed(() => cellPx.value / view.value.dpr);
const layout = computed<ForestLayout | null>(() => (view.value.w > 0 && view.value.h > 0 ? layoutForest(props.units, props.design, view.value.w, view.value.h, cell.value) : null));
const wide = computed(() => !!layout.value && layout.value.Wc > layout.value.Wv);
const stageStyle = computed(() => {
  const L = layout.value;
  if (!L) return {};
  return { width: `${wide.value ? L.Wc * cell.value : view.value.w}px`, height: `${view.value.h}px` };
});
const canvasStyle = computed(() => {
  const L = layout.value;
  return L ? { width: `${L.Wc * cell.value}px`, height: `${L.Hc * cell.value}px` } : {};
});
const signs = computed(() => {
  const L = layout.value;
  if (!L) return [];
  const c = cell.value;
  return L.trees.slice().sort((a, b) => a.cx - b.cx).map((t) => {
    const avg = average(t.skills), meta = `${plural(t.skills.length, "skill")} · ${avg === null ? "new" : `${avg}%`}`;
    return { unit: t.unit, title: t.title, meta, style: { left: `${t.cx * c}px`, top: `${(t.base + 3) * c}px`, maxWidth: `${Math.max(96, L.slot * c - 14)}px` } };
  });
});
const plantSign = computed(() => {
  const L = layout.value;
  return L && !L.trees.length ? { left: `${plotX(L) * cell.value}px`, top: `${(L.G + 5) * cell.value}px` } : null;
});
function leafOf(id: string | null): ForestLeaf | null {
  const L = layout.value;
  if (!L || !id) return null;
  for (const t of L.trees) for (const lf of t.leaves) if (lf.skill.skill === id) return lf;
  return null;
}
const tag = computed(() => {
  const lf = leafOf(hover.value);
  if (!lf) return null;
  const c = cell.value, above = (lf.y - 6) * c, below = above < 40;
  const left = Math.min(Math.max(lf.x * c + c / 2, 90), (layout.value?.Wc ?? 0) * c - 90);
  return {
    title: lf.skill.title, pct: lf.skill.dueToday ? "due today" : hasEstimate(lf.skill) ? `${Math.round(lf.skill.mastery)}%` : "new",
    style: { left: `${left}px`, top: `${below ? (lf.y + 5) * c : above}px`, transform: below ? "translateX(-50%)" : "translate(-50%, -100%)" },
  };
});
const canvasLabel = computed(() => (empty.value
  ? "An empty meadow. No topics have skills yet."
  : `Course forest with ${plural(units.value.length, "topic")} and ${plural(skills.value.length, "skill")}. Every skill is also listed under Topics.`));

// Three layers, back to front: the sky and sun on their own canvas, the clouds as SVG sprites that drift on an eased
// loop (scene-motion.ts), and the land on the canvas that takes the pointer. Only the land is drawn again when the
// selection, hover or topic changes. Under prefers-reduced-motion the clouds stay where they are drawn.
const sky = ref<HTMLCanvasElement | null>(null);
const clouds = computed<Sprite[]>(() => {
  const L = layout.value;
  if (!L) return [];
  const M = rng(111), c = cell.value;
  return cloudPlaces(L).map((p, i) => { const { drift, shift } = cloudDrift(M, c); return sprite(`cloud-${i}`, p.x - shift, p.y, c, cloudRects(p.w, "#EEF5F9", 3, 7), drift); });
});
function prepare(target: HTMLCanvasElement, L: ForestLayout): CanvasRenderingContext2D | null {
  const w = L.Wc * cellPx.value, h = L.Hc * cellPx.value;
  if (target.width !== w || target.height !== h) { target.width = w; target.height = h; }
  const ctx = target.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  return ctx;
}
function paintSky() {
  const L = layout.value, target = sky.value;
  if (!L || !target) return;
  const ctx = prepare(target, L);
  if (ctx) drawSky(ctx, L, cellPx.value);
}
function paintLand() {
  const L = layout.value, target = canvas.value;
  if (!L || !target) return;
  const ctx = prepare(target, L);
  if (ctx) drawLand(ctx, L, cellPx.value, { design: props.design, selected: props.selected ?? null, hover: hover.value, topic: topic.value });
}
function paintAll() { paintSky(); paintLand(); }

let revealed = false;
watch(layout, () => {
  paintAll();
  // Opening the forest with a skill already chosen scrolls its leaf into view once.
  if (!revealed && layout.value) { revealed = true; if (props.selected) nextTick(() => reveal(leafOf(props.selected ?? null)?.x ?? null)); }
}, { flush: "post" });
// A changed estimate or due flag keeps the same layout but changes the sprites.
watch(() => props.units, paintAll, { deep: true, flush: "post" });
watch([() => props.selected, hover, topic], paintLand, { flush: "post" });

function measure() {
  const el = scroller.value;
  if (!el) return;
  const next = { w: el.clientWidth, h: el.clientHeight, dpr: window.devicePixelRatio || 1 }, now = view.value;
  if (next.w !== now.w || next.h !== now.h || next.dpr !== now.dpr) view.value = next;
}

/** Scrolls a canvas x (in cells) into view when the forest is wider than its window. */
function reveal(x: number | null) {
  const el = scroller.value;
  if (x === null || !el || !wide.value) return;
  const at = x * cell.value;
  if (at > el.scrollLeft + 60 && at < el.scrollLeft + el.clientWidth - 60) return;
  el.scrollTo({ left: Math.max(0, at - el.clientWidth / 2), behavior: motion?.matches ? "auto" : "smooth" });
}

function pointAt(event: MouseEvent) {
  const L = layout.value, target = canvas.value;
  if (!L || !target) return null;
  const r = target.getBoundingClientRect();
  return hitForest(L, (event.clientX - r.left) / cell.value, (event.clientY - r.top) / cell.value);
}
function onMove(event: MouseEvent) {
  const hit = pointAt(event);
  const id = hit?.leaf?.skill.skill ?? null;
  if (id !== hover.value) hover.value = id;
  pointing.value = !!(hit?.leaf || hit?.tree);
}
function onLeave() { hover.value = null; pointing.value = false; }
function onClick(event: MouseEvent) {
  const hit = pointAt(event);
  if (hit?.leaf) { topic.value = hit.leaf.unit; emit("select", hit.leaf.skill.skill); }
  else if (hit?.tree) toggleTopic(hit.tree);
}

function toggleTopic(unit: string) { topic.value = topic.value === unit ? null : unit; }
function toggleFromList(unit: string) {
  toggleTopic(unit);
  if (topic.value === unit) reveal(layout.value?.trees.find((t) => t.unit === unit)?.cx ?? null);
}
function chooseSkill(id: string) {
  emit("select", id);
  reveal(leafOf(id)?.x ?? null);
}

// ---- Dialog behaviour: focus on open and back on close, Escape, and a focus trap ----
const opener = focusedControl();
function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  // An open ⓘ bubble takes the first Escape (InfoBubble closes it); the next one closes the forest.
  if ((globalThis as { __sgInfo?: { value: string | null } }).__sgInfo?.value) return;
  event.preventDefault();
  emit("close");
}
const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";
function onTrap(event: KeyboardEvent) {
  const box = root.value;
  if (event.key !== "Tab" || !box) return;
  const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  const first = items[0], last = items[items.length - 1], active = document.activeElement;
  if (!first || !last) { event.preventDefault(); return; }
  const outside = !box.contains(active) || active === box || active === title.value;
  if (event.shiftKey && (active === first || outside)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
}

let observer: ResizeObserver | null = null;
// Reduced motion also makes scrolling to a leaf jump instead of glide.
const motion = typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

onMounted(() => {
  measure();
  if (scroller.value) { observer = new ResizeObserver(measure); observer.observe(scroller.value); }
  window.addEventListener("resize", measure);
  document.addEventListener("keydown", onKey, true);
  nextTick(() => title.value?.focus());
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener("resize", measure);
  document.removeEventListener("keydown", onKey, true);
});
onUnmounted(() => {
  // Return focus to whatever opened the forest, unless the next screen has already taken it.
  const active = document.activeElement;
  if ((!active || active === document.body) && opener?.isConnected) opener.focus();
});
</script>

<template>
  <div ref="root" class="forest" role="dialog" aria-modal="true" :aria-labelledby="titleId" tabindex="-1" @keydown="onTrap">
    <header class="forest-head">
      <div class="forest-brand">
        <span class="forest-tile"><PixelIcon name="tree" :size="40" /></span>
        <div class="forest-heading">
          <p class="eyebrow forest-course">{{ courseTitle }}</p>
          <h2 :id="titleId" ref="title" class="forest-title" tabindex="-1">Course forest</h2>
        </div>
      </div>
      <div class="forest-tools">
        <button type="button" class="forest-regrow" title="Draw the trees again. Your skills stay the same." @click="emit('regrow')">Regrow</button>
        <button type="button" class="primary meadow forest-back" aria-label="Back to desk: close the course forest" @click="emit('close')">Back to desk</button>
      </div>
    </header>

    <div class="forest-body">
      <div class="forest-scene">
        <div ref="scroller" class="forest-scroll">
          <div class="forest-stage" :style="[stageStyle, snapStyle(view.dpr)]">
            <canvas ref="sky" class="forest-sky" :style="canvasStyle" aria-hidden="true" />
            <svg v-if="layout" class="forest-clouds" :width="layout.Wc * cell" :height="layout.Hc * cell" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
              <g v-for="s in clouds" :key="s.key" :transform="s.at"><g class="drift" :style="s.motion"><rect v-for="(r, i) in s.rects" :key="i" v-bind="r" /></g></g>
            </svg>
            <canvas ref="canvas" class="forest-canvas" :class="{ pointing }" :style="canvasStyle" role="img" :aria-label="canvasLabel"
              @click="onClick" @mousemove="onMove" @mouseleave="onLeave" />
            <button v-for="s in signs" :key="s.unit" type="button" class="forest-sign" :class="{ on: topic === s.unit }" :style="s.style"
              :aria-pressed="topic === s.unit" :aria-label="`Topic ${s.title}, ${s.meta}`" :title="s.title" @click="toggleTopic(s.unit)">
              <span class="sign-title">{{ s.title }}</span><span class="sign-meta">{{ s.meta }}</span>
            </button>
            <button v-if="plantSign" type="button" class="forest-sign" :style="plantSign" aria-label="Plant a topic from course materials" @click="emit('plant')">
              <span class="sign-title">+ Plant a topic</span><span class="sign-meta">from course materials</span>
            </button>
            <span v-if="tag" class="forest-tag" :style="tag.style" aria-hidden="true">{{ tag.title }}<span class="tag-pct">{{ tag.pct }}</span></span>
          </div>
        </div>
        <span class="forest-info"><InfoBubble :text="INFO" label="About the course forest" /></span>
      </div>

      <aside class="forest-aside" aria-label="Forest details">
        <p class="sr-only" aria-live="polite">{{ current ? `Selected ${current.skill.title}` : "" }}</p>
        <section :key="current?.skill.skill ?? 'none'" class="forest-card" :aria-label="current ? `Selected skill: ${current.skill.title}` : 'Selected skill'">
          <template v-if="current">
            <div class="card-top">
              <span class="card-sprite"><PixelIcon :sprite="stageOf(current.skill.mastery)" :size="35" /></span>
              <div class="card-names">
                <p class="eyebrow">{{ current.unit.title }}</p>
                <h3 class="card-title">{{ current.skill.title }}</h3>
              </div>
            </div>
            <div class="card-score">
              <template v-if="hasEstimate(current.skill)">
                <span class="card-pct">{{ Math.round(current.skill.mastery) }}%</span><span class="card-pct-label">estimated mastery</span>
              </template>
              <span v-else class="card-pct-label">No estimate yet</span>
              <span v-if="current.skill.dueToday" class="pill coral">Due today</span>
            </div>
            <MasteryCells class="card-cells" :value="current.skill.mastery" :cells="10" />
            <p v-if="current.skill.outcome" class="card-outcome">{{ current.skill.outcome }}</p>
            <div class="card-actions">
              <button type="button" class="primary meadow card-open" :aria-label="`Open lesson: ${current.skill.title}`" @click="emit('open', current.skill.skill)">Open lesson</button>
              <button type="button" class="secondary meadow" :aria-label="`Practice ${current.skill.title}`" @click="emit('practice', current.skill.skill)">Practice</button>
            </div>
          </template>
          <p v-else-if="empty" class="card-empty">Nothing is growing yet. Plant a topic from your course materials to grow its first tree.</p>
          <p v-else class="card-empty">Choose a leaf or a signpost.</p>
        </section>

        <!-- The course summary sits beside the forest (under it on phones), with the counts that once sat in the header. -->
        <CourseProgress :heading-id="`${titleId}-progress`" :average="courseAverage" :note="courseNote" :counts="counts" />

        <section v-if="topics.length" class="forest-topics" :aria-labelledby="`${titleId}-topics`">
          <h3 :id="`${titleId}-topics`" class="eyebrow">Topics</h3>
          <ul class="topic-list">
            <li v-for="(t, i) in topics" :key="t.unit">
              <button type="button" class="topic-row" :class="{ open: t.open }" :aria-expanded="t.open" :aria-controls="`${titleId}-topic-${i}`"
                :aria-label="`${t.title}, ${plural(t.skills.length, 'skill')}, ${t.avg === null ? 'no estimates yet' : `${t.avg}% average`}`" @click="toggleFromList(t.unit)">
                <PixelIcon name="tree" :size="24" />
                <span class="topic-main">
                  <strong class="topic-name">{{ t.title }}</strong>
                  <MasteryCells class="topic-cells" :value="t.avg" :cells="14" :height="5" off="#F1F1EE" />
                </span>
                <span class="topic-figures">
                  <span class="topic-pct">{{ t.avg === null ? "New" : `${t.avg}%` }}</span><span class="topic-count">{{ plural(t.skills.length, "skill") }}</span>
                </span>
              </button>
              <ul v-show="t.open" :id="`${titleId}-topic-${i}`" class="skill-list" :aria-label="`Skills in ${t.title}`">
                <li v-for="s in t.skills" :key="s.skill">
                  <button type="button" class="skill-row" :class="{ on: s.skill === selected }" :aria-current="s.skill === selected ? 'true' : undefined"
                    :aria-label="`${s.title}, ${statusText(s)}`" @click="chooseSkill(s.skill)">
                    <PixelIcon :sprite="stageOf(s.mastery)" :size="21" />
                    <span class="skill-name">{{ s.title }}</span>
                    <span class="skill-status" :class="statusClass(s)">{{ statusText(s) }}</span>
                  </button>
                </li>
              </ul>
            </li>
          </ul>
        </section>

        <button type="button" class="forest-plant" aria-label="Plant a topic from course materials" @click="emit('plant')">+ Plant a topic from course materials</button>
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* The forest opens like the app's dialogs, with a short scale and fade. */
.forest { position: fixed; inset: 0; z-index: 55; display: flex; flex-direction: column; gap: 12px; padding: 14px; background: #FFFFFF; color: var(--ink); font-family: var(--font-body); overflow-y: auto; overscroll-behavior: contain; animation: sgOpen var(--dur-enter) var(--ease-enter); }
.forest:focus { outline: none; }

/* Header */
.forest-head { display: flex; align-items: center; justify-content: space-between; gap: 12px 16px; flex-wrap: wrap; padding: 2px 6px; }
.forest-brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
.forest-tile { flex: none; display: grid; place-items: center; width: 52px; height: 52px; border-radius: 16px; background: var(--meadow-soft); }
.forest-heading { min-width: 0; }
.forest-course { font-size: 12px; overflow-wrap: anywhere; }
.forest-title { margin: 0; font-family: var(--font-display); font-size: 22px; font-weight: 500; line-height: 1.2; }
.forest-tools { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.forest-regrow { border: 0; border-radius: 12px; background: #FFFFFF; padding: 9px 14px; font-size: 13px; font-weight: 600; white-space: nowrap; }
.forest-regrow:hover { background: var(--inset-2); }
.forest-back { min-height: 40px; padding: 0 16px; font-size: 14px; white-space: nowrap; }

/* Body: canvas and aside */
.forest-body { flex: 1 1 0; min-height: 360px; display: grid; grid-template-columns: minmax(0, 1fr) 340px; grid-template-rows: minmax(0, 1fr); gap: 14px; }
.forest-scene { position: relative; min-height: 0; border-radius: 24px; overflow: hidden; background: #CFE3EE; box-shadow: 0 18px 25px rgba(20, 20, 20, .08); }
.forest-scroll { position: absolute; inset: 0; overflow-x: auto; overflow-y: hidden; overscroll-behavior-x: contain; }
.forest-stage { position: relative; overflow: hidden; }
.forest-sky, .forest-canvas { position: absolute; left: 0; top: 0; display: block; image-rendering: pixelated; }
.forest-sky, .forest-clouds { pointer-events: none; }
.forest-clouds { position: absolute; left: 0; top: 0; overflow: hidden; }
.forest-canvas.pointing { cursor: pointer; }
.forest-sign { position: absolute; z-index: 2; width: max-content; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 5px 12px 6px; border: 0; border-radius: 0; background: #E9D6A8; box-shadow: inset 0 -2px 0 #CDB884, 0 0 0 2px #C08324, 0 6px 0 -1px rgba(20, 20, 20, .12); text-align: center; }
.forest-sign:hover { background: #F3E3BC; }
.forest-sign.on { box-shadow: inset 0 -2px 0 #CDB884, 0 0 0 2px #E3A233, 0 6px 0 -1px rgba(20, 20, 20, .12); }
.sign-title { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; font-family: var(--font-display); font-size: 15px; font-weight: 500; line-height: 1.2; color: var(--ink); }
.sign-meta { font-size: 11px; font-weight: 600; color: var(--soft); white-space: nowrap; }
.forest-tag { position: absolute; z-index: 4; display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 10px; background: #263B2E; color: #FFFFFF; font-size: 12px; font-weight: 600; white-space: nowrap; pointer-events: none; box-shadow: 0 6px 14px rgba(20, 20, 20, .2); }
.tag-pct { color: #86D6AC; }
.forest-info { position: absolute; left: 12px; top: 10px; z-index: 5; display: inline-flex; border-radius: 10px; background: rgba(255, 255, 255, .9); }

.forest-aside { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 20px; border-radius: 24px; background: #FFFFFF; box-shadow: 0 18px 25px rgba(20, 20, 20, .07); }

/* Selected skill */
.forest-card { margin: -4px -4px 18px; padding: 16px; border-radius: 18px; background: var(--inset-2); animation: sgRise var(--dur-enter) var(--ease-enter); }
.card-top { display: flex; align-items: center; gap: 12px; }
.card-sprite { flex: none; display: grid; place-items: center; width: 48px; height: 48px; border-radius: 14px; background: #FFFFFF; }
.card-names { min-width: 0; }
.card-title { margin: 2px 0 0; font-family: var(--font-display); font-size: 20px; font-weight: 500; line-height: 1.2; overflow-wrap: anywhere; }
.card-score { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 8px; margin-top: 12px; }
.card-pct { font-size: 32px; font-weight: 700; line-height: 1; letter-spacing: -1px; }
.card-pct-label { font-size: 13px; color: var(--muted); }
.card-score .pill { align-self: center; }
.forest-card .card-cells { margin-top: 8px; max-width: none; }
.card-outcome { margin: 12px 0 0; font-size: 14px; line-height: 1.55; }
.card-actions { display: flex; gap: 8px; margin-top: 14px; }
.card-actions button { padding: 0 14px; font-size: 14px; white-space: nowrap; }
.card-open { flex: 1 1 auto; }
.card-empty { margin: 0; font-size: 14px; line-height: 1.5; color: var(--muted); }

/* Topics accordion: one row per topic with its average as cells, the number, and its skill count. */
.forest-topics { margin-top: 20px; }
.forest-topics .eyebrow { margin-bottom: 8px; }
.topic-list, .skill-list { margin: 0; padding: 0; list-style: none; }
.topic-list { display: flex; flex-direction: column; gap: 4px; }
.topic-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; align-items: center; gap: 10px; width: 100%; padding: 10px; border: 0; border-radius: 14px; background: transparent; text-align: left; }
.topic-row:hover { background: var(--inset); }
.topic-row.open { background: var(--inset-2); }
.topic-main { min-width: 0; }
.topic-name { display: block; font-size: 14px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.topic-main .topic-cells { display: flex; margin-top: 5px; max-width: none; }
.topic-figures { display: flex; flex-direction: column; align-items: flex-end; gap: 1px; text-align: right; white-space: nowrap; }
.topic-pct { font-size: 13px; font-weight: 700; line-height: 1.3; }
.topic-count { font-size: 11px; line-height: 1.3; color: var(--muted); }
.skill-list { display: flex; flex-direction: column; gap: 2px; margin: 2px 0 8px 20px; padding-left: 12px; border-left: 2px solid #DDDDD8; }
.skill-row { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border: 0; border-radius: 10px; background: transparent; text-align: left; }
.skill-row:hover { background: var(--inset); }
.skill-row.on { background: var(--meadow-soft); }
.skill-name { flex: 1; min-width: 0; font-size: 13px; line-height: 1.35; overflow-wrap: anywhere; }
.skill-status { flex: none; font-size: 12px; font-weight: 700; color: var(--soft); white-space: nowrap; }
.skill-status.due { color: var(--coral-text); }
.skill-status.new { color: var(--new-text); }

.forest-plant { width: 100%; margin-top: 14px; padding: 12px; border: 2px dashed rgba(20, 20, 20, .25); border-radius: 14px; background: transparent; font-family: var(--font-display); font-size: 14px; color: var(--soft); }
.forest-plant:hover { background: var(--inset); }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 1099px) {
  .forest-body { grid-template-columns: minmax(0, 1fr) 280px; }
}
/* Phones: the aside stacks under the canvas and the whole overlay scrolls. */
@media (max-width: 759px) {
  .forest { padding: 12px 16px; }
  .forest-body { flex: none; display: flex; flex-direction: column; min-height: 0; }
  .forest-scene { flex: none; height: 420px; }
  .forest-aside { overflow: visible; padding: 16px; }
}
</style>
