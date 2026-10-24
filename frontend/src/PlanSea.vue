<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { rng, WHALE } from "./pixel-art.ts";

// The Plan sea (design/revamp/README.md): a pixel canvas, 4px cells, one column per day of the week grid below.
// Day 0 is the learner's sailboat, the other days are buoys, and the exam day (when an active exam falls in the week)
// is a rock island with a striped lighthouse. The WhaleLife whale swims from today toward the lighthouse.
// A 450ms tick drives the motion; under prefers-reduced-motion the scene is drawn once.
const props = defineProps<{ examDay: number | null; examTitle?: string; examDate?: string }>();
const U = 4, HEIGHT = 200, TICK = 450;
const wrap = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
const size = ref({ w: 900, h: HEIGHT });
let tick = 0, timer: ReturnType<typeof setInterval> | undefined, observer: ResizeObserver | undefined, motion: MediaQueryList | undefined;

const geo = computed(() => {
  const W = Math.ceil(size.value.w / U), H = Math.ceil(size.value.h / U), Hz = Math.round(H * 0.36);
  return { W, H, Hz, cx: (i: number) => Math.round((i + 0.5) * W / 7) };
});
const examAt = computed(() => props.examDay !== null && props.examDay >= 0 && props.examDay <= 6 ? props.examDay : null);
const signStyle = computed(() => examAt.value === null ? undefined : { left: `${geo.value.cx(examAt.value) * U}px`, top: `${(geo.value.Hz + 15) * U}px` });
const youStyle = computed(() => ({ left: `${geo.value.cx(0) * U}px`, top: `${(geo.value.Hz + 11) * U}px` }));
const description = computed(() => examAt.value === null ? "This week at sea. You are at today; no exam falls this week."
  : `This week at sea. You are at today, and the ${props.examTitle || "exam"} on ${props.examDate || "its day"} is the lighthouse.`);

function draw() {
  const cv = canvas.value; if (!cv) return;
  const { W, H, Hz, cx } = geo.value, tk = tick, dpr = window.devicePixelRatio || 1;
  if (cv.width !== W * U * dpr || cv.height !== H * U * dpr) { cv.width = W * U * dpr; cv.height = H * U * dpr; }
  cv.style.width = `${W * U}px`; cv.style.height = `${H * U}px`;
  const ctx = cv.getContext("2d"); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.imageSmoothingEnabled = false;
  const cell = (x: number, y: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x) * U, Math.round(y) * U, U, U); };
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x) * U, Math.round(y) * U, Math.round(w) * U, Math.round(h) * U); };
  // Sky in solid bands, the sun, drifting clouds.
  const sky = ["#D3EAF4", "#DCEFF6", "#E6F4F7", "#F0F7F3"], bh = Math.ceil(Hz / sky.length);
  sky.forEach((c, i) => rect(0, i * bh, W, bh, c));
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) { const q = dx * dx + dy * dy; if (q <= 17) cell(Math.round(W * 0.5) + dx, Math.round(Hz * 0.45) + dy, q <= 5 ? "#F3CD7A" : "#F9E3A8"); }
  const R = rng(21);
  for (let i = 0; i < Math.max(3, Math.floor(W / 50)); i++) {
    const cw = 8 + Math.floor(R() * 10), x = Math.floor((R() * W + tk * (0.3 + (i % 3) * 0.15)) % (W + 30)) - 15, y = 2 + Math.floor(R() * Math.round(Hz * 0.5));
    rect(x, y, cw, 2, "#FFFFFF"); rect(x + 2, y - 1, Math.max(3, cw - 5), 1, "#FFFFFF"); rect(x + 1, y + 2, cw - 2, 1, "#EEF6F9");
  }
  // Sea in solid bands with moving wave glints.
  const sea = ["#9BD7EC", "#80CBE6", "#66BEDF", "#4FAFD6", "#3A9CC8", "#2D88B6"], sh = Math.ceil((H - Hz) / sea.length);
  sea.forEach((c, i) => rect(0, Hz + i * sh, W, sh, c));
  for (let y = Hz + 1; y < H; y++) for (let x = 0; x < W; x++) if ((x + y * 7 + Math.floor(tk * (1 + (y % 2)))) % 19 === 0) { cell(x, y, "#D6F0F8"); cell(x + 1, y, "#BDE6F4"); }
  const exam = examAt.value, c0 = cx(0), target = cx(exam ?? 6), b0 = tk % 2;
  // Buoys on the other days.
  for (let i = 1; i <= 6; i++) {
    if (i === exam) continue;
    const x = cx(i), y = Hz + 6 + ((tk + i) % 2);
    cell(x, y - 2, "#FFFFFF"); rect(x - 1, y - 1, 3, 1, "#D9663A"); rect(x - 1, y, 3, 1, "#FFFFFF"); rect(x - 1, y + 1, 3, 1, "#D9663A"); cell(x, y + 2, "#3A9CC8");
  }
  // The exam day's island and lighthouse, with a blinking lamp and a beam.
  if (exam !== null) {
    const c6 = target;
    rect(c6 - 8, Hz + 3, 17, 3, "#8E9BA2"); rect(c6 - 6, Hz + 1, 13, 2, "#AEBAC0");
    for (let r = 0; r < 12; r++) rect(c6 - 1, Hz - 11 + r, 3, 1, Math.floor(r / 2) % 2 ? "#D9663A" : "#FFFFFF");
    rect(c6 - 2, Hz - 14, 5, 1, "#48555C"); rect(c6 - 1, Hz - 13, 3, 2, tk % 2 ? "#F3CD7A" : "#E3A233");
    if (tk % 4 < 2) { rect(c6 - 12, Hz - 13, 10, 1, "#F6E7B6"); rect(c6 + 3, Hz - 13, 10, 1, "#F6E7B6"); }
  }
  // Today's sailboat. On an exam day that is today, the boat sits just left of the island.
  const bx = exam === 0 ? c0 - 12 : c0, by = Hz + 7 + b0;
  rect(bx - 5, by, 11, 1, "#8A5A2B"); rect(bx - 4, by + 1, 9, 1, "#6B4420"); rect(bx, by - 9, 1, 9, "#48555C");
  for (let r = 0; r < 8; r++) rect(bx + 1, by - 9 + r, Math.floor(r * 0.7) + 1, 1, "#FFFFFF");
  cell(bx, by - 10, "#E3A233"); rect(bx - 6, by + 2, 13, 1, "#80CBE6");
  // The whale, mirrored to face right at 2px per unit, swims from today toward the lighthouse and spouts about every 6 seconds.
  const span = Math.max(10, target - c0 - 22), wx = c0 + 8 + ((tk * 0.6) % span), wy = Hz + 11 + (tk % 3 === 0 ? 1 : 0), ox = wx * U, oy = wy * U, s = 2;
  for (const [x, y, w, h, c] of WHALE) { ctx.fillStyle = c; ctx.fillRect(ox + (26 - x - w) * s, oy + y * s, w * s, h * s); }
  if (tk % 14 < 3) { ctx.fillStyle = "#E3F4FA"; ctx.fillRect(ox + 17 * s, oy - 4 * s, 2 * s, 3 * s); ctx.fillRect(ox + 15 * s, oy - 6 * s, 2 * s, 2 * s); ctx.fillRect(ox + 19 * s, oy - 6 * s, 2 * s, 2 * s); }
}

function start() {
  if (timer) { clearInterval(timer); timer = undefined; }
  if (motion?.matches) return;
  timer = setInterval(() => { tick += 1; draw(); }, TICK);
}
function measure() {
  const el = wrap.value; if (!el) return;
  const w = Math.max(1, Math.round(el.clientWidth)), h = Math.max(1, Math.round(el.clientHeight || HEIGHT));
  if (w !== size.value.w || h !== size.value.h) size.value = { w, h };
  draw();
}
onMounted(() => {
  motion = window.matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", start);
  observer = new ResizeObserver(measure);
  if (wrap.value) observer.observe(wrap.value);
  measure(); start();
});
watch(() => [props.examDay, size.value], () => draw(), { flush: "post" });
onBeforeUnmount(() => { if (timer) clearInterval(timer); observer?.disconnect(); motion?.removeEventListener("change", start); });
</script>

<template>
  <section class="plan-sea" role="img" :aria-label="description">
    <div ref="wrap" class="sea-wrap">
      <canvas ref="canvas" aria-hidden="true" />
      <span v-if="signStyle" class="sea-sign" :style="signStyle" aria-hidden="true"><span class="sign-title">{{ examTitle || 'Exam' }}</span><span class="sign-date">{{ examDate }}</span></span>
      <span class="sea-you" :style="youStyle" aria-hidden="true">You · today</span>
    </div>
  </section>
</template>

<style scoped>
.plan-sea{position:relative;height:200px;border-radius:24px;overflow:hidden;border:1px solid #CFE7F2;background:#9BD7EC}
.sea-wrap{position:absolute;inset:0}
canvas{position:absolute;left:0;top:0;image-rendering:pixelated}
.sea-sign{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;padding:3px 9px 4px;background:#E9D6A8;box-shadow:inset 0 -2px 0 #CDB884,0 0 0 2px #C08324;white-space:nowrap;pointer-events:none}
.sign-title{font-family:var(--font-display);font-size:13px;color:var(--ink)}
.sign-date{font-size:11px;font-weight:700;color:var(--soft)}
.sea-you{position:absolute;transform:translateX(-50%);font-family:var(--font-display);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:#08344D;background:rgba(255,255,255,.85);padding:2px 6px;white-space:nowrap;pointer-events:none}
</style>
