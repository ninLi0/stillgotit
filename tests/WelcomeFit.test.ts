import { expect, test } from "bun:test";
import { CELL } from "../frontend/src/GroveScene.ts";
import { WELCOME_MARGIN, WELCOME_SCALE, fitGrove } from "../frontend/src/welcome-fit.ts";

// The sign-in page's sample grove must fit its panel at every width: drawn at half size when there is room, otherwise
// shrunk as a whole, and never cut off at either side. Panels run from 258 px (a 320 px phone) to well past the widest
// two-column layout; the groves are narrower than, about as wide as, and wider than the sample grove (260 cells).

/** The grove's left and right edges in the panel, in CSS pixels, as WelcomeScene.vue draws it. */
function edges(panel: number, cells: number) {
  const fit = fitGrove(panel, cells), unit = CELL * fit.scale;
  return { ...fit, unit, left: fit.shift * unit, right: (fit.shift + cells) * unit };
}

test("a grove that fits at half size is drawn at half size, in the middle of the panel", () => {
  const fit = edges(694, 260);
  expect(fit.scale).toBe(WELCOME_SCALE);
  expect(fit.columns).toBe(347);
  expect(fit.shift).toBe(43);
  expect(fit.left).toBe(86);
  expect(694 - fit.right).toBe(88);
});

test("a grove too wide for the panel is shrunk until it fits with the margin on both sides", () => {
  const fit = edges(313, 260);
  expect(fit.scale).toBeLessThan(WELCOME_SCALE);
  expect(260 * fit.unit).toBeCloseTo(313 - 2 * WELCOME_MARGIN, 9);
  expect(fit.left).toBeGreaterThanOrEqual(WELCOME_MARGIN - fit.unit);
  expect(313 - fit.right).toBeGreaterThanOrEqual(WELCOME_MARGIN - fit.unit);
});

test("at every panel width the whole grove is shown, with its margin, and centred to within a cell", () => {
  for (const cells of [120, 200, 260, 300, 420]) {
    for (let panel = 258; panel <= 1400; panel++) {
      const fit = edges(panel, cells);
      expect(fit.scale).toBeGreaterThan(0);
      expect(fit.scale).toBeLessThanOrEqual(WELCOME_SCALE);
      // The cells span the whole panel, the last one at most cut by its edge, so the sky and ground reach both sides.
      expect(fit.columns * fit.unit).toBeGreaterThanOrEqual(panel - 1e-9);
      expect((fit.columns - 1) * fit.unit).toBeLessThan(panel);
      // Nothing of the grove is cropped, and it keeps the margin, give or take the half cell lost to whole-cell centring.
      expect(fit.left).toBeGreaterThanOrEqual(WELCOME_MARGIN - fit.unit / 2 - 1e-9);
      expect(panel - fit.right).toBeGreaterThanOrEqual(WELCOME_MARGIN - fit.unit / 2 - 1e-9);
      expect(Math.abs(fit.left - (panel - fit.right))).toBeLessThan(fit.unit + 1e-9);
      // Half size is kept whenever it fits; a smaller scale is used only when it must be.
      if (cells * CELL * WELCOME_SCALE + 2 * WELCOME_MARGIN <= panel) expect(fit.scale).toBe(WELCOME_SCALE);
      else expect(cells * fit.unit).toBeCloseTo(panel - 2 * WELCOME_MARGIN, 9);
    }
  }
});

test("a grove's scale grows with its panel until it reaches half size", () => {
  let last = 0;
  for (let panel = 258; panel <= 1400; panel += 7) {
    const { scale } = fitGrove(panel, 260);
    expect(scale).toBeGreaterThanOrEqual(last);
    last = scale;
  }
  expect(last).toBe(WELCOME_SCALE);
});
