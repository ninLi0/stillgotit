<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CELL, GROUND, HEIGHT, drawGrove, growGrove, type GroveTopic, type GroveTree } from "./GroveScene.ts";
import { STAGE_LABELS, rng, type Stage } from "./pixel-art.ts";
import PixelIcon from "./PixelIcon.vue";
import { GROVE_NIGHT_SKY, MOON, WELCOME_NIGHT_SKY, dayOrNight, isNight, scatterStars, sceneColor } from "./scene-palette.ts";
import { currentTheme } from "./theme.ts";

// The welcome panel shows the app's own picture of learning before anyone signs in: a sample grove drawn with the same
// code as the Home screen (design/revamp/README.md), at half size so three topic trees fit the panel. Each tree is a
// topic from an example course; each leaf is a skill at its own stage of growth. Nothing here is live data.
const SAMPLE: GroveTopic[] = [
  { id: "vectors", title: "Vectors", skills: [
    { skill: "v1", title: "Add and scale vectors", mastery: 92, due: false },
    { skill: "v2", title: "Dot products", mastery: 74, due: false },
    { skill: "v3", title: "Span and linear independence", mastery: 58, due: true },
    { skill: "v4", title: "Projections", mastery: 31, due: false },
  ] },
  { id: "matrices", title: "Matrices", skills: [
    { skill: "m1", title: "Multiply two matrices", mastery: 86, due: false },
    { skill: "m2", title: "Row reduce to echelon form", mastery: 67, due: false },
    { skill: "m3", title: "Find an inverse", mastery: 44, due: false },
    { skill: "m4", title: "Determinants", mastery: 22, due: true },
    { skill: "m5", title: "Partitioned matrices", due: false },
  ] },
  { id: "eigen", title: "Eigenvalues", skills: [
    { skill: "e1", title: "Characteristic polynomial", mastery: 48, due: false },
    { skill: "e2", title: "Diagonalise a matrix", mastery: 12, due: false },
    { skill: "e3", title: "Powers of a matrix", due: false },
  ] },
];
const LEGEND: Stage[] = ["bud", "sprout", "leaf", "full", "bloom"];
const SCALE = 0.5, FOOT = 40, SKY = ["#CFE3EE", "#D3E6F0", "#D7E8F1", "#DBEAF2", "#DFECF3"];
const wrap = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
const planks = ref<{ key: string; title: string; meta: string; left: number; top: number }[]>([]);
let observer: ResizeObserver | undefined, measure: CanvasRenderingContext2D | null | undefined, offscreen: HTMLCanvasElement | undefined;

function textWidth(text: string, font: string) {
  measure ??= document.createElement("canvas").getContext("2d");
  if (!measure) return text.length * 8;
  measure.font = font;
  return measure.measureText(text).width;
}
// Planks are measured at the size they are shown (half the grove's), so the trees keep the same spacing as on Home.
function plankCells(title: string, meta: string) {
  const text = Math.max(textWidth(title, '12px "Pixelify Sans", monospace'), textWidth(meta, '600 11px "Instrument Sans", sans-serif')) / SCALE;
  return Math.ceil((Math.min(280, Math.ceil(text) + 20) + 4 + 8) / CELL);
}
function draw() {
  const el = wrap.value, cv = canvas.value; if (!el || !cv) return;
  const w = Math.max(1, Math.round(el.clientWidth)), h = Math.max(1, Math.round(el.clientHeight)), dpr = window.devicePixelRatio || 1;
  const grove = growGrove(SAMPLE, 11, plankCells);
  const off = offscreen ??= document.createElement("canvas");
  const groveCss = grove.width * CELL;
  drawGrove(off, grove, groveCss, dpr, null, null);
  cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = `${w}px`; cv.style.height = `${h}px`;
  const ctx = cv.getContext("2d"); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
  // The grove image sits at the bottom; the sky above it continues the grove's own top band, with a sun and clouds in 2px cells.
  // By night the sky darkens upward, and the moon and a few stars come out (scene-palette.ts).
  // The grove stops FOOT pixels above the caption so the signposts under the ground stay in view.
  const gh = Math.round(HEIGHT * CELL * SCALE), gw = Math.round(groveCss * SCALE), top = h - gh - FOOT, x0 = Math.round((w - gw) / 2);
  const U = CELL * SCALE, band = Math.ceil(Math.max(top, 1) / SKY.length);
  (isNight() ? WELCOME_NIGHT_SKY : SKY).forEach((colour, i) => { ctx.fillStyle = colour; ctx.fillRect(0, Math.max(0, top - (i + 1) * band), w, band); });
  const cell = (x: number, y: number, colour: string) => { ctx.fillStyle = sceneColor(colour); ctx.fillRect(Math.round(x) * U, Math.round(y) * U, U, U); };
  const sunX = Math.round(w / U) - 16, sunY = 12;
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const q = dx * dx + dy * dy; if (q <= 26) cell(sunX + dx, sunY + dy, q <= 8 ? dayOrNight("#F3CD7A", MOON.face) : dayOrNight("#F9E3A8", MOON.rim)); }
  if (isNight()) { cell(sunX + 1, sunY - 2, MOON.crater); cell(sunX - 2, sunY + 1, MOON.crater); cell(sunX + 2, sunY + 2, MOON.crater); }
  const R = rng(5), cols = Math.floor(w / U);
  for (let i = 0; i < 4; i++) {
    const cw = 10 + Math.floor(R() * 10), x = Math.floor(R() * Math.max(1, cols - cw)), y = 6 + Math.floor(R() * Math.max(1, Math.floor(top / U) - 20));
    ctx.fillStyle = sceneColor("#FFFFFF"); ctx.fillRect(x * U, y * U, cw * U, 2 * U); ctx.fillRect((x + 2) * U, (y - 1) * U, Math.max(3, cw - 5) * U, U);
    ctx.fillStyle = sceneColor("#EEF6F9"); ctx.fillRect((x + 1) * U, (y + 2) * U, (cw - 2) * U, U);
  }
  // By night the grove's sky bands are darker than the page's sky, so they run the full width instead of ending at the grove.
  if (isNight()) { const bandPx = Math.ceil(GROUND / GROVE_NIGHT_SKY.length) * U; GROVE_NIGHT_SKY.forEach((colour, i) => { ctx.fillStyle = colour; ctx.fillRect(0, top + i * bandPx, w, bandPx); }); }
  ctx.drawImage(off, 0, 0, off.width, off.height, x0, top, gw, gh);
  // Below the grove, the ground continues in the grove's own bottom colour, across the whole width.
  const soil = off.getContext("2d")?.getImageData(Math.floor(off.width / 2), off.height - 1, 1, 1).data;
  const soilColour = soil ? `rgb(${soil[0]}, ${soil[1]}, ${soil[2]})` : sceneColor("#B9A26E");
  ctx.fillStyle = soilColour; ctx.fillRect(0, top + gh, w, FOOT);
  if (gw < w) { const groundTop = top + Math.round(GROUND * CELL * SCALE); ctx.fillRect(0, groundTop, x0, h - groundTop); ctx.fillRect(x0 + gw, groundTop, w - x0 - gw, h - groundTop); }
  scatterStars(ctx, U * dpr, Math.ceil(w / U), Math.ceil(h / U), 5);
  planks.value = grove.trees.map((tree: GroveTree) => ({ key: tree.key, title: tree.title, meta: tree.meta, left: x0 + tree.cx * CELL * SCALE, top: top + (GROUND + 4) * CELL * SCALE }));
}
onMounted(() => {
  observer = new ResizeObserver(draw);
  if (wrap.value) observer.observe(wrap.value);
  draw();
  // Signpost widths depend on the fonts, so the scene is drawn again once they have loaded.
  void document.fonts?.ready.then(draw);
});
watch(currentTheme, draw);
onBeforeUnmount(() => observer?.disconnect());
</script>

<template>
  <figure class="welcome-scene">
    <div ref="wrap" class="scene-wrap" role="img" aria-label="A sample grove: three topic trees from a linear algebra course, each leaf one skill at its own stage of growth.">
      <canvas ref="canvas" aria-hidden="true" />
      <span v-for="plank in planks" :key="plank.key" class="plank" aria-hidden="true" :style="{ left: `${plank.left}px`, top: `${plank.top}px` }">
        <span class="plank-title">{{ plank.title }}</span><span class="plank-meta">{{ plank.meta }}</span>
      </span>
    </div>
    <figcaption class="scene-caption">
      <p class="eyebrow">Understanding takes root</p>
      <p class="caption-text">Each topic grows a tree. Each skill is a leaf that grows as you master it.</p>
      <ul class="legend" aria-label="Leaf stages">
        <li v-for="stage in LEGEND" :key="stage"><PixelIcon :sprite="stage" :size="22" /><span>{{ STAGE_LABELS[stage] }}</span></li>
      </ul>
    </figcaption>
  </figure>
</template>

<style scoped>
.welcome-scene { position: relative; margin: 0; align-self: stretch; min-height: 460px; display: flex; flex-direction: column; justify-content: flex-end; border-radius: 24px; overflow: hidden; background: var(--sky); }
.scene-wrap { position: absolute; inset: 0 0 112px; overflow: hidden; }
canvas { display: block; image-rendering: pixelated; }
.plank { position: absolute; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; max-width: 150px; padding: 3px 8px 4px; background: var(--plank); box-shadow: inset 0 -2px 0 var(--plank-edge), 0 0 0 2px var(--plank-ring); white-space: nowrap; }
.plank-title { max-width: 100%; overflow: hidden; text-overflow: ellipsis; font: 400 12px/15px var(--font-display); color: var(--plank-ink); }
.plank-meta { font: 600 11px/14px var(--font-body); color: var(--plank-soft); font-variant-numeric: tabular-nums; }
.scene-caption { position: relative; margin: 14px; padding: 14px 16px; border-radius: 16px; background: var(--scene-card); box-shadow: 0 0 0 1px var(--card-border); }
.scene-caption .eyebrow { margin: 0 0 4px; }
.caption-text { margin: 0 0 10px; font-size: 14px; color: var(--soft); line-height: 1.5; }
.legend { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px 14px; }
.legend li { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
@media (max-width: 900px) { .welcome-scene { min-height: 400px; } }
</style>
