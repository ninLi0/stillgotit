<script setup lang="ts">
import { computed, ref, useId } from "vue";
import { focusedControl } from "./focus.ts";
import TreePreview from "./TreePreview.vue";
import { TREE_KINDS, defaultKind, kindFor, surpriseKind, type TreeKind } from "./tree-kinds.ts";

// The tree picker (design/visual-design.md, "Tree kinds"): a small dialog with a drawn preview and the name of every
// kind, and "Surprise me", which picks a kind other than the current one at random. A choice applies at once and
// closes the dialog. Choosing the unit's default kind clears the saved choice, so `choose` receives null for it.
const props = defineProps<{ unit: string; topic: string; chosen: string | null }>();
const emit = defineEmits<{ choose: [kind: string | null] }>();

const id = useId();
const dialog = ref<HTMLDialogElement | null>(null);
const current = computed(() => kindFor(props.unit, props.chosen));
const fallback = computed(() => defaultKind(props.unit));
// The caption under the tiles describes the kind under the pointer or the focus, and the current kind otherwise.
const pointed = ref<TreeKind | null>(null);
const described = computed(() => pointed.value ?? current.value);
let opener: HTMLElement | SVGElement | null = null;

function open() {
  if (!dialog.value || dialog.value.open) return;
  opener = focusedControl();
  pointed.value = null;
  dialog.value.showModal();
  // Focus starts on the current kind, so the learner sees where they are.
  dialog.value.querySelector<HTMLButtonElement>("[aria-current='true']")?.focus();
}
function close() { dialog.value?.close(); }
function onClose() {
  // Focus goes back to the button that opened the picker, unless something else already took it.
  const active = document.activeElement;
  if ((!active || active === document.body) && opener?.isConnected) opener.focus();
}
function pick(kind: TreeKind) {
  if (kind.id !== current.value.id) emit("choose", kind.id === fallback.value.id ? null : kind.id);
  close();
}
function surprise() { pick(surpriseKind(current.value.id)); }
defineExpose({ open });
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="tree-picker" :aria-labelledby="`${id}-title`" :aria-describedby="`${id}-note`" @close="onClose">
      <header class="picker-head">
        <div class="picker-names">
          <p class="eyebrow picker-topic">{{ topic }}</p>
          <h2 :id="`${id}-title`" class="display picker-title">Choose a tree</h2>
        </div>
        <button type="button" class="picker-close" aria-label="Close the tree picker" @click="close"><span aria-hidden="true">✕</span></button>
      </header>
      <p :id="`${id}-note`" class="picker-note">The tree only changes how this topic looks. Its leaves still show your skills.</p>
      <ul class="picker-grid" aria-label="Tree kinds">
        <li v-for="kind in TREE_KINDS" :key="kind.id">
          <button type="button" class="picker-tile" :aria-current="kind.id === current.id ? 'true' : undefined" :aria-describedby="`${id}-${kind.id}`"
            @click="pick(kind)" @focus="pointed = kind" @blur="pointed = null" @mouseenter="pointed = kind" @mouseleave="pointed = null">
            <TreePreview :kind="kind" :size="88" :leaves="['bud', 'leaf', 'bloom']" />
            <span class="tile-name">{{ kind.name }}</span>
            <span v-if="kind.id === current.id" class="tile-tag now">Current</span>
            <span v-else-if="kind.id === fallback.id" class="tile-tag">Default</span>
          </button>
          <span :id="`${id}-${kind.id}`" class="sr-only">{{ kind.description }}{{ kind.id === fallback.id && kind.id === current.id ? " This is the topic’s default tree." : "" }}</span>
        </li>
      </ul>
      <p class="picker-caption" aria-hidden="true"><strong>{{ described.name }}.</strong> {{ described.description }}</p>
      <div class="picker-actions">
        <button type="button" class="secondary meadow" @click="surprise">Surprise me</button>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.tree-picker { border: 0; border-radius: 22px; padding: 22px; width: min(520px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto;
  box-shadow: 0 20px 50px rgba(0, 0, 0, .18); color: var(--ink); background: #FFFFFF; }
.tree-picker::backdrop { background: rgba(21, 21, 21, .35); }
.picker-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.picker-names { min-width: 0; }
.picker-topic { overflow-wrap: anywhere; }
.picker-title { margin: 2px 0 0; font-size: 24px; }
.picker-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 10px;
  background: var(--inset); color: var(--ink); font-size: 16px; line-height: 1; }
.picker-close:hover { background: var(--inset-2); }
.picker-note { margin: 8px 0 14px; font-size: 14px; line-height: 1.5; color: var(--soft); }
.picker-grid li { position: relative; }
.picker-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 0; padding: 0; list-style: none; }
.picker-tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; padding: 8px 4px 10px; border: 0; border-radius: 14px;
  background: #FFFFFF; box-shadow: 0 0 0 1px var(--ring); transition: background-color var(--dur-quick) var(--ease-enter), box-shadow var(--dur-quick) var(--ease-enter); }
.picker-tile:hover { background: var(--inset); }
.picker-tile[aria-current="true"] { background: var(--meadow-soft); box-shadow: 0 0 0 2px var(--meadow-edge); }
.picker-tile .tree-preview { border-radius: 8px; }
.tile-name { font-size: 14px; font-weight: 700; line-height: 1.2; }
.tile-tag { position: absolute; top: 4px; right: 4px; padding: 1px 6px; border-radius: 999px; background: var(--inset-2); color: var(--soft); font-size: 11px; font-weight: 700; line-height: 1.5; }
.tile-tag.now { background: var(--meadow-edge); color: #FFFFFF; }
.picker-caption { min-height: 42px; margin: 12px 0 0; font-size: 14px; line-height: 1.5; color: var(--soft); }
.picker-caption strong { color: var(--ink); }
.picker-actions { display: flex; justify-content: flex-start; margin-top: 10px; }
.picker-actions .secondary { min-height: 40px; padding: 0 16px; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 520px) {
  .tree-picker { padding: 18px 16px; }
  .picker-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .picker-tile { gap: 4px; padding: 6px 4px 8px; }
}
</style>
