import { describe, expect, test } from "bun:test";
import { Generating, GenerationFailed } from "../src/concepts/Generating/Generating.ts";

// Generating keeps no state, so these tests need no database. Each test supplies a fake provider.
const message = "The tutor could not finish. Check your connection and retry. Your saved work is still available.";

async function refusesGeneration(action: Promise<unknown>) {
  await expect(action).rejects.toBeInstanceOf(GenerationFailed);
  await expect(action).rejects.toMatchObject({ code: "GENERATION_FAILED", message });
}

interface Request { kind: string; prompt: string }
interface Answer { text: string }

describe("Generating", () => {
  test("returns the provider's answer for the owner's request, and a retry calls the provider again", async () => {
    const calls: [string, Request][] = [];
    const generating = new Generating<string, Request, Answer>(async (owner, request) => {
      calls.push([owner, request]);
      return { text: `Answer ${calls.length} for ${owner}` };
    });
    const request = { kind: "LESSON", prompt: "Explain why AB and BA differ." };

    expect(await generating.generate({ owner: "sam", request })).toEqual({ answer: { text: "Answer 1 for sam" } });
    // A retry repeats the external work and can return a different answer.
    expect(await generating.generate({ owner: "sam", request })).toEqual({ answer: { text: "Answer 2 for sam" } });
    expect(await generating.generate({ owner: "leo", request })).toEqual({ answer: { text: "Answer 3 for leo" } });
    expect(calls).toEqual([["sam", request], ["sam", request], ["leo", request]]);
  });

  test("refuses with GENERATION_FAILED when the provider fails, rejects invalid content, or is missing", async () => {
    // Like the real provider, this fake throws when the service fails or its answer is incomplete.
    const generating = new Generating<string, Request, Answer>(async (_owner, request) => {
      if (request.kind === "OFFLINE") throw new Error("The provider timed out.");
      const text = request.kind === "BLANK" ? " " : `Answer to: ${request.prompt}`;
      if (!text.trim()) throw new Error("Incomplete content");
      return { text };
    });
    const prompt = "Grade the saved work.";
    await refusesGeneration(generating.generate({ owner: "sam", request: { kind: "OFFLINE", prompt } }));
    await refusesGeneration(generating.generate({ owner: "sam", request: { kind: "BLANK", prompt } }));
    // A failed call leaves nothing behind, so the next call can succeed.
    expect(await generating.generate({ owner: "sam", request: { kind: "GRADE", prompt } })).toEqual({ answer: { text: `Answer to: ${prompt}` } });

    const request = { kind: "GRADE", prompt };
    await refusesGeneration(new Generating<string, Request, Answer>(() => Promise.reject("offline")).generate({ owner: "sam", request }));
    await refusesGeneration(new Generating<string, Request, Answer>(() => { throw new Error("Not configured."); }).generate({ owner: "sam", request }));
    await refusesGeneration(new Generating<string, Request, Answer>().generate({ owner: "sam", request }));
  });
});
