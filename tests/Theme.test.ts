import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createTheme, GROUNDS, readChoice, resolveTheme, THEME_KEY, type ThemeChoice } from "../frontend/src/theme.ts";

// The theme follows the device unless the learner picks Light or Dark in Settings, and that pick lives in the browser.
// These tests stand in for the browser with a fake storage, a fake dark-mode query, <html> and the theme-color tag.

function fakeStorage(saved?: string, failing = false) {
  const items = new Map<string, string>(saved === undefined ? [] : [[THEME_KEY, saved]]);
  return {
    items,
    getItem(key: string) { if (failing) throw new Error("Storage is blocked."); return items.get(key) ?? null; },
    setItem(key: string, value: string) { if (failing) throw new Error("Storage is blocked."); items.set(key, value); },
  };
}

function fakeQuery(matches: boolean) {
  const listeners = new Set<() => void>();
  return {
    matches, listeners,
    addEventListener(_type: "change", listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: "change", listener: () => void) { listeners.delete(listener); },
    /** The device switches between light and dark. */
    flip(next: boolean) { this.matches = next; for (const listener of listeners) listener(); },
  };
}

function fakeRoot() {
  const attributes = new Map<string, string>();
  return { attributes, setAttribute(name: string, value: string) { attributes.set(name, value); }, removeAttribute(name: string) { attributes.delete(name); } };
}

function fakeToolbar() {
  return { content: "#ffffff", setAttribute(_name: string, value: string) { this.content = value; } };
}

function setup(saved: string | undefined, deviceDark: boolean, failing = false) {
  const storage = fakeStorage(saved, failing), query = fakeQuery(deviceDark), root = fakeRoot(), toolbar = fakeToolbar();
  return { storage, query, root, toolbar, theme: createTheme({ storage, query, root, toolbar }) };
}

test("a saved choice is read back, and anything else counts as System", () => {
  expect(readChoice(fakeStorage("light"))).toBe("light");
  expect(readChoice(fakeStorage("dark"))).toBe("dark");
  expect(readChoice(fakeStorage("system"))).toBe("system");
  expect(readChoice(fakeStorage())).toBe("system");
  expect(readChoice(fakeStorage("sepia"))).toBe("system");
  expect(readChoice(fakeStorage("dark", true))).toBe("system");
  expect(readChoice(null)).toBe("system");
});

test("Light and Dark win over the device, and System follows it", () => {
  for (const deviceDark of [false, true]) {
    expect(resolveTheme("light", deviceDark)).toBe("light");
    expect(resolveTheme("dark", deviceDark)).toBe("dark");
  }
  expect(resolveTheme("system", true)).toBe("dark");
  expect(resolveTheme("system", false)).toBe("light");
});

test("with nothing saved, the page follows the device and keeps listening to it", () => {
  const { query, root, toolbar, theme } = setup(undefined, true);
  expect(theme.choice.value).toBe("system");
  expect(theme.theme.value).toBe("dark");
  // System leaves data-theme off, so the prefers-color-scheme rules in style.css decide.
  expect(root.attributes.has("data-theme")).toBe(false);
  expect(toolbar.content).toBe(GROUNDS.dark);
  expect(query.listeners.size).toBe(1);
  query.flip(false);
  expect(theme.theme.value).toBe("light");
  expect(toolbar.content).toBe(GROUNDS.light);
  expect(root.attributes.has("data-theme")).toBe(false);
});

test("choosing Light or Dark applies at once, is saved, and stops following the device", () => {
  const { storage, query, root, toolbar, theme } = setup(undefined, true);
  theme.choose("light");
  expect(theme.theme.value).toBe("light");
  expect(root.attributes.get("data-theme")).toBe("light");
  expect(storage.items.get(THEME_KEY)).toBe("light");
  expect(toolbar.content).toBe(GROUNDS.light);
  expect(query.listeners.size).toBe(0);
  query.flip(false);
  query.flip(true);
  expect(theme.theme.value).toBe("light");

  theme.choose("dark");
  expect(theme.theme.value).toBe("dark");
  expect(root.attributes.get("data-theme")).toBe("dark");
  expect(storage.items.get(THEME_KEY)).toBe("dark");
  expect(toolbar.content).toBe(GROUNDS.dark);
});

test("choosing System again removes data-theme and listens to the device once", () => {
  const { storage, query, root, theme } = setup("dark", false);
  expect(theme.theme.value).toBe("dark");
  expect(root.attributes.get("data-theme")).toBe("dark");
  expect(query.listeners.size).toBe(0);
  theme.choose("system");
  theme.choose("system");
  expect(storage.items.get(THEME_KEY)).toBe("system");
  expect(root.attributes.has("data-theme")).toBe(false);
  expect(theme.theme.value).toBe("light");
  expect(query.listeners.size).toBe(1);
  query.flip(true);
  expect(theme.theme.value).toBe("dark");
});

test("a saved choice applies when the page starts", () => {
  for (const [saved, deviceDark, expected] of [["light", true, "light"], ["dark", false, "dark"], ["system", true, "dark"]] as const) {
    const { root, toolbar, theme } = setup(saved, deviceDark);
    expect(theme.theme.value).toBe(expected);
    expect(root.attributes.get("data-theme")).toBe(saved === "system" ? undefined : saved);
    expect(toolbar.content).toBe(GROUNDS[expected]);
  }
});

test("blocked storage still lets a choice apply on the page", () => {
  const { root, theme } = setup(undefined, false, true);
  expect(theme.choice.value).toBe("system");
  theme.choose("dark");
  expect(theme.choice.value).toBe("dark");
  expect(theme.theme.value).toBe("dark");
  expect(root.attributes.get("data-theme")).toBe("dark");
});

test("a choice made in another tab is picked up on reload, and dispose stops listening", () => {
  const { storage, query, root, theme } = setup(undefined, false);
  storage.items.set(THEME_KEY, "dark");
  theme.reload();
  expect(theme.choice.value).toBe("dark");
  expect(root.attributes.get("data-theme")).toBe("dark");
  storage.items.set(THEME_KEY, "system");
  theme.reload();
  expect(query.listeners.size).toBe(1);
  theme.dispose();
  expect(query.listeners.size).toBe(0);
});

test("a browser without a dark-mode query counts as light under System", () => {
  const root = fakeRoot(), theme = createTheme({ storage: fakeStorage(), query: null, root, toolbar: null });
  expect(theme.theme.value).toBe("light");
  theme.choose("dark");
  expect(theme.theme.value).toBe("dark");
  theme.choose("system");
  expect(theme.theme.value).toBe("light");
});

// The dark palette is written twice in style.css: once for the Dark choice and once for a dark device with no choice.
const css = readFileSync(new URL("../frontend/src/style.css", import.meta.url), "utf8");
/** The declarations inside the first block that follows `opening`, one per entry, comments removed. */
function declarations(opening: string): Map<string, string> {
  const start = css.indexOf(opening);
  expect(start).toBeGreaterThanOrEqual(0);
  const open = start + opening.length, close = css.indexOf("}", open);
  const body = css.slice(open, close).replace(/\/\*[\s\S]*?\*\//g, "");
  const out = new Map<string, string>();
  for (const part of body.split(";")) {
    const at = part.indexOf(":");
    if (at > 0) out.set(part.slice(0, at).trim(), part.slice(at + 1).trim());
  }
  return out;
}

test("the dark palette for the Dark choice and for a dark device are the same", () => {
  const chosen = declarations(':root[data-theme="dark"] {');
  const device = declarations(':root:not([data-theme="light"]) {');
  expect(chosen.size).toBeGreaterThan(50);
  expect([...device]).toEqual([...chosen]);
});

test("every color the dark palette sets also has a light value", () => {
  const light = declarations(":root {");
  const missing = [...declarations(':root[data-theme="dark"] {').keys()].filter((name) => name.startsWith("--") && !light.has(name));
  expect(missing).toEqual([]);
});

// The inline script in index.html runs before the first paint, so it must reach the same answer as theme.ts.
const html = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const inline = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";

function runInline(saved: string | null, deviceDark: boolean, blocked = false) {
  const root = fakeRoot(), toolbar = fakeToolbar();
  const localStorage = { getItem: (key: string) => { if (blocked) throw new Error("Storage is blocked."); return key === THEME_KEY ? saved : null; } };
  const window = { matchMedia: (query: string) => ({ matches: query === "(prefers-color-scheme: dark)" && deviceDark }) };
  const document = { documentElement: root, querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? toolbar : null) };
  new Function("localStorage", "window", "document", inline)(localStorage, window, document);
  return { theme: root.attributes.get("data-theme") ?? null, toolbar: toolbar.content };
}

test("the script in index.html applies a saved choice before the app starts, as theme.ts would", () => {
  expect(inline).toContain(`"${THEME_KEY}"`);
  const cases: [string | null, boolean, boolean][] = [["dark", false, false], ["light", true, false], ["system", true, false], [null, false, false], [null, true, false], ["sepia", true, false], ["dark", true, true]];
  for (const [saved, deviceDark, blocked] of cases) {
    const choice: ThemeChoice = blocked ? "system" : readChoice(fakeStorage(saved ?? undefined));
    const expected = resolveTheme(choice, deviceDark);
    expect(runInline(saved, deviceDark, blocked)).toEqual({ theme: choice === "system" ? null : choice, toolbar: GROUNDS[expected] });
  }
});
