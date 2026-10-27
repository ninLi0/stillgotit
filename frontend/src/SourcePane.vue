<script setup lang="ts">
import { ref } from "vue";
import MaterialViewer from "./MaterialViewer.vue";
import { placeLabel } from "./locations.ts";
import type { OpenSource } from "./revamp-types.ts";

// A cited source beside the lesson on wide screens: the material's file at the cited place and nothing else (the
// viewer's page-only mode), under a small header with "Open in Materials" and a close button. The lesson owns the
// pane's state and focus: it opens the pane, moves focus here, and returns focus to the opener when the pane closes.
// Escape inside the pane closes it.
const props = defineProps<{ source: OpenSource; titles: Record<string, string> }>();
const emit = defineEmits<{ close: []; "open-materials": [source: OpenSource] }>();
const root = ref<HTMLElement | null>(null);
defineExpose({ focus: () => root.value?.focus(), element: root });
</script>

<template>
  <aside ref="root" class="source-pane" tabindex="-1" aria-labelledby="source-pane-title" @keydown.esc.stop.prevent="emit('close')">
    <header class="pane-head">
      <div class="pane-heading">
        <p class="eyebrow">Source · {{ placeLabel(props.source.location) }}</p>
        <h2 id="source-pane-title" class="display">{{ props.titles[props.source.material] || 'Course material' }}</h2>
      </div>
      <button type="button" class="quiet open-materials" @click="emit('open-materials', props.source)">Open in Materials</button>
      <button type="button" class="pane-close" aria-label="Close the source" @click="emit('close')"><span aria-hidden="true">✕</span></button>
    </header>
    <MaterialViewer :key="`${props.source.material}\n${props.source.location}`" class="pane-page" mode="page" :material="props.source.material"
      :title="props.titles[props.source.material] ?? ''" :skills="[]" :initial-location="props.source.location" />
  </aside>
</template>

<style scoped>
/* A card in the rail's column, with the rail's edge on its left. */
.source-pane { display: flex; flex-direction: column; gap: 12px; min-width: 0; min-height: 0; padding: 16px 16px 18px; overflow: hidden; border-left: 1px solid var(--lesson-rail-edge); background: var(--card); color: var(--ink); animation: sgFade var(--dur-enter) var(--ease-enter); }
.source-pane:focus { outline: none; }
.source-pane:focus-visible { outline: 3px solid var(--ring); outline-offset: -3px; }
.pane-head { display: flex; align-items: flex-start; gap: 8px 12px; flex-wrap: wrap; }
.pane-heading { flex: 1; min-width: 160px; }
.pane-heading .eyebrow { margin-bottom: 4px; }
.pane-heading h2 { margin: 0; font-size: 21px; overflow-wrap: anywhere; }
.open-materials { flex: none; padding: 8px 0; white-space: nowrap; }
.pane-close { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; background: var(--inset); color: var(--ink); font-size: 15px; line-height: 1; }
.pane-close:hover { background: var(--inset-2); }
.pane-page { flex: 1; min-height: 0; }
</style>
