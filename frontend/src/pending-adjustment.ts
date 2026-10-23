import type { StillGotItHttp } from "../../generated/wire.ts";

export type AdjustmentInput = Omit<StillGotItHttp["/learning/adjust"]["input"], "session">;
type AdjustmentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The tab's session storage, or null when the browser blocks it. */
export function sessionStore(): AdjustmentStorage | null {
  try { return window.sessionStorage; } catch { return null; }
}

function storageKey(skill: string) { return `stillgotit-adjustment:${skill}`; }

/**
 * One manual adjustment of a skill's estimate that has not been answered yet. Like the draft save queue, it keeps
 * the key and input in session storage until the answer arrives, so a retry, even after a reload, sends the same
 * key and input and never adds a second adjustment. A changed value or reason is a new adjustment with a new key.
 */
export class PendingAdjustment {
  constructor(private readonly storage: AdjustmentStorage | null, private readonly skill: string) {}

  /** The unanswered adjustment for this skill, or null. */
  read(): AdjustmentInput | null {
    let text: string | null;
    try { text = this.storage?.getItem(storageKey(this.skill)) ?? null; } catch { return null; }
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      if (value !== null && typeof value === "object") {
        const item = value as Record<string, unknown>;
        if (item.skill === this.skill && typeof item.adjustmentKey === "string" && item.adjustmentKey.trim() &&
          typeof item.value === "number" && Number.isFinite(item.value) && typeof item.reason === "string") {
          return { skill: this.skill, adjustmentKey: item.adjustmentKey, value: item.value, reason: item.reason };
        }
      }
    } catch { /* Only this module writes the entry. An unreadable entry cannot be retried, so it is ignored. */ }
    return null;
  }

  /** The request to send: the unanswered one when the value and reason are unchanged, otherwise a new one. */
  prepare(value: number, reason: string): AdjustmentInput {
    const waiting = this.read();
    if (waiting && waiting.value === value && waiting.reason === reason) return waiting;
    const input: AdjustmentInput = { skill: this.skill, adjustmentKey: crypto.randomUUID(), value, reason };
    try {
      if (!this.storage) throw new Error("No session storage.");
      this.storage.setItem(storageKey(this.skill), JSON.stringify(input));
    } catch {
      throw new Error("The browser could not keep this adjustment for a safe retry. Keep this tab open and try again when browser storage is available.");
    }
    return input;
  }

  /** Forget the adjustment once its answer arrives. A newer adjustment saved in the meantime is kept. */
  finish(adjustmentKey: string) {
    if (this.read()?.adjustmentKey !== adjustmentKey) return;
    try { this.storage?.removeItem(storageKey(this.skill)); } catch { /* The next read finds the same answered key; a retry adds nothing. */ }
  }
}
