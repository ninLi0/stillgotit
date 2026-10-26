import { readonly, ref } from "vue";

// The learner's appearance (design/visual-design.md, "Dark mode"): System, Light or Dark. The choice belongs to this
// browser, not to the account. It lives in localStorage under THEME_KEY, because whether a dark page suits the
// learner depends on the device and the room it is in, and System already follows each device's own setting.
// With System chosen, <html> carries no data-theme, and the prefers-color-scheme rules in style.css follow the device.
// Light and Dark set data-theme, which wins over the device. An inline script in index.html applies a saved choice
// before the first paint, so a reload never flashes the other theme; this module keeps the page in step afterwards and
// tells the scenes which theme is showing, so they can draw by day or by night.

export type ThemeChoice = "system" | "light" | "dark";
export type Theme = "light" | "dark";

export const THEME_KEY = "stillgotit.theme";
/** The page's ground in each theme, for the browser's own toolbar (meta theme-color). index.html repeats them. */
export const GROUNDS: Record<Theme, string> = { light: "#FFFFFF", dark: "#121311" };

type Store = Pick<Storage, "getItem" | "setItem">;
type Query = { matches: boolean; addEventListener(type: "change", listener: () => void): void; removeEventListener(type: "change", listener: () => void): void };
type Attributes = { setAttribute(name: string, value: string): void; removeAttribute(name: string): void };
/** Where the theme reads and writes: storage, the device's dark-mode query, <html>, and the theme-color meta tag. */
export type ThemeEnv = { storage?: Store | null; query?: Query | null; root?: Attributes | null; toolbar?: Pick<Attributes, "setAttribute"> | null };

/** The saved choice, or System when nothing valid is saved or storage cannot be read. */
export function readChoice(storage: Store | null | undefined): ThemeChoice {
  try {
    const saved = storage?.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch { return "system"; }
}

/** Light and Dark are themselves; System follows the device, and a device that does not say counts as light. */
export function resolveTheme(choice: ThemeChoice, deviceDark: boolean): Theme {
  return choice === "system" ? (deviceDark ? "dark" : "light") : choice;
}

export function createTheme(env: ThemeEnv) {
  const choice = ref<ThemeChoice>(readChoice(env.storage));
  const theme = ref<Theme>(resolveTheme(choice.value, !!env.query?.matches));
  let listening = false;
  const follow = () => { theme.value = resolveTheme(choice.value, !!env.query?.matches); };
  function apply() {
    follow();
    if (choice.value === "system") env.root?.removeAttribute("data-theme"); else env.root?.setAttribute("data-theme", choice.value);
    env.toolbar?.setAttribute("content", GROUNDS[theme.value]);
    // The device's setting matters only while System is chosen, so the page listens to it only then.
    const want = choice.value === "system" && !!env.query;
    if (want && !listening) env.query!.addEventListener("change", onDevice);
    if (!want && listening) env.query!.removeEventListener("change", onDevice);
    listening = want;
  }
  function onDevice() { follow(); env.toolbar?.setAttribute("content", GROUNDS[theme.value]); }
  /** Applies a choice at once and saves it in this browser. If storage is blocked, the choice lasts until reload. */
  function choose(next: ThemeChoice) {
    choice.value = next;
    try { env.storage?.setItem(THEME_KEY, next); } catch { /* The choice still applies on this page. */ }
    apply();
  }
  /** Reads the saved choice again, after another tab of the app changed it. */
  function reload() { choice.value = readChoice(env.storage); apply(); }
  function dispose() { if (listening) env.query?.removeEventListener("change", onDevice); listening = false; }
  apply();
  return { choice: readonly(choice), theme: readonly(theme), choose, reload, dispose };
}

function browserEnv(): ThemeEnv {
  if (typeof window === "undefined" || typeof document === "undefined") return {};
  let storage: Store | null = null;
  try { storage = window.localStorage; } catch { /* Blocked storage: System applies. */ }
  return {
    storage, query: window.matchMedia?.("(prefers-color-scheme: dark)") ?? null, root: document.documentElement,
    toolbar: document.querySelector('meta[name="theme-color"]'),
  };
}

const appTheme = createTheme(browserEnv());
if (typeof window !== "undefined") window.addEventListener("storage", (event) => { if (event.key === THEME_KEY || event.key === null) appTheme.reload(); });

/** The learner's choice for this browser. */
export const themeChoice = appTheme.choice;
/** The theme on the page now, which changes when the choice or, under System, the device changes. Scenes watch it. */
export const currentTheme = appTheme.theme;
/** The theme on the page now, for code that draws: "light" by day, "dark" by night. */
export function resolvedTheme(): Theme { return appTheme.theme.value; }
export function chooseTheme(next: ThemeChoice) { appTheme.choose(next); }
