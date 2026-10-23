<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from "vue";
import { listenUnavailable, speak, speakingId, stopSpeaking } from "./speech.ts";
// `messageKey` identifies the message while it is read. `what` names it for screen readers, such as "lesson" or "hint".
// `describedby` names the element that explains why listening is unavailable.
const props = defineProps<{ messageKey: string; text: string; what: string; describedby?: string }>();
const playing = computed(() => speakingId.value === props.messageKey);
function toggle() { if (playing.value) stopSpeaking(); else speak(props.messageKey, props.text); }
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
.listen-button{white-space:nowrap;flex:none}
.playing{color:var(--primary);font-weight:600}
</style>
