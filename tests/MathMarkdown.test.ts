import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { loadMath, markdown, mathState, renderMarkdown, type MarkdownKind } from "../frontend/src/markdown.ts";

/** Renders text as the app does once KaTeX has loaded. */
async function html(text: string, kind: MarkdownKind = "answer") {
  await loadMath();
  return renderMarkdown(await markdown(kind), text).html;
}
const source = (file: string) => readFileSync(new URL(`../frontend/src/${file}`, import.meta.url), "utf8");

// These two tests run first, before anything in this file has asked for KaTeX.
describe("KaTeX loads only for a text with a formula", () => {
  test("text without a formula, prices included, never asks for KaTeX", async () => {
    for (const kind of ["document", "answer", "message"] as const) {
      const result = renderMarkdown(await markdown(kind), "Rows meet columns.\n\nIt costs $5 and $10, or $5 or more; the $ sign stays.");
      expect(result.math).toBe(false);
      expect(result.html).toContain("It costs $5 and $10, or $5 or more; the $ sign stays.");
      expect(result.html).not.toContain("katex");
    }
    expect(mathState()).toBe("idle");
  });

  test("the first formula shows as its source while KaTeX loads, then renders", async () => {
    const parser = await markdown("answer");
    const first = renderMarkdown(parser, "The area is $\\pi r^2$.");
    expect(first.math).toBe(true);
    expect(first.html).toBe('<p>The area is <code class="math-source">$\\pi r^2$</code>.</p>\n');
    expect(mathState()).toBe("loading");
    await loadMath();
    expect(mathState()).toBe("ready");
    expect(renderMarkdown(parser, "The area is $\\pi r^2$.").html).toContain('<span class="katex">');
  });

  test("KaTeX is reached only through the dynamic import in loadMath", () => {
    // The modules the lesson and the viewer load up front, and the markdown-it chunk, never import KaTeX themselves.
    for (const file of ["markdown.ts", "markdown-parser.ts", "MarkdownText.vue", "math-speech.ts", "speech.ts", "SkillStudy.vue", "MaterialViewer.vue"]) {
      expect(source(file)).not.toMatch(/^\s*import\s[^;]*["'](katex|\.\/markdown-math\.ts)["']/m);
    }
    expect(source("markdown.ts").match(/(?<!typeof )import\("\.\/markdown-math\.ts"\)/g)).toHaveLength(1);
  });
});

describe("Formulas", () => {
  test("inline formulas between $…$ and \\(…\\) render with MathML for screen readers", async () => {
    for (const text of ["Circle: $x^2 + y^2 = r^2$ here.", "Circle: \\(x^2 + y^2 = r^2\\) here."]) {
      const result = await html(text);
      expect(result).toStartWith('<p>Circle: <span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML">');
      expect(result).toContain('<annotation encoding="application/x-tex">x^2 + y^2 = r^2</annotation>');
      expect(result).toEndWith("</span> here.</p>\n");
      expect(result).not.toContain("math-display");
    }
  });

  test("displayed formulas between $$…$$ and \\[…\\] sit in their own scrolling block", async () => {
    for (const text of ["Before\n$$\n\\int_0^1 x\\,dx = \\frac{1}{2}\n$$\nAfter", "Before\n\\[\n\\int_0^1 x\\,dx = \\frac{1}{2}\n\\]\nAfter", "Before\n\n$$\\int_0^1 x\\,dx = \\frac{1}{2}$$\n\nAfter"]) {
      const result = await html(text);
      expect(result).toStartWith('<p>Before</p>\n<div class="math-display"><span class="katex-display"><span class="katex">');
      expect(result).toContain('<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">');
      expect(result).toContain('<annotation encoding="application/x-tex">\\int_0^1 x\\,dx = \\frac{1}{2}</annotation>');
      expect(result).toEndWith("</span></span></div>\n<p>After</p>\n");
    }
  });

  test("the learner's messages render formulas, both inline and displayed", async () => {
    const result = await html("Is $x^2 + y^2 = r^2$ a circle?\n$$\nA = \\pi r^2\n$$\nThanks", "message");
    expect(result).toStartWith('<p>Is <span class="katex">');
    expect(result).toContain('<annotation encoding="application/x-tex">x^2 + y^2 = r^2</annotation>');
    expect(result).toContain('a circle?</p>\n<div class="math-display"><span class="katex-display">');
    expect(result).toEndWith("</div>\n<p>Thanks</p>\n");
  });

  test("a formula KaTeX cannot read shows as its source in monospace with a title, and nothing throws", async () => {
    expect(await html("Bad $\\frac{1}{$ here")).toBe('<p>Bad <code class="math-source math-error" title="This formula could not be rendered.">$\\frac{1}{$</code> here</p>\n');
    expect(await html("\\(\\undefinedcommand{x}\\)")).toBe('<p><code class="math-source math-error" title="This formula could not be rendered.">\\(\\undefinedcommand{x}\\)</code></p>\n');
    expect(await html("$$\n\\begin{matrix} 1 & 2\n$$")).toBe('<pre class="math-source math-error" title="This formula could not be rendered."><code>$$\n\\begin{matrix} 1 &amp; 2\n$$</code></pre>\n');
  });
});

describe("Nothing in a formula becomes markup", () => {
  test("HTML inside a formula is drawn as text, and HTML around it is escaped", async () => {
    const result = await html("<script>alert(1)</script> $\\text{<img src=x onerror=alert(1)>}$");
    expect(result).toStartWith("<p>&lt;script&gt;alert(1)&lt;/script&gt; <span class=\"katex\">");
    expect(result).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(result).not.toMatch(/<img|<script|onerror=alert\(1\)>/);
  });

  test("an unreadable formula with HTML in it is escaped in its source", async () => {
    expect(await html("$<b onclick=alert(1)>\\frac{$")).toBe(
      '<p><code class="math-source math-error" title="This formula could not be rendered.">$&lt;b onclick=alert(1)&gt;\\frac{$</code></p>\n');
  });

  test("links, classes, styles and images from a formula are refused", async () => {
    for (const formula of ["\\href{javascript:alert(1)}{x}", "\\url{https://example.com}", "\\htmlClass{evil}{x}", "\\htmlStyle{color:red}{x}", "\\includegraphics{https://example.com/a.png}"]) {
      const result = await html(`$${formula}$`);
      expect(result).toStartWith('<p><code class="math-source math-error" title="This formula could not be rendered.">');
      expect(result).not.toMatch(/<a |href=|class="evil"|style="color:red"|<img/);
    }
  });
});

describe("Prices and escaped dollar signs are not formulas", () => {
  test("prices stay text once KaTeX has loaded", async () => {
    for (const text of ["It costs $5 and $10.", "Pay $5, $10 or $20.", "From $5 or more; the $ sign.", "US$5 and US$10"]) {
      const result = await html(text);
      expect(result).toBe(`<p>${text}</p>\n`);
    }
  });

  test("escaped dollar signs stay dollar signs", async () => {
    expect(await html("Between \\$x\\$ and \\$y\\$")).toBe("<p>Between $x$ and $y$</p>\n");
    expect(await html("Between \\$x\\$ and \\$y\\$", "message")).toBe("<p>Between $x$ and $y$</p>\n");
  });
});

describe("Each kind of text", () => {
  test("a tutor answer is Markdown that keeps single line breaks", async () => {
    expect(await html("**Step 1.** Multiply.\nThen add $a+b$.")).toMatch(/^<p><strong>Step 1\.<\/strong> Multiply\.<br>\nThen add <span class="katex">/);
    expect(await html("1. First.\n\n2. Second.\n\nShow each entry.")).toBe("<ol>\n<li>\n<p>First.</p>\n</li>\n<li>\n<p>Second.</p>\n</li>\n</ol>\n<p>Show each entry.</p>\n");
    expect(await html("```\nA @ B\n```")).toBe("<pre><code>A @ B\n</code></pre>\n");
  });

  test("the learner's message shows everything but formulas as typed", async () => {
    expect(await html("2*3*4 and **bold**\n# not a heading\n1. not a list\n> not a quote", "message"))
      .toBe("<p>2*3*4 and **bold**<br>\n# not a heading<br>\n1. not a list<br>\n&gt; not a quote</p>\n");
  });

  test("a Materials note keeps source lines on every block, displayed formulas included", async () => {
    const result = await html("# Circles\n\nThe area is $\\pi r^2$.\n\n$$\nA = \\pi r^2\n$$\n\n$$\n\\frac{\n$$\n", "document");
    expect(result).toStartWith('<h1 data-line="1" data-line-end="1">Circles</h1>\n<p data-line="3" data-line-end="3">The area is <span class="katex">');
    expect(result).toContain('<div class="math-display" data-line="5" data-line-end="7"><span class="katex-display">');
    expect(result).toEndWith('<pre class="math-source math-error" data-line="9" data-line-end="11" title="This formula could not be rendered."><code>$$\n\\frac{\n$$</code></pre>\n');
  });

  test("links open in a new tab without a referrer, and images stay off", async () => {
    for (const kind of ["document", "answer"] as const) {
      const result = await html("See https://example.com and ![x](https://example.com/a.png)", kind);
      expect(result).toContain('See <a href="https://example.com" target="_blank" rel="noopener noreferrer nofollow">https://example.com</a> and !<a href="https://example.com/a.png" target="_blank" rel="noopener noreferrer nofollow">x</a>');
      expect(result).not.toContain("<img");
    }
  });
});
