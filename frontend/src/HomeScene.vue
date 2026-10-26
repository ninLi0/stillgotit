<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { SPRITES, iconRects, rng } from "./pixel-art.ts";
import { cloudDrift, cloudRects, snapStyle, sprite, type CellRect, type Sprite } from "./scene-motion.ts";
import ContinueCard from "./ContinueCard.vue";
import type { OpenSession } from "./continue-session.ts";
import { MOON, dayOrNight, isNight, leafColor, scatterStars, sceneColor } from "./scene-palette.ts";
import { currentTheme } from "./theme.ts";

// The Home hero scene (design/revamp/README.md): a pixel meadow drawn on a canvas at 4px cells × devicePixelRatio, a
// dotted path from "You · today" past one post per day to the exam hill and its flag. The panel on top is the slot.
// The canvas holds everything that stays still; the clouds, the flag's cloth and the leaf are SVG sprites over it that
// drift on eased loops (scene-motion.ts), and stay where they are drawn when the device asks for reduced motion. Below
// the scene, the Continue card lists the open lessons and practice tasks; `open` asks the shell to open a row's skill.
const props = withDefaults(defineProps<{ days?: number; sign?: { title: string; when: string } | null; progress?: number; sessions?: readonly OpenSession[] }>(),
  { days: 5, sign: null, progress: 0, sessions: () => [] });
const emit = defineEmits<{ open: [skill: string] }>();
const wrap = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
const size = ref({ w: 900, h: 214 }), dpr = ref(1);
let observer: ResizeObserver | undefined;

const geo = computed(() => {
  const { w, h } = size.value, U = 4, W = Math.ceil(w / U), H = Math.ceil(h / U), G = Math.round(H * 0.72), pr = w < 760 ? 0.66 : 0.52;
  return { U, W, H, G, xT: Math.round(W * (pr + (w < 760 ? 0.13 : 0.08))), xE: Math.round(W * 0.92) };
});
// Where the HTML labels sit over the canvas, in CSS pixels.
const signAt = computed(() => { const { U, xE, G } = geo.value; return { left: `${xE * U}px`, top: `${(G - 18) * U}px` }; });
const youAt = computed(() => { const { U, xT, G } = geo.value; return { left: `${xT * U}px`, top: `${(G + 6) * U}px` }; });

// The flag's cloth, one column of cells at a time, from the pole outward. Each column ripples a little further than the
// one before it and a little later, so a soft wave runs out along the cloth.
const CORAL = "#D9663A", SHADE = "#B5502B";
const CLOTH: CellRect[][] = [
  [{ x: 0, y: 0, w: 1, h: 2, fill: CORAL }, { x: 0, y: 2, w: 1, h: 1, fill: SHADE }],
  [{ x: 1, y: 0, w: 1, h: 1, fill: CORAL }, { x: 1, y: 1, w: 1, h: 1, fill: "#EE9C78" }, { x: 1, y: 2, w: 1, h: 1, fill: SHADE }],
  [{ x: 2, y: 0, w: 1, h: 2, fill: CORAL }, { x: 2, y: 2, w: 1, h: 1, fill: SHADE }],
  [{ x: 3, y: 0, w: 1, h: 2, fill: CORAL }],
];
const LEAF: CellRect[] = iconRects(SPRITES.leaf).map((r) => ({ ...r, h: 1 }));

const sprites = computed<Sprite[]>(() => {
  const { U, W, G, xT, xE } = geo.value, out: Sprite[] = [];
  // Clouds sit where the seed puts them (the same places as before) and drift a few dozen pixels each way.
  const R = rng(3), M = rng(103), maxY = Math.round(G * 0.35);
  for (let i = 0; i < Math.max(3, Math.floor(W / 50)); i++) {
    const cw = 8 + Math.floor(R() * 10), cx = Math.floor(R() * W) - 15, cy = 2 + Math.floor(R() * maxY), { drift, shift } = cloudDrift(M, U);
    out.push(sprite(`cloud-${i}`, cx - shift, cy, U, cloudRects(cw, "#EEF6F9", 2, 5), drift));
  }
  if (props.sign) {
    const fy = G - 7;
    CLOTH.forEach((column, k) => out.push(sprite(`cloth-${k}`, xE + 1, fy - 9, U, column, { y: [0, 1, 1.5, 2][k], seconds: 0.8, phase: 0.15 * k })));
  }
  // "You · today": the leaf bobs a few pixels above its mound.
  out.push(sprite("leaf", xT - 3, G + 3 - 7, U, LEAF.map((r) => ({ ...r, fill: leafColor(r.fill) })), { y: -3, seconds: 1.6 }));
  return out;
});

function draw() {
  const cv = canvas.value; if (!cv) return;
  const { U, W, H, G, xT, xE } = geo.value, ratio = window.devicePixelRatio || 1;
  if (cv.width !== W * U * ratio || cv.height !== H * U * ratio) { cv.width = W * U * ratio; cv.height = H * U * ratio; }
  const ctx = cv.getContext("2d"); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.imageSmoothingEnabled = false;
  const cell = (x: number, y: number, c: string) => { ctx.fillStyle = sceneColor(c); ctx.fillRect(Math.round(x) * U, Math.round(y) * U, U, U); };
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = sceneColor(c); ctx.fillRect(Math.round(x) * U, Math.round(y) * U, Math.round(w) * U, Math.round(h) * U); };
  // Sky as solid bands, never a gradient.
  const sky = ["#CFE6F0", "#D7EBF2", "#E0EFF3", "#E9F3F1", "#F3F4E6"], bh = Math.ceil(G / sky.length);
  sky.forEach((c, i) => rect(0, i * bh, W, bh, c));
  // The sun's arc follows today's minutes against the budget; by night the moon takes its place.
  const p = Math.max(0, Math.min(1, props.progress)), sx = Math.round(xT + (xE - xT) * p * 0.8), sy = Math.round(G * 0.5 - Math.sin(Math.max(0.2, p) * Math.PI) * G * 0.32);
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const q = dx * dx + dy * dy; if (q <= 26) cell(sx + dx, sy + dy, q <= 10 ? dayOrNight("#E3A233", MOON.face) : dayOrNight("#F3CD7A", MOON.rim)); }
  if (isNight()) { cell(sx + 1, sy - 2, MOON.crater); cell(sx - 2, sy + 1, MOON.crater); cell(sx + 2, sy + 1, MOON.crater); }
  for (let x = 0; x < W; x++) { const top = Math.round(G - (G * 0.24 + Math.sin(x / 23 + 0.4) * G * 0.08)); rect(x, top, 1, G - top, "#BFDCC8"); }
  for (let x = 0; x < W; x++) { const top = Math.round(G - (G * 0.1 + Math.sin(x / 13 + 1) * 2)); rect(x, top, 1, G - top, "#A3D6B4"); }
  rect(0, G, W, H - G, "#7CC497"); rect(0, G, W, 1, "#9AD6AE"); rect(0, Math.round(G + (H - G) * 0.6), W, H, "#6DB892");
  const RG = rng(9);
  for (let x = 0; x < W; x++) { if (RG() < 0.2) cell(x, G - 1, "#7CC497"); if (RG() < 0.1) cell(x, G + 2 + Math.floor(RG() * (H - G - 3)), "#4E9E70"); }
  // The exam hill.
  for (let dx = -12; dx <= 12; dx++) { const hh = Math.round((1 - (dx / 12) ** 2) * 7); rect(xE + dx, G - hh, 1, hh, dx < -4 ? "#9AD6AE" : "#8CCDA5"); }
  // The dotted sand path and one post per day between today and the exam.
  const py = G + 3, segments = Math.max(2, Math.round(props.days) + 1);
  for (let x = xT; x <= xE; x++) if ((x - xT) % 3 < 2) cell(x, py + Math.round(Math.sin(x / 6)), "#E9D6A8");
  for (let k = 1; k < segments; k++) { const x = Math.round(xT + k * (xE - xT) / segments); rect(x, py - 3, 1, 3, "#A8742A"); cell(x, py - 4, "#C08324"); }
  // The flag's pole; its cloth is a sprite.
  if (props.sign) rect(xE, G - 16, 1, 9, "#48555C");
  // The mound under "You · today"; its leaf is a sprite.
  rect(xT - 4, py, 9, 1, "#5FAE85");
  scatterStars(ctx, U * ratio, W, G, 3);
}

onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect; if (!box) return;
    size.value = { w: Math.max(1, Math.round(box.width)), h: Math.max(1, Math.round(box.height)) };
    dpr.value = window.devicePixelRatio || 1;
  });
  if (wrap.value) observer.observe(wrap.value);
  dpr.value = window.devicePixelRatio || 1;
  draw();
});
watch([size, dpr, () => props.days, () => props.sign, () => props.progress, currentTheme], draw, { flush: "post" });
onBeforeUnmount(() => { observer?.disconnect(); });
</script>

<template>
  <section class="home-scene">
    <div ref="wrap" class="scene-art" :style="snapStyle(dpr)" aria-hidden="true">
      <canvas ref="canvas" :style="{ width: `${geo.W * geo.U}px`, height: `${geo.H * geo.U}px` }" />
      <svg class="sprites" :width="geo.W * geo.U" :height="geo.H * geo.U" shape-rendering="crispEdges" focusable="false">
        <g v-for="s in sprites" :key="s.key" :transform="s.at"><g class="drift" :style="s.motion"><rect v-for="(r, i) in s.rects" :key="i" v-bind="r" /></g></g>
      </svg>
      <span v-if="sign" class="plank" :style="signAt"><span class="plank-title">{{ sign.title }}</span><span class="plank-when">{{ sign.when }}</span></span>
      <span class="you" :style="youAt">You · today</span>
    </div>
    <div class="scene-panel"><slot /></div>
  </section>
  <ContinueCard v-if="sessions.length" :sessions="sessions" @open="emit('open', $event)" />
</template>

<style scoped>
.home-scene { position: relative; min-height: 214px; border-radius: 24px; overflow: hidden; border: 1px solid var(--home-line); background: var(--home-sky); }
.scene-art { position: absolute; inset: 0; }
canvas { position: absolute; left: 0; top: 0; image-rendering: pixelated; }
.sprites { position: absolute; left: 0; top: 0; overflow: hidden; pointer-events: none; }
.plank { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; padding: 3px 9px 4px; background: var(--plank); box-shadow: inset 0 -2px 0 var(--plank-edge), 0 0 0 2px var(--plank-ring); white-space: nowrap; pointer-events: none; }
.plank-title { font: 400 13px var(--font-display); color: var(--plank-ink); }
.plank-when { font-size: 11px; font-weight: 700; color: var(--plank-soft); }
.you { position: absolute; z-index: 2; transform: translateX(-30%); font: 400 11px var(--font-display); letter-spacing: 1px; text-transform: uppercase; color: var(--meadow-label); background: var(--scene-label); padding: 2px 6px; white-space: nowrap; pointer-events: none; }
.scene-panel { position: relative; z-index: 1; margin: 16px; max-width: 52%; background: var(--card); border-radius: 18px; padding: 16px 18px; box-shadow: 0 0 0 1px rgb(var(--shadow) / .06), 0 10px 22px rgb(var(--shadow) / .08); display: flex; flex-direction: column; gap: 6px; animation: sgRise var(--dur-enter) var(--ease-enter) both; }
@media (max-width: 760px) { .scene-panel { max-width: 66%; } }
@media (max-width: 520px) { .scene-panel { max-width: none; margin: 12px 12px 86px; } }
</style>
