/**
 * The tree kinds a learner can choose for a topic. The browser draws each one (frontend/src/tree-kinds.ts); the server
 * only checks that a chosen kind is one of these ids, in the same order. The list is fixed in code, so it cannot change
 * while the server runs.
 */
export const TREE_KINDS = Object.freeze(["oak", "pine", "birch", "willow", "maple", "cherry", "palm", "cypress", "baobab", "spruce", "jacaranda", "bonsai"] as const);

/** The id of one offered tree kind. */
export type TreeKind = (typeof TREE_KINDS)[number];

/** Holds when kind is exactly one of the offered tree kinds, including case. */
export function treeKindOffered({ kind }: { kind: string }): boolean {
  return (TREE_KINDS as readonly string[]).includes(kind);
}

/** Names an offered tree kind. Flows use it only after treeKindOffered holds. */
export function offeredTreeKind({ kind }: { kind: string }): TreeKind {
  if (!treeKindOffered({ kind })) throw new Error("offeredTreeKind requires an offered tree kind.");
  return kind as TreeKind;
}
