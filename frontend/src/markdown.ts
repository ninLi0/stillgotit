import { shallowReactive, shallowRef } from "vue";
import type { Env, MarkdownIt, Token } from "markdown-it";

// Markdown for every text the app shows formatted: the tutor's answers, the learner's own messages, and Markdown notes
// in the Materials viewer. One policy covers them all. Raw HTML is off, so a text cannot add markup or scripts. Images
// are off, so a text cannot make the browser fetch pictures from other sites. Links open in a new tab and send no
// referrer. Formulas between $…$, $$…$$, \(…\) and \[…\] are mathematics: @mdit/plugin-tex finds them, and its rules
// for "$" leave prices such as "$5 and $10" alone. KaTeX draws them, and it loads only when a text holds a formula.
//
// Each kind of text reads its own share of Markdown:
// - "document", a note in the Materials viewer: full Markdown. Each block carries its source line numbers (data-line,
//   data-line-end) so the viewer can scroll to and highlight a cited "lines/A-B" location.
// - "answer", the tutor's lessons, practice tasks, replies, hints and assessments: full Markdown, and a single line break
//   stays a line break, because the tutor writes plain text.
// - "message", the learner's own messages: paragraphs, line breaks and formulas only, so the rest shows as typed. A
//   product typed as 2*3*4 stays 2*3*4 instead of becoming emphasis.
export type MarkdownKind = "document" | "answer" | "message";

type MathModule = typeof import("./markdown-math.ts");
/** KaTeX's renderer once it has loaded. Reactive, so a text rendered with its formulas as source renders again. */
const mathRenderer = shallowRef<MathModule | null>(null);
let mathLoading: Promise<void> | null = null;

/** Loads KaTeX, its stylesheet and the formula styles. A failed load can be tried again. */
export function loadMath(): Promise<void> {
  mathLoading ??= import("./markdown-math.ts").then(
    (module) => { mathRenderer.value = module; },
    (error: unknown) => { mathLoading = null; throw error; });
  return mathLoading;
}

/** Whether KaTeX has been asked for and whether it has arrived. Reading it in a computed tracks the arrival. */
export function mathState(): "idle" | "loading" | "ready" {
  return mathRenderer.value ? "ready" : mathLoading ? "loading" : "idle";
}

let modules: Promise<typeof import("./markdown-parser.ts")> | null = null;
const loading: Partial<Record<MarkdownKind, Promise<MarkdownIt>>> = {};
const parsers = shallowReactive<Partial<Record<MarkdownKind, MarkdownIt>>>({});

/** The parser for one kind of text, loaded with markdown-it on first use. A failed load can be tried again. */
export function markdown(kind: MarkdownKind): Promise<MarkdownIt> {
  let parser = loading[kind];
  if (!parser) {
    modules ??= import("./markdown-parser.ts");
    parser = loading[kind] = modules.then(({ MarkdownIt, tex }) => (parsers[kind] = build(kind, MarkdownIt, tex)));
    parser.catch(() => { modules = null; delete loading[kind]; });
  }
  return parser;
}

/** The parser for one kind of text if it has loaded, else null. Reactive, so a component renders as soon as it loads. */
export function loadedMarkdown(kind: MarkdownKind): MarkdownIt | null {
  return parsers[kind] ?? null;
}

/**
 * Renders one text to HTML with a parser from markdown(). `math` says whether the text holds a formula. The first such
 * text starts loading KaTeX; until it arrives, each formula shows as its source. Inside a computed, the text renders
 * again once KaTeX is ready.
 */
export function renderMarkdown(parser: MarkdownIt, text: string): { html: string; math: boolean } {
  const env: MathEnv = {};
  const html = parser.render(text, env);
  if (env.math && !mathRenderer.value) loadMath().catch(() => undefined);
  return { html, math: !!env.math };
}

/** Rendering notes here whether the text held a formula. */
interface MathEnv extends Env { math?: boolean }
/** Each opening delimiter and its closing one, to show a formula as its source. */
const CLOSING: Record<string, string> = { "$": "$", "$$": "$$", "\\(": "\\)", "\\[": "\\]" };
const UNRENDERED = "This formula could not be rendered.";

function build(kind: MarkdownKind, MarkdownIt: typeof import("./markdown-parser.ts").MarkdownIt, tex: typeof import("./markdown-parser.ts").tex): MarkdownIt {
  const md = kind === "message"
    ? new MarkdownIt("zero", { breaks: true }).enable(["escape", "newline"])
    : new MarkdownIt({ html: false, linkify: true, typographer: false, breaks: kind === "answer" });
  if (kind !== "message") md.disable("image");
  // The plugin finds formulas; the two rules below draw them, because they need each formula's delimiters.
  md.use(tex, { delimiters: "all", render: () => "" });
  md.renderer.rules.math_inline = (tokens, idx, _options, env) => formula(md, tokens[idx]!, false, env, "");
  md.renderer.rules.math_block = (tokens, idx, _options, env, self) => formula(md, tokens[idx]!, true, env, self.renderAttrs(tokens[idx]!));
  if (kind === "document") {
    md.core.ruler.push("source_lines", (state) => {
      for (const token of state.tokens) {
        if (token.map && (token.nesting === 1 || ["fence", "code_block", "hr", "math_block"].includes(token.type))) {
          token.attrSet("data-line", String(token.map[0] + 1));
          token.attrSet("data-line-end", String(token.map[1]));
        }
      }
    });
  }
  const link = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    tokens[idx]!.attrSet("target", "_blank");
    tokens[idx]!.attrSet("rel", "noopener noreferrer nofollow");
    return link(tokens, idx, options, env, self);
  };
  return md;
}

/**
 * One formula. KaTeX draws it once loaded; a displayed formula sits in a block that scrolls sideways when it is wider
 * than the text. Before KaTeX arrives, or when KaTeX cannot draw it, the formula shows as its source in monospace,
 * escaped like any text; a formula KaTeX cannot draw also says so in its title.
 */
function formula(md: MarkdownIt, token: Token, display: boolean, env: MathEnv | undefined, attrs: string): string {
  if (env) env.math = true;
  const renderer = mathRenderer.value;
  let title = "";
  if (renderer) {
    try {
      const html = renderer.renderMath(token.content.trim(), display);
      return display ? `<div class="math-display"${attrs}>${html}</div>\n` : html;
    } catch { title = ` title="${UNRENDERED}"`; }
  }
  const close = CLOSING[token.markup] ?? token.markup, kind = title ? "math-source math-error" : "math-source";
  const source = md.utils.escapeHtml(display ? `${token.markup}\n${token.content.trim()}\n${close}` : `${token.markup}${token.content}${close}`);
  return display ? `<pre class="${kind}"${attrs}${title}><code>${source}</code></pre>\n` : `<code class="${kind}"${title}>${source}</code>`;
}
