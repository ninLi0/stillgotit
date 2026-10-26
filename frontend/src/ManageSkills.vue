<script setup lang="ts">
import InfoBubble from "./InfoBubble.vue";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { api, errorMessage } from "./api.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import ManageNote from "./ManageNote.vue";
import type { StillGotItHttp } from "../../generated/wire.ts";

type CourseData = StillGotItHttp["/courses/read"]["output"];
type SkillRow = CourseData["skills"][number];
type UnitRow = CourseData["units"][number];
type MaterialId = CourseData["materials"][number]["material"];

// `data` is the page's course read. After a change this emits `changed`, and the page reads the course again.
const props = defineProps<{ course: string; data: CourseData }>();
const emit = defineEmits<{ changed: [] }>();

/**
 * The sentence for each refusal these controls can receive. The SkillMapping sentences are the actions' own
 * (design/concepts/SkillMapping.md). The two course-level sentences are the design's too: COURSE_UNAVAILABLE's in
 * design/compositions/Courses.md, "Course and skill refusals", and MATERIAL_UNAVAILABLE's in
 * design/compositions/Learning.md, "Refusal sentences".
 */
const refusals = {
  COURSE_UNAVAILABLE: "This course is not available. Reload the page to see your courses.",
  MATERIAL_UNAVAILABLE: "This material is not available in this course. Reload the page to see its materials.",
  SKILL_DETAILS_UNAVAILABLE: "Choose one of your confirmed skills.",
  SKILL_UNIT_MISMATCH: "Choose a unit in the skill's course.",
  INVALID_SKILL_TITLE: "Enter a skill title.",
  SKILL_DEFINITION_UNAVAILABLE: "Choose one of your confirmed skills.",
  INVALID_SKILL_DEFINITION: "Enter an outcome and demonstration requirements.",
  SKILL_DEFINITION_UNCHANGED: "Change the outcome or requirements to create a new version.",
  SKILL_MATERIAL_UNAVAILABLE: "Choose one of your confirmed skills.",
  SKILL_PREREQUISITES_UNAVAILABLE: "Choose one of your confirmed skills.",
  INVALID_SKILL_PREREQUISITES: "Use confirmed skills from this course, without self-dependencies or cycles.",
  SKILL_ARCHIVE_UNAVAILABLE: "Choose one of your confirmed skills.",
  SKILL_STILL_REQUIRED: "Remove this skill from other active skills' prerequisites first.",
  SKILL_RESTORE_UNAVAILABLE: "Choose one of your archived skills.",
  SKILL_RESTORE_PREREQUISITES: "Restore this skill's prerequisites before restoring the skill.",
  UNIT_EMPHASIS_UNAVAILABLE: "Choose a unit in one of your courses.",
} as const;
type Refusal = keyof typeof refusals;

/**
 * Over HTTP a refusal arrives as its kind, without its code. The server adds the code's sentence as `detail`, which is
 * shown as it is. For a refusal without one, each action names the code that the kind means for its request, judged
 * from what the page shows.
 */
type Kind = "FORBIDDEN" | "CONFLICT" | "INVALID_REQUEST";
const declaredKinds = new Set<string>(["FORBIDDEN", "CONFLICT", "INVALID_REQUEST"]);
// Any other failure (no answer, a timeout, a server fault) leaves the outcome unknown, so the page reads the course again.
const unknownOutcome = "The server did not answer, so this change may or may not be saved. The page is reloading your course to show what is saved.";

type Saved = { title: string; unit: SkillRow["unit"]; outcome: string; gate: string; prerequisites: string[] };
// A skill's form values. `base` is the saved state they started from, so a new course read replaces only fields the learner has not edited.
type Draft = Saved & { base: Saved; source: MaterialId | "" };
const drafts = reactive<Record<string, Draft>>({});
const open = reactive<Record<string, boolean>>({});
// Each control's last result, by `<skill or unit>:<control>`. It follows a skill that moves to another unit or list.
const notes = reactive<Record<string, { ok?: string; error?: string }>>({});
// Emphasis saved since the last course read, so the switch keeps the saved value until the page reads again.
const emphasis = reactive<Record<string, boolean>>({});
// One change at a time: these endpoints do not take the learner's lock.
const busy = ref(false), working = ref("");
// Where focus belongs once the page has read the course again after a change.
// `reread` re-explains a conflict with the new read and returns the key its message now has.
let pending: { previous: HTMLElement | SVGElement | null; key: string; outcome: "ok" | "error"; reread?: () => string } | null = null;

const prefix = `manage-${props.course.replace(/[^\w-]/g, "_")}`;
const noteId = (key: string) => `${prefix}-${key.replace(/[^\w-]/g, "_")}`;
const reasonId = (key: string) => `${noteId(key)}-reason`;

function bySkill<Row extends { skill: string }>(rows: readonly Row[]) {
  const map = new Map<string, Row[]>();
  for (const row of rows) { const list = map.get(row.skill); if (list) list.push(row); else map.set(row.skill, [row]); }
  return map;
}
const lookup = computed(() => ({
  skills: new Map<string, SkillRow & { index: number }>(props.data.skills.map((skill, index) => [skill.skill, { ...skill, index }])),
  units: new Map<string, UnitRow & { index: number }>(props.data.units.map((unit, index) => [unit.unit, { ...unit, index }])),
  materials: new Map<string, string>(props.data.materials.map((material) => [material.material, material.title])),
  prerequisites: bySkill(props.data.prerequisites),
  sources: bySkill(props.data.skillSources),
  versions: bySkill(props.data.versions),
}));
const confirmed = computed(() => props.data.skills.filter((skill) => skill.status === "CONFIRMED"));
const statusOf = (skill: string) => lookup.value.skills.get(skill)?.status;
const titleOf = (skill: string) => lookup.value.skills.get(skill)?.title ?? "Untitled skill";
const unitTitle = (unit: string) => lookup.value.units.get(unit)?.title ?? "";
const prerequisitesOf = (skill: string) => (lookup.value.prerequisites.get(skill) ?? []).map((row) => row.prerequisite);
// Confirmed skills that list this one as a prerequisite. While there are any, the skill cannot be archived.
const dependentsOf = (skill: string) => confirmed.value.filter((other) => prerequisitesOf(other.skill).includes(skill)).map((other) => other.title);
// Archived prerequisites. While there are any, the skill cannot be restored.
const archivedPrerequisitesOf = (skill: string) => prerequisitesOf(skill).filter((id) => statusOf(id) === "ARCHIVED").map(titleOf);
const inCourseOrder = (a: SkillRow, b: SkillRow) => (lookup.value.units.get(a.unit)?.index ?? 0) - (lookup.value.units.get(b.unit)?.index ?? 0)
  || (lookup.value.skills.get(a.skill)?.index ?? 0) - (lookup.value.skills.get(b.skill)?.index ?? 0);
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));
const conjunction = new Intl.ListFormat("en", { type: "conjunction" });
const quoted = (titles: string[]) => conjunction.format(titles.map((title) => `“${title}”`));

/** What the panel shows for one confirmed skill. A reason is set when its control cannot apply. */
function describe(skill: SkillRow, draft: Draft) {
  const id = skill.skill, saved = prerequisitesOf(id), dependents = dependentsOf(id);
  const attached = new Set((lookup.value.sources.get(id) ?? []).map((row) => row.material as string));
  const title = draft.title.trim(), outcome = draft.outcome.trim(), gate = draft.gate.trim();
  const unchangedDefinition = outcome === draft.base.outcome.trim() && gate === draft.base.gate.trim();
  return {
    skill, draft,
    keys: { details: `${id}:details`, requirements: `${id}:requirements`, sources: `${id}:sources`, prerequisites: `${id}:prerequisites`, status: `${id}:status` },
    // The read lists a skill's versions newest first; every row but the current one is a previous definition.
    previous: (lookup.value.versions.get(id) ?? []).filter((row) => row.version !== skill.current),
    sources: [...attached].map((material) => lookup.value.materials.get(material) ?? "Course material"),
    addable: props.data.materials.filter((material) => !attached.has(material.material)),
    builtOn: saved.map(titleOf),
    // The course's other confirmed skills, and any saved prerequisite that is no longer confirmed, so saving never drops it unseen.
    candidates: props.data.skills.filter((other) => other.skill !== id && (other.status === "CONFIRMED" || saved.includes(other.skill))).sort(inCourseOrder)
      .map((other) => ({ skill: other.skill, title: other.title, detail: [unitTitle(other.unit), other.status === "CONFIRMED" ? "" : other.status.toLowerCase()].filter(Boolean).join(" · ") })),
    editingDefinition: !unchangedDefinition,
    reasons: {
      details: !title ? refusals.INVALID_SKILL_TITLE : title === draft.base.title.trim() && draft.unit === draft.base.unit ? "Change the name or unit first." : "",
      requirements: !outcome || !gate ? refusals.INVALID_SKILL_DEFINITION : unchangedDefinition ? refusals.SKILL_DEFINITION_UNCHANGED : "",
      sources: draft.source ? "" : "Choose a material first.",
      prerequisites: sameSet(draft.prerequisites, draft.base.prerequisites) ? "Change the selection first." : "",
      status: dependents.length ? `${refusals.SKILL_STILL_REQUIRED} ${quoted(dependents)} ${dependents.length === 1 ? "builds" : "build"} on it.` : "",
    },
  };
}
type Item = ReturnType<typeof describe>;

// Grouped by unit in the course's unit order, like "Skills by topic". Every unit is listed so its emphasis can be set.
const groups = computed(() => props.data.units.map((unit) => ({
  unit, emphasized: emphasis[unit.unit] ?? unit.emphasized,
  items: confirmed.value.filter((skill) => skill.unit === unit.unit).flatMap((skill) => { const draft = drafts[skill.skill]; return draft ? [describe(skill, draft)] : []; }),
})));
const archived = computed(() => props.data.skills.filter((skill) => skill.status === "ARCHIVED").map((skill) => {
  const blocked = archivedPrerequisitesOf(skill.skill);
  return { skill, key: `${skill.skill}:status`, unitTitle: unitTitle(skill.unit),
    reason: blocked.length ? `${refusals.SKILL_RESTORE_PREREQUISITES} It builds on ${quoted(blocked)}, which ${blocked.length === 1 ? "is" : "are"} archived.` : "" };
}));
type ArchivedItem = (typeof archived.value)[number];

/** Brings the forms up to date with a new course read, keeping the learner's unsaved edits. */
function sync() {
  const current = new Set<string>(confirmed.value.map((skill) => skill.skill));
  for (const id of Object.keys(drafts)) if (!current.has(id)) delete drafts[id];
  for (const skill of confirmed.value) {
    const saved: Saved = { title: skill.title, unit: skill.unit, outcome: skill.outcome, gate: skill.gate, prerequisites: prerequisitesOf(skill.skill) };
    const draft = drafts[skill.skill];
    if (!draft) { drafts[skill.skill] = { ...saved, prerequisites: [...saved.prerequisites], base: saved, source: "" }; continue; }
    if (draft.title === draft.base.title) draft.title = saved.title;
    if (draft.unit === draft.base.unit) draft.unit = saved.unit;
    if (draft.outcome === draft.base.outcome) draft.outcome = saved.outcome;
    if (draft.gate === draft.base.gate) draft.gate = saved.gate;
    if (sameSet(draft.prerequisites, draft.base.prerequisites)) draft.prerequisites = [...saved.prerequisites];
    draft.base = saved;
    if (draft.source && lookup.value.sources.get(skill.skill)?.some((row) => row.material === draft.source)) draft.source = "";
  }
  for (const unit of Object.keys(emphasis)) delete emphasis[unit];
}
watch(() => props.data, async () => {
  sync();
  const after = pending; pending = null;
  if (!after) return;
  const key = after.reread?.() ?? after.key;
  await nextTick();
  // The control may be gone or rebuilt elsewhere (a moved or archived skill); its message then takes focus.
  restoreFocus(after.previous, () => document.getElementById(`${noteId(key)}-${after.outcome}`));
}, { immediate: true });

function toggled(skill: string, event: Event) { open[skill] = (event.target as HTMLDetailsElement).open; }

/**
 * Sends one change. `refusal` names the code a refusal kind means; `saved` updates the forms and returns the success
 * message. Focus returns to the control, or to its message when the control is disabled or gone.
 */
async function act(key: string, send: () => Promise<object>, refusal: (kind: Kind) => Refusal | undefined, saved: () => string) {
  if (busy.value) return;
  const previous = focusedControl();
  busy.value = true; working.value = key; pending = null;
  for (const name of Object.keys(notes)) delete notes[name];
  let outcome: "ok" | "error" = "error", reload = false, reread: (() => string) | undefined;
  try {
    const result = await send();
    if (!("error" in result)) { notes[key] = { ok: saved() }; outcome = "ok"; reload = true; }
    else {
      const failure = result as { error: unknown; detail?: unknown }, kind = String(failure.error);
      const told = typeof failure.detail === "string" && failure.detail.trim() ? failure.detail : "";
      if (declaredKinds.has(kind)) {
        const explain = () => { const code = told ? undefined : refusal(kind as Kind); return told || (code ? refusals[code] : errorMessage(kind)); };
        notes[key] = { error: explain() };
        // A conflict means the page shows outdated skills. Read the course again, then explain with what it shows.
        if (kind === "CONFLICT") {
          reload = true;
          reread = () => {
            if (!notes[key]?.error) return key;
            // A skill archived elsewhere has left the active list, so its Archived row shows the message.
            const skill = key.slice(0, key.lastIndexOf(":")), home = statusOf(skill) === "ARCHIVED" ? `${skill}:status` : key;
            delete notes[key]; notes[home] = { error: explain() };
            return home;
          };
        }
      } else if (kind === "UNAUTHORIZED") notes[key] = { error: told || errorMessage(kind) };
      else { notes[key] = { error: unknownOutcome }; reload = true; }
    }
  } catch {
    notes[key] = { error: unknownOutcome }; reload = true;
  } finally {
    busy.value = false; working.value = "";
    await nextTick();
    restoreFocus(previous, () => document.getElementById(`${noteId(key)}-${outcome}`));
    if (reload) { pending = { previous: focusedControl(), key, outcome, reread }; emit("changed"); }
  }
}

function saveDetails({ skill, draft, keys, reasons }: Item) {
  if (reasons.details) return;
  const title = draft.title.trim(), unit = draft.unit;
  return act(keys.details, () => api.courses.skills.details({ skill: skill.skill, unit, title }),
    (kind) => kind === "FORBIDDEN" ? "COURSE_UNAVAILABLE" : kind === "CONFLICT" ? "SKILL_DETAILS_UNAVAILABLE" : title ? "SKILL_UNIT_MISMATCH" : "INVALID_SKILL_TITLE",
    () => { draft.title = draft.base.title = title; draft.unit = draft.base.unit = unit; return "Saved."; });
}

function revise({ skill, draft, keys, reasons }: Item) {
  if (reasons.requirements) return;
  const id = skill.skill, outcome = draft.outcome.trim(), gate = draft.gate.trim();
  return act(keys.requirements, () => api.courses.skills.revise({ skill: id, outcome, gate }),
    (kind) => {
      if (kind === "FORBIDDEN") return "COURSE_UNAVAILABLE";
      if (kind === "INVALID_REQUEST") return !outcome || !gate ? "INVALID_SKILL_DEFINITION" : undefined;
      const now = lookup.value.skills.get(id);
      return now?.status === "CONFIRMED" && now.outcome === outcome && now.gate === gate ? "SKILL_DEFINITION_UNCHANGED" : "SKILL_DEFINITION_UNAVAILABLE";
    },
    () => {
      draft.outcome = draft.base.outcome = outcome; draft.gate = draft.base.gate = gate;
      return "Saved as a new version. The earlier one is listed below as “Previous definition”, and this version needs a new check.";
    });
}

function addSource({ skill, draft, keys, reasons }: Item) {
  const material = draft.source;
  if (reasons.sources || !material) return;
  const title = lookup.value.materials.get(material) ?? "The material";
  return act(keys.sources, () => api.courses.skills.sources.add({ skill: skill.skill, material }),
    // The skill is checked before the material, and this list offers only the course's own materials.
    (kind) => kind === "FORBIDDEN" ? "COURSE_UNAVAILABLE" : kind === "CONFLICT" ? "SKILL_MATERIAL_UNAVAILABLE" : undefined,
    () => { draft.source = ""; return `“${title}” is now a source for this skill.`; });
}

function savePrerequisites({ skill, draft, keys, reasons }: Item) {
  if (reasons.prerequisites) return;
  // The whole set is sent each time; an empty list clears it.
  const chosen = [...draft.prerequisites].sort();
  return act(keys.prerequisites, () => api.courses.skills.prerequisites({ skill: skill.skill, prerequisites: chosen }),
    (kind) => kind === "FORBIDDEN" ? "COURSE_UNAVAILABLE" : kind === "CONFLICT" ? "SKILL_PREREQUISITES_UNAVAILABLE" : "INVALID_SKILL_PREREQUISITES",
    () => { draft.prerequisites = [...chosen]; draft.base.prerequisites = [...chosen]; return chosen.length ? "Prerequisites saved." : "Prerequisites cleared."; });
}

function archive({ skill, keys, reasons }: Item) {
  if (reasons.status) return;
  const id = skill.skill;
  return act(keys.status, () => api.courses.skills.archive({ skill: id }),
    (kind) => kind === "FORBIDDEN" ? "COURSE_UNAVAILABLE" : kind !== "CONFLICT" ? undefined
      : statusOf(id) === "CONFIRMED" && dependentsOf(id).length ? "SKILL_STILL_REQUIRED" : "SKILL_ARCHIVE_UNAVAILABLE",
    // The panel closes; the message moves with the skill to the Archived list.
    () => { open[id] = false; return "Archived. It keeps its history, and you can restore it here."; });
}

function restore({ skill, key, reason }: ArchivedItem) {
  if (reason) return;
  const id = skill.skill, unit = unitTitle(skill.unit);
  return act(key, () => api.courses.skills.restore({ skill: id }),
    (kind) => kind === "FORBIDDEN" ? "COURSE_UNAVAILABLE" : kind !== "CONFLICT" ? undefined
      : statusOf(id) === "ARCHIVED" && archivedPrerequisitesOf(id).length ? "SKILL_RESTORE_PREREQUISITES" : "SKILL_RESTORE_UNAVAILABLE",
    () => unit ? `Restored to “${unit}”.` : "Restored.");
}

function setEmphasis(unit: UnitRow, emphasized: boolean) {
  return act(`${unit.unit}:emphasis`, () => api.courses.units.emphasis({ unit: unit.unit, emphasized }),
    // The unit's ownership is checked before the action runs.
    (kind) => kind === "FORBIDDEN" ? "COURSE_UNAVAILABLE" : undefined,
    () => { emphasis[unit.unit] = emphasized; return emphasized ? "Marked as emphasized by your professor." : "No longer marked as emphasized."; });
}
</script>

<template>
  <section v-if="data.units.length" class="manage-skills" :aria-busy="busy" :aria-labelledby="`${prefix}-title`">
    <div class="manage-head"><h2 :id="`${prefix}-title`">Manage skills</h2><InfoBubble text="Keep your confirmed skills accurate, and mark the units your professor emphasized." /></div>
    <p v-if="!confirmed.length" class="hint">Confirm a skill to rename it, revise it, add sources, or choose its prerequisites here.</p>

    <div v-for="group in groups" :key="group.unit.unit" class="unit-block">
      <div class="unit-head">
        <h3 :id="noteId(`${group.unit.unit}:heading`)">{{ group.unit.title }}<span v-if="group.emphasized" class="emphasis-mark"><span aria-hidden="true">★</span> Emphasized</span></h3>
        <button type="button" role="switch" class="switch" :aria-checked="group.emphasized ? 'true' : 'false'" :aria-describedby="noteId(`${group.unit.unit}:heading`)" :disabled="busy" @click="setEmphasis(group.unit, !group.emphasized)"><span class="switch-track" aria-hidden="true"></span>Emphasized by your professor</button>
      </div>
      <ManageNote :id="noteId(`${group.unit.unit}:emphasis`)" :note="notes[`${group.unit.unit}:emphasis`]" />
      <ul v-if="group.items.length" class="manage-list">
        <li v-for="item in group.items" :key="item.skill.skill">
          <details :open="open[item.skill.skill]" @toggle="toggled(item.skill.skill, $event)">
            <summary><span class="skill-text"><strong>{{ item.skill.title }}</strong><small>{{ item.skill.outcome }}</small></span><span class="manage-label">Manage</span></summary>
            <div v-if="open[item.skill.skill]" class="panel">
              <form class="part" @submit.prevent="saveDetails(item)">
                <h4>Name and unit</h4>
                <div class="name-row">
                  <label>Skill name<input v-model="item.draft.title" type="text" maxlength="160" :disabled="busy" /></label>
                  <label>Unit<select v-model="item.draft.unit" :disabled="busy"><option v-for="unit in data.units" :key="unit.unit" :value="unit.unit">{{ unit.title }}</option></select></label>
                </div>
                <div class="actions"><button class="secondary sand" :disabled="busy || !!item.reasons.details" :aria-describedby="item.reasons.details ? reasonId(item.keys.details) : undefined">{{ working === item.keys.details ? 'Saving…' : 'Save name and unit' }}</button><p v-if="item.reasons.details" :id="reasonId(item.keys.details)" class="hint reason">{{ item.reasons.details }}</p></div>
                <ManageNote :id="noteId(item.keys.details)" :note="notes[item.keys.details]" />
              </form>

              <div class="panel-grid">
              <div class="part part-main">
                <h4>Requirements</h4>
                <p class="info-line"><InfoBubble label="About versions" text="Saving creates a new version. Earlier work keeps the version it used, including a practice session that is still open. The new version needs a new check." /></p>
                <form @submit.prevent="revise(item)">
                  <p class="caption">{{ item.editingDefinition ? 'Unsaved changes' : 'Current version' }}</p>
                  <label>What you should be able to do<textarea v-model="item.draft.outcome" rows="2" maxlength="16000" :disabled="busy" /></label>
                  <label>How you will demonstrate it<textarea v-model="item.draft.gate" rows="3" maxlength="16000" :disabled="busy" /></label>
                  <div class="actions"><button class="secondary sand" :disabled="busy || !!item.reasons.requirements" :aria-describedby="item.reasons.requirements ? reasonId(item.keys.requirements) : undefined">{{ working === item.keys.requirements ? 'Saving…' : 'Save new version' }}</button><p v-if="item.reasons.requirements" :id="reasonId(item.keys.requirements)" class="hint reason">{{ item.reasons.requirements }}</p></div>
                  <ManageNote :id="noteId(item.keys.requirements)" :note="notes[item.keys.requirements]" />
                </form>
                <ol v-if="item.previous.length" class="versions">
                  <li v-for="version in item.previous" :key="version.version"><p class="caption">Previous definition</p><p>{{ version.outcome }}</p><p class="gate"><span>How to demonstrate it:</span> {{ version.gate }}</p></li>
                </ol>
              </div>

              <div class="part-side">
              <div class="part">
                <h4>Sources</h4>
                <ul v-if="item.sources.length" class="chips"><li v-for="(title, index) in item.sources" :key="index">{{ title }}</li></ul>
                <form v-if="item.addable.length" @submit.prevent="addSource(item)">
                  <label>Add a source<select v-model="item.draft.source" :disabled="busy"><option value="">Choose a material</option><option v-for="material in item.addable" :key="material.material" :value="material.material">{{ material.title }}</option></select></label>
                  <p class="info-line"><InfoBubble label="About sources" text="A source stays with the skill once it is added." /></p>
                  <div class="actions"><button class="secondary sand" :disabled="busy || !!item.reasons.sources" :aria-describedby="item.reasons.sources ? reasonId(item.keys.sources) : undefined">{{ working === item.keys.sources ? 'Adding…' : 'Add source' }}</button><p v-if="item.reasons.sources" :id="reasonId(item.keys.sources)" class="hint reason">{{ item.reasons.sources }}</p></div>
                </form>
                <p v-else class="hint">Every material in this course is already a source for this skill.</p>
                <ManageNote :id="noteId(item.keys.sources)" :note="notes[item.keys.sources]" />
              </div>

              <form class="part" @submit.prevent="savePrerequisites(item)">
                <fieldset :disabled="busy">
                  <legend><h4>Prerequisites</h4></legend>
                  <p class="hint">{{ item.builtOn.length ? `Builds on ${quoted(item.builtOn)}.` : 'No prerequisites yet.' }}</p>
                  <template v-if="item.candidates.length">
                    <p class="info-line"><InfoBubble label="About prerequisites" text="Choose the skills to learn before this one. Saving replaces the whole list." /></p>
                    <div class="choices"><label v-for="choice in item.candidates" :key="choice.skill" class="check"><input v-model="item.draft.prerequisites" type="checkbox" :value="choice.skill" /><span>{{ choice.title }}<small v-if="choice.detail">{{ choice.detail }}</small></span></label></div>
                    <div class="actions"><button class="secondary sand" :disabled="busy || !!item.reasons.prerequisites" :aria-describedby="item.reasons.prerequisites ? reasonId(item.keys.prerequisites) : undefined">{{ working === item.keys.prerequisites ? 'Saving…' : 'Save prerequisites' }}</button><p v-if="item.reasons.prerequisites" :id="reasonId(item.keys.prerequisites)" class="hint reason">{{ item.reasons.prerequisites }}</p></div>
                  </template>
                  <p v-else class="hint">Confirm another skill in this course to choose prerequisites.</p>
                </fieldset>
                <ManageNote :id="noteId(item.keys.prerequisites)" :note="notes[item.keys.prerequisites]" />
              </form>

              </div>
              </div>
              <div class="part foot">
                <h4>Archive</h4>
                <p class="info-line"><InfoBubble label="About archiving" text="An archived skill leaves your tree and plan. It keeps its history, and you can restore it." /></p>
                <div class="actions"><button type="button" class="secondary sand" :disabled="busy || !!item.reasons.status" :aria-describedby="item.reasons.status ? reasonId(item.keys.status) : undefined" @click="archive(item)">{{ working === item.keys.status ? 'Archiving…' : 'Archive skill' }}</button><p v-if="item.reasons.status" :id="reasonId(item.keys.status)" class="hint reason">{{ item.reasons.status }}</p></div>
              </div>
            </div>
          </details>
          <div class="item-note"><ManageNote :id="noteId(item.keys.status)" :note="notes[item.keys.status]" /></div>
        </li>
      </ul>
      <p v-else class="hint empty-unit">No confirmed skills in this unit yet.</p>
    </div>

    <section v-if="archived.length" class="archived" :aria-labelledby="`${prefix}-archived`">
      <h3 :id="`${prefix}-archived`">Archived</h3>
      <p class="info-line"><InfoBubble label="About archived skills" text="Archived skills are off your tree and plan. Restoring one brings it back with its history." /></p>
      <ul class="manage-list">
        <li v-for="item in archived" :key="item.skill.skill">
          <div class="archived-row">
            <span class="skill-text"><strong>{{ item.skill.title }}</strong><small>{{ item.unitTitle }}</small></span>
            <div class="actions end"><button type="button" class="secondary sand" :aria-label="`Restore ${item.skill.title}`" :disabled="busy || !!item.reason" :aria-describedby="item.reason ? reasonId(item.key) : undefined" @click="restore(item)">{{ working === item.key ? 'Restoring…' : 'Restore' }}</button><p v-if="item.reason" :id="reasonId(item.key)" class="hint reason">{{ item.reason }}</p></div>
          </div>
          <div class="item-note"><ManageNote :id="noteId(item.key)" :note="notes[item.key]" /></div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.manage-skills{margin-top:26px}.manage-skills>h2{font:500 22px var(--font-display);margin:0 0 6px}.intro{margin:0}
.unit-head{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 16px;margin:18px 0 6px}.unit-head h3,.archived h3{display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0;margin:0;font-size:12px;font-weight:600;color:var(--muted);overflow-wrap:anywhere}
.emphasis-mark{display:inline-flex;align-items:center;gap:4px;border-radius:999px;background:var(--sand-soft);color:var(--sand-mark-text);padding:2px 9px;font-size:11px;font-weight:600}
.switch{display:inline-flex;align-items:center;gap:8px;border:0;background:none;padding:4px 0;font-size:12px;color:var(--ink);text-align:left}.switch-track{position:relative;flex:none;width:32px;height:18px;border-radius:9px;background:var(--faint)}.switch-track::after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--on-fill);box-shadow:0 1px 2px rgb(var(--shadow) / .3)}.switch[aria-checked="true"] .switch-track{background:var(--sand-soft-text)}.switch[aria-checked="true"] .switch-track::after{transform:translateX(14px)}
.manage-list{list-style:none;margin:0;padding:0;background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden}.manage-list>li+li{border-top:1px solid var(--line)}
summary{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}summary:hover{background:var(--inset)}summary::after{content:"›";font-size:18px;line-height:1;color:var(--muted)}details[open]>summary::after{transform:rotate(90deg)}
.skill-text{flex:1;min-width:0}.skill-text strong{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.skill-text small{display:block;font-size:12px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.manage-label{font-size:12px;font-weight:600;color:var(--sand-soft-text)}
.panel{padding:0 14px 6px;background:var(--inset);border-top:1px solid var(--line)}.part{max-width:none;padding:14px 0;border-top:1px solid var(--line)}.part:first-child{border-top:0}.part form{max-width:none}.part h4,.part legend{margin:0;padding:0;font:400 12px var(--font-display);letter-spacing:1px;text-transform:uppercase;color:var(--muted)}fieldset{min-width:0;margin:0;padding:0;border:0}
.part>h4{display:inline-flex;align-items:center;vertical-align:middle}.part>h4+.info-line{display:inline-flex;vertical-align:middle;margin:0 0 0 2px}
.name-row{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(150px,1fr);gap:0 12px}
.panel-grid{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:0 28px}.part-main{border-top:1px solid var(--line)}.part-side>.part:first-child{border-top:1px solid var(--line)}
.part.foot{display:flex;align-items:center;flex-wrap:wrap;gap:8px 14px}.part.foot h4{flex:none}.part.foot .info-line{flex:1 1 auto;margin:0}.part.foot .actions{margin-top:0}
@media(max-width:900px){.panel-grid{grid-template-columns:1fr}.part-side>.part:first-child{border-top:1px solid var(--line)}.name-row{grid-template-columns:1fr}}
label{margin:12px 0 0;font-size:12px}input[type=text]{min-height:40px;margin-top:6px;padding:8px 12px;font-size:14px}select,textarea{display:block;width:100%;margin-top:6px;padding:9px 12px;border:1px solid var(--faint);border-radius:8px;background:var(--field);color:var(--ink);font:inherit;font-size:14px}textarea{resize:vertical;line-height:1.5}
.actions{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;margin-top:12px}.actions .reason{flex:1 1 220px;margin:0}.secondary{min-height:34px;padding:0 13px;font-size:13px;background:var(--card)}
.caption{margin:12px 0 0;font-size:11px;font-weight:600;color:var(--faint)}
.versions{display:grid;gap:8px;list-style:none;margin:14px 0 0;padding:0}.versions li{padding:10px 12px;border-radius:10px;background:var(--card);border:1px solid var(--line)}.versions .caption{margin:0 0 4px}.versions p{margin:0;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.versions .gate{margin-top:6px;color:var(--muted)}.versions .gate span{font-weight:600;color:var(--ink)}
.chips{display:flex;flex-wrap:wrap;gap:8px;list-style:none;margin:10px 0 0;padding:0}.chips li{max-width:100%;padding:4px 11px;border:1px solid var(--line);border-radius:999px;background:var(--card);font-size:12px;overflow-wrap:anywhere}
.choices{margin-top:6px}.check{display:flex;align-items:flex-start;gap:10px;margin:8px 0;font-size:13px;font-weight:400}.check input{flex:none;width:16px;height:16px;min-height:16px;margin:3px 0 0;padding:0;accent-color:var(--sand-soft-text)}.check span{min-width:0;overflow-wrap:anywhere}.check small{display:block;font-size:12px;color:var(--muted)}
.item-note:has(p){padding:0 14px 12px}.empty-unit{margin:4px 0 0}
.archived{margin-top:22px}.archived h3{margin-bottom:0}.archived>.hint{margin:4px 0 8px}.archived-row{display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;padding:12px 14px}.archived-row .skill-text{min-width:140px}.actions.end{flex:0 1 auto;justify-content:flex-end;margin-top:0}.actions.end>.reason{left:auto!important;right:0}
.switch-track{transition:background-color var(--dur-quick) var(--ease-enter)}.switch-track::after,summary::after{transition:transform var(--dur-quick) var(--ease-move)}
@media(max-width:650px){summary,.archived-row{padding:12px}.panel{padding:0 12px 4px}.item-note:has(p){padding:0 12px 12px}.manage-label{display:none}}
.manage-head{display:flex;align-items:center;gap:6px;margin:0 0 6px}.manage-head h2{font:500 22px var(--font-display);margin:0}.info-line{margin:2px 0}
</style>
