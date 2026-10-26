<script setup lang="ts">
import { computed } from "vue";
import { loadedMarkdown, markdown, renderMarkdown } from "./markdown.ts";
// A tutor answer ("answer") or the learner's own message ("message"), rendered with its formulas by markdown.ts, which
// also sets what each kind reads as Markdown. Until the renderer has loaded, or if it cannot load, the text shows as
// written, with its line breaks.
const props = withDefaults(defineProps<{ text: string; kind?: "answer" | "message" }>(), { kind: "answer" });
markdown(props.kind).catch(() => undefined);
const html = computed(() => {
  const parser = loadedMarkdown(props.kind);
  return parser ? renderMarkdown(parser, props.text).html : null;
});
</script>

<template>
  <div v-if="html !== null" class="markdown-text" v-html="html" />
  <div v-else class="markdown-text"><p class="as-written">{{ text }}</p></div>
</template>

<style scoped>
/* Size and line height come from the place that shows the text. Blocks sit 14 px apart, the gap the lesson keeps
   between a paragraph and a code block. Raw HTML is off, so only Markdown's own elements appear. */
.markdown-text :deep(> *), .markdown-text :deep(:is(li, blockquote) > p) { margin: 0; }
.markdown-text :deep(> * + *) { margin-top: 14px; }
.as-written { white-space: pre-wrap; }
.markdown-text :deep(ul), .markdown-text :deep(ol) { padding-left: 22px; }
.markdown-text :deep(li + li) { margin-top: 4px; }
.markdown-text :deep(:is(h1, h2, h3, h4, h5, h6)) { font-family: var(--font-body); font-size: 1.07em; font-weight: 700; line-height: 1.4; color: inherit; text-wrap: wrap; }
.markdown-text :deep(pre) { padding: 14px 16px; border-radius: 12px; background: var(--inset); border: 1px solid var(--line); font: 13px/1.7 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; color: var(--ink); }
.markdown-text :deep(pre code) { font: inherit; }
.markdown-text :deep(:not(pre) > code) { padding: 1px 5px; border-radius: 5px; background: var(--inset); font-size: .87em; overflow-wrap: anywhere; }
.markdown-text :deep(blockquote) { padding-left: 14px; border-left: 3px solid var(--ring); color: var(--muted); }
.markdown-text :deep(table) { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; font-size: 14px; }
.markdown-text :deep(th), .markdown-text :deep(td) { padding: 6px 10px; border: 1px solid var(--line); text-align: left; }
.markdown-text :deep(hr) { height: 1px; border: 0; background: var(--card-border); }
.markdown-text :deep(a) { color: var(--review-text); text-underline-offset: 3px; }
</style>
