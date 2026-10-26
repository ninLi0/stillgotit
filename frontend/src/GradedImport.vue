<script setup lang="ts">
import InfoBubble from "./InfoBubble.vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api, failureText } from "./api.ts";
import { uploadMaterial } from "./host-api.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import {
  GRADED_PREFIX, KeptReviews, NAME_LIMIT, alreadyImported, confirmRow, dateProblem, earlierLabels, estimateStart, filesProblem, importBusy,
  isCalendarDate, isGradedTitle, listText, newRows, readableDay, resultLabels, results, reviewRequest, rowProblem, sentences,
  type ImportedRow, type KeptReview, type KeptRow, type Material,
} from "./graded-import.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";

/**
 * The graded-work import screen (design/compositions/Importing.md). The course page mounts it once for the screen, and
 * once in each library row, where `material` and `title` are given and it offers "Review graded work" for graded work.
 */
// `external` hides the closed-state intro: the Materials header has its own "Import graded work" button, which calls the
// exposed startUpload, and gets focus back through `closed`.
const props = defineProps<{ course: string; material?: Material; title?: string; aiAvailable?: boolean; aiReason?: string; external?: boolean }>();
const emit = defineEmits<{ changed: []; closed: [] }>();
const rowMode = props.material !== undefined;
const graded = computed(() => isGradedTitle(props.title ?? ""));
function requestReview() { if (props.material) reviewRequest.value = { course: props.course, material: props.material }; }

type Skill = StillGotItHttp["/courses/read"]["output"]["skills"][number];
type WorkFile = { title: string; files: string[]; limitations: string[]; content: string };
const store = new KeptReviews(sessionStorage);
const openKey = `stillgotit-graded-open:${props.course}`;

const stage = ref<"closed" | "upload" | "review">("closed");
const busy = ref(false), confirming = ref(false), error = ref<string[]>([]), notice = ref(""), progress = ref(""), storageError = ref("");
const panel = ref<HTMLElement | null>(null), heading = ref<HTMLElement | null>(null), openButton = ref<HTMLButtonElement | null>(null);
const errorBox = ref<HTMLElement | null>(null), noticeBox = ref<HTMLElement | null>(null);
// Where focus goes when a step ends, when that is not the control the learner used.
type FocusTarget = () => HTMLElement | null | undefined;
const after: { focus: FocusTarget | null } = { focus: null };
function focusLater(target: FocusTarget | null) { after.focus = target; }

// Upload. The request identity stays the same until the name or files change, so a retry cannot import the work twice.
const workName = ref(""), files = ref<File[]>([]), requestId = ref(crypto.randomUUID()), nameError = ref(""), filesError = ref<string[]>([]);
const nameInput = ref<HTMLInputElement | null>(null), fileInput = ref<HTMLInputElement | null>(null), filesErrorBox = ref<HTMLElement | null>(null);

// Review.
const reviewing = ref<Material | null>(null), review = ref<KeptReview | null>(null), workFile = ref<WorkFile | null>(null);
const skills = ref<Skill[]>([]), skillsRead = ref(false), imports = ref<ImportedRow[]>([]), today = ref(""), contextLoaded = ref(false);
const rowErrors = ref<Record<number, string>>({}), dateError = ref(""), confirmError = ref("");
const dateInput = ref<HTMLInputElement | null>(null);
// Each mapped skill's estimate start as a New York date; null when the skill has no estimate yet.
const starts = ref<Record<string, string | null>>({});
const startReads = new Set<string>();

const confirmedSkills = computed(() => skills.value.filter((skill) => skill.status === "CONFIRMED"));
const confirmedIds = computed(() => new Set<string>(confirmedSkills.value.map((skill) => skill.skill)));
const skillTitles = computed(() => Object.fromEntries(skills.value.map((skill) => [skill.skill, skill.title])));
const aiOff = computed(() => props.aiAvailable ? "" : props.aiReason || "Checking whether the AI tutor is available…");
const isImported = (row: KeptRow) => row.imported || alreadyImported(row, imports.value);
const earlier = (row: KeptRow) => isImported(row) ? [] : earlierLabels(row, imports.value);
// The date and help choice stay fixed while a sequence is under way or a sent row has no answer yet.
const locked = computed(() => !!review.value && (review.value.started || review.value.rows.some((row) => row.pending)));
const toImport = computed(() => review.value?.rows.filter((row) => row.checked && row.skill && !isImported(row)) ?? []);
// When the skills cannot be read, the upload stays available; the review checks the skills again before reading the work.
const uploadReason = computed(() => skillsRead.value && !confirmedSkills.value.length ? sentences.skillsUnavailable : "");
const readReason = computed(() => locked.value ? "Some questions from this review are already imported. Confirm or uncheck the rest first."
  : !confirmedSkills.value.length ? sentences.skillsUnavailable : aiOff.value);
const confirmReason = computed(() => today.value ? "" : "Today's date has not loaded. Close this review and open it again.");
const workTitle = computed(() => workFile.value?.title ?? "");
const summary = computed(() => {
  const count = toImport.value.length;
  return count ? `${count} ${count === 1 ? "question is" : "questions are"} checked and mapped to a skill. Confirming imports them one at a time.`
    : "No question is checked and mapped to a skill yet.";
});

/** Runs one step of the screen. Errors appear at the top of the screen, and focus returns to the control the learner used. */
async function work(step: () => Promise<void>) {
  const previous = focusedControl();
  busy.value = true; error.value = []; notice.value = ""; focusLater(null);
  try { await step(); }
  catch (problem) { error.value = [problem instanceof Error ? problem.message : "The request could not finish. Your saved work is still available."]; }
  finally {
    busy.value = false; confirming.value = false; progress.value = "";
    await nextTick();
    const target = after.focus?.();
    if (target) { target.focus(); target.scrollIntoView({ block: "nearest" }); }
    else restoreFocus(previous, () => (error.value.length ? errorBox.value : noticeBox.value) ?? heading.value);
  }
}

/** A refusal's sentence. FORBIDDEN here always means the material is not the learner's graded work. `bare` explains a 400 without a detail. */
function explain(result: object, bare?: string): string {
  const failure = result as { error: unknown; detail?: unknown };
  if (failure.error === "FORBIDDEN") return sentences.materialUnavailable;
  if (bare && isBare(failure)) return bare;
  return failureText(failure);
}
function isBare(failure: { error: unknown; detail?: unknown }) {
  return failure.error === "INVALID_REQUEST" && !(typeof failure.detail === "string" && failure.detail.trim());
}

async function readCourse() {
  const result = await api.courses.read({ course: props.course });
  if ("error" in result) throw new Error(failureText(result));
  skills.value = result.skills; skillsRead.value = true;
}
async function readImports(material: Material) {
  const result = await api.courses.graded.read({ material });
  if ("error" in result) throw new Error(explain(result));
  imports.value = result.imported; today.value = result.today;
}
async function readWorkFile(material: Material) {
  const result = await api.courses.materials.read({ material });
  if ("error" in result) throw new Error(explain(result));
  workFile.value = { title: result.title, files: result.originals.map((file) => file.name),
    limitations: [...new Set(result.originals.flatMap((file) => file.limitations))], content: result.content };
}

function persist() {
  const material = reviewing.value, current = review.value;
  if (!material || !current) return;
  try { store.save(material, current); storageError.value = ""; }
  catch (problem) { storageError.value = problem instanceof Error ? problem.message : "The browser could not keep your review."; }
}
function rememberOpen(material: Material | null) {
  try { if (material) sessionStorage.setItem(openKey, material); else sessionStorage.removeItem(openKey); } catch { /* Reopening after a reload is a convenience. */ }
}

/**
 * Called right after ReadImports answers. Rows it lists are marked as imported, so they are never sent again.
 * A sent row whose answer was lost is settled here: imported if listed, otherwise free to edit and send again.
 */
function reconcile() {
  const current = review.value;
  if (!current) return;
  let changed = false;
  for (const row of current.rows) {
    if (!row.imported && alreadyImported(row, imports.value)) {
      row.imported = true; row.checked = false; changed = true;
      if (row.pending) current.started = true;
    }
    if (row.pending) { row.pending = false; changed = true; }
  }
  if (changed) persist();
}

/** Reads when each mapped skill's estimate started, for the date warning. A skill that cannot be read shows no warning. */
async function loadStarts() {
  const wanted = [...new Set(review.value?.rows.map((row) => row.skill).filter(Boolean) ?? [])]
    .filter((skill) => !(skill in starts.value) && !startReads.has(skill));
  await Promise.all(wanted.map(async (skill) => {
    startReads.add(skill);
    try {
      const result = await api.learning.read({ skill });
      if (!("error" in result)) starts.value = { ...starts.value, [skill]: estimateStart(result.data.track) };
    } catch { /* Leave the warning out. */ }
    finally { startReads.delete(skill); }
  }));
}

function resetReview() {
  review.value = null; workFile.value = null; imports.value = []; today.value = ""; contextLoaded.value = false;
  rowErrors.value = {}; dateError.value = ""; confirmError.value = ""; starts.value = {}; storageError.value = "";
}

/** Opens the review for a material: kept rows when this tab has them, otherwise a new extraction. */
async function open(material: Material, { focus = true } = {}) {
  if (busy.value) return;
  stage.value = "review"; reviewing.value = material; resetReview(); rememberOpen(material);
  if (focus) { await nextTick(); panel.value?.scrollIntoView({ block: "start" }); heading.value?.focus(); }
  await work(() => loadReview(material));
}

async function loadReview(material: Material, saved = false) {
  // ReadImports checks that this is the learner's graded work before anything else is read.
  await readImports(material);
  await Promise.all([readCourse(), readWorkFile(material)]);
  if (reviewing.value !== material) return;
  contextLoaded.value = true;
  const kept = store.read(material);
  if (kept) {
    review.value = kept; reconcile(); void loadStarts();
    notice.value = "Your review of this work is as you left it.";
    return;
  }
  await extract(material, saved);
}

async function extract(material: Material, saved = false) {
  if (!confirmedSkills.value.length) throw new Error(sentences.skillsUnavailable);
  if (aiOff.value) throw new Error(aiOff.value);
  progress.value = "The tutor is reading the marked questions. This can take up to a minute.";
  const result = await api.courses.graded.extract({ material });
  if (reviewing.value !== material) return;
  // With a confirmed skill checked above, a 400 without a detail means the tutor found no marked questions.
  if ("error" in result) throw new Error(explain(result, sentences.marksMissing));
  const previous = review.value, outsideHelp = previous?.outsideHelp ?? false;
  review.value = { performedOn: previous?.performedOn ?? "", outsideHelp, started: false, rows: newRows(result.rows, imports.value, confirmedIds.value, outsideHelp) };
  rowErrors.value = {}; confirmError.value = ""; dateError.value = "";
  void loadStarts();
  const count = result.rows.length;
  notice.value = `${saved ? "Graded work saved. " : ""}The tutor read ${count} marked ${count === 1 ? "question" : "questions"}. Check each one, then confirm the import.`;
  // Keep the rows as soon as Extract answers.
  store.save(material, review.value);
}

async function readAgain() {
  const material = reviewing.value;
  if (!material || readReason.value) return;
  await work(async () => {
    if (!contextLoaded.value) await loadReview(material);
    else await extract(material);
  });
}

// Upload.
function newRequest() { requestId.value = crypto.randomUUID(); nameError.value = ""; }
function filesChanged(event: Event) {
  files.value = Array.from((event.target as HTMLInputElement).files ?? []);
  requestId.value = crypto.randomUUID(); filesError.value = [];
}
function removeFile(index: number) {
  files.value.splice(index, 1);
  requestId.value = crypto.randomUUID(); filesError.value = [];
  if (!files.value.length && fileInput.value) fileInput.value.value = "";
}
function fileSize(bytes: number) { return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`; }

async function startUpload() {
  stage.value = "upload"; error.value = []; notice.value = "";
  await nextTick(); heading.value?.focus();
  await work(readCourse);
}

async function upload() {
  nameError.value = ""; filesError.value = [];
  const name = workName.value.trim();
  if (!name) { nameError.value = "Enter a name for the work."; nameInput.value?.focus(); return; }
  const problem = filesProblem(files.value);
  if (problem) { filesError.value = [problem]; await nextTick(); filesErrorBox.value?.focus(); return; }
  await work(async () => {
    const form = new FormData();
    form.set("course", props.course); form.set("title", `${GRADED_PREFIX}${name}`); form.set("requestId", requestId.value);
    for (const file of files.value) form.append("files", file);
    progress.value = "Uploading your graded work…";
    let saved: Awaited<ReturnType<typeof uploadMaterial>>;
    try { saved = await uploadMaterial(form); }
    catch (failure) {
      const message = failure instanceof Error ? failure.message : "The request could not finish. Your saved work is still available.";
      // Scanned PDFs are read, so this refusal now means the files had nothing to read. Photos of the pages still work.
      filesError.value = message === sentences.noReadableContent ? [message, sentences.photosInstead] : [message];
      focusLater(() => filesErrorBox.value);
      return;
    }
    emit("changed");
    workName.value = ""; files.value = []; requestId.value = crypto.randomUUID();
    stage.value = "review"; reviewing.value = saved.material; resetReview(); rememberOpen(saved.material);
    try { await loadReview(saved.material, true); }
    catch (problem) { notice.value = "Graded work saved. You can read it again here or from Review graded work in your files."; throw problem; }
  });
}

// Review edits are kept with the rows as soon as they are made.
function setChecked(row: KeptRow, checked: boolean) { row.checked = checked; persist(); }
function skillChanged(row: KeptRow) {
  if (isImported(row)) row.checked = false;
  persist(); void loadStarts();
}
function helpChanged() {
  const current = review.value;
  if (!current) return;
  if (current.outsideHelp) for (const row of current.rows) if (!row.imported && row.result === "INDEPENDENT") row.result = "SUPPORTED";
  persist();
}
function resultChoices(row: KeptRow) {
  return results.filter((value) => value !== "INDEPENDENT" || !review.value?.outsideHelp || row.result === value);
}
function dateWarning(row: KeptRow) {
  const current = review.value;
  if (!current || !row.checked || isImported(row) || !row.skill || row.result === "UNCERTAIN" || !isCalendarDate(current.performedOn)) return "";
  const start = starts.value[row.skill];
  if (!start || current.performedOn >= start) return "";
  return `Your estimate for this skill started on ${readableDay(start)}. Importing work from ${readableDay(current.performedOn)} makes its history start from that earlier date.`;
}
function describedBy(...ids: (string | false)[]) { return ids.filter(Boolean).join(" ") || undefined; }

/** Marks one row as imported in the kept rows. From then on the date and help choice stay fixed until the sequence finishes. */
function markImported(current: KeptReview, row: KeptRow) {
  row.imported = true; row.checked = false; row.pending = false; current.started = true;
  persist();
}

/**
 * Sends the checked rows that are mapped to a skill, one per request, in row order, with the same date and help choice.
 * Every Confirm refusal reaches the browser as a 400 without a code, so the screen checks each rule before sending.
 */
async function confirmImport() {
  const material = reviewing.value, current = review.value;
  if (!material || !current) return;
  rowErrors.value = {}; dateError.value = ""; confirmError.value = "";
  await work(async () => {
    confirming.value = true;
    // Current imports, date, and skills, so these checks match the ones Confirm makes.
    await readImports(material);
    await readCourse();
    reconcile();
    const queue = current.rows.map((row, index) => ({ row, index })).filter(({ row }) => row.checked && row.skill && !isImported(row));
    if (!queue.length) {
      if (current.started) { await finish(material, current, []); return; }
      confirmError.value = sentences.nothingChecked;
      return;
    }
    const date = dateProblem(current.performedOn, today.value);
    if (date) { dateError.value = date; focusLater(() => dateInput.value); return; }
    const problems = queue.map(({ row, index }) => [index, rowProblem(confirmRow(row), current.outsideHelp, confirmedIds.value)] as const).filter(([, problem]) => problem);
    if (problems.length) {
      rowErrors.value = Object.fromEntries(problems);
      focusLater(() => document.getElementById(`graded-row-${problems[0]![0]}-error`));
      return;
    }
    const done: KeptRow[] = [];
    for (const [position, { row, index }] of queue.entries()) {
      progress.value = `Importing ${row.label}, question ${position + 1} of ${queue.length}…`;
      // Kept as sent before the request leaves, so a page closed before the answer reopens with this row as sent.
      row.pending = true; persist();
      const result = await api.courses.graded.confirm({ material, performedOn: current.performedOn, outsideHelp: current.outsideHelp, row: confirmRow(row) });
      if (!("error" in result)) { markImported(current, row); done.push(row); continue; }
      let reason = explain(result);
      // A declared refusal imported nothing. Without one the row may have been imported, so it stays as sent until ReadImports settles it.
      if (["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN"].includes(String(result.error))) { row.pending = false; persist(); }
      if (String(result.error) === "INVALID_REQUEST") {
        // Already imported, by a lost reply or another tab, if ReadImports now lists this label and skill. The used-source
        // refusal now arrives with its sentence, so every declined row is checked against the imports, not only a bare one.
        try {
          await readImports(material);
          if (alreadyImported(row, imports.value)) { markImported(current, row); done.push(row); continue; }
        } catch (problem) { reason = problem instanceof Error ? problem.message : reason; }
      }
      // Stop here. This row and the later ones stay checked, so the learner can fix it and confirm again.
      rowErrors.value = { [index]: reason };
      focusLater(() => document.getElementById(`graded-row-${index}-error`));
      if (done.length) emit("changed");
      return;
    }
    await finish(material, current, done);
    if (done.length) emit("changed");
  });
}

/** The sequence is complete: the kept rows are removed and the imports are read again. */
async function finish(material: Material, current: KeptReview, done: KeptRow[]) {
  store.remove(material);
  current.started = false;
  const waiting = done.some((row) => starts.value[row.skill] === null);
  starts.value = {};
  await readImports(material);
  void loadStarts();
  const count = done.length;
  notice.value = count
    ? `Imported ${count} ${count === 1 ? "question" : "questions"} from this work. Each result now counts as evidence for its skill.${waiting ? " A skill without a starting point keeps its evidence until you set your confidence." : ""}`
    : "The import is finished. Questions that were unchecked or had no skill were not imported.";
}

function close() {
  stage.value = "closed"; reviewing.value = null; resetReview(); rememberOpen(null);
  error.value = []; notice.value = ""; nameError.value = ""; filesError.value = [];
  if (props.external) emit("closed");
  else void nextTick(() => openButton.value?.focus());
}

if (!rowMode) {
  watch(reviewRequest, (request) => {
    if (!request || request.course !== props.course) return;
    reviewRequest.value = null;
    void open(request.material);
  });
  watch(busy, (value) => { importBusy.value = value; });
  onMounted(() => {
    // After a reload, reopen a review whose rows this tab still keeps.
    let material: string | null = null;
    try { material = sessionStorage.getItem(openKey); } catch { return; }
    if (!material) return;
    try { if (!store.read(material as Material)) { rememberOpen(null); return; } } catch { /* Open it so the problem is reported. */ }
    void open(material as Material, { focus: false });
  });
  onBeforeUnmount(() => { importBusy.value = false; });
}
defineExpose({ startUpload });
</script>

<template>
  <button v-if="rowMode && graded" type="button" class="secondary sand" :disabled="importBusy" @click="requestReview">Review graded work</button>
  <section v-else-if="!rowMode && (stage !== 'closed' || !external)" ref="panel" class="graded-panel" :class="{ open: stage !== 'closed' }" :aria-busy="busy" aria-labelledby="graded-title">
    <div v-if="stage === 'closed'" class="graded-intro">
      <div class="graded-title-row"><h2 id="graded-title">Graded work</h2><InfoBubble text="Import a returned exam or problem set. Its marked questions become evidence for your skills." /></div>
      <button ref="openButton" type="button" class="secondary sand" @click="startUpload">Import graded work</button>
    </div>
    <template v-else>
      <header class="graded-heading">
        <div><h2 id="graded-title" ref="heading" tabindex="-1">{{ stage === 'upload' ? 'Import graded work' : 'Review graded work' }}</h2><p v-if="stage === 'review' && workTitle" class="graded-subtitle">{{ workTitle }}</p></div>
        <button type="button" class="quiet" :disabled="busy" @click="close">Close</button>
      </header>
      <div role="alert">
        <div v-if="error.length" ref="errorBox" class="error graded-message" tabindex="-1"><p v-for="line in error" :key="line">{{ line }}</p></div>
        <p v-if="storageError" class="error graded-message">{{ storageError }}</p>
      </div>
      <div role="status">
        <p v-if="notice && !busy" ref="noticeBox" class="notice graded-message" tabindex="-1">{{ notice }}</p>
        <p v-if="busy && progress" class="working"><span aria-hidden="true">✳</span> {{ progress }}</p>
      </div>

      <form v-if="stage === 'upload'" class="graded-upload" novalidate @submit.prevent="upload">
        <p class="graded-info"><InfoBubble label="How graded import works" text="Upload a returned exam or problem set with its marks. The tutor reads each marked question, and you check every result before anything counts as evidence." /></p>
        <p v-if="uploadReason" id="graded-upload-reason" class="row-warning">{{ uploadReason }}</p>
        <label for="graded-name">Name of the work</label>
        <input id="graded-name" ref="nameInput" v-model="workName" :maxlength="NAME_LIMIT" placeholder="For example, Midterm 1" :disabled="busy" :aria-invalid="!!nameError" :aria-describedby="describedBy('graded-name-hint', !!nameError && 'graded-name-error')" @input="newRequest" />
        <p id="graded-name-hint" class="hint">It is saved in your course materials as “{{ GRADED_PREFIX }}{{ workName.trim() || 'Midterm 1' }}”.</p>
        <p v-if="nameError" id="graded-name-error" class="field-error" role="alert">{{ nameError }}</p>
        <label for="graded-files">Files</label>
        <input id="graded-files" ref="fileInput" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,application/pdf,image/png,image/jpeg,image/webp,image/heic,image/heif" :disabled="busy" :aria-describedby="describedBy('graded-files-hint', !!filesError.length && 'graded-files-error')" @change="filesChanged" />
        <ul v-if="files.length" class="graded-files">
          <li v-for="(file, index) in files" :key="file.name + index"><span>{{ file.name }} <small>{{ fileSize(file.size) }}</small></span><button type="button" class="quiet" :disabled="busy" :aria-label="`Remove ${file.name}`" @click="removeFile(index)">Remove</button></li>
        </ul>
        <p id="graded-files-hint" class="hint">A PDF, with or without a text layer, or photos of the pages (PNG, JPEG, WebP, HEIC, or HEIF). Each file can be up to 15 MB, and all files together up to 25 MB.</p>
        <div v-if="filesError.length" id="graded-files-error" ref="filesErrorBox" class="field-error" role="alert" tabindex="-1"><p v-for="line in filesError" :key="line">{{ line }}</p></div>
        <p class="graded-info"><InfoBubble label="About long papers" :text="`One import reads at most 50 questions, so upload a longer paper in parts. ${sentences.separateUploads}`" /></p>
        <div class="graded-actions"><div class="action"><button class="primary sand" :disabled="busy || !!uploadReason" :aria-describedby="uploadReason ? 'graded-upload-reason' : undefined">{{ busy ? 'Uploading…' : 'Upload and read the marks' }}</button></div></div>
      </form>

      <template v-if="stage === 'review'">
        <details v-if="workFile" class="graded-file">
          <summary>{{ workFile.files.length === 1 ? 'The uploaded file' : `The ${workFile.files.length} uploaded files` }}</summary>
          <ul><li v-for="name in workFile.files" :key="name">{{ name }}</li></ul>
          <p v-for="limit in workFile.limitations" :key="limit" class="hint">{{ limit }}</p>
          <pre v-if="workFile.content.trim()">{{ workFile.content }}</pre>
          <p v-else class="hint">This work has no readable text. The tutor reads its pages as images.</p>
        </details>

        <div v-if="review" class="graded-review">
          <fieldset class="graded-when" :disabled="busy || locked">
            <legend class="sr-only">When you did this work, and whether you had help</legend>
            <label for="graded-date">Date you did this work</label>
            <input id="graded-date" ref="dateInput" v-model="review.performedOn" type="date" required :max="today || undefined" :aria-invalid="!!dateError" :aria-describedby="describedBy(!!dateError && 'graded-date-error', locked && 'graded-locked')" @change="persist" />
            <p v-if="dateError" id="graded-date-error" class="field-error" role="alert">{{ dateError }}</p>
            <label class="check"><input v-model="review.outsideHelp" type="checkbox" aria-describedby="graded-help-hint" @change="helpChanged" /> I had help with this work, such as notes, a classmate, or a tutor.</label>
            <p id="graded-help-hint" class="hint">Leave this unchecked for work done without help, as in an exam. With help, the strongest result is “Success with help”.</p>
            <p v-if="locked" id="graded-locked" class="hint">The date and help choice stay as they are until the remaining checked questions are imported, so every question from this work carries the same values.</p>
          </fieldset>
          <p v-if="review.rows.length >= 50" class="row-warning">The tutor read 50 questions, the most one import reads, so later questions may be missing. Upload the rest of the paper separately.</p>

          <ol class="graded-rows">
            <li v-for="(row, index) in review.rows" :key="index" class="graded-row" :class="{ done: isImported(row) }">
              <div class="row-top">
                <label class="check row-check"><input type="checkbox" :checked="row.checked && !isImported(row)" :disabled="busy || isImported(row)" @change="setChecked(row, ($event.target as HTMLInputElement).checked)" /><strong>{{ row.label }}</strong><span class="sr-only">: import this question</span></label>
                <span class="mark"><span class="sr-only">Mark: </span>{{ row.mark }}</span>
                <span v-if="isImported(row)" class="imported-tag">Imported</span>
              </div>
              <dl class="row-facts">
                <div><dt>Grader's feedback</dt><dd>{{ row.feedback.trim() || 'The grader wrote no feedback.' }}</dd></div>
                <div><dt>Your answer</dt><dd>{{ row.excerpt.trim() || 'The tutor could not read an answer.' }}</dd></div>
                <div><dt>Tutor's proposal</dt><dd><strong>{{ resultLabels[row.proposedResult] }}.</strong> {{ row.rationale }}</dd></div>
              </dl>
              <div class="row-choices">
                <div>
                  <label :for="`graded-row-${index}-skill`">Skill<span class="sr-only"> for {{ row.label }}</span></label>
                  <select :id="`graded-row-${index}-skill`" v-model="row.skill" :disabled="busy || row.imported || !!row.pending" :aria-describedby="describedBy(!!earlier(row).length && `graded-row-${index}-earlier`, !!rowErrors[index] && `graded-row-${index}-error`)" @change="skillChanged(row)">
                    <option value="">No skill</option>
                    <option v-if="row.skill && !confirmedIds.has(row.skill)" :value="row.skill" disabled>{{ skillTitles[row.skill] ?? 'A skill that is no longer confirmed' }}</option>
                    <option v-for="skill in confirmedSkills" :key="skill.skill" :value="skill.skill">{{ skill.title }}</option>
                  </select>
                </div>
                <div>
                  <label :for="`graded-row-${index}-result`">Result<span class="sr-only"> for {{ row.label }}</span></label>
                  <select :id="`graded-row-${index}-result`" v-model="row.result" :disabled="busy || row.imported || !!row.pending" :aria-describedby="describedBy(!!dateWarning(row) && `graded-row-${index}-date`, !!rowErrors[index] && `graded-row-${index}-error`)" @change="persist">
                    <option v-for="value in resultChoices(row)" :key="value" :value="value">{{ resultLabels[value] }}</option>
                  </select>
                </div>
              </div>
              <p v-if="earlier(row).length" :id="`graded-row-${index}-earlier`" class="row-warning">This skill already has an import from this work, from {{ listText(earlier(row)) }}. Check this row only if it is a different question.</p>
              <p v-if="dateWarning(row)" :id="`graded-row-${index}-date`" class="row-warning">{{ dateWarning(row) }}</p>
              <p v-if="row.checked && !row.skill && !isImported(row)" class="hint">{{ sentences.unmapped }}</p>
              <p v-if="row.pending && !isImported(row) && !busy" class="hint">This question was sent, but no answer arrived. Confirm again to check whether it was imported. Until then it stays as it was sent.</p>
              <p v-if="rowErrors[index]" :id="`graded-row-${index}-error`" class="field-error" role="alert" tabindex="-1">{{ rowErrors[index] }}</p>
            </li>
          </ol>

          <div class="graded-confirm">
            <p class="hint">{{ summary }}</p>
            <p v-if="confirmError" id="graded-confirm-error" class="field-error" role="alert">{{ confirmError }}</p>
            <div class="graded-actions">
              <div class="action"><p v-if="readReason" id="graded-read-reason" class="hint reason">{{ readReason }}</p><button type="button" class="secondary sand" :disabled="busy || !!readReason" :aria-describedby="describedBy('graded-read-hint', !!readReason && 'graded-read-reason')" @click="readAgain">Read the work again</button></div>
              <div class="action"><p v-if="confirmReason" id="graded-confirm-reason" class="hint reason">{{ confirmReason }}</p><button type="button" class="primary sand" :disabled="busy || !!confirmReason" :aria-describedby="describedBy(!!confirmError && 'graded-confirm-error', !!confirmReason && 'graded-confirm-reason')" @click="confirmImport">{{ confirming ? 'Importing…' : 'Confirm import' }}</button></div>
            </div>
            <p id="graded-read-hint" class="hint">Reading the work again asks the tutor again and replaces these questions and your changes to them.</p>
          </div>
        </div>
        <div v-else-if="!busy && reviewing" class="graded-actions start">
          <div v-if="contextLoaded" class="action"><p v-if="readReason" id="graded-read-reason" class="hint reason">{{ readReason }}</p><button type="button" class="primary sand" :disabled="!!readReason" :aria-describedby="readReason ? 'graded-read-reason' : undefined" @click="readAgain">Read the work again</button></div>
          <button v-else type="button" class="primary sand" @click="open(reviewing)">Try again</button>
        </div>

        <section v-if="contextLoaded" class="graded-history" aria-labelledby="graded-history-title">
          <h3 id="graded-history-title">Imported from this work</h3>
          <p v-if="!imports.length" class="hint">Nothing from this work has been imported yet.</p>
          <ul v-else>
            <li v-for="item in imports" :key="item.case">
              <div class="row-top"><strong>{{ item.label }}</strong><span class="mark"><span class="sr-only">Mark: </span>{{ item.mark }}</span></div>
              <p>{{ skillTitles[item.skill] ?? 'A skill in this course' }} · Done on {{ readableDay(item.performedAt) }} · Current result: {{ resultLabels[item.result] }}</p>
              <p class="hint">{{ item.feedback.trim() ? `Grader's feedback: ${item.feedback}` : 'The grader wrote no feedback.' }}</p>
            </li>
          </ul>
        </section>
      </template>
    </template>
  </section>
</template>

<style scoped>
.graded-panel{margin-top:26px}.graded-intro{display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px 16px}.graded-intro h2,.graded-heading h2{font:500 22px var(--font-display);margin:0 0 4px}.graded-intro p{margin:0;font-size:13px;color:var(--muted)}
.graded-panel.open{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:18px;box-shadow:0 1px 2px rgb(var(--shadow) / .05),0 10px 30px rgb(var(--shadow) / .07)}
.graded-heading{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}.graded-subtitle{margin:0;font-size:13px;color:var(--muted);overflow-wrap:anywhere}
.graded-message{margin:14px 0 0}.working{font-size:13px;color:var(--muted);margin:14px 0 0}.working span{margin-right:6px}
.graded-upload{max-width:none;margin-top:6px}.graded-upload label{margin:16px 0 7px;font-size:13px}.graded-upload input[type=file]{min-height:0;padding:10px 0;border:0;font-size:13px;background:transparent}
.graded-files{list-style:none;margin:4px 0 0;padding:0}.graded-files li{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:6px 0;border-top:1px solid var(--line);font-size:13px;overflow-wrap:anywhere}.graded-files small{color:var(--muted)}.graded-files .quiet{font-size:12px;flex:none}
.field-error{margin:8px 0 0;padding:8px 12px;border-left:3px solid var(--error);background:var(--card);font-size:13px}.field-error p{margin:0}.field-error p+p{margin-top:4px}
.graded-actions{display:flex;justify-content:flex-end;align-items:center;flex-wrap:wrap;gap:12px;margin-top:16px}.graded-actions.start{justify-content:flex-start}.action{display:inline-flex;flex-direction:column-reverse;align-items:flex-end}.start .action{align-items:flex-start}.graded-actions:not(.start) .action>.reason{left:auto!important;right:0}.graded-actions .secondary{font-size:13px}
.graded-file{margin:16px 0 0;font-size:13px}.graded-file summary{color:var(--muted)}.graded-file ul{margin:8px 0;padding-left:18px}.graded-file pre{max-height:200px;overflow:auto;white-space:pre-wrap;font-size:12px;background:var(--inset);padding:12px;border-radius:10px;margin:8px 0 0}
.graded-when{border:0;margin:18px 0 0;padding:0;min-width:0}.graded-when label{font-size:13px}.graded-when input[type=date]{max-width:220px}
.check{display:flex;align-items:flex-start;gap:10px;font-size:13px;font-weight:400;margin:14px 0 0}.check input{width:16px;min-height:16px;height:16px;margin:3px 0 0;padding:0;flex:none;accent-color:var(--sand-soft-text)}
.graded-rows{list-style:none;margin:18px 0 0;padding:0;border:1px solid var(--line);border-radius:14px;overflow:hidden}.graded-row{padding:14px 16px}.graded-row+.graded-row{border-top:1px solid var(--line)}.graded-row.done{background:var(--inset)}
.row-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.row-check{margin:0;flex:1;min-width:0}.row-check strong{font-size:15px;overflow-wrap:anywhere}
.mark{background:var(--sand-soft);color:var(--sand-text);border-radius:999px;padding:2px 10px;font-size:13px;font-weight:600;white-space:nowrap}.imported-tag{color:var(--strong);font-size:13px;font-weight:600}
.row-facts{margin:10px 0 0;display:grid;gap:6px}.row-facts div{display:grid;grid-template-columns:140px minmax(0,1fr);gap:10px;font-size:13px}.row-facts dt{color:var(--muted)}.row-facts dd{margin:0;white-space:pre-wrap;overflow-wrap:anywhere}
.row-choices{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:10px}.row-choices label{font-size:12px;margin:0 0 5px}
select{width:100%;font:inherit;font-size:14px;padding:9px 12px;border:1px solid var(--faint);border-radius:7px;background:var(--field);color:var(--ink)}select:disabled{opacity:.7}
.row-warning{margin:10px 0 0;padding:8px 12px;border-left:3px solid var(--sand-edge);background:var(--inset);font-size:13px}.graded-row.done .row-warning{background:var(--card)}
.graded-confirm{margin-top:14px}.graded-confirm>.hint{margin:0}.graded-confirm>.hint:last-child{margin-top:10px}
.graded-history{margin-top:22px;padding-top:16px;border-top:1px solid var(--line)}.graded-history h3{font:500 18px var(--font-display);margin:0 0 8px}.graded-history ul{list-style:none;margin:0;padding:0}.graded-history li{padding:10px 0}.graded-history li+li{border-top:1px solid var(--line)}.graded-history p{margin:4px 0 0;font-size:13px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media(max-width:650px){.graded-panel.open{padding:14px;border-radius:14px}.graded-row{padding:12px}.row-facts div{grid-template-columns:1fr;gap:2px}.row-choices{grid-template-columns:1fr}.graded-actions .action,.graded-actions .action button{width:100%}.graded-actions .action{align-items:stretch}}
.graded-title-row{display:flex;align-items:center;gap:6px}.graded-info{margin:0 0 4px}
</style>
