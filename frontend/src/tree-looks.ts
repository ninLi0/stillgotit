// The tree kind the learner chose for each topic (design/visual-design.md, "Tree kinds"). The server keeps the
// choices as TreeStyling (design/compositions/Courses.md, "Choosing a topic's tree"): each course read brings the
// saved kinds, and a choice is sent at once. While a choice is on its way, both scenes already draw it; when the server
// refuses it or cannot be reached, they go back to the saved kind. A unit with no saved kind grows its default kind.
import { reactive } from "vue";
import { api, failureText } from "./api.ts";
import { findKind } from "./tree-kinds.ts";

/** The two look endpoints. Each answers the server's result, or an object with `error` when it did not save. */
export type LookServer = { choose(unit: string, kind: string): Promise<object>; clear(unit: string): Promise<object> };
/** The part of the browser's local storage that the carry-over reads. Reading it may throw when storage is blocked. */
export type KeptChoices = () => Pick<Storage, "getItem" | "removeItem">;

// Before the server kept the choices, this browser kept each one under its own key.
const LEGACY = "stillgotit.tree.";

/** The page's tree looks, kept against a server and a local storage. The page uses the one instance below; tests make their own. */
export function createTreeLooks(server: LookServer, kept: KeptChoices) {
  // The saved kind of each unit the page has read, and the kind of each unit whose choice is still on its way (null
  // while a clear is on its way). Both are reactive, so the grove and the forest redraw when either changes.
  const saved = reactive(new Map<string, string>());
  const sending = reactive(new Map<string, string | null>());
  // The latest choice sent for each unit, and the latest choice whose save the page has applied. An answer to an
  // earlier choice does not undo a later one, even when it arrives after the later one's answer.
  const latest = new Map<string, number>();
  const applied = new Map<string, number>();
  const carrying = new Set<string>();
  let turns = 0;

  function apply(unit: string, turn: number, kind: string | null) {
    if ((applied.get(unit) ?? 0) > turn) return;
    applied.set(unit, turn);
    if (kind) saved.set(unit, kind);
    else saved.delete(unit);
  }

  async function send(unit: string, kind: string | null): Promise<object> {
    try { return kind ? await server.choose(unit, kind) : await server.clear(unit); }
    catch { return { error: "NETWORK_ERROR" }; }
  }

  /** The kind id chosen for a unit, or null when it has none, so it grows its default kind. An id the catalogue lacks counts as none. */
  function chosenKind(unit: string): string | null {
    const id = sending.has(unit) ? sending.get(unit) ?? null : saved.get(unit) ?? null;
    return findKind(id) ? id : null;
  }

  /**
   * Saves a kind for a unit, or clears the saved kind with null, so the unit grows its default kind again. Answers null
   * once the server has saved it, or the sentence to show when it did not. A failed choice that a later choice for the
   * same unit has replaced answers null too, because the later choice is the one the learner sees.
   */
  async function chooseKind(unit: string, kind: string | null): Promise<string | null> {
    const turn = ++turns;
    latest.set(unit, turn);
    sending.set(unit, kind);
    const result = await send(unit, kind);
    const current = latest.get(unit) === turn;
    if (current) sending.delete(unit);
    if ("error" in result) return current ? failureText(result as { error: unknown; detail?: unknown }) : null;
    apply(unit, turn, kind);
    return null;
  }

  // A kept key is sent once when the server has no kind for its unit, and forgotten when the server saves it or refuses
  // it, or already has a kind of its own, which is the later choice. A request that does not reach the server, or that
  // finds the session ended, keeps the key for the next course read.
  async function carryOver(units: readonly string[]): Promise<void> {
    await Promise.all(units.map(async (unit) => {
      let kind: string | null;
      try { kind = kept().getItem(LEGACY + unit); } catch { return; }
      if (kind === null || carrying.has(unit)) return;
      const forget = () => { try { kept().removeItem(LEGACY + unit); } catch { /* The key stays until storage works again. */ } };
      if (saved.has(unit) || sending.has(unit) || !findKind(kind)) { forget(); return; }
      carrying.add(unit);
      const turn = ++turns;
      try {
        const result = await send(unit, kind) as { error?: unknown };
        if (!("error" in result)) {
          // A choice the learner made meanwhile stays on screen.
          if (!sending.has(unit)) apply(unit, turn, kind);
          forget();
        } else if (result.error === "INVALID_REQUEST" || result.error === "FORBIDDEN") forget();
      } finally {
        carrying.delete(unit);
      }
    }));
  }

  /**
   * Takes the saved kinds from a course read: `units` are every unit of the course, and `looks` the rows of those with a
   * saved kind. Then it carries over any choice this browser kept before the server kept them. The promise settles
   * when the carry-over is done; the page does not wait for it.
   */
  function receiveLooks(units: readonly string[], looks: readonly { unit: string; kind: string }[]): Promise<void> {
    for (const unit of units) saved.delete(unit);
    for (const { unit, kind } of looks) saved.set(unit, kind);
    return carryOver(units);
  }

  return { chosenKind, chooseKind, receiveLooks };
}

const looks = createTreeLooks({
  choose: (unit, kind) => api.courses.units.look({ unit, kind }),
  clear: (unit) => api.courses.units.look.clear({ unit }),
}, () => localStorage);
export const { chosenKind, chooseKind, receiveLooks } = looks;
