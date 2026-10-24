// Pixel-art data and helpers lifted from the prototype (StillGotIt A5 - Pixel Nature.dc.html).
// Icons are 12x12 letter grids; sprites are 7x7. Each letter maps to a colour in PAL (day) / NIGHT (dark mode).
// iconRects(rows) turns a grid into {x, y, w, fill} runs for crisp SVG/canvas drawing.
// genTree(id, design, need, maxW, maxH, cap) is the seeded L-system-ish tree used for each topic: same id+design → same tree;
// bump "design" to regrow. It deepens until it has at least `need` tips (one per skill plus spare buds).
const PAL = { B:"#2F7D9B", b:"#2A6B85", s:"#63A7C1", w:"#D6E4EC", k:"#12333F", R:"#D9663A", r:"#B5502B", o:"#EE9C78", Y:"#E3A233", y:"#C08324", l:"#F3CD7A", G:"#2F8A5F", g:"#256F4C", h:"#6DB892", P:"#6B5BD2", p:"#5546B0", v:"#9A8EE6", S:"#5C6B73", d:"#48555C", E:"#8E9BA2", e:"#AEBAC0", f:"#CBD5DA", c:"#E9D6A8", C:"#CDB884", W:"#FFFFFF" };
const NIGHT = { B:"#4A9FC4", b:"#3F8FB4", s:"#7FC6E4", w:"#DBEEF8", R:"#F0895F", r:"#D06F47", o:"#F8B597", Y:"#F2B452", y:"#D9983A", l:"#F9D98F", G:"#4BBD85", g:"#3A9A6B", h:"#86D6AC", P:"#9387F2", p:"#7568D6", v:"#B6ADF8", S:"#9AA7AE", d:"#7F8C93", e:"#C9D3D8", E:"#A9B5BB", c:"#F3E3BC", C:"#D9C697", W:"#FFFFFF" };
function cellsOf(p, n, on, off) { const k = Math.round(Math.max(0, Math.min(100, p)) / 100 * n); return Array.from({ length: n }, (_, i) => ({ bg: i < k ? on : off })); }
const WHALE = [[10,1,7,1,"#2F7D9B"],[8,2,11,1,"#2F7D9B"],[7,3,13,1,"#2F7D9B"],[6,4,15,1,"#2F7D9B"],[5,5,17,1,"#2F7D9B"],[5,6,16,1,"#2F7D9B"],[5,7,16,1,"#2A6B85"],[5,8,16,1,"#2A6B85"],[6,9,14,1,"#EAF3F7"],[6,10,14,1,"#EAF3F7"],[7,11,12,1,"#EAF3F7"],[9,12,8,1,"#EAF3F7"],[11,9,4,1,"#2A6B85"],[12,10,3,1,"#2A6B85"],[10,1,3,1,"#63A7C1"],[8,2,3,1,"#63A7C1"],[21,5,2,4,"#2F7D9B"],[23,3,2,3,"#2F7D9B"],[23,8,2,3,"#2F7D9B"],[7,5,2,2,"#12333F"],[7,5,1,1,"#FFFFFF"]];
const DOC = ["..ffffff....","..fWWWWfe...","..fWWWWfee..","..fWWWWWWf..","..fWddddWf..","..fWWWWWWf..","..fWddddWf..","..fWWWWWWf..","..XXXXXXXX..","..XXWWWXXX..","..XXXXXXXX..","............"];
function docIcon(kind) { const x = ({ PDF: "R", PPTX: "Y", IMG: "G", MD: "B" })[kind] || "S"; return DOC.map(r => r.split("X").join(x)); }
const ICONS = {
  info: ["...bbbbbb...","..bwwwwwwb..",".bwwwBBwwwb.",".bwwwwwwwwb.",".bwwwBBwwwb.",".bwwwBBwwwb.",".bwwwBBwwwb.",".bwwwBBwwwb.","..bwwwwwwb..","...bbbbbbb..","....bb......","...b........"],
  lighthouse: [".....YY.....","....YllY....",".....RR.....",".....WW.....",".....RR.....",".....WW.....","....RRRR....","....WWWW....","...dRRRRd...","..ddddddddd.",".EEdddddddEE","BBBBBBBBBBBB"],
  settings: ["............","..BB........","eeBBeeeeeeee","..bb........","............",".......RR...","eeeeeeeRReee",".......rr...","............","....YY......","eeeeYYeeeeee","....yy......"],
  home: [".....RR.....","....RRRR....","...RoRRRR...","..RoRRRRRR..",".RRRRRRRRRR.","rrrrrrrrrrrr",".cccccccccc.",".cBBccccccc.",".cBBcccddcc.",".ccccccddcc.",".ccccccddcc.",".CCCCCCddCC."],
  sun: ["............",".....Y......","..Y..Y..Y...","...lllll....","..lYYYYYl...","YYlYYYYYlYY.","..lYYYYyl...","..lYYYyyl...","...lllll....","..Y..Y..Y...",".....Y......","............"],
  summit: ["....dRR.....","....dRoR....","....d.......","....d.......","...dEf......","...EEEf.....","..EEEEff....","..EEdEEEf...",".EEEddEEEf..",".EEdEEEEEEf.","EEEEEEEdEEEf","SSSSSSSSSSSS"],
  leaf: ["............",".....GGGGGG.","....GhhGGgG.","...GhGGGgGG.","...GGGGgGGG.","..GGGGgGGGG.","..GGGgGGGG..","..GGgGGGG...","..GgGGGG....","..gggg......",".d..........","d..........."],
  tree: ["....GGGG....","...GhGGGG...","..GhGGGGGG..",".GGGGGGGGGG.",".GGGGGGGGGG.",".GGGGGGGGgg.","..GGGGGggg..","...ggyygg...",".....yy.....",".....yy.....","....yyyy....","............"],
  calendar: ["..S......S..",".BSBBBBBBSB.",".BsBBBBBBBB.",".bbbbbbbbbb.",".wwwwwwwwww.",".wBBwBBwBBw.",".wBBwBBwBBw.",".wwwwwwwwww.",".wBBwRRwwww.",".wBBwRRwwww.",".wwwwwwwwww.",".eeeeeeeeee."],
  school: ["............",".....PP.....","...PPvPPP...",".PPvPPPPPPP.","PPPPPPPPPPPP",".PPPPPPPPPY.","...PPPPPP.Y.","..ppppppppY.","..ppppppppY.","...pppppp.YY","..........YY","............"],
};
const SPR = {
  bud: [".......",".......","...Y...","..YlY..","...y...",".......","......."],
  sprout: [".......","..h.h..",".hGhGh.","..hGh..","...g...",".......","......."],
  leaf: [".......","..GGh..",".GGGGh.",".GgGGG.","..GgG..","...g...","......."],
  full: ["..gGGh.",".gGGGGh","gGgGGhG","gGGgGGG",".gGGgG.","..ggg..","......."],
  bloom: ["..gGGh.",".gGoGGh","gGgRGhG","gRGgGoG",".gGGgG.","..ggg..","......."],
  flag: [".......","...dRR.","...dRo.","...d...","...d...","...d...","......."],
};
function stageOf(m) { return m === undefined ? "bud" : m < 35 ? "sprout" : m < 65 ? "leaf" : m < 80 ? "full" : "bloom"; }
function iconRects(rows, night) { const out = []; rows.forEach((row, y) => { let x = 0; while (x < row.length) { let e = x + 1; while (e < row.length && row[e] === row[x]) e++; const ch = row[x]; if (ch !== ".") out.push({ x, y, w: e - x, fill: (night && NIGHT[ch]) || PAL[ch] }); x = e; } }); return out; }
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function genTree(id, design, need, maxW, maxH, cap) {
  for (let depth = 2; depth <= 7; depth++) {
    const R = rng(hash(id + ":" + design));
    const sp = { spread: 0.42 + R() * 0.5, decay: 0.66 + R() * 0.14, fork3: R() * 0.65, lean: (R() - 0.5) * 0.22, trunk: 0.85 + R() * 0.6, droop: R() < 0.3 ? 0.35 : 0 };
    const segs = [], tips = [];
    const grow = (x, y, a, len, th, d) => {
      const x2 = x + Math.sin(a) * len, y2 = y - Math.cos(a) * len; segs.push([x, y, x2, y2, th]);
      if (d === 0) { tips.push([x2, y2]); return; }
      const k = R() < sp.fork3 ? 3 : 2;
      for (let i = 0; i < k; i++) { const off = (i - (k - 1) / 2) * sp.spread * (k === 3 ? 0.95 : 1.25);
        grow(x2, y2, a + off + (R() - 0.5) * 0.3 + sp.droop * Math.sign(off) * (depth - d) / depth, len * (sp.decay + (R() - 0.5) * 0.1), Math.max(1, th - 1), d - 1); }
    };
    grow(0, 0, sp.lean, 22 * sp.trunk, 4, depth);
    if (tips.length >= need || depth === 7) {
      let minX = 0, maxX = 0, minY = 0; for (const s of segs) { minX = Math.min(minX, s[0], s[2]); maxX = Math.max(maxX, s[0], s[2]); minY = Math.min(minY, s[1], s[3]); }
      const pad = 7, bw = maxX - minX + pad * 2, bh = -minY + pad;
      const sc = Math.min(maxW / bw, maxH / bh, cap || 2.4);
      const X = v => (v - minX + pad) * sc;
      return { segs: segs.map(s => [X(s[0]), s[1] * sc, X(s[2]), s[3] * sc, s[4]]), tips: tips.map(t => [X(t[0]), t[1] * sc]), w: Math.ceil(bw * sc) };
    }
  }
}
const EXTRA_UNITS = [
  { id: "u3", title: "Linear systems", names: ["Solve by elimination", "Read an augmented matrix", "Spot a free variable", "Back-substitute", "Count solutions", "Write a system as Ax = b", "Find pivots", "Use row echelon form"] },
  { id: "u4", title: "Determinants", names: ["Compute a 2×2 determinant", "Expand by cofactors", "Use row operations on det", "Test invertibility", "Find area with det", "Apply det(AB) = det A det B"] },
  { id: "u5", title: "Eigenvalues", names: ["Find the characteristic polynomial", "Compute eigenvalues", "Find an eigenvector", "Diagonalize a matrix", "Explain repeated eigenvalues", "Use eigenvalues of powers", "Read the trace and det"] },
  { id: "u6", title: "Vector spaces", names: ["Check a subspace", "Find a basis", "Compute dimension", "Find the null space", "Find the column space", "Test independence", "Change of basis"] },
];
