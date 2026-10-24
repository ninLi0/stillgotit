/** Short-lived coordination for the single Bun process used by P2. */
export class KeyedLocks {
  private readonly tails = new Map<string, Promise<void>>();

  /**
   * Runs `work` once every earlier holder of `key` has finished. When `signal` aborts before this caller's
   * turn, the caller stops waiting, `work` never runs, and later callers still wait for the earlier holders.
   */
  async run<T>(key: string, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const released = Promise.withResolvers<void>();
    const tail = previous.then(() => released.promise);
    this.tails.set(key, tail);
    // The entry is removed only after this caller's turn has passed, so no later caller can skip a holder.
    const forget = () => { if (this.tails.get(key) === tail) this.tails.delete(key); };
    try {
      if (signal) {
        const stop = Promise.withResolvers<never>();
        const abort = () => stop.reject(signal.reason ?? new Error("The wait for a lock was stopped."));
        if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
        stop.promise.catch(() => undefined);
        try { await Promise.race([previous, stop.promise]); }
        finally { signal.removeEventListener("abort", abort); }
      } else await previous;
      return await work();
    } finally {
      released.resolve();
      void tail.then(forget);
    }
  }
}
