<script setup lang="ts">
import { onBeforeUnmount, ref } from "vue";
import ListenButton from "./ListenButton.vue";
// The small actions under one tutor answer: Copy puts the answer's text on the clipboard, and Listen reads it aloud.
// `messageKey`, `what` and `describedby` pass to ListenButton; `what` also names the answer for Copy, such as "tutor reply".
const props = defineProps<{ text: string; messageKey: string; what: string; describedby?: string }>();
const copied = ref<"" | "done" | "failed">("");
let reset: ReturnType<typeof setTimeout> | undefined;
/** Browsers without the clipboard API, or pages it refuses, copy through a hidden text box. Focus returns to the button. */
function copyBySelection(text: string): boolean {
  const before = document.activeElement as HTMLElement | null, box = document.createElement("textarea");
  box.value = text; box.setAttribute("readonly", ""); box.style.position = "fixed"; box.style.opacity = "0";
  document.body.append(box); box.select();
  let done = false;
  try { done = document.execCommand("copy"); } catch { done = false; }
  box.remove(); before?.focus();
  return done;
}
async function copy() {
  let done = false;
  try { await navigator.clipboard.writeText(props.text); done = true; } catch { done = copyBySelection(props.text); }
  copied.value = done ? "done" : "failed";
  clearTimeout(reset); reset = setTimeout(() => { copied.value = ""; }, 2000);
}
onBeforeUnmount(() => clearTimeout(reset));
</script>

<template>
  <div class="reply-actions">
    <button type="button" class="reply-action" :disabled="!text.trim()" :aria-label="`Copy the ${what}`" @click="copy">{{ copied === 'done' ? 'Copied' : copied === 'failed' ? 'Copy failed' : 'Copy' }}</button>
    <ListenButton :message-key="messageKey" :text="text" :what="what" :describedby="describedby" />
    <slot />
    <span class="sr-only" role="status">{{ copied === 'done' ? `Copied the ${what}.` : copied === 'failed' ? 'The browser did not allow copying. Select the text to copy it.' : '' }}</span>
  </div>
</template>

<style scoped>
.reply-actions{display:flex;align-items:center;gap:2px}
.reply-action{white-space:nowrap;flex:none;border:0;background:transparent;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600;color:var(--faint)}
.reply-action:hover:not(:disabled){background:var(--inset);color:var(--ink)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
</style>
