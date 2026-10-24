// Pixel-art data and helpers for the "Pixel Nature" look (design/revamp/README.md).
// Icons are 12×12 letter grids and sprites are 7×7; each letter names a colour in PAL. iconRects turns a grid into
// horizontal runs for crisp SVG or canvas drawing. genTree draws the seeded topic tree: the same id and design give the
// same tree, and bumping the design regrows it. It deepens until it has at least `need` tips (one per skill plus spare buds).

export const PAL: Record<string, string> = {
  B: "#2F7D9B", b: "#2A6B85", s: "#63A7C1", w: "#D6E4EC", k: "#12333F", R: "#D9663A", r: "#B5502B", o: "#EE9C78", Y: "#E3A233",
  y: "#C08324", l: "#F3CD7A", G: "#2F8A5F", g: "#256F4C", h: "#6DB892", P: "#6B5BD2", p: "#5546B0", v: "#9A8EE6", S: "#5C6B73",
  d: "#48555C", E: "#8E9BA2", e: "#AEBAC0", f: "#CBD5DA", c: "#E9D6A8", C: "#CDB884", W: "#FFFFFF",
};

/** The mastery cells: `n` squares, the first `round(p% × n)` filled. */
export function cellsOf(p: number, n: number, on: string, off: string): { bg: string }[] {
  const k = Math.round(Math.max(0, Math.min(100, p)) / 100 * n);
  return Array.from({ length: n }, (_, i) => ({ bg: i < k ? on : off }));
}

/** The WhaleLife whale as [x, y, w, h, fill] runs, facing left; draw mirrored to face right. */
export const WHALE: [number, number, number, number, string][] = [
  [10, 1, 7, 1, "#2F7D9B"], [8, 2, 11, 1, "#2F7D9B"], [7, 3, 13, 1, "#2F7D9B"], [6, 4, 15, 1, "#2F7D9B"], [5, 5, 17, 1, "#2F7D9B"],
  [5, 6, 16, 1, "#2F7D9B"], [5, 7, 16, 1, "#2A6B85"], [5, 8, 16, 1, "#2A6B85"], [6, 9, 14, 1, "#EAF3F7"], [6, 10, 14, 1, "#EAF3F7"],
  [7, 11, 12, 1, "#EAF3F7"], [9, 12, 8, 1, "#EAF3F7"], [11, 9, 4, 1, "#2A6B85"], [12, 10, 3, 1, "#2A6B85"], [10, 1, 3, 1, "#63A7C1"],
  [8, 2, 3, 1, "#63A7C1"], [21, 5, 2, 4, "#2F7D9B"], [23, 3, 2, 3, "#2F7D9B"], [23, 8, 2, 3, "#2F7D9B"], [7, 5, 2, 2, "#12333F"], [7, 5, 1, 1, "#FFFFFF"],
];

const DOC = ["..ffffff....", "..fWWWWfe...", "..fWWWWfee..", "..fWWWWWWf..", "..fWddddWf..", "..fWWWWWWf..", "..fWddddWf..", "..fWWWWWWf..", "..XXXXXXXX..", "..XXWWWXXX..", "..XXXXXXXX..", "............"];
export type DocKind = "PDF" | "PPTX" | "IMG" | "MD" | "OTHER";
/** A document icon whose bottom band is coral for PDF, yellow for slides, green for images and blue for Markdown. */
export function docIcon(kind: DocKind | string): string[] {
  const x = ({ PDF: "R", PPTX: "Y", IMG: "G", MD: "B" } as Record<string, string>)[kind] ?? "S";
  return DOC.map((r) => r.split("X").join(x));
}

export const ICONS = {
  info: ["...bbbbbb...", "..bwwwwwwb..", ".bwwwBBwwwb.", ".bwwwwwwwwb.", ".bwwwBBwwwb.", ".bwwwBBwwwb.", ".bwwwBBwwwb.", ".bwwwBBwwwb.", "..bwwwwwwb..", "...bbbbbbb..", "....bb......", "...b........"],
  lighthouse: [".....YY.....", "....YllY....", ".....RR.....", ".....WW.....", ".....RR.....", ".....WW.....", "....RRRR....", "....WWWW....", "...dRRRRd...", "..ddddddddd.", ".EEdddddddEE", "BBBBBBBBBBBB"],
  settings: ["............", "..BB........", "eeBBeeeeeeee", "..bb........", "............", ".......RR...", "eeeeeeeRReee", ".......rr...", "............", "....YY......", "eeeeYYeeeeee", "....yy......"],
  home: [".....RR.....", "....RRRR....", "...RoRRRR...", "..RoRRRRRR..", ".RRRRRRRRRR.", "rrrrrrrrrrrr", ".cccccccccc.", ".cBBccccccc.", ".cBBcccddcc.", ".ccccccddcc.", ".ccccccddcc.", ".CCCCCCddCC."],
  sun: ["............", ".....Y......", "..Y..Y..Y...", "...lllll....", "..lYYYYYl...", "YYlYYYYYlYY.", "..lYYYYyl...", "..lYYYyyl...", "...lllll....", "..Y..Y..Y...", ".....Y......", "............"],
  summit: ["....dRR.....", "....dRoR....", "....d.......", "....d.......", "...dEf......", "...EEEf.....", "..EEEEff....", "..EEdEEEf...", ".EEEddEEEf..", ".EEdEEEEEEf.", "EEEEEEEdEEEf", "SSSSSSSSSSSS"],
  leaf: ["............", ".....GGGGGG.", "....GhhGGgG.", "...GhGGGgGG.", "...GGGGgGGG.", "..GGGGgGGGG.", "..GGGgGGGG..", "..GGgGGGG...", "..GgGGGG....", "..gggg......", ".d..........", "d..........."],
  tree: ["....GGGG....", "...GhGGGG...", "..GhGGGGGG..", ".GGGGGGGGGG.", ".GGGGGGGGGG.", ".GGGGGGGGgg.", "..GGGGGggg..", "...ggyygg...", ".....yy.....", ".....yy.....", "....yyyy....", "............"],
  calendar: ["..S......S..", ".BSBBBBBBSB.", ".BsBBBBBBBB.", ".bbbbbbbbbb.", ".wwwwwwwwww.", ".wBBwBBwBBw.", ".wBBwBBwBBw.", ".wwwwwwwwww.", ".wBBwRRwwww.", ".wBBwRRwwww.", ".wwwwwwwwww.", ".eeeeeeeeee."],
  school: ["............", ".....PP.....", "...PPvPPP...", ".PPvPPPPPPP.", "PPPPPPPPPPPP", ".PPPPPPPPPY.", "...PPPPPP.Y.", "..ppppppppY.", "..ppppppppY.", "...pppppp.YY", "..........YY", "............"],
} as const;
export type IconName = keyof typeof ICONS;

export const SPRITES = {
  bud: [".......", ".......", "...Y...", "..YlY..", "...y...", ".......", "......."],
  sprout: [".......", "..h.h..", ".hGhGh.", "..hGh..", "...g...", ".......", "......."],
  leaf: [".......", "..GGh..", ".GGGGh.", ".GgGGG.", "..GgG..", "...g...", "......."],
  full: ["..gGGh.", ".gGGGGh", "gGgGGhG", "gGGgGGG", ".gGGgG.", "..ggg..", "......."],
  bloom: ["..gGGh.", ".gGoGGh", "gGgRGhG", "gRGgGoG", ".gGGgG.", "..ggg..", "......."],
  flag: [".......", "...dRR.", "...dRo.", "...d...", "...d...", "...d...", "......."],
} as const;
export type Stage = keyof typeof SPRITES;

/** The growth stage of a mastery value: no estimate is a bud; then sprout, leaf, full and bloom at 35, 65 and 80. */
export function stageOf(m: number | undefined | null): Stage {
  return m === undefined || m === null ? "bud" : m < 35 ? "sprout" : m < 65 ? "leaf" : m < 80 ? "full" : "bloom";
}
/** The stage names as the legend shows them. */
export const STAGE_LABELS: Record<Stage, string> = { bud: "No estimate yet", sprout: "Under 35%", leaf: "35% to 64%", full: "65% to 79%", bloom: "80% and up", flag: "Due today" };

export type Run = { x: number; y: number; w: number; fill: string };
/** Horizontal runs of same-coloured cells, for `<rect>` elements with `shape-rendering: crispEdges`. */
export function iconRects(rows: readonly string[]): Run[] {
  const out: Run[] = [];
  rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      let e = x + 1;
      while (e < row.length && row[e] === row[x]) e++;
      const ch = row[x]!;
      if (ch !== ".") out.push({ x, y, w: e - x, fill: PAL[ch] ?? "#000000" });
      x = e;
    }
  });
  return out;
}

/** A small deterministic random source. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export type Segment = [number, number, number, number, number];
export type Tree = { segs: Segment[]; tips: [number, number][]; w: number };
/**
 * A seeded tree in cell units. Segments are [x1, y1, x2, y2, thickness] with the trunk base at (0, 0) and y growing
 * upward as negative values before scaling; tips are branch ends, in the same space. The result fits `maxW` × `maxH`.
 */
export function genTree(id: string, design: number, need: number, maxW: number, maxH: number, cap = 2.4): Tree {
  let last: Tree | undefined;
  for (let depth = 2; depth <= 7; depth++) {
    const R = rng(hash(id + ":" + design));
    const sp = { spread: 0.42 + R() * 0.5, decay: 0.66 + R() * 0.14, fork3: R() * 0.65, lean: (R() - 0.5) * 0.22, trunk: 0.85 + R() * 0.6, droop: R() < 0.3 ? 0.35 : 0 };
    const segs: Segment[] = [], tips: [number, number][] = [];
    const grow = (x: number, y: number, a: number, len: number, th: number, d: number) => {
      const x2 = x + Math.sin(a) * len, y2 = y - Math.cos(a) * len;
      segs.push([x, y, x2, y2, th]);
      if (d === 0) { tips.push([x2, y2]); return; }
      const k = R() < sp.fork3 ? 3 : 2;
      for (let i = 0; i < k; i++) {
        const off = (i - (k - 1) / 2) * sp.spread * (k === 3 ? 0.95 : 1.25);
        grow(x2, y2, a + off + (R() - 0.5) * 0.3 + sp.droop * Math.sign(off) * (depth - d) / depth, len * (sp.decay + (R() - 0.5) * 0.1), Math.max(1, th - 1), d - 1);
      }
    };
    grow(0, 0, sp.lean, 22 * sp.trunk, 4, depth);
    let minX = 0, maxX = 0, minY = 0;
    for (const s of segs) { minX = Math.min(minX, s[0], s[2]); maxX = Math.max(maxX, s[0], s[2]); minY = Math.min(minY, s[1], s[3]); }
    const pad = 7, bw = maxX - minX + pad * 2, bh = -minY + pad;
    const sc = Math.min(maxW / bw, maxH / bh, cap);
    const X = (v: number) => (v - minX + pad) * sc;
    last = { segs: segs.map((s) => [X(s[0]), s[1] * sc, X(s[2]), s[3] * sc, s[4]] as Segment), tips: tips.map((t) => [X(t[0]), t[1] * sc] as [number, number]), w: Math.ceil(bw * sc) };
    if (tips.length >= need) return last;
  }
  return last!;
}
