// Interactive examples in lesson answers (design/compositions/Learning.md, "Interactive examples"). When a learner turns on
// interactive examples, the tutor may end a paragraph of a lesson answer with one fenced block whose info string is
// `stillgotit-widget` and whose body is one JSON object: a slider, a table, steps, or a choice. Each example names the
// passage it illustrates in `source`, in the shape of a citation.
//
// The host and the lesson page share this module. The host checks every block of a lesson answer before the answer is
// saved, keeps a valid one in a canonical form and drops any other (src/host/tutor-generation.ts). The page finds the same
// blocks and shows each as an interactive example (frontend/src/MarkdownText.vue). Both find blocks by the same lines, so
// what the host checked is exactly what the page shows. Nothing here reads or writes any record.
import { evaluateFormula, formulaText, parseFormula } from "./widget-formula.ts";

/** The info string that marks a block as an interactive example. */
export const WIDGET_FENCE = "stillgotit-widget";
export const WIDGET_KINDS = ["slider", "table", "steps", "choice"] as const;
export type WidgetKind = typeof WIDGET_KINDS[number];

/** The size limits of one example. A block over any of them is dropped. */
export const WIDGET_LIMITS = Object.freeze({
  /** Characters of JSON in one block. */
  body: 4000,
  /** A title, a table caption, or a question. */
  heading: 160,
  /** A variable's label, the output label, a column heading, or a table cell. */
  label: 80,
  step: 300, option: 160, explanation: 400,
  /** A source's material identity and location. */
  source: 300,
  variables: { min: 1, max: 2 }, steps: { min: 2, max: 8 }, options: { min: 2, max: 5 }, columns: { min: 1, max: 6 }, rows: { min: 1, max: 8 },
  /** The most positions one slider may have, and the largest number an example may hold. */
  positions: 1000, magnitude: 1e9,
});

/** The passage an example illustrates, in the shape of a citation. */
export interface WidgetSource { material: string; location: string }
export interface SliderVariable { name: string; label: string; min: number; max: number; step: number; value: number }
export interface SliderWidget { kind: "slider"; title: string; formula: string; variables: SliderVariable[]; output: string; source: WidgetSource }
export interface TableWidget { kind: "table"; caption: string; columns: string[]; rows: (string | number)[][]; source: WidgetSource }
export interface StepsWidget { kind: "steps"; title: string; steps: string[]; source: WidgetSource }
export interface ChoiceWidget { kind: "choice"; question: string; options: string[]; answer: string; explanation: string; source: WidgetSource }
export type Widget = SliderWidget | TableWidget | StepsWidget | ChoiceWidget;

/** Why a block was dropped. The server log names the reason with WIDGET_PROBLEMS and nothing from the answer. */
export type WidgetProblem = "MALFORMED" | "UNKNOWN_KIND" | "INVALID" | "OVERSIZE" | "SOURCE" | "EXTRA";
export const WIDGET_PROBLEMS: Readonly<Record<WidgetProblem, string>> = Object.freeze({
  MALFORMED: "its block is not closed or its JSON could not be read",
  UNKNOWN_KIND: "its kind is not slider, table, steps, or choice",
  INVALID: "a field is missing or has the wrong form",
  OVERSIZE: "it is over the size limits",
  SOURCE: "its source does not name one of the lesson's materials at a valid location",
  EXTRA: "the answer already has an example",
});

// ---- Finding blocks ----

/** One block in an answer: its lines (opening and closing fence included), its body, and whether its closing fence was found. */
export interface WidgetBlock { start: number; end: number; body: string; closed: boolean }

// A block opens with a line of three or more backticks and the info string alone, indented at most three spaces, and closes
// with a line of at least as many backticks and nothing else. Another fenced code block is skipped whole, so a block shown
// inside a code example is never taken for an example. These are CommonMark's fence rules, narrowed to this info string.
const OPEN = new RegExp(`^ {0,3}(\`{3,})[ \\t]*${WIDGET_FENCE}[ \\t]*$`);
const OTHER_FENCE = /^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/;
const closes = (line: string, fence: string) => new RegExp(`^ {0,3}${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`).test(line);

/** The answer's lines and the example blocks among them, in order. */
export function scanWidgets(text: string): { lines: string[]; blocks: WidgetBlock[] } {
  const lines = text.split("\n"), blocks: WidgetBlock[] = [];
  const line = (index: number) => lines[index]!.replace(/\r$/, "");
  for (let index = 0; index < lines.length; index++) {
    const open = OPEN.exec(line(index));
    if (open) {
      let end = index + 1;
      while (end < lines.length && !closes(line(end), open[1]!)) end++;
      const closed = end < lines.length;
      blocks.push({ start: index, end: closed ? end : lines.length - 1, body: lines.slice(index + 1, end).join("\n"), closed });
      index = end;
      continue;
    }
    const other = OTHER_FENCE.exec(line(index));
    if (other) {
      let end = index + 1;
      while (end < lines.length && !closes(line(end), other[1]!)) end++;
      index = end;
    }
  }
  return { lines, blocks };
}

/** One piece of an answer as the page shows it: Markdown text, or an example block's body. */
export type AnswerPart = { kind: "text"; text: string } | { kind: "widget"; body: string; closed: boolean };

/** The answer split at its example blocks. A text with no block is one text part, unchanged. */
export function answerParts(text: string): AnswerPart[] {
  const { lines, blocks } = scanWidgets(text);
  if (!blocks.length) return [{ kind: "text", text }];
  const parts: AnswerPart[] = [];
  let from = 0;
  for (const block of blocks) {
    if (block.start > from) parts.push({ kind: "text", text: lines.slice(from, block.start).join("\n") });
    parts.push({ kind: "widget", body: block.body, closed: block.closed });
    from = block.end + 1;
  }
  if (from < lines.length) parts.push({ kind: "text", text: lines.slice(from).join("\n") });
  return parts;
}

// ---- Reading one block ----

type Read<T> = { ok: true; value: T } | { ok: false; reason: WidgetProblem };
const fail = (reason: WidgetProblem) => ({ ok: false, reason }) as const;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
// Examples show plain text. A control character or a backslash means the tutor wrote LaTeX, whose escapes JSON reads
// as other characters (\frac becomes a form feed and "rac"), so such a string is refused rather than shown garbled.
const PLAIN = /^[^\u0000-\u001f\u007f\\]*$/;

/** A nonblank plain string of at most `limit` characters, trimmed. */
function text(value: unknown, limit: number): Read<string> {
  if (typeof value !== "string" || !value.trim() || !PLAIN.test(value)) return fail("INVALID");
  return value.trim().length > limit ? fail("OVERSIZE") : { ok: true, value: value.trim() };
}
/** A finite number no larger in size than the magnitude limit. */
function number(value: unknown): Read<number> {
  if (typeof value !== "number" || !Number.isFinite(value)) return fail("INVALID");
  return Math.abs(value) > WIDGET_LIMITS.magnitude ? fail("OVERSIZE") : { ok: true, value };
}
/** A list with between `min` and `max` entries. */
function list(value: unknown, { min, max }: { min: number; max: number }): Read<unknown[]> {
  if (!Array.isArray(value) || value.length < min) return fail("INVALID");
  return value.length > max ? fail("OVERSIZE") : { ok: true, value };
}
/** Reads every entry with `read`, stopping at the first that fails. */
function each<T>(values: unknown[], read: (value: unknown) => Read<T>): Read<T[]> {
  const out: T[] = [];
  for (const value of values) { const one = read(value); if (!one.ok) return one; out.push(one.value); }
  return { ok: true, value: out };
}

/** A source in the shape of a citation. Whether it names one of the lesson's materials is the host's check. */
function source(value: unknown): Read<WidgetSource> {
  if (!isRecord(value)) return fail("INVALID");
  const material = value.material, location = value.location;
  if (typeof material !== "string" || typeof location !== "string" || !material.trim() || !location.trim()) return fail("INVALID");
  return material.length > WIDGET_LIMITS.source || location.length > WIDGET_LIMITS.source ? fail("OVERSIZE") : { ok: true, value: { material, location } };
}

// Variable names are short words that do not shadow a function or constant of the formula language.
const VARIABLE = /^[A-Za-z][A-Za-z0-9_]{0,15}$/;
const RESERVED = new Set(["sqrt", "abs", "exp", "ln", "log", "sin", "cos", "tan", "asin", "acos", "atan", "floor", "ceil", "round", "min", "max", "pi", "e"]);

function variable(value: unknown): Read<SliderVariable> {
  if (!isRecord(value) || typeof value.name !== "string" || !VARIABLE.test(value.name) || RESERVED.has(value.name)) return fail("INVALID");
  const label = text(value.label, WIDGET_LIMITS.label);
  if (!label.ok) return label;
  const min = number(value.min), max = number(value.max), step = number(value.step);
  if (!min.ok) return min;
  if (!max.ok) return max;
  if (!step.ok) return step;
  if (!(min.value < max.value) || !(step.value > 0) || step.value > max.value - min.value) return fail("INVALID");
  if ((max.value - min.value) / step.value > WIDGET_LIMITS.positions) return fail("OVERSIZE");
  // The starting value is optional, and the slider starts at its minimum without one.
  const start = value.value === undefined ? { ok: true as const, value: min.value } : number(value.value);
  if (!start.ok) return start;
  if (start.value < min.value || start.value > max.value) return fail("INVALID");
  return { ok: true, value: { name: value.name, label: label.value, min: min.value, max: max.value, step: step.value, value: start.value } };
}

function slider(value: Record<string, unknown>, from: WidgetSource): Read<SliderWidget> {
  const title = text(value.title, WIDGET_LIMITS.heading), output = text(value.output, WIDGET_LIMITS.label);
  if (!title.ok) return title;
  if (!output.ok) return output;
  if (typeof value.formula !== "string") return fail("INVALID");
  const formula = text(value.formula, Infinity);
  if (!formula.ok) return formula;
  const parsed = parseFormula(formula.value);
  if (!parsed.ok) return fail(/too long/.test(parsed.reason) ? "OVERSIZE" : "INVALID");
  const listed = list(value.variables, WIDGET_LIMITS.variables);
  if (!listed.ok) return listed;
  const variables = each(listed.value, variable);
  if (!variables.ok) return variables;
  // Each variable has its own slider, the formula uses exactly the declared variables, and it has a value at the start.
  const names = variables.value.map((item) => item.name);
  if (new Set(names).size !== names.length || parsed.variables.length !== names.length || !parsed.variables.every((name) => names.includes(name))) return fail("INVALID");
  if (!Number.isFinite(evaluateFormula(parsed.tree, Object.fromEntries(variables.value.map((item) => [item.name, item.value]))))) return fail("INVALID");
  return { ok: true, value: { kind: "slider", title: title.value, formula: formula.value, variables: variables.value, output: output.value, source: from } };
}

function table(value: Record<string, unknown>, from: WidgetSource): Read<TableWidget> {
  const caption = text(value.caption, WIDGET_LIMITS.heading);
  if (!caption.ok) return caption;
  const listedColumns = list(value.columns, WIDGET_LIMITS.columns);
  if (!listedColumns.ok) return listedColumns;
  const columns = each(listedColumns.value, (cell) => text(cell, WIDGET_LIMITS.label));
  if (!columns.ok) return columns;
  const listedRows = list(value.rows, WIDGET_LIMITS.rows);
  if (!listedRows.ok) return listedRows;
  const rows = each(listedRows.value, (row): Read<(string | number)[]> => {
    if (!Array.isArray(row)) return fail("INVALID");
    if (row.length !== columns.value.length) return row.length > WIDGET_LIMITS.columns.max ? fail("OVERSIZE") : fail("INVALID");
    // A cell may be empty, so a table can leave a value for the learner to work out.
    return each<string | number>(row, (cell): Read<string | number> => typeof cell === "number" ? number(cell) : cell === "" ? { ok: true, value: "" } : text(cell, WIDGET_LIMITS.label));
  });
  if (!rows.ok) return rows;
  return { ok: true, value: { kind: "table", caption: caption.value, columns: columns.value, rows: rows.value, source: from } };
}

function steps(value: Record<string, unknown>, from: WidgetSource): Read<StepsWidget> {
  const title = text(value.title, WIDGET_LIMITS.heading);
  if (!title.ok) return title;
  const listed = list(value.steps, WIDGET_LIMITS.steps);
  if (!listed.ok) return listed;
  const read = each(listed.value, (step) => text(step, WIDGET_LIMITS.step));
  if (!read.ok) return read;
  return { ok: true, value: { kind: "steps", title: title.value, steps: read.value, source: from } };
}

function choice(value: Record<string, unknown>, from: WidgetSource): Read<ChoiceWidget> {
  const question = text(value.question, WIDGET_LIMITS.heading), explanation = text(value.explanation, WIDGET_LIMITS.explanation);
  if (!question.ok) return question;
  if (!explanation.ok) return explanation;
  const listed = list(value.options, WIDGET_LIMITS.options);
  if (!listed.ok) return listed;
  const options = each(listed.value, (option) => text(option, WIDGET_LIMITS.option));
  if (!options.ok) return options;
  // The options differ from one another, and the answer is exactly one of them.
  const answer = text(value.answer, WIDGET_LIMITS.option);
  if (!answer.ok || new Set(options.value).size !== options.value.length || !options.value.includes(answer.value)) return answer.ok ? fail("INVALID") : answer;
  return { ok: true, value: { kind: "choice", question: question.value, options: options.value, answer: answer.value, explanation: explanation.value, source: from } };
}

/**
 * Reads one block's body as an example of one of the four kinds, in canonical form: known fields only, strings trimmed,
 * and a slider's missing starting values filled in. Fields the kind does not use are left out.
 */
export function readWidget(body: string): { ok: true; widget: Widget } | { ok: false; reason: WidgetProblem } {
  if (body.length > WIDGET_LIMITS.body) return { ok: false, reason: "OVERSIZE" };
  let value: unknown;
  try { value = JSON.parse(body); } catch { return { ok: false, reason: "MALFORMED" }; }
  if (!isRecord(value)) return { ok: false, reason: "MALFORMED" };
  if (typeof value.kind !== "string" || !(WIDGET_KINDS as readonly string[]).includes(value.kind)) return { ok: false, reason: "UNKNOWN_KIND" };
  const from = source(value.source);
  if (!from.ok) return from;
  const read = value.kind === "slider" ? slider(value, from.value) : value.kind === "table" ? table(value, from.value)
    : value.kind === "steps" ? steps(value, from.value) : choice(value, from.value);
  return read.ok ? { ok: true, widget: read.value } : read;
}

// ---- Checking an answer ----

/**
 * The host's check of a lesson answer. Each block must be closed, read as an example, and name a source that `cite`
 * accepts, which is the same check a citation passes; only the first such block is kept. `cite` returns the source as it
 * is saved, or nothing when it fails: a source that names its material by title or file name comes back with the material's
 * identity. A kept block is rewritten in canonical form with that source. A dropped block leaves the answer with the blank
 * line that separated it, so the text around it reads as before. An answer without blocks comes back exactly as it was.
 */
export function checkAnswerWidgets(answer: string, cite: (source: WidgetSource) => WidgetSource | undefined): { text: string; kept: Widget[]; dropped: WidgetProblem[] } {
  const { lines, blocks } = scanWidgets(answer);
  if (!blocks.length) return { text: answer, kept: [], dropped: [] };
  const kept: Widget[] = [], dropped: WidgetProblem[] = [], out: string[] = [];
  let from = 0;
  const drop = (reason: WidgetProblem) => {
    dropped.push(reason);
    // The block sat between two blank lines, or between the start and a blank line: one of them is enough.
    if (!out.at(-1)?.trim() && from < lines.length && !lines[from]!.trim()) from++;
  };
  for (const block of blocks) {
    out.push(...lines.slice(from, block.start));
    from = block.end + 1;
    const read = block.closed ? readWidget(block.body) : { ok: false as const, reason: "MALFORMED" as const };
    if (!read.ok) { drop(read.reason); continue; }
    const source = cite(read.widget.source);
    if (!source) { drop("SOURCE"); continue; }
    if (kept.length) { drop("EXTRA"); continue; }
    const widget: Widget = { ...read.widget, source: { material: source.material, location: source.location } };
    kept.push(widget);
    out.push(`\`\`\`${WIDGET_FENCE}`, JSON.stringify(widget), "```");
  }
  out.push(...lines.slice(from));
  // A block dropped at the end leaves no blank line behind.
  if (dropped.length) while (out.length && !out.at(-1)!.trim()) out.pop();
  return { text: out.join("\n"), kept, dropped };
}

/** The text outside the answer's example blocks: what remains for the learner to read when no example is shown. */
export function answerProse(answer: string): string {
  return answerParts(answer).flatMap((part) => part.kind === "text" ? [part.text] : []).join("\n");
}

// ---- Examples as plain text ----

/** The words that head an example: its title, a table's caption, or a choice's question. */
export function widgetHeading(widget: Widget): string {
  return widget.kind === "table" ? widget.caption : widget.kind === "choice" ? widget.question : widget.title;
}

/**
 * A step's text as the page shows it. The page numbers each step itself, so a step the tutor began with its own label,
 * such as "Step 1: Exponentiate each logit", would read "Step 1: Step 1: …". When the text starts with "Step N:",
 * "Step N." or "Step N -" (any case, also with an en or em dash), and N is the step's own number, that label is left
 * out. The saved text keeps it; a label with another number, a number such as "Step 1.5", or a label with nothing
 * after it stays.
 */
export function stepText(step: string, index: number): string {
  const label = new RegExp(`^\\s*step\\s+${index + 1}(?!\\d)\\s*(?:[:\\-\u2013\u2014]|\\.(?!\\d))\\s*`, "i");
  const rest = step.replace(label, "");
  return rest.trim() ? rest : step;
}

/** An example written out as plain text, for copying an answer. A choice ends with its answer and explanation. */
export function widgetPlainText(widget: Widget): string {
  switch (widget.kind) {
    case "slider": {
      const parsed = parseFormula(widget.formula);
      const ranges = widget.variables.map((item) => `${item.label} (${item.name}) goes from ${item.min} to ${item.max}`).join(", and ");
      return `${widget.title}\n${widget.output} = ${parsed.ok ? formulaText(parsed.tree) : widget.formula}, where ${ranges}.`;
    }
    case "table": return [widget.caption, widget.columns.join(" | "), ...widget.rows.map((row) => row.join(" | "))].join("\n");
    case "steps": return [widget.title, ...widget.steps.map((step, index) => `${index + 1}. ${stepText(step, index)}`)].join("\n");
    case "choice": return [widget.question, ...widget.options.map((option) => `- ${option}`), `Answer: ${widget.answer}. ${widget.explanation}`].join("\n");
  }
}

/**
 * The answer with each example block replaced by `replace(widget)`, or removed when its block cannot be read. Copy writes
 * an example out as plain text, and Listen says that an example is shown, so neither gives the learner raw JSON.
 */
export function answerWithWidgetsAs(answer: string, replace: (widget: Widget) => string): string {
  const parts = answerParts(answer);
  if (parts.length === 1 && parts[0]!.kind === "text") return answer;
  return parts.flatMap((part) => {
    if (part.kind === "text") return [part.text];
    const read = part.closed ? readWidget(part.body) : null;
    return read?.ok ? [replace(read.widget)] : [];
  }).join("\n");
}
