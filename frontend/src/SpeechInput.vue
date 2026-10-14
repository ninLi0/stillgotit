<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { hostRequest } from "./host-api.ts";
const props = defineProps<{ disabled?: boolean; active?: boolean; compact?: boolean }>();
const emit = defineEmits<{ transcript: [text: string]; error: [message: string]; recording: [active: boolean] }>();
const recording = ref(false), transcribing = ref(false);
let recorder: MediaRecorder | null = null, stream: MediaStream | null = null, mounted = true;
function release() { stream?.getTracks().forEach((track) => track.stop()); stream = null; }
async function toggle() {
  if (recording.value) { transcribing.value = true; recorder?.stop(); recording.value = false; return; }
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("This browser cannot record audio. You can type your answer.");
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (!mounted || props.active === false) { release(); return; }
    recorder = new MediaRecorder(stream); const chunks: Blob[] = [];
    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      release(); recording.value = false; if (!mounted) return;
      transcribing.value = true;
      try {
        const type = recorder?.mimeType ?? "audio/webm", extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const form = new FormData(); form.append("recording", new File(chunks, `answer.${extension}`, { type }));
        const result = await hostRequest<{ text: string }>("/learning/transcribe", form);
        if (mounted) emit("transcript", result.text);
      } catch (error) { if (mounted) emit("error", error instanceof Error ? error.message : "The recording could not be transcribed."); }
      finally { transcribing.value = false; }
    };
    recorder.start(); recording.value = true;
  } catch (error) { release(); emit("error", error instanceof Error ? error.message : "Microphone access failed."); }
}
onBeforeUnmount(() => { mounted = false; if (recorder?.state === "recording") recorder.stop(); release(); });
watch([recording, transcribing], ([a, b]) => emit("recording", a || b));
watch(() => props.active, (active) => { if (active === false && recorder?.state === "recording") recorder.stop(); });
</script>
<template>
  <div class="voice-input" :class="{ compact }"><button type="button" class="record-button" :class="{ recording }" :disabled="(props.disabled && !recording) || transcribing" :aria-label="recording ? 'Stop recording' : transcribing ? 'Transcribing' : 'Dictate message'" :title="recording ? 'Stop recording' : 'Dictate a message'" @click="toggle">
    <span v-if="recording || transcribing" aria-hidden="true">{{ recording ? '■' : '…' }}</span><svg v-else aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg><span v-if="!compact">{{ recording ? 'Stop recording' : transcribing ? 'Transcribing…' : 'Speak your answer' }}</span>
  </button><p v-if="!compact" class="hint">{{ recording ? 'Recording. Stop when you finish.' : 'Review the transcript below. The microphone recording is discarded.' }}</p></div>
</template>
<style scoped>
.record-button { display:flex; gap:10px; align-items:center; border:1px solid #181818; background:#fff; border-radius:6px; padding:11px 16px; font-weight:600; }.recording { background:#181818; color:#fff; }.voice-input { margin:18px 0; }
.compact{margin:0}.compact .record-button{border:0;border-radius:50%;width:34px;height:34px;padding:7px;justify-content:center}.compact .record-button:hover:not(:disabled){background:#eee}.compact .record-button.recording{background:#222}
</style>
