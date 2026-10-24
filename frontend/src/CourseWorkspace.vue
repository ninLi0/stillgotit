<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { api, unwrap, type Course } from "./api.ts";
import { aiStatus, type AIStatus } from "./host-api.ts";
import { DraftSaveQueue } from "./draft-save-queue.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { fileSize, readyNotice, submitImport } from "./material-imports.ts";
import MaterialImports from "./MaterialImports.vue";
import MaterialMedia from "./MaterialMedia.vue";
import SkillTree from "./SkillTree.vue";
import SkillStudy from "./SkillStudy.vue";
import StudyPlanner from "./StudyPlanner.vue";
import type { StillGotItHttp } from "../../generated/wire.ts";

const props = defineProps<{ course: Course }>();
const view = ref<"home" | "setup" | "chat">("home");
const viewKey = `stillgotit-view:${props.course.course}`;
const sourceSelectionKey = `stillgotit-source:${props.course.course}`;
const draftSaves = new DraftSaveQueue(sessionStorage, `stillgotit-draft-saves:${props.course.course}`);
const pendingDraftCount = ref(0);
type CourseData = StillGotItHttp["/courses/read"]["output"];
type MaterialId = CourseData["materials"][number]["material"];
type Suggestion = { title: string; outcome: string; gate: string };
const data = ref<CourseData>({ materials: [], units: [], skills: [] });
const busy = ref(false), message = ref(""), error = ref(""), justConfirmed = ref<string | null>(null);
const notice = ref<HTMLElement | null>(null), setupError = ref<HTMLElement | null>(null);
// announcement names materials an import listing saved; it stays until the learner leaves Course materials or starts
// an action. importsShown is true while the library has an unfinished import or a listing error to show.
const announcement = ref(""), importsShown = ref(false);
// Start empty: typing into a prefilled name merges the two names.
const materialTitle = ref(""), chosenFiles = ref<File[]>([]), requestId = ref(crypto.randomUUID());
const material = ref<MaterialId | "">(""), selectedSkill = ref<string | null>(null), unit = ref(""), newUnit = ref("Matrix multiplication");
const suggestions = ref<Suggestion[]>([]), preview = ref<{ title: string; content: string; originals: { file: string; name: string; limitations: string[] }[] } | null>(null);
// Off until the server confirms it has a Gemini key.
const ai = ref<AIStatus>({ available: false, reason: "" });
const progress = ref<Record<string, number>>({}), revision = ref(0);
const treeSkills = computed(() => data.value.skills.map((skill) => ({ ...skill, mastery: progress.value[skill.skill] })));
const current = computed(() => data.value.skills.find((skill) => skill.skill === selectedSkill.value));
const confirmed = computed(() => data.value.skills.filter((skill) => skill.status === "CONFIRMED"));
const drafts = computed(() => data.value.skills.filter((skill) => skill.status === "DRAFT"));
// Why a disabled action is unavailable. Empty when the action is available.
const aiOff = computed(() => ai.value.available ? "" : ai.value.reason || "Checking whether the AI tutor is available…");
const suggestReason = computed(() => pendingDraftCount.value ? "Finish saving your skill drafts first." : aiOff.value);

function openSkill(skill: string) { selectedSkill.value = skill; view.value = "chat"; }
function openChat() { const skill = selectedSkill.value ?? confirmed.value[0]?.skill; if (skill) openSkill(skill); }
function showOnTree(skill: string) { selectedSkill.value = skill; view.value = "home"; }
watch([view, selectedSkill], () => sessionStorage.setItem(viewKey, JSON.stringify({ view: view.value, skill: selectedSkill.value })));
let viewRestored = false;
// Messages belong to the view where they happened. When the control that changed the view is hidden, focus the new view's heading.
watch(view, async () => {
  if (!viewRestored) return;
  error.value = ""; message.value = ""; justConfirmed.value = null; if (view.value !== "setup") announcement.value = "";
  await nextTick();
  const active = document.activeElement;
  if (!active || active === document.body || !active.getClientRects().length) {
    document.querySelector<HTMLElement>(view.value === "home" ? "#home-title" : view.value === "setup" ? "#setup-title" : ".lesson-view h1, .lesson-view h2")?.focus();
  }
});

async function task(work: () => Promise<void>) {
  const previous = focusedControl();
  busy.value = true; error.value = ""; message.value = ""; announcement.value = ""; justConfirmed.value = null;
  try { await work(); } catch (problem) { error.value = problem instanceof Error ? problem.message : "The request could not finish."; }
  finally {
    busy.value = false; await nextTick();
    restoreFocus(previous, () => error.value ? setupError.value : notice.value);
    // Feedback appears below the setup heading; bring it into view when the action was further down the page.
    if (view.value === "setup") (error.value ? setupError.value : notice.value)?.scrollIntoView({ block: "nearest" });
  }
}
async function refresh() {
  const result = unwrap(await api.courses.read({ course: props.course.course }));
  data.value = result;
  if (!material.value && result.materials.length) {
    const previous = sessionStorage.getItem(sourceSelectionKey);
    material.value = result.materials.find((source) => source.material === previous)?.material ?? result.materials[0]!.material;
    sessionStorage.setItem(sourceSelectionKey, material.value);
  }
  if (!unit.value && result.units.length) unit.value = result.units[0]!.unit;
  await refreshProgress();
}
async function refreshProgress() {
  const result = unwrap(await api.learning.progress({ course: props.course.course })).data;
  progress.value = Object.fromEntries(result.estimates.filter((item) => typeof item.estimate?.value === "number").map((item) => [item.skill, item.estimate!.value]));
  revision.value++;
}
// Lesson changes update the tree's shading in the background. This must not clear the message from the learner's last action.
function progressChanged() {
  refreshProgress().catch((problem) => { error.value = problem instanceof Error ? problem.message : "Your progress could not be refreshed. Reload the page to try again."; });
}
async function refreshAI() {
  try { ai.value = await aiStatus(); }
  catch { ai.value = { available: false, reason: "The app could not check the AI tutor. Reload the page to try again." }; }
}
function filesChanged(event: Event) {
  chosenFiles.value = Array.from((event.target as HTMLInputElement).files ?? []);
  requestId.value = crypto.randomUUID();
  if (chosenFiles.value.length === 1) materialTitle.value = chosenFiles.value[0]!.name.replace(/\.[^.]+$/, "");
}
function resetImport() { requestId.value = crypto.randomUUID(); }
const fileInput = ref<HTMLInputElement | null>(null), dragging = ref(false), adding = ref(false), showPreview = ref(false);
const materialName = computed(() => data.value.materials.find((source) => source.material === material.value)?.title ?? "this material");
// Topics are the course's units. Archived skills stay off the list.
const unitGroups = computed(() => data.value.units.map((item) => ({ ...item, skills: data.value.skills.filter((skill) => skill.unit === item.unit && (skill.status === "DRAFT" || skill.status === "CONFIRMED")) })).filter((group) => group.skills.length));
function selectMaterial(source: MaterialId) { material.value = source; preview.value = null; sessionStorage.setItem(sourceSelectionKey, source); }
function openMaterial(source: MaterialId) {
  if (material.value === source && showPreview.value) { showPreview.value = false; return; }
  selectMaterial(source); showPreview.value = true;
}
function suggestFrom(source: MaterialId) { material.value = source; suggest(); }
function removeFile(index: number) {
  chosenFiles.value.splice(index, 1);
  requestId.value = crypto.randomUUID();
  if (!chosenFiles.value.length && fileInput.value) fileInput.value.value = "";
}
function fileKind(name: string) { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE"; }
async function upload() {
  await task(async () => {
    const form = new FormData();
    form.set("course", props.course.course); form.set("title", materialTitle.value.trim()); form.set("requestId", requestId.value);
    for (const file of chosenFiles.value) form.append("files", file);
    const saved = await submitImport(form, resetImport);
    chosenFiles.value = []; materialTitle.value = ""; if (fileInput.value) fileInput.value.value = ""; adding.value = false;
    if (saved.material) { selectMaterial(saved.material); await refresh(); showPreview.value = true; }
    message.value = saved.message;
  });
}
/** An unfinished import was saved, or left the library's list: reload the course, then name the materials it saved. */
async function importReady(saved: MaterialId[]) {
  try { await refresh(); } catch (problem) { error.value = problem instanceof Error ? problem.message : "The course could not be reloaded. Reload the page to see your materials."; }
  if (saved.length) announcement.value = readyNotice(saved, data.value.materials);
}
async function suggest() {
  await task(async () => {
    const source = material.value;
    if (!source) throw new Error("Choose a study material first.");
    const result = unwrap(await api.courses.skills.suggest({ material: source })).suggestions;
    suggestions.value = result.skills; newUnit.value = result.unitTitle;
    message.value = "Review the outcomes and demonstration requirements. You can edit each suggestion.";
  });
}
async function saveDrafts() {
  await task(async () => {
    if (!draftSaves.read().length) {
      const source = material.value, accepted = structuredClone(suggestions.value.map((item) => ({ ...item })));
      if (!source) throw new Error("Choose learning material first.");
      if (!unit.value) unit.value = unwrap(await api.courses.units.add({ course: props.course.course, title: newUnit.value.trim() })).unit;
      draftSaves.start(accepted.map((item) => ({ ...item, unit: unit.value, material: source })));
      suggestions.value = [];
    }
    pendingDraftCount.value = draftSaves.read().length;
    try {
      await draftSaves.drain(async (input) => { unwrap(await api.courses.skills.propose(input)); });
    } finally {
      pendingDraftCount.value = draftSaves.read().length;
      await refresh();
    }
    message.value = "Drafts saved. Confirm the skills you want to study.";
  });
}
async function confirm(skill: string) {
  const title = drafts.value.find((draft) => draft.skill === skill)?.title;
  await task(async () => {
    unwrap(await api.courses.skills.confirm({ skill }));
    selectedSkill.value = skill; justConfirmed.value = skill;
    message.value = `Skill confirmed. ${title ? `“${title}” is` : "It is"} now a leaf on your tree.`;
    await refresh();
  });
}
onMounted(() => task(async () => {
  try { const saved = JSON.parse(sessionStorage.getItem(viewKey) ?? "null"); if (saved && ["home", "setup", "chat"].includes(saved.view)) { view.value = saved.view; selectedSkill.value = typeof saved.skill === "string" ? saved.skill : null; } } catch { /* Open Home if there is no saved view. */ }
  await nextTick(); viewRestored = true;
  pendingDraftCount.value = draftSaves.read().length; await refresh(); await refreshAI();
}));
</script>

<template>
  <section class="course-space" :aria-busy="busy">
    <nav class="workspace-nav" aria-label="Study views">
      <div class="view-tabs"><button :class="{ active: view !== 'chat' }" :aria-current="view !== 'chat' ? 'page' : undefined" @click="view = 'home'">Home</button><button :class="{ active: view === 'chat' }" :disabled="!confirmed.length" :aria-current="view === 'chat' ? 'page' : undefined" :aria-describedby="confirmed.length ? undefined : 'learn-reason'" @click="openChat">Learn</button><span v-if="!confirmed.length" id="learn-reason" class="hint reason nav-reason">Confirm a skill first</span></div>
      <div class="workspace-actions"><button :class="{ current: view === 'setup' }" @click="view = 'setup'">Course materials<span v-if="drafts.length || pendingDraftCount" class="count-badge">{{ drafts.length + pendingDraftCount }}</span></button></div>
    </nav>

    <p v-if="error && view !== 'setup'" class="error" role="alert">{{ error }}</p>
    <section v-show="view === 'home'" class="home-view">
      <header class="home-heading"><div class="home-title-block"><h1 id="home-title" tabindex="-1">Your skill tree</h1><p class="home-subtitle">Choose a skill. Grow your understanding.</p></div><div v-if="confirmed.length" class="home-count"><strong>{{ confirmed.length }}</strong><span>{{ confirmed.length === 1 ? 'skill' : 'skills' }} to grow</span></div></header>
      <div v-if="drafts.length || pendingDraftCount" class="draft-notice"><span><strong>{{ pendingDraftCount ? 'Some skill saves need to finish.' : `${drafts.length} draft ${drafts.length === 1 ? 'skill is' : 'skills are'} waiting.` }}</strong> {{ pendingDraftCount ? 'Retry them on the course page.' : 'Confirm them to add leaves to your tree.' }}</span><button class="small-button" @click="view = 'setup'">{{ pendingDraftCount ? 'Finish saving' : 'Confirm drafts' }}</button></div>
      <div class="home-canvas">
        <div class="tree-stage"><SkillTree :skills="treeSkills" :selected="selectedSkill" @select="selectedSkill = $event"><template #empty><button class="primary empty-import" @click="view = 'setup'">Import your first lesson</button></template></SkillTree></div>
        <aside class="home-sidebar">
          <section v-if="current?.status === 'CONFIRMED'" class="selected-skill"><h2>{{ current.title }}</h2><p>{{ current.outcome }}</p><div class="skill-estimate"><svg class="mastery-ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" class="ring-track"/><circle v-if="progress[current.skill] !== undefined" cx="32" cy="32" r="27" class="ring-value" :stroke-dasharray="`${(progress[current.skill]! * 1.6965).toFixed(1)} 169.65`"/></svg><strong>{{ progress[current.skill] === undefined ? '—' : Math.round(progress[current.skill]!) + '%' }}</strong><span>{{ progress[current.skill] === undefined ? 'No estimate yet' : 'Estimated mastery' }}</span></div><button class="primary open-lesson" @click="openSkill(current.skill)">Open lesson <span aria-hidden="true">›</span></button><details class="skill-gate"><summary>What counts as mastery?</summary><p>{{ current.gate }}</p></details></section>
          <section v-else class="select-invitation"><h2>{{ confirmed.length ? 'Where will you grow today?' : 'Start with what you’re learning.' }}</h2><p>{{ confirmed.length ? 'Select a leaf to see the skill and open a conversation with your tutor.' : 'Bring a lesson, notes, or a problem set. Review the skills before they become leaves on your tree.' }}</p></section>
          <details class="home-plan" open><summary>Today's plan</summary><StudyPlanner :course="course.course" :revision="revision" @select="openSkill" /></details>
        </aside>
      </div>
    </section>
    <section v-show="view === 'setup'" class="setup-view">
      <header class="setup-heading"><button class="back-home" @click="view = 'home'">← Back to your tree</button>
        <div class="setup-top"><div><h1 id="setup-title" tabindex="-1">Course materials</h1><p>The files your tutor teaches from, and the skills found in them.</p></div><button v-if="data.materials.length" class="add-material" :class="adding ? 'small-button' : 'primary'" :aria-expanded="adding" aria-controls="add-panel" @click="adding = !adding">{{ adding ? 'Close' : '+ Add material' }}</button></div>
        <p class="hint ai-notice">Your files and answers are stored on the class server and sent to Google Gemini to create lessons and feedback. Google keeps copies of large files and recordings for up to 48 hours. Don't upload anything private.</p></header>
      <div role="alert"><p v-if="error && view === 'setup'" ref="setupError" class="error" tabindex="-1">{{ error }}</p></div>
      <div role="status"><p v-if="message" ref="notice" class="notice" tabindex="-1">{{ message }} <button v-if="justConfirmed" class="quiet" @click="showOnTree(justConfirmed)">See it on your tree</button></p><p v-if="announcement" class="notice">{{ announcement }}</p></div>
      <div class="course-tools">
        <section v-if="adding || !data.materials.length" id="add-panel" class="add-panel">
          <h2>{{ data.materials.length ? 'Add material' : 'Add your first material' }}</h2>
          <form class="import-card" @submit.prevent="upload">
            <div class="dropzone" :class="{ dragging, chosen: chosenFiles.length }" @dragenter="dragging = true" @dragleave="dragging = false" @drop="dragging = false">
              <input id="lesson-files" ref="fileInput" type="file" multiple :disabled="busy" aria-describedby="file-types" @change="filesChanged" />
              <ul v-if="chosenFiles.length" class="file-cards">
                <li v-for="(file, index) in chosenFiles" :key="file.name + index" class="file-card"><span class="file-kind" aria-hidden="true">{{ fileKind(file.name) }}</span><span class="file-name">{{ file.name }}<small>{{ fileSize(file.size) }}</small></span><button type="button" class="file-remove" :disabled="busy" :aria-label="`Remove ${file.name}`" @click="removeFile(index)">×</button></li>
              </ul>
              <p v-else class="drop-title"><span aria-hidden="true">＋</span> Drop course files here, or <label for="lesson-files" class="drop-choose">choose files</label></p>
              <p id="file-types" class="hint">PDF (including scans), Word, PowerPoint, Excel, text, notebook, image (PNG, JPEG, WebP, HEIC, HEIF), audio, or video files. Up to 12 files and 95 MB in total. Recordings and videos can be up to 2 hours long.</p>
            </div>
            <label for="lesson-title">Material title</label><input id="lesson-title" v-model="materialTitle" maxlength="160" required placeholder="For example, Lecture 4 notes" :disabled="busy" @input="resetImport" />
            <div class="import-actions"><p v-if="!chosenFiles.length" id="import-reason" class="hint reason">Choose at least one file to import.</p><button class="primary" :disabled="busy || !chosenFiles.length" :aria-describedby="chosenFiles.length ? undefined : 'import-reason'">{{ busy ? 'Working…' : 'Import material' }}</button></div>
          </form>
        </section>
        <section v-show="data.materials.length || importsShown" class="library">
          <h2 tabindex="-1">Files <span class="count">{{ data.materials.length }}</span></h2>
          <MaterialImports :course="course.course" :active="view === 'setup'" :busy="busy" @shown="importsShown = $event" @ready="importReady" @removed="(id) => { if (id === requestId) resetImport(); }" />
          <ul v-if="data.materials.length" class="material-list">
            <li v-for="source in data.materials" :key="source.material" class="material-row">
              <div class="material-main"><span class="doc-icon" aria-hidden="true"><svg width="16" height="18" viewBox="0 0 16 18" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2 1.8h7.5L14 6.3v9.9H2z"/><path d="M9.5 1.8v4.5H14M5 10h6M5 13h4"/></svg></span>
                <div class="material-text"><strong>{{ source.title }}</strong><small>{{ material === source.material && showPreview && preview ? `${preview.originals.length} ${preview.originals.length === 1 ? 'file' : 'files'}` : 'Course material' }}</small></div>
                <div class="row-actions"><button class="quiet" :disabled="busy" :aria-expanded="material === source.material && showPreview" @click="openMaterial(source.material)">{{ material === source.material && showPreview ? 'Hide' : 'View' }}</button><button class="small-button" :disabled="busy || !!suggestReason" :aria-describedby="suggestReason ? 'suggest-reason' : undefined" @click="suggestFrom(source.material)">Find skills</button></div></div>
              <div v-if="material === source.material && showPreview" class="material-preview"><MaterialMedia :material="source.material" @loaded="preview = $event" /></div>
            </li>
          </ul>
          <p v-if="suggestReason && data.materials.length" id="suggest-reason" class="hint reason">{{ suggestReason }}</p>
        </section>
        <section v-if="suggestions.length" class="suggest-panel">
          <h2>Suggested skills from {{ materialName }}</h2><p class="hint">Edit these to match what your course expects, then save them as drafts.</p>
          <label>Unit<select v-model="unit" :disabled="busy"><option value="">Create a unit</option><option v-for="item in data.units" :key="item.unit" :value="item.unit">{{ item.title }}</option></select></label>
          <label v-if="!unit">New unit name<input v-model="newUnit" maxlength="160" :disabled="busy" /></label>
          <div v-for="(suggestion, index) in suggestions" :key="index" class="skill-draft">
            <label>Skill name<input v-model="suggestion.title" maxlength="160" :disabled="busy" /></label>
            <label>What you should be able to do<textarea v-model="suggestion.outcome" rows="2" :disabled="busy" /></label>
            <label>How you will demonstrate it<textarea v-model="suggestion.gate" rows="3" :disabled="busy" /></label>
            <button class="quiet" :disabled="busy" @click="suggestions.splice(index, 1)">Remove suggestion</button>
          </div>
          <button class="primary" :disabled="busy" @click="saveDrafts">Save skill drafts</button>
        </section>
        <section v-if="pendingDraftCount" class="section-block" aria-live="polite">
          <h2>Finish saving skills</h2>
          <p>{{ pendingDraftCount }} {{ pendingDraftCount === 1 ? 'save is' : 'saves are' }} waiting for confirmation. Retrying uses the original details and keeps any saved drafts.</p>
          <button class="primary" :disabled="busy" @click="saveDrafts">{{ busy ? 'Saving…' : 'Retry saving drafts' }}</button>
        </section>
        <section v-if="unitGroups.length" class="topics">
          <h2>Skills by topic</h2>
          <div v-for="group in unitGroups" :key="group.unit" class="topic">
            <p class="unit-label">{{ group.title }}</p>
            <ul class="skill-rows">
              <li v-for="skill in group.skills" :key="skill.skill" class="skill-row"><span class="status-dot" :class="{ draft: skill.status === 'DRAFT' }" aria-hidden="true"></span>
                <div class="skill-text"><strong>{{ skill.title }}</strong><small>{{ skill.outcome }}</small></div>
                <span class="status-tag">{{ skill.status === 'DRAFT' ? 'Draft' : progress[skill.skill] === undefined ? 'On your tree' : `${Math.round(progress[skill.skill]!)}% mastery` }}</span>
                <button v-if="skill.status === 'DRAFT'" class="small-button" :disabled="busy" @click="confirm(skill.skill)">Confirm</button><button v-else class="quiet" @click="openSkill(skill.skill)">Open</button></li>
            </ul>
          </div>
        </section>
      </div>
    </section>
    <div v-show="view === 'chat'" class="lesson-view">
      <KeepAlive :max="12"><SkillStudy v-if="current?.status === 'CONFIRMED'" :key="current.skill" :skill="current.skill" :course="course.course" :materials="data.materials" :ai-available="ai.available" :ai-reason="ai.reason" :active="view === 'chat'" @changed="progressChanged" /></KeepAlive>
      <div v-if="current?.status !== 'CONFIRMED'" class="no-lesson"><h2 tabindex="-1">Choose a leaf to begin.</h2><button class="primary" @click="view = 'home'">Go to your tree</button></div>
    </div>
  </section>
</template>

<style scoped>
.course-space{position:relative}.workspace-nav{height:54px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line)}.view-tabs{display:flex;align-items:stretch;gap:28px;height:100%}.view-tabs button{position:relative;background:none;border:0;padding:0 3px;color:var(--muted);font-size:14px}.view-tabs button.active{color:var(--ink);font-weight:600}.view-tabs button.active:after{content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;background:var(--primary)}.workspace-actions{display:flex;align-items:center;gap:24px}.workspace-actions>button{border:0;background:none;padding:8px 0;color:var(--muted);font-size:12px;display:flex;align-items:center;gap:7px}.workspace-actions .current{color:var(--ink)}.count-badge{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:10px;background:var(--light);font-size:10px}.home-heading{display:flex;justify-content:space-between;align-items:center;padding:38px 0 12px}.home-title-block{min-width:0}.course-context{font-size:12px;color:var(--muted);margin:0 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nav-reason{align-self:center;margin:0;font-size:11px}.home-heading h1{font:46px/1.15 Georgia,serif;letter-spacing:-1.5px;margin:0}.home-subtitle{font-size:14px;color:var(--muted);margin:10px 0 0}.home-count{display:flex;align-items:center;gap:12px}.home-count strong{font:40px Georgia,serif}.home-count span{font-size:12px;color:var(--muted);max-width:55px;line-height:1.4}.home-canvas{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:48px;align-items:start;padding-top:8px}.tree-stage{position:relative;padding:0 10px;min-width:0;display:flex;justify-content:center}.tree-stage>*{width:100%;max-width:620px}.home-sidebar{border-left:1px solid var(--line);padding-left:28px}.detail-caption{font-size:11px;color:var(--muted)}.selected-skill h2,.select-invitation h2{font:27px/1.25 Georgia,serif;letter-spacing:-.4px;margin:0 0 10px}.selected-skill p,.select-invitation p{font-size:13px;line-height:1.8;color:var(--muted)}.skill-estimate{position:relative;display:flex;align-items:center;gap:14px;margin:22px 0}.mastery-ring{width:64px;height:64px;transform:rotate(-90deg);flex:none}.ring-track{fill:none;stroke:var(--light);stroke-width:7}.ring-value{fill:none;stroke:var(--primary);stroke-width:7;stroke-linecap:round;transition:stroke-dasharray 600ms ease}.skill-estimate strong{position:absolute;left:0;width:64px;text-align:center;font:17px Georgia,serif}.skill-estimate span{font-size:13px;color:var(--muted)}.open-lesson{width:100%;display:flex;justify-content:space-between;align-items:center;min-height:44px;font-size:13px;padding:10px 16px;border-radius:8px}.skill-gate{margin-top:14px;font-size:13px;color:var(--muted)}.skill-gate>summary{padding:8px 10px;border-radius:10px}.skill-gate>summary:hover{background:var(--light);color:var(--ink)}.skill-gate p{padding:0 10px}.home-plan,.skill-index{margin-top:14px}.home-plan>summary,.skill-index>summary,.skill-gate>summary{list-style:none;display:flex;justify-content:space-between;align-items:center;cursor:pointer}.home-plan>summary,.skill-index>summary{padding:8px 10px;border-radius:10px;font-size:13px;font-weight:500;color:var(--muted)}.home-plan>summary::-webkit-details-marker,.skill-index>summary::-webkit-details-marker,.skill-gate>summary::-webkit-details-marker{display:none}.home-plan>summary::after,.skill-index>summary::after,.skill-gate>summary::after{content:"›";font-size:18px;line-height:1;color:var(--muted);transition:transform 150ms}.home-plan[open]>summary::after,.skill-index[open]>summary::after,.skill-gate[open]>summary::after{transform:rotate(90deg)}.home-plan>summary:hover,.skill-index>summary:hover{background:var(--light);color:var(--ink)}.home-plan :deep(.planner){border:0;margin:0;padding:4px 10px 8px}.home-plan :deep(.planner>h2),.home-plan :deep(.planner-subtitle){display:none}.skill-index button{display:block;width:100%;text-align:left;border:0;border-radius:10px;background:none;padding:8px 10px;font-size:14px;color:var(--ink)}.skill-index button:hover{background:var(--light)}.empty-import{display:block;margin:4px auto 8px;font-size:14px}.draft-notice{display:flex;justify-content:space-between;align-items:center;gap:15px;background:var(--surface);border:1px solid var(--line);border-left:5px solid var(--primary);border-radius:14px;padding:12px 12px 12px 18px;font-size:14px;margin:18px 0;box-shadow:0 1px 2px rgba(23,35,64,.05),0 8px 22px rgba(23,35,64,.06)}.draft-notice strong{font-weight:650}.setup-view{max-width:760px;margin:auto;padding-bottom:40px}.setup-heading{padding:30px 0 10px}.back-home{background:none;border:0;color:var(--muted);font-size:12px;padding:0;margin-bottom:25px}.setup-heading h1{font:44px/1.1 Georgia,serif;margin:0 0 12px;letter-spacing:-1.4px}.setup-heading p{font-size:14px;color:var(--muted)}.setup-heading .ai-notice{font-size:12px;color:var(--muted)}.no-lesson{padding:80px;text-align:center}.no-lesson h2{font:28px Georgia,serif}
.section-block{padding:25px 0;border-bottom:1px solid var(--line)}.section-block>summary{font-size:18px;font-weight:600;cursor:pointer;margin-bottom:16px}.section-block form{max-width:none}.section-block h2{font:25px Georgia,serif;margin:0 0 10px}.section-block h3{font-size:16px}.course-tools label{margin:14px 0 7px;font-size:12px}.course-tools input[type=file]{padding:12px 0;border:0;font-size:13px}select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--field);border-radius:7px;background:var(--surface);color:var(--ink)}textarea{resize:vertical}.inline-actions{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:15px}.skill-draft{padding:22px 0;border-top:1px solid var(--line);margin-top:18px}.skill-draft p{font-size:13px;color:var(--muted)}.gate{white-space:pre-wrap}.source-preview{margin-top:20px}.source-preview summary{font-size:12px;cursor:pointer}.source-preview pre{max-height:240px;overflow:auto;white-space:pre-wrap;font-size:12px;background:var(--wash);padding:15px}.source-file{margin:12px 0}
.setup-top{display:flex;justify-content:space-between;align-items:flex-end;gap:20px}.course-tools .add-material,.setup-top .add-material{min-height:40px;padding:8px 16px;font-size:14px;white-space:nowrap;margin-bottom:14px}.library,.topics,.add-panel,.suggest-panel{margin-top:26px}.library h2,.topics h2,.add-panel h2,.suggest-panel h2{font:22px Georgia,serif;margin:0 0 10px;display:flex;align-items:center;gap:10px}.count{font:600 12px/1 "Avenir Next","Nunito Sans",sans-serif;background:var(--light);color:var(--primary);border-radius:10px;padding:4px 8px}
.material-list,.skill-rows{list-style:none;margin:0;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden}.material-row+.material-row,.skill-row+.skill-row{border-top:1px solid var(--line)}.material-main,.skill-row{display:flex;align-items:center;gap:12px;padding:12px 14px;flex-wrap:wrap}.material-main:hover,.skill-row:hover{background:var(--wash)}.doc-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:var(--light);color:var(--primary);flex:none}.material-text,.skill-text{flex:1;min-width:140px}.material-text strong,.skill-text strong{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.material-text small,.skill-text small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-actions{display:flex;align-items:center;gap:12px;flex:none}.course-tools .small-button{padding:6px 12px;font-size:13px}
.material-preview{padding:2px 14px 14px 62px}.unit-label{font-size:12px;font-weight:600;color:var(--muted);margin:14px 0 6px}.status-dot{width:10px;height:10px;border-radius:50%;flex:none;background:var(--success)}.status-dot.draft{background:transparent;border:2px solid var(--accent)}.status-tag{font-size:12px;color:var(--muted);white-space:nowrap}.suggest-panel{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:18px}
.course-tools{position:relative;counter-reset:step}.course-tools form.import-card{max-width:none}.step{position:relative;padding-left:58px;border-bottom:0}.step::before{counter-increment:step;content:counter(step);position:absolute;left:0;top:22px;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:var(--primary);color:#fff;font:17px Georgia,serif;box-shadow:0 3px 0 var(--edge);z-index:1}.step.done::before{content:"✓";font-family:inherit;background:var(--success);box-shadow:0 3px 0 #145235}.step:not(:last-child)::after{content:"";position:absolute;left:17px;top:60px;bottom:-24px;width:2px;background:var(--light)}
.step>summary,.step>h2{font:25px/1.3 Georgia,serif;font-weight:400;margin:0 0 6px;min-height:36px;display:flex;align-items:center;gap:10px}.step>summary{list-style:none}.step>summary::-webkit-details-marker{display:none}.step>summary::after{content:"›";color:var(--primary);font-size:28px;line-height:1;transition:transform 120ms}.step[open]>summary::after{transform:rotate(90deg)}.step>.hint{margin:0 0 14px}
.import-card{margin-top:4px;background:var(--surface);border:1px solid var(--line);border-radius:22px;padding:16px;box-shadow:0 1px 2px rgba(23,35,64,.05),0 10px 30px rgba(23,35,64,.07)}.dropzone{position:relative;border:2px dashed var(--accent);border-radius:16px;background:var(--wash);padding:28px 18px;text-align:center;transition:background-color 120ms}.dropzone input{position:absolute;inset:0;width:100%;height:100%;min-height:0;opacity:0;cursor:pointer;padding:0;border:0}.dropzone:hover,.dropzone.dragging{background:var(--light)}.dropzone:focus-within{outline:3px solid var(--primary);outline-offset:3px}.dropzone.chosen{border:1px solid var(--line);background:var(--surface);text-align:left;padding:12px}
.drop-title{margin:0 0 6px;font-size:16px;font-weight:600;color:var(--ink)}.dropzone .drop-choose{display:inline;margin:0;font:inherit;color:var(--primary);text-decoration:underline;text-underline-offset:3px}.dropzone .hint{margin:0}.file-cards{list-style:none;margin:0 0 10px;padding:0;display:flex;flex-wrap:wrap;gap:10px;position:relative;z-index:2;pointer-events:none}.file-card{display:flex;align-items:center;gap:10px;padding:8px;border:1px solid var(--line);border-radius:12px;background:var(--surface);max-width:100%;pointer-events:auto}.file-kind{display:grid;place-items:center;width:38px;height:38px;border-radius:9px;background:var(--primary);color:#fff;font-size:10px;font-weight:700;flex:none}.file-name{display:flex;flex-direction:column;min-width:0;font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.file-name small{font-weight:400;color:var(--muted)}.file-remove{border:0;background:var(--wash);border-radius:50%;width:28px;height:28px;padding:0;font-size:17px;line-height:1;color:var(--ink);flex:none}.file-remove:hover:not(:disabled){background:var(--light)}
.library>h2{scroll-margin-top:16px}
.course-tools .import-card label{margin:16px 0 7px;font-size:13px}.import-actions{display:flex;align-items:center;justify-content:flex-end;gap:16px;margin-top:14px}.import-actions .hint{margin:0;flex:1}.course-tools form.import-card .primary{margin:0}
@media(max-width:900px){.home-canvas{grid-template-columns:minmax(0,1fr) 245px;gap:20px}.home-sidebar{padding-left:20px}.home-heading h1{font-size:38px}}
@media(max-width:650px){.setup-top{flex-direction:column;align-items:stretch}.material-preview{padding-left:14px}.step{padding-left:48px}.step::before{width:32px;height:32px;top:24px}.step:not(:last-child)::after{left:15px}.step>summary,.step>h2{font-size:22px}.import-card{padding:12px;border-radius:18px}.workspace-actions{gap:12px}.workspace-actions>button{font-size:11px}.view-tabs{gap:20px}.home-heading{padding-top:28px}.home-heading h1{font-size:34px}.home-count{display:none}.home-canvas{grid-template-columns:1fr;gap:0;min-height:0}.home-sidebar{border-left:0;border-top:1px solid var(--light);padding:25px 0}.tree-stage{padding:0}.home-heading .home-subtitle{font-size:12px}.setup-heading h1{font-size:31px}.no-lesson{padding:50px 10px}.workspace-nav{height:48px}.nav-reason{max-width:80px;line-height:1.25}.view-tabs button{font-size:13px}}
</style>
