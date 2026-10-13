/** Short-lived coordination for the single Bun process used by P2. */
export class KeyedLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const released = Promise.withResolvers<void>();
    const tail = previous.then(() => released.promise);
    this.tails.set(key, tail);
    await previous;
    try {
      return await work();
    } finally {
      released.resolve();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
