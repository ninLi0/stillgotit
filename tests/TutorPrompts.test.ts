import { describe, expect, test } from "bun:test";
import { AnswerNotGrounded, TutorFailures, tutorGenerator } from "../src/host/tutor-generation.ts";
import { CourseTutor, objectSchema, SUBMITTED_WORK } from "../src/host/tutor.ts";
import type { Material } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import type { MediaValue } from "../src/concepts/GroundedTutoring/media.ts";
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

// A photo the learner attached to a lesson question. The tutor reads it as the learner's work; it is not a course material.
const photoFile = `${"1".repeat(8)}-1111-1111-1111-${"1".repeat(12)}/${"a".repeat(64)}.png`;
const photo: MediaValue = { file: photoFile, name: "my-work.png", mediaType: "image/png",
  renditions: [{ kind: "IMAGE", location: "0123456789abcdef/image", file: photoFile, mediaType: "image/png" }], limitations: [] };
const reply = (citations: { material: string; location: string }[]) => ({
  suggest: async () => ({ unitTitle: "", skills: [] }),
  generate: async () => ({ text: "Your dimension check is right.", citations }),
});

describe("Citations of the learner's attached work", () => {
  test("a citation of the attached work is dropped and the course citations are kept", async () => {
    const generate = tutorGenerator(reply([{ material, location: "content" }, { material: SUBMITTED_WORK, location: "0123456789abcdef/image" }]));
    const answer = await generate("sam", { kind: "REPLY", sources, context: {}, work: [photo] });
    expect(answer.text).toBe("Your dimension check is right.");
    expect(answer.citations).toEqual([{ material, location: "content" }]);
  });

  test("an answer that cites only the attached work is refused with a sentence for the learner", async () => {
    const failures = new TutorFailures();
    const generate = tutorGenerator(reply([{ material: SUBMITTED_WORK, location: "0123456789abcdef/image" }]), failures);
    await expect(generate("sam", { kind: "REPLY", sources, context: {}, work: [photo] })).rejects.toBeInstanceOf(AnswerNotGrounded);
    expect(failures.take("sam")).toBe("The tutor's answer did not cite your course materials. Try again. Your saved work is still available.");
  });

  test("the tutor is told to read the attached work and never cite it, only when work is attached", async () => {
    const received: string[] = [];
    const tutor = new CourseTutor({ json: async (instruction) => { received.push(instruction); return { text: "ok", citations: [{ material, location: "content" }] }; } },
      { size: async () => 3, read: async () => Buffer.from("png") });
    const choice = { model: "gemini-3.8-flash", level: "MEDIUM" as const }, schema = objectSchema({ text: { type: "string" } });
    await tutor.generate("sam", sources, "Answer the question.", {}, schema, [photo], choice);
    await tutor.generate("sam", sources, "Answer the question.", {}, schema, [], choice);
    expect(received[0]).toContain(`The source ${SUBMITTED_WORK} is the learner's own attached work: read it and respond to it, but never cite it. Cite only the course materials.`);
    expect(received[1]).not.toContain("never cite it");
  });
});
