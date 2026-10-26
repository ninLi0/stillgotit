<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useAttachUpload } from "./attach-upload.ts";
import SpeechInput from "./SpeechInput.vue";
import SourcesUsed from "./SourcesUsed.vue";
import ReplyMeta from "./ReplyMeta.vue";
import ReplyActions from "./ReplyActions.vue";
import EstimatePanel from "./EstimatePanel.vue";
import PixelIcon from "./PixelIcon.vue";
import MasteryCells from "./MasteryCells.vue";
import InfoBubble from "./InfoBubble.vue";
import { stageOf } from "./pixel-art.ts";
import type { OpenSource } from "./revamp-types.ts";
import { api, unwrap } from "./api.ts";
import { messageTime, resultLabels, secondsLabel, sessionLabels, turnsLabel } from "./labels.ts";
import { UnansweredQuestions, answerSeconds, citedSources, localStore } from "./reply-stats.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { PendingAdjustment, sessionStore } from "./pending-adjustment.ts";
import { listenUnavailable, stopSpeaking } from "./speech.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
import { answerKey, newAnswers, takeTutor, tutorLabel, type TutorUsed } from "./tutor-choice.ts";
import { sessionRequest, takeSession } from "./continue-session.ts";
type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];
type StudySession = SkillData["sessions"][number];
/** A photo uploaded for the answer being written. `preview` is a local picture of it, so learners can tell photos apart. */
type Attachment = { material: string; name: string; preview: string };
// aiReason explains why AI features are off when aiAvailable is false. materials gives titles for cited sources.
// initialDraft prefills the message box of a new conversation (for example "Ask about this page" in Materials); it is never sent by itself.
const props = defineProps<{ skill: string; course: string; materials: { material: string; title: string }[]; aiAvailable: boolean; aiReason: string; active?: boolean; initialDraft?: string }>();
// `back` returns to the skill tree. `open-source` asks the shell to show a cited source in Materials.
const emit = defineEmits<{ changed: []; back: []; "open-source": [source: OpenSource] }>();
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
// `success` is shown after the step finishes; a function gives a sentence that depends on how the step went.
// Focus returns to the control the learner used, or to the result when that control is gone.
async function act(work: () => Promise<void>, success: string | (() => string) = "") {
  const previous = focusedControl();
  busy.value = true; error.value = ""; notice.value = "";
  try { await work(); await load(); notice.value = typeof success === "function" ? success() : success; emit("changed"); }
  catch (problem) { error.value = problem instanceof Error ? problem.message : "This step could not finish."; await load().catch(() => undefined); }
  finally {
    busy.value = false; await nextTick();
    restoreFocus(previous, () => (error.value ? errorBox.value : noticeBox.value) ?? (composerInput.value?.disabled === false ? composerInput.value : heading.value));
  }
}
// While the tutor answers, the message leaves the box and waits in the thread as "Sending". A failure puts it back.
// `reply` says whether the tutor answers it: a lesson question does, while a practice answer is only saved.
const pending = ref<{ text: string; files: string[]; reply: boolean } | null>(null);
// The tutor's place shows how long the learner has waited, in whole seconds. It stops when the answer lands.
const waitStarted = ref(0), waitNow = ref(0);
let waitTicker: ReturnType<typeof setInterval> | undefined;
watch(pending, (now) => {
  clearInterval(waitTicker); waitTicker = undefined;
  if (!now?.reply) return;
  waitStarted.value = waitNow.value = Date.now();
  waitTicker = setInterval(() => { waitNow.value = Date.now(); }, 1000);
});
const waited = computed(() => secondsLabel(Math.floor((waitNow.value - waitStarted.value) / 1000)));
onBeforeUnmount(() => clearInterval(waitTicker));
function takeDraft() {
  const text = response.value, sent = attachments.value, ch = channel.value;
  pending.value = { text, files: sent.map((item) => item.name), reply: !current.value?.task };
  response.value = ""; attachments.value = []; channel.value = "TEXT";
  void scrollToLatest(true);
  return { text, sent, ch, restore() { response.value = text; attachments.value = sent; channel.value = ch; pending.value = null; } };
}
async function startLesson() {
  const draft = takeDraft();
  await act(async () => {
    try { const result = await timedAnswer(async () => unwrap(await api.learning.lesson({ skill: props.skill, request: draft.text.trim() }))); freshLesson.value = false; selected.value = result.lesson; }
    catch (problem) { draft.restore(); throw problem; }
    finally { pending.value = null; }
  });
}
function newLesson() { if (busy.value || recording.value) return; freshLesson.value = true; selected.value = ""; reviewOpen.value = false; error.value = ""; notice.value = ""; }
function selectSession(id: StudySession["session"]) { if (busy.value || recording.value) return; freshLesson.value = false; selected.value = id; reviewOpen.value = false; error.value = ""; notice.value = ""; }
async function submitMessage() { if (!canSend.value) return; if (current.value) await send(); else await startLesson(); }
// A starter prompt fills the message box. Focus moves there so the learner can edit it or press Enter to send.
function choosePrompt(text: string) { response.value = text; composerInput.value?.focus(); }
function enterToSend(event: KeyboardEvent) { if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); void submitMessage(); } }
// New messages scroll the thread to the latest one. A learner who has scrolled more than one screen up to read is not
// pulled away: "Jump to latest" appears instead. `force` scrolls anyway, for the learner's own message and a newly chosen conversation.
const awayFromLatest = ref(false), newBelow = ref(false), jumpButton = ref<HTMLButtonElement | null>(null);
function onThreadScroll() {
  const box = thread.value; if (!box) return;
  awayFromLatest.value = box.scrollHeight - box.scrollTop - box.clientHeight > box.clientHeight;
  if (!awayFromLatest.value) newBelow.value = false;
}
async function scrollToLatest(force = false) {
  if (!force && awayFromLatest.value) { newBelow.value = true; return; }
  await nextTick();
  if (thread.value) thread.value.scrollTop = thread.value.scrollHeight;
  awayFromLatest.value = false; newBelow.value = false;
}
/** The pill scrolls to the latest message. Keyboard focus, which was on the pill, moves to the message box or the thread. */
function jumpToLatest() {
  const box = thread.value; if (!box) return;
  const hadFocus = document.activeElement === jumpButton.value;
  box.scrollTo({ top: box.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  awayFromLatest.value = false; newBelow.value = false;
  if (hadFocus) (composerInput.value && !composerInput.value.disabled ? composerInput.value : box).focus({ preventScroll: true });
}
// The message box grows with its text up to six lines; CSS caps the height, and longer text scrolls inside the box.
function fitComposer() {
  const box = composerInput.value; if (!box) return;
  box.style.height = "auto"; box.style.height = `${box.scrollHeight}px`;
}
watch(response, () => { void nextTick(fitComposer); });
onMounted(() => window.addEventListener("resize", fitComposer));
onBeforeUnmount(() => window.removeEventListener("resize", fitComposer));
async function startTask() { await act(async () => { const result = await timedAnswer(async () => unwrap(await api.learning.task({ skill: props.skill }))); freshLesson.value = false; selected.value = result.task; reviewOpen.value = false; reviewed.value = false; unseen.value = true; outsideHelp.value = false; }); }
async function send() {
  const session = current.value; if (!session) return;
  const draft = takeDraft();
  let recovered = "";
  await act(async () => {
    // Photos go in the order the learner attached them.
    const input = { studySession: session.session, text: draft.text, channel: draft.ch, attachments: draft.sent.map((item) => item.material), dialogueLength: session.dialogue.length };
    try {
      if (session.lesson) await timedAnswer(async () => unwrap(await api.learning.question(input)));
      else unwrap(await api.learning.respond(input));
      reviewed.value = false;
      draft.sent.forEach(forgetPreview);
    } catch (problem) {
      // The server may have saved the question and failed only on the tutor's reply. Then the reloaded thread shows it with its
      // retry button and the draft stays out of the box, so sending again cannot post it twice. Otherwise the draft and every photo come back.
      await load().catch(() => undefined);
      const now = current.value;
      const saved = !!now && now.session === session.session &&
        now.dialogue.slice(session.dialogue.length).some((item) => item.turn.speaker === "LEARNER" && item.turn.text === draft.text);
      if (saved) draft.sent.forEach(forgetPreview); else draft.restore();
      // A practice answer waits for no tutor reply, so once it is saved the send has done its work and ends as a success.
      if (saved && !session.lesson) { reviewed.value = false; recovered = "Your answer was saved."; return; }
      throw problem;
    }
    finally { pending.value = null; }
  }, () => recovered);
}
function forgetPreview(item: Attachment) { if (item.preview) { URL.revokeObjectURL(item.preview); previews.delete(item.preview); } }
const attach = useAttachUpload(() => props.course);
/**
 * Each photo is uploaded to this skill's course as its own material, in the order chosen. A failed photo does not stop
 * the rest, and it keeps its request ID, so choosing it again never saves it twice.
 */
async function uploadWork(event: Event) {
  const files = attach.take(event);
  if (!files.length) return;
  await act(async () => {
    const problems: string[] = [];
    for (const file of files) {
      try {
        const material = await attach.upload(file);
        const preview = file.type.startsWith("image/") ? URL.createObjectURL(file) : "";
        if (preview) previews.add(preview);
        attachments.value = [...attachments.value, { material, name: file.name, preview }];
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
async function requestHint() { const active = current.value; if (active) await act(async () => { await timedAnswer(async () => unwrap(await api.learning.hint({ studySession: active.session }))); }); }
async function retryReply() { const active = current.value; if (active) await act(async () => { await timedAnswer(async () => unwrap(await api.learning.reply({ studySession: active.session }))); }); }
async function correctTranscript(turnIndex: number) { const active = current.value; if (!active) return; await act(async () => { unwrap(await api.learning.transcript({ studySession: active.session, turnIndex, text: speechEdits.value[turnIndex] ?? "" })); reviewed.value = false; }, "Transcript correction saved. Review your answer again before assessment."); }
async function requestRegrade(assessment: string, basedOn: string) {
  await act(async () => { unwrap(await api.learning.regrade({ case: assessment, basedOn, reason: reason.value })); reason.value = ""; }, "Regrade saved. The assessment above shows the new result.");
}
async function saveCorrection(assessment: string, basedOn: string) {
  await act(async () => { unwrap(await api.learning.correct({ case: assessment, basedOn, result: correction.value, gateMet: fullGate.value, reason: reason.value })); reason.value = ""; }, "Correction saved. The assessment above shows your correction.");
}
// ---- Presentation for the Pixel Nature layout (design/revamp/README.md) ----
const pct = computed(() => data.value?.estimate ? data.value.estimate.value : null);
const pctText = computed(() => pct.value === null ? "–" : `${Math.round(pct.value)}%`);
const stage = computed(() => stageOf(pct.value));
const masteryNote = computed(() => [data.value?.estimate?.basis ?? "No estimate yet. Set your starting confidence, then practice.",
  data.value?.explanation?.provisional ? "Provisional: no assessed attempt has counted toward this estimate yet." : "",
  "The mastery estimate is a study aid, not a course grade."].filter(Boolean).join(" "));
const composerNote = computed(() => current.value?.task ? "Review your complete answer before requesting assessment." : "Grounded in your course materials. Check important details.");
/**
 * Session identities are time-ordered UUIDs (version 7), whose first 48 bits are the start time: the moment the opening
 * lesson or task was saved. Older ones have no time.
 */
function sessionStart(id: string) { return id[14] === "7" ? parseInt(id.replace(/-/g, "").slice(0, 12), 16) : NaN; }
const tabDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
// The opening's time is when the lesson or task was saved; the read records no separate time for the learner's request.
const openingTime = computed(() => {
  const time = current.value ? sessionStart(current.value.session) : NaN;
  return Number.isFinite(time) ? { label: messageTime(time), iso: new Date(time).toISOString() } : null;
});
function sessionDate(id: string) {
  const time = sessionStart(id);
  return Number.isFinite(time) ? tabDate.format(new Date(time)) : "";
}
function assessed(id: string) { return data.value?.cases.some((item) => item.task === id && !!item.judgment) ?? false; }
// Every source this skill's conversations were taught from, once each, for the rail's Taught from card.
const railCitations = computed(() => citedSources(data.value?.sessions ?? []));
/** Splits a tutor answer into prose and fenced code or $$ maths blocks, so blocks render in the mono font. */
function blocks(text: string): { code: boolean; text: string }[] {
  const out: { code: boolean; text: string }[] = [], pattern = /```[^\n]*\n?([\s\S]*?)```|\$\$([\s\S]*?)\$\$/g;
  let last = 0, match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) out.push({ code: false, text: text.slice(last, match.index).replace(/^\n+|\n+$/g, "") });
    out.push({ code: true, text: (match[1] ?? match[2] ?? "").replace(/\n+$/, "") });
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push({ code: false, text: text.slice(last).replace(/^\n+/, "") });
  return out.filter((part) => part.code || part.text.trim());
}
const SUCCESS = new Set(["INDEPENDENT", "SUPPORTED"]);
/** The estimate before and after an assessed attempt, and the change, from the timeline row whose attempt is that case. */
function attemptChange(assessment: string) {
  const change = data.value?.explanation?.changes.find((row) => row.kind === "ATTEMPT" && row.source === assessment);
  if (!change) return null;
  const delta = Math.round(change.after) - Math.round(change.before);
  return { before: `${Math.round(change.before)}%`, after: `${Math.round(change.after)}%`,
    delta: delta === 0 ? "No change" : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${Math.abs(delta) === 1 ? "point" : "points"}` };
}
/** Why an assessed attempt did not count toward the estimate, as the timeline gives it, or empty when it counted. */
function ignoredReason(assessment: string) { return data.value?.explanation?.ignored.find((row) => row.evidence === assessment)?.reason ?? ""; }
// Under 1240px the rail slides over the lesson; the mastery chip opens it. evidenceOpen keeps its old meaning: the evidence is in view.
const narrow = ref(false), railChip = ref<HTMLElement | null>(null), railClose = ref<HTMLButtonElement | null>(null);
let narrowQuery: MediaQueryList | null = null;
const onNarrow = () => { narrow.value = !!narrowQuery?.matches; };
onMounted(() => { narrowQuery = window.matchMedia("(max-width: 1239px)"); onNarrow(); narrowQuery.addEventListener("change", onNarrow); });
onBeforeUnmount(() => narrowQuery?.removeEventListener("change", onNarrow));
async function toggleRail() { evidenceOpen.value = !evidenceOpen.value; await nextTick(); if (evidenceOpen.value) railClose.value?.focus(); }
async function closeRail() { evidenceOpen.value = false; await nextTick(); railChip.value?.focus(); }
function openSource(source: OpenSource) { emit("open-source", source); }
/** A draft from elsewhere starts a new conversation with the message box filled in and focused. It is not sent. */
async function applyDraft(draft: string | undefined) {
  if (!draft) return;
  if (!freshLesson.value || selected.value !== "") { freshLesson.value = true; reviewOpen.value = false; selected.value = ""; await nextTick(); }
  response.value = draft; channel.value = "TEXT";
  await nextTick();
  if (!busy.value && composerInput.value && !composerInput.value.disabled) { composerInput.value.focus(); return; }
  const stop = watch(busy, async (now) => { if (!now) { stop(); await nextTick(); composerInput.value?.focus(); } });
}
watch(() => props.skill, (skill) => {
  selected.value = ""; data.value = null; response.value = ""; attachments.value = []; reviewed.value = false;
  // An unanswered adjustment from before a reload is shown at once, so the learner can see it and send it again.
  evidenceOpen.value = !!new PendingAdjustment(sessionStore(), skill).read();
  act(load);
}, { immediate: true });
watch(() => props.initialDraft, (draft) => { void applyDraft(draft); }, { immediate: true });
// Home's Continue card names a session of this skill. A page that has not loaded yet shows it once loaded; a loaded page
// switches to it when the current step finishes, and reads again if the session is newer than what it has.
watch([() => props.skill, sessionRequest], () => {
  const id = takeSession(props.skill); if (!id) return;
  const show = () => { freshLesson.value = false; selected.value = id; reviewOpen.value = false; if (data.value && !data.value.sessions.some((session) => session.session === id)) void act(load); };
  if (!data.value || (!busy.value && !recording.value)) { show(); return; }
  const stop = watch([busy, recording], ([working, speaking]) => { if (!working && !speaking) { stop(); show(); } });
}, { immediate: true });
/** The shell's "Check my understanding": the same admission as the header button. A refusal shows its sentence in the alert area. */
async function startPractice() {
  if (busy.value || !data.value) return;
  const refusal = practiceReason.value || (!props.aiAvailable ? aiOff.value : "");
  if (refusal) { notice.value = ""; error.value = refusal; await nextTick(); errorBox.value?.focus(); return; }
  await startTask();
}
defineExpose({ startPractice });
watch(selected, (next, previous) => {
  unsent.set(previous, { text: response.value, channel: channel.value, attachments: attachments.value });
  const saved = unsent.get(next); response.value = saved?.text ?? ""; channel.value = saved?.channel ?? "TEXT"; attachments.value = saved?.attachments ?? []; reviewed.value = false;
  void scrollToLatest(true);
});
watch(() => [current.value?.dialogue.length, busy.value], () => { void scrollToLatest(); });
watch(current, (session) => { speechEdits.value = Object.fromEntries(session?.voice.map((voice) => [voice.turnIndex, voice.text]) ?? []); });
// Each tutor answer names the model and thinking level that wrote it. The read after it shows which answers are new, and they get that label.
const answeredBy = ref<Record<string, TutorUsed>>({});
function answerLabel(...key: Parameters<typeof answerKey>) { const tutor = answeredBy.value[answerKey(...key)]; return tutor ? tutorLabel(tutor) : ""; }
// Each answer that arrives while the page is open also gets the time the page measured: from sending the request to the
// reply's arrival. The read after it shows which answers are new. Measurements last until the page reloads.
const measured = ref<Record<string, number>>({});
let lastAnswerSeconds: number | null = null;
/** Runs one request that brings a tutor answer and notes how long it took, for the read that follows. A failure notes nothing. */
async function timedAnswer<T>(request: () => Promise<T>): Promise<T> {
  const started = performance.now();
  lastAnswerSeconds = null;
  const result = await request();
  lastAnswerSeconds = Math.round((performance.now() - started) / 1000);
  return result;
}
watch(data, (next, previous) => {
  const tutor = takeTutor(), seconds = lastAnswerSeconds;
  lastAnswerSeconds = null;
  if (!next || !previous) return;
  for (const key of newAnswers(previous, next)) {
    if (tutor) answeredBy.value[key] = tutor;
    if (seconds !== null && !key.startsWith("judgment:")) measured.value[key] = seconds;
  }
}, { flush: "sync" });
// A lesson question seen waiting without a reply gets its answer from a retry, whose saved times include the wait.
// The browser remembers such questions, so after a reload their replies show no answer time rather than a wrong one.
const unansweredStore = new UnansweredQuestions(localStore());
const unanswered = reactive(new Set(unansweredStore.list()));
watch([current, pending], ([session, waiting]) => {
  const last = session?.dialogue.at(-1);
  if (!session?.lesson || waiting || last?.turn.speaker !== "LEARNER") return;
  const mark = `${session.session}:${last.turnIndex}`;
  if (!unanswered.has(mark)) { unanswered.add(mark); unansweredStore.add(mark); }
}, { immediate: true });
/** A reply's answer time: the page's own measurement, else the saved times for a lesson reply that was not retried. */
function replySeconds(session: StudySession, turnIndex: number) {
  return measured.value[answerKey("turn", session.session, turnIndex)]
    ?? answerSeconds(session.dialogue, turnIndex, (question) => unanswered.has(`${session.session}:${question}`));
}
// Reading aloud stops when the learner leaves this page: another view, another skill, or closing it.
watch(() => props.active, (active) => { if (active === false) stopSpeaking(); });
onDeactivated(stopSpeaking);
onBeforeUnmount(() => { stopSpeaking(); previews.forEach((url) => URL.revokeObjectURL(url)); previews.clear(); });
</script>

<template>
  <section class="learn" :class="{ narrow, 'rail-open': evidenceOpen }" :aria-busy="busy">
    <div class="learn-main">
      <header class="learn-head">
        <div class="head-row">
          <div class="head-title">
            <span class="sprite-tile"><PixelIcon :sprite="stage" :size="36" /></span>
            <div class="title-block">
              <button type="button" class="back-link" @click="emit('back')">← Your skill tree</button>
              <h1 id="page-title" ref="heading" tabindex="-1">{{ data?.skill.title || 'Opening your lesson…' }}</h1>
              <p class="sr-only">{{ current?.task ? 'Independent practice' : 'Lesson' }}<template v-if="estimateText"> · {{ estimateText }}</template></p>
            </div>
          </div>
          <div class="head-actions">
            <button v-if="narrow" ref="railChip" type="button" class="mastery-chip" :aria-expanded="evidenceOpen" aria-controls="learn-rail" :aria-label="`${estimateText || 'No estimate yet'}. ${evidenceOpen ? 'Hide' : 'Show'} mastery and evidence`" @click="toggleRail">
              <span class="chip-top"><strong>{{ pctText }}</strong><span>mastery</span></span><MasteryCells :value="pct" :cells="7" :height="4" label="" aria-hidden="true" />
            </button>
            <div v-else class="mastery-chip static" role="img" :aria-label="estimateText || 'No estimate yet'"><span class="chip-top"><strong>{{ pctText }}</strong><span>mastery</span></span><MasteryCells :value="pct" :cells="7" :height="4" label="" aria-hidden="true" /></div>
            <div class="heading-action"><button class="primary dawn practice-button" :disabled="busy || recording || !aiAvailable || !data?.track" :aria-describedby="describedBy(!!practiceReason && 'practice-reason', !aiAvailable && 'ai-reason-chat')" @click="startTask">Check my understanding</button><p v-if="practiceReason" id="practice-reason" class="hint reason">{{ practiceReason }}</p></div>
          </div>
        </div>
        <nav class="tabs" aria-label="Conversations for this skill">
          <button v-for="session in data?.sessions" :key="session.session" type="button" class="tab" :class="{ chosen: !freshLesson && selected === session.session }" :aria-current="!freshLesson && selected === session.session ? 'true' : undefined" :title="session.lesson?.request || (session.status === 'CLOSED' ? 'Submitted work' : 'Independent check')" :disabled="busy || recording" @click="selectSession(session.session)">
            <span class="tab-square" :class="session.lesson ? 'lesson' : 'practice'" aria-hidden="true" />{{ labels[session.session] }}<span class="tab-meta"><span v-if="sessionDate(session.session)" class="tab-date">{{ sessionDate(session.session) }}<span aria-hidden="true"> · </span></span><span class="sr-only">, </span>{{ turnsLabel(session.dialogue.length) }}</span><span v-if="assessed(session.session)" class="tab-done"><span aria-hidden="true">✓</span><span class="sr-only">, assessed</span></span>
          </button>
          <button type="button" class="new-lesson" :class="{ chosen: freshLesson || !data?.sessions.length }" :disabled="busy || recording" @click="newLesson">+ New conversation</button>
        </nav>
      </header>
      <div class="thread-wrap">
        <div ref="thread" class="chat-thread" tabindex="-1" @scroll.passive="onThreadScroll">
          <div class="thread-inner">
            <div v-if="data && !data.track" class="confidence-note">
              <form @submit.prevent="saveConfidence"><label for="confidence">How confident do you feel?</label><div class="confidence"><input id="confidence" v-model.number="confidence" type="range" min="0" max="100" :disabled="busy" /><output>{{ confidence }}%</output><button :disabled="busy" class="secondary dawn small-button">Set starting point</button></div><p class="hint">A rough estimate is fine. Your practice will refine it.</p></form>
            </div>
            <div v-if="!current && data && !pending" class="chat-welcome">
              <PixelIcon name="leaf" :size="48" /><h2>Let's work through it.</h2><p>{{ data.skill.outcome }}</p>
              <div class="prompt-choices"><button :disabled="busy" @click="choosePrompt('Explain this skill with a worked example.')">Show me an example</button><button :disabled="busy" @click="choosePrompt('Explain why this method works, using a concrete example.')">Help me understand why</button><button :disabled="busy" @click="choosePrompt('Walk me through guided practice. Ask one question at a time.')">Guide me through practice</button></div>
            </div>
            <template v-if="current">
              <!-- The opening: the learner's request, then the lesson or practice task in a card. A divider separates it from the dialogue. -->
              <div class="opening">
                <div v-if="current.lesson" class="message from-you"><span class="sr-only">You</span><p class="prose">{{ current.lesson.request }}</p></div>
                <article class="message from-tutor opening-card" :class="{ latest: !current.dialogue.length }" :title="openingTime?.label">
                  <div class="speaker-row"><span class="speaker"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span> StillGotIt<span v-if="openingTime" class="sr-only">, <time :datetime="openingTime.iso">{{ openingTime.label }}</time></span><span v-if="current.task" class="tag task">Practice task</span></span></div>
                  <div class="prose-blocks"><template v-for="(part, partIndex) in blocks(current.lesson?.explanation || current.task?.question || '')" :key="partIndex"><pre v-if="part.code" class="code-block">{{ part.text }}</pre><p v-else class="prose">{{ part.text }}</p></template></div>
                  <SourcesUsed v-if="current.citations.length" :key="current.session" compact :citations="current.citations" :titles="materialTitles" :id-prefix="`passage-${current.session}`" @open="openSource" />
                  <div class="reply-foot"><ReplyMeta :seconds="measured[answerKey('session', current.session)]" :sources="current.citations.length" :tutor="answerLabel('session', current.session)" /><ReplyActions :message-key="`${current.session}:opening`" :text="current.lesson?.explanation || current.task?.question || ''" :what="current.lesson ? 'lesson' : 'practice question'" describedby="listen-reason" /></div>
                </article>
              </div>
              <div v-if="current.dialogue.length || pending" class="thread-divider" role="separator" aria-label="Conversation"><span aria-hidden="true">Conversation</span></div>
              <article v-for="(item, position) in current.dialogue" :key="item.turnIndex" class="message" :class="[item.turn.speaker === 'LEARNER' ? 'from-you' : 'from-tutor', { latest: position === current.dialogue.length - 1 }]" :title="messageTime(item.turn.at) || undefined">
                <template v-if="item.turn.speaker === 'TUTOR'">
                  <div class="speaker-row"><span class="speaker"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span> StillGotIt<span v-if="messageTime(item.turn.at)" class="sr-only">, <time :datetime="item.turn.at">{{ messageTime(item.turn.at) }}</time></span><span v-if="item.turn.purpose === 'HINT'" class="tag hint-tag">Hint</span><span v-else-if="item.turn.purpose === 'CORRECTION'" class="tag">Transcript correction</span></span></div>
                  <div class="prose-blocks"><template v-for="(part, partIndex) in blocks(item.turn.text)" :key="partIndex"><pre v-if="part.code" class="code-block">{{ part.text }}</pre><p v-else class="prose">{{ part.text }}</p></template></div>
                  <SourcesUsed v-if="item.turn.citations.length" :key="`${current.session}:${item.turnIndex}`" :citations="item.turn.citations" :titles="materialTitles" :id-prefix="`passage-${current.session}-${item.turnIndex}`" compact @open="openSource" />
                </template>
                <template v-else><span class="sr-only">You{{ purposeNote(item.turn.purpose) }}</span><span v-if="messageTime(item.turn.at)" class="sr-only">, <time :datetime="item.turn.at">{{ messageTime(item.turn.at) }}</time></span><span v-if="purposeNote(item.turn.purpose)" class="tag you-tag" aria-hidden="true">{{ purposeNote(item.turn.purpose).replace(' · ', '') }}</span>
                  <p class="prose">{{ item.turn.text }}</p></template>
                <p v-for="(file, fileIndex) in item.turn.media" :key="file.file" class="attachment-label"><span class="attach-thumb" aria-hidden="true" />{{ item.turn.media.length > 1 ? `Attachment ${fileIndex + 1} of ${item.turn.media.length}` : 'Attachment' }} · {{ file.name }}</p>
                <div v-if="item.turn.speaker === 'TUTOR'" class="reply-foot"><ReplyMeta :seconds="replySeconds(current, item.turnIndex)" :sources="item.turn.citations.length" :tutor="answerLabel('turn', current.session, item.turnIndex)" /><ReplyActions :message-key="`${current.session}:${item.turnIndex}`" :text="item.turn.text" :what="item.turn.purpose === 'HINT' ? 'hint' : 'tutor reply'" describedby="listen-reason" /></div></article>
              <!-- A lesson question without a reply: the retry sits where the tutor's reply would be. -->
              <div v-if="current.lesson && current.dialogue.at(-1)?.turn.speaker === 'LEARNER' && !pending" class="retry-row"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span><button class="secondary dawn reply-retry" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="retryReply"><span aria-hidden="true">↻</span>Retry tutor reply</button></div>
              <div v-if="current.task && current.status === 'OPEN' && current.dialogue.some(item => item.turn.speaker === 'LEARNER' && item.turn.purpose === 'RESPONSE')" class="review-step">
                <button class="secondary dawn" :disabled="busy || recording" :aria-expanded="reviewOpen" @click="reviewOpen = !reviewOpen">{{ reviewOpen ? 'Close review' : 'Review and assess my work' }}</button>
                <div v-if="reviewOpen" class="attempt-review">
                  <div class="review-title"><h3>Ready for assessment?</h3><InfoBubble text="Review your complete answer before assessment. Your answers to these three questions go with your work, and Assess stays off until you confirm the review." /></div>
                  <div v-for="voice in current.voice" :key="voice.turnIndex" class="transcript"><label :for="`voice-${voice.turnIndex}`">Speech transcript {{ voice.turnIndex + 1 }}</label><textarea :id="`voice-${voice.turnIndex}`" v-model="speechEdits[voice.turnIndex]" rows="3" /><button class="message-action" :disabled="busy" @click="correctTranscript(voice.turnIndex)">Save transcript correction</button></div>
                  <label class="check"><input v-model="unseen" type="checkbox" /><span class="box" aria-hidden="true" />These exact problems are new to me.</label><label class="check"><input v-model="outsideHelp" type="checkbox" /><span class="box" aria-hidden="true" />I used help outside this conversation.</label><label class="check"><input v-model="reviewed" type="checkbox" /><span class="box" aria-hidden="true" />I reviewed my answer and all speech transcripts.</label>
                  <div class="assess-row"><button class="primary dawn" :disabled="busy || !!assessReason" :aria-describedby="assessReason ? 'assess-reason' : undefined" @click="assess">Assess my work</button><p v-if="assessReason" id="assess-reason" class="hint reason">{{ assessReason }}</p></div>
                </div>
              </div>
              <button v-if="current.status === 'CLOSED' && !currentCases.some(item => item.judgment)" class="secondary dawn" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="assess">Retry saved assessment</button>
              <article v-for="item in currentCases" :key="item.case" class="assessment">
                <template v-if="item.judgment">
                  <div class="result-top"><div><p class="eyebrow">Assessment</p><h3 :class="{ success: SUCCESS.has(item.judgment.result) }">{{ resultLabels[item.judgment.result] }}</h3></div><div v-if="attemptChange(item.case)" class="result-figure"><p class="eyebrow">Mastery</p><p class="result-pct"><span aria-hidden="true">{{ attemptChange(item.case)!.before }} → {{ attemptChange(item.case)!.after }}</span><span class="sr-only">from {{ attemptChange(item.case)!.before }} to {{ attemptChange(item.case)!.after }}</span></p><p class="result-delta">{{ attemptChange(item.case)!.delta }}</p></div>
                    <div v-else-if="ignoredReason(item.case)" class="result-figure unchanged"><p class="eyebrow">Mastery</p><p class="result-same">Did not change the estimate</p><p class="result-delta">{{ ignoredReason(item.case) }}</p></div></div>
                  <p class="prose rationale">{{ item.judgment.rationale }}</p>
                  <p v-if="answerLabel('judgment', item.judgment.judgment)" class="tutor-label">{{ answerLabel('judgment', item.judgment.judgment) }}</p>
                  <div class="result-actions"><button v-if="current.status === 'CLOSED'" class="secondary dawn" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="startTask">Try a fresh check</button></div>
                  <details class="regrade"><summary>This seems wrong? Review or correct this assessment</summary><label>Reason<textarea v-model="reason" rows="3" /></label><p v-if="!reason.trim()" :id="`reason-needed-${item.case}`" class="hint reason">Write a reason to request a regrade or save a correction.</p><button class="message-action" :disabled="busy || !aiAvailable || !reason.trim()" :aria-describedby="describedBy(!reason.trim() && `reason-needed-${item.case}`, !aiAvailable && 'ai-reason-chat')" @click="requestRegrade(item.case, item.judgment.judgment)">Request regrade</button>
                    <label>Manual correction<select v-model="correction"><option v-for="(label,value) in resultLabels" :key="value" :value="value">{{ label }}</option></select></label><label class="check"><input v-model="fullGate" type="checkbox" /><span class="box" aria-hidden="true" />All requirements were met in fresh independent work.</label><button class="message-action" :disabled="busy || !reason.trim()" :aria-describedby="reason.trim() ? undefined : `reason-needed-${item.case}`" @click="saveCorrection(item.case, item.judgment.judgment)">Save correction</button><ol><li v-for="judgment in item.history" :key="judgment.judgment">{{ resultLabels[judgment.result] }} · {{ judgment.origin === 'AI' ? 'Tutor' : 'Your correction' }}<p>{{ judgment.rationale }}</p></li></ol></details>
                </template><p v-else>Your answer is saved. Assessment is pending.</p>
              </article>
            </template>
            <div role="status"><p v-if="notice && !busy" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
            <div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div>
            <article v-if="pending" class="message from-you pending" aria-live="polite"><span class="sr-only">You</span><p class="prose">{{ pending.text }}</p><p v-for="(name, fileIndex) in pending.files" :key="fileIndex" class="attachment-label"><span class="attach-thumb" aria-hidden="true" />Attachment · {{ name }}</p><p class="sending">Sending…</p></article>
            <article v-if="pending?.reply" class="message from-tutor thinking" aria-hidden="true"><div class="speaker-row"><span class="speaker"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span> StillGotIt</span></div><p class="prose dots"><span>·</span><span>·</span><span>·</span></p><span class="waited">{{ waited }}</span></article>
            <!-- While the tutor's dots show, they are the visible sign of work; the sentence stays for screen readers. -->
            <p v-if="busy" class="working" :class="{ 'sr-only': pending?.reply }" role="status"><PixelIcon name="leaf" :size="18" /> Working on it…</p>
          </div>
        </div>
        <div v-if="newBelow" class="jump-wrap"><button ref="jumpButton" type="button" class="jump-latest" @click="jumpToLatest">Jump to latest <span aria-hidden="true">↓</span></button></div>
      </div>
      <div class="composer-area">
        <div class="composer-inner">
          <template v-if="!current || current.status === 'OPEN'">
            <div class="composer" :class="{ 'is-recording': recording }">
              <ul v-if="attachments.length" ref="attachmentList" class="attachment-list" aria-label="Photos attached to this answer">
                <li v-for="(item, index) in attachments" :key="item.material" class="attachment-chip"><img v-if="item.preview" :src="item.preview" alt="" class="attachment-thumb" /><span>{{ attachments.length > 1 ? `${index + 1}. ` : '' }}{{ item.name }}</span><button type="button" :aria-label="`Remove photo ${index + 1}, ${item.name}`" :disabled="busy" @click="removeAttachment(index)">×</button></li>
              </ul>
              <label class="sr-only" for="chat-message">{{ current?.task ? 'Your answer and reasoning' : 'Message your tutor' }}</label>
              <textarea id="chat-message" ref="composerInput" v-model="response" rows="2" :disabled="busy" :placeholder="current?.task ? 'Explain your reasoning. You can type, speak, or attach your work.' : 'Ask a question or tell me what you want to learn…'" @keydown="enterToSend" />
              <div class="composer-tools"><div class="input-tools"><label class="attach-button tool-pill" :class="{ unavailable: !current || busy || recording }" :title="current ? 'Attach photos of your work' : 'Start a lesson before attaching work'"><span aria-hidden="true">＋ Photo of work</span><span class="sr-only">{{ attachments.length ? 'Add another photo of your work' : 'Add photos of your work' }}</span><input type="file" accept="image/*" capture="environment" multiple :disabled="busy || recording || !current" @change="uploadWork" /></label>
                <SpeechInput :disabled="busy || !aiAvailable" :active="active !== false" :describedby="aiAvailable ? undefined : 'ai-reason-chat'" compact @recording="recording = $event" @transcript="response = response ? response + '\n' + $event : $event; channel = 'VOICE'" @error="error = $event" />
                <button v-if="current?.task" class="hint-button tool-pill" :disabled="busy || recording || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="requestHint">Ask for a hint</button>
              </div><div class="composer-right"><span class="note-info"><InfoBubble :text="composerNote" label="About this message box" /></span><button class="send-button" :disabled="!canSend" :aria-label="current?.task ? 'Save answer' : 'Send message'" :aria-describedby="aiAvailable || current?.task ? undefined : 'ai-reason-chat'" @click="submitMessage"><span aria-hidden="true">↑</span></button></div></div>
            </div>
            <p v-if="recording" class="composer-note" role="status">Recording. Stop to review your words before sending.</p>
          </template>
          <div v-else class="finished-message"><p>This attempt is saved.</p><button v-if="!currentCases.some(item => item.judgment)" class="secondary dawn" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="startTask">Try a fresh check</button><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
          <p v-if="aiOff" id="ai-reason-chat" class="hint">{{ aiOff }}</p>
          <p v-if="current && listenUnavailable" id="listen-reason" class="hint">{{ listenUnavailable }}</p>
        </div>
      </div>
    </div>
    <div v-if="narrow && evidenceOpen" class="rail-backdrop" aria-hidden="true" @click="closeRail" />
    <aside id="learn-rail" class="rail" aria-label="Mastery, goal, evidence and sources" :hidden="narrow && !evidenceOpen ? true : undefined" @keydown.esc.stop="narrow && closeRail()">
      <div v-if="narrow" class="rail-close"><span class="rail-title">Mastery and evidence</span><button ref="railClose" type="button" class="rail-x" aria-label="Close mastery and evidence" @click="closeRail"><span aria-hidden="true">✕</span></button></div>
      <section class="rail-card">
        <div class="rail-head"><p class="eyebrow rail-eyebrow">Your mastery</p><InfoBubble :text="masteryNote" label="About your mastery estimate" /></div>
        <div class="mastery-row"><span class="sprite-tile green"><PixelIcon :sprite="stage" :size="35" /></span><div class="mastery-figure"><strong>{{ pctText }}</strong><MasteryCells :value="pct" :cells="10" /></div></div>
      </section>
      <section v-if="data" class="rail-card goal">
        <p class="eyebrow rail-eyebrow">Goal</p><p class="goal-text">{{ data.skill.outcome }}</p>
        <div class="divider" />
        <p class="eyebrow rail-eyebrow">To master it</p><p class="gate-text">{{ data.skill.gate }}</p>
      </section>
      <section class="rail-card">
        <EstimatePanel v-if="data && hasEvidence" id="estimate-panel" :skill="skill" :data="data" :session-labels="labels" :busy="busy" :reload="load" @changed="emit('changed')" @open-session="openCaseSession" />
        <template v-else><p class="eyebrow rail-eyebrow">Evidence</p><p class="hint rail-empty">Assessed practice will appear here.</p></template>
      </section>
      <section v-if="railCitations.length" class="rail-card">
        <p class="eyebrow rail-eyebrow">Taught from</p>
        <SourcesUsed :citations="railCitations" :titles="materialTitles" id-prefix="rail-source" variant="rail" @open="openSource" />
      </section>
    </aside>
  </section>
</template>

<style scoped>
.learn{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 312px;height:calc(100dvh - 28px);min-height:560px;background:#FFFFFF}
.learn.narrow{grid-template-columns:minmax(0,1fr)}
.learn-main{display:flex;flex-direction:column;min-width:0;min-height:0}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
/* Header */
.learn-head{padding:18px 28px 0;background:#FFFFFF;border-bottom:1px solid #ECEAF3}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.head-title{display:flex;align-items:center;gap:14px;min-width:240px;flex:1}
.sprite-tile{flex:none;width:52px;height:52px;border-radius:14px;background:var(--dawn-soft);display:grid;place-items:center;box-shadow:inset 0 -3px 0 #E2DEF6}
.sprite-tile.green{background:#EAF7EE;box-shadow:none}
.title-block{min-width:0}
.back-link{white-space:nowrap;border:0;background:none;padding:0;font-size:12px;font-weight:600;color:#6B6490;margin-bottom:2px}
.back-link:hover{color:var(--ink)}
.learn-head h1{margin:0;font-family:var(--font-display);font-weight:400;font-size:26px;line-height:1.3;text-wrap:balance;overflow-wrap:anywhere}
.head-actions{display:flex;align-items:center;gap:10px;flex:none}
.mastery-chip{display:flex;flex-direction:column;align-items:flex-start;gap:5px;border:1px solid #E6E3F2;border-radius:12px;background:#FFFFFF;padding:7px 12px;min-width:76px;color:var(--ink)}
button.mastery-chip:hover{border-color:#C9C1F0}
.mastery-chip :deep(.mastery-cells){width:63px}
.chip-top{display:flex;align-items:baseline;gap:6px}
.chip-top strong{font-size:16px;font-variant-numeric:tabular-nums}
.chip-top span{font-size:11px;font-weight:600;color:var(--faint)}
.heading-action .primary{min-height:46px;padding:0 18px;font-size:14px;white-space:nowrap}
/* Tabs */
.tabs{display:flex;align-items:flex-end;gap:22px;margin-top:14px;overflow-x:auto}
.tab,.new-lesson{display:flex;align-items:center;gap:8px;border:0;background:none;padding:0 2px 12px;font-size:14px;font-weight:500;color:var(--muted);white-space:nowrap;border-radius:0}
.tab:hover:not(:disabled){color:var(--ink)}
.tab.chosen{font-weight:700;color:var(--ink);box-shadow:inset 0 -3px 0 #8A7EE0}
.tab-square{width:8px;height:8px;flex:none}
.tab-square.lesson{background:#2F7D9B}
.tab-square.practice{background:#E3A233}
.tab-meta{font-size:12px;font-weight:500;color:var(--faint)}
.tab-done{font-size:11px;font-weight:800;color:var(--strong)}
.new-lesson{font-weight:700;color:#4B3FA8}
.new-lesson:hover:not(:disabled){color:var(--dawn-text)}
.new-lesson.chosen{box-shadow:inset 0 -3px 0 #8A7EE0}
/* Thread */
/* The thread scrolls inside thread-wrap, which also holds the "Jump to latest" pill over its bottom edge. */
.thread-wrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.chat-thread{flex:1;min-height:0;overflow-y:auto;background:#FFFFFF}
.jump-wrap{position:absolute;left:0;right:0;bottom:14px;z-index:5;display:flex;justify-content:center;pointer-events:none}
.jump-latest{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 14px;border:0;border-radius:999px;background:#FFFFFF;color:var(--dawn-soft-text);font-size:13px;font-weight:700;box-shadow:0 0 0 1px var(--ring),0 8px 24px rgba(20,20,20,.07);animation:sgRise 240ms ease-out both}
.jump-latest:hover{background:var(--dawn-soft)}
.thread-inner{max-width:760px;margin:0 auto;padding:30px 32px 24px}
.confidence-note{border:1px solid var(--line);padding:16px 20px;border-radius:16px;margin-bottom:24px;background:var(--inset)}
.confidence-note form{max-width:none}
.confidence-note label{font-size:14px;font-weight:700;margin:0 0 9px}
.confidence{display:flex;gap:14px;align-items:center}
.confidence input{min-height:20px;padding:0;accent-color:var(--dawn-edge);flex:1;min-width:60px}
.confidence output{font-size:14px;font-weight:700;font-variant-numeric:tabular-nums}
.small-button{min-height:36px;padding:0 14px;font-size:13px;white-space:nowrap}
.chat-welcome{text-align:center;max-width:540px;margin:40px auto 30px}
.chat-welcome h2{margin:12px 0 10px;font-family:var(--font-display);font-weight:400;font-size:34px;line-height:1.2;letter-spacing:0}
.chat-welcome p{margin:0;font-size:15px;color:var(--muted);line-height:1.7}
.prompt-choices{display:flex;flex-wrap:wrap;justify-content:center;gap:8px;margin-top:24px}
.prompt-choices button{border:1px solid var(--line);border-radius:999px;background:#FFFFFF;padding:10px 16px;font-size:13px;color:var(--ink)}
.prompt-choices button:hover:not(:disabled){border-color:rgba(20,20,20,.35)}
.message{margin:0 0 28px;max-width:100%;font-size:15px;animation:sgRise 240ms ease-out both}
/* The learner's messages are compact bubbles on the right; the tutor's replies run the full width with no bubble. */
.from-you{margin-left:auto;margin-bottom:24px;width:fit-content;max-width:70%;padding:10px 15px;background:var(--dawn-soft);border-radius:18px 18px 4px 18px}
.from-tutor{padding:0}
.speaker-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.speaker{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink)}
.avatar{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--dawn-soft)}
/* The opening is a card, and a labelled rule separates it from the dialogue that follows. */
.opening-card{margin-bottom:24px;padding:18px 22px 14px;border-radius:18px;background:#FFFFFF;box-shadow:0 0 0 1px var(--ring)}
.thread-divider{display:flex;align-items:center;gap:12px;margin:0 0 26px;font-family:var(--font-display);font-size:11px;font-weight:500;line-height:1.3;text-transform:uppercase;letter-spacing:1px;color:var(--faint)}
.thread-divider::before,.thread-divider::after{content:"";flex:1;height:1px;background:var(--card-border)}
/* Under each tutor answer: the meta line, then Copy and Listen, shown on hover or focus and always under the latest answer. */
.reply-foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:12px;min-height:26px}
.reply-foot .reply-meta{margin:0}
.reply-foot .reply-actions{margin-left:auto;opacity:0;transition:opacity 120ms}
.from-tutor:hover .reply-actions,.from-tutor:focus-within .reply-actions,.from-tutor.latest .reply-actions{opacity:1}
@media (hover:none),(max-width:650px){.reply-foot .reply-actions{opacity:1}}
.retry-row{display:flex;align-items:center;gap:8px;margin:0 0 28px}
.reply-retry{min-height:32px;padding:0 12px;font-size:13px}
.tag{padding:1px 8px;border-radius:999px;background:var(--inset-2);color:var(--soft);font-size:11px;font-weight:700}
.tag.hint-tag{background:var(--dawn-soft);color:var(--dawn-soft-text)}
.tag.task{background:#4A775A;color:#FFFFFF}
.you-tag{display:inline-block;margin-bottom:6px;background:#FFFFFF;color:var(--dawn-soft-text)}
.prose-blocks{display:flex;flex-direction:column;gap:14px}
.prose{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8;font-size:15px;margin:0}
.from-you .prose{line-height:1.6}
.code-block{margin:0;padding:14px 16px;border-radius:12px;background:var(--inset);border:1px solid var(--line);font:13px/1.7 var(--font-mono);white-space:pre-wrap;overflow-wrap:anywhere;color:var(--ink)}
.tutor-label{margin:8px 0 0;font-size:11px;color:var(--faint)}
.attachment-label{display:inline-flex;align-items:center;gap:8px;margin:10px 0 0;padding:4px 10px 4px 4px;border-radius:8px;background:#FFFFFF;font-size:12px;color:var(--soft)}
.attach-thumb{width:26px;height:26px;border-radius:5px;background:var(--inset);flex:none}
.message-action{border:0;background:transparent;color:var(--muted);padding:5px 0;font-size:12px;text-decoration:underline;text-underline-offset:4px}
.review-step{margin:6px 0 20px}
.attempt-review,.assessment{margin:14px 0 20px;padding:20px 22px;border-radius:16px;border:1px solid var(--line);animation:sgRise 240ms ease-out both}
.attempt-review{background:var(--inset)}
.assessment{background:#FFFFFF;box-shadow:0 8px 24px rgba(20,20,20,.07)}
.review-title{display:flex;align-items:center;gap:6px;margin:0 0 8px}
.review-title h3{margin:0;font-family:var(--font-display);font-weight:400;font-size:21px}
.check{position:relative;display:flex;align-items:center;gap:10px;padding:8px 0;margin:0;font-size:14px;font-weight:400;cursor:pointer}
.check input{position:absolute;opacity:0;width:18px;height:18px;min-height:0;margin:0;left:0}
.check .box{width:18px;height:18px;flex:none;border-radius:5px;border:1.5px solid #BDBDB8;background:#FFFFFF;display:grid;place-items:center}
.check input:checked+.box{background:var(--dawn-edge);border-color:var(--dawn-edge)}
.check input:checked+.box::after{content:"✓";color:#FFFFFF;font-size:12px;font-weight:800;line-height:1}
.check input:focus-visible+.box{outline:2px solid var(--ink);outline-offset:2px}
.assess-row{display:flex;align-items:center;gap:14px;margin-top:12px}
.assess-row .primary{min-height:44px;padding:0 20px;font-size:14px}
.transcript{margin:14px 0}
.transcript label{font-size:13px;font-weight:700}
.transcript textarea,.assessment textarea,.assessment select{width:100%;padding:10px;border:1px solid var(--ring);border-radius:10px;font:inherit;background:#FFFFFF}
.result-top{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.result-top .eyebrow{margin:0 0 4px;font-size:12px}
.result-top h3{margin:0;font-family:var(--font-display);font-weight:400;font-size:24px;color:var(--ink)}
.result-top h3.success{color:var(--strong)}
.result-figure{text-align:right;flex:none;max-width:45%}
.result-pct{margin:0;font-family:var(--font-display);font-size:24px;line-height:1.2;white-space:nowrap}
.result-same{margin:0;font-size:14px;font-weight:700;color:var(--ink)}
.result-delta{margin:2px 0 0;font-size:12px;color:var(--muted)}
.rationale{margin:12px 0 0;font-size:14px;line-height:1.7}
.result-actions{display:flex;gap:16px;margin-top:14px}
.result-actions .secondary{min-height:36px;font-size:13px}
.regrade{margin-top:12px;font-size:13px}
.regrade summary{cursor:pointer;color:var(--muted);text-decoration:underline;text-underline-offset:4px;list-style:none}
.regrade summary::-webkit-details-marker{display:none}
.regrade label{margin-top:14px}
.working{display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}
/* Composer */
.composer-area{padding:12px 32px 16px;background:#FFFFFF}
.composer-inner{max-width:760px;margin:0 auto}
.composer{border:1px solid var(--line);border-radius:22px;padding:10px 14px 10px 18px;background:#FFFFFF;box-shadow:0 1px 2px rgba(20,20,20,.05),0 10px 30px rgba(20,20,20,.08)}
.composer:focus-within{border-color:var(--dawn-edge)}
.composer textarea{border:0;outline:none;width:100%;resize:none;overflow-y:auto;min-height:52px;max-height:calc(6 * 1.6em + 8px);padding:4px 0;font-family:inherit;font-size:15px;line-height:1.6;background:transparent;color:var(--ink);box-shadow:none}
.composer-tools{display:flex;align-items:center;justify-content:space-between;gap:10px}
.input-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.composer-right{display:flex;align-items:center;gap:6px}
.note-info :deep(.info-bubble){left:auto;right:0;top:auto;bottom:calc(100% + 6px)}
.tool-pill{display:flex;align-items:center;gap:6px;margin:0;border:1px solid var(--line);border-radius:999px;background:#FFFFFF;padding:5px 12px;min-height:30px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap;cursor:pointer}
.tool-pill:hover:not(:disabled){border-color:rgba(20,20,20,.35);color:var(--ink)}
.attach-button{position:relative}
.attach-button input{position:absolute;width:1px;height:1px;min-height:0;opacity:0;padding:0;border:0}
.attach-button:focus-within{outline:2px solid var(--ink);outline-offset:2px}
.unavailable{opacity:.45;cursor:default}
.send-button{border:0;border-radius:12px;background:var(--dawn);color:var(--dawn-text);box-shadow:0 3px 0 var(--dawn-edge);font-size:20px;font-weight:700;width:38px;height:38px;display:grid;place-items:center;padding:0;margin-bottom:3px}
.send-button:hover:not(:disabled){background:var(--dawn-hover)}
.send-button:disabled{background:var(--inset-2);color:var(--faint);box-shadow:0 3px 0 var(--ring);opacity:1;cursor:default}
.composer-note{margin:8px 0 0;text-align:center;font-size:12px;color:var(--coral-text)}
.is-recording{border-color:var(--coral)}
.attachment-list{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:2px 0 8px;padding:0}
.attachment-chip{display:inline-flex;align-items:center;gap:8px;padding:4px 4px 4px 6px;border:1px solid var(--line);border-radius:10px;font-size:12px;max-width:100%}
.attachment-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attachment-thumb{width:28px;height:28px;flex:none;object-fit:cover;border-radius:5px;background:var(--inset)}
.attachment-chip button{border:0;background:none;font-size:19px;min-width:28px;min-height:28px;padding:0;line-height:1;color:var(--muted)}
.attachment-chip button:hover:not(:disabled){color:var(--ink)}
.finished-message{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:15px;font-size:13px;color:var(--muted)}
.finished-message .secondary{min-height:38px;font-size:13px}
/* Rail */
.rail{border-left:1px solid #EEEAF7;background:#FAF9FE;overflow-y:auto;overflow-x:hidden;padding:16px 14px;display:flex;flex-direction:column;gap:10px;min-height:0}
.narrow .rail{position:absolute;top:0;right:0;bottom:0;width:312px;max-width:100%;z-index:20;box-shadow:-12px 0 32px rgba(20,20,20,.12);animation:railIn 200ms ease-out}
.rail[hidden]{display:none}
.rail-backdrop{position:absolute;inset:0;z-index:19;background:rgba(21,21,21,.28)}
.rail-close{position:sticky;top:-16px;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-16px -14px 0;padding:12px 12px 8px 16px;background:#FAF9FE}
.rail-title{font:400 15px var(--font-display);color:var(--ink)}
.rail-x{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:10px;background:#EEEAF7;color:var(--ink);font-size:15px;line-height:1}
.rail-x:hover{background:#E2DEF6}
.message.pending{opacity:.85}
.sending{margin:4px 0 0;font-size:11px;font-weight:600;color:var(--muted)}
.thinking .dots{display:inline-flex;gap:3px;font-size:22px;line-height:1;color:var(--muted)}
.waited{margin-left:10px;font-size:12px;font-weight:600;color:var(--faint);font-variant-numeric:tabular-nums}
.thinking .dots span{animation:sgDot 1.2s ease-in-out infinite}.thinking .dots span:nth-child(2){animation-delay:.2s}.thinking .dots span:nth-child(3){animation-delay:.4s}
@keyframes sgDot{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.thinking .dots span{animation:none;opacity:.6}}
.rail-card{background:#FFFFFF;border-radius:18px;padding:16px;box-shadow:0 0 0 1px #ECE9F5;flex:none}
.rail-card.goal{display:flex;flex-direction:column;gap:6px}
.rail-eyebrow{color:#7A7397;white-space:nowrap}
.rail-head{display:flex;align-items:center;justify-content:space-between}
.rail-head :deep(.info-bubble){left:auto;right:0}
.mastery-row{display:flex;align-items:center;gap:12px;margin-top:10px}
.mastery-figure{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.mastery-figure strong{font-size:30px;line-height:1;font-weight:700;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.mastery-figure :deep(.mastery-cells){max-width:none}
.goal-text{margin:0;font-size:14px;line-height:1.55}
.gate-text{margin:0;font-size:13px;line-height:1.55;color:var(--soft)}
.divider{height:1px;background:#EEEBF5;margin:8px 0}
.rail-empty{margin:8px 0 0;font-size:12px}
@keyframes sgRise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@keyframes railIn{from{transform:translateX(24px);opacity:0}to{transform:none;opacity:1}}
@media(max-width:900px){.learn-head{padding:14px 18px 0}.thread-inner{padding:22px 18px 18px}.composer-area{padding:10px 18px 14px}}
@media(max-width:650px){.learn{height:calc(100dvh - 20px);min-height:520px}.head-title{min-width:0}.learn-head h1{font-size:22px}.sprite-tile{width:44px;height:44px}.heading-action .primary{min-height:42px;padding:0 12px;font-size:13px;white-space:normal}.from-you{max-width:85%}.opening-card{padding:16px 16px 12px}.prose{font-size:14px}.confidence{flex-wrap:wrap}.chat-welcome h2{font-size:29px}}
</style>
