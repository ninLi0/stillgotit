<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { isSpeaking, listenUnavailable, speak, speakingId, stopSpeaking } from "./speech.ts";
// `messageKey` identifies the message while it is read. `what` names it for screen readers, such as "lesson" or "hint".
// `describedby` names the element that explains why listening is unavailable.
const props = defineProps<{ messageKey: string; text: string; what: string; describedby?: string }>();
const playing = computed(() => speakingId.value === props.messageKey);
// A second press always stops, even if the browser lost track of which message is playing.
function toggle() { if (playing.value || isSpeaking()) stopSpeaking(); else speak(props.messageKey, props.text); }
function onKey(event: KeyboardEvent) { if (event.key === "Escape" && playing.value) stopSpeaking(); }
onMounted(() => document.addEventListener("keydown", onKey));
onBeforeUnmount(() => { document.removeEventListener("keydown", onKey); if (playing.value) stopSpeaking(); });
// A message that leaves the screen stops being read.
watch(() => props.messageKey, (_next, previous) => { if (speakingId.value === previous) stopSpeaking(); });
onBeforeUnmount(() => { if (playing.value) stopSpeaking(); });
</script>

<template>
  <button type="button" class="message-action listen-button" :class="{ playing }" :disabled="!playing && (!!listenUnavailable || !text.trim())"
    :aria-label="playing ? `Stop reading the ${what} aloud` : `Listen to the ${what}`"
    :aria-describedby="listenUnavailable ? describedby : undefined" @click="toggle">{{ playing ? 'Stop' : 'Listen' }}</button>
</template>

<style scoped>
.listen-button{white-space:nowrap;flex:none;border:0;background:transparent;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600;color:var(--faint);text-decoration:none}
.listen-button:hover:not(:disabled){background:var(--inset);color:var(--ink)}
.playing{color:var(--dawn-soft-text);background:var(--dawn-soft)}
</style>
