<script setup lang="ts">
import { ref, useId } from "vue";
import { focusedControl } from "./focus.ts";
import InfoBubble from "./InfoBubble.vue";
import TutorPanel from "./TutorPanel.vue";
import { TUTOR_ABOUT } from "./tutor-choice.ts";

// The tutor button in the lesson's message box opens this small dialog (design/visual-design.md, "The lesson's
// conversation"). It holds only the Tutor panel, the model and the thinking level; Settings keeps its own Tutor
// section. Save keeps the choice and closes the dialog. Cancel, the ✕ and Escape close it without saving. While a
// change is saving, the dialog stays open so the learner sees its result. Focus starts on the chosen model and goes
// back to the button that opened the dialog.
const id = useId();
const dialog = ref<HTMLDialogElement | null>(null), panel = ref<InstanceType<typeof TutorPanel> | null>(null);
let opener: HTMLElement | SVGElement | null = null;

async function open() {
  if (!dialog.value || dialog.value.open) return;
  opener = focusedControl();
  dialog.value.showModal();
  await panel.value?.open();
}
function close() { if (!panel.value?.busy) dialog.value?.close(); }
function cancel(event: Event) { if (panel.value?.busy) event.preventDefault(); }
// A saved choice is a finished action, so the dialog closes; the button that opened it already shows the new choice.
function saved() { dialog.value?.close(); }
function closed() {
  // Focus goes back to the opener, unless something outside the dialog already took it.
  const back = opener; opener = null;
  const active = document.activeElement;
  if ((!active || active === document.body || dialog.value?.contains(active)) && back?.isConnected && back.getClientRects().length) back.focus();
}
defineExpose({ open });
</script>

<template>
  <dialog ref="dialog" class="tutor-dialog" :aria-labelledby="`${id}-title`" @cancel="cancel" @close="closed">
    <header class="tutor-dialog-head">
      <div class="head-names">
        <p class="eyebrow">Tutor</p>
        <div class="title-row"><h2 :id="`${id}-title`" class="display">Model and thinking</h2><InfoBubble label="About the tutor" :text="TUTOR_ABOUT" /></div>
      </div>
      <button type="button" class="dialog-close" aria-label="Close the tutor choice" :disabled="panel?.busy" @click="close"><span aria-hidden="true">✕</span></button>
    </header>
    <TutorPanel ref="panel" inline untitled @saved="saved">
      <template #actions><button type="button" class="quiet cancel" :disabled="panel?.busy" @click="close">Cancel</button></template>
    </TutorPanel>
  </dialog>
</template>

<style scoped>
.tutor-dialog { border: 0; border-radius: 22px; padding: 22px 24px 24px; width: min(560px, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow-y: auto;
  box-shadow: 0 20px 50px rgb(var(--shadow) / .18); color: var(--ink); background: var(--card); }
.tutor-dialog::backdrop { background: var(--backdrop); }
.tutor-dialog-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
.head-names { min-width: 0; }
.title-row { position: relative; display: flex; align-items: center; gap: 6px; margin-top: 2px; }
/* The ⓘ bubble opens under the title row from its left edge, so on a phone it stays inside the dialog. */
.title-row :deep(.info-wrap) { position: static; }
.title-row h2 { margin: 0; font-size: 24px; }
.dialog-close { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border: 0; border-radius: 10px;
  background: var(--inset); color: var(--ink); font-size: 16px; line-height: 1; }
.dialog-close:hover:not(:disabled) { background: var(--inset-2); }
.cancel { min-height: 40px; padding: 6px 8px; }
@media (max-width: 520px) {
  .tutor-dialog { padding: 18px 16px 20px; }
  .title-row h2 { font-size: 21px; }
}
</style>
