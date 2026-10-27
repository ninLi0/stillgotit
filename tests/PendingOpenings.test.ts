import { describe, expect, test } from "bun:test";
import { pendingOpening, trackOpening } from "../frontend/src/pending-openings.ts";

// A new lesson is saved with the learner's request, and the page then asks for its opening explanation. While the
// opening is on its way, a study page made again for the same skill finds it here and waits for the same answer.

function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Lesson openings on their way", () => {
  test("an opening is found by its skill until its answer arrives, and every page that waits gets the same answer", async () => {
    const answer = deferred<{ tutor: string }>(), before = Date.now();
    const asked = trackOpening("skill-a", "lesson-1", "Why does the order matter?", () => answer.promise);
    const waiting = pendingOpening("skill-a");
    expect(waiting).toMatchObject({ lesson: "lesson-1", request: "Why does the order matter?" });
    expect(waiting!.since).toBeGreaterThanOrEqual(before);
    expect(pendingOpening("skill-b")).toBeUndefined();
    answer.resolve({ tutor: "gemini-3.8-flash" });
    expect(await asked).toEqual({ tutor: "gemini-3.8-flash" });
    expect(await waiting!.done).toEqual({ tutor: "gemini-3.8-flash" });
    expect(pendingOpening("skill-a")).toBeUndefined();
  });

  test("a failed opening is forgotten too, and an older opening that settles late leaves a newer one in place", async () => {
    const failed = deferred<never>(), newer = deferred<string>();
    const first = trackOpening("skill-a", "lesson-1", "First request", () => failed.promise);
    const second = trackOpening("skill-a", "lesson-2", "Second request", () => newer.promise);
    failed.reject(new Error("The tutor could not produce a usable answer."));
    await expect(first).rejects.toThrow("usable answer");
    expect(pendingOpening("skill-a")?.lesson).toBe("lesson-2");
    newer.resolve("saved");
    await second;
    expect(pendingOpening("skill-a")).toBeUndefined();
  });
});
