<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { api, unwrap, errorMessage, type Course } from "./api.ts";
import { hostRequest, uploadMaterial } from "./host-api.ts";
import { DraftSaveQueue } from "./draft-save-queue.ts";
import SkillTree from "./SkillTree.vue";
import SkillStudy from "./SkillStudy.vue";
import StudyPlanner from "./StudyPlanner.vue";
import type { StillGotItHttp } from "../../generated/wire.ts";
import type { ModelChoice } from "../../src/host/chatgpt.ts";

const props = defineProps<{ course: Course }>();
const view = ref<"home" | "setup" | "chat">("home"), showSettings = ref(false);
const viewKey = `stillgotit-view:${props.course.course}`;
const sourceSelectionKey = `stillgotit-source:${props.course.course}`;
const draftSaves = new DraftSaveQueue(sessionStorage, `stillgotit-draft-saves:${props.course.course}`);
const pendingDraftCount = ref(0);
type CourseData = StillGotItHttp["/courses/read"]["output"];
type MaterialId = CourseData["materials"][number]["material"];
type Suggestion = { title: string; outcome: string; gate: string };
type AIStatus = { connected: boolean; active: string | null; model: string; effort: string; accounts: { id: string; label: string; connected: boolean }[] };
const data = ref<CourseData>({ materials: [], units: [], skills: [] });
const busy = ref(false), message = ref(""), error = ref("");
const materialTitle = ref("Matrix multiplication"), chosenFiles = ref<File[]>([]), requestId = ref(crypto.randomUUID());
const material = ref<MaterialId | "">(""), selectedSkill = ref<string | null>(null), unit = ref(""), newUnit = ref("Matrix multiplication");
const suggestions = ref<Suggestion[]>([]), preview = ref<{ title: string; content: string; originals: { file: string; name: string; limitations: string[] }[] } | null>(null);
const ai = ref<AIStatus>({ connected: false, active: null, model: "", effort: "", accounts: [] });
const models = ref<ModelChoice[]>([]), model = ref(""), effort = ref("");
const selectedModel = computed(() => models.value.find((choice) => choice.slug === model.value));
const efforts = computed(() => selectedModel.value?.supported_reasoning_levels ?? []);
const effortDescription = computed(() => efforts.value.find((level) => level.effort === effort.value)?.description ?? "");
const effortLabel = (value: string) => value === "xhigh" ? "Extra high" : value === "max" ? "Maximum" : value.charAt(0).toUpperCase() + value.slice(1);
const progress = ref<Record<string, number>>({}), revision = ref(0);
const treeSkills = computed(() => data.value.skills.map((skill) => ({ ...skill, mastery: progress.value[skill.skill] })));
const current = computed(() => data.value.skills.find((skill) => skill.skill === selectedSkill.value));
const confirmed = computed(() => data.value.skills.filter((skill) => skill.status === "CONFIRMED"));
const drafts = computed(() => data.value.skills.filter((skill) => skill.status === "DRAFT"));

function openSkill(skill: string) { selectedSkill.value = skill; view.value = "chat"; }
function openChat() { const skill = selectedSkill.value ?? confirmed.value[0]?.skill; if (skill) openSkill(skill); }
watch([view, selectedSkill], () => sessionStorage.setItem(viewKey, JSON.stringify({ view: view.value, skill: selectedSkill.value })));

async function task(work: () => Promise<void>) {
  busy.value = true; error.value = ""; message.value = "";
  try { await work(); } catch (problem) { error.value = problem instanceof Error ? problem.message : "The request could not finish."; }
  finally { busy.value = false; }
}
async function refresh() {
  const result = await api.courses.read({ course: props.course.course });
  if ("error" in result) throw new Error(errorMessage(result.error));
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
async function refreshAI() {
  ai.value = await hostRequest<AIStatus>("/ai/status");
  if (ai.value.connected) {
    models.value = (await hostRequest<{ models: typeof models.value }>("/ai/models")).models;
    model.value = ai.value.model || models.value[0]?.slug || "";
    effort.value = efforts.value.find((level) => level.effort === ai.value.effort)?.effort ?? selectedModel.value?.default_reasoning_level ?? "";
  } else {
    models.value = []; model.value = ""; effort.value = "";
  }
}
async function saveModel() {
  await task(async () => {
    const validEffort = efforts.value.find((level) => level.effort === effort.value)?.effort ?? selectedModel.value?.default_reasoning_level ?? "";
    try {
      ai.value = await hostRequest<AIStatus>("/ai/model", { model: model.value, effort: validEffort });
      model.value = ai.value.model; effort.value = ai.value.effort;
      message.value = "Tutor settings saved. They apply to your next request.";
    } catch (problem) {
      await refreshAI();
      throw problem;
    }
  });
}
async function connect(clientId?: string) {
  await task(async () => {
    const result = await hostRequest<{ address: string }>("/ai/connect/start", clientId ? { clientId } : {});
    window.location.assign(result.address);
  });
}
function filesChanged(event: Event) {
  chosenFiles.value = Array.from((event.target as HTMLInputElement).files ?? []);
  requestId.value = crypto.randomUUID();
  if (chosenFiles.value.length === 1) materialTitle.value = chosenFiles.value[0]!.name.replace(/\.[^.]+$/, "");
}
function resetImport() { requestId.value = crypto.randomUUID(); }
async function upload() {
  await task(async () => {
    const form = new FormData();
    form.set("course", props.course.course); form.set("title", materialTitle.value.trim()); form.set("requestId", requestId.value);
    for (const file of chosenFiles.value) form.append("files", file);
    const saved = await uploadMaterial(form);
    material.value = saved.material; await refresh(); await readMaterial();
    message.value = "Material saved. Check the readable content, then suggest skills.";
  });
}
async function readMaterial() {
  if (!material.value) return;
  sessionStorage.setItem(sourceSelectionKey, material.value);
  const result = await api.courses.materials.read({ material: material.value });
  if ("error" in result) throw new Error(errorMessage(result.error));
  preview.value = result;
}
async function download(file: string, name: string) {
  await task(async () => {
    const response = await fetch("/api/courses/materials/file", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: material.value, file }) });
    if (!response.ok) throw new Error("That file could not be opened.");
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
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
      if (!unit.value) {
        const added = await api.courses.units.add({ course: props.course.course, title: newUnit.value.trim() });
        if ("error" in added) throw new Error(errorMessage(added.error));
        unit.value = added.unit;
      }
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
  await task(async () => {
    const result = await api.courses.skills.confirm({ skill });
    if ("error" in result) throw new Error(errorMessage(result.error));
    await refresh(); selectedSkill.value = skill; message.value = "Skill confirmed.";
  });
}
async function changeAccount(event: Event) {
  await task(async () => { await hostRequest("/ai/account", { clientId: (event.target as HTMLSelectElement).value }); await refreshAI(); });
}
onMounted(() => task(async () => {
  try { const saved = JSON.parse(sessionStorage.getItem(viewKey) ?? "null"); if (saved && ["home", "setup", "chat"].includes(saved.view)) { view.value = saved.view; selectedSkill.value = typeof saved.skill === "string" ? saved.skill : null; } } catch { /* Open Home if there is no saved view. */ }
  pendingDraftCount.value = draftSaves.read().length; await refresh(); await refreshAI();
  if (!ai.value.connected) showSettings.value = true;
}));
</script>

<template>
  <section class="course-space" :aria-busy="busy">
    <nav class="workspace-nav" aria-label="Study views">
      <div class="view-tabs"><button :class="{ active: view !== 'chat' }" :aria-current="view !== 'chat' ? 'page' : undefined" @click="view = 'home'">Home</button><button :class="{ active: view === 'chat' }" :disabled="!confirmed.length" :aria-current="view === 'chat' ? 'page' : undefined" @click="openChat">Learn</button></div>
      <div class="workspace-actions"><button :class="{ current: view === 'setup' }" @click="view = 'setup'">Course materials<span v-if="drafts.length || pendingDraftCount" class="count-badge">{{ drafts.length + pendingDraftCount }}</span></button><button @click="showSettings = !showSettings"><span class="connection-dot" :class="{ connected: ai.connected }" aria-hidden="true"></span>{{ ai.connected ? 'Tutor settings' : 'Connect tutor' }}</button></div>
    </nav>
    <details v-if="showSettings" class="ai-settings" open>
      <summary>{{ ai.connected ? 'Tutor settings' : 'Connect your AI tutor' }}</summary><button class="close-settings" aria-label="Close tutor settings" @click="showSettings = false">×</button>
      <p v-if="!ai.connected">Use your ChatGPT plan for explanations and feedback. Your course stays with your Commons account.</p>
      <div class="connection-controls">
        <template v-if="ai.connected">
          <label>ChatGPT account<select :value="ai.active" :disabled="busy" @change="changeAccount"><option v-for="account in ai.accounts.filter(a => a.connected)" :key="account.id" :value="account.id">{{ account.label }}</option></select></label>
          <label>Model<select v-model="model" :disabled="busy" @change="saveModel"><option v-for="choice in models" :key="choice.slug" :value="choice.slug">{{ choice.display_name }}</option></select></label>
          <label>Reasoning effort<select v-model="effort" :disabled="busy || !efforts.length" aria-describedby="effort-description" @change="saveModel"><option v-if="!efforts.length" value="">Model default</option><option v-for="level in efforts" :key="level.effort" :value="level.effort">{{ effortLabel(level.effort) }}</option></select></label>
          <button class="quiet" :disabled="busy" @click="task(async () => { const result = await hostRequest<{ revoked: boolean }>('/ai/disconnect'); await refreshAI(); message = result.revoked ? 'ChatGPT disconnected.' : 'Disconnected locally. You can remove access in ChatGPT Settings.'; })">Disconnect</button>
        </template>
        <button class="primary" :disabled="busy" @click="connect()">Continue with ChatGPT</button>
        <button v-for="account in ai.accounts.filter(a => !a.connected)" :key="account.id" class="quiet" :disabled="busy" @click="connect(account.id)">Reconnect {{ account.label }}</button>
        <a v-if="ai.connected" href="https://chatgpt.com/settings/usage" target="_blank" rel="noreferrer">View plan usage</a>
      </div>
      <p v-if="ai.connected" id="effort-description" class="hint">{{ effortDescription || 'This model uses its default effort.' }} Higher effort can take longer and use more of your plan. Applies to your next request.</p>
    </details>

    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <section v-show="view === 'home'" class="home-view">
      <header class="home-heading"><div><p class="course-context">{{ course.title }}</p><h1 id="home-title">Your skill tree</h1><p class="home-subtitle">Choose a skill. Grow your understanding.</p></div><div class="home-count"><strong>{{ confirmed.length }}</strong><span>{{ confirmed.length === 1 ? 'skill' : 'skills' }} to grow</span></div></header>
      <div v-if="drafts.length || pendingDraftCount" class="draft-notice"><span>{{ pendingDraftCount ? 'Some skill saves need to be completed.' : 'You have skills ready to review.' }}</span><button @click="view = 'setup'">Review skills</button></div>
      <div class="home-canvas">
        <div class="tree-stage"><SkillTree :skills="treeSkills" :selected="selectedSkill" @select="selectedSkill = $event" /><button v-if="!confirmed.length" class="primary empty-import" @click="view = 'setup'">Import your first lesson</button></div>
        <aside class="home-sidebar">
          <section v-if="current?.status === 'CONFIRMED'" class="selected-skill"><span class="detail-caption">Selected skill</span><h2>{{ current.title }}</h2><p>{{ current.outcome }}</p><div class="skill-estimate"><strong>{{ progress[current.skill] === undefined ? '—' : Math.round(progress[current.skill]!) + '%' }}</strong><span>{{ progress[current.skill] === undefined ? 'No estimate yet' : 'Estimated mastery' }}</span></div><button class="primary open-lesson" @click="openSkill(current.skill)">Open lesson <span aria-hidden="true">↗</span></button><details class="skill-gate"><summary>What counts as mastery?</summary><p>{{ current.gate }}</p></details></section>
          <section v-else class="select-invitation"><span class="detail-caption">A little progress, often.</span><h2>{{ confirmed.length ? 'Where will you grow today?' : 'Start with what you’re learning.' }}</h2><p>{{ confirmed.length ? 'Select a leaf to see the skill and open a conversation with your tutor.' : 'Bring a lesson, notes, or a problem set. Review the skills before they become leaves on your tree.' }}</p></section>
          <details class="home-plan"><summary>Your study plan</summary><StudyPlanner :course="course.course" :revision="revision" @select="openSkill" /></details>
          <details v-if="confirmed.length" class="skill-index"><summary>All skills</summary><button v-for="skill in confirmed" :key="skill.skill" @click="selectedSkill = skill.skill">{{ skill.title }}</button></details>
        </aside>
      </div>
    </section>
    <section v-show="view === 'setup'" class="setup-view">
      <header class="setup-heading"><button class="back-home" @click="view = 'home'">← Back to your tree</button><h1 id="setup-title">Shape your course</h1><p>Bring your material, then choose the skills you want to build.</p></header>
      <p v-if="message" class="notice" role="status">{{ message }}</p>
      <div class="course-tools">
        <details :open="!data.materials.length" class="section-block">
          <summary>Add learning material</summary>
          <form @submit.prevent="upload">
            <label for="lesson-title">Material title</label><input id="lesson-title" v-model="materialTitle" maxlength="160" required :disabled="busy" @input="resetImport" />
            <label for="lesson-files">Course files</label><input id="lesson-files" type="file" multiple :disabled="busy" @change="filesChanged" />
            <p class="hint">Documents, PDFs, slides, sheets, text, images, audio, or ZIP files. Up to 25 MB total.</p>
            <button class="primary" :disabled="busy || !chosenFiles.length">{{ busy ? 'Working…' : 'Import material' }}</button>
          </form>
        </details>
        <section v-if="data.materials.length" class="section-block">
          <label for="source">Study material</label><select id="source" v-model="material" :disabled="busy" @change="task(readMaterial)"><option v-for="source in data.materials" :key="source.material" :value="source.material">{{ source.title }}</option></select>
          <div class="inline-actions"><button class="quiet" :disabled="busy" @click="task(readMaterial)">Inspect source</button><button class="primary" :disabled="busy || !ai.connected || pendingDraftCount > 0" @click="suggest">{{ busy ? 'Working…' : 'Suggest skills' }}</button></div>
          <details v-if="preview" class="source-preview"><summary>Readable content and originals</summary>
            <div v-for="file in preview.originals" :key="file.file" class="source-file"><button class="quiet" :disabled="busy" @click="download(file.file, file.name)">{{ file.name }}</button><p v-for="limit in file.limitations" :key="limit" class="hint">{{ limit }}</p></div>
            <pre>{{ preview.content || 'This source is available as readable images.' }}</pre>
          </details>
        </section>
        <section v-if="suggestions.length" class="section-block">
          <h2>Review suggested skills</h2><p class="hint">Edit these to match what your course expects.</p>
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
        <section v-if="drafts.length" class="section-block"><h2>Draft skills</h2>
          <article v-for="draft in drafts" :key="draft.skill" class="skill-draft"><h3>{{ draft.title }}</h3><p>{{ draft.outcome }}</p><p class="gate">{{ draft.gate }}</p><button class="primary" :disabled="busy" @click="confirm(draft.skill)">Confirm skill</button></article>
        </section>

      </div>
    </section>
    <div v-show="view === 'chat'" class="lesson-view">
      <KeepAlive :max="12"><SkillStudy v-if="current?.status === 'CONFIRMED'" :key="current.skill" :skill="current.skill" :course="course.course" :connected="ai.connected" :active="view === 'chat'" @changed="task(refreshProgress)"><template #composer-settings><select v-if="ai.connected && efforts.length" v-model="effort" class="composer-effort" aria-label="Reasoning effort" :disabled="busy" @change="saveModel"><option v-for="level in efforts" :key="level.effort" :value="level.effort">{{ effortLabel(level.effort) }}</option></select></template></SkillStudy></KeepAlive>
      <div v-if="current?.status !== 'CONFIRMED'" class="no-lesson"><h2>Choose a leaf to begin.</h2><button class="primary" @click="view = 'home'">Go to your tree</button></div>
    </div>
  </section>
</template>

<style scoped>
.composer-effort{width:auto;max-width:125px;border:0;background:transparent;color:#777;font-size:12px;padding:4px 20px 4px 5px;cursor:pointer}.course-space{position:relative}.workspace-nav{height:54px;display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid #e6e6e6}.view-tabs{display:flex;align-items:stretch;gap:28px;height:100%}.view-tabs button{position:relative;background:none;border:0;padding:0 3px;color:#888;font-size:14px}.view-tabs button.active{color:#181818;font-weight:600}.view-tabs button.active:after{content:"";position:absolute;bottom:-1px;left:0;right:0;height:2px;background:#222}.workspace-actions{display:flex;align-items:center;gap:24px}.workspace-actions>button{border:0;background:none;padding:8px 0;color:#666;font-size:12px;display:flex;align-items:center;gap:7px}.workspace-actions .current{color:#111}.connection-dot{width:6px;height:6px;border:1px solid #aaa;border-radius:50%}.connection-dot.connected{background:#444;border-color:#444}.count-badge{display:inline-grid;place-items:center;min-width:18px;height:18px;border-radius:10px;background:#eee;font-size:10px}.home-heading{display:flex;justify-content:space-between;align-items:center;padding:38px 0 12px}.course-context{font-size:12px;color:#777;margin:0 0 10px}.home-heading h1{font:46px/1.15 Georgia,serif;letter-spacing:-1.5px;margin:0}.home-subtitle{font-size:14px;color:#888;margin:10px 0 0}.home-count{display:flex;align-items:center;gap:12px}.home-count strong{font:40px Georgia,serif}.home-count span{font-size:12px;color:#888;max-width:55px;line-height:1.4}.home-canvas{display:grid;grid-template-columns:minmax(0,1fr) 286px;gap:48px;align-items:center;min-height:540px}.tree-stage{position:relative;padding:0 10px;min-width:0}.home-sidebar{border-left:1px solid #e9e9e9;padding-left:28px}.detail-caption{font-size:11px;color:#999}.selected-skill h2,.select-invitation h2{font:25px/1.3 Georgia,serif;letter-spacing:-.4px;margin:13px 0}.selected-skill p,.select-invitation p{font-size:13px;line-height:1.8;color:#777}.skill-estimate{display:flex;align-items:baseline;gap:10px;margin:24px 0}.skill-estimate strong{font:30px Georgia,serif}.skill-estimate span{font-size:11px;color:#999}.open-lesson{width:100%;display:flex;justify-content:space-between;align-items:center;min-height:44px;font-size:13px;padding:10px 16px;border-radius:8px}.skill-gate{margin-top:16px;font-size:11px;color:#777}.home-plan,.skill-index{border-top:1px solid #e3e3e3;padding-top:19px;margin-top:24px}.home-plan>summary,.skill-index>summary{font-size:13px;cursor:pointer}.home-plan :deep(.planner){border:0;margin:0;padding-top:18px}.home-plan :deep(.planner>h2),.home-plan :deep(.planner>p.hint){display:none}.skill-index button{display:block;width:100%;text-align:left;border:0;background:none;padding:10px 0;font-size:12px;color:#777}.empty-import{display:block;margin:0 auto 25px;font-size:13px}.draft-notice{display:flex;justify-content:space-between;gap:15px;background:#f5f5f5;border-radius:7px;padding:12px 16px;font-size:12px;margin:18px 0}.draft-notice button{border:0;background:none;font-size:12px;text-decoration:underline}.setup-view{max-width:760px;margin:auto;padding-bottom:40px}.setup-heading{padding:30px 0 10px}.back-home{background:none;border:0;color:#888;font-size:12px;padding:0;margin-bottom:25px}.setup-heading h1{font:38px Georgia,serif;margin:0 0 12px;letter-spacing:-1px}.setup-heading p{font-size:14px;color:#888}.ai-settings{position:absolute;z-index:20;right:0;top:58px;width:min(660px,100%);padding:24px;background:#fff;border:1px solid #ddd;border-radius:12px;box-shadow:0 12px 40px #00000013}.ai-settings summary{pointer-events:none;list-style:none;font-size:16px;font-weight:600}.close-settings{position:absolute;right:18px;top:16px;border:0;background:none;font-size:24px;color:#777}.connection-controls{display:flex;flex-wrap:wrap;gap:14px;align-items:end;margin-top:12px}.connection-controls label{flex:1;min-width:160px;font-size:12px}.connection-controls a{font-size:12px;color:#666}.ai-settings .hint{font-size:11px}.no-lesson{padding:80px;text-align:center}.no-lesson h2{font:28px Georgia,serif}
.section-block{padding:25px 0;border-bottom:1px solid #e6e6e6}.section-block>summary{font-size:18px;font-weight:600;cursor:pointer;margin-bottom:16px}.section-block form{max-width:none}.section-block h2{font:25px Georgia,serif;margin:0 0 10px}.section-block h3{font-size:16px}.course-tools label{margin:14px 0 7px;font-size:12px}.course-tools input[type=file]{padding:12px 0;border:0;font-size:13px}select,textarea{width:100%;font:inherit;padding:10px 12px;border:1px solid #ccc;border-radius:7px;background:white;color:#181818}textarea{resize:vertical}.inline-actions{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-top:15px}.skill-draft{padding:22px 0;border-top:1px solid #e4e4e4;margin-top:18px}.skill-draft p{font-size:13px;color:#777}.gate{white-space:pre-wrap}.source-preview{margin-top:20px}.source-preview summary{font-size:12px;cursor:pointer}.source-preview pre{max-height:240px;overflow:auto;white-space:pre-wrap;font-size:12px;background:#f7f7f7;padding:15px}.source-file{margin:12px 0}
@media(max-width:900px){.home-canvas{grid-template-columns:minmax(0,1fr) 245px;gap:20px}.home-sidebar{padding-left:20px}.home-heading h1{font-size:38px}}
@media(max-width:650px){.workspace-actions{gap:12px}.workspace-actions>button{font-size:11px}.view-tabs{gap:20px}.home-heading{padding-top:28px}.home-heading h1{font-size:34px}.home-count{display:none}.home-canvas{grid-template-columns:1fr;gap:0;min-height:0}.home-sidebar{border-left:0;border-top:1px solid #eee;padding:25px 0}.tree-stage{padding:0}.home-heading .home-subtitle{font-size:12px}.setup-heading h1{font-size:31px}.ai-settings{position:fixed;top:125px;left:16px;right:16px;width:auto;max-height:70vh;overflow:auto}.no-lesson{padding:50px 10px}.workspace-nav{height:48px}.view-tabs button{font-size:13px}}
</style>
