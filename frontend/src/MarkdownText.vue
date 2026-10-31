<script setup lang="ts">
import { computed, defineAsyncComponent, h } from "vue";
import { loadedMarkdown, markdown, renderMarkdown } from "./markdown.ts";
import { answerParts, readWidget, type Widget } from "../../src/answer-widgets.ts";
import type { OpenSource } from "./revamp-types.ts";
// The example components load only when an answer holds an example, so a learner who never sees one never loads them.
const AnswerWidget = defineAsyncComponent({ loader: () => import("./AnswerWidget.vue"),
  errorComponent: { render: () => h("p", { class: "example-missing" }, "This interactive example could not be loaded. Reload the page to try again.") } });
// A tutor answer ("answer") or the learner's own message ("message"), rendered with its formulas by markdown.ts, which
// also sets what each kind reads as Markdown. Until the renderer has loaded, or if it cannot load, the text shows as
// written, with its line breaks.
//
// `examples` is given for a lesson answer, the only text that can hold interactive examples. Each example block then
// shows as an AnswerWidget in its place, and the Markdown around it renders as before; `examples` carries what the
// example's source chip needs, and the chip's `open` comes back out. A text without a block renders exactly as it did
// before examples existed. A block the page cannot read is left out, as the host would have dropped it.
export interface ExampleContext { titles: Record<string, string>; deleted: readonly string[]; idPrefix: string }
const props = withDefaults(defineProps<{ text: string; kind?: "answer" | "message"; examples?: ExampleContext | null }>(), { kind: "answer", examples: null });
const emit = defineEmits<{ open: [source: OpenSource] }>();
markdown(props.kind).catch(() => undefined);
const render = (text: string) => { const parser = loadedMarkdown(props.kind); return parser ? renderMarkdown(parser, text).html : null; };
// Read as a flag, so a new context object for the same answer does not split and read the answer again.
const withExamples = computed(() => !!props.examples);
type Part = { kind: "text"; text: string } | { kind: "widget"; widget: Widget };
const parts = computed<Part[] | null>(() => {
  if (!withExamples.value) return null;
  const split = answerParts(props.text);
  if (split.length === 1 && split[0]!.kind === "text") return null;
  return split.flatMap((part): Part[] => {
    if (part.kind === "text") return part.text.trim() ? [{ kind: "text", text: part.text }] : [];
    const read = part.closed ? readWidget(part.body) : null;
    return read?.ok ? [{ kind: "widget", widget: read.widget }] : [];
  });
});
const html = computed(() => parts.value ? null : render(props.text));
const partHtml = computed(() => parts.value?.map((part) => part.kind === "text" ? render(part.text) : null) ?? []);
</script>

<template>
  <div v-if="parts" class="markdown-parts">
    <template v-for="(part, index) in parts" :key="index">
      <AnswerWidget v-if="part.kind === 'widget'" :widget="part.widget" :titles="examples!.titles" :deleted="examples!.deleted" :id-prefix="`${examples!.idPrefix}-${index}`" @open="emit('open', $event)" />
      <div v-else-if="partHtml[index] != null" class="markdown-text" v-html="partHtml[index]" />
      <div v-else class="markdown-text"><p class="as-written">{{ part.text.trim() }}</p></div>
    </template>
  </div>
  <div v-else-if="html !== null" class="markdown-text" v-html="html" />
  <div v-else class="markdown-text"><p class="as-written">{{ text }}</p></div>
</template>

<style scoped>
/* Size and line height come from the place that shows the text. Blocks sit 14 px apart, the gap the lesson keeps
   between a paragraph and a code block. Raw HTML is off, so only Markdown's own elements appear. */
.markdown-text :deep(> *), .markdown-text :deep(:is(li, blockquote) > p) { margin: 0; }
.markdown-text :deep(> * + *) { margin-top: 14px; }
/* An answer with an example: its Markdown and its example, 14 px apart like the blocks within the Markdown. */
.markdown-parts > * + * { margin-top: 14px; }
.as-written { white-space: pre-wrap; }
.example-missing { margin: 0; color: var(--muted); font-size: 13px; }
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
