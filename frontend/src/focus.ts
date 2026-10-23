/** Where keyboard focus was when an action started. Background loads start with no focused control. */
export function focusedControl(): HTMLElement | SVGElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body || active instanceof SVGElement ? active : null;
}

/** Focuses the element and reports whether focus landed there. Hidden or disabled elements refuse focus. */
function tryFocus(element: HTMLElement | SVGElement | null | undefined): boolean {
  if (!element?.isConnected || (element as HTMLButtonElement).disabled) return false;
  element.focus();
  return document.activeElement === element;
}

/**
 * Keeps keyboard focus after an action. Controls are disabled while the app works, and some disappear when it
 * finishes, so focus can fall back to the page. This returns it to the control the learner used, or to the
 * fallback (usually the message that reports the result) when that control is gone.
 */
export function restoreFocus(previous: HTMLElement | SVGElement | null, fallback?: () => HTMLElement | null | undefined) {
  if (!previous) return;
  const active = document.activeElement;
  // The learner, or a view change, moved focus somewhere else while the app worked.
  if (active && active !== document.body && active !== previous && active.getClientRects().length) return;
  if (!tryFocus(previous)) tryFocus(fallback?.());
}
