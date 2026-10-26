import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PAL, WHALE } from "../frontend/src/pixel-art.ts";
import { GROVE_NIGHT_SKY, MOON, MOONLIT, STARS, WELCOME_NIGHT_SKY, dayOrNight, leafColor, sceneColor, towardNight } from "../frontend/src/scene-palette.ts";
import { chooseTheme } from "../frontend/src/theme.ts";

// The scenes draw every color through scene-palette.ts. By day nothing may change; by night every color needs a night
// color, the general rule keeps light and dark in order, and the leaves stay readable on the night crowns.

const SCENES = ["HomeScene.vue", "PlanSea.vue", "WelcomeScene.vue", "GroveScene.ts", "ForestScene.ts", "ForestView.vue", "scene-motion.ts"];
/** Every color the scenes name in their own code, plus the pixel palette and the whale they draw from. */
const DAY = [...new Set([
  ...SCENES.flatMap((file) => readFileSync(new URL(`../frontend/src/${file}`, import.meta.url), "utf8").match(/#[0-9A-Fa-f]{6}\b/g) ?? []),
  ...Object.values(PAL), ...WHALE.map((run) => run[4]),
].map((color) => color.toUpperCase()))];

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16), lin = (v: number) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const contrast = (a: string, b: string) => { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

afterAll(() => chooseTheme("system"));

test("by day every scene color is drawn exactly as written", () => {
  chooseTheme("light");
  expect(DAY.length).toBeGreaterThan(80);
  for (const color of DAY) {
    expect(sceneColor(color)).toBe(color);
    expect(leafColor(color)).toBe(color);
  }
  expect(dayOrNight("#F3CD7A", MOON.face)).toBe("#F3CD7A");
});

test("by night every scene color has a night color", () => {
  chooseTheme("dark");
  for (const color of DAY) expect(sceneColor(color)).toMatch(/^#[0-9A-F]{6}$/);
  expect(dayOrNight("#F3CD7A", MOON.face)).toBe(MOON.face);
});

test("the colors chosen for the night are never also day colors, so a night color is never changed a second time", () => {
  const chosen = [...Object.values(MOON), ...Object.values(STARS), MOONLIT, ...WELCOME_NIGHT_SKY, ...GROVE_NIGHT_SKY];
  chooseTheme("dark");
  for (const color of DAY) {
    const night = sceneColor(color);
    if (night !== color) chosen.push(night);
  }
  for (const leaf of ["#2F8A5F", "#256F4C", "#6DB892"]) chosen.push(leafColor(leaf));
  const clashes = chosen.filter((color) => DAY.includes(color.toUpperCase()) && sceneColor(color) !== color);
  expect(clashes).toEqual([]);
});

test("the general night rule keeps every pair of colors in the same order from light to dark", () => {
  const colors = DAY.filter((color) => color !== "#000000");
  for (const a of colors) for (const b of colors) {
    if (luminance(a) < luminance(b) - 0.02) expect(luminance(towardNight(a))).toBeLessThanOrEqual(luminance(towardNight(b)) + 0.002);
  }
});

test("lights and markers stay lit by night", () => {
  chooseTheme("dark");
  for (const light of ["#E3A233", "#F3CD7A", "#F6E7B6", "#D9663A", "#EE9C78"]) expect(sceneColor(light)).toBe(light);
});

test("by night the leaves still stand out from the crowns behind them", () => {
  chooseTheme("dark");
  const crowns = ["#A9D4B9", "#8CC3A1", "#9CCDB0", "#BFE0CC", "#A6D4B6", "#7DBB95", "#93C9A8", "#C4E4CF"].map(sceneColor);
  for (const crown of crowns) {
    expect(contrast(leafColor("#2F8A5F"), crown)).toBeGreaterThanOrEqual(2.5);
    expect(contrast(leafColor("#6DB892"), crown)).toBeGreaterThanOrEqual(4);
    expect(contrast(leafColor("#E3A233"), crown)).toBeGreaterThanOrEqual(3.5);
    // The selected leaf's brackets.
    expect(contrast(sceneColor("#151515"), crown)).toBeGreaterThanOrEqual(7);
  }
  // Within a leaf, the shade stays darker than the leaf and the highlight lighter, as by day.
  expect(luminance(leafColor("#256F4C"))).toBeLessThan(luminance(leafColor("#2F8A5F")));
  expect(luminance(leafColor("#2F8A5F"))).toBeLessThan(luminance(leafColor("#6DB892")));
});

test("by night each sky is darkest at the top", () => {
  chooseTheme("dark");
  const skies = [
    ["#CFE6F0", "#D7EBF2", "#E0EFF3", "#E9F3F1", "#F3F4E6"], ["#D3EAF4", "#DCEFF6", "#E6F4F7", "#F0F7F3"], ["#CFE3EE", "#D7E8F1", "#DEECF3", "#E5F0F5"],
    ["#B9D8E8", "#C3DEEC", "#CDE4EF", "#D7E9F1", "#E0EEF2", "#EAF2EE", "#F3F1DF"],
  ];
  for (const sky of skies) {
    const night = sky.map(sceneColor);
    for (let i = 1; i < night.length; i++) expect(luminance(night[i]!)).toBeGreaterThan(luminance(night[i - 1]!));
  }
  for (let i = 1; i < WELCOME_NIGHT_SKY.length; i++) expect(luminance(WELCOME_NIGHT_SKY[i]!)).toBeLessThan(luminance(WELCOME_NIGHT_SKY[i - 1]!));
  expect<string>(WELCOME_NIGHT_SKY[0]).toBe(GROVE_NIGHT_SKY[0]!);
  expect(contrast(MOON.face, sceneColor("#B9D8E8"))).toBeGreaterThan(10);
});
