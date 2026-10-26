// The grove on Home (design/revamp/README.md, "Tree view"): one seeded pixel tree per topic, standing on a strip of
// grass and soil, with a dashed plot at the end for planting a new topic. Everything here is in cells (4 CSS px each)
// so layout, drawing and hit-testing share one grid. Trees are deterministic from the topic id plus the design seed.
import { PAL, SPRITES, genTree, hash, rng, stageOf, type Segment } from "./pixel-art.ts";
import { leafColor, sceneColor } from "./scene-palette.ts";

/** CSS pixels per cell. */
export const CELL = 4;
/** Grove height and the grass line, in cells from the top. */
export const HEIGHT = 112, GROUND = 96;
/** The "+ Plant a topic" plot: its width and height in cells. */
export const PLOT = 30;
// Space between slots, space at either end, and the most leaves one tree carries (more become a second tree).
const GAP = 8, MARGIN = 6, PER_TREE = 60;

export type GroveSkill = { skill: string; title: string; mastery?: number; due: boolean };
export type GroveTopic = { id: string; title: string; skills: GroveSkill[] };
export type GroveLeaf = { skill: GroveSkill; x: number; y: number };
export type GroveTree = {
  key: string; title: string; meta: string; x0: number; w: number; cx: number; seed: number;
  segs: Segment[]; tips: [number, number][]; leaves: GroveLeaf[]; buds: [number, number][];
};
/** Trees placed left to right; `plot` is the plot's left edge and `width` the whole row, both in cells. */
export type Grove = { trees: GroveTree[]; plot: number; width: number };

/** Mean estimated mastery, rounded, or undefined when nothing has an estimate yet. */
export function average(skills: readonly { mastery?: number }[]): number | undefined {
  const known = skills.filter((skill) => skill.mastery !== undefined && skill.mastery !== null);
  return known.length ? Math.round(known.reduce((sum, skill) => sum + skill.mastery!, 0) / known.length) : undefined;
}
/** The plank's second line: "N skills · avg%". */
export function topicMeta(skills: readonly GroveSkill[]): string {
  const avg = average(skills);
  return `${skills.length} ${skills.length === 1 ? "skill" : "skills"} · ${avg === undefined ? "new" : `${avg}%`}`;
}

/**
 * Grows one tree per topic and lines them up from the left margin. Each slot is as wide as its tree or its plank,
 * whichever is wider, so planks never overlap. `plankCells` returns the cells a plank with this text needs.
 */
export function growGrove(topics: readonly GroveTopic[], design: number, plankCells: (title: string, meta: string) => number): Grove {
  const trees: GroveTree[] = [];
  let x = MARGIN;
  for (const topic of topics) {
    for (let start = 0, part = 1; start < topic.skills.length; start += PER_TREE, part++) {
      const key = part === 1 ? topic.id : `${topic.id}:${part}`, title = part === 1 ? topic.title : `${topic.title} (${part})`;
      const need = Math.min(PER_TREE, topic.skills.length - start);
      const spare = need + 2 + Math.floor(need / 3);
      const tree = genTree(key, design, spare, Math.max(44, Math.min(170, 26 + spare * 5.5)), Math.min(GROUND - 14, 44 + spare * 4));
      const tips = [...tree.tips].sort((a, b) => a[0] - b[0]);
      // genTree always returns at least `spare` tips, so every skill gets one; the slice is only a guard.
      const skills = topic.skills.slice(start, start + Math.min(need, tips.length));
      const pick = spreadTips(tips, skills.length), used = new Set(pick);
      const meta = topicMeta(skills), slot = Math.max(tree.w, plankCells(title, meta)), x0 = x + Math.floor((slot - tree.w) / 2);
      trees.push({
        key, title, meta, x0, w: tree.w, cx: x0 + tree.w / 2, seed: hash(key + ":" + design),
        segs: tree.segs.map((s) => [s[0] + x0, s[1] + GROUND, s[2] + x0, s[3] + GROUND, s[4]] as Segment),
        tips: tips.map((tip) => [x0 + tip[0], GROUND + tip[1]] as [number, number]),
        leaves: skills.map((skill, i) => { const tip = tips[pick[i]!]!; return { skill, x: Math.round(x0 + tip[0]), y: Math.round(GROUND + tip[1]) }; }),
        buds: tips.filter((_, i) => !used.has(i)).map((tip) => [Math.round(x0 + tip[0]), Math.round(GROUND + tip[1])] as [number, number]),
      });
      x += slot + GAP;
    }
  }
  return { trees, plot: x, width: x + PLOT + MARGIN };
}

/**
 * Chooses `n` of the tips (sorted left to right) so the leaves sit as far apart as the tree allows: start at the
 * leftmost tip, then keep adding the tip farthest from every tip chosen so far. Returns indices in left-to-right
 * order, so skills still read left to right. Spare tips stay open buds.
 */
function spreadTips(tips: readonly (readonly [number, number])[], n: number): number[] {
  if (!n || !tips.length) return [];
  const at = tips.map(([x, y]) => [Math.round(x), Math.round(y)] as const), chosen = new Set([0]);
  const gap = at.map(([x, y]) => Math.hypot(x - at[0]![0], y - at[0]![1]));
  while (chosen.size < Math.min(n, at.length)) {
    let best = -1;
    for (let i = 0; i < at.length; i++) if (!chosen.has(i) && (best < 0 || gap[i]! > gap[best]!)) best = i;
    chosen.add(best);
    const [bx, by] = at[best]!;
    for (let i = 0; i < at.length; i++) gap[i] = Math.min(gap[i]!, Math.hypot(at[i]![0] - bx, at[i]![1] - by));
  }
  return [...chosen].sort((a, b) => a - b);
}

/** The grove moved right by `by` cells, used to centre a grove narrower than its container. */
export function shiftGrove(grove: Grove, by: number): Grove {
  if (!by) return grove;
  return {
    plot: grove.plot + by, width: grove.width + by,
    trees: grove.trees.map((t) => ({
      ...t, x0: t.x0 + by, cx: t.cx + by,
      segs: t.segs.map((s) => [s[0] + by, s[1], s[2] + by, s[3], s[4]] as Segment),
      tips: t.tips.map(([tx, ty]) => [tx + by, ty] as [number, number]),
      leaves: t.leaves.map((leaf) => ({ ...leaf, x: leaf.x + by })),
      buds: t.buds.map(([bx, by2]) => [bx + by, by2] as [number, number]),
    })),
  };
}

/** The leaf nearest a point given in cells, within about five cells; null when none is that close. */
export function leafNear(grove: Grove, mx: number, my: number): GroveLeaf | null {
  let best: GroveLeaf | null = null, bestDistance = 30;
  for (const tree of grove.trees) for (const leaf of tree.leaves) {
    const d = (leaf.x - mx) ** 2 + (leaf.y - my) ** 2;
    if (d < bestDistance) { bestDistance = d; best = leaf; }
  }
  return best;
}

/**
 * Draws the grove at `cssWidth` × HEIGHT cells. The backing store is `devicePixelRatio` times larger and every cell
 * edge is rounded to a device pixel, so cells stay crisp with no seams at fractional ratios.
 */
export function drawGrove(canvas: HTMLCanvasElement, grove: Grove, cssWidth: number, dpr: number, selected: string | null, hot: string | null) {
  const bw = Math.round(cssWidth * dpr), bh = Math.round(HEIGHT * CELL * dpr);
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, bw, bh);
  const W = Math.ceil(cssWidth / CELL), G = GROUND, H = HEIGHT, size = CELL * dpr;
  const rect = (x: number, y: number, w: number, h: number, colour: string) => {
    const left = Math.round(x * size), top = Math.round(y * size);
    ctx.fillStyle = sceneColor(colour);
    ctx.fillRect(left, top, Math.round((x + w) * size) - left, Math.round((y + h) * size) - top);
  };
  const cell = (x: number, y: number, colour: string) => rect(Math.round(x), Math.round(y), 1, 1, colour);

  // Sky bands and a few still clouds.
  const bands = ["#CFE3EE", "#D7E8F1", "#DEECF3", "#E5F0F5"], band = Math.ceil(G / bands.length);
  bands.forEach((colour, i) => rect(0, i * band, W, band, colour));
  const RC = rng(7);
  for (let i = 0; i < Math.max(3, Math.floor(W / 55)); i++) {
    const cw = 8 + Math.floor(RC() * 9), cx = Math.floor((RC() * W) % (W + 30)) - 15, cy = 5 + Math.floor(RC() * 22);
    rect(cx, cy, cw, 2, "#FFFFFF"); rect(cx + 2, cy - 1, Math.max(2, cw - 5), 1, "#FFFFFF"); rect(cx + 1, cy + 2, cw - 2, 1, "#EEF5F9");
  }
  // Grass edge, soil and a speckle of grass tufts and pebbles.
  rect(0, G, W, 1, "#2F8A5F"); rect(0, G + 1, W, 1, "#256F4C"); rect(0, G + 2, W, H - G - 2, "#CDB884"); rect(0, H - 3, W, 3, "#C2AC76");
  const RG = rng(99);
  for (let x = 0; x < W; x++) {
    if (RG() < 0.2) cell(x, G - 1, "#6DB892");
    if (RG() < 0.1) cell(x, G + 3 + Math.floor(RG() * (H - G - 6)), "#C08324");
    if (RG() < 0.07) cell(x, G + 3 + Math.floor(RG() * (H - G - 6)), "#E9D6A8");
  }

  for (const tree of grove.trees) {
    const RT = rng(tree.seed);
    // Soft foliage behind the forks and the tips.
    const blob = (cx: number, cy: number, r: number) => {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const q = dx * dx + dy * dy;
        if (q <= r * r + 1 && !(q > r * r - 2 && RT() < 0.35))
          cell(cx + dx, cy + dy, dy > r / 3 ? "#8CC3A1" : dx + dy < -r / 2 ? "#BFE0CC" : RT() < 0.12 ? "#9CCDB0" : "#A9D4B9");
      }
    };
    for (const [, , x2, y2, th] of tree.segs) if (th === 2) blob(Math.round(x2), Math.round(y2), 3);
    for (const [tx, ty] of tree.tips) blob(Math.round(tx), Math.round(ty), 4 + Math.floor(RT() * 2));
    // Trunk and branches as runs of cells in trunk browns; the right edge of thick limbs is darker.
    for (const [x1, y1, x2, y2, th] of tree.segs) {
      const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.4) + 1;
      for (let i = 0; i <= n; i++) {
        const px = Math.round(x1 + ((x2 - x1) * i) / n), py = Math.round(y1 + ((y2 - y1) * i) / n);
        for (let k = 0; k < th; k++) cell(px + k - Math.floor(th / 2), py, th === 1 ? "#A8742A" : k === th - 1 ? "#9C6A1F" : "#C08324");
      }
    }
    const base = tree.segs[0] ? Math.round(tree.segs[0][0]) : Math.round(tree.cx);
    rect(base - 3, G, 7, 1, "#9C6A1F"); rect(base - 2, G, 5, 1, "#C08324");
    // Spare tips are open buds.
    for (const [bx, by] of tree.buds) { cell(bx, by, "#6DB892"); cell(bx + 1, by - 1, "#6DB892"); }
    for (const leaf of tree.leaves) {
      const { x, y, skill } = leaf;
      SPRITES[stageOf(skill.mastery)].forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) { const ch = row[rx]!; if (ch !== ".") cell(x - 3 + rx, y - 3 + ry, leafColor(PAL[ch] ?? "#000000")); }
      });
      // Due today: a small coral flag planted beside the leaf, so its growth stage stays visible.
      if (skill.due) { rect(x + 3, y - 8, 1, 5, "#48555C"); rect(x + 4, y - 8, 2, 2, "#D9663A"); cell(x + 5, y - 7, "#EE9C78"); }
      // Pixel corner brackets: solid ink for the selected leaf, grey for the one under the pointer or focus.
      const mark = skill.skill === selected ? "#151515" : skill.skill === hot ? "#6F6F6C" : null;
      if (mark) {
        const a = x - 5, b = y - 5, c = x + 5, d = y + 5;
        for (const [cx, cy, sx, sy] of [[a, b, 1, 1], [c, b, -1, 1], [a, d, 1, -1], [c, d, -1, -1]] as const) {
          cell(cx, cy, mark); cell(cx + sx, cy, mark); cell(cx, cy + sy, mark);
        }
      }
    }
  }
  // A sprout in the middle of the plant plot.
  const pc = grove.plot + Math.floor(PLOT / 2);
  rect(pc, G - 4, 1, 4, "#256F4C"); cell(pc - 1, G - 4, "#6DB892"); cell(pc + 1, G - 5, "#6DB892"); cell(pc - 2, G - 5, "#2F8A5F"); cell(pc + 2, G - 6, "#2F8A5F");
}
