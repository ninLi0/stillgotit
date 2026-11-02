import { CELL } from "./GroveScene.ts";

// The sign-in page's sample grove (WelcomeScene.vue) is drawn at half the size of the grove on Home. A phone's panel,
// or the narrow column beside the text on a laptop, is narrower than the whole grove at that size, so the grove is
// then drawn smaller, as a whole, instead of being cut off at both sides.

/** The sample grove's scale when the panel has room for it: half the size of the grove on Home. */
export const WELCOME_SCALE = 0.5;
/** The least room, in CSS pixels, kept on each side of the sample grove. */
export const WELCOME_MARGIN = 8;

/**
 * How a grove `cells` cells wide fits a panel `panel` CSS pixels wide. `scale` is half size when that leaves the margin
 * on both sides, and otherwise the largest scale that does, so the grove is never cropped. `columns` is how many cells
 * of that size span the panel, the last one possibly cut by the panel's edge, and `shift` is how many whole cells the
 * grove moves right to stand in the middle of them (as the grove on Home does when it is narrower than its card).
 */
export function fitGrove(panel: number, cells: number): { scale: number; columns: number; shift: number } {
  const scale = Math.min(WELCOME_SCALE, Math.max(1, panel - 2 * WELCOME_MARGIN) / (Math.max(1, cells) * CELL));
  const columns = Math.ceil(panel / (CELL * scale));
  return { scale, columns, shift: Math.max(0, Math.floor((columns - cells) / 2)) };
}
