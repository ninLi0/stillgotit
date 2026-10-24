<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { api, unwrap, type Course } from "./api.ts";
import { aiStatus, uploadMaterial, type AIStatus } from "./host-api.ts";
import { DraftSaveQueue } from "./draft-save-queue.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import SkillTree from "./SkillTree.vue";
import SkillStudy from "./SkillStudy.vue";
import StudyPlanner from "./StudyPlanner.vue";
import ManageSkills from "./ManageSkills.vue";
import GradedImport from "./GradedImport.vue";
import type { StillGotItHttp } from "../../generated/wire.ts";
import { takeTutor, tutorLabel, type TutorUsed } from "./tutor-choice.ts";
import ShellSidebar from "./ShellSidebar.vue";
import HomeScene from "./HomeScene.vue";
import PixelIcon from "./PixelIcon.vue";
import MasteryCells from "./MasteryCells.vue";
import InfoBubble from "./InfoBubble.vue";
import ForestView from "./ForestView.vue";
import MaterialViewer from "./MaterialViewer.vue";
import { useHomePlan } from "./HomePlan.ts";
import { docIcon, stageOf } from "./pixel-art.ts";
import type { AskAboutPage, HomeView, OpenSource, ViewerSkill, ViewSkill, ViewUnit } from "./revamp-types.ts";

// The shell (sidebar + app card) lives here because the views do; App.vue fills the course switcher slot and owns
// Settings, the tutor panel and the Home view preference.
const props = defineProps<{ course: Course; username: string; tutorChoice: string; homeView: HomeView }>();
const emit = defineEmits<{ settings: []; tutor: []; "update:homeView": [view: HomeView] }>();
const view = ref<"home" | "setup" | "chat" | "plan">("home");
const viewKey = `stillgotit-view:${props.course.course}`;
const sourceSelectionKey = `stillgotit-source:${props.course.course}`;
const draftSaves = new DraftSaveQueue(sessionStorage, `stillgotit-draft-saves:${props.course.course}`);
const pendingDraftCount = ref(0);
type CourseData = StillGotItHttp["/courses/read"]["output"];
type MaterialId = CourseData["materials"][number]["material"];
type Suggestion = { title: string; outcome: string; gate: string };
type Original = { file: string; name: string; mediaType?: string; limitations: string[] };
const data = ref<CourseData>({ materials: [], units: [], skills: [], prerequisites: [], skillSources: [], versions: [] });
const busy = ref(false), message = ref(""), error = ref(""), justConfirmed = ref<string | null>(null);
const notice = ref<HTMLElement | null>(null), setupError = ref<HTMLElement | null>(null);
// Start empty: typing into a prefilled name merges the two names.
const materialTitle = ref(""), chosenFiles = ref<File[]>([]), requestId = ref(crypto.randomUUID());
const material = ref<MaterialId | "">(""), selectedSkill = ref<string | null>(null), unit = ref(""), newUnit = ref("Matrix multiplication");
const suggestions = ref<Suggestion[]>([]), preview = ref<{ title: string; content: string; originals: Original[] } | null>(null);
// The material the current suggestions came from. Choosing another file in the list must not move them to that file.
const suggestionSource = ref<MaterialId | "">("");
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
// New suggestions show the model and thinking level that wrote them.
const suggestedBy = ref<TutorUsed | null>(null);
watch(suggestions, () => { suggestedBy.value = takeTutor(); }, { flush: "sync" });

function openSkill(skill: string) { forestOpen.value = false; selectedSkill.value = skill; view.value = "chat"; }
function openChat() { const skill = selectedSkill.value ?? confirmed.value[0]?.skill; if (skill) openSkill(skill); }
function showOnTree(skill: string) { selectedSkill.value = skill; view.value = "home"; }
watch([view, selectedSkill], () => sessionStorage.setItem(viewKey, JSON.stringify({ view: view.value, skill: selectedSkill.value })));
let viewRestored = false;
// Messages belong to the view where they happened. When the control that changed the view is hidden, focus the new view's heading.
watch(view, async () => {
  if (!viewRestored) return;
  error.value = ""; message.value = ""; justConfirmed.value = null;
  await nextTick();
  const active = document.activeElement;
  if (!active || active === document.body || !active.getClientRects().length) {
    document.querySelector<HTMLElement>(view.value === "home" ? "#home-title" : view.value === "setup" ? "#setup-title" : view.value === "plan" ? "#plan-title" : ".lesson-view h1, .lesson-view h2")?.focus();
  }
});

async function task(work: () => Promise<void>) {
  const previous = focusedControl();
  busy.value = true; error.value = ""; message.value = ""; justConfirmed.value = null;
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
// The Materials detail pane shows one file at a time.
function selectMaterial(source: MaterialId, tab?: "preview" | "skills" | "text") {
  if (tab) matTab.value = tab;
  if (material.value === source && preview.value) return;
  material.value = source; showPreview.value = true; jumpLocation.value = undefined; task(readMaterial);
}
function suggestFrom(source: MaterialId) { material.value = source; suggest(); }
function removeFile(index: number) {
  chosenFiles.value.splice(index, 1);
  requestId.value = crypto.randomUUID();
  if (!chosenFiles.value.length && fileInput.value) fileInput.value.value = "";
}
function fileSize(bytes: number) { return bytes < 1_000_000 ? `${Math.max(1, Math.round(bytes / 1000))} KB` : `${(bytes / 1_000_000).toFixed(1)} MB`; }
function fileKind(name: string) { const dot = name.lastIndexOf("."); return dot > 0 ? name.slice(dot + 1).toUpperCase().slice(0, 4) : "FILE"; }
async function upload() {
  await task(async () => {
    const form = new FormData();
    form.set("course", props.course.course); form.set("title", materialTitle.value.trim()); form.set("requestId", requestId.value);
    for (const file of chosenFiles.value) form.append("files", file);
    const saved = await uploadMaterial(form);
    material.value = saved.material; await refresh(); await readMaterial();
    adding.value = false; showPreview.value = true;
    message.value = "Material saved. Check the readable text, then find skills in it.";
  });
}
async function readMaterial() {
  if (!material.value) return;
  preview.value = null;
  sessionStorage.setItem(sourceSelectionKey, material.value);
  const source = material.value;
  preview.value = unwrap(await api.courses.materials.read({ material: source }));
  kinds.value = { ...kinds.value, [source]: preview.value.originals.map(kindOf) };
}
async function download(file: string, name: string) {
  await task(async () => {
    const response = await fetch("/api/courses/materials/file", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ material: material.value, file }) });
    if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || "That file could not be opened. Try again.");
    const url = URL.createObjectURL(await response.blob()), link = document.createElement("a");
    link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}
async function suggest() {
  await task(async () => {
    const source = material.value;
    if (!source) throw new Error("Choose a study material first.");
    const result = unwrap(await api.courses.skills.suggest({ material: source })).suggestions;
    suggestions.value = result.skills; newUnit.value = result.unitTitle; suggestionSource.value = source;
    reviewIndex.value = 0; reviewOpen.value = true;
    message.value = "Review the outcomes and demonstration requirements. You can edit each suggestion.";
  });
}
async function saveDrafts() {
  await task(async () => {
    if (!draftSaves.read().length) {
      const source = suggestionSource.value || material.value, accepted = structuredClone(suggestions.value.map((item) => ({ ...item })));
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
  try { const saved = JSON.parse(sessionStorage.getItem(viewKey) ?? "null"); if (saved && ["home", "setup", "chat", "plan"].includes(saved.view)) { view.value = saved.view; selectedSkill.value = typeof saved.skill === "string" ? saved.skill : null; } } catch { /* Open Home if there is no saved view. */ }
  await nextTick(); viewRestored = true;
  pendingDraftCount.value = draftSaves.read().length; await refresh(); await refreshAI();
}));

// ---- Shell ----
const forestOpen = ref(false);
// The grove seed, shared by the Tree view and the Forest view, kept per course.
const groveKey = `stillgotit.grove.${props.course.course}`;
const design = ref(readNumber(groveKey));
// The same key and default (1) the grove in SkillTree.vue reads.
function readNumber(key: string) { try { const saved = Number.parseInt(localStorage.getItem(key) ?? "", 10); return Number.isInteger(saved) && saved > 0 ? saved : 1; } catch { return 1; } }
// SkillTree regrows on its own and saves the seed, so the forest re-reads it on open; a forest regrow remounts the grove.
const groveVersion = ref(0);
function openForest() { design.value = readNumber(groveKey); forestOpen.value = true; }
function regrow() { design.value++; groveVersion.value++; try { localStorage.setItem(groveKey, String(design.value)); } catch { /* The new seed applies until reload. */ } }
function navigate(next: "home" | "plan" | "setup" | "chat") { forestOpen.value = false; view.value = next; }
// The Learn and Plan screens expose these; optional so the page works before they do.
const study = ref<{ startPractice?: () => unknown } | null>(null), planner = ref<{ openBudget?: () => unknown } | null>(null);
async function practise(skill: string) { openSkill(skill); await nextTick(); await study.value?.startPractice?.(); }
async function setStudyTime() { navigate("plan"); await nextTick(); await planner.value?.openBudget?.(); }
function plant() { navigate("setup"); adding.value = true; }
const draftWaiting = computed(() => drafts.value.length + pendingDraftCount.value);
const homePlan = useHomePlan(props.course.course);
const plan = homePlan.data, next = homePlan.next;
watch(view, (now) => { if (now === "home") void homePlan.load(); });
watch(revision, () => void homePlan.load());
const planRevision = ref(0);
async function startNext() { await homePlan.start(openSkill); planRevision.value++; }
async function skipNext() { await homePlan.miss(); planRevision.value++; }
const longDay = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
const shortDow = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/New_York" });
function dayDate(day: string) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day); return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12)) : new Date(); }
const todayLong = computed(() => longDay.format(plan.value?.today ? dayDate(plan.value.today) : new Date()));
const sign = computed(() => {
  const exam = homePlan.exam.value; if (!exam) return null;
  return { title: "Exam", when: exam.days === 0 ? "Today" : `${shortDow.format(dayDate(exam.date))} · in ${exam.days} ${exam.days === 1 ? "day" : "days"}` };
});
const sunProgress = computed(() => { const m = homePlan.minutes.value; return m && m.total > 0 ? m.spent / m.total : 0; });

// ---- Skills as the views show them ----
function viewSkill(skill: CourseData["skills"][number]): ViewSkill {
  const mastery = progress.value[skill.skill] ?? null, day = homePlan.nextBySkill.value.get(skill.skill), today = homePlan.today.value;
  return { skill: skill.skill, title: skill.title, outcome: skill.outcome, mastery, dueToday: !!day && !!today && day <= today,
    reviewDay: day && today && day > today ? shortDow.format(dayDate(day)) : undefined, isNew: mastery === null };
}
const viewUnits = computed<ViewUnit[]>(() => data.value.units.map((item) => ({ unit: item.unit, title: item.title,
  skills: data.value.skills.filter((skill) => skill.unit === item.unit && skill.status === "CONFIRMED").map(viewSkill) })).filter((group) => group.skills.length));
function average(skills: ViewSkill[]) { const known = skills.filter((s) => s.mastery !== null); return known.length ? Math.round(known.reduce((sum, s) => sum + s.mastery!, 0) / known.length) : null; }
function pillFor(skill: ViewSkill) {
  if (skill.dueToday) return { cls: "coral", text: "Due today" };
  if (skill.mastery === null) return { cls: "new", text: "New" };
  if (skill.mastery >= 80) return { cls: "strong", text: "Strong" };
  if (skill.reviewDay) return { cls: "review", text: `Review ${skill.reviewDay}` };
  return null;
}
// Skills with a plan item today or earlier, for the grove's flag sprites.
const dueIds = computed(() => [...homePlan.nextBySkill.value].filter(([, day]) => !!homePlan.today.value && day <= homePlan.today.value).map(([skill]) => skill));
const unitTitle = computed(() => data.value.units.find((item) => item.unit === current.value?.unit)?.title ?? "");
function setHomeView(next: HomeView) { emit("update:homeView", next); }

// ---- Materials ----
const matTab = ref<"preview" | "skills" | "text">("preview");
const jumpLocation = ref<string | undefined>(undefined);
const gradedImport = ref<InstanceType<typeof GradedImport> | null>(null), gradedButton = ref<HTMLButtonElement | null>(null);
const selectedMaterial = computed(() => data.value.materials.find((source) => source.material === material.value));
function skillsOf(source: string) { const ids = new Set(data.value.skillSources.filter((row) => row.material === source).map((row) => row.skill)); return data.value.skills.filter((skill) => ids.has(skill.skill) && (skill.status === "DRAFT" || skill.status === "CONFIRMED")); }
// A file's kind from the material read's originals: media type first, then the file name's extension.
const kinds = ref<Record<string, string[]>>({});
function kindOf(file: { name: string; mediaType?: string }) {
  const type = file.mediaType ?? "", ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toUpperCase() ?? "";
  if (type === "application/pdf" || ext === "PDF") return "PDF";
  if (type.includes("presentation") || type.includes("powerpoint") || ext === "PPTX" || ext === "PPT") return "PPTX";
  if (type.startsWith("image/") || ["PNG", "JPG", "JPEG", "WEBP"].includes(ext)) return "IMG";
  if (type === "text/markdown" || ext === "MD") return "MD";
  return ext || "FILE";
}
function kindLabel(source: string) { const list = [...new Set(kinds.value[source] ?? [])]; return list.length === 1 ? list[0]! : list.length > 1 ? `${kinds.value[source]!.length} files` : ""; }
function iconKind(source: string) { const label = kindLabel(source); return ["PDF", "PPTX", "IMG", "MD"].includes(label) ? label : "OTHER"; }
// Kinds for files not opened yet, read once in the background when Materials opens. A failed read only leaves the kind out.
async function readKinds() {
  for (const source of data.value.materials) {
    if (kinds.value[source.material]) continue;
    try { const read = await api.courses.materials.read({ material: source.material }); if (!("error" in read)) kinds.value = { ...kinds.value, [source.material]: read.originals.map(kindOf) }; } catch { /* Leave the kind out. */ }
  }
}
function skillMeta(source: string) { const list = skillsOf(source), waiting = list.filter((skill) => skill.status === "DRAFT").length; return waiting ? `${waiting} to review` : `${list.length} ${list.length === 1 ? "skill" : "skills"}`; }
function fileMeta(source: string) { const kind = kindLabel(source); return kind ? `${kind} · ${skillMeta(source)}` : skillMeta(source); }
const materialSkills = computed(() => material.value ? skillsOf(material.value) : []);
const viewerSkills = computed<ViewerSkill[]>(() => materialSkills.value.map((skill) => ({ skill: skill.skill, title: skill.title, status: skill.status as "DRAFT" | "CONFIRMED" })));
// The file whose drafts the banner points at.
const draftFile = computed(() => { const ids = new Set(drafts.value.map((skill) => skill.skill)); const row = data.value.skillSources.find((item) => ids.has(item.skill)); return row ? data.value.materials.find((source) => source.material === row.material) : undefined; });
function reviewDrafts() { reviewIndex.value = suggestions.value.length; reviewOpen.value = true; void focusReview(); }
function reviewDraft(skill: string) { const at = reviewItems.value.findIndex((item) => item.kind === "draft" && item.skill === skill); reviewIndex.value = at < 0 ? 0 : at; reviewOpen.value = true; void focusReview(); }
async function focusReview() { await nextTick(); document.getElementById("review-title")?.focus(); }

// ---- One-at-a-time review of suggested skills ----
// Unsaved suggestions come first, then saved drafts. Confirming an unsaved suggestion saves it through the draft save
// queue and then confirms it; confirming a saved draft saves any edits first.
type ReviewItem = { kind: "suggestion"; index: number; key: string } | { kind: "draft"; skill: string; key: string };
const reviewOpen = ref(false), reviewIndex = ref(0);
const reviewItems = computed<ReviewItem[]>(() => [
  ...suggestions.value.map((_, index) => ({ kind: "suggestion" as const, index, key: `s${index}` })),
  ...drafts.value.map((draft) => ({ kind: "draft" as const, skill: draft.skill, key: draft.skill })),
]);
const reviewAt = computed(() => Math.max(0, Math.min(reviewIndex.value, reviewItems.value.length - 1)));
const reviewing = computed(() => reviewItems.value[reviewAt.value]);
const showReview = computed(() => !!reviewing.value && (reviewOpen.value || suggestions.value.length > 0));
const draftEdit = ref<{ skill: string; title: string; outcome: string; gate: string; unit: string } | null>(null);
function draftOf(skill: string) { return drafts.value.find((draft) => draft.skill === skill); }
function loadDraftEdit() { const item = reviewing.value, draft = item?.kind === "draft" ? draftOf(item.skill) : undefined; draftEdit.value = draft ? { skill: draft.skill, title: draft.title, outcome: draft.outcome, gate: draft.gate, unit: draft.unit } : null; }
watch(() => reviewing.value?.key, loadDraftEdit, { immediate: true });
const reviewSuggestion = computed(() => reviewing.value?.kind === "suggestion" ? suggestions.value[reviewing.value.index] : undefined);
const reviewMaterial = computed(() => { const item = reviewing.value; if (item?.kind === "suggestion") return suggestionSource.value || material.value; return item ? data.value.skillSources.find((row) => row.skill === item.skill)?.material ?? "" : ""; });
const reviewSourceTitle = computed(() => data.value.materials.find((source) => source.material === reviewMaterial.value)?.title ?? "");
// Saved drafts have no discard action on the server; only confirmed skills can be archived.
const discardReason = computed(() => reviewing.value?.kind === "draft" ? "Saved drafts can't be discarded. Leave it unconfirmed and it stays off your tree." : "");
function discardCurrent() {
  const item = reviewing.value; if (item?.kind !== "suggestion") return;
  suggestions.value.splice(item.index, 1);
  if (!reviewItems.value.length) reviewOpen.value = false;
}
async function confirmCurrent() {
  const item = reviewing.value; if (!item) return;
  if (item.kind === "suggestion") await confirmSuggestion(item.index);
  else await confirmDraft(item.skill);
  if (!reviewItems.value.length) reviewOpen.value = false;
}
async function confirmSuggestion(index: number) {
  await task(async () => {
    if (draftSaves.read().length) throw new Error("Finish saving your skill drafts first.");
    const source = suggestionSource.value || material.value, chosen = suggestions.value[index];
    if (!source) throw new Error("Choose learning material first.");
    if (!chosen) return;
    if (!unit.value) unit.value = unwrap(await api.courses.units.add({ course: props.course.course, title: newUnit.value.trim() })).unit;
    draftSaves.start([{ ...structuredClone({ ...chosen }), unit: unit.value, material: source }]);
    suggestions.value.splice(index, 1);
    pendingDraftCount.value = draftSaves.read().length;
    let saved = "";
    try { await draftSaves.drain(async (input) => { saved = unwrap(await api.courses.skills.propose(input)).skill; }); }
    finally { pendingDraftCount.value = draftSaves.read().length; await refresh(); }
    unwrap(await api.courses.skills.confirm({ skill: saved }));
    selectedSkill.value = saved; justConfirmed.value = saved;
    message.value = `Skill confirmed. “${chosen.title}” is now a leaf on your tree.`;
    await refresh();
  });
}
async function confirmDraft(skill: string) {
  const draft = draftOf(skill), edit = draftEdit.value?.skill === skill ? draftEdit.value : null, source = reviewMaterial.value;
  await task(async () => {
    if (draft && edit && source && (edit.title !== draft.title || edit.outcome !== draft.outcome || edit.gate !== draft.gate || edit.unit !== draft.unit)) {
      unwrap(await api.courses.skills.edit({ skill, title: edit.title.trim(), outcome: edit.outcome.trim(), gate: edit.gate.trim(), unit: edit.unit, material: source as MaterialId }));
    }
    unwrap(await api.courses.skills.confirm({ skill }));
    selectedSkill.value = skill; justConfirmed.value = skill;
    const title = edit?.title.trim() || draft?.title;
    message.value = `Skill confirmed. ${title ? `“${title}” is` : "It is"} now a leaf on your tree.`;
    await refresh();
  });
}
function openGraded() { void gradedImport.value?.startUpload(); }
// Sources the lesson cites open here, on the Preview tab at the cited place.
function openSource(source: OpenSource) {
  forestOpen.value = false; view.value = "setup"; matTab.value = "preview";
  const changed = material.value !== source.material;
  material.value = source.material as MaterialId; jumpLocation.value = source.location; showPreview.value = true;
  if (changed || !preview.value) void task(readMaterial).then(() => { jumpLocation.value = source.location; });
}
// "Ask about this page" opens a new lesson for the material's most relevant skill with the question as a draft.
const lessonDraft = ref<{ skill: string; text: string } | null>(null);
function ask(request: AskAboutPage) {
  const skill = skillsOf(request.material).find((item) => item.status === "CONFIRMED") ?? confirmed.value[0];
  if (!skill) { error.value = "Confirm a skill first. Questions open in a lesson for one of your skills."; return; }
  lessonDraft.value = { skill: skill.skill, text: request.question };
  openSkill(skill.skill);
}
watch(view, (now) => { if (now === "setup") void readKinds(); }, { immediate: false });
watch(view, (now) => { if (now === "setup" && material.value && !preview.value) readMaterial().catch((problem) => { error.value = problem instanceof Error ? problem.message : "That material could not be opened. Try again."; }); });
</script>

<template>
  <div class="app-frame">
    <ShellSidebar :view="view" :forest-open="forestOpen" :lesson-title="view === 'chat' && current?.status === 'CONFIRMED' ? current.title : undefined"
      :materials-badge="draftWaiting" :today="homePlan.minutes.value" :tutor-label="tutorChoice" :username="username"
      @navigate="navigate" @forest="openForest" @lesson="openChat" @tutor="emit('tutor')" @settings="emit('settings')">
      <template #switcher><slot name="switcher" /></template>
    </ShellSidebar>
  <section class="course-space app-card" :aria-busy="busy">
    <p v-if="error && view !== 'setup'" class="error page-error" role="alert">{{ error }}</p>

    <section v-show="view === 'home'" class="home-view" aria-labelledby="home-title">
      <h1 id="home-title" class="sr-only" tabindex="-1">Home</h1>
      <HomeScene :days="homePlan.days.value" :sign="sign" :progress="sunProgress">
        <template v-if="!plan && homePlan.error.value">
          <p class="eyebrow scene-eyebrow">{{ todayLong }}</p>
          <div role="alert"><p class="scene-reason">{{ homePlan.error.value }}</p></div>
          <div class="scene-actions"><button class="primary meadow" type="button" @click="homePlan.load()">Try again</button></div>
        </template>
        <p v-else-if="!plan" class="scene-reason loading" role="status">Loading your plan…</p>
        <template v-else-if="!plan.preferences">
          <p class="eyebrow scene-eyebrow">{{ todayLong }}</p>
          <h2 class="display scene-title">Set a daily study time</h2>
          <p class="scene-reason">Choose how many minutes a day you have for this course to get a plan.</p>
          <div class="scene-actions"><button class="primary meadow" type="button" @click="setStudyTime">Set study time</button></div>
        </template>
        <template v-else-if="next">
          <p class="eyebrow scene-eyebrow">{{ todayLong }} · Next up · {{ next.candidate.minutes }} min</p>
          <h2 class="display scene-title">{{ next.candidate.activity }}</h2>
          <p class="scene-reason">{{ next.candidate.reason }}</p>
          <div v-if="next.status === 'IN_PROGRESS'" class="scene-actions"><button class="primary meadow" type="button" @click="navigate('plan')">Record your time</button><span class="hint">In progress</span></div>
          <div v-else class="scene-actions">
            <span class="start-wrap"><button class="primary meadow" type="button" :disabled="homePlan.busy.value || !!homePlan.startReason.value" :aria-describedby="homePlan.startReason.value ? 'home-start-reason' : undefined" @click="startNext">Start review</button><p v-if="homePlan.startReason.value" id="home-start-reason" class="hint reason">{{ homePlan.startReason.value }}</p></span>
            <button v-if="next.day <= plan.today" class="quiet" type="button" :disabled="homePlan.busy.value" @click="skipNext">{{ next.day === plan.today ? 'Skip today' : 'Mark as missed' }}</button>
          </div>
        </template>
        <template v-else>
          <p class="eyebrow scene-eyebrow">{{ todayLong }}</p>
          <h2 class="display scene-title">No review is scheduled</h2>
          <p class="scene-reason">Update the plan after adding skills or completing practice.</p>
          <div class="scene-actions"><button class="secondary meadow" type="button" @click="navigate('plan')">Open Plan</button></div>
        </template>
        <div role="alert"><p v-if="plan && homePlan.error.value" class="error scene-message">{{ homePlan.error.value }}</p></div>
        <div role="status"><p v-if="homePlan.notice.value" class="notice scene-message">{{ homePlan.notice.value }}</p></div>
      </HomeScene>

      <div class="home-tools">
        <div class="segmented" role="radiogroup" aria-label="Home view">
          <button type="button" role="radio" :aria-checked="homeView === 'tree'" :class="{ on: homeView === 'tree' }" @click="setHomeView('tree')">Tree</button>
          <button type="button" role="radio" :aria-checked="homeView === 'tasks'" :class="{ on: homeView === 'tasks' }" @click="setHomeView('tasks')">Tasks</button>
        </div>
        <button type="button" class="forest-button" aria-haspopup="dialog" @click="openForest"><PixelIcon name="tree" :size="20" />Forest view</button>
      </div>

      <div v-if="homeView === 'tree'" class="tree-grid">
        <div class="tree-stage"><SkillTree :key="`grove-${groveVersion}`" :skills="treeSkills" :selected="selectedSkill" :units="data.units" :due="dueIds" :course-id="course.course" @select="selectedSkill = $event" @plant="plant"><template #empty><button class="primary sand empty-import" @click="navigate('setup')">Import your first lesson</button></template></SkillTree></div>
        <aside class="skill-card card">
          <template v-if="current?.status === 'CONFIRMED'">
            <div class="skill-band">
              <span class="sprite-tile"><PixelIcon :sprite="stageOf(progress[current.skill])" :size="52" /></span>
              <div class="band-text">
                <p class="eyebrow">{{ unitTitle }}</p>
                <h2 class="display skill-title">{{ current.title }}</h2>
              </div>
              <div class="band-mastery">
                <strong class="big-pct">{{ progress[current.skill] === undefined ? '—' : Math.round(progress[current.skill]!) + '%' }}</strong>
                <span class="hint">{{ progress[current.skill] === undefined ? 'No estimate yet' : 'Estimated mastery' }}</span>
                <MasteryCells :value="progress[current.skill]" />
              </div>
            </div>
            <div class="skill-body">
              <p class="skill-outcome">{{ current.outcome }}</p>
              <div class="skill-actions"><button class="primary meadow" type="button" @click="openSkill(current.skill)">Open lesson</button><button class="secondary meadow" type="button" @click="practise(current.skill)">Practice</button></div>
            </div>
          </template>
          <div v-else class="skill-body">
            <h2 class="display invite-title">{{ confirmed.length ? 'Where will you grow today?' : 'Start with what you’re learning.' }}</h2>
            <p class="hint">{{ confirmed.length ? 'Select a leaf to see the skill.' : 'Bring a lesson, notes, or a problem set.' }}</p>
          </div>
        </aside>
      </div>

      <div v-else class="tasks">
        <p v-if="!viewUnits.length" class="hint">No confirmed skills yet. <button class="quiet" type="button" @click="navigate('setup')">Add material</button></p>
        <section v-for="group in viewUnits" :key="group.unit" class="task-group">
          <header class="task-head"><h2 class="display">{{ group.title }}</h2><span class="hint">{{ group.skills.length }} {{ group.skills.length === 1 ? 'skill' : 'skills' }}{{ average(group.skills) === null ? '' : ` · ${average(group.skills)}%` }}</span></header>
          <ul class="task-rows">
            <li v-for="skill in group.skills" :key="skill.skill">
              <button type="button" class="task-row" @click="openSkill(skill.skill)">
                <PixelIcon :sprite="skill.dueToday ? 'flag' : stageOf(skill.mastery)" :size="28" />
                <span class="task-text"><strong>{{ skill.title }}</strong><small>{{ skill.outcome }}</small><MasteryCells :value="skill.mastery" :height="5" /></span>
                <span class="task-side"><b>{{ skill.mastery === null ? '—' : `${Math.round(skill.mastery)}%` }}</b><span v-if="pillFor(skill)" class="pill" :class="pillFor(skill)!.cls">{{ pillFor(skill)!.text }}</span></span>
                <span class="chev" aria-hidden="true">›</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </section>

    <section v-show="view === 'plan'" class="plan-view" aria-labelledby="plan-title">
      <h1 id="plan-title" class="sr-only" tabindex="-1">Plan</h1>
      <StudyPlanner ref="planner" :course="course.course" :revision="revision + planRevision" @select="openSkill" />
    </section>

    <section v-show="view === 'setup'" class="setup-view">
      <header class="mat-head">
        <PixelIcon name="school" :size="24" /><h1 id="setup-title" class="display mat-title" tabindex="-1">Materials</h1>
        <span class="hint mat-count">{{ data.materials.length }} {{ data.materials.length === 1 ? 'file' : 'files' }}</span>
        <InfoBubble label="About your files" text="Your files and answers are stored on the class server and sent to Google Gemini to create lessons and feedback. Don't upload anything private." />
        <div class="mat-actions">
          <button ref="gradedButton" type="button" class="secondary sand" @click="openGraded">Import graded work</button>
          <button v-if="data.materials.length" class="primary sand add-material" type="button" :aria-expanded="adding" aria-controls="add-panel" @click="adding = !adding">{{ adding ? 'Close' : '+ Add material' }}</button>
        </div>
      </header>
      <div role="alert"><p v-if="error && view === 'setup'" ref="setupError" class="error" tabindex="-1">{{ error }}</p></div>
      <div role="status"><p v-if="message" ref="notice" class="notice" tabindex="-1">{{ message }} <button v-if="justConfirmed" class="quiet" @click="showOnTree(justConfirmed)">See it on your tree</button></p></div>
      <div v-if="drafts.length" class="draft-banner">
        <span class="draft-tile" aria-hidden="true">{{ drafts.length }}</span>
        <span class="draft-text">{{ drafts.length }} suggested {{ drafts.length === 1 ? 'skill' : 'skills' }} to review{{ draftFile ? ` found in ${draftFile.title}` : '' }}</span>
        <button type="button" class="quiet" @click="reviewDrafts">Review ›</button>
      </div>
      <div class="course-tools">
        <section v-if="adding || !data.materials.length" id="add-panel" class="add-panel">
          <h2 class="display">{{ data.materials.length ? 'Add material' : 'Add your first material' }}</h2>
          <form class="import-card" @submit.prevent="upload">
            <div class="dropzone" :class="{ dragging, chosen: chosenFiles.length }" @dragenter="dragging = true" @dragleave="dragging = false" @drop="dragging = false">
              <input id="lesson-files" ref="fileInput" type="file" multiple :disabled="busy" aria-describedby="file-types" @change="filesChanged" />
              <ul v-if="chosenFiles.length" class="file-cards">
                <li v-for="(file, index) in chosenFiles" :key="file.name + index" class="file-card"><span class="file-kind" aria-hidden="true">{{ fileKind(file.name) }}</span><span class="file-name">{{ file.name }}<small>{{ fileSize(file.size) }}</small></span><button type="button" class="file-remove" :disabled="busy" :aria-label="`Remove ${file.name}`" @click="removeFile(index)">×</button></li>
              </ul>
              <p v-else class="drop-title"><span aria-hidden="true">＋</span> Drop course files here, or <label for="lesson-files" class="drop-choose">choose files</label></p>
              <p id="file-types" class="hint">PDF, Word, PowerPoint, Excel, text, notebook, or image (PNG, JPEG, WebP) files. Up to 25 MB total.</p>
            </div>
            <label for="lesson-title">Material title</label><input id="lesson-title" v-model="materialTitle" maxlength="160" required placeholder="For example, Lecture 4 notes" :disabled="busy" @input="resetImport" />
            <div class="import-actions"><p v-if="!chosenFiles.length" id="import-reason" class="hint reason">Choose at least one file to import.</p><button class="primary sand" :disabled="busy || !chosenFiles.length" :aria-describedby="chosenFiles.length ? undefined : 'import-reason'">{{ busy ? 'Working…' : 'Import material' }}</button></div>
          </form>
        </section>
        <GradedImport ref="gradedImport" external :course="course.course" :ai-available="ai.available" :ai-reason="ai.reason" @changed="task(refresh)" @closed="gradedButton?.focus()" />
        <section v-if="showReview && reviewing" class="review-card card" aria-labelledby="review-title">
          <header class="review-head">
            <h2 id="review-title" class="display" tabindex="-1">Review suggested skills</h2>
            <InfoBubble text="Edit each suggestion to match what your course expects. Confirming saves it and adds it as a leaf on your tree. Discard drops a suggestion that has not been saved." />
            <span class="review-dots" role="group" aria-label="Suggestions">
              <button v-for="(item, i) in reviewItems" :key="item.key" type="button" class="dot" :class="{ on: i === reviewAt, saved: item.kind === 'draft' }" :aria-label="`Suggestion ${i + 1} of ${reviewItems.length}${item.kind === 'draft' ? ', saved draft' : ''}`" :aria-current="i === reviewAt ? 'step' : undefined" @click="reviewIndex = i" />
            </span>
            <button v-if="!suggestions.length" type="button" class="quiet review-later" @click="reviewOpen = false">Later</button>
          </header>
          <p class="hint review-source">{{ reviewing.kind === 'draft' ? 'Saved draft' : 'New suggestion' }}{{ reviewSourceTitle ? ` · from ${reviewSourceTitle}` : '' }}</p>
          <p v-if="reviewing.kind === 'suggestion' && suggestedBy" class="tutor-label">{{ tutorLabel(suggestedBy) }}</p>
          <template v-if="reviewing.kind === 'suggestion' && reviewSuggestion">
            <label>Skill name<input v-model="reviewSuggestion.title" maxlength="160" :disabled="busy" /></label>
            <label>Topic<select v-model="unit" :disabled="busy"><option value="">Create a topic</option><option v-for="item in data.units" :key="item.unit" :value="item.unit">{{ item.title }}</option></select></label>
            <label v-if="!unit">New topic name<input v-model="newUnit" maxlength="160" :disabled="busy" /></label>
            <label>What you should be able to do<textarea v-model="reviewSuggestion.outcome" rows="2" :disabled="busy" /></label>
            <label>How you will demonstrate it<textarea v-model="reviewSuggestion.gate" rows="3" :disabled="busy" /></label>
          </template>
          <template v-else-if="reviewing.kind === 'draft' && draftEdit">
            <label>Skill name<input v-model="draftEdit.title" maxlength="160" :disabled="busy" /></label>
            <label>Topic<select v-model="draftEdit.unit" :disabled="busy"><option v-for="item in data.units" :key="item.unit" :value="item.unit">{{ item.title }}</option></select></label>
            <label>What you should be able to do<textarea v-model="draftEdit.outcome" rows="2" :disabled="busy" /></label>
            <label>How you will demonstrate it<textarea v-model="draftEdit.gate" rows="3" :disabled="busy" /></label>
          </template>
          <div class="review-actions">
            <span class="discard-wrap"><button type="button" class="secondary sand" :disabled="busy || !!discardReason" :aria-describedby="discardReason ? 'discard-reason' : undefined" @click="discardCurrent">Discard</button><p v-if="discardReason" id="discard-reason" class="hint reason">{{ discardReason }}</p></span>
            <button v-if="suggestions.length > 1" type="button" class="quiet" :disabled="busy" @click="saveDrafts">Save all {{ suggestions.length }} as drafts</button>
            <button type="button" class="primary sand" :disabled="busy" @click="confirmCurrent">{{ busy ? 'Saving…' : 'Confirm · add a leaf' }}</button>
          </div>
        </section>
        <section v-if="pendingDraftCount" class="section-block" aria-live="polite">
          <h2 class="display">Finish saving skills</h2>
          <p>{{ pendingDraftCount }} {{ pendingDraftCount === 1 ? 'save is' : 'saves are' }} waiting for confirmation. Retrying uses the original details and keeps any saved drafts.</p>
          <button class="primary sand" :disabled="busy" @click="saveDrafts">{{ busy ? 'Saving…' : 'Retry saving drafts' }}</button>
        </section>

        <div v-if="data.materials.length" class="mat-grid">
          <nav class="file-list" aria-label="Files">
            <p class="eyebrow">Files</p>
            <ul>
              <li v-for="source in data.materials" :key="source.material">
                <button type="button" class="file-row" :class="{ current: material === source.material }" :aria-current="material === source.material ? 'true' : undefined" @click="selectMaterial(source.material)">
                  <span class="doc-tile"><PixelIcon :rows="docIcon(iconKind(source.material))" :size="24" /></span>
                  <span class="file-text"><strong>{{ source.title }}</strong><small :class="{ waiting: fileMeta(source.material).endsWith('review') }">{{ fileMeta(source.material) }}</small></span>
                </button>
              </li>
            </ul>
          </nav>
          <section v-if="selectedMaterial" class="detail" :aria-label="selectedMaterial.title">
            <h2 class="display detail-title">{{ selectedMaterial.title }}</h2>
            <div class="detail-meta">
              <span class="hint">{{ preview ? `${preview.originals.length} ${preview.originals.length === 1 ? 'file' : 'files'}` : 'Course material' }} · {{ fileMeta(selectedMaterial.material) }}</span>
              <div v-if="preview" class="file-chips"><button v-for="file in preview.originals" :key="file.file" class="file-chip" :disabled="busy" @click="download(file.file, file.name)">↓ {{ file.name }}</button></div>
              <GradedImport :key="selectedMaterial.material" :course="course.course" :material="selectedMaterial.material" :title="selectedMaterial.title" />
              <span v-if="!selectedMaterial.title.startsWith('Graded work: ')" class="find-wrap"><button class="secondary sand" :disabled="busy || !!suggestReason" :aria-describedby="suggestReason ? 'suggest-reason' : undefined" @click="suggestFrom(selectedMaterial.material)">Find skills</button><p v-if="suggestReason" id="suggest-reason" class="hint reason">{{ suggestReason }}</p></span>
            </div>
            <div class="mat-tabs" role="tablist" aria-label="Material views">
              <button id="mat-tab-preview" type="button" role="tab" :aria-selected="matTab === 'preview'" aria-controls="mat-panel" @click="matTab = 'preview'">Preview</button>
              <button id="mat-tab-skills" type="button" role="tab" :aria-selected="matTab === 'skills'" aria-controls="mat-panel" @click="matTab = 'skills'">Skills ({{ materialSkills.length }})</button>
              <button id="mat-tab-text" type="button" role="tab" :aria-selected="matTab === 'text'" aria-controls="mat-panel" @click="matTab = 'text'">Text your tutor reads</button>
            </div>
            <div id="mat-panel" role="tabpanel" :aria-labelledby="`mat-tab-${matTab}`" class="mat-panel">
              <MaterialViewer v-if="matTab === 'preview'" :material="selectedMaterial.material" :title="selectedMaterial.title" :skills="viewerSkills" :initial-location="jumpLocation" @ask="ask" @open-skill="openSkill" @review-draft="reviewDraft" />
              <ul v-else-if="matTab === 'skills'" class="skill-rows">
                <li v-if="!materialSkills.length" class="skill-row"><span class="hint">No skills from this file yet. Use Find skills.</span></li>
                <li v-for="skill in materialSkills" :id="`skill-row-${skill.skill}`" :key="skill.skill" class="skill-row"><span class="status-dot" :class="{ draft: skill.status === 'DRAFT' }" aria-hidden="true"></span>
                  <div class="skill-text"><strong>{{ skill.title }}</strong><small>{{ skill.outcome }}</small></div>
                  <span class="status-tag">{{ skill.status === 'DRAFT' ? 'Draft' : progress[skill.skill] === undefined ? 'On your tree' : `${Math.round(progress[skill.skill]!)}% mastery` }}</span>
                  <button v-if="skill.status === 'DRAFT'" class="secondary sand" :disabled="busy" @click="confirm(skill.skill)">Confirm</button><button v-else class="quiet" @click="openSkill(skill.skill)">Open</button></li>
              </ul>
              <div v-else class="material-preview">
                <p v-if="!preview" class="hint loading">Loading the readable text…</p>
                <template v-else>
                  <p v-for="limit in preview.originals.flatMap((file) => file.limitations)" :key="limit" class="hint">{{ limit }}</p>
                  <pre>{{ preview.content || 'This source is available as readable images.' }}</pre>
                </template>
              </div>
            </div>
          </section>
        </div>
        <ManageSkills :course="course.course" :data="data" @changed="task(refresh)" />
      </div>
    </section>
    <div v-show="view === 'chat'" class="lesson-view">
      <KeepAlive :max="12"><SkillStudy v-if="current?.status === 'CONFIRMED'" ref="study" :key="current.skill" :skill="current.skill" :course="course.course" :materials="data.materials" :ai-available="ai.available" :ai-reason="ai.reason" :active="view === 'chat'" :initial-draft="lessonDraft?.skill === current.skill ? lessonDraft.text : undefined" @changed="progressChanged" @back="showOnTree(current.skill)" @open-source="openSource" /></KeepAlive>
      <div v-if="current?.status !== 'CONFIRMED'" class="no-lesson"><h2 class="display" tabindex="-1">Choose a leaf to begin.</h2><button class="primary meadow" @click="view = 'home'">Go to your tree</button></div>
    </div>
  </section>
  </div>
  <ForestView v-if="forestOpen" :course-title="course.title" :units="viewUnits" :design="design" :selected="selectedSkill"
    @close="forestOpen = false" @open="openSkill" @practice="practise" @select="selectedSkill = $event" @plant="plant" @regrow="regrow" />
</template>

<style scoped>
/* The shell: a transparent 252px sidebar beside a 14px-inset white card. */
.app-frame { display: grid; grid-template-columns: 252px minmax(0, 1fr); min-height: 100dvh; }
.app-card { position: relative; min-width: 0; margin: 14px 14px 14px 0; padding: 30px 40px 56px; background: #fff; border: 1px solid var(--card-border); border-radius: 24px; }
@media (max-width: 1100px) { .app-frame { grid-template-columns: 216px minmax(0, 1fr); } .app-card { padding: 24px 24px 48px; } }
@media (max-width: 760px) { .app-frame { grid-template-columns: minmax(0, 1fr); } .app-card { margin: 0 8px 8px; padding: 16px 14px 40px; border-radius: 20px; } }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
.page-error { margin: 0 0 14px; }

/* Home */
.home-view { max-width: 1220px; margin: 0 auto; }
.scene-eyebrow { color: #3F7A55; }
.scene-title { margin: 0; font-size: 24px; overflow-wrap: anywhere; }
.scene-reason { margin: 0; font-size: 14px; color: var(--muted); }
.scene-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; margin-top: 8px; }
.scene-actions .primary { margin-bottom: 3px; }
.scene-message { margin: 6px 0 0; }
.home-tools { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 18px 0 16px; }
.segmented { display: inline-flex; padding: 3px; border-radius: 12px; background: #F2F2EF; }
.segmented button { min-height: 34px; padding: 0 16px; border: 0; border-radius: 9px; background: transparent; color: var(--soft); font-size: 14px; font-weight: 700; }
.segmented button.on { background: #fff; color: var(--ink); box-shadow: 0 1px 2px rgba(0, 0, 0, .08); }
.forest-button { display: inline-flex; align-items: center; gap: 8px; min-height: 38px; padding: 0 14px; border: 0; border-radius: 12px; background: #fff; box-shadow: 0 0 0 1px #CFE6D7; color: var(--meadow-soft-text); font-size: 14px; font-weight: 700; }
.forest-button:hover { background: var(--meadow-soft); }
.tree-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(290px, 340px); gap: 18px; align-items: start; }
@media (max-width: 1180px) { .tree-grid { grid-template-columns: minmax(0, 1fr); } }
.tree-stage { position: relative; min-width: 0; }
.empty-import { display: flex; margin: 4px auto 8px; }
.skill-card { overflow: hidden; animation: sgRise 240ms ease-out both; }
.skill-band { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 12px; padding: 16px; background: #F1F8F2; }
.sprite-tile { display: grid; place-items: center; width: 52px; height: 52px; border-radius: 12px; background: #fff; }
.band-text { min-width: 0; }
.skill-title { margin: 2px 0 0; font-size: 22px; overflow-wrap: anywhere; }
.band-mastery { grid-column: 1 / -1; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
.big-pct { font-size: 34px; font-weight: 700; letter-spacing: -1px; line-height: 1; }
.band-mastery .hint { margin: 0; }
.band-mastery :deep(.mastery-cells) { flex: 1 1 100%; }
.skill-body { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.skill-outcome { margin: 0; font-size: 15px; line-height: 1.55; }
.skill-actions { display: flex; flex-wrap: wrap; gap: 10px; }
.invite-title { margin: 0; font-size: 22px; }
.tasks { display: flex; flex-direction: column; gap: 22px; }
.task-head { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.task-head h2 { margin: 0; font-size: 21px; }
.task-head .hint { margin: 0; }
.task-rows { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.task-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto 14px; gap: 12px; align-items: center; width: 100%; padding: 12px 14px; border: 0; border-radius: 14px; background: #fff; box-shadow: 0 0 0 1px var(--ring); color: var(--ink); text-align: left; }
.task-row:hover { background: var(--inset); }
.task-text { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.task-text strong { font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
.task-text small { font-size: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-side { display: flex; align-items: center; gap: 8px; }
.task-side b { font-size: 15px; font-weight: 700; }
.chev { color: var(--faint); font-size: 18px; }
@media (max-width: 520px) { .task-row { grid-template-columns: 28px minmax(0, 1fr) 14px; } .task-side { grid-column: 2; } .chev { grid-column: 3; grid-row: 1; } }

/* Plan */
.plan-view { max-width: 1220px; margin: 0 auto; }

/* Materials */
.setup-view { max-width: 1220px; margin: 0 auto; }
.mat-head { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; }
.mat-title { margin: 0; font-size: 22px; }
.mat-count { margin: 0; }
.mat-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-left: auto; }
.draft-banner { display: flex; align-items: center; gap: 12px; margin: 0 0 16px; padding: 10px 14px; background: #FFF6E6; border: 1px solid #F3D7A8; border-radius: 14px; }
.draft-tile { display: grid; place-items: center; width: 30px; height: 30px; flex: none; border-radius: 8px; background: var(--sand); color: var(--sand-text); font-weight: 700; }
.draft-text { flex: 1; min-width: 0; font-size: 14px; font-weight: 600; }
.mat-grid { display: grid; grid-template-columns: minmax(220px, 260px) minmax(0, 1fr); gap: 18px; align-items: start; margin-top: 8px; }
@media (max-width: 1240px) { .mat-grid { grid-template-columns: minmax(170px, 200px) minmax(0, 1fr); } }
@media (max-width: 760px) { .mat-grid { grid-template-columns: minmax(0, 1fr); } }
.file-list ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.file-row { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 8px; border: 0; border-radius: 12px; background: transparent; color: var(--ink); text-align: left; }
.file-row:hover { background: var(--inset); }
.file-row.current { background: var(--sand-soft); }
.doc-tile { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border-radius: 9px; background: #fff; box-shadow: 0 0 0 1px var(--ring); }
.file-text { display: flex; flex-direction: column; min-width: 0; }
.file-text strong { font-size: 13px; font-weight: 650; overflow-wrap: anywhere; }
.file-text small { font-size: 12px; color: var(--muted); }
.file-text small.waiting { color: #B5702A; font-weight: 600; }
.detail { min-width: 0; }
.detail-title { margin: 0 0 6px; font-size: 28px; overflow-wrap: anywhere; }
.detail-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 14px; }
.detail-meta > .hint { margin: 0; }
.file-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.file-chip { border: 0; border-radius: 999px; background: var(--inset-2); padding: 5px 12px; font-size: 12px; font-weight: 600; color: var(--soft); }
.file-chip:hover:not(:disabled) { background: var(--sand-soft); color: var(--sand-soft-text); }
.mat-tabs { display: flex; gap: 18px; border-bottom: 1px solid var(--line); margin-bottom: 14px; overflow-x: auto; }
.mat-tabs button { flex: none; padding: 8px 2px; border: 0; background: transparent; color: var(--muted); font-size: 14px; }
.mat-tabs button[aria-selected="true"] { color: var(--ink); font-weight: 700; box-shadow: inset 0 -3px 0 var(--sand-edge); }
.mat-panel { min-width: 0; }
.material-preview pre { max-height: 520px; overflow: auto; white-space: pre-wrap; font-family: var(--font-mono); font-size: 12px; background: var(--inset); padding: 14px; border-radius: 12px; margin: 0; }
.skill-rows { list-style: none; margin: 0; padding: 0; border-radius: 16px; box-shadow: 0 0 0 1px var(--ring); overflow: hidden; }
.skill-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; flex-wrap: wrap; }
.skill-row + .skill-row { border-top: 1px solid var(--line); }
.skill-text { flex: 1; min-width: 140px; }
.skill-text strong { display: block; font-size: 14px; font-weight: 650; }
.skill-text small { display: block; font-size: 12px; color: var(--muted); }
.status-dot { width: 10px; height: 10px; flex: none; background: var(--strong); }
.status-dot.draft { background: transparent; box-shadow: inset 0 0 0 2px var(--sand-edge); }
.status-tag { font-size: 12px; color: var(--muted); white-space: nowrap; }
.skill-row .secondary { min-height: 34px; }
.course-tools { position: relative; }
.course-tools label { margin: 14px 0 7px; font-size: 13px; }
select, textarea { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--faint); border-radius: 12px; background: #fff; color: var(--ink); }
textarea { resize: vertical; }
.add-panel, .suggest-panel, .section-block { margin: 0 0 18px; }
.add-panel h2, .suggest-panel h2, .section-block h2 { margin: 0 0 10px; font-size: 22px; }
.review-card { margin: 0 0 18px; padding: 18px; max-width: 760px; animation: sgRise 240ms ease-out both; }
.review-head { display: flex; align-items: center; flex-wrap: wrap; gap: 6px 8px; }
.review-head h2 { margin: 0; font-size: 22px; }
.review-dots { display: inline-flex; flex-wrap: wrap; gap: 6px; margin-left: auto; }
.dot { width: 12px; height: 12px; padding: 0; border: 0; border-radius: 2px; background: var(--ring); }
.dot.saved { background: var(--sand-nav); }
.dot.on { background: var(--sand-edge); }
.review-later { margin-left: 4px; }
.review-source { margin: 6px 0 0; }
.review-card label { display: flex; flex-direction: column; gap: 6px; }
.review-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 16px; }
.discard-wrap { margin-right: auto; }
.section-block { padding: 16px 18px; border-radius: 18px; background: var(--sand-soft); }
.section-block p { font-size: 14px; }
.course-tools form.import-card { max-width: none; }
.import-card { padding: 16px; border-radius: 18px; box-shadow: 0 0 0 1px var(--ring); }
.dropzone { position: relative; border: 2px dashed var(--sand-edge); border-radius: 16px; background: var(--sand-soft); padding: 28px 18px; text-align: center; }
.dropzone input { position: absolute; inset: 0; width: 100%; height: 100%; min-height: 0; opacity: 0; cursor: pointer; padding: 0; border: 0; }
.dropzone:hover, .dropzone.dragging { background: var(--sand-nav); }
.dropzone:focus-within { outline: 2px solid var(--ink); outline-offset: 3px; }
.dropzone.chosen { border: 1px solid var(--ring); background: #fff; text-align: left; padding: 12px; }
.drop-title { margin: 0 0 6px; font-size: 16px; font-weight: 600; }
.dropzone .drop-choose { display: inline; margin: 0; font: inherit; text-decoration: underline; text-underline-offset: 3px; }
.dropzone .hint { margin: 0; }
.file-cards { list-style: none; margin: 0 0 10px; padding: 0; display: flex; flex-wrap: wrap; gap: 10px; position: relative; z-index: 2; pointer-events: none; }
.file-card { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: 12px; box-shadow: 0 0 0 1px var(--ring); background: #fff; max-width: 100%; pointer-events: auto; }
.file-kind { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 9px; background: var(--sand); color: var(--sand-text); font-size: 10px; font-weight: 700; flex: none; }
.file-name { display: flex; flex-direction: column; min-width: 0; font-size: 13px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.file-name small { font-weight: 400; color: var(--muted); }
.file-remove { border: 0; background: var(--inset-2); border-radius: 8px; width: 28px; height: 28px; padding: 0; font-size: 17px; line-height: 1; flex: none; }
.import-actions { display: flex; align-items: center; justify-content: flex-end; gap: 16px; margin-top: 14px; }
.import-actions .hint { margin: 0; flex: 1; }
.course-tools form.import-card .primary { margin: 0 0 3px; }

/* Learn */
.no-lesson { padding: 80px 10px; text-align: center; }
.no-lesson h2 { font-size: 28px; }
@media (max-width: 650px) { .mat-actions { margin-left: 0; width: 100%; } .no-lesson { padding: 50px 10px; } }
</style>
