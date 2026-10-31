<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, reactive, ref, shallowRef, watch } from "vue";
import { useAttachUpload } from "./attach-upload.ts";
import SpeechInput from "./SpeechInput.vue";
import SourcesUsed from "./SourcesUsed.vue";
import ReplyMeta from "./ReplyMeta.vue";
import ReplyActions from "./ReplyActions.vue";
import EstimatePanel from "./EstimatePanel.vue";
import PixelIcon from "./PixelIcon.vue";
import MasteryCells from "./MasteryCells.vue";
import MarkdownText from "./MarkdownText.vue";
import InfoBubble from "./InfoBubble.vue";
import SourcePreview from "./SourcePreview.vue";
import SourcePane from "./SourcePane.vue";
import { stageOf } from "./pixel-art.ts";
import type { OpenSource } from "./revamp-types.ts";
import { api, unwrap } from "./api.ts";
import { messageTime, resultLabels, secondsLabel, sessionLabels } from "./labels.ts";
import { UnansweredQuestions, answerSeconds, citedSources, localStore } from "./reply-stats.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { PendingAdjustment, sessionStore } from "./pending-adjustment.ts";
import { listenUnavailable, stopSpeaking } from "./speech.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
import { answerKey, newAnswers, takeTutor, tutorLabel, tutorPick, tutorSettings, type TutorUsed } from "./tutor-choice.ts";
import { sessionRequest, takeSession } from "./continue-session.ts";
import { pendingOpening, trackOpening, type PendingOpening } from "./pending-openings.ts";
import { ComposerDrafts, conversationSlot, joinDrafts, newConversationSlot, sentAsLesson, sentInConversation, settleSending, slotSession,
  type ComposerDraft, type SendingDraft } from "./composer-drafts.ts";
import { isArchived, readDone, readStarted, setArchived } from "./conversation-list.ts";
type SkillData = StillGotItHttp["/learning/read"]["output"]["data"];
type StudySession = SkillData["sessions"][number];
/** A file uploaded for the answer being written. `preview` is a local picture of an image file, so learners can tell images apart; other files have none. */
type Attachment = { material: string; name: string; preview: string };
// aiReason explains why AI features are off when aiAvailable is false. materials gives titles for cited sources, and
// deletedMaterials lists the course materials the learner deleted, which citations and the rail name as deleted.
// skillMaterials lists this skill's sources from the same course read. The course read is refreshed after every change
// under Manage skills, while this page reads its skill only when it opens or acts, so a source added there counts at once.
// initialDraft prefills the message box of a new conversation (for example "Ask about this page" in Materials); it is never sent by itself.
// learner is the signed-in learner's username, which keeps each learner's unsent drafts apart in the browser.
const props = withDefaults(defineProps<{ skill: string; course: string; learner: string; materials: { material: string; title: string }[]; deletedMaterials?: readonly string[]; skillMaterials?: readonly string[]; aiAvailable: boolean; aiReason: string; active?: boolean; initialDraft?: string }>(),
  { deletedMaterials: () => [] });
// `back` returns to the skill tree. `open-source` asks the shell to show a cited source in Materials, from the source
// preview's "Open in Materials". `session` names
// the conversation on screen (null for a new one), so the sidebar can mark it.
const emit = defineEmits<{ changed: []; back: []; "open-source": [source: OpenSource]; session: [skill: string, session: string | null]; tutor: [] }>();
const data = shallowRef<SkillData | null>(null), selected = ref<StudySession["session"] | "">(""), busy = ref(false), error = ref(""), notice = ref("");
const noticeBox = ref<HTMLElement | null>(null), errorBox = ref<HTMLElement | null>(null), composerInput = ref<HTMLTextAreaElement | null>(null), heading = ref<HTMLElement | null>(null);
const confidence = ref(50), freshLesson = ref(false), recording = ref(false), reviewOpen = ref(false), thread = ref<HTMLElement | null>(null), evidenceOpen = ref(false);
const response = ref(""), channel = ref<"TEXT" | "VOICE">("TEXT"), attachments = ref<Attachment[]>([]), attachmentList = ref<HTMLElement | null>(null);
const reviewed = ref(false), unseen = ref(true), outsideHelp = ref(false), reason = ref(""), correction = ref<NonNullable<SkillData["cases"][number]["judgment"]>["result"]>("SLIP"), fullGate = ref(false);
const current = computed(() => freshLesson.value ? undefined : data.value?.sessions.find((session) => session.session === selected.value));
const currentCases = computed(() => data.value?.cases.filter((item) => item.task === selected.value) ?? []);
// A lesson is saved with the learner's request before the tutor answers. Until its opening explanation arrives it is
// unexplained: the thread shows the request and, in the explanation's place, the tutor's dots or "Retry tutor reply",
// and nothing can be sent in it.
const unexplained = computed(() => !!current.value?.lesson && !current.value.lesson.explanation.trim());
// An archived conversation is read-only (design/compositions/Learning.md, "Archiving a conversation"): the page shows it
// without the message box and the buttons that add to it, and offers "Restore conversation" in their place. An archive
// or restore made in the sidebar applies here at once.
const archived = computed(() => !!current.value && isArchived(current.value.session, data.value?.archived ?? []));
// An archive or restore made in the sidebar makes the page's last message out of date, such as "Conversation restored",
// so the message goes. The page's own Restore is busy while it changes the conversation, and sets its message after.
watch(archived, () => { if (!busy.value) { notice.value = ""; error.value = ""; } });
// Lessons and practice use the sources that remain after the learner deletes a material. When none remains, the tutor has
// nothing to ground them in: a skill cannot start a new lesson or task, and an open session cannot ask the tutor again.
// The server declines these requests with the same explanation (design/compositions/LearningAccess.md).
const deletedSet = computed(() => new Set<string>(props.deletedMaterials));
const allDeleted = (materials: readonly string[]) => materials.length > 0 && materials.every((material) => deletedSet.value.has(material));
const skillSourcesGone = computed(() => allDeleted(props.skillMaterials ?? data.value?.skill.materials ?? []));
const sessionSourcesGone = computed(() => !!current.value && current.value.status === "OPEN" && allDeleted(current.value.materials));
const canSend = computed(() => !busy.value && !recording.value && !unexplained.value && !(current.value ? current.value.lesson && sessionSourcesGone.value : skillSourcesGone.value)
  && (props.aiAvailable || !!current.value?.task) && (!!response.value.trim() || (attachments.value.length > 0 && !!current.value)));
// ---- Unsent drafts (frontend/src/composer-drafts.ts) ----
// The message box holds the draft of the conversation on screen, and each conversation keeps its own: in memory while
// this page lives, with its attached files, and in the browser's storage under the learner's name, so that a reload or a
// new sign-in finds the text again. A draft leaves only when the server accepts its message.
type BoxState = { text: string; channel: "TEXT" | "VOICE"; attachments: Attachment[]; missing: string[] };
const unsent = new Map<string, BoxState>();
const draftStore = () => new ComposerDrafts(localStore(), props.learner);
/** The names of files that were attached to a draft read back from storage. The files were not kept, and the box says so. */
const missingFiles = ref<string[]>([]);
const fileList = new Intl.ListFormat("en", { type: "conjunction" });
const missingNote = computed(() => {
  const names = missingFiles.value.map((name) => `“${name}”`);
  return names.length === 1 ? `This draft had a file attached, ${names[0]}. Saved drafts keep only their text, so attach it again if you want to send it.`
    : `This draft had ${names.length} files attached: ${fileList.format(names)}. Saved drafts keep only their text, so attach them again if you want to send them.`;
});
/** The draft the box shows: a saved conversation, or this skill's new conversation. Null until the page knows which. */
const draftSlot = computed(() => freshLesson.value ? newConversationSlot(props.skill) : selected.value ? conversationSlot(selected.value)
  : data.value ? newConversationSlot(props.skill) : null);
/** The draft whose contents are in the box now; null while the page waits to know or to read it. */
let boxSlot: string | null = null;
/** A message on its way that the server has not accepted yet, with the draft it came from. Its draft keeps it until then. */
let unaccepted: { slot: string; sending: SendingDraft } | null = null;
// A lesson whose request has just been saved takes the box as it is: what the learner wrote while it was being saved.
let carryDraft = false;
// "Ask about this page" places a question in a new conversation's box. Until the learner changes it, a later question replaces it.
let prefilled = "";
function boxDraft(slot: string): ComposerDraft {
  return { text: response.value, channel: channel.value, files: [...attachments.value.map((item) => item.name), ...missingFiles.value],
    sending: unaccepted?.slot === slot ? unaccepted.sending : null };
}
function saveDraft() { if (boxSlot) draftStore().save(boxSlot, boxDraft(boxSlot)); }
async function dismissMissing() { missingFiles.value = []; await nextTick(); composerInput.value?.focus(); }
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
const practiceReason = computed(() => recording.value ? "Finish recording first." : !props.aiAvailable ? "The AI tutor is unavailable right now."
  : skillSourcesGone.value ? "Add another source for this skill first." : data.value && !data.value.track ? "Set your starting confidence first." : "");
const hintReason = computed(() => sessionSourcesGone.value ? "The materials this task came from have been deleted, so no hint is available. You can still answer and submit it." : "");
const assessReason = computed(() => unsavedTranscripts.value ? "Save your transcript corrections first." : !reviewed.value ? "Confirm that you reviewed your answer first." : aiOff.value);
function describedBy(...ids: (string | false)[]) { return ids.filter(Boolean).join(" ") || undefined; }
function purposeNote(purpose: string) { return purpose === "HINT" ? " · hint" : purpose === "CORRECTION" ? " · transcript correction" : ""; }
async function load() {
  const skill = props.skill, started = readStarted(), result = unwrap(await api.learning.read({ skill })).data;
  if (skill !== props.skill) return;
  readDone(started, result.sessions.map((session) => session.session));
  data.value = result;
  // With nothing chosen, the page shows the latest open conversation, or else the latest one, leaving out archived ones;
  // with every conversation archived it starts a new one. Sessions come oldest first.
  if (!freshLesson.value && !result.sessions.some((session) => session.session === selected.value)) {
    const listed = result.sessions.filter((session) => !isArchived(session.session, result.archived));
    selected.value = listed.findLast((session) => session.status === "OPEN")?.session ?? listed.at(-1)?.session ?? "";
  }
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
// While the tutor answers, the message leaves the box and waits in the thread. The box stays open, so the
// learner can write the next message meanwhile. A failure puts the message back, before anything written since.
// `reply` says whether the tutor answers it: a lesson question does, while a practice answer is only saved.
// `since` is when the wait began, for a page that shows a wait another page started (see followOpening).
const pending = ref<{ text: string; files: string[]; reply: boolean; since?: number } | null>(null);
// The tutor's place shows how long the learner has waited, in whole seconds. It stops when the answer lands.
const waitStarted = ref(0), waitNow = ref(0);
let waitTicker: ReturnType<typeof setInterval> | undefined;
watch(pending, (now) => {
  clearInterval(waitTicker); waitTicker = undefined;
  if (!now?.reply) return;
  waitNow.value = Date.now(); waitStarted.value = now.since ?? waitNow.value;
  waitTicker = setInterval(() => { waitNow.value = Date.now(); }, 1000);
});
const waited = computed(() => secondsLabel(Math.floor((waitNow.value - waitStarted.value) / 1000)));
onBeforeUnmount(() => clearInterval(waitTicker));
function takeDraft() {
  const text = response.value, sent = attachments.value, ch = channel.value, missing = missingFiles.value, slot = boxSlot;
  pending.value = { text, files: sent.map((item) => item.name), reply: !current.value?.task };
  // The draft keeps the message until the server accepts it, so a reload meanwhile cannot lose it. `after` lets the next
  // read tell whether it arrived: a turn after the dialogue known now, or a lesson after the conversations known now.
  if (slot) unaccepted = { slot, sending: { text, channel: ch, files: [...sent.map((item) => item.name), ...missing],
    after: current.value ? current.value.dialogue.length : data.value?.sessions.length ?? 0 } };
  response.value = ""; attachments.value = []; channel.value = "TEXT"; missingFiles.value = [];
  void scrollToLatest(true);
  return { text, sent, ch,
    /** The server accepted the message, so its draft lets it go. */
    accepted() {
      if (!slot || unaccepted?.slot !== slot) return;
      unaccepted = null;
      if (slot === boxSlot) { saveDraft(); return; }
      const stored = draftStore().read(slot);
      if (stored) draftStore().save(slot, { ...stored, sending: null });
    },
    /** The server did not accept it: it returns to its draft ahead of anything written since. */
    restore() {
      if (unaccepted?.slot === slot) unaccepted = null;
      pending.value = null;
      if (slot && slot !== boxSlot) {
        // The learner opened another conversation meanwhile, so the message goes back to the draft it came from.
        const kept = unsent.get(slot) ?? { text: "", channel: "TEXT", attachments: [], missing: [] };
        const back: BoxState = { text: joinDrafts(text, kept.text), channel: ch, attachments: [...sent, ...kept.attachments], missing: [...missing, ...kept.missing] };
        unsent.set(slot, back);
        draftStore().save(slot, { text: back.text, channel: back.channel, files: [...back.attachments.map((item) => item.name), ...back.missing], sending: null });
        return;
      }
      response.value = joinDrafts(text, response.value); attachments.value = [...sent, ...attachments.value]; channel.value = ch;
      missingFiles.value = [...missing, ...missingFiles.value];
      saveDraft();
    } };
}
/**
 * The lesson is saved with the learner's request at once, before the tutor answers, so leaving the page or a failed
 * answer never loses it: the page shows the saved request and the sidebar lists the lesson while the tutor's dots wait.
 * The opening explanation is then asked for with Reply, recorded as on its way so that a page made again meanwhile waits
 * for it too. If saving fails, the draft comes back; once the lesson is saved, the draft is its request, and a failed
 * opening leaves "Retry tutor reply" in the thread.
 */
async function startLesson() {
  const draft = takeDraft(), skill = props.skill, request = draft.text.trim();
  await act(async () => {
    let saved = false;
    try {
      const result = unwrap(await api.learning.lesson({ skill, request }));
      saved = true; draft.accepted();
      // What the learner wrote while the lesson was being prepared stays in the box of the lesson it now belongs to.
      if (selected.value !== result.lesson) carryDraft = true;
      freshLesson.value = false; selected.value = result.lesson;
      await load(); emit("changed");
      await timedAnswer(() => trackOpening(skill, result.lesson, request, async () => unwrap(await api.learning.reply({ studySession: result.lesson }))));
    }
    catch (problem) { if (!saved) draft.restore(); throw problem; }
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
    // Files go in the order the learner attached them.
    const input = { studySession: session.session, text: draft.text, channel: draft.ch, attachments: draft.sent.map((item) => item.material), dialogueLength: session.dialogue.length };
    try {
      if (session.lesson) await timedAnswer(async () => unwrap(await api.learning.question(input)));
      else unwrap(await api.learning.respond(input));
      draft.accepted();
      reviewed.value = false;
      draft.sent.forEach(forgetPreview);
    } catch (problem) {
      // The server may have saved the question and failed only on the tutor's reply. Then the reloaded thread shows it with its
      // retry button and the draft stays out of the box, so sending again cannot post it twice. Otherwise the draft and every file come back.
      await load().catch(() => undefined);
      const now = current.value;
      const saved = !!now && now.session === session.session && sentInConversation(now.dialogue, { text: draft.text, after: session.dialogue.length });
      if (saved) { draft.accepted(); draft.sent.forEach(forgetPreview); } else draft.restore();
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
 * Each file is uploaded to this skill's course as its own material, in the order chosen. A failed file does not stop
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
  }, files.length === 1 ? `Attached ${files[0]!.name}. Send your answer to include it.` : `Attached ${files.length} files. Send your answer to include them.`);
}
/** Removing a file only changes what this answer will send. Focus moves to the next file, or back to the message box. */
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
async function retryReply() {
  const active = current.value, skill = props.skill;
  if (!active) return;
  const ask = async () => unwrap(await api.learning.reply({ studySession: active.session }));
  // A retried opening is on its way like the first one, so a page made again meanwhile waits for it too.
  const opening = active.lesson && unexplained.value ? active.lesson.request : null;
  await act(async () => { await timedAnswer(() => opening !== null ? trackOpening(skill, active.session, opening, ask) : ask()); });
}
/**
 * Finishing closes the lesson for good, so it leaves Home's Continue card. Its conversation stays here to read. A message
 * still in the box would be lost with the box, so the learner sends or clears it first; the refusal shows in the alert area.
 */
async function finishLesson() {
  const active = current.value; if (!active?.lesson || active.status !== "OPEN" || busy.value || recording.value) return;
  if (response.value.trim() || attachments.value.length) { notice.value = ""; error.value = "Send or clear your message before finishing this lesson."; await nextTick(); errorBox.value?.focus(); return; }
  // A finished lesson has no message box, so a note about files from its draft has nothing left to say.
  await act(async () => { unwrap(await api.learning.finish({ studySession: active.session })); missingFiles.value = []; }, "Lesson finished. Its conversation stays here to read.");
}
/** Restoring puts the conversation back in the sidebar exactly as it was, so an open one can be continued. */
async function restoreConversation() {
  const active = current.value; if (!active || busy.value || recording.value) return;
  await act(async () => { await setArchived(active.session, false); },
    active.status === "OPEN" ? "Conversation restored. It is back in Conversations, and you can continue it." : "Conversation restored. It is back in Conversations.");
}
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
// The message box names the tutor model and thinking level that apply, from the latest settings record, and changes
// as soon as a new choice is saved.
const tutorChoice = computed(() => tutorPick(tutorSettings.value));
// While a message is on its way, the send button is a turning ring that says what it waits for.
const sendLabel = computed(() => pending.value ? (pending.value.reply ? "Waiting for the tutor's answer" : "Saving your answer") : current.value?.task ? "Save answer" : "Send message");
const composerNote = computed(() => current.value?.task ? "Review your complete answer before requesting assessment." : "Grounded in your course materials. Check important details.");
/**
 * Session identities are time-ordered UUIDs (version 7), whose first 48 bits are the start time: the moment the opening
 * lesson or task was saved. Older ones have no time.
 */
function sessionStart(id: string) { return id[14] === "7" ? parseInt(id.replace(/-/g, "").slice(0, 12), 16) : NaN; }
// The opening's time is when the lesson or task was saved; the read records no separate time for the learner's request.
const openingTime = computed(() => {
  const time = current.value ? sessionStart(current.value.session) : NaN;
  return Number.isFinite(time) ? { label: messageTime(time), iso: new Date(time).toISOString() } : null;
});
// Every source this skill's conversations were taught from, once each, for the rail's Taught from card.
const railCitations = computed(() => citedSources(data.value?.sessions ?? []));
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
// A cited source, from a reply's passage or the rail's Taught from list, opens on this page. On wide screens it opens in
// a pane beside the conversation that takes the rail's place (the mastery chip then opens the rail over the lesson, as
// on narrow screens); on narrow screens it opens in a dialog. Both show only the file at the cited place.
const sourcePreview = ref<InstanceType<typeof SourcePreview> | null>(null), sourcePane = ref<InstanceType<typeof SourcePane> | null>(null);
const paneSource = shallowRef<OpenSource | null>(null);
const railOver = computed(() => narrow.value || !!paneSource.value);
let paneOpener: HTMLElement | null = null;
/**
 * Keeps the conversation in place while the pane opens or closes and the messages reflow to a new width: the control
 * that opened the source, or else the first message in view, stays at the same height. Returns the step to run after the
 * change. The browser's own scroll anchoring is paused meanwhile, so the two do not both move the thread.
 */
function holdThreadPlace(opener: HTMLElement | null): () => void {
  const box = thread.value;
  if (!box) return () => undefined;
  const top = () => box.getBoundingClientRect().top;
  const anchor = opener && box.contains(opener) ? opener
    : [...box.querySelectorAll<HTMLElement>(".message, .thread-divider")].find((element) => element.getBoundingClientRect().bottom > top()) ?? null;
  if (!anchor) return () => undefined;
  const before = anchor.getBoundingClientRect().top - top();
  box.style.overflowAnchor = "none";
  return () => {
    if (anchor.isConnected) box.scrollTop += anchor.getBoundingClientRect().top - top() - before;
    requestAnimationFrame(() => { box.style.overflowAnchor = ""; });
  };
}
async function openSource(source: OpenSource) {
  if (narrow.value) { void sourcePreview.value?.open(source); return; }
  // Another source opened while the pane is open replaces its content, and focus later returns to that source's control.
  // Focus inside the pane is never an opener, so the one remembered stays.
  const active = document.activeElement, pane = sourcePane.value?.element;
  if (!(active instanceof Node && pane?.contains(active))) paneOpener = active instanceof HTMLElement && active !== document.body ? active : null;
  const keep = holdThreadPlace(paneOpener);
  paneSource.value = source; evidenceOpen.value = false;
  await nextTick();
  keep();
  sourcePane.value?.focus();
}
/** Closes the pane and gives the rail its column back. Focus returns to the opener unless the learner is leaving. */
async function closePane(returnFocus = true) {
  if (!paneSource.value) return;
  const back = paneOpener, keep = holdThreadPlace(back);
  paneSource.value = null; paneOpener = null; evidenceOpen.value = false;
  await nextTick();
  keep();
  if (returnFocus && back?.isConnected && back.getClientRects().length) back.focus();
}
function paneToMaterials(source: OpenSource) { void closePane(false); emit("open-source", source); }
// A window narrowed while the pane is open shows the same source in the dialog instead.
watch(narrow, (now) => {
  const shown = paneSource.value;
  if (!now || !shown) return;
  const back = paneOpener;
  paneSource.value = null; paneOpener = null;
  if (back?.isConnected) back.focus();
  void sourcePreview.value?.open(shown);
});
/**
 * A draft from elsewhere starts a new conversation with the message box filled in and focused. It is not sent. What the
 * learner already wrote for a new conversation stays ahead of it; a question placed here earlier and left unchanged is replaced.
 */
async function applyDraft(draft: string | undefined) {
  if (!draft) return;
  if (!freshLesson.value || selected.value !== "") { freshLesson.value = true; reviewOpen.value = false; selected.value = ""; await nextTick(); }
  const kept = response.value === prefilled ? "" : response.value;
  response.value = joinDrafts(kept, draft); prefilled = kept.trim() ? "" : draft;
  if (!kept.trim()) channel.value = "TEXT";
  await nextTick();
  if (!busy.value && composerInput.value && !composerInput.value.disabled) { composerInput.value.focus(); return; }
  const stop = watch(busy, async (now) => { if (!now) { stop(); await nextTick(); composerInput.value?.focus(); } });
}
watch(() => props.skill, (skill) => {
  selected.value = ""; data.value = null; response.value = ""; attachments.value = []; missingFiles.value = []; reviewed.value = false;
  paneSource.value = null; paneOpener = null;
  // An unanswered adjustment from before a reload is shown at once, so the learner can see it and send it again.
  evidenceOpen.value = !!new PendingAdjustment(sessionStore(), skill).read();
  const waiting = pendingOpening(skill);
  if (waiting) followOpening(waiting); else act(load);
}, { immediate: true });
/**
 * A study page made again while its skill's new lesson waits for its opening (the shell drops older study pages, and
 * switching courses drops them all) shows that lesson's request with the tutor's dots and the time waited so far. The
 * page cannot read the skill meanwhile: the server takes one request at a time from a learner, and the opening's request
 * keeps that turn while the tutor writes. When it settles, the page reads the skill: the lesson has its explanation, or
 * the failure shows with "Retry tutor reply". The opening's meta line gets the time from asking to answering and the
 * model that wrote it.
 */
function followOpening(waiting: PendingOpening) {
  // The lesson was named by the server's answer to the lesson request, so it is one of this learner's sessions.
  freshLesson.value = false; selected.value = waiting.lesson as StudySession["session"];
  pending.value = { text: waiting.request, files: [], reply: true, since: waiting.since };
  void act(async () => {
    try {
      const answer = await waiting.done as { tutor?: TutorUsed } | undefined, key = answerKey("session", waiting.lesson);
      measured.value[key] = Math.round((Date.now() - waiting.since) / 1000);
      if (answer?.tutor) answeredBy.value[key] = answer.tutor;
    }
    finally { pending.value = null; }
  });
}
watch(() => props.initialDraft, (draft) => { void applyDraft(draft); }, { immediate: true });
// Home's Continue card names a session of this skill. A page that has not loaded yet shows it once loaded; a loaded page
// switches to it when the current step finishes, and reads again if the session is newer than what it has.
watch([() => props.skill, sessionRequest], () => {
  const id = takeSession(props.skill); if (!id) return;
  const show = () => { freshLesson.value = false; selected.value = id; reviewOpen.value = false; void scrollToLatest(true); if (data.value && !data.value.sessions.some((session) => session.session === id)) void act(load); };
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
/** The sidebar's "+ New conversation": a new conversation here, once the current step finishes, with the box focused. */
function newConversation() {
  const start = async () => { newLesson(); await nextTick(); composerInput.value?.focus(); };
  if (!busy.value && !recording.value) { void start(); return; }
  const stop = watch([busy, recording], ([working, speaking]) => { if (!working && !speaking) { stop(); void start(); } });
}
watch(() => current.value?.session ?? null, (session) => emit("session", props.skill, session), { immediate: true });
defineExpose({ startPractice, newConversation });
/**
 * Each conversation keeps its own unsent message. When another conversation opens, the box's draft is put aside and the
 * new conversation's draft comes back: from this page's memory, with its files, or else from the browser's storage. A
 * draft read back from storage while a message of it was on its way waits for the page's read, which tells whether the
 * server accepted that message: if it did, the message is not put back; if not, it returns ahead of the rest. A lesson
 * that has just started keeps the box as it is (carryDraft), and the new conversation's draft it came from is gone.
 */
watch([draftSlot, data], ([slot]) => {
  if (slot === boxSlot) return;
  const carry = carryDraft;
  carryDraft = false;
  if (carry && boxSlot && slot) {
    unsent.delete(boxSlot); draftStore().remove(boxSlot);
    boxSlot = slot; saveDraft(); reviewed.value = false; void scrollToLatest(true);
    return;
  }
  if (boxSlot) {
    saveDraft();
    unsent.set(boxSlot, { text: response.value, channel: channel.value, attachments: attachments.value, missing: missingFiles.value });
    boxSlot = null;
    response.value = ""; channel.value = "TEXT"; attachments.value = []; missingFiles.value = [];
  }
  if (!slot) return;
  let next = unsent.get(slot);
  if (!next) {
    let stored = draftStore().read(slot);
    if (stored?.sending) {
      if (!data.value) return;
      const session = slotSession(slot);
      stored = settleSending(stored, session === null ? sentAsLesson(data.value.sessions, stored.sending)
        : sentInConversation(data.value.sessions.find((item) => item.session === session)?.dialogue ?? [], stored.sending));
    }
    next = { text: stored?.text ?? "", channel: stored?.channel ?? "TEXT", attachments: [], missing: stored?.files ?? [] };
  }
  // Anything typed before the page knew which conversation it showed stays, after the draft.
  const typed = response.value, typedChannel = channel.value;
  response.value = joinDrafts(next.text, typed);
  channel.value = typed.trim() && typedChannel === "VOICE" ? "VOICE" : next.channel;
  attachments.value = next.attachments; missingFiles.value = next.missing;
  boxSlot = slot; saveDraft();
  reviewed.value = false; void scrollToLatest(true);
}, { immediate: true });
watch([response, channel, attachments, missingFiles], saveDraft);
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
/**
 * Motion shows what just changed (design/visual-design.md, "Motion"). Messages, cards and notices rise or fade in when
 * they arrive while the learner is looking. A conversation that opens, or that shows again after another view or another
 * skill, shows what it already holds at once: the browser restarts an element's entrance whenever the element is drawn
 * again, so these entrances are finished before the browser draws the page. They are finished once Vue's whole update is
 * done, because the shell shows the lesson view again (v-show) at the end of that update, and an element that is not
 * shown has no entrance yet. With reduced motion there are none to finish.
 */
const page = ref<HTMLElement | null>(null);
const ENTRANCES = new Set(["sgRise", "sgPop", "sgFade"]);
async function settleEntrances() {
  await nextTick();
  if (props.active === false || typeof page.value?.getAnimations !== "function") return;
  for (const animation of page.value.getAnimations({ subtree: true })) {
    if (!(animation instanceof CSSAnimation) || !ENTRANCES.has(animation.animationName)) continue;
    try { animation.finish(); } catch { /* An entrance that cannot finish keeps playing. */ }
  }
}
watch(() => props.active, () => { void settleEntrances(); }, { flush: "post" });
watch(() => current.value?.session ?? null, () => { void settleEntrances(); }, { flush: "post" });
onActivated(() => { void settleEntrances(); });
// Reading aloud stops when the learner leaves this page: another view, another skill, or closing it.
watch(() => props.active, (active) => { if (active === false) stopSpeaking(); });
onDeactivated(stopSpeaking);
onBeforeUnmount(() => { stopSpeaking(); previews.forEach((url) => URL.revokeObjectURL(url)); previews.clear(); });
</script>

<template>
  <section ref="page" class="learn" :class="{ narrow, 'rail-over': railOver, 'source-open': !!paneSource && !narrow, 'rail-open': evidenceOpen }" :aria-busy="busy">
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
            <button v-if="railOver" ref="railChip" type="button" class="mastery-chip" :aria-expanded="evidenceOpen" aria-controls="learn-rail" :aria-label="`${estimateText || 'No estimate yet'}. ${evidenceOpen ? 'Hide' : 'Show'} mastery and evidence`" @click="toggleRail">
              <span class="chip-top"><strong>{{ pctText }}</strong><span>mastery</span></span><MasteryCells :value="pct" :cells="7" :height="4" label="" aria-hidden="true" />
            </button>
            <div v-else class="mastery-chip static" role="img" :aria-label="estimateText || 'No estimate yet'"><span class="chip-top"><strong>{{ pctText }}</strong><span>mastery</span></span><MasteryCells :value="pct" :cells="7" :height="4" label="" aria-hidden="true" /></div>
            <div class="heading-action"><button class="primary dawn practice-button" :disabled="busy || recording || !aiAvailable || !data?.track || skillSourcesGone" :aria-describedby="describedBy(!!practiceReason && 'practice-reason', !aiAvailable && 'ai-reason-chat')" @click="startTask">Check my understanding</button><p v-if="practiceReason" id="practice-reason" class="hint reason">{{ practiceReason }}</p></div>
          </div>
        </div>
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
              <!-- The opening: the learner's request, then the lesson or practice task in a card. A divider separates it from the dialogue.
                   An unexplained lesson has no card yet: the tutor's dots or the retry row below take its place. -->
              <div class="opening">
                <div v-if="current.lesson" class="message from-you"><span class="sr-only">You</span><MarkdownText class="prose" kind="message" :text="current.lesson.request" /></div>
                <article v-if="!unexplained" class="message from-tutor opening-card" :class="{ latest: !current.dialogue.length }" :title="openingTime?.label">
                  <div class="speaker-row"><span class="speaker"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span> StillGotIt<span v-if="openingTime" class="sr-only">, <time :datetime="openingTime.iso">{{ openingTime.label }}</time></span><span v-if="current.task" class="tag task">Practice task</span></span></div>
                  <MarkdownText class="prose" :text="current.lesson?.explanation || current.task?.question || ''" />
                  <SourcesUsed v-if="current.citations.length" :key="current.session" compact :citations="current.citations" :titles="materialTitles" :deleted="deletedMaterials" :id-prefix="`passage-${current.session}`" @open="openSource" />
                  <div class="reply-foot"><ReplyMeta :seconds="measured[answerKey('session', current.session)]" :sources="current.citations.length" :tutor="answerLabel('session', current.session)" /><ReplyActions :message-key="`${current.session}:opening`" :text="current.lesson?.explanation || current.task?.question || ''" :what="current.lesson ? 'lesson' : 'practice question'" describedby="listen-reason" /></div>
                </article>
              </div>
              <div v-if="(current.dialogue.length || pending) && !unexplained" class="thread-divider" role="separator" aria-label="Conversation"><span aria-hidden="true">Conversation</span></div>
              <article v-for="(item, position) in current.dialogue" :key="item.turnIndex" class="message" :class="[item.turn.speaker === 'LEARNER' ? 'from-you' : 'from-tutor', { latest: position === current.dialogue.length - 1 }]" :title="messageTime(item.turn.at) || undefined">
                <template v-if="item.turn.speaker === 'TUTOR'">
                  <div class="speaker-row"><span class="speaker"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span> StillGotIt<span v-if="messageTime(item.turn.at)" class="sr-only">, <time :datetime="item.turn.at">{{ messageTime(item.turn.at) }}</time></span><span v-if="item.turn.purpose === 'HINT'" class="tag hint-tag">Hint</span><span v-else-if="item.turn.purpose === 'CORRECTION'" class="tag">Transcript correction</span></span></div>
                  <MarkdownText class="prose" :text="item.turn.text" />
                  <SourcesUsed v-if="item.turn.citations.length" :key="`${current.session}:${item.turnIndex}`" :citations="item.turn.citations" :titles="materialTitles" :deleted="deletedMaterials" :id-prefix="`passage-${current.session}-${item.turnIndex}`" compact @open="openSource" />
                </template>
                <template v-else><span class="sr-only">You{{ purposeNote(item.turn.purpose) }}</span><span v-if="messageTime(item.turn.at)" class="sr-only">, <time :datetime="item.turn.at">{{ messageTime(item.turn.at) }}</time></span><span v-if="purposeNote(item.turn.purpose)" class="tag you-tag" aria-hidden="true">{{ purposeNote(item.turn.purpose).replace(' · ', '') }}</span>
                  <MarkdownText class="prose" kind="message" :text="item.turn.text" /></template>
                <p v-for="(file, fileIndex) in item.turn.media" :key="file.file" class="attachment-label"><span class="attach-thumb" aria-hidden="true" />{{ item.turn.media.length > 1 ? `Attachment ${fileIndex + 1} of ${item.turn.media.length}` : 'Attachment' }} · {{ file.name }}</p>
                <div v-if="item.turn.speaker === 'TUTOR'" class="reply-foot"><ReplyMeta :seconds="replySeconds(current, item.turnIndex)" :sources="item.turn.citations.length" :tutor="answerLabel('turn', current.session, item.turnIndex)" /><ReplyActions :message-key="`${current.session}:${item.turnIndex}`" :text="item.turn.text" :what="item.turn.purpose === 'HINT' ? 'hint' : 'tutor reply'" describedby="listen-reason" /></div></article>
              <!-- A lesson question without a reply, or a lesson without its opening explanation: the retry sits where the tutor's answer would be. -->
              <div v-if="current.lesson && current.status === 'OPEN' && !archived && (current.dialogue.at(-1)?.turn.speaker === 'LEARNER' || unexplained) && !pending && !sessionSourcesGone" class="retry-row"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span><button class="secondary dawn reply-retry" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="retryReply"><span aria-hidden="true">↻</span>Retry tutor reply</button></div>
              <div v-if="current.task && current.status === 'OPEN' && !archived && current.dialogue.some(item => item.turn.speaker === 'LEARNER' && item.turn.purpose === 'RESPONSE')" class="review-step">
                <button class="secondary dawn" :disabled="busy || recording" :aria-expanded="reviewOpen" @click="reviewOpen = !reviewOpen">{{ reviewOpen ? 'Close review' : 'Review and assess my work' }}</button>
                <div v-if="reviewOpen" class="attempt-review">
                  <div class="review-title"><h3>Ready for assessment?</h3><InfoBubble text="Review your complete answer before assessment. Your answers to these three questions go with your work, and Assess stays off until you confirm the review." /></div>
                  <div v-for="voice in current.voice" :key="voice.turnIndex" class="transcript"><label :for="`voice-${voice.turnIndex}`">Speech transcript {{ voice.turnIndex + 1 }}</label><textarea :id="`voice-${voice.turnIndex}`" v-model="speechEdits[voice.turnIndex]" rows="3" /><button class="message-action" :disabled="busy" @click="correctTranscript(voice.turnIndex)">Save transcript correction</button></div>
                  <label class="check"><input v-model="unseen" type="checkbox" /><span class="box" aria-hidden="true" />These exact problems are new to me.</label><label class="check"><input v-model="outsideHelp" type="checkbox" /><span class="box" aria-hidden="true" />I used help outside this conversation.</label><label class="check"><input v-model="reviewed" type="checkbox" /><span class="box" aria-hidden="true" />I reviewed my answer and all speech transcripts.</label>
                  <div class="assess-row"><button class="primary dawn" :disabled="busy || !!assessReason" :aria-describedby="assessReason ? 'assess-reason' : undefined" @click="assess">Assess my work</button><p v-if="assessReason" id="assess-reason" class="hint reason">{{ assessReason }}</p></div>
                </div>
              </div>
              <button v-if="current.task && current.status === 'CLOSED' && !currentCases.some(item => item.judgment)" class="secondary dawn" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="assess">Retry saved assessment</button>
              <article v-for="item in currentCases" :key="item.case" class="assessment">
                <template v-if="item.judgment">
                  <div class="result-top"><div><p class="eyebrow">Assessment</p><h3 :class="{ success: SUCCESS.has(item.judgment.result) }">{{ resultLabels[item.judgment.result] }}</h3></div><div v-if="attemptChange(item.case)" class="result-figure"><p class="eyebrow">Mastery</p><p class="result-pct"><span aria-hidden="true">{{ attemptChange(item.case)!.before }} → {{ attemptChange(item.case)!.after }}</span><span class="sr-only">from {{ attemptChange(item.case)!.before }} to {{ attemptChange(item.case)!.after }}</span></p><p class="result-delta">{{ attemptChange(item.case)!.delta }}</p></div>
                    <div v-else-if="ignoredReason(item.case)" class="result-figure unchanged"><p class="eyebrow">Mastery</p><p class="result-same">Did not change the estimate</p><p class="result-delta">{{ ignoredReason(item.case) }}</p></div></div>
                  <MarkdownText class="prose rationale" :text="item.judgment.rationale" />
                  <p v-if="answerLabel('judgment', item.judgment.judgment)" class="tutor-label">{{ answerLabel('judgment', item.judgment.judgment) }}</p>
                  <div class="result-actions"><button v-if="current.status === 'CLOSED'" class="secondary dawn" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="startTask">Try a fresh check</button></div>
                  <details class="regrade"><summary>This seems wrong? Review or correct this assessment</summary><label>Reason<textarea v-model="reason" rows="3" /></label><p v-if="!reason.trim()" :id="`reason-needed-${item.case}`" class="hint reason">Write a reason to request a regrade or save a correction.</p><button class="message-action" :disabled="busy || !aiAvailable || !reason.trim()" :aria-describedby="describedBy(!reason.trim() && `reason-needed-${item.case}`, !aiAvailable && 'ai-reason-chat')" @click="requestRegrade(item.case, item.judgment.judgment)">Request regrade</button>
                    <label>Manual correction<select v-model="correction"><option v-for="(label,value) in resultLabels" :key="value" :value="value">{{ label }}</option></select></label><label class="check"><input v-model="fullGate" type="checkbox" /><span class="box" aria-hidden="true" />All requirements were met in fresh independent work.</label><button class="message-action" :disabled="busy || !reason.trim()" :aria-describedby="reason.trim() ? undefined : `reason-needed-${item.case}`" @click="saveCorrection(item.case, item.judgment.judgment)">Save correction</button><ol><li v-for="judgment in item.history" :key="judgment.judgment">{{ resultLabels[judgment.result] }} · {{ judgment.origin === 'AI' ? 'Tutor' : 'Your correction' }}<MarkdownText :text="judgment.rationale" /></li></ol></details>
                </template><p v-else>Your answer is saved. Assessment is pending.</p>
              </article>
            </template>
            <div role="status"><p v-if="notice && !busy" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
            <div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div>
            <!-- A new lesson's request shows as its saved request once the lesson exists, so only the tutor's dots wait below it. -->
            <article v-if="pending && !unexplained" class="message from-you pending" aria-live="polite"><span class="sr-only">You</span><MarkdownText class="prose" kind="message" :text="pending.text" /><p v-for="(name, fileIndex) in pending.files" :key="fileIndex" class="attachment-label"><span class="attach-thumb" aria-hidden="true" />Attachment · {{ name }}</p></article>
            <article v-if="pending?.reply" class="message from-tutor thinking" aria-hidden="true"><div class="speaker-row"><span class="speaker"><span class="avatar"><PixelIcon name="leaf" :size="16" /></span> StillGotIt</span></div><p class="prose dots"><span>·</span><span>·</span><span>·</span></p><span class="waited">{{ waited }}</span></article>
            <!-- While the tutor's dots show, they are the visible sign of work; the sentence stays for screen readers. -->
            <p v-if="busy" class="working" :class="{ 'sr-only': pending?.reply }" role="status"><PixelIcon name="leaf" :size="18" /> Working on it…</p>
          </div>
        </div>
        <div v-if="newBelow" class="jump-wrap"><button ref="jumpButton" type="button" class="jump-latest" @click="jumpToLatest">Jump to latest <span aria-hidden="true">↓</span></button></div>
      </div>
      <div class="composer-area">
        <div class="composer-inner">
          <div v-if="current?.lesson && sessionSourcesGone && !archived" class="finished-message sources-gone"><p>The materials this lesson was grounded in have been deleted, so the tutor can no longer answer here. The conversation stays here to read.</p><button type="button" class="message-action" :disabled="busy" @click="finishLesson">Finish lesson</button><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
          <template v-else-if="!current || (current.status === 'OPEN' && !archived)">
            <p v-if="!current && skillSourcesGone" id="sources-gone" class="sources-gone-note">Every material this skill was taught from has been deleted. Add another source for it under Manage skills in Materials, then start a lesson.</p>
            <p v-if="hintReason" id="hint-reason" class="sources-gone-note">{{ hintReason }}</p>
            <div class="composer" :class="{ 'is-recording': recording }" :aria-busy="!!pending">
              <p v-if="missingFiles.length" id="draft-files-note" class="draft-files"><span>{{ missingNote }}</span><button type="button" class="message-action" @click="dismissMissing">Dismiss</button></p>
              <ul v-if="attachments.length" ref="attachmentList" class="attachment-list" aria-label="Files attached to this answer">
                <li v-for="(item, index) in attachments" :key="item.material" class="attachment-chip"><img v-if="item.preview" :src="item.preview" alt="" class="attachment-thumb" /><span>{{ attachments.length > 1 ? `${index + 1}. ` : '' }}{{ item.name }}</span><button type="button" :aria-label="`Remove file ${index + 1}, ${item.name}`" :disabled="busy" @click="removeAttachment(index)">×</button></li>
              </ul>
              <label class="sr-only" for="chat-message">{{ current?.task ? 'Your answer and reasoning' : 'Message your tutor' }}</label>
              <textarea id="chat-message" ref="composerInput" v-model="response" rows="2" :aria-describedby="missingFiles.length ? 'draft-files-note' : undefined" :placeholder="current?.task ? 'Explain your reasoning. You can type, speak, or attach your work.' : 'Ask a question or tell me what you want to learn…'" @keydown="enterToSend" />
              <div class="composer-tools"><div class="input-tools"><label class="attach-button tool-pill" :class="{ unavailable: !current || busy || recording }" :title="current ? 'Attach files with your work' : 'Start a lesson before attaching files'"><span aria-hidden="true">＋ Attach files</span><span class="sr-only">{{ attachments.length ? 'Attach more files with your work' : 'Attach files with your work' }}</span><input type="file" multiple :disabled="busy || recording || !current" @change="uploadWork" /></label>
                <SpeechInput :disabled="busy || !aiAvailable" :active="active !== false" :describedby="aiAvailable ? undefined : 'ai-reason-chat'" compact @recording="recording = $event" @transcript="response = response ? response + '\n' + $event : $event; channel = 'VOICE'" @error="error = $event" />
                <button type="button" class="tutor-pick" aria-haspopup="dialog" :aria-label="tutorChoice.label" :title="tutorChoice.label" @click="emit('tutor')"><span>{{ tutorChoice.model }}<span v-if="tutorChoice.level" class="tutor-level"> · {{ tutorChoice.level }}</span></span><svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" /></svg></button>
                <button v-if="current?.task" class="hint-button tool-pill" :disabled="busy || recording || !aiAvailable || !!hintReason" :aria-describedby="describedBy(!aiAvailable && 'ai-reason-chat', !!hintReason && 'hint-reason')" @click="requestHint">Ask for a hint</button>
                <button v-else-if="current?.lesson" type="button" class="tool-pill" :disabled="busy || recording" @click="finishLesson">Finish lesson</button>
              </div><div class="composer-right"><span class="note-info"><InfoBubble :text="composerNote" label="About this message box" /></span><button class="send-button" :class="{ waiting: !!pending }" :disabled="!canSend" :aria-label="sendLabel" :aria-describedby="describedBy(!(aiAvailable || current?.task || pending) && 'ai-reason-chat', !current && skillSourcesGone && 'sources-gone')" @click="submitMessage"><span v-if="pending" class="send-ring" aria-hidden="true" /><span v-else aria-hidden="true">↑</span></button></div></div>
            </div>
            <p v-if="recording" class="composer-note" role="status">Recording. Stop to review your words before sending.</p>
          </template>
          <div v-else-if="archived" class="finished-message archived-message"><p>{{ current.status === 'OPEN' ? 'This conversation is archived, so it is read-only. Restore it to continue where you left off.' : 'This conversation is archived. Restore it to list it in Conversations again.' }}</p><button class="secondary dawn" :disabled="busy || recording" @click="restoreConversation">Restore conversation</button><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
          <div v-else-if="current.lesson" class="finished-message"><p>This lesson is finished. Start a new conversation to keep going.</p><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
          <div v-else class="finished-message"><p>This attempt is saved.</p><button v-if="!currentCases.some(item => item.judgment)" class="secondary dawn" :disabled="busy || !aiAvailable" :aria-describedby="aiAvailable ? undefined : 'ai-reason-chat'" @click="startTask">Try a fresh check</button><button class="message-action" :disabled="busy" @click="newLesson">Keep learning</button></div>
          <p v-if="aiOff" id="ai-reason-chat" class="hint">{{ aiOff }}</p>
          <p v-if="current && listenUnavailable" id="listen-reason" class="hint">{{ listenUnavailable }}</p>
        </div>
      </div>
    </div>
    <div v-if="railOver" class="rail-backdrop" :hidden="!evidenceOpen" aria-hidden="true" @click="closeRail" />
    <aside id="learn-rail" class="rail" aria-label="Mastery, goal, evidence and sources" :hidden="railOver && !evidenceOpen ? true : undefined" @keydown.esc.stop="railOver && closeRail()">
      <div v-if="railOver" class="rail-close"><span class="rail-title">Mastery and evidence</span><button ref="railClose" type="button" class="rail-x" aria-label="Close mastery and evidence" @click="closeRail"><span aria-hidden="true">✕</span></button></div>
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
        <SourcesUsed :citations="railCitations" :titles="materialTitles" :deleted="deletedMaterials" id-prefix="rail-source" variant="rail" @open="openSource" />
      </section>
    </aside>
    <SourcePane v-if="paneSource && !narrow" ref="sourcePane" class="learn-source" :source="paneSource" :titles="materialTitles" :deleted="deletedMaterials" @close="closePane()" @open-materials="paneToMaterials" />
    <SourcePreview ref="sourcePreview" :titles="materialTitles" :deleted="deletedMaterials" @open-materials="emit('open-source', $event)" @ask="applyDraft($event.question)" />
  </section>
</template>

<style scoped>
.learn{position:relative;display:grid;grid-template-columns:minmax(0,1fr) 312px;height:calc(100dvh - 28px);min-height:560px;background:var(--card)}
.learn.narrow{grid-template-columns:minmax(0,1fr)}
/* A cited source opens in a pane that takes the rail's column, wider than the rail, while the rail moves over the lesson. */
.learn.source-open{grid-template-columns:minmax(0,1fr) min(46%,620px)}
.learn-main{display:flex;flex-direction:column;min-width:0;min-height:0;grid-column:1;grid-row:1}
.learn-source{grid-column:2;grid-row:1}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
/* Header */
.learn-head{padding:18px 28px 16px;background:var(--card);border-bottom:1px solid var(--lesson-head-line)}
.head-row{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
.head-title{display:flex;align-items:center;gap:14px;min-width:240px;flex:1}
.sprite-tile{flex:none;width:52px;height:52px;border-radius:14px;background:var(--dawn-soft);display:grid;place-items:center;box-shadow:inset 0 -3px 0 var(--lesson-tile-edge)}
.sprite-tile.green{background:var(--meadow-tile);box-shadow:none}
.title-block{min-width:0}
.back-link{white-space:nowrap;border:0;background:none;padding:0;font-size:12px;font-weight:600;color:var(--lesson-back);margin-bottom:2px}
.back-link:hover{color:var(--ink)}
.learn-head h1{margin:0;font-family:var(--font-display);font-weight:400;font-size:26px;line-height:1.3;text-wrap:balance;overflow-wrap:anywhere}
.head-actions{display:flex;align-items:center;gap:10px;flex:none}
.mastery-chip{display:flex;flex-direction:column;align-items:flex-start;gap:5px;border:1px solid var(--lesson-chip-line);border-radius:12px;background:var(--card);padding:7px 12px;min-width:76px;color:var(--ink)}
button.mastery-chip:hover{border-color:var(--lesson-chip-hover)}
.mastery-chip :deep(.mastery-cells){width:63px}
.chip-top{display:flex;align-items:baseline;gap:6px}
.chip-top strong{font-size:16px;font-variant-numeric:tabular-nums}
.chip-top span{font-size:11px;font-weight:600;color:var(--faint)}
.heading-action .primary{min-height:46px;padding:0 18px;font-size:14px;white-space:nowrap}
/* Thread */
/* The thread scrolls inside thread-wrap, which also holds the "Jump to latest" pill over its bottom edge. */
.thread-wrap{position:relative;flex:1;min-height:0;display:flex;flex-direction:column}
.chat-thread{flex:1;min-height:0;overflow-y:auto;background:var(--card)}
.jump-wrap{position:absolute;left:0;right:0;bottom:14px;z-index:5;display:flex;justify-content:center;pointer-events:none}
.jump-latest{pointer-events:auto;display:inline-flex;align-items:center;gap:6px;min-height:34px;padding:0 14px;border:0;border-radius:999px;background:var(--card);color:var(--dawn-soft-text);font-size:13px;font-weight:700;box-shadow:0 0 0 1px var(--ring),0 8px 24px rgb(var(--shadow) / .07);animation:sgRise var(--dur-enter) var(--ease-enter) both}
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
.prompt-choices button{border:1px solid var(--line);border-radius:999px;background:var(--card);padding:10px 16px;font-size:13px;color:var(--ink)}
.prompt-choices button:hover:not(:disabled){border-color:var(--line-strong)}
.message{margin:0 0 28px;max-width:100%;font-size:15px}
/* The learner's messages are compact bubbles on the right; the tutor's replies run the full width with no bubble. */
.from-you{margin-left:auto;margin-bottom:24px;width:fit-content;max-width:70%;padding:10px 15px;background:var(--dawn-soft);border-radius:18px 18px 4px 18px}
.from-tutor{padding:0}
.speaker-row{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.speaker{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:13px;font-weight:700;color:var(--ink)}
.avatar{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:9px;background:var(--dawn-soft)}
/* The opening is a card, and a labelled rule separates it from the dialogue that follows. */
.opening-card{margin-bottom:24px;padding:18px 22px 14px;border-radius:18px;background:var(--card);box-shadow:0 0 0 1px var(--ring)}
.thread-divider{display:flex;align-items:center;gap:12px;margin:0 0 26px;font-family:var(--font-display);font-size:11px;font-weight:500;line-height:1.3;text-transform:uppercase;letter-spacing:1px;color:var(--faint)}
.thread-divider::before,.thread-divider::after{content:"";flex:1;height:1px;background:var(--card-border)}
/* Under each tutor answer: the meta line, then Copy and Listen, shown on hover or focus and always under the latest answer. */
.reply-foot{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:12px;min-height:26px}
.reply-foot .reply-meta{margin:0}
.reply-foot .reply-actions{margin-left:auto;opacity:0;transition:opacity var(--dur-quick) var(--ease-enter)}
.from-tutor:hover .reply-actions,.from-tutor:focus-within .reply-actions,.from-tutor.latest .reply-actions{opacity:1}
@media (hover:none),(max-width:650px){.reply-foot .reply-actions{opacity:1}}
.retry-row{display:flex;align-items:center;gap:8px;margin:0 0 28px}
.reply-retry{min-height:32px;padding:0 12px;font-size:13px}
.tag{padding:1px 8px;border-radius:999px;background:var(--inset-2);color:var(--soft);font-size:11px;font-weight:700}
.tag.hint-tag{background:var(--dawn-soft);color:var(--dawn-soft-text)}
.tag.task{background:var(--task-tag);color:var(--on-fill)}
.you-tag{display:inline-block;margin-bottom:6px;background:var(--card);color:var(--dawn-soft-text)}
.prose{overflow-wrap:anywhere;line-height:1.8;font-size:15px;margin:0}
.from-you .prose{line-height:1.6}
.tutor-label{margin:8px 0 0;font-size:11px;color:var(--faint)}
.attachment-label{display:inline-flex;align-items:center;gap:8px;margin:10px 0 0;padding:4px 10px 4px 4px;border-radius:8px;background:var(--card);font-size:12px;color:var(--soft)}
.attach-thumb{width:26px;height:26px;border-radius:5px;background:var(--inset);flex:none}
.message-action{border:0;background:transparent;color:var(--muted);padding:5px 0;font-size:12px;text-decoration:underline;text-underline-offset:4px}
.review-step{margin:6px 0 20px}
.attempt-review,.assessment{margin:14px 0 20px;padding:20px 22px;border-radius:16px;border:1px solid var(--line)}
.attempt-review{background:var(--inset)}
.assessment{background:var(--card);box-shadow:0 8px 24px rgb(var(--shadow) / .07)}
.review-title{display:flex;align-items:center;gap:6px;margin:0 0 8px}
.review-title h3{margin:0;font-family:var(--font-display);font-weight:400;font-size:21px}
.check{position:relative;display:flex;align-items:center;gap:10px;padding:8px 0;margin:0;font-size:14px;font-weight:400;cursor:pointer}
.check input{position:absolute;opacity:0;width:18px;height:18px;min-height:0;margin:0;left:0}
.check .box{width:18px;height:18px;flex:none;border-radius:5px;border:1.5px solid var(--check-line);background:var(--field);display:grid;place-items:center}
.check input:checked+.box{background:var(--dawn-edge);border-color:var(--dawn-edge)}
.check input:checked+.box::after{content:"✓";color:var(--on-fill);font-size:12px;font-weight:800;line-height:1}
.check input:focus-visible+.box{outline:2px solid var(--ink);outline-offset:2px}
.assess-row{display:flex;align-items:center;gap:14px;margin-top:12px}
.assess-row .primary{min-height:44px;padding:0 20px;font-size:14px}
.transcript{margin:14px 0}
.transcript label{font-size:13px;font-weight:700}
.transcript textarea,.assessment textarea,.assessment select{width:100%;padding:10px;border:1px solid var(--ring);border-radius:10px;font:inherit;background:var(--field)}
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
.composer-area{padding:12px 32px 16px;background:var(--card)}
.composer-inner{max-width:760px;margin:0 auto}
.composer{border:1px solid var(--line);border-radius:22px;padding:10px 14px 10px 18px;background:var(--card);box-shadow:0 1px 2px rgb(var(--shadow) / .05),0 10px 30px rgb(var(--shadow) / .08)}
.composer:focus-within{border-color:var(--dawn-edge)}
.composer textarea{border:0;outline:none;width:100%;resize:none;overflow-y:auto;min-height:52px;max-height:calc(6 * 1.6em + 8px);padding:4px 0;font-family:inherit;font-size:15px;line-height:1.6;background:transparent;color:var(--ink);box-shadow:none}
.composer-tools{display:flex;align-items:center;justify-content:space-between;gap:10px}
.input-tools{display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.composer-right{display:flex;align-items:center;gap:6px}
.note-info :deep(.info-bubble){left:auto;right:0;top:auto;bottom:calc(100% + 6px)}
.tool-pill{display:flex;align-items:center;gap:6px;margin:0;border:1px solid var(--line);border-radius:999px;background:var(--card);padding:5px 12px;min-height:30px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap;cursor:pointer}
.tool-pill:hover:not(:disabled){border-color:var(--line-strong);color:var(--ink)}
/* The tutor model and thinking level the next answer will use, as a quiet pill among the tools. It opens the Tutor
   panel in Settings. Phones show the model alone; the level stays in its name and tooltip. */
.tutor-pick{display:flex;align-items:center;gap:4px;margin:0;border:0;border-radius:999px;background:transparent;padding:5px 8px 5px 10px;min-height:30px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap}
.tutor-pick:hover{background:var(--inset-2);color:var(--ink)}
.tutor-pick svg{flex:none}
@media(max-width:650px){.tutor-level{display:none}}
.attach-button{position:relative}
.attach-button input{position:absolute;width:1px;height:1px;min-height:0;opacity:0;padding:0;border:0}
.attach-button:focus-within{outline:2px solid var(--ink);outline-offset:2px}
.unavailable{opacity:.45;cursor:default}
.send-button{border:0;border-radius:12px;background:var(--dawn);color:var(--dawn-text);box-shadow:0 3px 0 var(--dawn-edge);font-size:20px;font-weight:700;width:38px;height:38px;display:grid;place-items:center;padding:0;margin-bottom:3px}
.send-button:hover:not(:disabled){background:var(--dawn-hover)}
.send-button:disabled{background:var(--inset-2);color:var(--faint);box-shadow:0 3px 0 var(--ring);opacity:1;cursor:default}
/* While a message is on its way the button keeps its dawn colors and shows a ring that turns once a beat on the loop
   curve: a dawn-text arc on a faint track. With reduced motion the ring stands still. */
.send-button.waiting:disabled{background:var(--dawn);color:var(--dawn-text);box-shadow:0 3px 0 var(--dawn-edge);cursor:progress}
.send-ring{width:18px;height:18px;border-radius:50%;border:2.5px solid color-mix(in srgb, var(--dawn-text) 22%, transparent);border-top-color:var(--dawn-text);animation:sgSpin var(--loop-beat) var(--ease-loop) infinite}
.composer-note{margin:8px 0 0;text-align:center;font-size:12px;color:var(--coral-text)}
.sources-gone-note{margin:0 0 10px;font-size:13px;line-height:1.5;color:var(--soft)}
.is-recording{border-color:var(--coral)}
.attachment-list{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:2px 0 8px;padding:0}
/* A draft read back from storage had files attached, which were not kept: a quiet note above the box says so. */
.draft-files{display:flex;align-items:baseline;gap:12px;margin:2px 0 8px;padding:8px 12px;border-radius:10px;background:var(--inset);font-size:13px;line-height:1.5;color:var(--soft)}
.draft-files span{flex:1;min-width:0;overflow-wrap:anywhere}
.draft-files .message-action{flex:none;padding:0;font-size:13px}
.attachment-chip{display:inline-flex;align-items:center;gap:8px;padding:4px 4px 4px 6px;border:1px solid var(--line);border-radius:10px;font-size:12px;max-width:100%}
.attachment-chip span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.attachment-thumb{width:28px;height:28px;flex:none;object-fit:cover;border-radius:5px;background:var(--inset)}
.attachment-chip button{border:0;background:none;font-size:19px;min-width:28px;min-height:28px;padding:0;line-height:1;color:var(--muted)}
.attachment-chip button:hover:not(:disabled){color:var(--ink)}
.finished-message{display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:15px;font-size:13px;color:var(--muted)}
.finished-message .secondary{min-height:38px;font-size:13px}
.finished-message.sources-gone p{flex-basis:100%;margin:0;text-align:center;line-height:1.5}
/* Rail */
.rail{border-left:1px solid var(--lesson-rail-edge);background:var(--lesson-rail);overflow-y:auto;overflow-x:hidden;padding:16px 14px;display:flex;flex-direction:column;gap:10px;min-height:0}
/* On narrow screens, and while a source pane holds the rail's column, the rail slides in over the lesson on the move
   curve and its backdrop fades in. Where the browser can keep a hidden element drawn while it transitions
   (transition-behavior: allow-discrete), both also leave the same way; elsewhere they disappear at once. These rules
   name the rail as the lesson's own child (.rail-over > .rail): the
   Taught from list's root also has the class "rail" and this component's scope, and must not become a second overlay. */
.rail-over>.rail{position:absolute;top:0;right:0;bottom:0;width:312px;max-width:100%;z-index:20;box-shadow:-12px 0 32px rgb(var(--shadow) / .12);animation:sgSlide var(--dur-move) var(--ease-move);transition:transform var(--dur-move) var(--ease-move),opacity var(--dur-move) var(--ease-move),display var(--dur-move) allow-discrete}
.rail[hidden]{display:none}
.rail-over>.rail[hidden]{transform:translateX(24px);opacity:0}
.rail-backdrop{position:absolute;inset:0;z-index:19;background:var(--rail-shade);animation:sgFade var(--dur-move) var(--ease-move);transition:opacity var(--dur-move) var(--ease-move),display var(--dur-move) allow-discrete}
.rail-backdrop[hidden]{display:none;opacity:0;pointer-events:none}
.rail-close{position:sticky;top:-16px;z-index:1;display:flex;align-items:center;justify-content:space-between;gap:8px;margin:-16px -14px 0;padding:12px 12px 8px 16px;background:var(--lesson-rail)}
.rail-title{font:400 15px var(--font-display);color:var(--ink)}
.rail-x{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;border:0;border-radius:10px;background:var(--lesson-rail-edge);color:var(--ink);font-size:15px;line-height:1}
.rail-x:hover{background:var(--lesson-tile-edge)}
.message.pending{opacity:.85}
.thinking .dots{display:inline-flex;gap:3px;font-size:22px;line-height:1;color:var(--muted)}
.waited{margin-left:10px;font-size:12px;font-weight:600;color:var(--faint);font-variant-numeric:tabular-nums}
/* The three dots rise and brighten one after another, a sixth of a beat apart. */
.thinking .dots span{animation:sgDot var(--loop-beat) var(--ease-loop) infinite}.thinking .dots span:nth-child(2){animation-delay:calc(var(--loop-beat) / 6)}.thinking .dots span:nth-child(3){animation-delay:calc(var(--loop-beat) / 3)}
@media (prefers-reduced-motion:reduce){.thinking .dots span{opacity:.6}}
.rail-card{background:var(--card);border-radius:18px;padding:16px;box-shadow:0 0 0 1px var(--lesson-card-ring);flex:none}
.rail-card.goal{display:flex;flex-direction:column;gap:6px}
.rail-eyebrow{color:var(--estimate-eyebrow);white-space:nowrap}
.rail-head{display:flex;align-items:center;justify-content:space-between}
.rail-head :deep(.info-bubble){left:auto;right:0}
.mastery-row{display:flex;align-items:center;gap:12px;margin-top:10px}
.mastery-figure{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.mastery-figure strong{font-size:30px;line-height:1;font-weight:700;letter-spacing:-1px;font-variant-numeric:tabular-nums}
.mastery-figure :deep(.mastery-cells){max-width:none}
.goal-text{margin:0;font-size:14px;line-height:1.55}
.gate-text{margin:0;font-size:13px;line-height:1.55;color:var(--soft)}
.divider{height:1px;background:var(--lesson-divider);margin:8px 0}
.rail-empty{margin:8px 0 0;font-size:12px}
@media(max-width:900px){.learn-head{padding:14px 18px 12px}.thread-inner{padding:22px 18px 18px}.composer-area{padding:10px 18px 14px}}
@media(max-width:650px){.learn{height:calc(100dvh - 20px);min-height:520px}.head-title{min-width:0}.learn-head h1{font-size:22px}.sprite-tile{width:44px;height:44px}.heading-action .primary{min-height:42px;padding:0 12px;font-size:13px;white-space:normal}.from-you{max-width:85%}.opening-card{padding:16px 16px 12px}.prose{font-size:14px}.confidence{flex-wrap:wrap}.chat-welcome h2{font-size:29px}}
</style>
