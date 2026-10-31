import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { evaluateFormula, FORMULA_FUNCTIONS, FORMULA_LIMITS, formulaText, parseFormula } from "../src/widget-formula.ts";

/** The value of a formula that must read, for the given variables. */
function value(formula: string, values: Record<string, number> = {}) {
  const parsed = parseFormula(formula);
  if (!parsed.ok) throw new Error(`${formula} was refused: ${parsed.reason}`);
  return evaluateFormula(parsed.tree, values);
}
const refusal = (formula: string) => { const parsed = parseFormula(formula); return parsed.ok ? null : parsed.reason; };

describe("The slider formula evaluator", () => {
  test("reads numbers, the four operations, powers, and parentheses in the usual order", () => {
    expect(value("1 + 2 * 3")).toBe(7);
    expect(value("(1 + 2) * 3")).toBe(9);
    expect(value("10 - 4 - 3")).toBe(3);
    expect(value("24 / 4 / 2")).toBe(3);
    expect(value("2 ^ 10")).toBe(1024);
    expect(value(".5 + 2.25 + 1e3 + 2.5E-1")).toBe(1003);
  });

  test("a power groups from the right and binds tighter than a leading minus", () => {
    expect(value("2 ^ 3 ^ 2")).toBe(512);
    expect(value("(2 ^ 3) ^ 2")).toBe(64);
    expect(value("-x ^ 2", { x: 3 })).toBe(-9);
    expect(value("(-x) ^ 2", { x: 3 })).toBe(9);
    expect(value("2 ^ -1")).toBe(0.5);
    expect(value("--3")).toBe(3);
    expect(value("+3 - +1")).toBe(2);
  });

  test("uses the declared variables and lists them in order of first use, leaving out constants", () => {
    const parsed = parseFormula("0.5 * m * v^2 + 0 * pi * e * m");
    expect(parsed.ok && parsed.variables).toEqual(["m", "v"]);
    expect(value("0.5 * m * v^2", { m: 2, v: 3 })).toBe(9);
    expect(value("2 * pi * r", { r: 1 })).toBeCloseTo(2 * Math.PI, 12);
    expect(value("e ^ 1")).toBeCloseTo(Math.E, 12);
  });

  test("offers a fixed list of functions: log is base 10, ln is natural, and min and max take two values", () => {
    expect(Object.keys(FORMULA_FUNCTIONS)).toEqual(["sqrt", "abs", "exp", "ln", "log", "sin", "cos", "tan", "asin", "acos", "atan", "floor", "ceil", "round", "min", "max"]);
    expect(value("sqrt(a^2 + b^2)", { a: 3, b: 4 })).toBe(5);
    expect(value("log(1000)")).toBeCloseTo(3, 12);
    expect(value("ln(e)")).toBeCloseTo(1, 12);
    expect(value("exp(0) + abs(-2) + floor(2.7) + ceil(2.1) + round(2.5)")).toBe(1 + 2 + 2 + 3 + 3);
    expect(value("sin(pi / 2) + cos(0) + tan(0)")).toBeCloseTo(2, 12);
    expect(value("asin(1) + acos(1) + atan(0)")).toBeCloseTo(Math.PI / 2, 12);
    expect(value("min(a, b) + max(a, b)", { a: 2, b: 7 })).toBe(9);
  });

  test("reads the signs a tutor writes in text: ×, ·, ÷, the minus sign, and **", () => {
    expect(value("6 × 2 · 2 ÷ 4 − 1")).toBe(5);
    expect(value("x ** 2", { x: 4 })).toBe(16);
  });

  test("a value that is not a real number comes back as NaN or an infinity, never as an error", () => {
    expect(value("sqrt(x)", { x: -1 })).toBeNaN();
    expect(value("1 / x", { x: 0 })).toBe(Infinity);
    expect(value("ln(0)")).toBe(-Infinity);
    expect(value("x + 1", {})).toBeNaN();
  });

  test("refuses anything outside the language, with a reason", () => {
    expect(refusal("")).toBe("the formula is empty");
    expect(refusal("2m")).toContain("write every multiplication with *");
    expect(refusal("2 (x)")).toContain("write every multiplication with *");
    expect(refusal("foo(x)")).toBe("foo is not one of the formula's functions");
    expect(refusal("sqrt x")).toBe("sqrt needs its value in parentheses");
    expect(refusal("max(1)")).toBe("max takes 2 values");
    expect(refusal("sqrt(1, 2)")).toBe("sqrt takes one value");
    expect(refusal("(1 + 2")).toBe("a parenthesis is not closed");
    expect(refusal("1 +")).toBe("the formula ends too soon");
    expect(refusal("* 2")).toContain("where a value belongs");
    expect(refusal("x = 2")).toContain("is not part of a formula");
    expect(refusal("1e999")).toBe("a number is too large");
    // Names that only exist on JavaScript objects are not functions.
    expect(refusal("constructor(1)")).toBe("constructor is not one of the formula's functions");
    expect(refusal("toString(1)")).toBe("toString is not one of the formula's functions");
  });

  test("never runs text as code", () => {
    // Text that would do something if it were run as JavaScript is refused as a formula.
    for (const attempt of ["alert(1)", "globalThis.process", "x => x", "[1][0]", "`1`", "this", "x; y", "process.exit(1)", "a.b"]) {
      const parsed = parseFormula(attempt);
      if (parsed.ok) expect(evaluateFormula(parsed.tree, {})).toBeNaN();
    }
    expect(refusal("alert(1)")).toBe("alert is not one of the formula's functions");
    expect(refusal("a.b")).toContain("is not part of a formula");
    // The module has no eval or Function anywhere.
    const source = readFileSync(new URL("../src/widget-formula.ts", import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, "");
    expect(source).not.toMatch(/\beval\s*\(|new Function|\bFunction\s*\(/);
  });

  test("bounds a formula's length, its tokens, and its nesting", () => {
    // 123 tokens in 123 characters: within the character limit, over the token limit.
    expect(refusal("1+".repeat(61) + "1")).toBe("the formula is too long");
    expect(value("1+".repeat(59) + "1")).toBe(60);
    expect(refusal("x".repeat(FORMULA_LIMITS.characters + 1))).toBe("the formula is too long");
    expect(refusal("(".repeat(30) + "1" + ")".repeat(30))).toBe("the formula is nested too deeply");
    expect(refusal("-".repeat(30) + "1")).toBe("the formula is nested too deeply");
    expect(value("(".repeat(10) + "1" + ")".repeat(10))).toBe(1);
  });

  test("shows a formula with ×, ÷, the minus sign, π, small powers as superscripts, and only the parentheses it needs", () => {
    const shown = (formula: string) => { const parsed = parseFormula(formula); return parsed.ok ? formulaText(parsed.tree) : parsed.reason; };
    expect(shown("0.5*m*v^2")).toBe("0.5 × m × v²");
    expect(shown("2*pi*r")).toBe("2 × π × r");
    expect(shown("a - (b - c)")).toBe("a − (b − c)");
    expect(shown("(a - b) - c")).toBe("a − b − c");
    expect(shown("a / (b * c)")).toBe("a ÷ (b × c)");
    expect(shown("(a + b) * c")).toBe("(a + b) × c");
    expect(shown("-x^2")).toBe("−x²");
    expect(shown("(-x)^2")).toBe("(−x)²");
    expect(shown("2^-1")).toBe("2^(−1)");
    expect(shown("x^(n+1)")).toBe("x^(n + 1)");
    expect(shown("sqrt(a^2 + b^2)")).toBe("sqrt(a² + b²)");
  });
});
