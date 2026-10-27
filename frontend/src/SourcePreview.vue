<script setup lang="ts">
import { nextTick, ref, shallowRef } from "vue";
import MaterialViewer from "./MaterialViewer.vue";
import { placeLabel } from "./locations.ts";
import type { AskAboutPage, OpenSource } from "./revamp-types.ts";

// A cited source previewed in place on the lesson page on narrow screens (wide screens use SourcePane.vue beside the
// conversation): a dialog holding the viewer in its page-only mode, opened at the cited place and showing only the file
// there. "Open in Materials" leaves for the full page. Focus moves to the dialog when it opens and returns to the
// control that opened it when it closes.
const props = defineProps<{ titles: Record<string, string> }>();
const emit = defineEmits<{ "open-materials": [source: OpenSource]; ask: [request: AskAboutPage] }>();
const dialog = ref<HTMLDialogElement | null>(null), source = shallowRef<OpenSource | null>(null);
let opener: HTMLElement | null = null;

async function open(next: OpenSource) {
  const active = document.activeElement;
  opener = active instanceof HTMLElement && active !== document.body ? active : null;
  source.value = next;
  await nextTick();
  if (!dialog.value?.open) dialog.value?.showModal();
  dialog.value?.focus();
}
function close() { dialog.value?.close(); }
/** Runs on every close: the ✕, Escape, a click on the backdrop, or leaving for Materials. */
function closed() {
  source.value = null;
  const back = opener; opener = null;
  if (back?.isConnected && back.getClientRects().length) back.focus();
}
// A click on the dialog element outside its box is a click on the backdrop. (A click in its padding also targets the
// dialog itself, so the position decides.) Keyboard "clicks" have no position and never close it.
function backdrop(event: MouseEvent) {
  const box = dialog.value?.getBoundingClientRect();
  if (!box || event.target !== dialog.value || event.detail === 0) return;
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close();
}
// Leaving for Materials, or asking about the page, moves focus on from there, so it does not return to the opener.
// (The dialog reports its close a moment later, after that move.)
function openMaterials() { const shown = source.value; opener = null; close(); if (shown) emit("open-materials", shown); }
function ask(request: AskAboutPage) { opener = null; close(); emit("ask", request); }
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="source-preview" aria-labelledby="source-preview-title" tabindex="-1" @close="closed" @click="backdrop">
    <template v-if="source">
      <header class="preview-head">
        <div class="preview-heading">
          <p class="eyebrow">Source · {{ placeLabel(source.location) }}</p>
          <h2 id="source-preview-title" class="display">{{ titles[source.material] || 'Course material' }}</h2>
        </div>
        <button type="button" class="quiet open-materials" @click="openMaterials">Open in Materials</button>
        <button type="button" class="preview-close" aria-label="Close the preview" @click="close"><span aria-hidden="true">✕</span></button>
      </header>
      <MaterialViewer :key="`${source.material}\n${source.location}`" class="preview-page" mode="page" :material="source.material" :title="props.titles[source.material] ?? ''" :skills="[]" :initial-location="source.location" @ask="ask" />
    </template>
  </dialog>
</template>

<style scoped>
/* The app's dialog: white, 22 px corners, a soft shadow over a dimmed page; style.css scales it in as it opens. */
.source-preview { border: 0; border-radius: 22px; padding: 20px 22px 22px; width: min(720px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto; box-shadow: 0 20px 50px rgb(var(--shadow) / .18); color: var(--ink); background: var(--card); }
.source-preview::backdrop { background: var(--backdrop); }
/* The page-only viewer fills the dialog's height, so the dialog keeps one size from page to page. */
.preview-page { height: min(720px, calc(100dvh - 150px)); min-height: 320px; }
.preview-head { display: flex; align-items: flex-start; gap: 8px 16px; flex-wrap: wrap; margin-bottom: 14px; }
.preview-heading { flex: 1; min-width: 200px; }
.preview-heading .eyebrow { margin-bottom: 4px; }
.preview-heading h2 { margin: 0; font-size: 24px; overflow-wrap: anywhere; }
.open-materials { flex: none; padding: 8px 0; white-space: nowrap; }
.preview-close { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 10px; background: var(--inset); color: var(--ink); font-size: 16px; line-height: 1; }
.preview-close:hover { background: var(--inset-2); }
@media (max-width: 520px) {
  .source-preview { width: calc(100vw - 16px); max-height: calc(100dvh - 16px); padding: 16px 14px 14px; border-radius: 18px; }
  .preview-heading { min-width: 0; flex-basis: calc(100% - 52px); }
  .preview-heading h2 { font-size: 21px; }
  .open-materials { order: 3; }
}
</style>
