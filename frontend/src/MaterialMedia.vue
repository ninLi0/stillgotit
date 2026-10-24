<script setup lang="ts">
/**
 * One saved material's files, each with its readable parts: text blocks, scanned pages ("Page N has no selectable
 * text. The tutor reads it as an image." with "Show page N"), images with a download fallback when the browser cannot
 * show them (HEIC), and recordings with a player and their time-range transcript segments. It reads the material
 * itself and loads a file's bytes only when that file is opened.
 *
 * Props: `material`, the material to show; `location` (optional), a cited location to open at, such as
 * `key/page/3` or `key/time/12:30-12:45`; `titled` (optional), show the material's title as a heading; `file`
 * (optional), show only that retained file, as the Materials viewer does for a recording or HEIC photo page.
 * Events: `loaded(source)`, once the material is read, with the `/courses/materials/read` answer.
 */
import { computed, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch } from "vue";
import { api, unwrap } from "./api.ts";
import { materialFile } from "./host-api.ts";
import { pageOf, placeLabel, timeRangeOf } from "./locations.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";

type MaterialData = StillGotItHttp["/courses/materials/read"]["output"];
type MaterialId = StillGotItHttp["/courses/materials/read"]["input"]["material"];
type Original = MaterialData["originals"][number];
type Rendition = Original["renditions"][number];
type Kind = "pdf" | "image" | "audio" | "video" | "text";

// `location` opens the view at a cited place. `titled` shows the material's title as a heading.
const props = defineProps<{ material: MaterialId; location?: string; titled?: boolean; file?: string }>();
const emit = defineEmits<{ loaded: [source: MaterialData] }>();

/** One retained file: whether its viewer is open, its bytes once loaded, and the PDF page on show. */
type FileView = { open: boolean; status: "idle" | "loading" | "ready" | "failed"; url: string; error: string; unavailable: boolean; downloading: boolean; page: number | null };
const source = shallowRef<MaterialData | null>(null), loading = ref(false), loadError = ref(""), cited = ref("");
const root = ref<HTMLElement | null>(null);
// Keyed by file reference. An image rendition's file has its own entry, which for an uploaded image is the original.
const views = reactive<Record<string, FileView>>({});
const pending = new Map<string, Promise<string | null>>(), seeks = new Map<string, number>(), players = new Map<string, HTMLMediaElement>();
let controller = new AbortController();
// Only a browser that reports it has no built-in PDF viewer gets the download instead.
const pdfViewer = navigator.pdfViewerEnabled !== false;
// The saved media type for a few recordings differs from the name browsers use to play them.
const playable: Record<string, string> = { "audio/mp3": "audio/mpeg", "video/mov": "video/quicktime", "video/avi": "video/x-msvideo", "video/wmv": "video/x-ms-wmv" };

function kindOf(file: Original): Kind {
  const type = file.mediaType.toLowerCase();
  return type === "application/pdf" ? "pdf" : type.startsWith("image/") ? "image" : type.startsWith("audio/") ? "audio" : type.startsWith("video/") ? "video" : "text";
}
function kindLabel(file: Original): string {
  const kind = kindOf(file), dot = file.name.lastIndexOf(".");
  if (kind !== "text") return { pdf: "PDF", image: "Image", audio: "Audio", video: "Video" }[kind];
  return dot > 0 ? file.name.slice(dot + 1).toUpperCase().slice(0, 5) : "Text";
}
const isRecording = (file: Original) => kindOf(file) === "audio" || kindOf(file) === "video";
const pageNumber = (part: Rendition) => part.kind === "PAGE" ? part.page : pageOf(part.location);
// The files on show: every retained file, or only `file`.
const shown = computed(() => source.value?.originals.filter((original) => !props.file || original.file === props.file) ?? []);
// Older materials may keep their text only in `content`. Show it when no file has text of its own, and every file is on show.
const looseText = computed(() => source.value && !props.file && !source.value.originals.some((file) => file.renditions.some((part) => part.kind === "TEXT"))
  ? source.value.content.trim() : "");
const blankView = (): FileView => ({ open: false, status: "idle", url: "", error: "", unavailable: false, downloading: false, page: null });

function reset() {
  controller.abort(); controller = new AbortController();
  for (const view of Object.values(views)) if (view.url) URL.revokeObjectURL(view.url);
  for (const file of Object.keys(views)) delete views[file];
  pending.clear(); seeks.clear(); players.clear();
  source.value = null; cited.value = "";
}

async function readSource() {
  reset();
  const material = props.material;
  loading.value = true; loadError.value = "";
  try {
    const result = unwrap(await api.courses.materials.read({ material }));
    if (material !== props.material) return;
    for (const file of result.originals) {
      views[file.file] = blankView();
      for (const part of file.renditions) if (part.kind === "IMAGE") views[part.file] ??= blankView();
    }
    source.value = result;
    emit("loaded", result);
    // A material with one file opens that file's viewer, unless it is a recording: its viewer loads the whole recording.
    const listed = result.originals.filter((original) => !props.file || original.file === props.file);
    const only = listed.length === 1 ? listed[0]! : null;
    if (only && !isRecording(only)) openFile(only);
    loading.value = false;
    await goTo(props.location);
  } catch (problem) {
    if (material === props.material) loadError.value = problem instanceof Error ? problem.message : "This material could not be opened. Try again.";
  } finally {
    if (material === props.material) loading.value = false;
  }
}

/** Loads a file's bytes through the file route, once, and answers a local address for them. */
function fetchBytes(file: string, mediaType: string): Promise<string | null> {
  const view = views[file];
  if (!view) return Promise.resolve(null);
  if (view.url) return Promise.resolve(view.url);
  const running = pending.get(file);
  if (running) return running;
  const signal = controller.signal;
  view.status = "loading"; view.error = ""; view.unavailable = false;
  const work = materialFile(props.material, file, playable[mediaType] ?? mediaType, signal).then((bytes) => {
    if (signal.aborted) return null;
    view.url = URL.createObjectURL(bytes); view.status = "ready";
    return view.url;
  }, (problem: unknown) => {
    if (signal.aborted) return null;
    view.status = "failed"; view.error = problem instanceof Error ? problem.message : "That file could not be opened. Try again.";
    return null;
  }).finally(() => { if (pending.get(file) === work) pending.delete(file); });
  pending.set(file, work);
  return work;
}

/** Opening a viewer loads only what it shows: an image, or a recording for its player. A PDF loads when a page is shown. */
function openFile(file: Original) {
  views[file.file]!.open = true;
  for (const part of file.renditions) if (part.kind === "IMAGE") void fetchBytes(part.file, part.mediaType);
  if (isRecording(file)) void fetchBytes(file.file, file.mediaType);
}
/** Whether the open viewer shows this file's loading failure itself, beside its Try again button. */
function failureInBody(file: Original) {
  const view = views[file.file]!;
  if (!view.open) return false;
  if (isRecording(file)) return true;
  if (kindOf(file) === "pdf" && view.page !== null && pdfViewer) return true;
  return file.renditions.some((part) => part.kind === "IMAGE" && part.file === file.file);
}
function toggle(file: Original) {
  const view = views[file.file]!;
  if (view.open) view.open = false;
  else openFile(file);
}

async function download(file: Original) {
  const view = views[file.file]!;
  view.downloading = true;
  try {
    const url = await fetchBytes(file.file, file.mediaType);
    if (!url) return;
    const link = document.createElement("a");
    link.href = url; link.download = file.name; link.click();
  } finally { view.downloading = false; }
}

/** Opens the browser's PDF view of the original at one page. */
async function showPage(file: Original, page: number) {
  views[file.file]!.page = page;
  if (pdfViewer) void fetchBytes(file.file, file.mediaType);
  await nextTick();
  pdfViewOf(file)?.scrollIntoView({ block: "nearest" });
}
const pdfViewOf = (file: Original) => root.value?.querySelector<HTMLElement>(`[data-pdf-view="${CSS.escape(file.file)}"]`);

function setPlayer(file: string, element: unknown) {
  if (element instanceof HTMLMediaElement) players.set(file, element);
  else players.delete(file);
}
/** Plays the recording from the start of a transcript segment. Playback starts once the whole file has loaded. */
async function playFrom(file: Original, location: string) {
  const range = timeRangeOf(location);
  if (!range) return;
  cited.value = location;
  seeks.set(file.file, range.start);
  if (!await fetchBytes(file.file, file.mediaType)) return;
  await nextTick();
  const player = players.get(file.file);
  if (player && player.readyState >= HTMLMediaElement.HAVE_METADATA) seek(file.file);
}
function seek(file: string) {
  const player = players.get(file), start = seeks.get(file);
  if (!player || start === undefined) return;
  seeks.delete(file);
  player.currentTime = start;
  // A browser may refuse to start playing after a long load. The player then waits at that point.
  player.play().catch(() => undefined);
}

/** Opens the cited file's viewer at the cited place. The file is the one with a rendition at that location. */
async function goTo(location: string | undefined) {
  const data = source.value;
  if (!location || !data) return;
  cited.value = location;
  const file = data.originals.find((item) => (!props.file || item.file === props.file) && item.renditions.some((part) => part.location === location));
  const page = file && kindOf(file) === "pdf" ? pageOf(location) : null;
  if (file) {
    openFile(file);
    if (page !== null) void showPage(file, page);
    if (isRecording(file)) void playFrom(file, location);
  }
  await nextTick();
  // `content` has a block only when the material's text is shown on its own.
  const block = root.value?.querySelector<HTMLElement>(`[data-location="${CSS.escape(location)}"]`);
  if (!block) return;
  // Bring the block into view inside its scrolling list first, then bring the list (or the PDF view) into the page.
  const list = block.closest<HTMLElement>(".blocks");
  if (list) list.scrollTop += block.getBoundingClientRect().top - list.getBoundingClientRect().top - 8;
  block.focus({ preventScroll: true });
  ((file && page !== null ? pdfViewOf(file) : null) ?? block).scrollIntoView({ block: "nearest" });
}

watch(() => props.material, () => void readSource(), { immediate: true });
watch(() => props.location, (location) => void goTo(location));
onBeforeUnmount(reset);
</script>

<template>
  <div ref="root" class="material-viewer" :aria-busy="loading">
    <p v-if="loading" class="hint">Opening the material…</p>
    <div v-else-if="loadError" class="viewer-problem"><p class="viewer-error" role="alert">{{ loadError }}</p><button class="secondary sand small-button" @click="readSource">Try again</button></div>
    <template v-else-if="source">
      <h2 v-if="titled" class="viewer-title">{{ source.title }}</h2>
      <ul class="viewer-files">
        <li v-for="file in shown" :key="file.file" class="viewer-file">
          <div class="file-head">
            <button class="file-toggle" :aria-expanded="views[file.file]!.open" @click="toggle(file)"><span class="chevron" aria-hidden="true">›</span><span class="file-title">{{ file.name }}</span><small>{{ kindLabel(file) }}</small></button>
            <button class="file-chip" :disabled="views[file.file]!.downloading" :aria-label="`Download ${file.name}`" @click="download(file)"><span aria-hidden="true">↓ </span>{{ views[file.file]!.downloading ? 'Downloading…' : 'Download' }}</button>
          </div>
          <p v-for="(limit, index) in file.limitations" :key="index" class="hint limitation">{{ limit }}</p>
          <p v-if="views[file.file]!.status === 'failed' && !failureInBody(file)" class="viewer-error" role="alert">{{ views[file.file]!.error }}</p>
          <div v-if="views[file.file]!.open" class="file-body">
            <template v-if="isRecording(file)">
              <div class="player">
                <p v-if="views[file.file]!.status === 'loading'" class="hint">Loading the recording…</p>
                <div v-else-if="views[file.file]!.status === 'failed'"><p class="viewer-error" role="alert">{{ views[file.file]!.error }}</p><button class="secondary sand small-button" @click="fetchBytes(file.file, file.mediaType)">Try again</button></div>
                <div v-else-if="views[file.file]!.unavailable" class="unavailable"><p>Preview isn't available in this browser.</p><button class="secondary sand small-button" @click="download(file)">Download {{ file.name }}</button></div>
                <video v-else-if="views[file.file]!.url && kindOf(file) === 'video'" :ref="(element) => setPlayer(file.file, element)" controls playsinline preload="metadata" :src="views[file.file]!.url" @loadedmetadata="seek(file.file)" @error="views[file.file]!.unavailable = true"></video>
                <audio v-else-if="views[file.file]!.url" :ref="(element) => setPlayer(file.file, element)" controls preload="metadata" :src="views[file.file]!.url" @loadedmetadata="seek(file.file)" @error="views[file.file]!.unavailable = true"></audio>
              </div>
              <ol class="blocks">
                <template v-for="(part, index) in file.renditions" :key="index">
                  <li v-if="part.kind === 'TEXT'" class="block" :class="{ cited: cited === part.location }" :data-location="part.location" :tabindex="cited === part.location ? -1 : undefined">
                    <button class="time" @click="playFrom(file, part.location)"><span class="sr-only">Play </span>{{ placeLabel(part.location) }}</button>
                    <p class="block-text">{{ part.text }}</p>
                  </li>
                </template>
              </ol>
            </template>
            <template v-else>
              <div v-if="kindOf(file) === 'pdf' && views[file.file]!.page" class="pdf-view" :data-pdf-view="file.file">
                <div class="pdf-view-head"><strong>Page {{ views[file.file]!.page }}</strong><button class="quiet" @click="views[file.file]!.page = null">Close</button></div>
                <template v-if="pdfViewer">
                  <p v-if="views[file.file]!.status === 'loading'" class="hint">Loading the PDF…</p>
                  <div v-else-if="views[file.file]!.status === 'failed'"><p class="viewer-error" role="alert">{{ views[file.file]!.error }}</p><button class="secondary sand small-button" @click="fetchBytes(file.file, file.mediaType)">Try again</button></div>
                  <iframe v-else-if="views[file.file]!.url" :key="views[file.file]!.page!" class="pdf-frame" :src="`${views[file.file]!.url}#page=${views[file.file]!.page}`" :title="`${file.name}, page ${views[file.file]!.page}`"></iframe>
                </template>
                <button v-else class="secondary sand small-button" @click="download(file)">Download {{ file.name }}</button>
              </div>
              <p v-if="!file.renditions.length" class="hint">This file has no readable text.</p>
              <div v-else class="blocks">
                <div v-for="(part, index) in file.renditions" :key="index" class="block" :class="{ cited: cited === part.location }" :data-location="part.location" :tabindex="cited === part.location ? -1 : undefined">
                  <div class="block-head"><p class="place">{{ placeLabel(part.location) }}</p><button v-if="kindOf(file) === 'pdf' && pdfViewer && pageNumber(part) !== null" class="quiet" @click="showPage(file, pageNumber(part)!)">Show page {{ pageNumber(part) }}</button></div>
                  <p v-if="part.kind === 'TEXT'" class="block-text">{{ part.text }}</p>
                  <p v-else-if="part.kind === 'PAGE'" class="hint">Page {{ part.page }} has no selectable text. The tutor reads it as an image.</p>
                  <template v-else-if="part.kind === 'IMAGE' && views[part.file]">
                    <p v-if="views[part.file]!.status === 'loading'" class="hint">Loading the image…</p>
                    <div v-else-if="views[part.file]!.status === 'failed'"><p class="viewer-error" role="alert">{{ views[part.file]!.error }}</p><button class="secondary sand small-button" @click="fetchBytes(part.file, part.mediaType)">Try again</button></div>
                    <div v-else-if="views[part.file]!.unavailable" class="unavailable"><p>Preview isn't available in this browser.</p><button class="secondary sand small-button" @click="download(file)">Download {{ file.name }}</button></div>
                    <img v-else-if="views[part.file]!.url" class="image-view" :src="views[part.file]!.url" :alt="file.name" @error="views[part.file]!.unavailable = true" />
                  </template>
                </div>
              </div>
            </template>
          </div>
        </li>
      </ul>
      <div v-if="looseText" class="blocks loose-text"><div class="block" data-location="content" :class="{ cited: cited === 'content' }"><p class="place">{{ placeLabel('content') }}</p><p class="block-text">{{ looseText }}</p></div></div>
    </template>
  </div>
</template>

<style scoped>
.material-viewer{font-size:13px;min-width:0}.viewer-title{font:22px/1.3 var(--font-display);margin:0 0 12px;overflow-wrap:anywhere}.viewer-files{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.viewer-file{min-width:0;border:1px solid var(--line);border-radius:12px;background:#FFFFFF;padding:6px 10px 8px}.file-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.file-toggle{flex:1;min-width:0;display:flex;align-items:center;gap:8px;border:0;background:none;padding:6px 2px;text-align:left;color:var(--ink);font-size:13px;font-weight:600}.file-title{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.file-toggle small{flex:none;font-size:11px;font-weight:400;color:var(--muted)}
.chevron{flex:none;color:var(--sand-soft-text);font-size:18px;line-height:1}.file-toggle[aria-expanded=true] .chevron{transform:rotate(90deg)}
.file-chip{flex:none;border:1px solid var(--line);border-radius:999px;background:#FFFFFF;padding:5px 12px;font-size:12px;color:var(--sand-soft-text)}.file-chip:hover:not(:disabled){background:var(--sand-soft)}
.limitation{margin:2px 2px 4px;font-size:12px}.file-body{display:grid;gap:10px;margin-top:6px;min-width:0}.small-button{min-height:32px;padding:4px 12px;border-radius:10px;font-size:13px}.quiet{font-size:12px;padding:2px 0}
.blocks{display:grid;gap:6px;max-height:26rem;overflow:auto;overscroll-behavior:contain;list-style:none;margin:0;padding:0}.block{min-width:0;padding:8px 10px;border-radius:8px;background:var(--inset)}.block.cited{background:var(--sand-soft);box-shadow:inset 3px 0 0 var(--sand-soft-text)}
.block-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.place{margin:0;font-size:12px;font-weight:600;color:var(--muted)}.block-text{margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.6}.block .hint{margin:4px 0 0}
.loose-text{margin-top:8px}.pdf-view{min-width:0;padding:8px;border:1px solid var(--line);border-radius:10px;background:var(--inset)}.pdf-view-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:6px}.pdf-view .hint{margin:0}
.pdf-frame{display:block;width:100%;height:min(70vh,720px);border:1px solid var(--line);border-radius:6px;background:#FFFFFF}.image-view{display:block;max-width:100%;max-height:60vh;margin-top:6px;border-radius:8px}
.player video{display:block;width:100%;max-height:50vh;border-radius:8px;background:var(--ink)}.player audio{display:block;width:100%}.player .hint{margin:0}
.time{border:0;background:none;padding:0;color:var(--sand-soft-text);font-size:12px;font-weight:600;text-decoration:underline;text-underline-offset:3px}.unavailable p{margin:0 0 8px}
.viewer-error{margin:6px 0;padding:8px 10px;border-left:3px solid var(--error);background:#FFFFFF;font-size:13px}.viewer-problem .small-button{margin-bottom:4px}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap}
@media (prefers-reduced-motion:no-preference){.chevron{transition:transform 120ms}}
</style>
