import { describe, expect, test } from "bun:test";
import { formulaWords, spokenText } from "../frontend/src/math-speech.ts";
import { speechParts } from "../frontend/src/speech.ts";

describe("Listen reads formulas as words", () => {
  test("common forms become words", () => {
    expect(formulaWords("x^2 + y^2 = r^2")).toBe("x squared plus y squared equals r squared");
    expect(formulaWords("\\frac{a}{b}")).toBe("a over b");
    expect(formulaWords("\\sqrt{x}")).toBe("the square root of x");
    expect(formulaWords("\\sqrt[3]{8} = 2")).toBe("the cube root of 8 equals 2");
    expect(formulaWords("\\int_0^1 x\\,dx")).toBe("the integral from 0 to 1 of x d x");
    expect(formulaWords("\\sum_{i=1}^{n} i^3")).toBe("the sum from i equals 1 to n of i cubed");
    expect(formulaWords("\\lim_{x \\to 0} \\frac{\\sin x}{x}")).toBe("the limit as x approaches 0 of sine x over x");
    expect(formulaWords("\\alpha + \\beta \\le \\Gamma")).toBe("alpha plus beta is less than or equal to capital gamma");
    expect(formulaWords("e^{-x}")).toBe("e to the power minus x");
    expect(formulaWords("A^T A x_1")).toBe("A transpose A x sub 1");
    expect(formulaWords("\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}")).toBe("the matrix with rows 1, 2; 3, 4");
    expect(formulaWords("|x| \\ge 0 \\text{ for all } x")).toBe("x is greater than or equal to 0 for all x");
  });

  test("anything else is read as its source without the delimiters and braces", () => {
    expect(formulaWords("\\overset{?}{=}")).toBe("overset ? equals");
    expect(spokenText("Try $\\mathcal{F}\\{f\\}$ next.")).toBe("Try F f next.");
  });

  test("formulas in a text are found by the page's rules, with every delimiter", () => {
    expect(spokenText("The circle $x^2 + y^2 = r^2$ has area\n$$\n\\pi r^2\n$$\nso \\(r = 1\\) gives \\[\\pi\\].")).toBe(
      "The circle x squared plus y squared equals r squared has area\npi r squared.\nso r equals 1 gives pi.");
  });

  test("prices and escaped dollar signs are read as written", () => {
    expect(spokenText("It costs $5 and $10, or $5 or more; the $ sign.")).toBe("It costs $5 and $10, or $5 or more; the $ sign.");
    expect(spokenText("Between \\$x\\$ and \\$y\\$.")).toBe("Between $x$ and $y$.");
    expect(spokenText("No formulas here.")).toBe("No formulas here.");
  });

  test("a displayed formula ends its sentence, so the voice pauses after it", () => {
    expect(spokenText("Each entry is:\n\n$$\n(AB)_{ij} = \\sum_k A_{ik} B_{kj}\n$$\n\nThe inner dimensions must match.")).toBe(
      "Each entry is:\n\nA B sub i j equals the sum from k of A sub i k B sub k j.\n\nThe inner dimensions must match.");
    expect(spokenText("So \\[x = 1\\], as before.")).toBe("So x equals 1, as before.");
  });

  test("the spoken parts carry the words, not the LaTeX", () => {
    expect(speechParts(spokenText("Use $\\frac{1}{2} b h$. Then check it."))).toEqual(["Use 1 over 2 b h. Then check it."]);
  });
});
