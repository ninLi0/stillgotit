import type { StoreCall } from "./file-store.ts";
import { Refusal } from "./refusal.ts";

/** The upload route answers within 85 seconds, under Cloudflare's 100-second limit. */
export const UPLOAD_BUDGET_MS = 85_000;
export const QUEUE_WAIT_MS = 20_000;
export const STORE_WRITE_MS = 30_000;
export const UPLOAD_BUSY = "Another upload is being saved. Try again in a minute.";
export const UPLOAD_TIMEOUT = "Saving this upload took too long. Try again in a minute, or upload fewer files at a time. The app continues from what it already saved.";

export class UploadBusy extends Refusal { constructor() { super(UPLOAD_BUSY, "UPLOAD_BUSY", 429); } }
export class UploadTimeout extends Refusal { constructor() { super(UPLOAD_TIMEOUT, "UPLOAD_TIMEOUT", 400); } }

/**
 * The process-wide upload queue: one upload is read and saved at a time, and at most one more waits.
 * A waiting upload gives up after `waitMs`.
 */
export class UploadQueue {
  #active = false;
  #waiting: { grant: () => void } | null = null;

  constructor(private readonly waitMs = QUEUE_WAIT_MS) {}

  /** Resolves with this upload's release function once it is its turn. Releasing twice has no effect. */
  enter(): Promise<() => void> {
    if (!this.#active) { this.#active = true; return Promise.resolve(this.#release()); }
    if (this.#waiting) return Promise.reject(new UploadBusy());
    return new Promise((resolve, reject) => {
      const entry = { grant: () => { clearTimeout(timer); resolve(this.#release()); } };
      const timer = setTimeout(() => { if (this.#waiting === entry) this.#waiting = null; reject(new UploadBusy()); }, this.waitMs);
      this.#waiting = entry;
    });
  }

  #release(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#waiting;
      this.#waiting = null;
      if (next) next.grant(); else this.#active = false;
    };
  }
}

/** The upload route's time budget. Work that outlives it is not awaited by the answer. */
export class Budget {
  readonly #controller = new AbortController();
  readonly #deadline: number;
  readonly #timer: ReturnType<typeof setTimeout>;
  /** Resolves when the budget runs out. It never resolves after `dispose`. */
  readonly expiry: Promise<void>;

  constructor(milliseconds = UPLOAD_BUDGET_MS, private readonly storeLimit = STORE_WRITE_MS) {
    this.#deadline = performance.now() + milliseconds;
    let expire!: () => void;
    this.expiry = new Promise((resolve) => { expire = resolve; });
    this.#timer = setTimeout(() => { this.#controller.abort(new UploadTimeout()); expire(); }, milliseconds);
  }

  get signal(): AbortSignal { return this.#controller.signal; }
  get expired(): boolean { return this.#controller.signal.aborted; }
  remaining(): number { return Math.max(0, this.#deadline - performance.now()); }

  /** Fails with UPLOAD_TIMEOUT once the budget runs out. The work itself may still finish later. */
  async within<T>(work: Promise<T>): Promise<T> {
    work.catch(() => undefined);
    if (this.expired) throw new UploadTimeout();
    return Promise.race([work, this.expiry.then((): never => { throw new UploadTimeout(); })]);
  }

  /** One store write's limit: 30 seconds, and never past the budget. */
  storeCall(): StoreCall {
    const remaining = this.remaining();
    if (this.expired || remaining <= 0) throw new UploadTimeout();
    return { timeout: Math.min(this.storeLimit, remaining) };
  }

  dispose() { clearTimeout(this.#timer); }
}
