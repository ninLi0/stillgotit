<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import PixelIcon from "./PixelIcon.vue";

// Explanatory copy lives behind a pixel ⓘ button (design/revamp/README.md): clicking it opens one dark bubble below
// the button; only one bubble is open at a time across the page; Escape and a click elsewhere close it. The text is
// also available to assistive technology through the button's description, so nothing is hidden from a screen reader.
const props = defineProps<{ text: string; label?: string }>();
const id = `info-${Math.random().toString(36).slice(2, 9)}`;
const open = ref(false);
const root = ref<HTMLElement | null>(null);

// The one open bubble, shared by every instance.
const current = (globalThis as { __sgInfo?: { value: string | null } }).__sgInfo ??= { value: null };
const isOpen = computed(() => open.value && current.value === id);

function toggle() {
  if (isOpen.value) { open.value = false; current.value = null; return; }
  current.value = id; open.value = true;
}
function onDocumentClick(event: MouseEvent) { if (isOpen.value && root.value && !root.value.contains(event.target as Node)) { open.value = false; current.value = null; } }
function onKey(event: KeyboardEvent) { if (event.key === "Escape" && isOpen.value) { open.value = false; current.value = null; (root.value?.querySelector("button") as HTMLElement | null)?.focus(); } }
watch(isOpen, (now) => {
  if (now) { document.addEventListener("click", onDocumentClick, true); document.addEventListener("keydown", onKey); }
  else { document.removeEventListener("click", onDocumentClick, true); document.removeEventListener("keydown", onKey); }
});
// Another instance opening closes this one.
watch(() => current.value, (value) => { if (value !== id) open.value = false; });
onBeforeUnmount(() => { document.removeEventListener("click", onDocumentClick, true); document.removeEventListener("keydown", onKey); if (current.value === id) current.value = null; });
</script>

<template>
  <span ref="root" class="info-wrap">
    <button type="button" class="info-button" :aria-label="label ?? 'How this works'" :aria-expanded="isOpen" :aria-controls="id" :aria-describedby="`${id}-text`" @click.stop="toggle">
      <PixelIcon name="info" :size="20" />
    </button>
    <span :id="`${id}-text`" class="sr-only">{{ text }}</span>
    <span v-if="isOpen" :id="id" class="info-bubble" role="note">{{ text }}</span>
  </span>
</template>

<style scoped>
.info-wrap { position: relative; display: inline-flex; align-items: center; }
.info-button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; background: transparent; }
.info-button:hover { background: #F1F1EE; }
.info-bubble { position: absolute; top: calc(100% + 6px); left: 0; z-index: 40; width: 260px; padding: 10px 12px; border-radius: 12px; background: #1C1C1D; color: #fff; font-size: 12px; line-height: 1.5; box-shadow: 0 10px 24px rgba(0, 0, 0, .22); animation: sgRise var(--dur-enter) var(--ease-enter); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
