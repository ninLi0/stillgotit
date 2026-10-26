// The tree kind the learner chose for each topic (design/visual-design.md, "Tree kinds"). The choice is kept in this
// browser's localStorage under one key per unit, and the grove on Home and the Forest view both read it here, so a
// choice made in one scene shows in the other at once. A unit with no saved choice grows its default kind.
import { ref } from "vue";
import { findKind } from "./tree-kinds.ts";

const PREFIX = "stillgotit.tree.";
// Choices made while the page is open. They still apply when the browser refuses to store them.
const memory = new Map<string, string | null>();
// Bumped on every change, so a computed that read a choice reads it again.
const version = ref(0);

/** The kind id chosen for a unit, or null when none is saved or the saved id is not in the catalogue. */
export function chosenKind(unit: string): string | null {
  void version.value;
  let id = memory.get(unit);
  if (id === undefined) {
    try { id = localStorage.getItem(PREFIX + unit); } catch { id = null; }
  }
  return findKind(id) ? id! : null;
}

/** Saves a kind for a unit. Null clears the choice, so the unit grows its default kind again. */
export function chooseKind(unit: string, kind: string | null): void {
  memory.set(unit, kind);
  try {
    if (kind) localStorage.setItem(PREFIX + unit, kind);
    else localStorage.removeItem(PREFIX + unit);
  } catch { /* The choice applies until the page reloads. */ }
  version.value++;
}

// A choice made in another tab of this browser shows here as well.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (event) => {
    if (event.key !== null && !event.key.startsWith(PREFIX)) return;
    memory.clear();
    version.value++;
  });
}
