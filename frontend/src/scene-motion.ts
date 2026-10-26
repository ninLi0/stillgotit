// Ambient motion for the pixel scenes on Home, Plan and the Forest view (design/visual-design.md, "Motion"). Each
// scene draws what stays still on a canvas, in whole cells, and lays what moves over it as SVG rectangles in the same
// cells. A moving sprite is placed at a whole cell and carries a drift: how far it travels from there and how long one
// way takes. The `.drift` rule in style.css eases that offset on the loop curve, one way and back, and rounds it to
// whole device pixels, so the sprite glides and its edges stay crisp. Nothing here runs a timer.

/** A rectangle of a sprite, in cells, relative to the sprite's place. */
export type CellRect = { x: number; y: number; w: number; h: number; fill: string };
/** The same rectangle as SVG attributes in CSS pixels, ready for `<rect v-bind>`. */
export type PixelRect = { x: number; y: number; width: number; height: number; fill: string };

/**
 * How a sprite drifts. `x` and `y` are how far it travels, in CSS pixels; `seconds` is how long one way takes
 * (`ySeconds` for the vertical, when it differs); `phase` is where in its back-and-forth cycle it starts, from 0 to 1,
 * so sprites of one kind do not move in step (`yPhase` for the vertical).
 */
export type Drift = { x?: number; y?: number; seconds: number; ySeconds?: number; phase?: number; yPhase?: number };

/** A sprite ready to draw: where it sits, as an SVG translation in CSS pixels, its rectangles, and the style that sets
 * its drift. */
export type Sprite = { key: string; at: string; rects: PixelRect[]; motion: Record<string, string> };

export function toPixels(rects: readonly CellRect[], unit: number): PixelRect[] {
  return rects.map((r) => ({ x: r.x * unit, y: r.y * unit, width: r.w * unit, height: r.h * unit, fill: r.fill }));
}

/** The custom properties `.drift` reads. A negative delay starts the loop part of the way through its cycle, so the
 * sprite is already on its way when the page opens. */
export function driftStyle(d: Drift): Record<string, string> {
  const ys = d.ySeconds ?? d.seconds, round = (n: number) => Math.round(n * 1000) / 1000;
  return {
    "--reach-x": `${round(d.x ?? 0)}px`, "--reach-y": `${round(d.y ?? 0)}px`,
    "--period-x": `${round(d.seconds)}s`, "--period-y": `${round(ys)}s`,
    "--delay-x": `${round(-(d.phase ?? 0) * 2 * d.seconds)}s`, "--delay-y": `${round(-(d.yPhase ?? d.phase ?? 0) * 2 * ys)}s`,
  };
}

/** A drifting sprite placed at cell (`x`, `y`) of a scene with `unit` CSS pixels per cell. */
export function sprite(key: string, x: number, y: number, unit: number, rects: readonly CellRect[], drift: Drift): Sprite {
  return { key, at: `translate(${x * unit} ${y * unit})`, rects: toPixels(rects, unit), motion: driftStyle(drift) };
}

/**
 * A cloud `w` cells wide: a two-cell body, a narrower top row set in by `inset` cells and `trim` cells shorter, and a
 * shaded row under it. Home and Plan use inset 2 and trim 5; the Forest view's longer clouds use inset 3 and trim 7.
 */
export function cloudRects(w: number, shade: string, inset: number, trim: number): CellRect[] {
  return [
    { x: 0, y: 0, w, h: 2, fill: "#FFFFFF" },
    { x: inset, y: -1, w: Math.max(3, w - trim), h: 1, fill: "#FFFFFF" },
    { x: 1, y: 2, w: w - 2, h: 1, fill: shade },
  ];
}

/**
 * How one cloud drifts, from a seeded random source: between 10 and 21 cells to the right and back, taking 18 to 32
 * seconds each way, so it moves a few pixels a second at most. Its `shift` moves its place left by half its reach, so
 * it drifts around the spot where it is seeded.
 */
export function cloudDrift(random: () => number, unit: number): { drift: Drift; shift: number } {
  const reach = 10 + Math.floor(random() * 12), seconds = 18 + random() * 14, phase = random();
  return { drift: { x: reach * unit, seconds, phase }, shift: Math.floor(reach / 2) };
}

/** The scene's snap step for `--snap`: one device pixel, in CSS pixels. */
export function snapStyle(dpr: number): Record<string, string> {
  return { "--snap": `${1 / (dpr > 0 ? dpr : 1)}px` };
}
