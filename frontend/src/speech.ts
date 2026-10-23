import { computed, ref } from "vue";

/** Reading text aloud with the browser's own speech synthesis. Screen-only: nothing is sent to the server. */
const synth = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function"
  ? window.speechSynthesis : null;
const voiceCount = ref(synth ? synth.getVoices().length : 0);
// Some browsers list their voices a moment after the page loads. Until then, Listen stays available.
const voicesKnown = ref(voiceCount.value > 0);
if (synth) {
  const update = () => { voiceCount.value = synth.getVoices().length; voicesKnown.value = true; };
  try { synth.addEventListener("voiceschanged", update); } catch { /* Older browsers report voices only by polling. */ }
  setTimeout(update, 1500);
}

/** Why Listen is unavailable in this browser, or empty when it works. */
export const listenUnavailable = computed(() => !synth ? "This browser cannot read text aloud."
  : voicesKnown.value && !voiceCount.value ? "This browser has no voices installed for reading aloud." : "");

/** The message being read aloud, or null. */
export const speakingId = ref<string | null>(null);
let reading = 0;

/**
 * Some browsers stop a single long utterance after about fifteen seconds, so the text is read in short parts.
 * Parts end at sentence boundaries where possible.
 */
export function speechParts(text: string, limit = 220): string[] {
  const sentences = text.replace(/\s+/g, " ").trim().match(/.+?(?:[.!?]+(?=\s|$)|$)/g) ?? [];
  const parts: string[] = [];
  let part = "";
  const add = (piece: string) => {
    if (part && part.length + 1 + piece.length > limit) { parts.push(part); part = piece; }
    else part = part ? `${part} ${piece}` : piece;
  };
  for (const sentence of sentences.map((item) => item.trim()).filter(Boolean)) {
    if (sentence.length <= limit) add(sentence);
    else sentence.split(" ").forEach(add);
  }
  if (part) parts.push(part);
  return parts;
}

/** Read one message aloud. Any message already being read stops first. */
export function speak(id: string, text: string) {
  if (!synth) return;
  const mine = ++reading;
  synth.cancel();
  const parts = speechParts(text);
  speakingId.value = parts.length ? id : null;
  parts.forEach((part, index) => {
    const utterance = new SpeechSynthesisUtterance(part);
    utterance.onerror = () => { if (mine === reading) stopSpeaking(); };
    if (index === parts.length - 1) utterance.onend = () => { if (mine === reading) speakingId.value = null; };
    synth.speak(utterance);
  });
}

/** Stop reading aloud. */
export function stopSpeaking() {
  reading++;
  synth?.cancel();
  speakingId.value = null;
}
