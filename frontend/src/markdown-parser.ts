// markdown-it and the formula finder (@mdit/plugin-tex), which markdown.ts loads as one chunk the first time a text
// needs Markdown. KaTeX is not here: it loads separately, only for a text that holds a formula (markdown-math.ts).
export { default as MarkdownIt } from "markdown-it";
export { tex } from "@mdit/plugin-tex";
