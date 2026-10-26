// Pixel-art data and helpers for the "Pixel Nature" look (design/revamp/README.md).
// Icons are 12×12 letter grids and sprites are 7×7; each letter names a colour in PAL. iconRects turns a grid into
// horizontal runs for crisp SVG or canvas drawing. The topic trees are grown and painted in tree-draw.ts.

export const PAL: Record<string, string> = {
  B: "#2F7D9B", b: "#2A6B85", s: "#63A7C1", w: "#D6E4EC", k: "#12333F", R: "#D9663A", r: "#B5502B", o: "#EE9C78", Y: "#E3A233",
  y: "#C08324", l: "#F3CD7A", G: "#2F8A5F", g: "#256F4C", h: "#6DB892", P: "#6B5BD2", p: "#5546B0", v: "#9A8EE6", S: "#5C6B73",
  d: "#48555C", E: "#8E9BA2", e: "#AEBAC0", f: "#CBD5DA", c: "#E9D6A8", C: "#CDB884", W: "#FFFFFF",
  // The filled mastery cell's green (MasteryCells.vue), for marks that stand for the estimate itself.
  m: "#4A775A",
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
  // The Memory view: a curve falling past a dashed coral threshold, on slate axes.
  memory: ["............", ".d..........", ".dPP........", ".d.pP.......", ".d..pP......", ".dR.RpPR.R..", ".d....pPP...", ".d.....ppPPP", ".d.......ppp", ".d..........", ".ddddddddddd", "............"],
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

/**
 * The evidence marks, 10×10, shared by the estimate chart's markers and the evidence timeline's row icons: a hollow
 * square for the starting point, a filled square for an assessed attempt, a hollow diamond for the learner's own
 * adjustment, a falling stair for time without practice, and a filled slate square for an attempt that did not count.
 */
export const MARKS = {
  start: ["..........", ".SSSSSSSS.", ".SSSSSSSS.", ".SS....SS.", ".SS....SS.", ".SS....SS.", ".SS....SS.", ".SSSSSSSS.", ".SSSSSSSS.", ".........."],
  attempt: ["..........", ".pppppppp.", ".pppppppp.", ".pppppppp.", ".pppppppp.", ".pppppppp.", ".pppppppp.", ".pppppppp.", ".pppppppp.", ".........."],
  adjustment: ["....pp....", "...pppp...", "..pp..pp..", ".pp....pp.", "pp......pp", "pp......pp", ".pp....pp.", "..pp..pp..", "...pppp...", "....pp...."],
  time: ["..........", "mmmm......", "mmmm......", "..mm......", "..mmmmm...", "..mmmmm...", ".....mm...", ".....mmmmm", ".....mmmmm", ".........."],
  ignored: ["..........", ".SSSSSSSS.", ".SSSSSSSS.", ".SSSSSSSS.", ".SSSSSSSS.", ".SSSSSSSS.", ".SSSSSSSS.", ".SSSSSSSS.", ".SSSSSSSS.", ".........."],
} as const;
export type MarkName = keyof typeof MARKS;

/** A grid grown by `r` cells on every side, every cell near a filled one filled white: the 2px surface ring behind a mark. */
export function ringOf(rows: readonly string[], r = 2): string[] {
  const filled = (x: number, y: number) => { const ch = rows[y]?.[x]; return ch !== undefined && ch !== "."; };
  const width = rows[0]?.length ?? 0, out: string[] = [];
  for (let y = -r; y < rows.length + r; y++) {
    let line = "";
    for (let x = -r; x < width + r; x++) {
      let on = false;
      for (let dy = -r; dy <= r && !on; dy++) for (let dx = -r; dx <= r && !on; dx++) on = filled(x + dx, y + dy);
      line += on ? "W" : ".";
    }
    out.push(line);
  }
  return out;
}

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
