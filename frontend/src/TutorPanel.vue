<script lang="ts">
// Settings and the Tutor dialog each hold a panel, and every panel shows the same record (`tutorSettings`). Requests
// from all panels share one count, so an older reply never replaces a newer one, whichever panel sent it. The record is
// read when the first panel mounts, after sign-in, and cleared when the last one unmounts.
let issued = 0, shown = 0, panels = 0;
</script>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId } from "vue";
import { api, failureText } from "./api.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import InfoBubble from "./InfoBubble.vue";
import { TUTOR_ABOUT, levelName, modelName, orderedLevels, tutorSettings, type TutorModel, type TutorSettings } from "./tutor-choice.ts";

// `inline` renders the same form as a section inside a host dialog (Settings or the Tutor dialog) instead of its own
// dialog. `untitled` leaves out the panel's own title, for a host that shows its own.
const props = defineProps<{ inline?: boolean; untitled?: boolean }>();
// "saved" follows a successful Save or "Use app default".
const emit = defineEmits<{ saved: [] }>();
// Two panels can be in the page at once, so ids and radio group names are made unique to each.
const id = useId();
const dialog = ref<HTMLDialogElement | null>(null), heading = ref<HTMLElement | null>(null), statusLine = ref<HTMLElement | null>(null);
const noticeBox = ref<HTMLElement | null>(null), errorBox = ref<HTMLElement | null>(null);
const reading = ref(false), working = ref<"" | "save" | "clear">(""), error = ref(""), notice = ref("");
// The form's selection. It starts from the record and changes when the learner picks an option, saves, or clears.
const model = ref(""), level = ref(""), picked = ref(false);
const busy = computed(() => working.value !== "");
const settings = tutorSettings;
const selected = computed(() => settings.value?.models.find((offer) => offer.model === model.value));
// Only the levels the selected model lists are offered.
const levels = computed(() => selected.value ? orderedLevels(selected.value.levels) : []);
const canSave = computed(() => levels.value.some((item) => item === level.value));
// A long request at this level may not finish within the tutor's 80-second limit.
const slow = computed(() => !!selected.value && selected.value.slowLevels.some((item) => item === level.value));
// "Use app default" clears a saved choice, so it appears only when one is saved.
const hasSaved = computed(() => settings.value?.status === "SAVED" || settings.value?.status === "RETIRED");
const statusText = computed(() => {
  const record = settings.value;
  if (!record) return "";
  const choice = `${modelName(record.choice.model, record)} with ${levelName(record.choice.level)} thinking`;
  if (record.status === "SAVED") return `You chose ${choice}.`;
  if (record.status === "RETIRED") return `Your saved choice, ${choice}, is no longer offered. Choose another one, or use the app default.`;
  return `You're using the app default, ${choice}.`;
});

// Replies can arrive out of order. A record is shown only when no later request's reply has been shown already.
let pendingReads = 0, mounted = true;
function show(ticket: number, record: TutorSettings) {
  if (!mounted || ticket <= shown) return false;
  shown = ticket;
  tutorSettings.value = record;
  return true;
}

/** Selects the record's choice. A saved model that is no longer offered selects nothing; a level it no longer lists selects its default. */
function selectFrom(record: TutorSettings) {
  const offer = record.models.find((item) => item.model === record.choice.model);
  model.value = offer?.model ?? "";
  level.value = !offer ? "" : offer.levels.some((item) => item === record.choice.level) ? record.choice.level : offer.defaultLevel;
  picked.value = false;
}

/** Reads the record and shows it. Returns the sentence to show when the read fails, or "" when it succeeds. */
async function read(): Promise<string> {
  const ticket = ++issued;
  pendingReads++; reading.value = true;
  try {
    const result = await api.settings.tutor({});
    if ("error" in result) return failureText(result);
    // Keep an option the learner picked while the record was loading.
    if (show(ticket, result.settings) && !picked.value && !busy.value) selectFrom(result.settings);
    return "";
  } catch {
    return failureText({ error: "NETWORK_ERROR" });
  } finally {
    reading.value = --pendingReads > 0;
  }
}

/**
 * Where focus starts: a choice that is no longer offered starts on the status line that asks the learner to choose
 * again. Otherwise it starts on the panel's title, or, when the host shows the title, on the chosen model.
 */
function startFocus(): HTMLElement | null {
  if (settings.value?.status === "RETIRED") return statusLine.value;
  if (!props.untitled) return heading.value;
  const radios = dialog.value?.querySelectorAll<HTMLInputElement>(`input[name="${id}-model"]`) ?? [];
  return [...radios].find((radio) => radio.checked) ?? radios[0] ?? null;
}

/**
 * Opens the panel on the latest record, then reads it again so a choice saved in another browser shows here. With
 * `focus` false the panel only refreshes and leaves focus where the host put it.
 */
async function open(focus = true) {
  const element = dialog.value;
  if (!element) return;
  error.value = ""; notice.value = "";
  if (settings.value) selectFrom(settings.value);
  if (!props.inline && !element.open) element.showModal();
  await nextTick();
  if (focus) startFocus()?.focus();
  const focused = document.activeElement;
  const problem = await read();
  if (!props.inline && !element.open) return;
  if (problem) { error.value = problem; return; }
  await nextTick();
  // The reply can change where focus should start, for example to the status line of a choice no longer offered.
  if (focus && document.activeElement === focused) startFocus()?.focus();
}

function chooseModel(offer: TutorModel) {
  // Changing the model selects that model's default level.
  model.value = offer.model; level.value = offer.defaultLevel; picked.value = true; notice.value = ""; error.value = "";
}
function chooseLevel() { picked.value = true; notice.value = ""; error.value = ""; }

/** Save calls ChooseTutor and "Use app default" calls ClearTutor. The message names the returned record's choice, not the form's. */
async function change(action: "save" | "clear") {
  if (busy.value || (action === "save" && !canSave.value)) return;
  const previous = focusedControl();
  working.value = action; error.value = ""; notice.value = "";
  const ticket = ++issued;
  try {
    const result = action === "save" ? await api.settings.tutor.choose({ model: model.value, level: level.value }) : await api.settings.tutor.clear({});
    if ("error" in result) error.value = failureText(result);
    else {
      show(ticket, result.settings);
      selectFrom(result.settings);
      const choice = result.settings.choice;
      notice.value = `Saved. Your next tutor request will use ${modelName(choice.model, result.settings)} with ${levelName(choice.level)} thinking.`;
      emit("saved");
    }
  } catch {
    error.value = failureText({ error: "NETWORK_ERROR" });
  } finally {
    working.value = "";
    await nextTick();
    restoreFocus(previous, () => error.value ? errorBox.value : noticeBox.value);
  }
}

// The panel stays open while a change is saving, so the learner sees its result.
function cancel(event: Event) { if (busy.value) event.preventDefault(); }
function close() { if (!busy.value && !props.inline) dialog.value?.close(); }

// The panels exist only while someone is signed in, so mounting the first one is the read after sign-in.
onMounted(() => { if (panels++ === 0) void read(); });
onBeforeUnmount(() => { mounted = false; if (--panels === 0) tutorSettings.value = null; });
defineExpose({ open, busy });
</script>

<template>
  <component :is="inline ? 'section' : 'dialog'" ref="dialog" class="tutor-panel" :class="{ inline }" :aria-labelledby="untitled ? undefined : `${id}-title`" @cancel="cancel">
    <div v-if="!untitled" class="tutor-head"><h2 :id="`${id}-title`" ref="heading" tabindex="-1">Tutor</h2><InfoBubble label="About the tutor" :text="TUTOR_ABOUT" /></div>
    <p v-if="settings" ref="statusLine" class="tutor-status" :class="{ retired: settings.status === 'RETIRED' }" tabindex="-1">{{ statusText }}</p>
    <div role="status"><p v-if="!settings && reading" class="tutor-status">Loading your tutor choice…</p></div>
    <template v-if="settings">
      <fieldset class="tutor-group" :disabled="busy">
        <legend>Model</legend>
        <label v-for="offer in settings.models" :key="offer.model" class="model-option" :class="{ chosen: model === offer.model }">
          <input type="radio" :name="`${id}-model`" :value="offer.model" :checked="model === offer.model" :aria-labelledby="`${id}-name-${offer.model}`" :aria-describedby="`${id}-about-${offer.model} ${id}-tradeoff-${offer.model}`" @change="chooseModel(offer)" />
          <span class="option-text">
            <span :id="`${id}-name-${offer.model}`" class="option-name">{{ offer.name }}<span v-if="offer.appDefault" class="option-tag"><span class="sr-only">, </span>App default</span></span>
            <span :id="`${id}-about-${offer.model}`" class="option-about">{{ offer.description }}</span>
            <span :id="`${id}-tradeoff-${offer.model}`" class="option-tradeoff">{{ offer.tradeoff }}</span>
          </span>
        </label>
      </fieldset>
      <fieldset class="tutor-group" :disabled="busy" :aria-describedby="`${id}-level-help`">
        <legend>Thinking level</legend>
        <div v-if="selected" class="level-options">
          <label v-for="item in levels" :key="item" class="level-option" :class="{ chosen: level === item }">
            <input v-model="level" type="radio" :name="`${id}-level`" :value="item" @change="chooseLevel" />{{ levelName(item) }}<span v-if="item === selected.defaultLevel" class="option-tag"><span class="sr-only">, </span>Model default</span>
          </label>
        </div>
        <p v-else class="hint">Choose a model to see its thinking levels.</p>
        <p :id="`${id}-level-help`" class="hint">More thinking can give more careful answers, but it takes longer and costs more. Less thinking is faster.</p>
      </fieldset>
      <div role="status"><p v-if="slow && selected" class="tutor-warning">{{ levelName(level) }} thinking on {{ selected.name }} can take longer than the tutor's 80-second limit on long materials. If a request times out, choose a lower level or a Flash model.</p></div>
    </template>
    <div class="tutor-actions">
      <span v-if="settings" class="save-action"><button class="primary meadow" type="button" :disabled="busy || !canSave" :aria-describedby="canSave ? undefined : `${id}-save-reason`" @click="change('save')">{{ working === 'save' ? 'Saving…' : 'Save' }}</button><p v-if="!canSave" :id="`${id}-save-reason`" class="hint reason">Choose a model and a thinking level first.</p></span>
      <button v-if="hasSaved" class="secondary meadow" type="button" :disabled="busy" @click="change('clear')">{{ working === 'clear' ? 'Saving…' : 'Use app default' }}</button>
      <button v-if="!inline" class="secondary meadow" type="button" :disabled="busy" @click="close">Close</button>
      <!-- A host dialog adds its own actions here, such as Cancel. -->
      <slot name="actions" />
    </div>
    <div role="status"><p v-if="notice" ref="noticeBox" class="notice" tabindex="-1">{{ notice }}</p></div>
    <div role="alert"><p v-if="error" ref="errorBox" class="error" tabindex="-1">{{ error }}</p></div>
  </component>
</template>

<style scoped>
.tutor-panel{border:0;border-radius:22px;padding:24px;width:min(560px,calc(100vw - 32px));box-shadow:0 20px 50px rgb(var(--shadow) / .18);color:var(--ink);background:var(--card)}.tutor-panel::backdrop{background:var(--backdrop)}
.tutor-head{display:flex;align-items:center;gap:6px;margin:0 0 10px}.tutor-panel h2{font:500 22px var(--font-display);margin:0}.tutor-panel.inline{padding:0;width:auto;box-shadow:none;border-radius:0}.tutor-intro{font-size:13px;color:var(--muted);margin:0 0 14px}
.tutor-status{margin:0;padding:10px 12px;border-left:3px solid var(--strong);border-radius:0 10px 10px 0;background:var(--inset);font-size:14px}.tutor-status.retired{border-left-color:var(--error)}
.tutor-group{min-width:0;margin:18px 0 0;padding:0;border:0}.tutor-group legend{padding:0;margin:0 0 8px;font-size:14px;font-weight:600}.tutor-group .hint{margin:8px 0 0}
.model-option{display:flex;align-items:flex-start;gap:12px;margin:0 0 8px;padding:12px 14px;border:1px solid var(--ring);border-radius:14px;font-size:14px;font-weight:400;cursor:pointer}.model-option:hover{border-color:var(--meadow-edge)}.model-option.chosen{border-color:var(--meadow-edge);background:var(--meadow-soft);box-shadow:0 0 0 1px var(--meadow-edge)}
.tutor-panel input[type=radio]{flex:none;width:18px;height:18px;min-height:0;margin:2px 0 0;padding:0;accent-color:var(--meadow-edge);cursor:pointer}
.option-text{display:flex;flex-direction:column;gap:2px;min-width:0}.option-name{font-weight:600}.option-about{font-size:13px}.option-tradeoff{font-size:13px;color:var(--muted)}
.option-tag{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:10px;background:var(--meadow-soft);color:var(--strong);font-size:11px;font-weight:600;line-height:1.6;vertical-align:1px}.chosen .option-tag{background:var(--card)}
.level-options{display:flex;flex-wrap:wrap;gap:8px}.level-option{display:flex;align-items:center;gap:8px;margin:0;padding:8px 14px 8px 12px;border:1px solid var(--line);border-radius:999px;font-size:14px;font-weight:400;cursor:pointer}.level-option:hover{border-color:var(--meadow-edge)}.level-option.chosen{border-color:var(--meadow-edge);background:var(--meadow-nav);font-weight:700}.tutor-panel .level-option input[type=radio]{margin:0}
.tutor-warning{margin:14px 0 0;padding:10px 12px;border-left:3px solid var(--meadow-edge);background:var(--inset);font-size:13px}
.tutor-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:20px}.tutor-actions button{min-height:40px;padding:6px 18px;font-size:14px}.save-action{display:inline-flex;flex-direction:column}.save-action .reason{margin:6px 0 0;font-size:12px}
.tutor-panel .notice,.tutor-panel .error{margin:14px 0 0}.tutor-panel .error{background:var(--inset)}
.tutor-privacy{margin:18px 0 0;padding-top:12px;border-top:1px solid var(--line);font-size:13px;color:var(--muted)}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
@media(max-width:480px){.tutor-panel{padding:20px 16px}.model-option{padding:10px 12px}}
</style>
