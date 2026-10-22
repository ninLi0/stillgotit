import { spyOn } from "bun:test";
import { Collection, type Document, type Filter } from "mongodb";

export async function withOverlappingSkillReads<T>(
  database: string,
  skills: string[],
  run: () => Promise<T>,
): Promise<T> {
  const original = Collection.prototype.findOne;
  const seen = new Set<string>();
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(() => ready.reject(new Error("Both first skill reads must arrive.")), 5_000);
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const record = await original.call(this, filter, options);
      const id = String(filter._id);
      if (this.dbName === database && this.collectionName === "SkillMapping.skills"
        && (filter.status === "CONFIRMED" || filter.status === "ARCHIVED")
        && skills.includes(id) && !seen.has(id)) {
        // Keep real MongoDB reads and writes. Pause the first reads so both
        // requests read their skills before either one edits anything.
        seen.add(id);
        if (seen.size === skills.length) ready.resolve();
        await ready.promise;
      }
      return record as T | null;
    },
  );
  try {
    return await run();
  } finally {
    clearTimeout(timeout);
    read.mockRestore();
  }
}
