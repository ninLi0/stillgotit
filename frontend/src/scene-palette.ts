import { currentTheme } from "./theme.ts";

// The pixel scenes by day and by night (design/visual-design.md, "Dark mode"). Each scene keeps its daytime colors in
// its own code and paints every one through sceneColor, which returns it unchanged in the light theme and its night
// color in the dark theme. Because sceneColor reads the theme, a Vue computed or template that builds sprites with it
// follows the theme by itself; the canvases watch currentTheme and draw again.
//
// Night keeps each scene's hue relationships. Skies run from dusk at the horizon to night above, seas and land keep
// their order from light to dark, and lights (the lamp, its beams, flags) stay lit. Most land colors come from one rule
// (towardNight); the colors that rule would get wrong are listed in NIGHT. The leaves are information, so they have
// their own colors (LEAVES), bright enough to read against the dark crowns.

/** Night colors chosen by hand, for day colors that the general rule would get wrong. */
const NIGHT: Record<string, string> = {
  // Skies: Home, Plan, the grove, and the Forest view, from the top band down to the horizon.
  "#CFE6F0": "#151D37", "#D7EBF2": "#1A223E", "#E0EFF3": "#202945", "#E9F3F1": "#29304C", "#F3F4E6": "#363852",
  "#D3EAF4": "#151D37", "#DCEFF6": "#1B243F", "#E6F4F7": "#232C48", "#F0F7F3": "#2F3551",
  "#CFE3EE": "#1D2643", "#D7E8F1": "#222B48", "#DEECF3": "#29314D", "#E5F0F5": "#313852",
  "#B9D8E8": "#111930", "#C3DEEC": "#141C35", "#CDE4EF": "#18203B", "#D7E9F1": "#1D2541", "#E0EEF2": "#232B47", "#EAF2EE": "#2B324C", "#F3F1DF": "#393A52",
  // Clouds, lit faintly by the moon, and the sea's bands, glints and wake, darker with depth as by day.
  "#FFFFFF": "#3E4864", "#EEF5F9": "#333D58", "#EEF6F9": "#333D58",
  "#9BD7EC": "#2A4D69", "#80CBE6": "#24445F", "#66BEDF": "#1F3C56", "#4FAFD6": "#1A344D", "#3A9CC8": "#152C44", "#2D88B6": "#11253B",
  "#D6F0F8": "#4D7090", "#BDE6F4": "#3D5E7C",
  // The whale stays a little lighter than the night sea, so it can still be seen crossing it.
  "#2F7D9B": "#3F7F9E", "#2A6B85": "#336E89", "#63A7C1": "#5F98B3", "#EAF3F7": "#8EA3B5", "#12333F": "#0C1A24", "#E3F4FA": "#7D93A8",
  // Snow on the Forest view's far mountains catches the moonlight.
  "#E5EEF2": "#5D6884",
  // Poles and masts turn pale so they still show against the night.
  "#48555C": "#8F9CA3",
  // The leaf brackets: the selected leaf's turns from ink to pale, and the hovered one's stays a step dimmer.
  "#151515": "#F2EFE4", "#6F6F6C": "#A9A79E", "#5F5F5C": "#A9A79E",
  // The Forest view's other topics fade toward the night sky instead of toward white.
  "#9CC6AD": "#233635", "#D3E7DA": "#2B3D3F", "#B4D6C1": "#27393A", "#C0DECB": "#283B3B", "#C9A877": "#3A3530",
  // The chosen topic's mound keeps its warm glow.
  "#E3C46A": "#B89A4C",
};
/** Lights and markers, which keep their day colors at night: the sun-yellows of lamps, beams, buds and mast tips,
 * and the coral and lilac of flags, buoys, stripes and flowers. */
const LIT = new Set(["#E3A233", "#F3CD7A", "#F6E7B6", "#F9E3A8", "#D9663A", "#B5502B", "#EE9C78", "#9A8EE6"]);
/** The leaf sprites' greens at night. The yellows and corals of buds and blooms keep their day colors. */
const LEAVES: Record<string, string> = { "#2F8A5F": "#3E9C6C", "#256F4C": "#2F7F57", "#6DB892": "#7CC59D" };

/** The moon, drawn where the sun is by day: a soft glow, a pale face with a shaded rim, and a few craters. */
export const MOON = { glow: "#2A3456", face: "#F1EDDA", rim: "#D4CFB7", crater: "#C2BCA2" } as const;
/** Stars: a few bright ones and more faint ones. */
export const STARS = { bright: "#F4F1DE", faint: "#8D93B0" } as const;
/** Moonlit white, for the sails, stripes and buoys that are white by day and must still show at sea. */
export const MOONLIT = "#C3CCD9";

export function isNight(): boolean { return currentTheme.value === "dark"; }

/** `day` in the light theme and `night` in the dark one. */
export function dayOrNight(day: string, night: string): string { return isNight() ? night : day; }

const chosen = new Set([...Object.values(NIGHT), ...Object.values(LEAVES), ...Object.values(MOON), ...Object.values(STARS), MOONLIT]);
const cache = new Map<string, string>();

/** A scene color as the current theme shows it. Night colors chosen here pass through unchanged, so a scene can mix
 * sceneColor with dayOrNight and leafColor. */
export function sceneColor(day: string): string {
  if (!isNight()) return day;
  const key = day.toUpperCase();
  if (LIT.has(key) || chosen.has(key)) return day;
  let out = NIGHT[key] ?? cache.get(key);
  if (!out) { out = towardNight(key); cache.set(key, out); }
  return out;
}

/** A leaf sprite's color as the current theme shows it. */
export function leafColor(day: string): string {
  if (!isNight()) return day;
  return LEAVES[day.toUpperCase()] ?? day;
}

/**
 * The general night rule, in OKLab: lightness is compressed into a dim range so that every color keeps its place
 * between lighter and darker ones, chroma drops by almost half, and a slight blue is added for moonlight. Any
 * color a scene adds later gets a night color from this rule without being listed.
 */
export function towardNight(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16), [L, a, b] = toOklab([n >> 16, (n >> 8) & 255, n & 255]);
  return fromOklab([0.15 + 0.29 * L, a * 0.55, b * 0.55 - 0.008]);
}

/**
 * Scatters a few stars over the open sky of a scene that has already been drawn. Each star lands on a whole cell and
 * only where that cell still shows one of the night sky's bands, so stars never cover the moon, a cloud, a tree or the
 * land. `cell` is one cell's size in device pixels; the stars stay put, so the scene keeps them until it draws again.
 */
export function scatterStars(ctx: CanvasRenderingContext2D, cell: number, columns: number, rows: number, seed: number) {
  if (!isNight() || columns < 1 || rows < 1) return;
  let state = seed >>> 0;
  const random = () => { state = (state + 0x6D2B79F5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const width = ctx.canvas.width, height = ctx.canvas.height;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // About one star for every 12,000 square CSS pixels of the area given, most of them faint.
  const ratio = (typeof window === "undefined" ? 1 : window.devicePixelRatio) || 1;
  const count = Math.max(5, Math.round((columns * cell / ratio) * (rows * cell / ratio) / 12000));
  for (let i = 0; i < count; i++) {
    const x = Math.floor(random() * columns), y = Math.floor(random() * rows), bright = random() < 0.25;
    const left = Math.round(x * cell), top = Math.round(y * cell), w = Math.round((x + 1) * cell) - left, h = Math.round((y + 1) * cell) - top;
    if (left + w > width || top + h > height || w < 1 || h < 1) continue;
    const [r, g, b] = ctx.getImageData(left + (w >> 1), top + (h >> 1), 1, 1).data;
    if (!SKIES.has(((r! << 16) | (g! << 8) | b!) >>> 0)) continue;
    ctx.fillStyle = bright ? STARS.bright : STARS.faint;
    ctx.fillRect(left, top, w, h);
  }
  ctx.restore();
}
/** Every night sky band, as 24-bit numbers, so scatterStars can tell open sky from what is drawn over it. */
const SKIES = new Set([
  "#CFE6F0", "#D7EBF2", "#E0EFF3", "#E9F3F1", "#F3F4E6", "#D3EAF4", "#DCEFF6", "#E6F4F7", "#F0F7F3", "#CFE3EE", "#D7E8F1", "#DEECF3", "#E5F0F5",
  "#B9D8E8", "#C3DEEC", "#CDE4EF", "#D7E9F1", "#E0EEF2", "#EAF2EE", "#F3F1DF",
].map((day) => parseInt(NIGHT[day]!.slice(1), 16)));
/** The sign-in grove's sky above the trees, darkest at the top, from the band nearest the grove upward. */
export const WELCOME_NIGHT_SKY = ["#1D2643", "#1A2240", "#171F3B", "#151C37", "#131A33"] as const;
/** The grove's own four sky bands by night, from the top down, so the sign-in page can carry them past the grove's edges. */
export const GROVE_NIGHT_SKY = ["#CFE3EE", "#D7E8F1", "#DEECF3", "#E5F0F5"].map((day) => NIGHT[day]!);
for (const band of WELCOME_NIGHT_SKY) SKIES.add(parseInt(band.slice(1), 16));

function toOklab([R, G, B]: number[]): [number, number, number] {
  const lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const r = lin(R!), g = lin(G!), b = lin(B!);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function fromOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const channel = (v: number) => { const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, c)) * 255).toString(16).padStart(2, "0"); };
  return `#${channel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${channel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${channel(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`.toUpperCase();
}
