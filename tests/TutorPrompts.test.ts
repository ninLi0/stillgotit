import { describe, expect, test } from "bun:test";
import { tutorGenerator } from "../src/host/tutor-generation.ts";
import type { Material } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import type { TutorRequest } from "../src/learning-data.ts";

const material = "notes" as Material;
const sources = [{ material, data: { owner: "sam", scope: "math", title: "Matrices", locator: "lesson", content: "Rows multiply columns.", originals: [], origin: "COURSE" as const } }];

/** Runs one request through the validated generator and returns the instruction the tutor received. */
async function instructionFor(kind: TutorRequest["kind"], context: unknown) {
  let received = "";
  const generate = tutorGenerator({
    suggest: async () => ({ unitTitle: "", skills: [] }),
    generate: async (_owner, _sources, instruction, _context, schema) => {
      received = instruction;
      const field = Object.keys((schema as { properties: Record<string, unknown> }).properties)[0]!;
      return { [field]: "1. Multiply A by B.\n\n2. Explain why the order matters.", citations: [{ material, location: "content" }] };
    },
  });
  await generate("sam", { kind, sources, context, work: [] });
  return received;
}

describe("Tutor text layout", () => {
  test("a practice task asks for numbered problems, each in its own paragraph", async () => {
    const instruction = await instructionFor("TASK", { previousQuestions: [] });
    expect(instruction).toContain("Number the problems");
    expect(instruction).toContain("Put each problem and the why/how question in its own paragraph, with a blank line between paragraphs.");
  });

  test("lessons and replies ask for short paragraphs separated by blank lines", async () => {
    for (const kind of ["LESSON", "REPLY"] as const) {
      expect(await instructionFor(kind, {})).toContain("Write short paragraphs separated by a blank line.");
    }
  });
});
