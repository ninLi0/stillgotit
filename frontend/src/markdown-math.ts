import katex from "katex";
import "katex/dist/katex.min.css";
import "./markdown-math.css";

// KaTeX, loaded by markdown.ts only when a text holds a formula. Its stylesheet comes with it. The build copies KaTeX's
// fonts as separate files (frontend/vite.config.ts), and the browser fetches a font only when a formula uses it.

/** Draws one formula as HTML, with MathML for screen readers. Throws when KaTeX cannot draw it. */
export function renderMath(source: string, display: boolean): string {
  let refused = false;
  const html = katex.renderToString(source, {
    displayMode: display, throwOnError: true, strict: "ignore", output: "htmlAndMathml",
    // Sizes and macro expansion are capped, so a formula cannot cover the page or stall it.
    maxSize: 20, maxExpand: 1000,
    // A formula cannot add links, images, classes or styles. KaTeX would show such a command in red; the formula is
    // refused instead, so it shows as its source.
    trust: () => { refused = true; return false; },
  });
  if (refused) throw new Error("The formula asks for a link, an image or HTML.");
  return html;
}
