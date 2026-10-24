<script setup lang="ts">
/**
 * The library's unfinished imports ("Unfinished imports in the library" in design/compositions/Materials.md): a card
 * for each import that is saving, transcribing, or failed, with its files' states, Try again, and Remove. It lists the
 * course's imports when it mounts, when listImportsAgain(course) asks, when Course materials comes back on screen
 * with an import in progress or a listing error, and every 15 seconds while it is on screen and an import is still
 * transcribing or saving. The route saves each import whose transcripts are finished before it lists.
 *
 * Props: `course`; `active`, true while Course materials is on screen; `busy`, true while the page is working, which
 * disables Try again and Remove.
 * Events: `ready(saved)` when a listing saved materials (`saved` holds their IDs) or when an import the library was
 * showing is no longer listed (`saved` may then be empty): the page reloads the course and names the saved materials;
 * `shown(shown)` whether there is an import or a listing error to show; `removed(requestId)` after Remove succeeds.
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { listImports, removeImport, retryImport, type ImportEntry, type ImportListing } from "./host-api.ts";
import { focusedControl, restoreFocus } from "./focus.ts";
import { fileStateLabels, importFailure, importsInProgress, importStatus, showImportListing } from "./material-imports.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";

type CourseId = StillGotItHttp["/courses/read"]["input"]["course"];
type MaterialId = StillGotItHttp["/courses/materials/read"]["input"]["material"];

const props = defineProps<{ course: CourseId; active: boolean; busy?: boolean }>();
const emit = defineEmits<{ ready: [saved: MaterialId[]]; shown: [shown: boolean]; removed: [requestId: string] }>();

const POLL_MS = 15_000;
// listError is the listing's failure. cardErrors holds each import's refusal, shown in its card.
const imports = ref<ImportEntry[]>([]), listError = ref(""), cardErrors = reactive<Record<string, string>>({}), acting = ref<string | null>(null);
const root = ref<HTMLElement | null>(null), cards = new Map<string, HTMLElement>();
const shown = computed(() => imports.value.length > 0 || !!listError.value);
watch(shown, (value) => emit("shown", value));
// Only the newest listing replaces the shown imports. An import action makes listings already on their way stale.
let listingsStarted = 0, pollTimer: ReturnType<typeof setTimeout> | undefined, closed = false;

function setCard(requestId: string, element: unknown) {
  if (element instanceof HTMLElement) cards.set(requestId, element);
  else cards.delete(requestId);
}

/**
 * Lists the course's unfinished imports. The page reloads the course when the listing saved a material, or when an
 * import the library was showing is no longer listed, so a material saved by another tab or by a listing whose reply
 * was lost still appears.
 */
async function load() {
  const listing = ++listingsStarted;
  clearTimeout(pollTimer); pollTimer = undefined;
  let result: ImportListing;
  try { result = await listImports(props.course); }
  catch (problem) {
    if (listing === listingsStarted && !closed) { listError.value = problem instanceof Error ? problem.message : "Unfinished imports could not be listed."; schedulePoll(); }
    return;
  }
  if (closed) return;
  const latest = listing === listingsStarted, listed = new Set(result.imports.map((entry) => entry.requestId));
  const left = latest && imports.value.some((entry) => !listed.has(entry.requestId));
  if (latest) {
    imports.value = result.imports; listError.value = "";
    for (const id of Object.keys(cardErrors)) if (!listed.has(id)) delete cardErrors[id];
  }
  if (result.saved.length || left) emit("ready", result.saved);
  if (latest) schedulePoll();
}
/** Lists again in 15 seconds while Course materials is on screen and shows an import that is transcribing or saving. */
function schedulePoll() {
  clearTimeout(pollTimer); pollTimer = undefined;
  if (!closed && props.active && importsInProgress(imports.value)) pollTimer = setTimeout(() => void load(), POLL_MS);
}
watch(() => props.active, (active) => {
  if (!active) { clearTimeout(pollTimer); pollTimer = undefined; }
  // Coming back to Course materials: catch up at once rather than waiting for the next turn.
  else if (importsInProgress(imports.value) || listError.value) void load();
});
let hide: (() => void) | undefined;
// Listing can wait on other work, such as a tutor request, so it runs beside the page's own loading.
onMounted(() => { hide = showImportListing(props.course, load); void load(); });
onBeforeUnmount(() => { closed = true; clearTimeout(pollTimer); hide?.(); });

const onScreen = (element: HTMLElement | null | undefined) => !!element?.isConnected && element.getClientRects().length > 0;
/**
 * Try again and Remove. Their refusal sentences appear in the import's own card. Focus returns to the control used,
 * else to the card, else to the heading of the section the cards sit in, else to the page heading.
 */
async function act(entry: ImportEntry, work: () => Promise<void>) {
  const previous = focusedControl(), section = root.value?.closest("section");
  acting.value = entry.requestId; delete cardErrors[entry.requestId];
  try { await work(); listingsStarted++; }
  catch (problem) { cardErrors[entry.requestId] = problem instanceof Error ? problem.message : "This import could not be changed. Try again."; }
  finally {
    acting.value = null; schedulePoll(); await nextTick();
    restoreFocus(previous, () => [cards.get(entry.requestId), section?.querySelector<HTMLElement>(":scope > h2"), document.getElementById("setup-title")].find(onScreen));
  }
}
function retry(entry: ImportEntry) {
  return act(entry, async () => {
    const updated = await retryImport(entry.requestId);
    imports.value = imports.value.map((item) => item.requestId === updated.requestId ? updated : item);
  });
}
function remove(entry: ImportEntry) {
  return act(entry, async () => {
    await removeImport(entry.requestId);
    imports.value = imports.value.filter((item) => item.requestId !== entry.requestId);
    // The upload form may still hold this import's request ID after an upload that got no answer.
    emit("removed", entry.requestId);
  });
}
</script>

<template>
  <div v-if="shown" ref="root" class="material-imports">
    <p v-if="listError" class="hint imports-error">{{ listError }}</p>
    <ul v-if="imports.length" class="import-list" aria-label="Unfinished imports">
      <li v-for="entry in imports" :key="entry.requestId" :ref="(element) => setCard(entry.requestId, element)" class="import-row" :class="entry.state.toLowerCase()" tabindex="-1">
        <div class="import-main"><span class="doc-icon" aria-hidden="true"><svg v-if="entry.state === 'FAILED'" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="7"/><path d="M9 5v5M9 12.4v.6"/></svg><svg v-else width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="9" cy="9" r="7"/><path d="M9 5v4l2.6 2"/></svg></span>
          <div class="import-text"><strong>{{ entry.title }}</strong><p class="import-status">{{ importStatus(entry) }}</p></div>
          <div v-if="(entry.state === 'FAILED' && entry.canRetry) || entry.canRemove" class="row-actions"><button v-if="entry.state === 'FAILED' && entry.canRetry" class="small-button" :disabled="busy || !!acting" @click="retry(entry)">Try again</button><button v-if="entry.canRemove" class="quiet" :disabled="busy || !!acting" @click="remove(entry)">Remove</button></div></div>
        <div class="import-detail">
          <ul v-if="entry.state === 'TRANSCRIBING'" class="import-files"><li v-for="(file, index) in entry.files" :key="index"><span class="import-file-name">{{ file.name }}</span><span class="file-state" :class="file.state.toLowerCase()">{{ fileStateLabels[file.state] }}</span></li></ul>
          <p v-if="importFailure(entry)" class="import-failure">{{ importFailure(entry) }}</p>
          <div role="alert"><p v-if="cardErrors[entry.requestId]" class="error import-error">{{ cardErrors[entry.requestId] }}</p></div>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
/* The cards match the library's material rows. The bottom margin spaces them from the saved materials below. */
.imports-error{margin:0 0 10px}.import-list{list-style:none;margin:0 0 12px;padding:0;background:var(--surface);border:1px solid var(--line);border-radius:16px;overflow:hidden}.import-row+.import-row{border-top:1px solid var(--line)}
.import-main{display:flex;align-items:center;gap:12px;padding:12px 14px;flex-wrap:wrap}.doc-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:9px;background:var(--light);color:var(--primary);flex:none}.import-row.failed .doc-icon{color:var(--error);background:var(--surface);box-shadow:inset 0 0 0 1px var(--error)}
.import-text{flex:1;min-width:140px}.import-text strong{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.import-status{margin:2px 0 0;font-size:12px;line-height:1.45;color:var(--muted)}.row-actions{display:flex;align-items:center;gap:12px;flex:none}.small-button{padding:6px 12px;font-size:13px}
.import-detail{padding:0 14px 0 62px}.import-files{list-style:none;margin:0 0 12px;padding:0;display:grid;gap:4px}.import-files li{display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-size:12px}.import-file-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-state{flex:none;font-weight:600;color:var(--muted)}.file-state.done{color:var(--success)}.file-state.transcribing{color:var(--primary)}.file-state.failed{color:var(--error)}.import-failure{margin:0 0 12px;font-size:13px}.import-error{margin:0 0 12px;padding:8px 12px;font-size:13px}
@media(max-width:650px){.import-detail{padding-left:14px}}
</style>
