<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, ref, shallowRef, watch } from "vue";
import { uploadMaterial } from "./host-api.ts";
import SpeechInput from "./SpeechInput.vue";
import ListenButton from "./ListenButton.vue";
import SourcesUsed from "./SourcesUsed.vue";
import EstimatePanel from "./EstimatePanel.vue";
import { api, unwrap } from "./api.ts";
import { resultLabels, sessionLabels } from "./labels.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { PendingAdjustment, sessionStore } from "./pending-adjustment.ts";
import { listenUnavailable, stopSpeaking } from "./speech.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
import { answerKey, newAnswers, takeTutor, tutorLabel, type TutorUsed } from "./tutor-choice.ts";
type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];
type StudySession = SkillData["sessions"][number];
/** A photo uploaded for the answer being written. `preview` is a local picture of it, so learners can tell photos apart. */
type Attachment = { material: string; name: string; preview: string };
// aiReason explains why AI features are off when aiAvailable is false. materials gives titles for cited sources.
const props = defineProps<{ skill: string; course: string; materials: { material: string; title: string }[]; aiAvailable: boolean; aiReason: string; active?: boolean }>();
const emit = defineEmits<{ changed: [] }>();
const data = shallowRef<SkillData | null>(null), selected = ref<StudySession["session"] | "">(""), busy = ref(false), error = ref(""), notice = ref("");
const noticeBox = ref<HTMLElement | null>(null), errorBox = ref<HTMLElement | null>(null), composerInput = ref<HTMLTextAreaElement | null>(null), heading = ref<HTMLElement | null>(null);
const confidence = ref(50), freshLesson = ref(false), recording = ref(false), reviewOpen = ref(false), thread = ref<HTMLElement | null>(null), evidenceOpen = ref(false);
const response = ref(""), channel = ref<"TEXT" | "VOICE">("TEXT"), attachments = ref<Attachment[]>([]), attachmentList = ref<HTMLElement | null>(null);
const reviewed = ref(false), unseen = ref(true), outsideHelp = ref(false), reason = ref(""), correction = ref<NonNullable<SkillData["cases"][number]["judgment"]>["result"]>("SLIP"), fullGate = ref(false);
const current = computed(() => freshLesson.value ? undefined : data.value?.sessions.find((session) => session.session === selected.value));
const currentCases = computed(() => data.value?.cases.filter((item) => item.task === selected.value) ?? []);
const canSend = computed(() => !busy.value && !recording.value && (props.aiAvailable || !!current.value?.task) && (!!response.value.trim() || (attachments.value.length > 0 && !!current.value)));
const unsent = new Map<string, { text: string; channel: "TEXT" | "VOICE"; attachments: Attachment[] }>();
const previews = new Set<string>();
const speechEdits = ref<Record<number, string>>({});
const unsavedTranscripts = computed(() => current.value?.voice.some((voice) => speechEdits.value[voice.turnIndex] !== voice.text) ?? false);
const labels = computed(() => sessionLabels(data.value?.sessions ?? []));
// The estimate panel opens from the estimate. It holds the evidence, the adjustment, and the skill's assessment history.
const hasEvidence = computed(() => !!data.value && (!!data.value.explanation || data.value.cases.length > 0));
const estimateText = computed(() => data.value?.estimate ? `${Math.round(data.value.estimate.value)}% estimated mastery` : "");
const materialTitles = computed(() => Object.fromEntries(props.materials.map((item) => [item.material, item.title])));
// Why a disabled action is unavailable. Empty when it is available or the app is only busy.
const aiOff = computed(() => props.aiAvailable ? "" : props.aiReason || "Checking whether the AI tutor is available…");
const practiceReason = computed(() => recording.value ? "Finish recording first." : !props.aiAvailable ? "The AI tutor is unavailable right now." : data.value && !data.value.track ? "Set your starting confidence first." : "");
const assessReason = computed(() => unsavedTranscripts.value ? "Save your transcript corrections first." : !reviewed.value ? "Confirm that you reviewed your answer first." : aiOff.value);
function describedBy(...ids: (string | false)[]) { return ids.filter(Boolean).join(" ") || undefined; }
function purposeNote(purpose: string) { return purpose === "HINT" ? " · hint" : purpose === "CORRECTION" ? " · transcript correction" : ""; }
async function load() {
  const skill = props.skill, result = unwrap(await api.learning.read({ skill })).data;
  if (skill !== props.skill) return;
  data.value = result;
  if (!freshLesson.value && !result.sessions.some((session) => session.session === selected.value)) selected.value = result.sessions.find((session) => session.status === "OPEN")?.session ?? result.sessions.at(-1)?.session ?? "";
}
// `success` is shown after the step finishes. Focus returns to the control the learner used, or to the result when that control is gone.
async function act(work: () => Promise<void>, success = "") {
  const previous = focusedControl();
  busy.value = true; error.value = ""; notice.value = "";
  try { await work(); await load(); notice.value = success; emit("changed"); }
  catch (problem) { error.value = problem instanceof Error ? problem.message : "This step could not finish."; await load().catch(() => undefined); }
  finally {
    busy.value = false; await nextTick();
    restoreFocus(previous, () => (error.value ? errorBox.value : noticeBox.value) ?? (composerInput.value?.disabled === false ? composerInput.value : heading.value));
  }
}
async function startLesson() { await act(async () => { const result = unwrap(await api.learning.lesson({ skill: props.skill, request: response.value.trim() })); response.value = ""; channel.value = "TEXT"; freshLesson.value = false; selected.value = result.lesson; }); }
function newLesson() { if (busy.value || recording.value) return; freshLesson.value = true; selected.value = ""; reviewOpen.value = false; error.value = ""; notice.value = ""; }
function selectSession(id: StudySession["session"]) { if (busy.value || recording.value) return; freshLesson.value = false; selected.value = id; reviewOpen.value = false; error.value = ""; notice.value = ""; }
async function submitMessage() { if (!canSend.value) return; if (current.value) await send(); else await startLesson(); }
// A starter prompt fills the message box. Focus moves there so the learner can edit it or press Enter to send.
function choosePrompt(text: string) { response.value = text; composerInput.value?.focus(); }
function enterToSend(event: KeyboardEvent) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submitMessage(); } }
async function scrollToLatest() { await nextTick(); if (thread.value) thread.value.scrollTop = thread.value.scrollHeight; }
async function startTask() { await act(async () => { const result = unwrap(await api.learning.task({ skill: props.skill })); freshLesson.value = false; selected.value = result.task; reviewOpen.value = false; reviewed.value = false; unseen.value = true; outsideHelp.value = false; }); }
async function send() {
  await act(async () => {
    const session = current.value; if (!session) return;
    // Photos go in the order the learner attached them.
    const sent = attachments.value;
    const input = { studySession: session.session, text: response.value, channel: channel.value, attachments: sent.map((item) => item.material), dialogueLength: session.dialogue.length };
    const result = session.lesson ? await api.learning.question(input) : await api.learning.respond(input);
    // Keep the draft and every photo on failure; the reloaded history exposes any saved question and its retry button.
    unwrap(result);
    response.value = ""; channel.value = "TEXT"; attachments.value = []; reviewed.value = false;
    sent.forEach(forgetPreview);
  });
}
function forgetPreview(item: Attachment) { if (item.preview) { URL.revokeObjectURL(item.preview); previews.delete(item.preview); } }
/** Each photo is uploaded to this skill's course as its own material, in the order chosen. A failed photo does not stop the rest. */
async function uploadWork(event: Event) {
  const picker = event.target as HTMLInputElement, files = Array.from(picker.files ?? []);
  // Clear the picker so the same photo can be chosen again after removing it.
  picker.value = "";
  if (!files.length) return;
  await act(async () => {
    const problems: string[] = [];
    for (const file of files) {
      try {
        const form = new FormData(); form.set("course", props.course); form.set("title", `My work: ${file.name}`); form.set("requestId", crypto.randomUUID()); form.append("files", file);
        const result = await uploadMaterial(form);
        const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
        if (preview) previews.add(preview);
        attachments.value = [...attachments.value, { material: result.material, name: file.name, preview }];
      } catch (problem) {
        problems.push(`${file.name} was not attached. ${problem instanceof Error ? problem.message : "Try again."}`);
      }
    }
    if (problems.length) throw new Error(problems.join(" "));
  }, files.length === 1 ? `Attached ${files[0]!.name}. Send your answer to include it.` : `Attached ${files.length} photos. Send your answer to include them.`);
}
/** Removing a photo only changes what this answer will send. Focus moves to the next photo, or back to the message box. */
async function removeAttachment(index: number) {
  const removed = attachments.value[index]; if (!removed || busy.value) return;
  attachments.value = attachments.value.filter((_, position) => position !== index);
  forgetPreview(removed);
  notice.value = `Removed ${removed.name}. It will not be sent.`;
  await nextTick();
  const buttons = attachmentList.value?.querySelectorAll<HTMLButtonElement>("button") ?? [];
  (buttons[Math.min(index, buttons.length - 1)] ?? composerInput.value)?.focus();
}
/** A practice case in the assessment history opens its conversation. */
function openCaseSession(task: string) { const session = data.value?.sessions.find((item) => item.session === task); if (session) selectSession(session.session); }
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
  }, "Assessment saved. Your result is shown above.");
}
async function saveConfidence() { await act(async () => { unwrap(await api.learning.confidence({ skill: props.skill, confidence: confidence.value })); }, "Starting point saved. You can now check your understanding."); }
async function requestHint() { const active = current.value; if (active) await act(async () => { unwrap(await api.learning.hint({ studySession: active.session })); }); }
async function retryReply() { const active = current.value; if (active) await act(async () => { unwrap(await api.learning.reply({ studySession: active.session })); }); }
async function correctTranscript(turnIndex: number) { const active = current.value; if (!active) return; await act(async () => { unwrap(await api.learning.transcript({ studySession: active.session, turnIndex, text: speechEdits.value[turnIndex] ?? "" })); reviewed.value = false; }, "Transcript correction saved. Review your answer again before assessment."); }
async function requestRegrade(assessment: string, basedOn: string) {
  await act(async () => { unwrap(await api.learning.regrade({ case: assessment, basedOn, reason: reason.value })); reason.value = ""; }, "Regrade saved. The assessment above shows the new result.");
}
async function saveCorrection(assessment: string, basedOn: string) {
  await act(async () => { unwrap(await api.learning.correct({ case: assessment, basedOn, result: correction.value, gateMet: fullGate.value, reason: reason.value })); reason.value = ""; }, "Correction saved. The assessment above shows your correction.");
}
watch(() => props.skill, (skill) => {
  selected.value = ""; data.value = null; response.value = ""; attachments.value = []; reviewed.value = false;
  // An unanswered adjustment from before a reload is shown at once, so the learner can see it and send it again.
  evidenceOpen.value = !!new PendingAdjustment(sessionStore(), skill).read();
  act(load);
}, { immediate: true });
watch(selected, (next, previous) => {
  unsent.set(previous, { text: response.value, channel: channel.value, attachments: attachments.value });
  const saved = unsent.get(next); response.value = saved?.text ?? ""; channel.value = saved?.channel ?? "TEXT"; attachments.value = saved?.attachments ?? []; reviewed.value = false;
  void scrollToLatest();
});
watch(() => [current.value?.dialogue.length, busy.value], scrollToLatest);
watch(current, (session) => { speechEdits.value = Object.fromEntries(session?.voice.map((voice) => [voice.turnIndex, voice.text]) ?? []); });
// Each tutor answer names the model and thinking level that wrote it. The read after it shows which answers are new, and they get that label.
const answeredBy = ref<Record<string, TutorUsed>>({});
function answerLabel(...key: Parameters<typeof answerKey>) { const tutor = answeredBy.value[answerKey(...key)]; return tutor ? tutorLabel(tutor) : ""; }
watch(data, (next, previous) => { const tutor = takeTutor(); if (tutor && next && previous) for (const key of newAnswers(previous, next)) answeredBy.value[key] = tutor; }, { flush: "sync" });
// Reading aloud stops when the learner leaves this page: another view, another skill, or closing it.
watch(() => props.active, (active) => { if (active === false) stopSpeaking(); });
onDeactivated(stopSpeaking);
onBeforeUnmount(() => { stopSpeaking(); previews.forEach((url) => URL.revokeObjectURL(url)); previews.clear(); });
</script>

<template>
  <section class="study-chat" :aria-busy="busy">
    <aside class="chat-history">
      <button class="new-lesson" :disabled="busy || recording" @click="newLesson"><span aria-hidden="true">＋</span> New conversation</button>
      <p class="history-caption">This skill</p>
      <button v-for="session in data?.sessions" :key="session.session" class="history-item" :class="{ chosen: !freshLesson && selected === session.session }" :disabled="busy || recording" @click="selectSession(session.session)">
        <span>{{ labels[session.session] }}</span><small>{{ session.lesson?.request || (session.status === 'CLOSED' ? 'Submitted work' : 'Independent check') }}</small>
      </button>
      <p v-if="!data?.sessions.length" class="hint">Your conversations will appear here.</p>
      <details v-if="data" class="skill-detail"><summary>About this skill</summary><p>{{ data.skill.outcome }}</p><strong>How to demonstrate it</strong><p>{{ data.skill.gate }}</p><p v-if="data.estimate">{{ data.estimate.basis }}</p><p class="hint">The mastery estimate is a study aid, not a course grade.</p></details>
    </aside>
    <div class="chat-main">
      <header class="chat-heading">
        <div><h1 id="page-title" ref="heading" tabindex="-1">{{ data?.skill.title || 'Opening your lesson…' }}</h1><p>{{ current?.task ? 'Independent practice' : 'Lesson' }}<template v-if="hasEvidence"> · <button type="button" class="estimate-toggle" :aria-expanded="evidenceOpen" aria-controls="estimate-panel" @click="evidenceOpen = !evidenceOpen">{{ estimateText ? `${estimateText} · Evidence` : 'Assessment history' }}<span aria-hidden="true">{{ evidenceOpen ? '▴' : '▾' }}</span></button></template><span v-else-if="estimateText"> · {{ estimateText }}</span></p></div>
        <div class="heading-action"><button class="practice-button" :disabled="busy || recording || !aiAvailable || !data?.track" :aria-describedby="describedBy(!!practiceReason && 'practice-reason', !aiAvailable && 'ai-reason-chat')" @click="startTask">Check my understanding</button><p v-if="practiceReason" id="practice-reason" class="hint reason">{{ practiceReason }}</p></div>
      </header>
      <EstimatePanel v-if="data && hasEvidence" v-show="evidenceOpen" id="estimate-panel" :skill="skill" :data="data" :session-labels="labels" :busy="busy" :reload="load" @changed="emit('changed')" @open-session="openCaseSession" />
      <div ref="thread" class="chat-thread">
        <div v-if="data && !data.track" class="confidence-note">
          <form @submit.prevent="saveConfidence"><label for="confidence">How confident do you feel?</label><div class="confidence"><input id="confidence" v-model.number="confidence" type="range" min="0" max="100" :disabled="busy" /><output>{{ confidence }}%</output><button :disabled="busy" class="small-button">Set starting point</button></div><p class="hint">A rough estimate is fine. Your practice will refine it.</p></form>
        </div>
        <div v-if="!current && data" class="chat-welcome">
          <span class="tutor-mark" aria-hidden="true">✳</span><h2>Let's work through it.</h2><p>{{ data.skill.outcome }}</p>
          <div class="prompt-choices"><button :disabled="busy" @click="choosePrompt('Explain this skill with a worked example.')">Show me an example</button><button :disabled="busy" @click="choosePrompt('Explain why this method works, using a concrete example.')">Help me understand why</button><button :disabled="busy" @click="choosePrompt('Walk me through guided practice. Ask one question at a time.')">Guide me through practice</button></div>
        </div>
        <template v-if="current">
          <div v-if="current.lesson" class="message from-you"><span class="speaker">You</span><p class="prose">{{ current.lesson.request }}</p></div>
          <article class="message from-tutor"><div class="speaker-row"><span class="speaker"><span aria-hidden="true">✳</span> StillGotIt</span><ListenButton :message-key="`${current.session}:opening`" :text="current.lesson?.explanation || current.task?.question || ''" :what="current.lesson ? 'lesson' : 'practice question'" describedby="listen-reason" /></div><div class="prose">{{ current.lesson?.explanation || current.task?.question }}</div>
            <p v-if="answerLabel('session', current.session)" class="tutor-label">{{ answerLabel('session', current.session) }}</p>
            <SourcesUsed v-if="current.citations.length" :key="current.session" :citations="current.citations" :titles="materialTitles" :id-prefix="`passage-${current.session}`" />
          </article>
          <article v-for="item in current.dialogue" :key="item.turnIndex" class="message" :class="item.turn.speaker === 'LEARNER' ? 'from-you' : 'from-tutor'">
            <div v-if="item.turn.speaker === 'TUTOR'" class="speaker-row"><span class="speaker">StillGotIt{{ purposeNote(item.turn.purpose) }}</span><ListenButton :message-key="`${current.session}:${item.turnIndex}`" :text="item.turn.text" :what="item.turn.purpose === 'HINT' ? 'hint' : 'tutor reply'" describedby="listen-reason" /></div>
            <span v-else class="speaker">You{{ purposeNote(item.turn.purpose) }}</span>
            <p class="prose">{{ item.turn.text }}</p><p v-for="(file, fileIndex) in item.turn.media" :key="file.file" class="attachment-label">{{ item.turn.media.length > 1 ? `Attachment ${fileIndex + 1} of ${item.turn.media.length}` : 'Attachment' }} · {{ file.name }}</p><p v-if="answerLabel('turn', current.session, item.turnIndex)" class="tutor-label">{{ answerLabel('turn', current.session, item.turnIndex) }}</p></article>
          <button v-if="current.lesson && current.dialogue.at(-1)?.turn.speaker === 'LEARNER'" class="message-action" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="retryReply">Retry tutor reply</button>
          <div v-if="current.task && current.status === 'OPEN' && current.dialogue.some(item => item.turn.speaker === 'LEARNER' && item.turn.purpose === 'RESPONSE')" class="review-step">
            <button class="practice-button" :disabled="busy || recording" @click="reviewOpen = !reviewOpen">{{ reviewOpen ? 'Close review' : 'Review and assess my work' }}</button>
            <div v-if="reviewOpen" class="attempt-review">
              <h3>Ready to check your understanding?</h3><p class="hint">Review your complete answer before assessment.</p>
              <div v-for="voice in current.voice" :key="voice.turnIndex" class="transcript"><label :for="`voice-${voice.turnIndex}`">Speech transcript {{ voice.turnIndex + 1 }}</label><textarea :id="`voice-${voice.turnIndex}`" v-model="speechEdits[voice.turnIndex]" rows="3" /><button class="message-action" :disabled="busy" @click="correctTranscript(voice.turnIndex)">Save transcript correction</button></div>
              <label class="check"><input v-model="unseen" type="checkbox" /> These exact problems are new to me.</label><label class="check"><input v-model="outsideHelp" type="checkbox" /> I used help outside this conversation.</label><label class="check"><input v-model="reviewed" type="checkbox" /> I reviewed my answer and all speech transcripts.</label>
              <button class="primary" :disabled="busy || !!assessReason" :aria-describedby="assessReason ? 'assess-reason' : undefined" @click="assess">Assess my work</button><p v-if="assessReason" id="assess-reason" class="hint reason">{{ assessReason }}</p>
            </div>
          </div>
          <button v-if="current.status === 'CLOSED' && !currentCases.some(item => item.judgment)" class="practice-button" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="assess">Retry saved assessment</button>
          <article v-for="item in currentCases" :key="item.case" class="assessment">
            <template v-if="item.judgment"><span class="speaker">Your assessment</span><h3>{{ resultLabels[item.judgment.result] }}</h3><p class="prose">{{ item.judgment.rationale }}</p>
              <p v-if="answerLabel('judgment', item.judgment.judgment)" class="tutor-label">{{ answerLabel('judgment', item.judgment.judgment) }}</p>
              <details><summary>Review or correct this assessment</summary><label>Reason<textarea v-model="reason" rows="3" /></label><p v-if="!reason.trim()" :id="`reason-needed-${item.case}`" class="hint reason">Write a reason to request a regrade or save a correction.</p><button class="message-action" :disabled="busy || !aiAvailable || !reason.trim()" :aria-describedby="describedBy(!reason.trim() && `reason-needed-${item.case}`, !aiAvailable && 'ai-reason-chat')" @click="requestRegrade(item.case, item.judgment.judgment)">Request regrade</button>
              <label>Manual correction<select v-model="correction"><option v-for="(label,value) in resultLabels" :key="value" :value="value">{{ label }}</option></select></label><label class="check"><input v-model="fullGate" type="checkbox" /> All requirements were met in fresh independent work.</label><button class="message-action" :disabled="busy || !reason.trim()" :aria-describedby="reason.trim() ? undefined : `reason-needed-${item.case}`" @click="saveCorrection(item.case, item.judgment.judgment)">Save correction</button><ol><li v-for="judgment in item.history" :key="judgment.judgment">{{ resultLabels[judgment.result] }} · {{ judgment.origin === 'AI' ? 'Tutor' : 'Your correction' }}<p>{{ judgment.rationale }}</p></li></ol></details>
            </template><p v-else>Your answer is saved. Assessment is pending.</p>
          </article>
        </template>
        <p v-if="busy" class="working" role="status"><span aria-hidden="true">✳</span> Working on it…</p>
        <div role="status"><p v-if="notice && !busy" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
        <div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div>
      </div>
      <div class="composer-area">
        <template v-if="!current || current.status === 'OPEN'">
          <div class="composer" :class="{ 'is-recording': recording }">
            <ul v-if="attachments.length" ref="attachmentList" class="attachment-list" aria-label="Photos attached to this answer">
              <li v-for="(item, index) in attachments" :key="item.material" class="attachment-chip"><img v-if="item.preview" :src="item.preview" alt="" class="attachment-thumb" /><span>{{ attachments.length > 1 ? `${index + 1}. ` : '' }}{{ item.name }}</span><button type="button" :aria-label="`Remove photo ${index + 1}, ${item.name}`" :disabled="busy" @click="removeAttachment(index)">×</button></li>
            </ul>
            <label class="sr-only" for="chat-message">{{ current?.task ? 'Your answer and reasoning' : 'Message your tutor' }}</label>
            <textarea id="chat-message" ref="composerInput" v-model="response" rows="2" :disabled="busy" :placeholder="current?.task ? 'Explain your reasoning. You can type, speak, or attach your work.' : 'Ask a question or tell me what you want to learn…'" @keydown="enterToSend" />
            <div class="composer-tools"><div class="input-tools"><label class="attach-button" :class="{ unavailable: !current || busy || recording }" :title="current ? 'Attach photos of your work' : 'Start a lesson before attaching work'"><span aria-hidden="true">＋</span><span class="sr-only">{{ attachments.length ? 'Add another photo of your work' : 'Add photos of your work' }}</span><input type="file" accept="image/*" capture="environment" multiple :disabled="busy || recording || !current" @change="uploadWork" /></label>
              <button v-if="current?.task" class="hint-button" :disabled="busy || recording || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="requestHint">Hint</button>
            </div><div class="composer-right"><SpeechInput :disabled="busy || !aiAvailable" :active="active !== false" :describedby="aiAvailable ? undefined : 'ai-reason-chat'" compact @recording="recording = $event" @transcript="response = response ? response + '\n' + $event : $event; channel = 'VOICE'" @error="error = $event" /><button class="send-button" :disabled="!canSend" :aria-label="current?.task ? 'Save answer' : 'Send message'" :aria-describedby="aiAvailable || current?.task ? undefined : 'ai-reason-chat'" @click="submitMessage"><span aria-hidden="true">↑</span></button></div></div>
          </div>
          <p class="composer-note">{{ recording ? 'Recording. Stop to review your words before sending.' : current?.task ? 'Review your complete answer before requesting assessment.' : 'Grounded in your course materials. Check important details.' }}</p>
        </template>
        <div v-else class="finished-message"><p>This attempt is saved.</p><button class="practice-button" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="startTask">Try a fresh check</button><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
        <p v-if="aiOff" id="ai-reason-chat" class="hint">{{ aiOff }}</p>
        <p v-if="current && listenUnavailable" id="listen-reason" class="hint">{{ listenUnavailable }}</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.study-chat{display:grid;grid-template-columns:215px minmax(0,1fr);height:calc(100dvh - 166px);min-height:560px;border-top:1px solid var(--line)}.chat-history{padding:18px 12px 20px;background:var(--wash);border-right:1px solid var(--line);overflow:auto}.chat-history>p:not(.history-caption){margin:0 8px;font-size:13px;color:var(--muted)}.new-lesson{display:flex;align-items:center;gap:8px;padding:8px;width:100%;border:0;border-radius:10px;background:transparent;text-align:left;font-size:13px;white-space:nowrap;font-weight:500;color:var(--ink)}.new-lesson:hover:not(:disabled){background:var(--light)}.new-lesson span{display:grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--light);color:var(--primary);font-size:14px}.from-you .speaker{font-size:11px;color:var(--muted);margin-bottom:4px}.skill-detail>summary{padding:8px;border-radius:10px;list-style:none;font-size:13px;color:var(--ink)}.skill-detail>summary::-webkit-details-marker{display:none}.skill-detail>summary:hover{background:var(--light)}.confidence-note{background:var(--surface)!important}.history-caption{font-size:12px;font-weight:600;color:var(--muted);margin:22px 8px 6px}.history-item{display:block;width:100%;text-align:left;border:0;border-radius:10px;background:transparent;padding:8px;margin:2px 0}.history-item:hover{background:var(--light)}.history-item.chosen{background:var(--light);color:var(--ink)}.history-item span{display:block;font-size:13px;font-weight:600}.history-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);margin-top:4px;font-size:11px}.skill-detail{margin:18px 0 0;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}.skill-detail>p,.skill-detail>strong{display:block;padding:0 8px}.skill-detail strong{font-size:12px;color:var(--ink)}.chat-main{display:flex;flex-direction:column;min-width:0;min-height:0}.chat-heading{padding:23px 28px 18px;display:flex;align-items:center;justify-content:space-between;gap:18px;border-bottom:1px solid var(--light)}.chat-heading h1{font:23px/1.3 Georgia,serif;letter-spacing:-.4px;margin:0}.chat-heading p{font-size:12px;color:var(--muted);margin:5px 0 0}.practice-button,.small-button{background:var(--surface);border:1px solid var(--line);border-radius:7px;padding:9px 13px;font-size:12px;white-space:nowrap}.practice-button:hover:not(:disabled){background:var(--light)}.heading-action{text-align:right;max-width:240px}.heading-action .hint{font-size:11px;margin-top:6px}.chat-thread{flex:1;overflow-y:auto;padding:30px max(24px,calc((100% - 750px)/2));scroll-behavior:auto}.confidence-note{border:1px solid var(--line);padding:16px 20px;border-radius:10px;margin-bottom:24px;background:var(--wash)}.confidence-note form{max-width:none}.confidence-note label{font-size:13px;margin:0 0 9px}.confidence{display:flex;gap:14px;align-items:center}.confidence input{min-height:20px;padding:0;accent-color:var(--primary);flex:1;min-width:60px}.confidence output{font-size:13px}.chat-welcome{text-align:center;max-width:560px;margin:35px auto 50px}.tutor-mark{font-size:40px}.chat-welcome h2{font:36px/1.2 Georgia,serif;letter-spacing:-1px;margin:18px 0}.chat-welcome p{font-size:14px;color:var(--muted);line-height:1.7}.prompt-choices{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:26px}.prompt-choices button{border:1px solid var(--line);border-radius:24px;background:var(--surface);padding:10px 15px;font-size:12px}.message{margin:0 0 28px;max-width:100%;font-size:15px}.from-you{margin-left:auto;max-width:85%;padding:16px 20px;background:var(--light);border-radius:18px 18px 4px 18px;white-space:normal}.from-tutor{padding:5px 0}.speaker{display:block;font-size:12px;font-weight:650;color:var(--muted);margin-bottom:10px}.speaker-row{display:flex;justify-content:space-between;align-items:baseline}.speaker span{font-size:21px;vertical-align:middle;margin-right:7px;color:var(--ink)}.prose{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.85;font-size:15px;margin:0}.from-you .prose{line-height:1.65}.message-action{border:0;background:transparent;color:var(--muted);padding:5px 0;font-size:12px;text-decoration:underline;text-underline-offset:4px}.sources{margin-top:18px;color:var(--muted);font-size:12px}.sources ul{padding-left:18px}summary{cursor:pointer}.composer-area{padding:12px max(24px,calc((100% - 750px)/2)) 14px;background:linear-gradient(to bottom,transparent,var(--paper) 30%)}.composer{border:1px solid var(--line);border-radius:26px;padding:12px 17px 10px;background:var(--surface);box-shadow:0 1px 2px rgba(23,35,64,.05),0 10px 30px rgba(23,35,64,.08)}.composer:focus-within{border-color:var(--accent)}.composer textarea{border:0;outline:none;width:100%;resize:vertical;min-height:55px;max-height:180px;padding:6px 5px;font-family:inherit;font-size:14px;line-height:1.65;background:transparent;color:var(--ink);box-shadow:none}.composer-right{display:flex;align-items:center;gap:10px}.composer-tools,.input-tools{display:flex;align-items:center;gap:9px}.composer-tools{justify-content:space-between}.attach-button{margin:0;width:34px;height:34px;display:grid;place-items:center;border-radius:50%;font-size:25px;font-weight:400;cursor:pointer}.attach-button:hover{background:var(--light)}.attach-button input{position:absolute;width:1px;height:1px;min-height:0;opacity:0;padding:0;border:0}.unavailable{opacity:.35;cursor:default}.attach-button:focus-within{outline:2px solid var(--ink)}.send-button{border:0;border-radius:50%;background:var(--primary);color:var(--surface);font-size:24px;width:36px;height:36px;display:grid;place-items:center;padding:0}.send-button:disabled{background:var(--line);color:var(--muted);opacity:1;cursor:default}.hint-button{border:0;background:transparent;color:var(--muted);font-size:12px;padding:8px}.composer-note{margin:9px 0 0;text-align:center;font-size:11px;color:var(--muted)}.attachment-chip{display:inline-flex;align-items:center;gap:12px;padding:5px 10px;border:1px solid var(--line);border-radius:6px;font-size:12px;margin:2px 4px 8px}.attachment-chip button{border:0;background:none;font-size:19px}.is-recording{border-color:var(--primary)}.working{font-size:13px;color:var(--muted)}.working span{font-size:20px;margin-right:8px}.review-step{margin:20px 0}.attempt-review,.assessment{margin:20px 0;padding:22px;background:var(--wash);border-radius:12px}.attempt-review h3,.assessment h3{font-size:19px;margin:8px 0 15px}.check{display:flex;align-items:flex-start;gap:10px;font-size:12px;font-weight:400;margin:14px 0}.check input{width:16px;min-height:16px;margin-top:3px;accent-color:var(--primary)}.transcript textarea,.assessment textarea,.assessment select{width:100%;padding:10px;border:1px solid var(--field);border-radius:6px;font:inherit;background:var(--surface)}.transcript{margin:20px 0}.assessment details{margin-top:20px;font-size:12px}.assessment label{margin-top:15px}.finished-message{display:flex;align-items:center;justify-content:center;gap:15px;font-size:13px;color:var(--muted)}.attachment-label{font-size:12px;color:var(--muted)}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
.estimate-toggle{display:inline-flex;align-items:center;gap:5px;border:0;border-radius:999px;background:var(--light);color:var(--edge);font-size:inherit;font-weight:600;padding:3px 10px;margin:2px 0}.estimate-toggle:hover{background:#c4d7f0}.estimate-toggle span{font-size:10px}
.attachment-list{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:2px 0 8px;padding:0}.attachment-list .attachment-chip{margin:0;gap:8px;padding:4px 4px 4px 6px;max-width:100%}.attachment-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.attachment-thumb{width:28px;height:28px;flex:none;object-fit:cover;border-radius:4px;background:var(--wash)}.attachment-chip button{min-width:28px;min-height:28px;padding:0;line-height:1;color:var(--muted)}.attachment-chip button:hover:not(:disabled){color:var(--ink)}
@media(max-width:900px){.study-chat{grid-template-columns:165px minmax(0,1fr)}.chat-heading{padding:18px;align-items:flex-start}.chat-heading h1{font-size:16px}.chat-heading .practice-button{font-size:11px;padding:8px}.chat-thread,.composer-area{padding-left:20px;padding-right:20px}.chat-history{padding-right:12px}}
@media(max-width:650px){.study-chat{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr);height:calc(100dvh - 149px);min-height:520px}.chat-history{display:flex;gap:6px;border-right:0;background:transparent;border-bottom:1px solid var(--light);padding:9px 0;overflow-x:auto;align-items:center}.new-lesson{width:auto;white-space:nowrap;padding:8px}.history-caption,.history-item small,.skill-detail{display:none}.history-item{width:auto;white-space:nowrap;margin:0;padding:8px}.history-item span{font-size:12px}.chat-main{min-height:0}.chat-heading{padding:14px 0}.chat-heading p{font-size:11px}.chat-thread{padding:18px 8px}.composer-area{padding:10px 0}.confidence{flex-wrap:wrap}.chat-welcome h2{font-size:29px}.chat-heading .practice-button{white-space:normal;max-width:115px}.heading-action{max-width:130px}.prose{font-size:14px}.from-you{max-width:94%}.finished-message{flex-wrap:wrap}}
</style>
