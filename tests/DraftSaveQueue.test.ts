import { describe, expect, test } from "bun:test";
import { DraftSaveQueue } from "../frontend/src/draft-save-queue.ts";
import type { Material } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";

const draft = { unit: "unit", material: "source" as Material, title: "Multiply matrices", outcome: "Compute products", gate: "Explain two fresh products" };
function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("Browser draft save recovery", () => {
  test("reload retries only unacknowledged drafts with the same keys and frozen details", async () => {
    const saved = storage(), queue = new DraftSaveQueue(saved, "course-a"), editable = { ...draft };
    queue.start([editable, { ...draft, title: "Check dimensions" }]);
    const initial = queue.read(), calls: typeof initial = [];
    editable.title = "Changed after saving started";
    await expect(queue.drain(async (input) => {
      calls.push(input);
      if (calls.length === 2) throw new Error("Reply lost after server commit");
    })).rejects.toThrow("Reply lost");
    expect(calls).toEqual(initial);
    expect(queue.read()).toEqual([initial[1]!]);
    const reloaded = new DraftSaveQueue(saved, "course-a");
    await reloaded.drain(async (input) => { calls.push(input); });
    expect(calls[2]).toEqual(initial[1]);
    expect(reloaded.read()).toEqual([]);
  });

  test("an interrupted acknowledgment cannot lose the request key", async () => {
    const saved = storage(), queue = new DraftSaveQueue(saved, "course");
    queue.start([draft]); const initial = queue.read();
    const normalRemove = saved.removeItem;
    saved.removeItem = () => { throw new Error("Storage temporarily unavailable"); };
    await expect(queue.drain(async () => {})).rejects.toThrow("browser could not save draft progress");
    expect(queue.read()).toEqual(initial);
    saved.removeItem = normalRemove;
    const attempts: typeof initial = [];
    await queue.drain(async (input) => { attempts.push(input); });
    expect(attempts).toEqual(initial);
    expect(queue.read()).toEqual([]);
  });

  test("incomplete input or unavailable storage cannot start an untracked save", () => {
    const saved = storage(), queue = new DraftSaveQueue(saved, "course");
    expect(() => queue.start([{ ...draft, gate: " " }])).toThrow("fill in every skill");
    expect(queue.read()).toEqual([]);
    saved.setItem = () => { throw new Error("Storage unavailable"); };
    expect(() => queue.start([draft])).toThrow("browser could not save draft progress");
    expect(queue.read()).toEqual([]);
  });

  test("pending saves cannot be overwritten and another course has a separate queue", () => {
    const saved = storage(), first = new DraftSaveQueue(saved, "first"), second = new DraftSaveQueue(saved, "second");
    first.start([draft]); const initial = first.read();
    expect(() => first.start([{ ...draft, title: "Replace it" }])).toThrow("Finish the pending");
    expect(first.read()).toEqual(initial);
    expect(second.read()).toEqual([]);
    second.start([draft]);
    expect(second.read()[0]!.proposalKey).not.toBe(initial[0]!.proposalKey);
  });
});
