<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { PAL, SPRITES, rng } from "./pixel-art.ts";

// The Home hero scene (design/revamp/README.md): a pixel meadow drawn on a canvas at 4px cells × devicePixelRatio, a
// dotted path from "You · today" past one post per day to the exam hill and its waving flag. The panel on top is the
// slot. Clouds and the flag move on a 450ms tick unless the device asks for reduced motion.
const props = withDefaults(defineProps<{ days?: number; sign?: { title: string; when: string } | null; progress?: number }>(), { days: 5, sign: null, progress: 0 });
const wrap = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
const size = ref({ w: 900, h: 214 });
let tick = 0, timer: number | undefined, observer: ResizeObserver | undefined;

const geo = computed(() => {
  const { w, h } = size.value, U = 4, W = Math.ceil(w / U), H = Math.ceil(h / U), G = Math.round(H * 0.72), pr = w < 760 ? 0.66 : 0.52;
  return { U, W, H, G, xT: Math.round(W * (pr + (w < 760 ? 0.13 : 0.08))), xE: Math.round(W * 0.92) };
});
// Where the HTML labels sit over the canvas, in CSS pixels.
const signAt = computed(() => { const { U, xE, G } = geo.value; return { left: `${xE * U}px`, top: `${(G - 18) * U}px` }; });
const youAt = computed(() => { const { U, xT, G } = geo.value; return { left: `${xT * U}px`, top: `${(G + 6) * U}px` }; });

function draw() {
  const cv = canvas.value; if (!cv) return;
  const { U, W, H, G, xT, xE } = geo.value, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * U * dpr || cv.height !== H * U * dpr) { cv.width = W * U * dpr; cv.height = H * U * dpr; }
  const ctx = cv.getContext("2d"); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
  const cell = (x: number, y: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x) * U, Math.round(y) * U, U, U); };
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x) * U, Math.round(y) * U, Math.round(w) * U, Math.round(h) * U); };
  // Sky as solid bands, never a gradient.
  const sky = ["#CFE6F0", "#D7EBF2", "#E0EFF3", "#E9F3F1", "#F3F4E6"], bh = Math.ceil(G / sky.length);
  sky.forEach((c, i) => rect(0, i * bh, W, bh, c));
  // The sun's arc follows today's minutes against the budget.
  const p = Math.max(0, Math.min(1, props.progress)), sx = Math.round(xT + (xE - xT) * p * 0.8), sy = Math.round(G * 0.5 - Math.sin(Math.max(0.2, p) * Math.PI) * G * 0.32);
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const q = dx * dx + dy * dy; if (q <= 26) cell(sx + dx, sy + dy, q <= 10 ? "#E3A233" : "#F3CD7A"); }
  const R = rng(3), maxY = Math.round(G * 0.35);
  for (let i = 0; i < Math.max(3, Math.floor(W / 50)); i++) {
    const cw = 8 + Math.floor(R() * 10), cx = Math.floor((R() * W + tick * (0.3 + (i % 3) * 0.15)) % (W + 30)) - 15, cy = 2 + Math.floor(R() * maxY);
    rect(cx, cy, cw, 2, "#FFFFFF"); rect(cx + 2, cy - 1, Math.max(3, cw - 5), 1, "#FFFFFF"); rect(cx + 1, cy + 2, cw - 2, 1, "#EEF6F9");
  }
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
  if (props.sign) {
    const fy = G - 7, wv = tick % 2;
    rect(xE, fy - 9, 1, 9, "#48555C"); rect(xE + 1, fy - 9, 4, 1, "#D9663A"); rect(xE + 1, fy - 8, 4 - wv, 1, "#D9663A"); rect(xE + 1, fy - 7, 3, 1, "#B5502B"); cell(xE + 2, fy - 8, "#EE9C78");
  }
  // "You · today": a leaf sprite on a mound.
  const bob = tick % 2;
  rect(xT - 4, py, 9, 1, "#5FAE85");
  SPRITES.leaf.forEach((row, ry) => { for (let rx = 0; rx < row.length; rx++) if (row[rx] !== ".") cell(xT - 3 + rx, py - 7 + ry - bob, PAL[row[rx]!] ?? "#000000"); });
}

const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
onMounted(() => {
  observer = new ResizeObserver((entries) => {
    const box = entries[0]?.contentRect; if (!box) return;
    size.value = { w: Math.max(1, Math.round(box.width)), h: Math.max(1, Math.round(box.height)) };
  });
  if (wrap.value) observer.observe(wrap.value);
  draw();
  if (!reduced) timer = window.setInterval(() => { tick++; draw(); }, 450);
});
watch([size, () => props.days, () => props.sign, () => props.progress], draw, { flush: "post" });
onBeforeUnmount(() => { observer?.disconnect(); if (timer) window.clearInterval(timer); });
</script>

<template>
  <section class="home-scene">
    <div ref="wrap" class="scene-art" aria-hidden="true">
      <canvas ref="canvas" :style="{ width: `${geo.W * geo.U}px`, height: `${geo.H * geo.U}px` }" />
      <span v-if="sign" class="plank" :style="signAt"><span class="plank-title">{{ sign.title }}</span><span class="plank-when">{{ sign.when }}</span></span>
      <span class="you" :style="youAt">You · today</span>
    </div>
    <div class="scene-panel"><slot /></div>
  </section>
</template>

<style scoped>
.home-scene { position: relative; min-height: 214px; border-radius: 24px; overflow: hidden; border: 1px solid #DCEBE1; background: #DDEFF3; }
.scene-art { position: absolute; inset: 0; }
canvas { position: absolute; left: 0; top: 0; image-rendering: pixelated; }
.plank { position: absolute; transform: translate(-50%, -100%); display: flex; flex-direction: column; align-items: center; padding: 3px 9px 4px; background: #E9D6A8; box-shadow: inset 0 -2px 0 #CDB884, 0 0 0 2px #C08324; white-space: nowrap; pointer-events: none; }
.plank-title { font: 400 13px var(--font-display); color: #151515; }
.plank-when { font-size: 11px; font-weight: 700; color: #4A4A48; }
.you { position: absolute; z-index: 2; transform: translateX(-30%); font: 400 11px var(--font-display); letter-spacing: 1px; text-transform: uppercase; color: #1F4A30; background: rgba(255, 255, 255, .85); padding: 2px 6px; white-space: nowrap; pointer-events: none; }
.scene-panel { position: relative; z-index: 1; margin: 16px; max-width: 52%; background: #FFFFFF; border-radius: 18px; padding: 16px 18px; box-shadow: 0 0 0 1px rgba(20, 40, 30, .06), 0 10px 22px rgba(20, 60, 40, .08); display: flex; flex-direction: column; gap: 6px; animation: sgRise 240ms ease-out both; }
@media (max-width: 760px) { .scene-panel { max-width: 66%; } }
@media (max-width: 520px) { .scene-panel { max-width: none; margin: 12px 12px 86px; } }
</style>
