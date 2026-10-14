<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from "vue";
import { uploadMaterial } from "./host-api.ts";
import SpeechInput from "./SpeechInput.vue";
import { api, unwrap } from "./api.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];
type StudySession = SkillData["sessions"][number];
const props = defineProps<{ skill: string; course: string; connected: boolean; active?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const data = shallowRef<SkillData | null>(null), selected = ref<StudySession["session"] | "">(""), busy = ref(false), error = ref("");
const confidence = ref(50), freshLesson = ref(false), recording = ref(false), reviewOpen = ref(false), thread = ref<HTMLElement | null>(null);
const response = ref(""), channel = ref<"TEXT" | "VOICE">("TEXT"), attachment = ref(""), attachmentName = ref("");
const reviewed = ref(false), unseen = ref(true), outsideHelp = ref(false), reason = ref(""), correction = ref<NonNullable<SkillData["cases"][number]["judgment"]>["result"]>("SLIP"), fullGate = ref(false);
const current = computed(() => freshLesson.value ? undefined : data.value?.sessions.find((session) => session.session === selected.value));
const currentCases = computed(() => data.value?.cases.filter((item) => item.task === selected.value) ?? []);
const canSend = computed(() => !busy.value && !recording.value && (props.connected || !!current.value?.task) && (!!response.value.trim() || (!!attachment.value && !!current.value)));
const unsent = new Map<string, { text: string; channel: "TEXT" | "VOICE"; attachment: string; name: string }>();
const speechEdits = ref<Record<number, string>>({});
const unsavedTranscripts = computed(() => current.value?.voice.some((voice) => speechEdits.value[voice.turnIndex] !== voice.text) ?? false);
const resultLabels: Record<string, string> = { INDEPENDENT: "Independent success", SUPPORTED: "Success with help", SLIP: "Small execution error", GAP: "Needs more understanding", UNCERTAIN: "More evidence needed" };
async function load() {
  const skill = props.skill, result = unwrap(await api.learning.read({ skill })).data;
  if (skill !== props.skill) return;
  data.value = result;
  if (!freshLesson.value && !result.sessions.some((session) => session.session === selected.value)) selected.value = result.sessions.find((session) => session.status === "OPEN")?.session ?? result.sessions.at(-1)?.session ?? "";
}
async function act(work: () => Promise<void>) {
  busy.value = true; error.value = "";
  try { await work(); await load(); emit("changed"); }
  catch (problem) { error.value = problem instanceof Error ? problem.message : "This step could not finish."; await load().catch(() => undefined); }
  finally { busy.value = false; }
}
async function startLesson() { await act(async () => { const result = unwrap(await api.learning.lesson({ skill: props.skill, request: response.value.trim() })); response.value = ""; channel.value = "TEXT"; freshLesson.value = false; selected.value = result.lesson; }); }
function newLesson() { if (busy.value || recording.value) return; freshLesson.value = true; selected.value = ""; reviewOpen.value = false; }
function selectSession(id: StudySession["session"]) { if (busy.value || recording.value) return; freshLesson.value = false; selected.value = id; reviewOpen.value = false; }
async function submitMessage() { if (!canSend.value) return; if (current.value) await send(); else await startLesson(); }
function enterToSend(event: KeyboardEvent) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submitMessage(); } }
async function scrollToLatest() { await nextTick(); if (thread.value) thread.value.scrollTop = thread.value.scrollHeight; }
async function startTask() { await act(async () => { const result = unwrap(await api.learning.task({ skill: props.skill })); freshLesson.value = false; selected.value = result.task; reviewOpen.value = false; reviewed.value = false; unseen.value = true; outsideHelp.value = false; }); }
async function send() {
  await act(async () => {
    const session = current.value; if (!session) return;
    const input = { studySession: session.session, text: response.value, channel: channel.value, attachment: attachment.value, dialogueLength: session.dialogue.length };
    const result = session.lesson ? await api.learning.question(input) : await api.learning.respond(input);
    // Keep the draft on failure; the reloaded history exposes any saved question and its retry button.
    unwrap(result);
    response.value = ""; channel.value = "TEXT"; attachment.value = ""; attachmentName.value = ""; reviewed.value = false;
  });
}
async function uploadWork(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]; if (!file) return;
  await act(async () => {
    const form = new FormData(); form.set("course", props.course); form.set("title", `My work: ${file.name}`); form.set("requestId", crypto.randomUUID()); form.append("files", file);
    const result = await uploadMaterial(form); attachment.value = result.material; attachmentName.value = file.name;
  });
}
async function assess() {
  await act(async () => {
    if (!current.value) return;
    if (current.value.status === "CLOSED") {
      if (data.value?.cases.some((item) => item.task === current.value!.session && item.judgment)) return;
      unwrap(await api.learning.retry({ studySession: current.value.session }));
    } else {
      unwrap(await api.learning.assess({ studySession: current.value.session, dialogueLength: current.value.dialogue.length,
        reviewed: reviewed.value, unseen: unseen.value, outsideHelp: outsideHelp.value }));
    }
  });
}
async function saveConfidence() { await act(async () => { unwrap(await api.learning.confidence({ skill: props.skill, confidence: confidence.value })); }); }
async function requestHint() { const active = current.value; if (active) await act(async () => { unwrap(await api.learning.hint({ studySession: active.session })); }); }
async function retryReply() { const active = current.value; if (active) await act(async () => { unwrap(await api.learning.reply({ studySession: active.session })); }); }
async function correctTranscript(turnIndex: number) { const active = current.value; if (!active) return; await act(async () => { unwrap(await api.learning.transcript({ studySession: active.session, turnIndex, text: speechEdits.value[turnIndex] ?? "" })); reviewed.value = false; }); }
async function requestRegrade(assessment: string, basedOn: string) {
  await act(async () => { unwrap(await api.learning.regrade({ case: assessment, basedOn, reason: reason.value })); reason.value = ""; });
}
async function saveCorrection(assessment: string, basedOn: string) {
  await act(async () => { unwrap(await api.learning.correct({ case: assessment, basedOn, result: correction.value, gateMet: fullGate.value, reason: reason.value })); reason.value = ""; });
}
function listen(text: string) { if ("speechSynthesis" in window) { window.speechSynthesis.cancel(); window.speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } }
watch(() => props.skill, () => { selected.value = ""; data.value = null; response.value = ""; attachment.value = ""; reviewed.value = false; act(load); }, { immediate: true });
watch(selected, (next, previous) => {
  unsent.set(previous, { text: response.value, channel: channel.value, attachment: attachment.value, name: attachmentName.value });
  const saved = unsent.get(next); response.value = saved?.text ?? ""; channel.value = saved?.channel ?? "TEXT"; attachment.value = saved?.attachment ?? ""; attachmentName.value = saved?.name ?? ""; reviewed.value = false;
  void scrollToLatest();
});
watch(() => [current.value?.dialogue.length, busy.value], scrollToLatest);
watch(current, (session) => { speechEdits.value = Object.fromEntries(session?.voice.map((voice) => [voice.turnIndex, voice.text]) ?? []); });
onBeforeUnmount(() => { if ("speechSynthesis" in window) window.speechSynthesis.cancel(); });
</script>

<template>
  <section class="study-chat" :aria-busy="busy">
    <aside class="chat-history">
      <button class="new-lesson" :disabled="busy || recording" @click="newLesson"><span aria-hidden="true">＋</span> New conversation</button>
      <p class="history-caption">This skill</p>
      <button v-for="(session, index) in data?.sessions" :key="session.session" class="history-item" :class="{ chosen: !freshLesson && selected === session.session }" :disabled="busy || recording" @click="selectSession(session.session)">
        <span>{{ session.lesson ? 'Lesson' : 'Practice' }} {{ index + 1 }}</span><small>{{ session.lesson?.request || (session.status === 'CLOSED' ? 'Submitted work' : 'Independent check') }}</small>
      </button>
      <p v-if="!data?.sessions.length" class="hint">Your conversations will appear here.</p>
      <details v-if="data" class="skill-detail"><summary>About this skill</summary><p>{{ data.skill.outcome }}</p><strong>How to demonstrate it</strong><p>{{ data.skill.gate }}</p><p v-if="data.estimate">{{ data.estimate.basis }}</p><p class="hint">Mastery is a prototype estimate, not a course grade.</p></details>
    </aside>
    <div class="chat-main">
      <header class="chat-heading">
        <div><h1 id="page-title">{{ data?.skill.title || 'Opening your lesson…' }}</h1><p>{{ current?.task ? 'Independent practice' : 'Your learning conversation' }}<span v-if="data?.estimate"> · {{ Math.round(data.estimate.value) }}% estimated mastery</span></p></div>
        <button class="practice-button" :disabled="busy || recording || !connected || !data?.track" @click="startTask">Check my understanding</button>
      </header>
      <div ref="thread" class="chat-thread">
        <div v-if="data && !data.track" class="confidence-note">
          <form @submit.prevent="saveConfidence"><label for="confidence">How confident do you feel?</label><div class="confidence"><input id="confidence" v-model.number="confidence" type="range" min="0" max="100" :disabled="busy" /><output>{{ confidence }}%</output><button :disabled="busy" class="small-button">Set starting point</button></div><p class="hint">A rough estimate is fine. Your practice will refine it.</p></form>
        </div>
        <div v-if="!current && data" class="chat-welcome">
          <span class="tutor-mark" aria-hidden="true">✳</span><h2>Let's work through it.</h2><p>{{ data.skill.outcome }}</p>
          <div class="prompt-choices"><button :disabled="busy" @click="response = 'Explain this skill with a worked example.'">Show me an example</button><button :disabled="busy" @click="response = 'Explain why this method works, using a concrete example.'">Help me understand why</button><button :disabled="busy" @click="response = 'Walk me through guided practice. Ask one question at a time.'">Guide me through practice</button></div>
        </div>
        <template v-if="current">
          <div v-if="current.lesson" class="message from-you"><span class="speaker">You</span><p class="prose">{{ current.lesson.request }}</p></div>
          <article class="message from-tutor"><div class="speaker-row"><span class="speaker"><span aria-hidden="true">✳</span> StillGotIt</span><button v-if="current.lesson" class="message-action" @click="listen(current.lesson.explanation)">Listen</button></div><div class="prose">{{ current.lesson?.explanation || current.task?.question }}</div>
            <details v-if="current.citations.length" class="sources"><summary>Sources used</summary><ul><li v-for="source in current.citations" :key="`${source.material}:${source.location}`">{{ source.location }}</li></ul></details>
          </article>
          <article v-for="item in current.dialogue" :key="item.turnIndex" class="message" :class="item.turn.speaker === 'LEARNER' ? 'from-you' : 'from-tutor'"><span class="speaker">{{ item.turn.speaker === 'LEARNER' ? 'You' : 'StillGotIt' }}{{ item.turn.purpose === 'HINT' ? ' · hint' : item.turn.purpose === 'CORRECTION' ? ' · transcript correction' : '' }}</span><p class="prose">{{ item.turn.text }}</p><p v-for="file in item.turn.media" :key="file.name" class="attachment-label">Attachment · {{ file.name }}</p></article>
          <button v-if="current.lesson && current.dialogue.at(-1)?.turn.speaker === 'LEARNER'" class="message-action" :disabled="busy || !connected" @click="retryReply">Retry tutor reply</button>
          <div v-if="current.task && current.status === 'OPEN' && current.dialogue.some(item => item.turn.speaker === 'LEARNER' && item.turn.purpose === 'RESPONSE')" class="review-step">
            <button class="practice-button" :disabled="busy || recording" @click="reviewOpen = !reviewOpen">{{ reviewOpen ? 'Close review' : 'Review and assess my work' }}</button>
            <div v-if="reviewOpen" class="attempt-review">
              <h3>Ready to check your understanding?</h3><p class="hint">Review your complete answer before assessment.</p>
              <div v-for="voice in current.voice" :key="voice.turnIndex" class="transcript"><label :for="`voice-${voice.turnIndex}`">Speech transcript {{ voice.turnIndex + 1 }}</label><textarea :id="`voice-${voice.turnIndex}`" v-model="speechEdits[voice.turnIndex]" rows="3" /><button class="message-action" :disabled="busy" @click="correctTranscript(voice.turnIndex)">Save transcript correction</button></div>
              <label class="check"><input v-model="unseen" type="checkbox" /> These exact problems are new to me.</label><label class="check"><input v-model="outsideHelp" type="checkbox" /> I used help outside this conversation.</label><label class="check"><input v-model="reviewed" type="checkbox" /> I reviewed my answer and all speech transcripts.</label>
              <p v-if="unsavedTranscripts" class="hint">Save your transcript corrections first.</p><button class="primary" :disabled="busy || !connected || !reviewed || unsavedTranscripts" @click="assess">Assess my work</button>
            </div>
          </div>
          <button v-if="current.status === 'CLOSED' && !currentCases.some(item => item.judgment)" class="practice-button" :disabled="busy || !connected" @click="assess">Retry saved assessment</button>
          <article v-for="item in currentCases" :key="item.case" class="assessment">
            <template v-if="item.judgment"><span class="speaker">Your assessment</span><h3>{{ resultLabels[item.judgment.result] }}</h3><p class="prose">{{ item.judgment.rationale }}</p>
              <details><summary>Review or correct this assessment</summary><label>Reason<textarea v-model="reason" rows="3" /></label><button class="message-action" :disabled="busy || !connected || !reason.trim()" @click="requestRegrade(item.case, item.judgment.judgment)">Request regrade</button>
              <label>Manual correction<select v-model="correction"><option v-for="(label,value) in resultLabels" :key="value" :value="value">{{ label }}</option></select></label><label class="check"><input v-model="fullGate" type="checkbox" /> All requirements were met in fresh independent work.</label><button class="message-action" :disabled="busy || !reason.trim()" @click="saveCorrection(item.case, item.judgment.judgment)">Save correction</button><ol><li v-for="judgment in item.history" :key="judgment.judgment">{{ resultLabels[judgment.result] }} · {{ judgment.origin === 'AI' ? 'Tutor' : 'Your correction' }}<p>{{ judgment.rationale }}</p></li></ol></details>
            </template><p v-else>Your answer is saved. Assessment is pending.</p>
          </article>
        </template>
        <p v-if="busy" class="working" role="status"><span aria-hidden="true">✳</span> Working on it…</p>
        <p v-if="error" class="error" role="alert">{{ error }}</p>
      </div>
      <div class="composer-area">
        <template v-if="!current || current.status === 'OPEN'">
          <div class="composer" :class="{ 'is-recording': recording }">
            <div v-if="attachmentName" class="attachment-chip">{{ attachmentName }}<button aria-label="Remove attached photo" :disabled="busy" @click="attachment = ''; attachmentName = ''">×</button></div>
            <label class="sr-only" for="chat-message">{{ current?.task ? 'Your answer and reasoning' : 'Message your tutor' }}</label>
            <textarea id="chat-message" v-model="response" rows="2" :disabled="busy" :placeholder="current?.task ? 'Explain your reasoning. You can type, speak, or attach your work.' : 'Ask a question or tell me what you want to learn…'" @keydown="enterToSend" />
            <div class="composer-tools"><div class="input-tools"><label class="attach-button" :class="{ unavailable: !current || busy || recording }" :title="current ? 'Attach a photo of your work' : 'Start a lesson before attaching work'"><span aria-hidden="true">＋</span><span class="sr-only">Add a photo of your work</span><input type="file" accept="image/*" capture="environment" :disabled="busy || recording || !current" @change="uploadWork" /></label>
              <button v-if="current?.task" class="hint-button" :disabled="busy || recording || !connected" @click="requestHint">Hint</button>
            </div><div class="composer-right"><slot name="composer-settings" /><SpeechInput :disabled="busy" :active="active !== false" compact @recording="recording = $event" @transcript="response = response ? response + '\n' + $event : $event; channel = 'VOICE'" @error="error = $event" /><button class="send-button" :disabled="!canSend" :aria-label="current?.task ? 'Save answer' : 'Send message'" @click="submitMessage"><span aria-hidden="true">↑</span></button></div></div>
          </div>
          <p class="composer-note">{{ recording ? 'Recording. Stop to review your words before sending.' : current?.task ? 'Review your complete answer before requesting assessment.' : 'Grounded in your course materials. Check important details.' }}</p>
        </template>
        <div v-else class="finished-message"><p>This attempt is saved.</p><button class="practice-button" :disabled="busy || !connected" @click="startTask">Try a fresh check</button><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
        <p v-if="!connected" class="hint">Connect ChatGPT in Tutor settings to continue.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.study-chat{display:grid;grid-template-columns:215px minmax(0,1fr);height:calc(100dvh - 166px);min-height:560px;border-top:1px solid #e6e6e6}.chat-history{padding:25px 16px 20px;background:#f9f9f9;border-right:1px solid #e9e9e9;overflow:auto}.new-lesson{display:flex;align-items:center;gap:8px;padding:10px 12px;width:100%;border:1px solid #d8d8d8;border-radius:8px;background:white;text-align:left;font-size:13px}.history-caption{font-size:12px;color:#888;margin:28px 10px 10px}.history-item{display:block;width:100%;text-align:left;border:0;border-radius:7px;background:transparent;padding:12px;margin:3px 0}.history-item.chosen{background:#f1f1f1}.history-item span{display:block;font-size:13px;font-weight:600}.history-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#777;margin-top:4px;font-size:11px}.skill-detail{margin:28px 10px;font-size:12px;color:#676767}.skill-detail strong{font-size:12px;color:#333}.chat-main{display:flex;flex-direction:column;min-width:0;min-height:0}.chat-heading{padding:23px 28px 18px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid #eee}.chat-heading h1{font:500 19px/1.4 "Avenir Next",sans-serif;letter-spacing:-.35px;margin:0}.chat-heading p{font-size:12px;color:#777;margin:5px 0 0}.practice-button,.small-button{background:#fff;border:1px solid #d4d4d4;border-radius:7px;padding:9px 13px;font-size:12px;white-space:nowrap}.practice-button:hover:not(:disabled){background:#f4f4f4}.chat-thread{flex:1;overflow-y:auto;padding:30px max(24px,calc((100% - 750px)/2));scroll-behavior:auto}.confidence-note{border:1px solid #e4e4e4;padding:16px 20px;border-radius:10px;margin-bottom:24px;background:#fafafa}.confidence-note form{max-width:none}.confidence-note label{font-size:13px;margin:0 0 9px}.confidence{display:flex;gap:14px;align-items:center}.confidence input{min-height:20px;padding:0;accent-color:#222;flex:1;min-width:60px}.confidence output{font-size:13px}.chat-welcome{text-align:center;max-width:560px;margin:35px auto 50px}.tutor-mark{font-size:40px}.chat-welcome h2{font:36px/1.2 Georgia,serif;letter-spacing:-1px;margin:18px 0}.chat-welcome p{font-size:14px;color:#777;line-height:1.7}.prompt-choices{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:26px}.prompt-choices button{border:1px solid #dedede;border-radius:24px;background:white;padding:10px 15px;font-size:12px}.message{margin:0 0 28px;max-width:100%;font-size:15px}.from-you{margin-left:auto;max-width:85%;padding:16px 20px;background:#f1f1f1;border-radius:18px 18px 4px 18px;white-space:normal}.from-tutor{padding:5px 0}.speaker{display:block;font-size:12px;font-weight:650;color:#666;margin-bottom:10px}.speaker-row{display:flex;justify-content:space-between;align-items:baseline}.speaker span{font-size:21px;vertical-align:middle;margin-right:7px;color:#222}.prose{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;font-size:15px;margin:0}.from-you .prose{line-height:1.65}.message-action{border:0;background:transparent;color:#777;padding:5px 0;font-size:12px;text-decoration:underline;text-underline-offset:4px}.sources{margin-top:18px;color:#777;font-size:12px}.sources ul{padding-left:18px}summary{cursor:pointer}.composer-area{padding:15px max(24px,calc((100% - 750px)/2)) 14px;background:#fff}.composer{border:1px solid #d6d6d6;border-radius:27px;padding:12px 17px 10px;box-shadow:0 3px 14px #00000005}.composer:focus-within{border-color:#888}.composer textarea{border:0;outline:none;width:100%;resize:vertical;min-height:55px;max-height:180px;padding:6px 5px;font-family:inherit;font-size:14px;line-height:1.65;background:transparent;color:#181818;box-shadow:none}.composer-right{display:flex;align-items:center;gap:10px}.composer-tools,.input-tools{display:flex;align-items:center;gap:9px}.composer-tools{justify-content:space-between}.attach-button{margin:0;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;font-size:25px;font-weight:400;cursor:pointer}.attach-button:hover{background:#f0f0f0}.attach-button input{position:absolute;width:1px;height:1px;min-height:0;opacity:0;padding:0;border:0}.unavailable{opacity:.35;cursor:default}.attach-button:focus-within{outline:2px solid #181818}.send-button{border:0;border-radius:50%;background:#222;color:#fff;font-size:24px;width:36px;height:36px;display:grid;place-items:center;padding:0}.send-button:disabled{background:#e4e4e4;color:#999;opacity:1;cursor:default}.hint-button{border:0;background:transparent;color:#666;font-size:12px;padding:8px}.composer-note{margin:9px 0 0;text-align:center;font-size:11px;color:#999}.attachment-chip{display:inline-flex;align-items:center;gap:12px;padding:5px 10px;border:1px solid #ddd;border-radius:6px;font-size:12px;margin:2px 4px 8px}.attachment-chip button{border:0;background:none;font-size:19px}.is-recording{border-color:#222}.working{font-size:13px;color:#888}.working span{font-size:20px;margin-right:8px}.review-step{margin:20px 0}.attempt-review,.assessment{margin:20px 0;padding:22px;background:#f6f6f6;border-radius:12px}.attempt-review h3,.assessment h3{font-size:19px;margin:8px 0 15px}.check{display:flex;align-items:flex-start;gap:10px;font-size:12px;font-weight:400;margin:14px 0}.check input{width:16px;min-height:16px;margin-top:3px;accent-color:#222}.transcript textarea,.assessment textarea,.assessment select{width:100%;padding:10px;border:1px solid #ccc;border-radius:6px;font:inherit;background:white}.transcript{margin:20px 0}.assessment details{margin-top:20px;font-size:12px}.assessment label{margin-top:15px}.finished-message{display:flex;align-items:center;justify-content:center;gap:15px;font-size:13px;color:#777}.attachment-label{font-size:12px;color:#888}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media(max-width:900px){.study-chat{grid-template-columns:165px minmax(0,1fr)}.chat-heading{padding:18px;align-items:flex-start}.chat-heading h1{font-size:16px}.chat-heading .practice-button{font-size:11px;padding:8px}.chat-thread,.composer-area{padding-left:20px;padding-right:20px}.chat-history{padding-right:12px}}
@media(max-width:650px){.study-chat{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);height:calc(100dvh - 149px);min-height:520px}.chat-history{display:flex;gap:6px;border-right:0;border-bottom:1px solid #eee;padding:9px 0;overflow-x:auto;align-items:center}.new-lesson{width:auto;white-space:nowrap;padding:8px}.history-caption,.history-item small,.skill-detail{display:none}.history-item{width:auto;white-space:nowrap;margin:0;padding:8px}.history-item span{font-size:12px}.chat-main{min-height:0}.chat-heading{padding:14px 0}.chat-heading p{font-size:11px}.chat-thread{padding:18px 8px}.composer-area{padding:10px 0}.confidence{flex-wrap:wrap}.chat-welcome h2{font-size:29px}.chat-heading .practice-button{white-space:normal;max-width:115px}.prose{font-size:14px}.from-you{max-width:94%}.finished-message{flex-wrap:wrap}}
</style>
