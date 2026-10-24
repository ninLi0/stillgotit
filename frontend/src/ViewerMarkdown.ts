import type { MarkdownIt } from "markdown-it";

// Markdown for the Materials viewer, loaded only when a Markdown file is shown. Raw HTML is off, so the learner's file
// cannot add markup or scripts; links are recognised in plain text and open in a new tab. Images are off, so a file
// cannot make the browser fetch pictures from other sites. Each block carries its source line numbers
// (data-line, data-line-end) so the viewer can scroll to and highlight a cited "lines/A-B" location.

let parser: Promise<MarkdownIt> | null = null;

export function markdown(): Promise<MarkdownIt> {
  parser ??= import("markdown-it").then(({ default: MarkdownIt }) => {
    const md = new MarkdownIt({ html: false, linkify: true, typographer: false });
    md.disable("image");
    md.core.ruler.push("source_lines", (state) => {
      for (const token of state.tokens) {
        if (token.map && (token.nesting === 1 || token.type === "fence" || token.type === "code_block" || token.type === "hr")) {
          token.attrSet("data-line", String(token.map[0] + 1));
          token.attrSet("data-line-end", String(token.map[1]));
        }
      }
    });
    const link = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
    md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
      tokens[idx]!.attrSet("target", "_blank");
      tokens[idx]!.attrSet("rel", "noopener noreferrer nofollow");
      return link(tokens, idx, options, env, self);
    };
    return md;
  });
  parser.catch(() => { parser = null; });
  return parser;
}
