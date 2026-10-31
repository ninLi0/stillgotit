<script setup lang="ts">
import { computed, useId } from "vue";
import { widgetHeading, type Widget } from "../../src/answer-widgets.ts";
import type { OpenSource } from "./revamp-types.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
import InfoBubble from "./InfoBubble.vue";
import SourcesUsed from "./SourcesUsed.vue";
import WidgetChoice from "./WidgetChoice.vue";
import WidgetSlider from "./WidgetSlider.vue";
import WidgetSteps from "./WidgetSteps.vue";
import WidgetTable from "./WidgetTable.vue";

// One interactive example in a lesson answer (design/compositions/Learning.md, "Interactive examples"), in place of its
// block in the answer's Markdown. A figure labelled "Illustration" and the example's title holds the example of its kind
// and, below it, the "From <source> ↗" chip the answer's citations use, which opens the passage it illustrates.
// `titles`, `deleted` and `idPrefix` pass to that chip, and its `open` comes back out, as for the answer's own sources.
const props = defineProps<{ widget: Widget; titles: Record<string, string>; deleted: readonly string[]; idPrefix: string }>();
const emit = defineEmits<{ open: [source: OpenSource] }>();
const id = useId();
const heading = computed(() => widgetHeading(props.widget));
// The host checked that the source names one of the lesson's materials at a valid location, as it checks a citation.
type Citation = StillGotItHttp["/learning/read"]["output"]["data"]["sessions"][number]["citations"][number];
const citations = computed(() => [props.widget.source as Citation]);
const ABOUT = "The tutor made this example to illustrate the passage named below it. It is not a quotation from your materials, and what you do in it stays on this page: it is not saved and does not count as practice.";
</script>

<template>
  <figure class="answer-widget" :class="`kind-${widget.kind}`" :aria-labelledby="`${id}-tag ${id}-title`">
    <figcaption class="widget-head">
      <span :id="`${id}-tag`" class="widget-tag">Illustration</span>
      <span :id="`${id}-title`" class="widget-title">{{ heading }}</span>
      <InfoBubble class="widget-about" label="About this example" :text="ABOUT" />
    </figcaption>
    <WidgetSlider v-if="widget.kind === 'slider'" :widget="widget" />
    <WidgetTable v-else-if="widget.kind === 'table'" :widget="widget" :labelledby="`${id}-title`" />
    <WidgetSteps v-else-if="widget.kind === 'steps'" :widget="widget" />
    <WidgetChoice v-else :widget="widget" />
    <SourcesUsed class="widget-source" compact :citations="citations" :titles="titles" :deleted="deleted" :id-prefix="idPrefix" @open="emit('open', $event)" />
  </figure>
</template>

<style scoped>
/* The example sits in the answer as its own card in the lesson's lavender, with its own line height, so its controls
   keep their size inside the answer's taller text. */
.answer-widget{margin:0;padding:14px 16px 12px;border:1px solid var(--lesson-card-ring);border-radius:14px;background:var(--lesson-rail);color:var(--ink);font-size:14px;line-height:1.5;display:flex;flex-direction:column;gap:12px;min-width:0}
.widget-head{position:relative;display:flex;flex-wrap:wrap;align-items:center;gap:6px 10px;margin:0}
.widget-tag{flex:none;padding:2px 8px;border-radius:999px;background:var(--dawn-soft);color:var(--dawn-soft-text);font:500 11px/1.4 var(--font-display);letter-spacing:.6px;text-transform:uppercase}
.widget-title{flex:1 1 12em;min-width:0;font-size:15px;font-weight:700;line-height:1.4;overflow-wrap:anywhere}
.widget-about{flex:none;margin-left:-4px}
/* The ⓘ sits at the head's right end, so its bubble opens across the head's width rather than past the card's edge. */
.widget-head .widget-about{position:static}
.widget-head .widget-about :deep(.info-bubble){left:0;right:0;width:auto}
.answer-widget .widget-source :deep(.source-list){margin-top:0}
/* Controls shared by the kinds: a quiet text button and a small secondary button in the lesson's lavender. */
.answer-widget :deep(.widget-quiet){border:0;background:transparent;padding:4px 0;color:var(--dawn-soft-text);font-size:13px;font-weight:600;text-decoration:underline;text-underline-offset:3px}
.answer-widget :deep(.widget-quiet:hover){color:var(--ink)}
.answer-widget :deep(.widget-action){display:inline-flex;align-items:center;min-height:36px;padding:0 14px;border:0;border-radius:10px;background:var(--dawn-soft);color:var(--dawn-soft-text);font-size:13px;font-weight:700}
.answer-widget :deep(.widget-action:hover){background:var(--dawn-nav)}
.answer-widget :deep(button:focus-visible){outline:2px solid var(--focus);outline-offset:3px}
@media(max-width:520px){.answer-widget{padding:12px 12px 10px}}
</style>
