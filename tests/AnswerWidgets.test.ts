import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { answerParts, answerProse, answerWithWidgetsAs, checkAnswerWidgets, readWidget, scanWidgets, WIDGET_LIMITS, WIDGET_PROBLEMS, widgetHeading, widgetPlainText,
  type Widget, type WidgetSource } from "../src/answer-widgets.ts";
import { AnswerNotGrounded, tutorGenerator } from "../src/host/tutor-generation.ts";
import { SUBMITTED_WORK } from "../src/host/tutor.ts";
import type { Material } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
import type { TutorRequest } from "../src/learning-data.ts";
import { cannedWidgets, widgetBlock } from "./fixtures/fake-gemini.ts";
import { formatResult, formatSliderValue, snapToStep, stepDecimals } from "../frontend/src/widget-values.ts";

// The lesson's one course material: readable text, and a PDF whose page 2 is a citable location.
const material = "notes" as Material;
const PAGE = "0123456789abcdef/page/2";
const pdf = { file: "f".repeat(8), name: "slides.pdf", mediaType: "application/pdf", limitations: [],
  renditions: [{ kind: "PAGE" as const, location: PAGE, page: 2 }] };
const sources = [{ material, data: { owner: "sam", scope: "math", title: "Matrices", locator: "lesson", content: "Rows multiply columns.", originals: [pdf], origin: "COURSE" as const } }];
const SOURCE: WidgetSource = { material, location: "content" };
const [SLIDER, TABLE, STEPS, CHOICE] = cannedWidgets(SOURCE);
/** The host's source check for this lesson, as tutor-generation.ts applies it: the source as it is saved, or nothing when it fails. */
const citable = (source: WidgetSource) => source.material === material && (source.location === "content" || source.location === PAGE) ? source : undefined;
const answer = (...blocks: unknown[]) => ["Rows meet columns.", ...blocks.map(widgetBlock), "That is why the order matters."].join("\n\n");

let warnings: string[] = [];
let warn: ReturnType<typeof spyOn>;
beforeEach(() => { warnings = []; warn = spyOn(console, "warn").mockImplementation((line: string) => { warnings.push(line); }); });
afterEach(() => warn.mockRestore());

describe("Finding example blocks", () => {
  test("an answer without a block is one text part and comes back exactly as it was", () => {
    const text = "Rows meet columns.\n\n```python\nprint(1)\n```\n\n$$\nAB\n$$\n";
    expect(answerParts(text)).toEqual([{ kind: "text", text }]);
    const checked = checkAnswerWidgets(text, citable);
    expect(checked.text).toBe(text);
    expect(checked).toEqual({ text, kept: [], dropped: [] });
  });

  test("a block opens with its own fence line and closes with a plain fence, and the parts join back into the answer", () => {
    const text = answer(STEPS);
    const parts = answerParts(text);
    expect(parts.map((part) => part.kind)).toEqual(["text", "widget", "text"]);
    expect(parts[1]).toEqual({ kind: "widget", body: JSON.stringify(STEPS, null, 2), closed: true });
    const { lines, blocks } = scanWidgets(text);
    expect(lines.join("\n")).toBe(text);
    expect(blocks).toHaveLength(1);
    // Indentation of up to three spaces, more backticks, and spaces around the info string still open a block.
    for (const fence of ["   ```stillgotit-widget", "````stillgotit-widget  ", "``` stillgotit-widget"]) {
      const close = fence.trim().startsWith("````") ? "````" : "```";
      expect(scanWidgets(`${fence}\n{}\n${close}`).blocks).toEqual([{ start: 0, end: 2, body: "{}", closed: true }]);
    }
  });

  test("a block shown inside another code block is not an example, and other info strings are ordinary code", () => {
    for (const text of ["````md\n```stillgotit-widget\n{}\n```\n````", "~~~\n```stillgotit-widget\n{}\n```\n~~~", "```json\n{}\n```", "    ```stillgotit-widget\n    {}\n    ```",
      "> ```stillgotit-widget\n> {}\n> ```", "```stillgotit-widget-2\n{}\n```", "Inline ```stillgotit-widget``` code."]) {
      expect(scanWidgets(text).blocks, text).toEqual([]);
      expect(checkAnswerWidgets(text, citable).text).toBe(text);
    }
  });

  test("a block that is never closed runs to the end of the answer and is dropped", () => {
    const checked = checkAnswerWidgets(`Rows meet columns.\n\n\`\`\`stillgotit-widget\n${JSON.stringify(STEPS)}`, citable);
    expect(checked).toEqual({ text: "Rows meet columns.", kept: [], dropped: ["MALFORMED"] });
  });
});

describe("Each kind is accepted", () => {
  test("the fixture's four canned examples are accepted, and each is kept in canonical form", () => {
    for (const widget of [SLIDER, TABLE, STEPS, CHOICE]) {
      const read = readWidget(JSON.stringify(widget, null, 2));
      expect(read, widget.kind).toEqual({ ok: true, widget: widget as unknown as Widget });
      const checked = checkAnswerWidgets(answer(widget), citable);
      expect(checked.dropped).toEqual([]);
      expect(checked.kept).toEqual([widget as unknown as Widget]);
      expect(checked.text).toBe(`Rows meet columns.\n\n\`\`\`stillgotit-widget\n${JSON.stringify(widget)}\n\`\`\`\n\nThat is why the order matters.`);
    }
  });

  test("canonical form keeps only the kind's fields, trims its text, and starts a slider without a value at its minimum", () => {
    const read = readWidget(JSON.stringify({ kind: "slider", title: "  Area of a square  ", formula: "s^2", output: "Area", note: "ignored", source: { ...SOURCE, page: 3 },
      variables: [{ name: "s", label: "Side", min: 1, max: 10, step: 0.5, unit: "cm" }] }));
    expect(read).toEqual({ ok: true, widget: { kind: "slider", title: "Area of a square", formula: "s^2", output: "Area", source: SOURCE,
      variables: [{ name: "s", label: "Side", min: 1, max: 10, step: 0.5, value: 1 }] } });
  });

  test("a table may leave a cell empty and mix strings with numbers, and an example may cite a page", () => {
    const table = { kind: "table", caption: "Squares", columns: ["n", "n²"], rows: [[1, 1], [2, ""], ["three", 9]], source: { material, location: PAGE } };
    expect(checkAnswerWidgets(answer(table), citable).kept).toEqual([table as Widget]);
  });
});

describe("A failing block is dropped and the rest of the answer is kept", () => {
  const variable = { name: "x", label: "x", min: 0, max: 10, step: 1, value: 2 };
  const slider = (changes: Record<string, unknown>) => ({ ...SLIDER, variables: [variable], formula: "x + 1", ...changes });
  const cases: [string, unknown, keyof typeof WIDGET_PROBLEMS][] = [
    ["JSON that cannot be read", "{ kind: slider", "MALFORMED"],
    ["JSON that is not an object", [STEPS], "MALFORMED"],
    ["an unknown kind", { ...STEPS, kind: "chart" }, "UNKNOWN_KIND"],
    ["a missing kind", { title: "Steps", steps: ["a", "b"], source: SOURCE }, "UNKNOWN_KIND"],
    ["a missing source", { ...STEPS, source: undefined }, "INVALID"],
    ["a source that is not a citation", { ...STEPS, source: "notes" }, "INVALID"],
    ["a source in another material", { ...STEPS, source: { material: "someone-else", location: "content" } }, "SOURCE"],
    ["a location the material does not have", { ...STEPS, source: { material, location: "0123456789abcdef/page/9" } }, "SOURCE"],
    ["the learner's own attached work as its source", { ...STEPS, source: { material: SUBMITTED_WORK, location: "content" } }, "SOURCE"],
    ["a missing title", { ...STEPS, title: " " }, "INVALID"],
    ["LaTeX, whose escapes JSON garbles", { ...STEPS, steps: ["Compute \\frac{1}{2}.", "Done."] }, "INVALID"],
    ["a control character", { ...CHOICE, explanation: "Rows\fcolumns." }, "INVALID"],
    ["one step", { ...STEPS, steps: ["Only one."] }, "INVALID"],
    ["nine steps", { ...STEPS, steps: Array.from({ length: 9 }, (_, index) => `Step ${index}.`) }, "OVERSIZE"],
    ["a step that is too long", { ...STEPS, steps: ["a".repeat(WIDGET_LIMITS.step + 1), "b"] }, "OVERSIZE"],
    ["a title that is too long", { ...STEPS, title: "t".repeat(WIDGET_LIMITS.heading + 1) }, "OVERSIZE"],
    ["seven columns", { ...TABLE, columns: ["a", "b", "c", "d", "e", "f", "g"], rows: [[1, 2, 3, 4, 5, 6, 7]] }, "OVERSIZE"],
    ["nine rows", { ...TABLE, rows: Array.from({ length: 9 }, () => ["1", "2", "3"]) }, "OVERSIZE"],
    ["a row of the wrong length", { ...TABLE, rows: [["1", "2"]] }, "INVALID"],
    ["a cell that is too long", { ...TABLE, rows: [["1", "2", "c".repeat(WIDGET_LIMITS.label + 1)]] }, "OVERSIZE"],
    ["a number that is too large", { ...TABLE, rows: [[1e10, 2, 3]] }, "OVERSIZE"],
    ["one option", { ...CHOICE, options: ["2 × 4"] }, "INVALID"],
    ["six options", { ...CHOICE, options: ["2 × 4", "a", "b", "c", "d", "e"] }, "OVERSIZE"],
    ["an answer that is not an option", { ...CHOICE, answer: "4 × 4" }, "INVALID"],
    ["two options that are the same", { ...CHOICE, options: ["2 × 4", "2 × 4", "3 × 3"] }, "INVALID"],
    ["a formula with an unknown function", slider({ formula: "foo(x)" }), "INVALID"],
    ["a formula with implicit multiplication", slider({ formula: "2x" }), "INVALID"],
    ["a formula that uses an undeclared variable", slider({ formula: "x + y" }), "INVALID"],
    ["a variable the formula does not use", slider({ variables: [variable, { ...variable, name: "y" }] }), "INVALID"],
    ["a formula with no value at the start", slider({ formula: "1 / x", variables: [{ ...variable, value: 0 }] }), "INVALID"],
    ["a formula that is too long", slider({ formula: `x${" + 1".repeat(60)}` }), "OVERSIZE"],
    ["three variables", slider({ variables: [variable, { ...variable, name: "y" }, { ...variable, name: "z" }] }), "OVERSIZE"],
    ["a variable named like a function", slider({ formula: "sin + 1", variables: [{ ...variable, name: "sin" }] }), "INVALID"],
    ["a range with no width", slider({ variables: [{ ...variable, min: 5, max: 5 }] }), "INVALID"],
    ["a starting value outside the range", slider({ variables: [{ ...variable, value: 11 }] }), "INVALID"],
    ["more than a thousand positions", slider({ variables: [{ ...variable, max: 10, step: 0.001 }] }), "OVERSIZE"],
    ["a body over the size limit", { ...STEPS, steps: ["a", "b"], padding: "p".repeat(WIDGET_LIMITS.body) }, "OVERSIZE"],
  ];
  for (const [name, widget, problem] of cases) {
    test(`${name}: ${problem}`, async () => {
      const text = ["Rows meet columns.", `\`\`\`stillgotit-widget\n${typeof widget === "string" ? widget : JSON.stringify(widget)}\n\`\`\``, "That is why the order matters."].join("\n\n");
      const checked = checkAnswerWidgets(text, citable);
      expect(checked).toEqual({ text: "Rows meet columns.\n\nThat is why the order matters.", kept: [], dropped: [problem] });
      // Through the host: the lesson keeps the rest of its answer, and the server log gets one line that names the reason
      // and nothing from the answer, the learner, or the material.
      const saved = await generatorAnswering(text).generate("sam", request("LESSON", "interactive"));
      expect(saved.text).toBe("Rows meet columns.\n\nThat is why the order matters.");
      expect(warnings).toEqual([`Tutor answer example dropped: ${WIDGET_PROBLEMS[problem]}.`]);
    });
  }

  test("only the first valid example is kept; a later one is dropped as extra, and a bad one before it does not count", () => {
    const checked = checkAnswerWidgets(answer({ ...STEPS, kind: "chart" }, TABLE, CHOICE), citable);
    expect(checked.kept).toEqual([TABLE as unknown as Widget]);
    expect(checked.dropped).toEqual(["UNKNOWN_KIND", "EXTRA"]);
    expect(checked.text).toBe(`Rows meet columns.\n\n\`\`\`stillgotit-widget\n${JSON.stringify(TABLE)}\n\`\`\`\n\nThat is why the order matters.`);
  });

  test("a dropped block at the start or the end leaves no stray blank line", () => {
    expect(checkAnswerWidgets(`${widgetBlock({ kind: "chart" })}\n\nRows meet columns.`, citable).text).toBe("Rows meet columns.");
    expect(checkAnswerWidgets(`Rows meet columns.\n\n${widgetBlock({ kind: "chart" })}\n`, citable).text).toBe("Rows meet columns.");
    expect(checkAnswerWidgets(`Rows meet columns.\n${widgetBlock({ kind: "chart" })}\nThe order matters.`, citable).text).toBe("Rows meet columns.\nThe order matters.");
  });
});

/** The validated generator with a canned tutor whose text answer is `text`, citing the lesson's material. */
function generatorAnswering(text: string) {
  const instructions: string[] = [];
  const generate = tutorGenerator({
    suggest: async () => ({ unitTitle: "", skills: [] }),
    generate: async (_owner, _sources, instruction, _context, schema) => {
      instructions.push(instruction);
      const field = Object.keys((schema as { properties: Record<string, unknown> }).properties)[0]!;
      return { [field]: text, citations: [{ material, location: "content" }] };
    },
  });
  return { generate, instructions };
}
const request = (kind: TutorRequest["kind"], style?: "interactive"): TutorRequest =>
  ({ kind, sources, context: { previousQuestions: [] }, work: [], ...(style ? { style } : {}) });

describe("The host checks examples in lesson answers", () => {
  test("a lesson's opening and a lesson reply keep a valid example and drop a failing one, in either style", async () => {
    const text = answer(CHOICE, { ...STEPS, source: { material: "elsewhere", location: "content" } });
    for (const kind of ["LESSON", "REPLY"] as const) {
      for (const style of [undefined, "interactive"] as const) {
        const result = await generatorAnswering(text).generate("sam", request(kind, style));
        expect(result.text).toBe(`Rows meet columns.\n\n\`\`\`stillgotit-widget\n${JSON.stringify(CHOICE)}\n\`\`\`\n\nThat is why the order matters.`);
        expect(result.citations).toEqual([{ material, location: "content" }]);
      }
    }
    expect(warnings).toEqual(Array(4).fill(`Tutor answer example dropped: ${WIDGET_PROBLEMS.SOURCE}.`));
  });

  test("an example whose source names its material by file name or title is kept, and saved with the material's identity", async () => {
    for (const [named, location, naming] of [["slides.pdf", PAGE, "file name"], ["Matrices", "content", "title"]] as const) {
      warnings = [];
      const result = await generatorAnswering(answer({ ...STEPS, source: { material: named, location } })).generate("sam", request("REPLY", "interactive"));
      expect(result.text).toBe(`Rows meet columns.\n\n\`\`\`stillgotit-widget\n${JSON.stringify({ ...STEPS, source: { material, location } })}\n\`\`\`\n\nThat is why the order matters.`);
      expect(warnings).toEqual([`Tutor answer example named its source by its ${naming}; resolved to the material.`]);
    }
    // A name the lesson's material does not have, or the right name at a location the material lacks, is dropped as before.
    for (const source of [{ material: "slides.PDF", location: PAGE }, { material: "slides.pdf", location: "0123456789abcdef/page/9" }]) {
      warnings = [];
      const result = await generatorAnswering(answer({ ...STEPS, source })).generate("sam", request("LESSON", "interactive"));
      expect(result.text).toBe("Rows meet columns.\n\nThat is why the order matters.");
      expect(warnings).toEqual([`Tutor answer example dropped: ${WIDGET_PROBLEMS.SOURCE}.`]);
    }
  });

  test("an answer without an example comes back exactly as the tutor wrote it", async () => {
    const text = "Rows meet columns.\n\n\n\nThe $AB$ order matters.\n";
    for (const kind of ["LESSON", "REPLY"] as const) expect((await generatorAnswering(text).generate("sam", request(kind))).text).toBe(text);
  });

  test("an answer that is nothing but a failing example is refused, so the learner can try again", async () => {
    const failures = generatorAnswering(widgetBlock({ kind: "chart" }));
    await expect(failures.generate("sam", request("LESSON", "interactive"))).rejects.toThrow("Incomplete content");
    // A citation that only an example could have supplied still does not ground the answer.
    const ungrounded = tutorGenerator({ suggest: async () => ({ unitTitle: "", skills: [] }),
      generate: async () => ({ text: answer(STEPS), citations: [{ material: SUBMITTED_WORK, location: "content" }] }) });
    await expect(ungrounded("sam", request("REPLY"))).rejects.toBeInstanceOf(AnswerNotGrounded);
  });

  test("practice tasks and hints are never checked for examples, so their text is as the tutor wrote it", async () => {
    const text = answer({ kind: "chart" });
    expect((await generatorAnswering(text).generate("sam", request("TASK"))).text).toBe(text);
    expect((await generatorAnswering(text).generate("sam", request("HINT"))).text).toBe(text);
    expect(warnings).toEqual([]);
  });
});

describe("Examples as plain text", () => {
  test("copying an answer writes each example out, and Listen names it, instead of giving the learner JSON", () => {
    const text = answer(SLIDER);
    expect(answerWithWidgetsAs(text, widgetPlainText)).toBe("Rows meet columns.\n\nOne entry of a product\nEntry in row 1, column 1 of AB = a × 3 + 2 × b, " +
      "where First entry of row 1 of A (a) goes from -5 to 5, and Second entry of column 1 of B (b) goes from -5 to 5.\n\nThat is why the order matters.");
    expect(answerWithWidgetsAs(text, (widget) => `Interactive example: ${widgetHeading(widget)}.`)).toBe(
      "Rows meet columns.\n\nInteractive example: One entry of a product.\n\nThat is why the order matters.");
    expect(widgetPlainText(TABLE as unknown as Widget)).toBe("Which products are defined\nA | B | AB\n2 × 3 | 3 × 4 | 2 × 4\n3 × 2 | 2 × 2 | 3 × 2\n1 × 3 | 3 × 1 | 1 × 1\n2 × 3 | 2 × 3 | Not defined");
    expect(widgetPlainText(STEPS as unknown as Widget)).toStartWith("Forming the entry in row 1, column 1 of AB\n1. Take row 1 of A: [1, 2].\n2. ");
    expect(widgetPlainText(CHOICE as unknown as Widget)).toBe("A is 2 × 3 and B is 3 × 4. What size is AB?\n- 2 × 4\n- 3 × 3\n- 4 × 2\n- AB is not defined\n" +
      "Answer: 2 × 4. The inner sizes, 3 and 3, match, so AB keeps the outer ones: 2 rows and 4 columns.");
    // An answer without examples, and a block that cannot be read, which is left out.
    expect(answerWithWidgetsAs("Plain.", widgetPlainText)).toBe("Plain.");
    expect(answerWithWidgetsAs(answer({ kind: "chart" }), widgetPlainText)).toBe("Rows meet columns.\n\n\nThat is why the order matters.");
    expect(answerProse(answer(STEPS))).toBe("Rows meet columns.\n\n\nThat is why the order matters.");
  });
});

describe("Slider numbers on the lesson page", () => {
  test("a slider stops at its minimum plus whole steps, and shows each value with its step's decimals", () => {
    expect(stepDecimals(1)).toBe(0);
    expect(stepDecimals(0.5)).toBe(1);
    expect(stepDecimals(0.25)).toBe(2);
    expect(stepDecimals(1e-7)).toBe(6);
    expect(snapToStep(0.30000000000000004, 0, 1, 0.1)).toBe(0.3);
    expect(snapToStep(4.4, 1, 10, 0.5)).toBe(4.5);
    expect(snapToStep(11, 0, 10, 3)).toBe(9);
    expect(snapToStep(-20, -5, 5, 1)).toBe(-5);
    expect(snapToStep(Number.NaN, 2, 5, 1)).toBe(2);
    expect(formatSliderValue(0.3, 0.1)).toBe("0.3");
    expect(formatSliderValue(2, 0.5)).toBe("2.0");
    expect(formatSliderValue(-3, 1)).toBe("−3");
  });

  test("the result shows at most four decimals, a true minus sign, scientific form at the extremes, and says when it is not defined", () => {
    expect(formatResult(11)).toBe("11");
    expect(formatResult(1 / 3)).toBe("0.3333");
    expect(formatResult(-2.5)).toBe("−2.5");
    expect(formatResult(12345.678)).toBe("12,345.678");
    expect(formatResult(0)).toBe("0");
    expect(formatResult(1.5e12)).toBe("1.5 × 10^12");
    expect(formatResult(-2e-7)).toBe("−2 × 10^−7");
    expect(formatResult(Number.NaN)).toBe("not defined for these values");
    expect(formatResult(Infinity)).toBe("not defined for these values");
  });
});
