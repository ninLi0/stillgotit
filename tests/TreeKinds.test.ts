import { describe, expect, test } from "bun:test";
import { TREE_KINDS, TREE_KIND_IDS, defaultKind, findKind, kindFor, surpriseKind } from "../frontend/src/tree-kinds.ts";
import { growTree } from "../frontend/src/tree-draw.ts";
import { GROUND, growGrove, type GroveTopic } from "../frontend/src/GroveScene.ts";
import { layoutForest } from "../frontend/src/ForestScene.ts";
import { PAL, rng } from "../frontend/src/pixel-art.ts";
import type { ViewUnit } from "../frontend/src/revamp-types.ts";
import { TREE_KINDS as OFFERED_KINDS, treeKindOffered } from "../src/computations/tree-kinds.ts";

// Unit ids are UUIDs (SkillMapping). These are made from a seeded generator, so the test reads the same each run.
function uuids(count: number, seed = 7): string[] {
  const random = rng(seed), hex = () => Math.floor(random() * 16).toString(16);
  return Array.from({ length: count }, () => [8, 4, 4, 4, 12].map((n) => Array.from({ length: n }, hex).join("")).join("-"));
}
function topic(id: string, kind: string, skills: number): GroveTopic {
  return { id, title: "Topic", kind, skills: Array.from({ length: skills }, (_, i) => ({ skill: `${id}-${i}`, title: `Skill ${i + 1}`, mastery: (i * 37) % 100, due: i === 1 })) };
}
/** The smallest distance, across or up and down, between two leaves' centres. */
function closest(leaves: readonly { x: number; y: number }[]): number {
  let least = Infinity;
  for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
    least = Math.min(least, Math.max(Math.abs(leaves[i]!.x - leaves[j]!.x), Math.abs(leaves[i]!.y - leaves[j]!.y)));
  }
  return least;
}

describe("The catalogue of tree kinds", () => {
  test("offers at least ten kinds, each with its own id, name and one-sentence description", () => {
    expect(TREE_KINDS.length).toBeGreaterThanOrEqual(10);
    expect(new Set(TREE_KIND_IDS).size).toBe(TREE_KINDS.length);
    expect(new Set(TREE_KINDS.map((kind) => kind.name)).size).toBe(TREE_KINDS.length);
    for (const kind of TREE_KINDS) {
      expect(kind.id).toMatch(/^[a-z]+$/);
      expect(kind.name.length).toBeGreaterThan(0);
      expect(kind.description).toMatch(/^[A-Z][^.]*\.$/);
    }
  });

  test("lists exactly the kinds the server accepts, in the same order", () => {
    // The server saves only the kinds it offers (design/compositions/Courses.md, "Choosing a topic's tree"), so a kind
    // the page draws but the server refuses could never be saved, and a kind the server saves but the page lacks would
    // be drawn as the default.
    expect(TREE_KIND_IDS).toEqual([...OFFERED_KINDS]);
    for (const id of TREE_KIND_IDS) expect(treeKindOffered({ kind: id })).toBe(true);
  });

  test("a unit's default kind depends only on its id, and the defaults spread evenly across the catalogue", () => {
    const ids = uuids(6000), counts = new Map<string, number>();
    for (const id of ids) {
      expect(defaultKind(id)).toBe(defaultKind(id));
      counts.set(defaultKind(id).id, (counts.get(defaultKind(id).id) ?? 0) + 1);
    }
    const even = ids.length / TREE_KINDS.length;
    for (const kind of TREE_KINDS) {
      expect(counts.get(kind.id) ?? 0).toBeGreaterThan(even * 0.85);
      expect(counts.get(kind.id) ?? 0).toBeLessThan(even * 1.15);
    }
  });

  test("a chosen kind applies when the catalogue has it, and the unit's default applies otherwise", () => {
    const [unit] = uuids(1);
    expect(kindFor(unit!, "willow").id).toBe("willow");
    expect(kindFor(unit!, null)).toBe(defaultKind(unit!));
    expect(kindFor(unit!, "redwood")).toBe(defaultKind(unit!));
    expect(findKind("redwood")).toBeUndefined();
  });

  test("Surprise me never repeats the current kind and can reach every other kind", () => {
    for (const current of TREE_KINDS) {
      const reached = new Set<string>();
      for (let i = 0; i < 400; i++) reached.add(surpriseKind(current.id, () => i / 400).id);
      expect(reached.has(current.id)).toBe(false);
      expect(reached.size).toBe(TREE_KINDS.length - 1);
      expect(surpriseKind(current.id, () => 0.999999).id).not.toBe(current.id);
    }
  });
});

describe("Drawing each kind", () => {
  test("every kind grows a tip for every leaf and bud the grove asks for, up to a full tree of 60 skills", () => {
    for (const kind of TREE_KINDS) for (const skills of [1, 2, 5, 12, 25, 40, 60]) {
      const spare = skills + 2 + Math.floor(skills / 3);
      const tree = growTree(kind, `${kind.id}-${skills}`, 1, spare, Math.max(44, Math.min(170, 26 + spare * 5.5)), Math.min(GROUND - 14, 44 + spare * 4));
      expect(tree.tips.length).toBeGreaterThanOrEqual(spare);
    }
  });

  test("in the grove, every kind keeps one to twelve leaves apart and inside the scene", () => {
    for (const kind of TREE_KINDS) for (const id of uuids(3, 11)) for (let skills = 1; skills <= 12; skills++) for (const design of [1, 2, 3]) {
      const grove = growGrove([topic(id, kind.id, skills)], design, () => 20);
      const [tree] = grove.trees;
      expect(tree!.kind.id).toBe(kind.id);
      expect(tree!.leaves.length).toBe(skills);
      // Two leaf sprites (7 cells across) may touch at their edges but never cover each other.
      expect(closest(tree!.leaves)).toBeGreaterThanOrEqual(4);
      for (const leaf of tree!.leaves) {
        expect(leaf.y - 3).toBeGreaterThanOrEqual(0);
        expect(leaf.y).toBeLessThan(GROUND);
        expect(leaf.x - 3).toBeGreaterThanOrEqual(tree!.x0);
        expect(leaf.x + 3).toBeLessThanOrEqual(tree!.x0 + tree!.w);
      }
      for (const part of tree!.crown) {
        const top = part.shape === "cone" ? part.top : part.shape === "frond" ? Math.min(part.y1, part.y2) : part.shape === "blob" ? part.y - part.r : part.shape === "oval" ? part.y - part.ry : part.y;
        expect(top).toBeGreaterThanOrEqual(0);
      }
    }
  });

  test("in the Forest view, every skill of every kind gets its own leaf", () => {
    for (const kind of TREE_KINDS) for (let skills = 1; skills <= 12; skills++) {
      const units: ViewUnit[] = uuids(3, skills).map((unit, i) => ({ unit, title: `Topic ${i + 1}`, kind: kind.id,
        skills: Array.from({ length: skills }, (_, j) => ({ skill: `${unit}-${j}`, title: "Skill", outcome: "", mastery: null, dueToday: false })) }));
      for (const tree of layoutForest(units, 1, 1100, 640, 5).trees) {
        expect(tree.kind.id).toBe(kind.id);
        expect(new Set(tree.leaves.map((leaf) => leaf.skill.skill)).size).toBe(skills);
      }
    }
  });

  test("the leaf sprites stand out from every crown color behind them", () => {
    // CIE76 color difference in Lab space; about 2.3 is the smallest difference people notice.
    const lab = (hex: string) => {
      const value = Number.parseInt(hex.slice(1), 16);
      const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }) as [number, number, number];
      const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
      const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047), y = f(r * 0.2126 + g * 0.7152 + b * 0.0722), z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
      return [116 * y - 16, 500 * (x - y), 200 * (y - z)] as const;
    };
    const difference = (a: string, b: string) => { const p = lab(a), q = lab(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
    for (const kind of TREE_KINDS) {
      // A kind with a pocket paints a small green patch behind each leaf, so the leaf sits on the pocket's colors.
      const behind = kind.crown.pocket ?? kind.crown;
      const colors = [behind.base, behind.light, behind.speckle, behind.shadow, ...(behind.accent ? [behind.accent] : [])];
      for (const color of colors) {
        expect(difference(PAL.G!, color)).toBeGreaterThan(20); // the green of the sprout, leaf, full leaf and blossom
        expect(difference(PAL.Y!, color)).toBeGreaterThan(40); // the yellow of the bud
        expect(difference(PAL.R!, color)).toBeGreaterThan(40); // the coral of the due flag and the blossoms
      }
    }
  });
});
