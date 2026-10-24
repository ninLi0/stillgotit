<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from "vue";
import { hostRequest } from "./host-api.ts";
// describedby names the element that explains why dictation is unavailable.
const props = defineProps<{ disabled?: boolean; active?: boolean; compact?: boolean; describedby?: string }>();
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
  <div class="voice-input" :class="{ compact }"><button type="button" class="record-button" :class="{ recording }" :disabled="(props.disabled && !recording) || transcribing" :aria-label="recording ? 'Stop recording' : transcribing ? 'Transcribing' : 'Dictate message'" :aria-describedby="describedby" :title="recording ? 'Stop recording' : 'Dictate a message'" @click="toggle">
    <template v-if="compact"><span class="speak-square" aria-hidden="true" />{{ recording ? 'Stop' : transcribing ? 'Transcribing…' : 'Speak' }}</template>
    <template v-else><span v-if="recording || transcribing" aria-hidden="true">{{ recording ? '■' : '…' }}</span><svg v-else aria-hidden="true" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></svg><span>{{ recording ? 'Stop recording' : transcribing ? 'Transcribing…' : 'Speak your answer' }}</span></template>
  </button><p v-if="!compact" class="hint">{{ recording ? 'Recording. Stop when you finish.' : 'Review the transcript below. The microphone recording is discarded.' }}</p></div>
</template>
<style scoped>
.record-button{display:flex;gap:10px;align-items:center;border:2px solid var(--coral);background:#FFFFFF;border-radius:12px;padding:11px 16px;font-weight:700;color:var(--ink)}.recording{background:var(--coral);color:#FFFFFF}.voice-input{margin:18px 0}
.compact{margin:0}
.compact .record-button{gap:6px;border:1px solid var(--line);border-radius:999px;background:#FFFFFF;padding:5px 12px;min-height:30px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}
.compact .record-button:hover:not(:disabled){border-color:rgba(20,20,20,.35);color:var(--ink)}
.speak-square{width:8px;height:8px;flex:none;background:#C0503C}
.compact .record-button.recording{background:var(--coral-wash);border-color:var(--coral);color:var(--coral-text)}
.compact .record-button.recording .speak-square{animation:sgBlink .9s steps(2,start) infinite}
@keyframes sgBlink{to{visibility:hidden}}
</style>
