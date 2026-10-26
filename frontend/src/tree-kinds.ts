// The tree kinds a topic can grow (design/visual-design.md, "Tree kinds"). Each kind has an id, a name, a one-line
// description, and the parameters that tree-draw.ts uses to grow and paint it. The kind is decoration: the leaves on
// the tree are the information, so every kind keeps them readable. Crowns stay pale tints of the palette's families
// (meadow greens for most kinds, sand and coral for the maple, coral for the cherry, dawn for the jacaranda, the ocean
// side of the greens for the willow and the spruce), and the leaf sprites keep their own colors on top of them.
import { hash } from "./pixel-art.ts";

/** A range [lowest, highest] that a seeded tree picks a value from, so two trees of one kind still differ. */
export type Range = readonly [number, number];

/**
 * A tree that branches from its trunk again and again, with a leaf at each branch tip. `trunk` is the trunk's length
 * as a share of 22 cells before scaling, `thickness` its width in cells, `spread` the angle between sibling branches,
 * `decay` how much shorter each level is, `fork3` the chance of a three-way fork, `lean` how far the trunk leans,
 * `droop` how far outer branches bend down, `clamp` the widest angle from upright a branch may take, and `bend` an
 * S-bend in the trunk. The crown is `round` blobs, flat `pad`s, or a `willow`'s blobs with hanging strands.
 */
export type BranchShape = {
  form: "branch"; trunk: Range; thickness: number; spread: Range; decay: Range; fork3: Range; lean: Range; droop: Range;
  clamp: number; bend?: number; crown: "round" | "pad" | "willow";
  /** Blob radius at the tips (or half a pad's width), and at the forks, in cells before the scene's bulk. `fill` is how
   * many levels of forks below the tips carry a blob: more levels make a fuller crown. */
  tipRadius: Range; forkRadius: number; fill?: number;
  /** A pad's half-height, and a willow strand's length, in cells. */
  padHeight?: Range; strand?: Range;
};
/** A trunk with tiers of branches: one smooth `cone` for a pine, stacked `layers` for a spruce. `widen` is how much
 * each tier's half-width grows, and `bare` is the trunk below the lowest tier. */
export type ConiferShape = { form: "conifer"; tiers: "cone" | "layers"; widen: Range; bare: Range; thickness: number };
/** A tall bare trunk with fronds radiating from its top. */
export type PalmShape = { form: "palm"; height: Range; lean: Range; thickness: number };
/** A narrow column of foliage around a hidden central stem. */
export type ColumnShape = { form: "column"; bare: Range; thickness: number };
export type TreeShape = BranchShape | ConiferShape | PalmShape | ColumnShape;

/** The crown's colors: the shadow on its lower side, its base, a scattered speckle, the light on its upper left, and an
 * optional accent scattered at `accentRate`, such as a cherry's blossoms. A crown whose colors would hide a leaf's
 * stage (the yellow bud on a warm maple, a sprout on a palm frond) gives each leaf a small `pocket` of green behind it. */
export type CrownColors = { shadow: string; base: string; speckle: string; light: string; accent?: string; accentRate?: number;
  pocket?: Omit<CrownColors, "pocket"> };
/** The bark: its main color, the shaded right edge, the thin twigs, optional dark marks (birch), and rings (palm). */
export type BarkColors = { main: string; shade: string; twig: string; mark?: string; rings?: boolean };

export type TreeKind = { id: string; name: string; description: string; shape: TreeShape; crown: CrownColors; bark: BarkColors };

const BROWN: BarkColors = { main: "#C08324", shade: "#9C6A1F", twig: "#A8742A" };
const MEADOW: CrownColors = { shadow: "#8CC3A1", base: "#A9D4B9", speckle: "#9CCDB0", light: "#BFE0CC" };

/** The catalogue, in the order the picker shows it. */
export const TREE_KINDS: readonly TreeKind[] = Object.freeze([
  { id: "oak", name: "Oak", description: "A thick trunk under a broad, round crown.",
    shape: { form: "branch", trunk: [0.75, 0.9], thickness: 5, spread: [0.7, 0.85], decay: [0.64, 0.7], fork3: [0.35, 0.6], lean: [0, 0.08], droop: [0.05, 0.15],
      clamp: 1.45, crown: "round", tipRadius: [5, 6], forkRadius: 5, fill: 2 },
    crown: MEADOW, bark: BROWN },
  { id: "pine", name: "Pine", description: "A tall, narrow cone of needles on a short trunk.",
    shape: { form: "conifer", tiers: "cone", widen: [1.5, 1.8], bare: [7, 9], thickness: 3 },
    crown: { shadow: "#7FB497", base: "#97C2A6", speckle: "#8BBB9E", light: "#B4D6C1" },
    bark: { main: "#A8742A", shade: "#8A6A3A", twig: "#8A6A3A" } },
  { id: "birch", name: "Birch", description: "A slim white trunk with a light, airy crown.",
    shape: { form: "branch", trunk: [1.2, 1.4], thickness: 3, spread: [0.5, 0.62], decay: [0.68, 0.74], fork3: [0.2, 0.4], lean: [0, 0.08], droop: [0.18, 0.3],
      clamp: 1.5, crown: "round", tipRadius: [4, 5], forkRadius: 3 },
    crown: { shadow: "#A9D4B9", base: "#C6EAD1", speckle: "#B7DFC5", light: "#E7F6EC" },
    bark: { main: "#F5F5F3", shade: "#CBD5DA", twig: "#8E9BA2", mark: "#48555C" } },
  { id: "willow", name: "Willow", description: "A soft crown with long strands that hang down.",
    shape: { form: "branch", trunk: [0.75, 0.9], thickness: 4, spread: [0.8, 1.0], decay: [0.7, 0.76], fork3: [0.3, 0.5], lean: [0, 0.12], droop: [0.35, 0.55],
      clamp: 1.9, crown: "willow", tipRadius: [4, 5], forkRadius: 4, fill: 2, strand: [8, 13] },
    crown: { shadow: "#86BFA9", base: "#A3D2C2", speckle: "#93C8B5", light: "#C3E3D8" },
    bark: { main: "#A8742A", shade: "#8A6A3A", twig: "#A8742A" } },
  { id: "maple", name: "Maple", description: "A wide crown in warm autumn colors.",
    shape: { form: "branch", trunk: [0.6, 0.72], thickness: 4, spread: [0.95, 1.1], decay: [0.64, 0.7], fork3: [0.45, 0.75], lean: [0, 0.08], droop: [0.05, 0.12],
      clamp: 1.5, crown: "round", tipRadius: [5, 6], forkRadius: 5, fill: 2 },
    crown: { shadow: "#E8A27A", base: "#F2BD8E", speckle: "#F5C98E", light: "#FADFB5", accent: "#D9663A", accentRate: 0.05, pocket: MEADOW },
    bark: BROWN },
  { id: "cherry", name: "Cherry", description: "A small tree covered in pink blossoms.",
    shape: { form: "branch", trunk: [0.55, 0.7], thickness: 4, spread: [0.75, 0.95], decay: [0.68, 0.74], fork3: [0.3, 0.5], lean: [0.04, 0.14], droop: [0, 0.08],
      clamp: 1.4, crown: "round", tipRadius: [5, 6], forkRadius: 4, fill: 2 },
    crown: { shadow: "#EDBCB0", base: "#F8D9CF", speckle: "#F2C4B6", light: "#FDF0EB", accent: "#FFFFFF", accentRate: 0.1, pocket: MEADOW },
    bark: { main: "#9C6A1F", shade: "#7A4A12", twig: "#A8742A" } },
  { id: "palm", name: "Palm", description: "A tall bare trunk with fronds at the top.",
    shape: { form: "palm", height: [34, 42], lean: [0.1, 0.22], thickness: 3 },
    crown: { shadow: "#6AA988", base: "#9CCDB0", speckle: "#8CC3A1", light: "#BFE0CC", pocket: MEADOW },
    bark: { main: "#CDB884", shade: "#A8742A", twig: "#A8742A", rings: true } },
  { id: "cypress", name: "Cypress", description: "A narrow green column that points up.",
    shape: { form: "column", bare: [4, 6], thickness: 3 },
    crown: { shadow: "#7DB596", base: "#97C9A9", speckle: "#8BC1A0", light: "#B4DBC2" },
    bark: BROWN },
  { id: "baobab", name: "Baobab", description: "A very thick trunk under a flat crown.",
    shape: { form: "branch", trunk: [0.55, 0.7], thickness: 8, spread: [1.05, 1.3], decay: [0.6, 0.68], fork3: [0.5, 0.8], lean: [0, 0.04], droop: [0, 0],
      clamp: 1.3, crown: "pad", tipRadius: [6, 8], forkRadius: 0, padHeight: [2, 3] },
    crown: MEADOW, bark: { main: "#CDB884", shade: "#A8742A", twig: "#B59A62" } },
  { id: "spruce", name: "Spruce", description: "Layered tiers that widen toward the ground.",
    shape: { form: "conifer", tiers: "layers", widen: [2.3, 2.7], bare: [4, 6], thickness: 3 },
    crown: { shadow: "#7AAEA5", base: "#96C4BC", speckle: "#88B9B1", light: "#B5D8D2" },
    bark: { main: "#A8742A", shade: "#8A6A3A", twig: "#8A6A3A" } },
  { id: "jacaranda", name: "Jacaranda", description: "A wide, spreading crown of lavender blossoms.",
    shape: { form: "branch", trunk: [0.7, 0.85], thickness: 4, spread: [0.85, 1.0], decay: [0.72, 0.78], fork3: [0.25, 0.45], lean: [0, 0.06], droop: [0, 0.04],
      clamp: 1.6, crown: "round", tipRadius: [5, 6], forkRadius: 4, fill: 2 },
    crown: { shadow: "#C7C0F7", base: "#DEDAFF", speckle: "#D2CCF9", light: "#EEEBFF", accent: "#B9B0F5", accentRate: 0.08, pocket: MEADOW },
    bark: { main: "#A8742A", shade: "#8A6A3A", twig: "#8A6A3A" } },
  { id: "bonsai", name: "Bonsai", description: "A short, bent trunk with flat pads of leaves.",
    shape: { form: "branch", trunk: [0.7, 0.85], thickness: 5, bend: 0.42, spread: [1.0, 1.2], decay: [0.62, 0.7], fork3: [0.2, 0.4], lean: [0, 0.08], droop: [0, 0],
      clamp: 1.35, crown: "pad", tipRadius: [5, 6], forkRadius: 0, padHeight: [2, 3] },
    crown: { shadow: "#7DB596", base: "#97C9A9", speckle: "#8BC1A0", light: "#B4DBC2" },
    bark: { main: "#9C6A1F", shade: "#7A4A12", twig: "#9C6A1F" } },
] satisfies TreeKind[]);

/** The ids of every kind, in catalogue order. */
export const TREE_KIND_IDS: readonly string[] = Object.freeze(TREE_KINDS.map((kind) => kind.id));

/** The kind with this id, or undefined for an id the catalogue does not have (or none). */
export function findKind(id: string | null | undefined): TreeKind | undefined {
  return id ? TREE_KINDS.find((kind) => kind.id === id) : undefined;
}

/**
 * The kind a topic grows when nobody has chosen one: picked from the unit's id alone, so it never changes when the
 * course changes, and spread evenly across the catalogue, so a course shows a mix of trees from the start.
 */
export function defaultKind(unit: string): TreeKind {
  return TREE_KINDS[hash(`${unit}:tree`) % TREE_KINDS.length]!;
}

/** The chosen kind when it is in the catalogue, otherwise the unit's default. */
export function kindFor(unit: string, chosen?: string | null): TreeKind {
  return findKind(chosen) ?? defaultKind(unit);
}

/** A kind picked at random from all but the current one, for "Surprise me". `random` returns a number in [0, 1). */
export function surpriseKind(current: string, random: () => number = Math.random): TreeKind {
  const others = TREE_KINDS.filter((kind) => kind.id !== current);
  return others[Math.min(others.length - 1, Math.floor(random() * others.length))]!;
}
