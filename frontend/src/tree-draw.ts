// Growing and painting one topic tree of a given kind (tree-kinds.ts), shared by the grove on Home, the Forest view
// and the tree picker's previews. growTree is seeded: the same kind, id and design always give the same tree, and
// bumping the design ("Regrow") draws it again. It keeps adding branches, tiers or fronds until the tree has at least
// `need` tips, because every skill needs a tip for its leaf (spare tips stay open buds). Everything is in cells, with
// the trunk's foot at y = 0 and the tree growing upward into negative y, inside a box `w` cells wide.
import { SPRITES, PAL, hash, rng, type Stage } from "./pixel-art.ts";
import type { BranchShape, ColumnShape, ConiferShape, CrownColors, PalmShape, Range, TreeKind } from "./tree-kinds.ts";

/** A trunk or branch piece: [x1, y1, x2, y2, thickness in cells]. */
export type Segment = [number, number, number, number, number];
/**
 * One piece of a crown, in cells. A blob is a rough disc, an oval a flat pad or a column (`point` tapers its top), a
 * cone a triangle from its apex at `top` down to a base `half` cells either side of `x` (`banded` darkens its lowest
 * rows, for a spruce's tiers), a strand a willow's hanging line, and a frond a palm leaf that arches by `sag` cells.
 * A `front` piece is painted over the trunk and branches; the others behind them.
 */
export type CrownPart = ({ shape: "blob"; x: number; y: number; r: number }
  | { shape: "oval"; x: number; y: number; rx: number; ry: number; point?: boolean }
  | { shape: "cone"; x: number; top: number; bottom: number; half: number; banded?: boolean }
  | { shape: "strand"; x: number; y: number; length: number }
  | { shape: "frond"; x1: number; y1: number; x2: number; y2: number; sag: number }) & { front?: boolean };
export type Tree = { segs: Segment[]; tips: [number, number][]; crown: CrownPart[]; w: number };

/**
 * Grows a tree of `kind` that fits `maxW` × `maxH` cells. `cap` limits how far a small tree is scaled up, and `bulk`
 * scales the crown's blobs and pads, which keep their size in cells while the branches scale: the Forest view's
 * larger trees use more bulk than the grove.
 */
export function growTree(kind: TreeKind, id: string, design: number, need: number, maxW: number, maxH: number, cap = 2.4, bulk = 1): Tree {
  const seed = hash(`${id}:${design}`), shape = kind.shape;
  switch (shape.form) {
    case "branch": return branchTree(shape, seed, need, maxW, maxH, cap, bulk);
    case "conifer": return spreadOut(coniferTree(shape, seed, need, maxW, maxH, cap), need);
    case "palm": return spreadOut(palmTree(shape, seed, need, maxW, maxH, cap), need);
    case "column": return spreadOut(columnTree(shape, seed, need, maxW, maxH, cap), need);
  }
}

/** The fewest cells, across or up and down, between two leaves' centres, so two leaf sprites (7 cells) barely touch. */
const LEAF_GAP = 5;
/** The tips in order, leaving out each one that is closer than `gap` cells to a tip already kept. */
function spaced(tips: readonly [number, number][], gap: number): [number, number][] {
  const kept: [number, number][] = [];
  for (const tip of tips) if (kept.every(([x, y]) => Math.max(Math.abs(x - tip[0]), Math.abs(y - tip[1])) >= gap)) kept.push(tip);
  return kept;
}
/**
 * The tree with only the tips that stand at least LEAF_GAP cells apart, so no leaf hides another. When fewer than
 * `need` tips stand that far apart, the tips furthest from the kept ones are added back until there are `need`, so
 * every skill still gets a tip and the leaves crowd as little as they can.
 */
function spreadOut(tree: Tree, need: number): Tree {
  const kept = spaced(tree.tips, LEAF_GAP);
  if (kept.length >= need) return { ...tree, tips: kept };
  const rest = tree.tips.filter((tip) => !kept.includes(tip));
  const away = (tip: [number, number]) => Math.min(...kept.map(([x, y]) => Math.max(Math.abs(x - tip[0]), Math.abs(y - tip[1]))));
  while (kept.length < need && rest.length) {
    let far = 0;
    for (let i = 1; i < rest.length; i++) if (away(rest[i]!) > away(rest[far]!)) far = i;
    kept.push(rest.splice(far, 1)[0]!);
  }
  return { ...tree, tips: kept };
}

const pickFrom = (random: () => number) => ([low, high]: Range) => low + random() * (high - low);

/** The tree moved by (dx, dy) cells. */
export function moveTree<T extends { segs: Segment[]; tips: [number, number][]; crown: CrownPart[] }>(tree: T, dx: number, dy: number): T {
  if (!dx && !dy) return tree;
  return {
    ...tree,
    segs: tree.segs.map(([x1, y1, x2, y2, th]) => [x1 + dx, y1 + dy, x2 + dx, y2 + dy, th] as Segment),
    tips: tree.tips.map(([x, y]) => [x + dx, y + dy] as [number, number]),
    crown: tree.crown.map((part): CrownPart => {
      switch (part.shape) {
        case "cone": return { ...part, x: part.x + dx, top: part.top + dy, bottom: part.bottom + dy };
        case "frond": return { ...part, x1: part.x1 + dx, y1: part.y1 + dy, x2: part.x2 + dx, y2: part.y2 + dy };
        default: return { ...part, x: part.x + dx, y: part.y + dy };
      }
    }),
  };
}

/** How far a crown piece reaches left and right. */
function span(part: CrownPart): [number, number] {
  switch (part.shape) {
    case "blob": return [part.x - part.r, part.x + part.r];
    case "oval": return [part.x - part.rx, part.x + part.rx];
    case "cone": return [part.x - part.half, part.x + part.half];
    case "strand": return [part.x - 1, part.x + 1];
    case "frond": return [Math.min(part.x1, part.x2) - 3, Math.max(part.x1, part.x2) + 3];
  }
}

type Raw = { segs: Segment[]; tips: [number, number][]; build: (x: (v: number) => number, scale: number) => CrownPart[] };
/**
 * Scales a tree drawn in free units to fit maxW × maxH (never more than `cap` times), then widens its box so every
 * crown piece and every leaf sprite (7 cells across) stays inside it, and the box's left edge is at 0.
 */
function fit({ segs, tips, build }: Raw, maxW: number, maxH: number, cap: number): Tree {
  const pad = 7;
  let minX = 0, maxX = 0, minY = 0;
  for (const s of segs) { minX = Math.min(minX, s[0], s[2]); maxX = Math.max(maxX, s[0], s[2]); minY = Math.min(minY, s[1], s[3]); }
  for (const [x, y] of tips) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); }
  const bw = maxX - minX + pad * 2, bh = -minY + pad;
  const scale = Math.min(maxW / bw, maxH / bh, cap);
  const X = (v: number) => (v - minX + pad) * scale;
  const tree: Tree = {
    segs: segs.map(([x1, y1, x2, y2, th]) => [X(x1), y1 * scale, X(x2), y2 * scale, th] as Segment),
    tips: tips.map(([x, y]) => [X(x), y * scale] as [number, number]),
    crown: build(X, scale), w: Math.ceil(bw * scale),
  };
  let low = 0, high = tree.w;
  for (const part of tree.crown) { const [a, b] = span(part); low = Math.min(low, Math.floor(a) - 1); high = Math.max(high, Math.ceil(b) + 1); }
  for (const [x] of tree.tips) { low = Math.min(low, Math.floor(x) - 4); high = Math.max(high, Math.ceil(x) + 4); }
  return { ...moveTree(tree, -low, 0), w: high - low };
}

/** A branching tree (oak, birch, willow, maple, cherry, baobab, jacaranda, bonsai). */
function branchTree(shape: BranchShape, seed: number, need: number, maxW: number, maxH: number, cap: number, bulk: number): Tree {
  let last: Tree | undefined, best: { tree: Tree; apart: number } | undefined;
  for (let depth = 2; depth <= 7; depth++) {
    const R = rng(seed), pick = pickFrom(R);
    const lean = pick(shape.lean) * (R() < 0.5 ? -1 : 1), bendSide = R() < 0.5 ? -1 : 1;
    const sp = { spread: pick(shape.spread), decay: pick(shape.decay), fork3: pick(shape.fork3), trunk: pick(shape.trunk), droop: pick(shape.droop) };
    const segs: Segment[] = [], tips: [number, number][] = [], forks: [number, number][] = [];
    const grow = (x: number, y: number, a: number, len: number, th: number, d: number, trunk = false) => {
      const angle = Math.max(-shape.clamp, Math.min(shape.clamp, a));
      // A bonsai's trunk bends one way, back the other way, and back again.
      const pieces = trunk && shape.bend ? [1, -1.25, 0.7].map((b) => angle + bendSide * shape.bend! * b) : [angle];
      let x2 = x, y2 = y;
      for (const piece of pieces) {
        // Nothing grows below the trunk's first few cells, so no branch or leaf reaches the ground.
        const nx = x2 + Math.sin(piece) * len / pieces.length, ny = Math.min(y2 - Math.cos(piece) * len / pieces.length, -6);
        segs.push([x2, y2, nx, ny, th]); x2 = nx; y2 = ny;
      }
      if (d === 0) { tips.push([x2, y2]); return; }
      if (d >= 1 && d <= (shape.fill ?? 1)) forks.push([x2, y2]);
      const k = R() < sp.fork3 ? 3 : 2;
      for (let i = 0; i < k; i++) {
        const off = (i - (k - 1) / 2) * sp.spread * (k === 3 ? 0.95 : 1.25);
        grow(x2, y2, angle + off + (R() - 0.5) * 0.3 + sp.droop * Math.sign(off) * (depth - d) / depth, len * (sp.decay + (R() - 0.5) * 0.1),
          Math.max(1, th - Math.max(1, Math.round(th / 3))), d - 1);
      }
    };
    grow(0, 0, lean, 22 * sp.trunk, shape.thickness, depth, true);
    const build = (X: (v: number) => number, scale: number) => {
      const RC = rng(seed ^ 0x5bd1e995), pickCrown = pickFrom(RC), parts: CrownPart[] = [];
      const size = (v: number) => Math.max(1, Math.round(v * bulk));
      const at = ([x, y]: [number, number]) => ({ x: Math.round(X(x)), y: Math.round(y * scale) });
      if (shape.crown !== "pad") {
        if (shape.forkRadius) for (const fork of forks) parts.push({ shape: "blob", ...at(fork), r: size(shape.forkRadius) });
        for (const tip of tips) parts.push({ shape: "blob", ...at(tip), r: size(Math.round(pickCrown(shape.tipRadius))) });
      }
      if (shape.crown === "willow" && shape.strand) {
        // Strands hang from every tip and fork: one long one in the middle and a shorter one either side.
        for (const point of [...tips, ...forks]) {
          const { x, y } = at(point), length = size(pickCrown(shape.strand));
          for (const [dx, share] of [[-3, 0.6], [0, 1], [3, 0.75]] as const) {
            parts.push({ shape: "strand", x: x + dx + Math.round((RC() - 0.5) * 2), y: y + 2, length: Math.max(3, Math.round(length * share)), front: true });
          }
        }
      }
      if (shape.crown === "pad") {
        for (const tip of tips) {
          const { x, y } = at(tip);
          parts.push({ shape: "oval", x, y: y + 1, rx: size(Math.round(pickCrown(shape.tipRadius))), ry: size(Math.round(pickCrown(shape.padHeight ?? [2, 3]))), front: true });
        }
      }
      return parts;
    };
    last = fit({ segs, tips, build }, maxW, maxH, cap);
    if (tips.length < need) continue;
    // Branch ends that land almost on top of each other carry one leaf between them, so the tree may grow one more
    // level to get enough tips that stand apart for each leaf to show on its own. More levels than that fill the
    // crown with twigs, so the better of the two levels is used.
    const apart = spaced(last.tips, LEAF_GAP).length;
    if (apart >= need) return spreadOut(last, need);
    if (best) { if (apart > best.apart) best = { tree: last, apart }; break; }
    best = { tree: last, apart };
  }
  return spreadOut(best?.tree ?? last!, need);
}

/** A conifer: tiers of branches up a straight trunk, with a tip at each branch's end and one at the top. */
function coniferTree(shape: ConiferShape, seed: number, need: number, maxW: number, maxH: number, cap: number): Tree {
  const R = rng(seed), pick = pickFrom(R), widen = pick(shape.widen), bare = pick(shape.bare), gap = shape.tiers === "cone" ? 6.2 : 6.8;
  const tiers: { half: number; n: number }[] = [];
  for (let count = 1; count < need || tiers.length < 3;) {
    const half = 3 + tiers.length * widen, n = Math.max(2, Math.floor((2 * half) / 9) + 1);
    tiers.push({ half, n }); count += n;
  }
  const height = bare + (tiers.length - 1) * gap + 6, row = (i: number) => -height + 6 + i * gap;
  const segs: Segment[] = [[0, 0, 0, -height, shape.thickness]], tips: [number, number][] = [[(R() - 0.5) * 0.6, -height]];
  tiers.forEach(({ half, n }, i) => {
    for (let j = 0; j < n; j++) {
      const x = -half + (2 * half * j) / (n - 1) + (R() - 0.5) * 1.2, y = row(i) + (R() - 0.5) * 1.2;
      segs.push([0, y - 2, x, y, 1]); tips.push([x, y]);
    }
  });
  const build = (X: (v: number) => number, scale: number): CrownPart[] => {
    const lowest = tiers.length - 1, x = Math.round(X(0));
    if (shape.tiers === "cone") {
      return [{ shape: "cone", x, top: Math.round((-height - 3) * scale), bottom: Math.round((row(lowest) + 2.5) * scale), half: Math.round((tiers[lowest]!.half + 3) * scale), front: true }];
    }
    // A spruce's tiers overlap: the lowest is painted first, and each tier above it hangs over the one below.
    return tiers.map((tier, i) => ({ shape: "cone" as const, x, top: Math.round((row(i) - gap * 1.9) * scale), bottom: Math.round((row(i) + 2.5) * scale),
      half: Math.round((tier.half + 3.2) * scale), banded: true, front: true })).reverse();
  };
  return fit({ segs, tips, build }, maxW, maxH, cap);
}

/** A point on the quadratic curve from (x1, y1) to (x2, y2) whose middle rises by `sag`, at t from 0 to 1. */
export function frondPoint(x1: number, y1: number, x2: number, y2: number, sag: number, t: number): [number, number] {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2 - sag, u = 1 - t;
  return [u * u * x1 + 2 * u * t * cx + t * t * x2, u * u * y1 + 2 * u * t * cy + t * t * y2];
}

/** A palm: a tall trunk that curves a little more toward its top, and fronds all around its crown. */
function palmTree(shape: PalmShape, seed: number, need: number, maxW: number, maxH: number, cap: number): Tree {
  const R = rng(seed), pick = pickFrom(R), height = pick(shape.height), lean = pick(shape.lean) * (R() < 0.5 ? -1 : 1);
  const segs: Segment[] = [];
  let x = 0, y = 0;
  for (let k = 0; k < 5; k++) {
    const a = lean * (0.3 + k * 0.35), nx = x + Math.sin(a) * height / 5, ny = y - Math.cos(a) * height / 5;
    segs.push([x, y, nx, ny, shape.thickness]); x = nx; y = ny;
  }
  const fronds = Math.max(5, Math.min(10, Math.ceil(need * 0.7))), along = Math.max(1, Math.ceil(need / fronds)), reach = 12 + fronds * 1.1;
  // Each frond carries `along` tips: its end, then points nearer the crown. A palm with very many skills spaces more
  // tips evenly along each frond.
  const stops = along <= 5 ? [1, 0.62, 0.4, 0.25, 0.14].slice(0, along) : Array.from({ length: along }, (_, i) => 1 - (i * 0.88) / (along - 1));
  const leaves: { x2: number; y2: number; sag: number }[] = [], tips: [number, number][] = [];
  for (let f = 0; f < fronds; f++) {
    const theta = -2.2 + (4.4 * f) / (fronds - 1) + (R() - 0.5) * 0.18, length = reach * (0.85 + R() * 0.25);
    const x2 = x + Math.sin(theta) * length, y2 = y - Math.cos(theta) * length * 0.7 + Math.abs(Math.sin(theta)) * length * 0.22;
    const sag = length * 0.28 * Math.abs(Math.sin(theta));
    leaves.push({ x2, y2, sag });
    for (const t of stops) tips.push(frondPoint(x, y, x2, y2, sag, t));
  }
  const build = (X: (v: number) => number, scale: number): CrownPart[] => [
    ...leaves.map(({ x2, y2, sag }) => ({ shape: "frond" as const, x1: Math.round(X(x)), y1: Math.round(y * scale), x2: X(x2), y2: y2 * scale, sag: sag * scale, front: true })),
    { shape: "blob", x: Math.round(X(x)), y: Math.round(y * scale), r: 2, front: true },
  ];
  return fit({ segs, tips, build }, maxW, maxH, cap);
}

/** The half-width of a pointed column `dy` cells below its middle: straight sides that taper to a point above the
 * middle, and a full, rounded foot below it. */
function columnHalf(rx: number, ry: number, dy: number): number {
  const t = Math.min(1, Math.abs(dy) / ry);
  return dy < 0 ? rx * (1 - t) ** 0.85 : rx * (1 - t ** 4) ** 0.25;
}

/** A cypress: rows of tips that alternate between two and one across (more when there are many skills), inside a
 * narrow column that tapers to a point. */
function columnTree(shape: ColumnShape, seed: number, need: number, maxW: number, maxH: number, cap: number): Tree {
  const R = rng(seed), bare = pickFrom(R)(shape.bare), gap = 6.4, step = 4.4;
  // At least six rows, so even a one-leaf cypress is a column rather than a bush.
  const rowsFor = (across: number) => { let rows = 0; for (let count = 1; count < need || rows < 6; rows++) count += rows % 2 === 0 ? across : across - 1; return rows; };
  let across = 2;
  while (rowsFor(across) > 11 && across < 8) across++;
  const rows = rowsFor(across), height = bare + 4 + rows * gap, bottom = -bare, top = -height - 4;
  const cy = (bottom + top) / 2, ry = (bottom - top) / 2, rx = (across - 1) * step + 3.2;
  const halfAt = (yy: number) => columnHalf(rx, ry, yy - cy);
  const segs: Segment[] = [[0, 0, 0, -height + 2, shape.thickness]], tips: [number, number][] = [[0, -height]];
  for (let j = 0; j < rows; j++) {
    const n = j % 2 === 0 ? across : across - 1, yy = -(bare + 4 + j * gap) + (R() - 0.5);
    // Rows near the top draw in toward the middle, so the column narrows to its point.
    const squeeze = Math.min(1, halfAt(yy) / (rx - 1));
    for (let i = 0; i < n; i++) {
      const xx = (i - (n - 1) / 2) * 2 * step * squeeze;
      segs.push([0, yy - 1.5, xx, yy, 1]); tips.push([xx, yy]);
    }
  }
  const build = (X: (v: number) => number, scale: number): CrownPart[] => [
    { shape: "oval", x: Math.round(X(0)), y: Math.round(cy * scale), rx: Math.round((rx + 2.5) * scale), ry: Math.round((ry + 3) * scale), point: true, front: true },
  ];
  return fit({ segs, tips, build }, maxW, maxH, cap);
}

export type Paint = { cell: (x: number, y: number, color: string) => void; rect: (x: number, y: number, w: number, h: number, color: string) => void };

/**
 * Paints a placed tree: the crown pieces behind the wood, the trunk and branches, the crown pieces in front, a green
 * pocket behind each leaf when the kind has one, and the open buds on spare tips. `leaves` are the leaf sprites'
 * centres; the caller paints the sprites themselves afterwards. `random` gives the crown its ragged edges and
 * speckles and is seeded by the caller, so the tree looks the same each time it is drawn. `tone` maps each color, for
 * the Forest view's dimmed trees, and `widen` adds a cell to every limb thicker than two cells, for its larger trees.
 */
export function paintTree({ cell }: Paint, tree: { segs: readonly Segment[]; crown: readonly CrownPart[]; buds: readonly (readonly [number, number])[];
  leaves?: readonly (readonly [number, number])[] }, kind: TreeKind, random: () => number,
  { tone = (color: string) => color, widen = false }: { tone?: (color: string) => string; widen?: boolean } = {}) {
  const colors = (set: Omit<CrownColors, "pocket">) => ({ shadow: tone(set.shadow), base: tone(set.base), speckle: tone(set.speckle), light: tone(set.light),
    accent: set.accent ? tone(set.accent) : undefined, accentRate: set.accentRate ?? 0 });
  const C = colors(kind.crown), P = kind.crown.pocket ? colors(kind.crown.pocket) : undefined;
  const B = { main: tone(kind.bark.main), shade: tone(kind.bark.shade), twig: tone(kind.bark.twig), mark: kind.bark.mark ? tone(kind.bark.mark) : undefined };
  const fill = (lower: boolean, lit: boolean, set = C) => lower ? set.shadow : lit ? set.light
    : set.accent && random() < set.accentRate ? set.accent : random() < 0.12 ? set.speckle : set.base;
  const blob = (x: number, y: number, r: number, set = C) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      const q = dx * dx + dy * dy;
      if (q <= r * r + 1 && !(q > r * r - 2 && random() < 0.35)) cell(x + dx, y + dy, fill(dy > r / 3, dx + dy < -r / 2, set));
    }
  };
  const piece = (part: CrownPart) => {
    switch (part.shape) {
      case "blob": blob(part.x, part.y, part.r); return;
      case "oval": {
        const { x, y, rx, ry, point } = part;
        for (let dy = -ry; dy <= ry; dy++) {
          // A pointed oval is a cypress's column: it narrows to a point above its middle.
          const across = point ? columnHalf(rx, ry + 0.5, dy) : rx * Math.sqrt(Math.max(0, 1 - (dy / (ry + 0.5)) ** 2));
          const half = Math.round(across);
          for (let dx = -half; dx <= half; dx++) {
            if (Math.abs(dx) === half && half > 1 && random() < 0.3) continue;
            // A column is lit from the left down its whole height; a pad is shaded along its underside.
            if (point) cell(x + dx, y + dy, fill(dx > half * 0.35 || ry - dy < 2, dx < -half * 0.4));
            else cell(x + dx, y + dy, fill(dy > ry / 3 || dx > half * 0.55, dx < -half * 0.45 && dy < ry / 3));
          }
        }
        return;
      }
      case "cone": {
        const { x, top, bottom, half, banded } = part, rows = Math.max(1, bottom - top);
        for (let yy = top; yy <= bottom; yy++) {
          // Needles: every other row is a cell narrower, so the edge reads as a saw.
          const across = Math.max(0, Math.round((half * (yy - top)) / rows) - ((yy - top) % 2 ? 1 : 0));
          const band = banded && bottom - yy < 2;
          for (let dx = -across; dx <= across; dx++) {
            if (Math.abs(dx) === across && across > 1 && random() < 0.25) continue;
            cell(x + dx, yy, fill(band || dx > across * 0.4, dx < -across * 0.5));
          }
        }
        return;
      }
      case "strand": {
        const { x, y, length } = part;
        let at = x;
        for (let i = 0; i < length; i++) {
          if (i > 2 && random() < 0.12) at += random() < 0.5 ? -1 : 1;
          cell(at, y + i, i === length - 1 ? C.light : i % 3 === 2 ? C.speckle : C.base);
        }
        return;
      }
      case "frond": {
        const { x1, y1, x2, y2, sag } = part, steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.6) + 2, side = Math.sign(x2 - x1) || 1;
        for (let i = 0; i <= steps; i++) {
          const [px, py] = frondPoint(x1, y1, x2, y2, sag, i / steps), cx = Math.round(px), cy = Math.round(py);
          cell(cx, cy, C.shadow);
          // Leaflets hang from the frond's midrib, longest in the middle of the frond.
          if (i > 1 && i % 2 === 0) {
            const t = i / steps, reach = Math.max(1, Math.round(3 * Math.sin(Math.PI * t)));
            for (let k = 1; k <= reach; k++) cell(cx + (k > 1 ? side : 0), cy + k, k === reach ? C.light : C.base);
            cell(cx, cy - 1, C.base);
          }
        }
        return;
      }
    }
  };
  for (const part of tree.crown) if (!part.front) piece(part);
  for (const [x1, y1, x2, y2, th] of tree.segs) {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 1.4) + 1, w = th + (widen && th > 2 ? 1 : 0);
    for (let i = 0; i <= steps; i++) {
      const bx = Math.round(x1 + ((x2 - x1) * i) / steps), by = Math.round(y1 + ((y2 - y1) * i) / steps);
      // Birch bark carries short dark marks; a palm's trunk has a ring every third row.
      const mark = B.mark && w > 2 && random() < 0.16 ? Math.floor(random() * (w - 2)) + 1 : -1;
      for (let k = 0; k < w; k++) {
        const edge = k === w - 1 || (!!B.mark && k === 0 && w > 2);
        const color = w === 1 ? B.twig : edge ? B.shade : k === mark ? B.mark! : kind.bark.rings && by % 3 === 0 ? B.shade : B.main;
        cell(bx + k - Math.floor(w / 2), by, color);
      }
    }
  }
  for (const part of tree.crown) if (part.front) piece(part);
  // On a warm crown or a palm's fronds, each leaf sits in a small green pocket, so its stage reads as it does on a green tree.
  if (P) for (const [x, y] of tree.leaves ?? []) blob(Math.round(x), Math.round(y), 4, P);
  for (const [bx, by] of tree.buds) { cell(bx, by, "#6DB892"); cell(bx + 1, by - 1, "#6DB892"); }
}

/** One leaf sprite centred on (x, y). */
export function paintLeaf({ cell }: Paint, x: number, y: number, stage: Stage) {
  SPRITES[stage].forEach((row, ry) => {
    for (let rx = 0; rx < row.length; rx++) { const ch = row.charAt(rx); if (ch !== ".") cell(x - 3 + rx, y - 3 + ry, PAL[ch] ?? "#000000"); }
  });
}

/** `count` of the tips, spread from left to right, for a preview's sample leaves. */
export function evenTips(tips: readonly [number, number][], count: number): [number, number][] {
  const sorted = [...tips].sort((a, b) => a[0] - b[0]);
  if (count >= sorted.length) return sorted;
  return Array.from({ length: count }, (_, i) => sorted[Math.round(((i + 0.5) * sorted.length) / count - 0.5)]!);
}

/**
 * Draws a small square preview of `kind` for the tree picker: two sky bands, a strip of grass and soil, and the tree
 * with one sample leaf for each of `stages`, in 2 px cells (as in the sign-in page's sample grove).
 */
export function drawTreePreview(canvas: HTMLCanvasElement, kind: TreeKind, size: number, dpr: number, stages: readonly Stage[]) {
  const unit = 2, cells = Math.floor(size / unit), ground = cells - 7, px = unit * dpr;
  canvas.width = Math.round(cells * px); canvas.height = Math.round(cells * px);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    const left = Math.round(x * px), top = Math.round(y * px);
    ctx.fillStyle = color; ctx.fillRect(left, top, Math.round((x + w) * px) - left, Math.round((y + h) * px) - top);
  };
  const cell = (x: number, y: number, color: string) => rect(Math.round(x), Math.round(y), 1, 1, color);
  rect(0, 0, cells, Math.ceil(ground / 2), "#DEECF3"); rect(0, Math.ceil(ground / 2), cells, ground - Math.ceil(ground / 2), "#E5F0F5");
  rect(0, ground, cells, 1, "#2F8A5F"); rect(0, ground + 1, cells, 1, "#256F4C"); rect(0, ground + 2, cells, cells - ground - 2, "#CDB884");
  const grown = growTree(kind, `preview:${kind.id}`, 1, stages.length + 4, cells - 6, ground - 4, 1.4, 1);
  const tree = moveTree(grown, Math.round((cells - grown.w) / 2), ground);
  const leaves = evenTips(tree.tips, stages.length).map(([x, y]) => [Math.round(x), Math.round(y)] as const);
  const used = new Set(leaves.map(([x, y]) => `${x},${y}`));
  const buds = tree.tips.map(([x, y]) => [Math.round(x), Math.round(y)] as const).filter(([x, y]) => !used.has(`${x},${y}`));
  paintTree({ cell, rect }, { segs: tree.segs, crown: tree.crown, buds, leaves }, kind, rng(hash(`preview:${kind.id}`)));
  leaves.forEach(([x, y], i) => paintLeaf({ cell, rect }, x, y, stages[i]!));
}
