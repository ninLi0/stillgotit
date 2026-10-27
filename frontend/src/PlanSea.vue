<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { rng, WHALE } from "./pixel-art.ts";
import { cloudDrift, cloudRects, driftStyle, snapStyle, sprite, toPixels, type CellRect, type Sprite } from "./scene-motion.ts";
import { MOON, MOONLIT, NIGHT_CLOUD, STARS, dayOrNight, isNight, scatterStars, sceneColor } from "./scene-palette.ts";
import { currentTheme } from "./theme.ts";

// The Plan sea (design/revamp/README.md): a pixel canvas, 4px cells, one column per day of the week grid below.
// Day 0 is the learner's sailboat, the other days are buoys, and the exam day (when an active exam falls in the week)
// is a rock island with a striped lighthouse. The WhaleLife whale swims from today toward the lighthouse.
// The canvas holds the sky, the sun and the sea bands, which stay still. Everything that moves is an SVG sprite over it
// on an eased loop (scene-motion.ts): the clouds and the wave glints drift, the boat and the buoys bob, the lamp
// breathes, and the whale crosses on a slow arc. Under prefers-reduced-motion every sprite stays where it is drawn.
// `centers` are the day columns' horizontal centres in CSS pixels, measured by the planner, so every mark sits over its column.
const props = defineProps<{ examDay: number | null; examTitle?: string; examDate?: string; width?: number; height?: number; centers?: number[]; horizon?: number }>();
const U = 4, HEIGHT = 136;
const wrap = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
const size = ref({ w: 900, h: HEIGHT }), dpr = ref(1);
let observer: ResizeObserver | undefined;

const geo = computed(() => {
  const W = Math.ceil(size.value.w / U), H = Math.ceil(size.value.h / U), centers = props.centers ?? [];
  const Hz = props.horizon ? Math.min(H - 20, Math.max(16, Math.round(props.horizon / U))) : Math.round(H * 0.47);
  return { W, H, Hz, cx: (i: number) => { const c = centers[i]; return c === undefined ? Math.round((i + 0.5) * W / 7) : Math.round(c / U); } };
});
const examAt = computed(() => props.examDay !== null && props.examDay >= 0 && props.examDay <= 6 ? props.examDay : null);
// With the planner's columns over the sea, the day planks name today and the exam, so the sea keeps its own labels only on its own.
const labelled = computed(() => props.horizon === undefined);
const signStyle = computed(() => examAt.value === null || !labelled.value ? undefined : { left: `${geo.value.cx(examAt.value) * U}px`, top: `${(geo.value.Hz + 15) * U}px` });
const youStyle = computed(() => ({ left: `${geo.value.cx(0) * U}px`, top: `${(geo.value.Hz + 11) * U}px` }));
const description = computed(() => examAt.value === null ? "This week at sea. You are at today; no exam falls this week."
  : `This week at sea. You are at today, and the ${props.examTitle || "exam"} on ${props.examDate || "its day"} is the lighthouse.`);

const WHITE = "#FFFFFF", CORAL = "#D9663A";
const BUOY: CellRect[] = [
  { x: 0, y: -2, w: 1, h: 1, fill: WHITE }, { x: -1, y: -1, w: 3, h: 1, fill: CORAL }, { x: -1, y: 0, w: 3, h: 1, fill: WHITE },
  { x: -1, y: 1, w: 3, h: 1, fill: CORAL }, { x: 0, y: 2, w: 1, h: 1, fill: "#3A9CC8" },
];
const BOAT: CellRect[] = [
  { x: -5, y: 0, w: 11, h: 1, fill: "#8A5A2B" }, { x: -4, y: 1, w: 9, h: 1, fill: "#6B4420" }, { x: 0, y: -9, w: 1, h: 9, fill: "#48555C" },
  ...Array.from({ length: 8 }, (_, r): CellRect => ({ x: 1, y: -9 + r, w: Math.floor(r * 0.7) + 1, h: 1, fill: WHITE })),
  { x: 0, y: -10, w: 1, h: 1, fill: "#E3A233" },
];
// The sea's tones from the crest down to the deepest band. The six bands use the last six, lightest at the horizon;
// a wave stroke takes a tone two steps lighter than its band, and today's column is washed one step lighter.
const WATER = ["#D6F0F8", "#BDE6F4", "#9BD7EC", "#80CBE6", "#66BEDF", "#4FAFD6", "#3A9CC8", "#2D88B6"];
/** The first row of each sea band: thin bands near the horizon, deeper ones below, as the sea recedes. */
function seaBands(Hz: number, H: number): number[] {
  const weights = [1, 1, 2, 2, 3, 4], depth = H - Hz;
  let acc = 0;
  return weights.map((w) => { const top = Hz + Math.round((acc * depth) / 13); acc += w; return top; });
}
// The wave line the boat sits on stays put and is drawn over the hull, so the boat dips into it as it bobs; a bow
// splash in front and a short wake behind.
const WAKE: CellRect[] = [
  { x: -6, y: 2, w: 13, h: 1, fill: "#BDE6F4" }, { x: 6, y: 1, w: 2, h: 1, fill: "#D6F0F8" },
  { x: -10, y: 2, w: 3, h: 1, fill: "#D6F0F8" }, { x: -13, y: 3, w: 3, h: 1, fill: "#BDE6F4" }, { x: -16, y: 2, w: 2, h: 1, fill: "#BDE6F4" },
];
// A two-cell ripple ring around each buoy, drawn over its keel so the buoy dips into it.
const RIPPLE: CellRect[] = [{ x: -4, y: 2, w: 2, h: 1, fill: "#BDE6F4" }, { x: 3, y: 2, w: 2, h: 1, fill: "#BDE6F4" }, { x: -2, y: 3, w: 5, h: 1, fill: "#BDE6F4" }];
const ISLAND: CellRect[] = [
  { x: -8, y: 3, w: 17, h: 3, fill: "#8E9BA2" }, { x: -6, y: 1, w: 13, h: 2, fill: "#AEBAC0" },
  ...Array.from({ length: 12 }, (_, r): CellRect => ({ x: -1, y: -11 + r, w: 3, h: 1, fill: Math.floor(r / 2) % 2 ? CORAL : WHITE })),
  { x: -2, y: -14, w: 5, h: 1, fill: "#48555C" },
];
const LAMP: CellRect[] = [{ x: -1, y: -13, w: 3, h: 2, fill: "#F3CD7A" }];
const BEAMS: CellRect[] = [{ x: -12, y: -13, w: 10, h: 1, fill: "#F6E7B6" }, { x: 3, y: -13, w: 10, h: 1, fill: "#F6E7B6" }];
// The whale, mirrored to face right at 2px per unit, and its spout.
const WHALE_PX = WHALE.map(([x, y, w, h, fill]) => ({ x: (26 - x - w) * 2, y: y * 2, width: w * 2, height: h * 2, fill }));
const SPOUT_PX = [[17, -4, 2, 3], [15, -6, 2, 2], [19, -6, 2, 2]].map(([x, y, w, h]) => ({ x: x! * 2, y: y! * 2, width: w! * 2, height: h! * 2, fill: "#E3F4FA" }));

const scene = computed(() => {
  const { W, H, Hz, cx } = geo.value, exam = examAt.value, c0 = cx(0), target = cx(exam ?? 6);
  // By night the sails, stripes and buoys are moonlit rather than the clouds' grey (scene-palette.ts).
  const lit = (rects: readonly CellRect[]) => rects.map((r) => (r.fill === WHITE ? { ...r, fill: dayOrNight(WHITE, MOONLIT) } : r));
  // Clouds sit where the seed puts them (the same places as before) and drift a few dozen pixels each way.
  // By night there are half as many clouds, and they are darker, lit only faintly by the moon.
  const night = isNight(), cloudFill = (r: CellRect) => ({ ...r, fill: r.fill === WHITE ? dayOrNight(WHITE, NIGHT_CLOUD.body) : dayOrNight(r.fill, NIGHT_CLOUD.shade) });
  const clouds: Sprite[] = [], R = rng(21), M = rng(121);
  for (let i = 0; i < Math.max(3, Math.floor(W / 50)); i++) {
    const cw = 8 + Math.floor(R() * 10), x = Math.floor(R() * W) - 15, y = 2 + Math.floor(R() * Math.round(Hz * 0.5)), { drift, shift } = cloudDrift(M, U);
    if (night && i % 2) continue;
    clouds.push(sprite(`cloud-${i}`, x - shift, y, U, cloudRects(cw, "#EEF6F9", 2, 5).map(cloudFill), drift));
  }
  // Wave strokes, seeded so they stay put: short and close together near the horizon, longer and sparser deeper down,
  // each up to three tones lighter than its band, and a few with a crest of the lightest tone. By night a narrow column of
  // short moonlit strokes runs down from under the moon. The strokes fall in two layers that sway one cell to and fro
  // in opposite directions; each layer is one path per color and reaches past each edge so the sway never shows a gap.
  const tops = seaBands(Hz, H), bandAt = (y: number) => { let i = 0; while (i + 1 < tops.length && y >= tops[i + 1]!) i++; return i; };
  const layers = [new Map<string, string>(), new Map<string, string>()];
  const stroke = (layer: number, fill: string, x: number, y: number, w: number) => { const m = layers[layer]!; m.set(fill, `${m.get(fill) ?? ""}M${x * U} ${y * U}h${w * U}v${U}h-${w * U}z`); };
  const V = rng(55);
  for (let y = Hz + 1; y < H; y++) {
    const d = (y - Hz) / Math.max(1, H - Hz), band = bandAt(y);
    if (V() < 0.45) continue;
    const n = Math.round((V() * 2 * W) / (26 + 48 * d));
    for (let k = 0; k < n; k++) {
      const len = 1 + Math.round(d * 2) + Math.floor(V() * (2 + 3 * d)), x = Math.floor(V() * (W + 6)) - 3, layer = V() < 0.5 ? 0 : 1;
      stroke(layer, WATER[Math.max(1, band - 1)]!, x, y, len);
      if (len >= 3 && V() < 0.3) stroke(layer, WATER[Math.max(0, band - 2)]!, x + Math.floor(len / 2) - (len >= 5 ? 1 : 0), y - 1, len >= 5 ? 2 : 1);
    }
  }
  if (night) {
    const P = rng(77), mx = moonAt().x;
    for (let y = Hz + 1; y < Hz + Math.round((H - Hz) * 0.75); y++) {
      if (P() < 0.35) continue;
      const spread = 1 + Math.round(((y - Hz) / Math.max(1, H - Hz)) * 3), len = 1 + Math.floor(P() * 3);
      stroke(P() < 0.5 ? 0 : 1, P() < 0.25 ? MOON.rim : STARS.faint, mx - spread + Math.floor(P() * (2 * spread + 1)) - (len >> 1), y, len);
    }
  }
  const waves = layers.map((m, layer) => ({
    key: `waves-${layer}`, paths: [...m].map(([fill, d]) => ({ fill: sceneColor(fill), d })), motion: driftStyle({ x: U, seconds: 3.2, phase: layer * 0.5 }),
  }));
  // Buoys on the other days, each bobbing and swaying a little out of step with its neighbours, in a still ripple ring.
  // With the day columns over the sea, the markers float in the open water between the horizon and the minutes boards.
  const float = props.horizon === undefined ? 0 : -2;
  const buoys: Sprite[] = [], ripples: { key: string; at: string; rects: ReturnType<typeof toPixels> }[] = [];
  for (let i = 1; i <= 6; i++) {
    if (i === exam) continue;
    buoys.push(sprite(`buoy-${i}`, cx(i), Hz + 6 + float, U, lit(BUOY), { x: 1, seconds: 2.3, phase: (i * 0.29) % 1, y: 3, ySeconds: 1.4 + (i % 3) * 0.25, yPhase: (i * 0.17) % 1 }));
    ripples.push({ key: `ripple-${i}`, at: `translate(${cx(i) * U} ${(Hz + 6 + float) * U})`, rects: toPixels(RIPPLE, U) });
  }
  // The exam day's island and lighthouse; its lamp breathes and its beam fades in as the lamp brightens.
  const island = exam === null ? null : {
    at: `translate(${target * U} ${Hz * U})`, rects: toPixels(lit(ISLAND), U), lamp: toPixels(LAMP, U), beams: toPixels(BEAMS, U),
    motion: driftStyle({ seconds: 1.5 }),
  };
  // Today's sailboat. On an exam day that is today, the boat sits just left of the island.
  const bx = exam === 0 ? c0 - 12 : c0, by = Hz + 7 + float;
  const boat = sprite("boat", bx, by, U, lit(BOAT), { x: 1, seconds: 2.9, y: 3, ySeconds: 1.8 });
  const wake = { at: `translate(${bx * U} ${by * U})`, rects: toPixels(WAKE, U) };
  // The whale crosses from today toward the lighthouse on the loop curve at about 4 px a second on average (about 6 at
  // its fastest, mid-crossing), fading in at the start and out at the end. On the way it dives 8 px and surfaces every
  // 7 seconds, and spouts as it surfaces.
  const depth = props.horizon === undefined ? 11 : Math.max(11, Math.round((H - Hz) * 0.5));
  const span = Math.max(10, target - c0 - 22), seconds = Math.min(180, Math.max(16, (span * U) / 4));
  const whale = {
    at: `translate(${(c0 + 8) * U} ${(Hz + depth) * U})`,
    swim: { "--reach-x": `${span * U}px`, "--period-x": `${Math.round(seconds * 10) / 10}s`, "--delay-x": `${-Math.round(seconds * 3) / 10}s` },
    dive: { "--reach-y": "8px", "--period-y": "3.5s", "--delay-y": "0s" },
  };
  return { clouds, waves, buoys, ripples, island, boat, wake, whale };
});

/** Where the sun, or the moon, sits. Over the day columns it sits high between today and tomorrow, above the planks,
 * where it shows on a phone too; on its own it sits in the middle of the sky. */
function moonAt() {
  const { W, Hz, cx } = geo.value;
  return props.horizon === undefined ? { x: Math.round(W * 0.5), y: Math.round(Hz * 0.45), r: 17, face: 5 } : { x: Math.round((cx(0) + cx(1)) / 2), y: 4, r: 10, face: 4 };
}

function draw() {
  const cv = canvas.value; if (!cv) return;
  const { W, H, Hz, cx } = geo.value, ratio = window.devicePixelRatio || 1;
  if (cv.width !== W * U * ratio || cv.height !== H * U * ratio) { cv.width = W * U * ratio; cv.height = H * U * ratio; }
  cv.style.width = `${W * U}px`; cv.style.height = `${H * U}px`;
  const ctx = cv.getContext("2d"); if (!ctx) return;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0); ctx.imageSmoothingEnabled = false;
  const cell = (x: number, y: number, c: string) => { ctx.fillStyle = sceneColor(c); ctx.fillRect(Math.round(x) * U, Math.round(y) * U, U, U); };
  const rect = (x: number, y: number, w: number, h: number, c: string) => { ctx.fillStyle = sceneColor(c); ctx.fillRect(Math.round(x) * U, Math.round(y) * U, Math.round(w) * U, Math.round(h) * U); };
  // Sky in solid bands and the sun, or the moon by night.
  const sky = ["#D3EAF4", "#DCEFF6", "#E6F4F7", "#F0F7F3"], bh = Math.ceil(Hz / sky.length);
  sky.forEach((c, i) => rect(0, i * bh, W, bh, c));
  // The sun, or by night the moon in a faint glow, high in the sky and clear of the day planks.
  const sun = moonAt();
  for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
    const q = dx * dx + dy * dy;
    if (q <= sun.r) cell(sun.x + dx, sun.y + dy, q <= sun.face ? dayOrNight("#F3CD7A", MOON.face) : dayOrNight("#F9E3A8", MOON.rim));
    else if (isNight() && q <= sun.r + 8 && sun.y + dy >= 0) cell(sun.x + dx, sun.y + dy, MOON.glow);
  }
  if (isNight()) { cell(sun.x + 1, sun.y - 1, MOON.crater); cell(sun.x - 2, sun.y + 1, MOON.crater); }
  // Sea in solid bands that lighten toward the horizon, with a dithered row where each band meets the next. Today's
  // column is washed one tone lighter, its edges dithered. The wave strokes are sprites.
  const tops = seaBands(Hz, H);
  const paint = (x0: number, x1: number, lift: number) => {
    tops.forEach((top, i) => rect(x0, top, x1 - x0, (tops[i + 1] ?? H) - top, WATER[i + 2 - lift]!));
    for (let i = 1; i < tops.length; i++) { const y = tops[i]! - 1; for (let x = x0; x < x1; x++) if ((x + y) % 2 === 0) cell(x, y, WATER[i + 2 - lift]!); }
  };
  paint(0, W, 0);
  const cs = props.centers ?? [];
  if (props.horizon !== undefined && cs.length >= 2) {
    const c0 = cx(0), hw = Math.max(4, Math.floor((cs[1]! - cs[0]! - 10) / 2 / U)), lift = (y: number) => { let i = 0; while (i + 1 < tops.length && y >= tops[i + 1]!) i++; return WATER[i + 1]!; };
    paint(c0 - hw, c0 + hw, 1);
    for (let y = Hz; y < H; y++) cell(y % 2 ? c0 + hw : c0 - hw - 1, y, lift(y));
  }
  scatterStars(ctx, U * ratio, W, Hz, 21, 4000);
}

function measure() {
  const el = wrap.value; if (!el) return;
  const w = Math.max(1, Math.round(el.clientWidth)), h = Math.max(1, Math.round(el.clientHeight || HEIGHT));
  if (w !== size.value.w || h !== size.value.h) size.value = { w, h };
  dpr.value = window.devicePixelRatio || 1;
  draw();
}
onMounted(() => {
  observer = new ResizeObserver(measure);
  if (wrap.value) observer.observe(wrap.value);
  measure();
});
watch(() => [props.examDay, props.centers, props.horizon, size.value, dpr.value, currentTheme.value], () => draw(), { flush: "post" });
onBeforeUnmount(() => { observer?.disconnect(); });
</script>

<template>
  <section class="plan-sea" role="img" :aria-label="description" :style="{ width: width ? `${width}px` : undefined, height: height ? `${height}px` : undefined }">
    <div ref="wrap" class="sea-wrap" :style="snapStyle(dpr)">
      <canvas ref="canvas" aria-hidden="true" />
      <svg class="sprites" :width="geo.W * U" :height="geo.H * U" shape-rendering="crispEdges" aria-hidden="true" focusable="false">
        <g v-for="s in scene.clouds" :key="s.key" :transform="s.at"><g class="drift" :style="s.motion"><rect v-for="(r, i) in s.rects" :key="i" v-bind="r" /></g></g>
        <g v-for="g in scene.waves" :key="g.key" class="drift" :style="g.motion"><path v-for="p in g.paths" :key="p.fill" :d="p.d" :fill="p.fill" /></g>
        <g v-for="s in scene.buoys" :key="s.key" :transform="s.at"><g class="drift" :style="s.motion"><rect v-for="(r, i) in s.rects" :key="i" v-bind="r" /></g></g>
        <g v-for="s in scene.ripples" :key="s.key" :transform="s.at"><rect v-for="(r, i) in s.rects" :key="i" v-bind="r" /></g>
        <g v-if="scene.island" :transform="scene.island.at" :style="scene.island.motion">
          <rect v-for="(r, i) in scene.island.rects" :key="i" v-bind="r" />
          <g class="beam"><rect v-for="(r, i) in scene.island.beams" :key="i" v-bind="r" /></g>
          <rect v-for="(r, i) in scene.island.lamp" :key="`lamp-${i}`" class="lamp" v-bind="r" />
        </g>
        <g :transform="scene.boat.at"><g class="drift" :style="scene.boat.motion"><rect v-for="(r, i) in scene.boat.rects" :key="i" v-bind="r" /></g></g>
        <g :transform="scene.wake.at"><rect v-for="(r, i) in scene.wake.rects" :key="i" v-bind="r" /></g>
        <g :transform="scene.whale.at">
          <g class="swim" :style="scene.whale.swim">
            <g class="dive" :style="scene.whale.dive">
              <rect v-for="(r, i) in WHALE_PX" :key="i" v-bind="r" :fill="sceneColor(r.fill)" />
              <g class="spout"><rect v-for="(r, i) in SPOUT_PX" :key="i" v-bind="r" :fill="sceneColor(r.fill)" /></g>
            </g>
          </g>
        </g>
      </svg>
      <span v-if="signStyle" class="sea-sign" :style="signStyle" aria-hidden="true"><span class="sign-title">{{ examTitle || 'Exam' }}</span><span class="sign-date">{{ examDate }}</span></span>
      <span v-if="labelled" class="sea-you" :style="youStyle" aria-hidden="true">You · today</span>
    </div>
  </section>
</template>

<style scoped>
.plan-sea{position:relative;height:136px;border-radius:16px;overflow:hidden;border:1px solid var(--sea-line);background:var(--sea)}
.sea-wrap{position:absolute;inset:0}
canvas{position:absolute;left:0;top:0;image-rendering:pixelated}
.sprites{position:absolute;left:0;top:0;overflow:hidden;pointer-events:none}
/* The lamp and its beam share one breath, set by the island's --period-x. */
.lamp{animation:sgLamp var(--period-x) var(--ease-loop) var(--delay-x) infinite alternate}
.beam{animation:sgBeam var(--period-x) var(--ease-loop) var(--delay-x) infinite alternate}
/* The whale's crossing, its dives, and the spout that shows each time it surfaces (style.css, sgSwim, sgDive, sgSpout). */
.swim{transform:translateX(round(var(--drift-x),var(--snap,1px)));animation:sgSwim var(--period-x) var(--ease-loop) var(--delay-x) infinite}
.dive{transform:translateY(round(var(--drift-y),var(--snap,1px)));animation:sgDive var(--period-y) var(--ease-loop) var(--delay-y) infinite alternate}
.spout{animation:sgSpout calc(var(--period-y) * 2) var(--ease-loop) var(--delay-y) infinite}
.sea-sign{position:absolute;transform:translate(-50%,-100%);display:flex;flex-direction:column;align-items:center;padding:3px 9px 4px;background:var(--plank);box-shadow:inset 0 -2px 0 var(--plank-edge),0 0 0 2px var(--plank-ring);white-space:nowrap;pointer-events:none}
.sign-title{font-family:var(--font-display);font-size:13px;color:var(--plank-ink)}
.sign-date{font-size:11px;font-weight:700;color:var(--plank-soft)}
.sea-you{position:absolute;transform:translateX(-50%);font-family:var(--font-display);font-size:11px;letter-spacing:1px;text-transform:uppercase;color:var(--sea-label);background:var(--scene-label);padding:2px 6px;white-space:nowrap;pointer-events:none}
</style>
