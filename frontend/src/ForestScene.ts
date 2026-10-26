// The Forest view's pixel scene (design/revamp/README.md, "Forest view"): the layout in cell units, hit-testing, and
// three layers. The sky and sun never move; the clouds are sprites between the sky and the land that drift on an eased
// loop (ForestView.vue, scene-motion.ts); the land holds the mountains, pines, grass, path, topic trees and bushes,
// and changes only when the selection, hover or topic changes. The caller owns the canvases and passes the
// device-pixel size of one cell, so every cell lands on whole device pixels and stays crisp.
import { PAL, SPRITES, genTree, hash, rng, stageOf, type Segment } from "./pixel-art.ts";
import { MOON, dayOrNight, leafColor, sceneColor } from "./scene-palette.ts";
import type { ViewSkill, ViewUnit } from "./revamp-types.ts";

export type ForestLeaf = { skill: ViewSkill; unit: string; x: number; y: number };
export type ForestTree = {
  unit: string; title: string; skills: ViewSkill[];
  /** The slot centre, where the signpost stands. */
  cx: number;
  /** The trunk's foot, where the mound and the flowers go. */
  trunk: number;
  /** The ground line of this tree: back trees stand a little higher, behind the front row. */
  base: number; back: boolean; seed: number;
  /** The highest tip, for hit-testing the tree as a whole. */
  top: number;
  segs: Segment[]; tips: [number, number][]; leaves: ForestLeaf[]; buds: { x: number; y: number }[];
};
export type ForestLayout = {
  /** CSS px per cell. */
  cell: number;
  /** Cells visible without scrolling, the whole forest's width, its height, and the grass line. */
  Wv: number; Wc: number; Hc: number; G: number;
  /** Cells per topic slot. */
  slot: number;
  /** Back trees first, so the front row draws over them. */
  trees: ForestTree[];
};
export type LandState = { design: number; selected: string | null; hover: string | null; topic: string | null };

/** The narrowest slot a topic gets, in CSS px, so neighbouring signposts never touch. Past that the forest scrolls. */
const MIN_SLOT_PX = 160;
/** Where the sun sits on its arc, from 0 (left) to 1 (right). The prototype ties it to today's study minutes, which
 * the Forest view does not receive, so it stays at the prototype's morning position. */
const SUN_AT = 0.27;
const SKY = ["#B9D8E8", "#C3DEEC", "#CDE4EF", "#D7E9F1", "#E0EEF2", "#EAF2EE", "#F3F1DF"];

/** One tree per topic that has skills, in slots across the canvas; the forest grows wider than the view and scrolls
 * when the slots would be narrower than a signpost. With more than two topics, every second tree stands in a back row
 * so the trees can overlap without their signposts touching. */
export function layoutForest(units: readonly ViewUnit[], design: number, viewW: number, viewH: number, cell: number): ForestLayout {
  const Wv = Math.max(40, Math.ceil(viewW / cell)), Hc = Math.max(64, Math.ceil(viewH / cell)), G = Math.floor(Hc * 0.72);
  const shown = units.filter((u) => u.skills.length > 0), n = shown.length;
  const slot = n ? Math.max(Math.ceil(MIN_SLOT_PX / cell), Wv / (n + 0.5)) : Wv;
  const Wc = n ? Math.max(Wv, Math.ceil(slot * (n + 0.5))) : Wv;
  const trees = shown.map((u, i): ForestTree => {
    const back = n > 2 && i % 2 === 1, base = back ? G - 4 : G + 2, cx = Math.round(slot * (i + 0.75));
    const t = genTree(u.unit, design, u.skills.length + 2, Math.min(slot * 1.2, 130), G * (back ? 0.66 : 0.6), 3.2);
    const x0 = Math.round(cx - t.w / 2);
    const tips = t.tips.slice().sort((a, b) => a[0] - b[0]).map(([x, y]) => [x0 + x, base + y] as [number, number]);
    // Spread the skills evenly across the tips, left to right; the spare tips stay buds. genTree deepens until there
    // are enough tips, so every skill gets one in practice; a skill without a tip is still listed in the aside.
    const count = Math.min(u.skills.length, tips.length), used = new Set<number>(), pick: number[] = [];
    for (let j = 0; j < count; j++) {
      let k = Math.round((j + 0.5) * tips.length / count - 0.5);
      while (used.has(k)) k = (k + 1) % tips.length;
      used.add(k); pick.push(k);
    }
    pick.sort((a, b) => a - b);
    const leaves = pick.map((k, j): ForestLeaf => {
      const tip = tips[k] ?? [cx, base];
      return { skill: u.skills[j]!, unit: u.unit, x: Math.round(tip[0]), y: Math.round(tip[1]) };
    });
    const buds = tips.filter((_, k) => !used.has(k)).map(([x, y]) => ({ x: Math.round(x), y: Math.round(y) }));
    const segs = t.segs.map(([x1, y1, x2, y2, th]) => [x1 + x0, y1 + base, x2 + x0, y2 + base, th] as Segment);
    const trunk = Math.round(segs[0]?.[0] ?? cx);
    const top = tips.reduce((m, p) => Math.min(m, p[1]), base);
    return { unit: u.unit, title: u.title, skills: u.skills, cx, trunk, base, back, seed: hash(`${u.unit}:forest:${design}`), top, segs, tips, leaves, buds };
  });
  trees.sort((a, b) => Number(b.back) - Number(a.back));
  return { cell, Wv, Wc, Hc, G, slot, trees };
}

/** The x cell of the empty meadow's planting plot, centred in the visible part of the canvas. */
export function plotX(layout: ForestLayout): number { return Math.round(layout.Wv / 2); }

/** The leaf nearest a point in cell space (within about 5 cells), and the tree whose crown or trunk the point is on. */
export function hitForest(layout: ForestLayout, mx: number, my: number): { leaf: ForestLeaf | null; tree: string | null } {
  let leaf: ForestLeaf | null = null, best = 30, tree: string | null = null, nearest = Infinity;
  const reach = Math.min(40, layout.slot * 0.6);
  for (const t of layout.trees) {
    for (const lf of t.leaves) {
      const d = (lf.x - mx) ** 2 + (lf.y - my) ** 2;
      if (d < best) { best = d; leaf = lf; }
    }
    if (my > t.top - 6 && my < t.base + 2) {
      const d = Math.abs(t.cx - mx);
      if (d < nearest && d < reach) { nearest = d; tree = t.unit; }
    }
  }
  return { leaf, tree };
}

type Paint = { rect: (x: number, y: number, w: number, h: number, c: string) => void; cell: (x: number, y: number, c: string) => void; disc: (cx: number, cy: number, r: number, c: string) => void };
function painter(ctx: CanvasRenderingContext2D, px: number): Paint {
  const rect = (x: number, y: number, w: number, h: number, c: string) => {
    const rw = Math.round(w), rh = Math.round(h);
    if (rw <= 0 || rh <= 0) return;
    ctx.fillStyle = sceneColor(c);
    ctx.fillRect(Math.round(x) * px, Math.round(y) * px, rw * px, rh * px);
  };
  const cell = (x: number, y: number, c: string) => rect(x, y, 1, 1, c);
  const disc = (cx: number, cy: number, r: number, c: string) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r + 1) cell(cx + dx, cy + dy, c);
  };
  return { rect, cell, disc };
}

/** Sky bands (solid, never a gradient) and the sun on its arc, or the moon by night (scene-palette.ts). */
export function drawSky(ctx: CanvasRenderingContext2D, layout: ForestLayout, px: number) {
  const { rect, cell, disc } = painter(ctx, px), { Wc, Wv, G } = layout, bh = Math.ceil(G / SKY.length);
  SKY.forEach((c, i) => rect(0, i * bh, Wc, bh, c));
  const sx = Math.round(Wv * (0.1 + 0.8 * SUN_AT)), sy = Math.round(G * 0.5 - Math.sin(SUN_AT * Math.PI) * G * 0.32);
  disc(sx, sy, 8, dayOrNight("#F9E3A8", MOON.glow)); disc(sx, sy, 6, dayOrNight("#F3CD7A", MOON.rim)); disc(sx, sy, 4, dayOrNight("#E3A233", MOON.face));
  cell(sx - 2, sy - 2, dayOrNight("#F9E3A8", MOON.crater));
}

/** Where each cloud sits, in cells, and how wide it is, from a fixed seed so the clouds keep their places. */
export function cloudPlaces(layout: ForestLayout): { x: number; y: number; w: number }[] {
  const { Wc, G } = layout, R = rng(11), out: { x: number; y: number; w: number }[] = [];
  for (let i = 0; i < Math.max(4, Math.floor(Wc / 45)); i++) {
    const w = 10 + Math.floor(R() * 12), x = Math.floor(R() * Wc) - 20, y = 4 + Math.floor(R() * G * 0.3);
    out.push({ x, y, w });
  }
  return out;
}

/** Everything in front of the clouds: two mountain layers, ambient pines, grass, the path, the topic trees and the
 * foreground bushes. The selected topic's tree stays bright and the others are drawn in a lighter palette. */
export function drawLand(ctx: CanvasRenderingContext2D, layout: ForestLayout, px: number, state: LandState) {
  const paint = painter(ctx, px), { rect, cell } = paint, { Wc, Hc, G } = layout;
  for (let x = 0; x < Wc; x++) {
    const ridge = Math.sin(x / 29 + 1.3), top = Math.round(G - (G * 0.36 + ridge * G * 0.09 + Math.sin(x / 11) * G * 0.025));
    rect(x, top, 1, G - top, "#AFC6D1");
    if (ridge > 0.82) rect(x, top, 1, 2, "#E5EEF2");
  }
  for (let x = 0; x < Wc; x++) {
    const top = Math.round(G - (G * 0.2 + Math.sin(x / 17 + 2.1) * G * 0.05 + Math.sin(x / 7) * 1.2));
    rect(x, top, 1, G - top, "#97C2A6");
  }
  const RA = rng(31 + state.design);
  for (let k = 0; k < Math.floor(Wc / 7); k++) {
    const x = Math.round(RA() * Wc), h = 8 + Math.round(RA() * 12), base = G - Math.round(RA() * 4), c1 = RA() < 0.5 ? "#5E9F7E" : "#6AA988";
    for (let r = 0; r < h; r++) { const w = Math.floor(r * 0.38); rect(x - w, base - h + r, 2 * w + 1, 1, r % 4 < 2 ? c1 : "#4F8F6E"); }
    rect(x, base, 1, 2, "#8A6A3A");
  }
  const low = Math.round(G + (Hc - G) * 0.62);
  rect(0, G, Wc, Hc - G, "#6DB892"); rect(0, G, Wc, 1, "#8CCDA5"); rect(0, low, Wc, Hc - low, "#5FAA80");
  const RG = rng(5);
  for (let x = 0; x < Wc; x++) {
    if (RG() < 0.22) cell(x, G - 1, "#6DB892");
    if (RG() < 0.12) cell(x, G + 2 + Math.floor(RG() * (Hc - G - 3)), "#2F8A5F");
  }
  for (let x = 0; x < Wc; x++) {
    const py = Math.round(G + (Hc - G) * 0.5 + Math.sin(x / 19) * 2.2);
    rect(x, py, 1, 3, "#E9D6A8"); cell(x, py + 3, "#CDB884");
    if (x % 7 === 0) cell(x, py + 1, "#F3E3BC");
  }
  for (const t of layout.trees) drawTree(paint, t, state);
  if (!layout.trees.length) drawPlot(paint, plotX(layout), G + 2);
  const RB = rng(77);
  for (let k = 0; k < Math.floor(Wc / 16); k++) {
    const bx = Math.round(RB() * Wc), r = 3 + Math.floor(RB() * 3);
    for (let dy = -r; dy <= 0; dy++) for (let dx = -r - 2; dx <= r + 2; dx++) if (dx * dx / 1.6 + dy * dy <= r * r) cell(bx + dx, Hc - 1 + dy, dy < -r / 2 ? "#5FA07F" : "#4E9070");
  }
}

function drawTree({ rect, cell }: Paint, t: ForestTree, state: LandState) {
  const RT = rng(t.seed), dim = !!state.topic && state.topic !== t.unit, shade = (bright: string, light: string) => (dim ? light : bright);
  for (let dx = -14; dx <= 14; dx++) {
    const hh = Math.round(Math.sqrt(Math.max(0, 1 - (dx / 14) ** 2)) * 2);
    rect(t.trunk + dx, t.base, 1, hh, state.topic === t.unit ? "#E3C46A" : "#5A9F7A");
  }
  const blob = (cx: number, cy: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const q = dx * dx + dy * dy;
      if (q > r * r + 1 || (q > r * r - 2 && RT() < 0.35)) continue;
      cell(cx + dx, cy + dy, dy > r / 3 ? shade("#7DBB95", "#9CC6AD") : dx + dy < -r / 2 ? shade("#C4E4CF", "#D3E7DA") : RT() < 0.12 ? shade("#93C9A8", "#B4D6C1") : shade("#A6D4B6", "#C0DECB"));
    }
  };
  for (const [, , x2, y2, th] of t.segs) if (th === 2) blob(Math.round(x2), Math.round(y2), 4);
  for (const [x, y] of t.tips) blob(Math.round(x), Math.round(y), 5 + Math.floor(RT() * 2));
  for (const [x1, y1, x2, y2, th] of t.segs) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.4) + 1, w = th + (th > 2 ? 1 : 0);
    for (let i = 0; i <= steps; i++) {
      const bx = Math.round(x1 + (x2 - x1) * i / steps), by = Math.round(y1 + (y2 - y1) * i / steps);
      for (let k = 0; k < w; k++) cell(bx + k - Math.floor(w / 2), by, shade(w === 1 ? "#A8742A" : k === w - 1 ? "#9C6A1F" : "#C08324", "#C9A877"));
    }
  }
  for (const b of t.buds) { cell(b.x, b.y, "#6DB892"); cell(b.x + 1, b.y - 1, "#6DB892"); }
  for (const lf of t.leaves) {
    SPRITES[stageOf(lf.skill.mastery)].forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) { const ch = row.charAt(rx); if (ch !== ".") cell(lf.x - 3 + rx, lf.y - 3 + ry, leafColor(PAL[ch] ?? "#000000")); }
    });
    if (lf.skill.dueToday) { rect(lf.x + 3, lf.y - 8, 1, 5, "#48555C"); rect(lf.x + 4, lf.y - 8, 2, 2, "#D9663A"); cell(lf.x + 5, lf.y - 7, "#EE9C78"); }
    const mark = lf.skill.skill === state.selected ? "#151515" : lf.skill.skill === state.hover ? "#5F5F5C" : null;
    if (mark) {
      const a = lf.x - 5, b = lf.y - 5, c = lf.x + 5, d = lf.y + 5;
      for (const [x, y, sx, sy] of [[a, b, 1, 1], [c, b, -1, 1], [a, d, 1, -1], [c, d, -1, -1]] as const) { cell(x, y, mark); cell(x + sx, y, mark); cell(x, y + sy, mark); }
    }
    // A flower at the tree's foot for each mastered skill.
    if ((lf.skill.mastery ?? 0) >= 80) {
      const fx = t.trunk + Math.round((RT() - 0.5) * 26), fy = t.base + 3 + Math.floor(RT() * 3), petal = RT() < 0.5 ? "#D9663A" : "#9A8EE6";
      cell(fx, fy, "#256F4C"); cell(fx, fy - 1, "#256F4C"); cell(fx - 1, fy - 2, petal); cell(fx + 1, fy - 2, petal); cell(fx, fy - 3, petal); cell(fx, fy - 2, "#F3CD7A");
    }
  }
}

/** The empty meadow's planting plot: a mound of soil with one sprout, above the "Plant a topic" sign. */
function drawPlot({ rect, cell }: Paint, x: number, base: number) {
  rect(x - 7, base, 15, 1, "#C08324"); rect(x - 5, base - 1, 11, 1, "#9C6A1F"); rect(x - 6, base + 1, 13, 1, "#A8742A");
  rect(x, base - 6, 1, 5, "#256F4C");
  cell(x - 1, base - 5, "#6DB892"); cell(x - 2, base - 6, "#2F8A5F"); cell(x + 1, base - 6, "#6DB892"); cell(x + 2, base - 7, "#2F8A5F");
}
