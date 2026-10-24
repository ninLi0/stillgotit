<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from "vue";
import type { MarkdownIt } from "markdown-it";
import type { StillGotItHttp } from "../../generated/wire.ts";
import { api, errorMessage, failureText } from "./api.ts";
import { materialFile } from "./host-api.ts";
import MaterialMedia from "./MaterialMedia.vue";
import PixelIcon from "./PixelIcon.vue";
import ViewerPdfCanvas from "./ViewerPdfCanvas.vue";
import { docIcon } from "./pixel-art.ts";
import type { AskAboutPage, ViewerSkill } from "./revamp-types.ts";
import { markdown } from "./ViewerMarkdown.ts";
import { openPdf, type PDFDocumentProxy } from "./ViewerPdf.ts";
import {
  askLabel, askQuestion, buildPages, digestKey, fileKey, fileKind, findLocation, gradeNote, isPaged, lineRange, markdownSource,
  pageSkills, sectionForLine, skillsLabel, type FileKind, type ImageRendition, type MaterialRead, type Original, type ViewerPage,
} from "./ViewerModel.ts";

// The Materials viewer (design/revamp/README.md, "Materials", Viewer): a toolbar with the pager, zoom and "Ask about
// this page"; a thumbnail rail; the page canvas; and the skills that come from the page. It reads the material itself
// and loads each retained file through the host's checked file route, never by a direct file URL.
// PDFs are drawn with pdf.js; slides show their saved text in a 16:9 frame (there is no slide image); photos are the
// retained image; Markdown is rendered; text and code read in a column; other files show their text by location.
// Recordings and HEIC or HEIF photos ("media" pages) are shown by MaterialMedia.vue, mounted for that one file: a player
// beside the transcript segments, or the photo with a download when the browser cannot draw it.
const props = defineProps<{ material: string; title: string; skills: ViewerSkill[]; initialLocation?: string }>();
const emit = defineEmits<{ ask: [request: AskAboutPage]; "open-skill": [skill: string]; "review-draft": [skill: string] }>();

type MaterialId = StillGotItHttp["/courses/materials/read"]["input"]["material"];
type FileState = { state: "loading" } | { state: "ready" } | { state: "failed"; message: string };

const ZOOM_MIN = 60, ZOOM_MAX = 200, ZOOM_STEP = 10, THUMB_RAIL = 104, RAIL_MIN_PANE = 520, FLASH_MS = 1800;
// Each kind's page width at 100%, as the design sets them.
const BASE: Record<FileKind, number> = { pdf: 500, slides: 640, image: 420, markdown: 580, text: 580, code: 580, media: 580, other: 580 };
const ICON_KIND: Record<FileKind, string> = { pdf: "PDF", slides: "PPTX", image: "IMG", markdown: "MD", text: "OTHER", code: "OTHER", media: "OTHER", other: "OTHER" };

const root = ref<HTMLElement | null>(null), scroller = ref<HTMLElement | null>(null), rail = ref<HTMLElement | null>(null);
const read = shallowRef<MaterialRead | null>(null);
const status = ref<"loading" | "ready" | "failed">("loading");
const failure = ref("");
const files = reactive<Record<string, FileState>>({});
const pdfCounts = reactive<Record<string, number>>({});
const keys = reactive<Record<string, string>>({});
const imageUrls = reactive<Record<string, string>>({});
// The cited location each media page opens at, by file reference. MaterialMedia goes to it when it changes.
const mediaLocations = reactive<Record<string, string>>({});
const materialId = computed(() => props.material as MaterialId);
// pdf.js documents stay outside Vue's reactivity; `docVersion` tells the template when one is added or removed.
const docs = new Map<string, PDFDocumentProxy>();
const docVersion = ref(0);
const md = shallowRef<MarkdownIt | null>(null), markdownFailed = ref(false);
const markdownCache = new Map<string, string>();
const currentKey = ref("");
const zoom = ref(100);
const paneWidth = ref(700);
const flashPage = ref("");
const visibleLocation = ref("");
// A location still to open, and one opened but not yet highlighted (its text may still be rendering).
const pending = ref<string | null>(null);
const toHighlight = ref<{ key: string; location: string } | null>(null);
let generation = 0, scrollTimer: ReturnType<typeof setTimeout> | undefined, flashTimer: ReturnType<typeof setTimeout> | undefined, resizeObserver: ResizeObserver | null = null;

const displayTitle = computed(() => props.title.trim() || read.value?.title || "this file");
const graded = computed(() => (props.title || read.value?.title || "").startsWith("Graded work: "));
const pages = computed<ViewerPage[]>(() => read.value ? buildPages(read.value, pdfCounts, keys, graded.value) : []);
const index = computed(() => Math.max(0, pages.value.findIndex((item) => item.key === currentKey.value)));
const page = computed<ViewerPage | undefined>(() => pages.value[index.value]);
const multiFile = computed(() => (read.value?.originals.length ?? 0) > 1);
const hasPager = computed(() => pages.value.length > 1 || (!!page.value && isPaged(page.value.kind)));
const showThumbs = computed(() => pages.value.length > 1 && paneWidth.value >= RAIL_MIN_PANE);
const canvasWidth = computed(() => paneWidth.value - (showThumbs.value ? THUMB_RAIL : 0));
// The page fits the pane but never drops below 0.6 scale; narrower panes scroll sideways instead.
const fit = computed(() => Math.min(1, Math.max(0.6, (canvasWidth.value - 48) / BASE[page.value?.kind ?? "pdf"])));
const scale = computed(() => +(fit.value * zoom.value / 100).toFixed(3));
const pageLabel = computed(() => {
  const item = page.value;
  if (!item) return "";
  if (item.unit) return `${item.unit} ${item.number} of ${item.count}`;
  if (pages.value.length > 1) return `File ${index.value + 1} of ${pages.value.length}`;
  if (item.kind === "media") return item.media === "recording" ? "Recording" : "Photo";
  return item.kind === "markdown" ? "Markdown · rendered" : item.kind === "code" ? "Code" : item.kind === "text" ? "Text" : "Readable text";
});
const askLocation = computed(() => {
  const item = page.value;
  if (!item) return "content";
  return !isPaged(item.kind) && item.sections.some((section) => section.location === visibleLocation.value) ? visibleLocation.value : item.location;
});
const chips = computed(() => pageSkills(props.skills, page.value));
const fileState = computed<FileState | undefined>(() => page.value ? files[page.value.file] : undefined);
const markdownHtml = computed(() => {
  const item = page.value;
  if (!item || item.kind !== "markdown" || !md.value) return "";
  let html = markdownCache.get(item.key);
  if (html === undefined) { html = md.value.render(markdownSource(item)); markdownCache.set(item.key, html); }
  return html;
});
const slideLines = computed(() => page.value?.kind === "slides" ? page.value.text.split("\n").map((line) => line.trim()).filter(Boolean) : []);
const slideDense = computed(() => slideLines.value.length > 7 || slideLines.value.join(" ").length > 420);
const grading = computed(() => {
  if (page.value?.kind !== "image") return { grade: null, note: null, rest: "" };
  if (!graded.value) return { grade: null, note: null, rest: page.value.text };
  return gradeNote(page.value.text || (pages.value.length === 1 ? read.value?.content ?? "" : ""));
});

function pdfDoc(file: string): PDFDocumentProxy | null { void docVersion.value; return docs.get(file) ?? null; }
function imageUrl(image: ImageRendition | undefined) { return image ? imageUrls[image.file] ?? "" : ""; }
function thumbLabel(item: ViewerPage) { return `${item.unit ? `${item.unit} ${item.number}` : item.fileName}${multiFile.value && item.unit ? `, ${item.fileName}` : ""}`; }
function bars(kind: FileKind) { return kind === "slides" ? ["70%", "50%", "60%"] : ["80%", "95%", "60%", "90%", "70%", "85%"]; }
function extensionOf(name: string) { const dot = name.lastIndexOf("."); return dot < 0 ? "" : name.slice(dot + 1).toUpperCase(); }

/** The read reports a material that is not the learner's as a bare FORBIDDEN, without the concept's reason. */
function readFailure(result: { error: unknown; detail?: unknown }) {
  const detail = typeof result.detail === "string" && result.detail.trim();
  return result.error === "FORBIDDEN" && !detail ? "This file is not available in your courses." : failureText(result);
}

/** Destroys open PDFs, revokes image URLs and forgets everything loaded for the previous material. */
function release() {
  for (const doc of docs.values()) void doc.loadingTask.destroy().catch(() => undefined);
  docs.clear(); docVersion.value++;
  for (const url of Object.values(imageUrls)) URL.revokeObjectURL(url);
  for (const record of [files, pdfCounts, keys, imageUrls, mediaLocations] as Record<string, unknown>[]) for (const key of Object.keys(record)) delete record[key];
  markdownCache.clear();
}

async function load() {
  const mine = ++generation;
  release();
  read.value = null; status.value = "loading"; failure.value = ""; currentKey.value = ""; visibleLocation.value = ""; toHighlight.value = null;
  try {
    const result = await api.courses.materials.read({ material: props.material as MaterialId });
    if (mine !== generation) return;
    if ("error" in result) { status.value = "failed"; failure.value = readFailure(result); return; }
    read.value = result;
    status.value = "ready";
    currentKey.value = pages.value[0]?.key ?? "";
    // A file that saved no locations (such as a scanned PDF beside other files) still gets its importer key.
    for (const original of result.originals) {
      if (fileKey(original, keys)) continue;
      void digestKey(original.file).then((key) => { if (key && mine === generation) keys[original.file] = key; });
    }
    if (pages.value.some((item) => item.kind === "markdown")) {
      markdown().then((parser) => { if (mine === generation) md.value = parser; }).catch(() => { if (mine === generation) markdownFailed.value = true; });
    }
    tryJump();
    void loadFiles(mine);
  } catch {
    if (mine !== generation) return;
    status.value = "failed"; failure.value = errorMessage("NETWORK_ERROR");
  }
}

/** Loads the file for the page on screen first, then the others in order, one at a time. */
async function loadFiles(mine: number) {
  const originals = read.value?.originals ?? [];
  const first = originals.find((original) => original.file === page.value?.file);
  if (first) await loadFile(first, mine);
  for (const original of originals) {
    if (mine !== generation) return;
    await loadFile(original, mine);
  }
}

async function loadFile(original: Original, mine = generation) {
  const kind = fileKind(original);
  if (kind !== "pdf" && kind !== "image") return;
  const known = files[original.file];
  if (known && known.state !== "failed") return;
  files[original.file] = { state: "loading" };
  try {
    if (kind === "pdf") {
      const blob = await materialFile(materialId.value, original.file, "application/pdf");
      if (mine !== generation) return;
      let doc: PDFDocumentProxy;
      // pdf.js reports damaged files in its own words, so the learner sees the app's sentence instead.
      try { doc = await openPdf(blob); } catch { throw new Error(""); }
      if (mine !== generation) { void doc.loadingTask.destroy().catch(() => undefined); return; }
      docs.set(original.file, markRaw(doc)); docVersion.value++;
      pdfCounts[original.file] = doc.numPages;
    } else {
      for (const image of original.renditions.filter((part): part is ImageRendition => part.kind === "IMAGE")) {
        if (imageUrls[image.file]) continue;
        const blob = await materialFile(materialId.value, image.file, image.mediaType);
        if (mine !== generation) return;
        imageUrls[image.file] = URL.createObjectURL(blob);
      }
    }
    files[original.file] = { state: "ready" };
  } catch (problem) {
    if (mine !== generation) return;
    files[original.file] = { state: "failed", message: problem instanceof Error ? problem.message : "" };
  }
}
function retryFile(file: string) {
  const original = read.value?.originals.find((item) => item.file === file);
  if (original) void loadFile(original);
}
function pageFailed(file: string) { files[file] = { state: "failed", message: "" }; }

function go(target: number) {
  const item = pages.value[Math.max(0, Math.min(pages.value.length - 1, target))];
  if (!item || item.key === currentKey.value) return;
  currentKey.value = item.key;
  visibleLocation.value = "";
  void nextTick(() => {
    scroller.value?.scrollTo({ top: 0, left: 0 });
    const thumb = rail.value?.querySelector<HTMLElement>("[aria-current='page']");
    if (rail.value && thumb) {
      const box = rail.value.getBoundingClientRect(), mark = thumb.getBoundingClientRect();
      if (mark.top < box.top) rail.value.scrollTop -= box.top - mark.top + 12;
      else if (mark.bottom > box.bottom) rail.value.scrollTop += mark.bottom - box.bottom + 12;
    }
  });
}
function zoomBy(step: number) { zoom.value = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom.value + step)); }

function ask() {
  const item = page.value;
  if (!item) return;
  emit("ask", { material: props.material, location: askLocation.value, question: askQuestion(item, askLocation.value, displayTitle.value) });
}
function openChip(skill: ViewerSkill) {
  if (skill.status === "DRAFT") emit("review-draft", skill.skill);
  else emit("open-skill", skill.skill);
}

/** Opens the page that holds the pending location. A PDF page past the last page with text waits for pdf.js to count. */
function tryJump() {
  const location = pending.value;
  if (!location || status.value !== "ready") return;
  const hit = findLocation(pages.value, location);
  if (!hit) {
    const counting = /\/page\/\d+$/.test(location) && pages.value.some((item) => item.kind === "pdf" && !(item.file in pdfCounts) && files[item.file]?.state !== "failed");
    if (!counting) pending.value = null;
    return;
  }
  pending.value = null;
  go(pages.value.indexOf(hit));
  if (hit.kind === "media") mediaLocations[hit.file] = location;
  toHighlight.value = { key: hit.key, location };
}

/** Scrolls the text pane to the location and highlights it briefly. Returns false while its text is not drawn yet. */
function highlight(target: { key: string; location: string }): boolean {
  const item = pages.value.find((candidate) => candidate.key === target.key);
  if (!item || item.key !== currentKey.value) return true;
  clearTimeout(flashTimer);
  if (isPaged(item.kind)) {
    flashPage.value = item.key;
    flashTimer = setTimeout(() => { flashPage.value = ""; }, FLASH_MS);
    return true;
  }
  const container = scroller.value;
  if (!container) return false;
  let marked: HTMLElement[] = [];
  const range = lineRange(target.location);
  if (item.kind === "markdown" && md.value && range) {
    const blocks = container.querySelector(".md")?.children ?? [];
    marked = [...blocks].filter((block): block is HTMLElement => {
      const source = (block as HTMLElement).dataset.line ? block as HTMLElement : block.querySelector<HTMLElement>("[data-line]");
      const start = Number(source?.dataset.line ?? 0), end = Number(source?.dataset.lineEnd ?? 0);
      return !!source && start <= range[1] && end >= range[0];
    });
  } else if (item.kind === "markdown" && !md.value && !markdownFailed.value) {
    return false;
  } else {
    marked = [...container.querySelectorAll<HTMLElement>("[data-location]")].filter((element) => element.dataset.location === target.location);
  }
  if (!marked.length) return true;
  const top = marked[0]!.getBoundingClientRect().top - container.getBoundingClientRect().top;
  container.scrollTop += top - 16;
  container.querySelectorAll(".flash-text").forEach((element) => element.classList.remove("flash-text"));
  marked.forEach((element) => element.classList.add("flash-text"));
  flashTimer = setTimeout(() => marked.forEach((element) => element.classList.remove("flash-text")), FLASH_MS);
  visibleLocation.value = item.sections.some((section) => section.location === target.location) ? target.location : visibleLocation.value;
  return true;
}

/** For document pages, the section at the top of the pane, which "Ask about …" and the skill chips follow. */
function trackVisible() {
  const item = page.value, container = scroller.value;
  if (!item || isPaged(item.kind) || !container) return;
  const top = container.getBoundingClientRect().top + 24;
  if (item.kind === "markdown" && md.value) {
    const first = [...container.querySelectorAll<HTMLElement>("[data-line]")].find((element) => element.getBoundingClientRect().bottom > top);
    visibleLocation.value = sectionForLine(item, Number(first?.dataset.line ?? 1))?.location ?? item.location;
    return;
  }
  const first = [...container.querySelectorAll<HTMLElement>("[data-location]")].find((element) => element.getBoundingClientRect().bottom > top);
  visibleLocation.value = first?.dataset.location ?? item.location;
}
function onScroll() {
  if (scrollTimer) return;
  scrollTimer = setTimeout(() => { scrollTimer = undefined; trackVisible(); }, 80);
}

function onKey(event: KeyboardEvent) {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const pane = scroller.value;
    // In a page wider than the pane, the arrows scroll it sideways as usual.
    if (pane && target === pane && pane.scrollWidth > pane.clientWidth + 1) return;
    if (pages.value.length < 2) return;
    event.preventDefault();
    go(index.value + (event.key === "ArrowLeft" ? -1 : 1));
  } else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(ZOOM_STEP); }
  else if (event.key === "-") { event.preventDefault(); zoomBy(-ZOOM_STEP); }
}

watch(() => props.material, () => { pending.value = props.initialLocation ?? null; void load(); }, { immediate: true });
watch(() => props.initialLocation, (location) => { pending.value = location ?? null; tryJump(); });
watch(pages, () => tryJump());
// Moving to a file that is still queued loads it now.
watch(() => page.value?.file, (file) => {
  const original = file ? read.value?.originals.find((item) => item.file === file) : undefined;
  if (original && !files[original.file]) void loadFile(original);
});
watch([toHighlight, markdownHtml, markdownFailed, currentKey], () => {
  if (toHighlight.value && highlight(toHighlight.value)) toHighlight.value = null;
}, { flush: "post" });
watch(markdownHtml, () => void nextTick(trackVisible), { flush: "post" });

onMounted(() => {
  if (!root.value) return;
  paneWidth.value = root.value.clientWidth || paneWidth.value;
  resizeObserver = new ResizeObserver(() => { if (root.value) paneWidth.value = root.value.clientWidth; });
  resizeObserver.observe(root.value);
});
onBeforeUnmount(() => {
  generation++;
  resizeObserver?.disconnect();
  clearTimeout(scrollTimer);
  clearTimeout(flashTimer);
  release();
});
</script>

<template>
  <section ref="root" class="viewer" :aria-label="`Preview of ${displayTitle}`" @keydown="onKey">
    <div class="toolbar">
      <div class="tool-group">
        <template v-if="status === 'ready' && hasPager">
          <button type="button" class="tool" :disabled="index === 0" :aria-label="`Previous ${(page?.unit || 'file').toLowerCase()}`" @click="go(index - 1)">‹</button>
          <span class="page-label" aria-live="polite" aria-atomic="true">{{ pageLabel }}<span v-if="multiFile && page" class="sr-only">, {{ page.fileName }}</span></span>
          <button type="button" class="tool" :disabled="index >= pages.length - 1" :aria-label="`Next ${(page?.unit || 'file').toLowerCase()}`" @click="go(index + 1)">›</button>
        </template>
        <span v-else class="page-label solo" aria-live="polite">{{ status === 'ready' ? pageLabel : '' }}</span>
      </div>
      <div class="tool-group">
        <button type="button" class="tool" :disabled="zoom <= ZOOM_MIN" aria-label="Zoom out" @click="zoomBy(-ZOOM_STEP)">−</button>
        <span class="zoom-label" aria-live="polite">{{ zoom }}%</span>
        <button type="button" class="tool" :disabled="zoom >= ZOOM_MAX" aria-label="Zoom in" @click="zoomBy(ZOOM_STEP)">+</button>
        <button type="button" class="secondary sand ask" :disabled="status !== 'ready' || !page" @click="ask">{{ askLabel(page) }}</button>
      </div>
    </div>

    <div v-if="status === 'loading'" class="state" role="status">Loading page 1…</div>
    <div v-else-if="status === 'failed'" class="state" role="alert">
      <p class="state-title">Couldn't load this file. Try again.</p>
      <p v-if="failure" class="hint">{{ failure }}</p>
      <button type="button" class="secondary sand" @click="load">Try again</button>
    </div>
    <div v-else-if="!page" class="state" role="status">This material has nothing to show yet.</div>

    <div v-else class="body" :class="{ 'with-thumbs': showThumbs }">
      <nav v-if="showThumbs" ref="rail" class="rail" aria-label="Pages">
        <template v-for="(item, i) in pages" :key="item.key">
          <span v-if="multiFile && item.count > 1 && item.kind !== 'image' && (i === 0 || pages[i - 1]!.file !== item.file)" class="rail-file" :title="item.fileName">{{ item.fileName }}</span>
          <button type="button" class="thumb" :aria-current="i === index ? 'page' : undefined" :aria-label="thumbLabel(item)" @click="go(i)">
            <span class="thumb-tile" :class="[item.kind, { current: i === index, drawn: (item.kind === 'pdf' && !!pdfDoc(item.file)) || (item.kind === 'image' && !!imageUrl(item.image)) }]">
              <ViewerPdfCanvas v-if="item.kind === 'pdf' && pdfDoc(item.file)" :doc="pdfDoc(item.file)!" :page="item.number" :width="62" lazy />
              <img v-else-if="item.kind === 'image' && imageUrl(item.image)" :src="imageUrl(item.image)" alt="" />
              <template v-else-if="item.kind === 'pdf' || item.kind === 'slides'"><span v-for="(width, b) in bars(item.kind)" :key="b" class="bar" :style="{ width }" /></template>
              <PixelIcon v-else-if="item.kind !== 'image'" :rows="docIcon(ICON_KIND[item.kind])" :size="34" />
            </span>
            <span class="thumb-num" :class="{ current: i === index }">{{ item.unit ? item.number : extensionOf(item.fileName) }}</span>
          </button>
        </template>
      </nav>

      <div ref="scroller" class="canvas" tabindex="0" :aria-label="`${pageLabel}, ${displayTitle}`" @scroll="onScroll">
        <p v-if="multiFile" class="file-caption">{{ page.fileName }}</p>

        <!-- PDF: drawn at the page's display width, so pdf.js keeps the text sharp. -->
        <div v-if="page.kind === 'pdf'" class="stage">
          <div v-if="fileState?.state === 'failed'" class="file-problem" role="alert">
            <p><strong>Couldn't load this file. Try again.</strong><span v-if="fileState.message"> {{ fileState.message }}</span></p>
            <button type="button" class="secondary sand small" @click="retryFile(page.file)">Try again</button>
          </div>
          <div v-if="pdfDoc(page.file) && fileState?.state !== 'failed'" class="page-frame" :class="{ flash: flashPage === page.key }"
            role="img" :aria-label="`${page.unit} ${page.number} of ${displayTitle}`">
            <ViewerPdfCanvas :doc="pdfDoc(page.file)!" :page="page.number" :width="Math.round(BASE.pdf * scale)" @failed="pageFailed(page.file)" />
          </div>
          <article v-else-if="fileState?.state === 'failed'" class="page-frame text-page" :class="{ flash: flashPage === page.key }" :style="{ zoom: scale }">
            <p v-if="page.text" class="text-page-body">{{ page.text }}</p>
            <p v-else class="hint">This page has no readable text.</p>
          </article>
          <div v-else class="page-frame placeholder" :style="{ width: `${Math.round(BASE.pdf * scale)}px`, height: `${Math.round(BASE.pdf * scale * 11 / 8.5)}px` }" role="status">
            Loading page {{ page.number }}…
          </div>
          <div v-if="page.text && pdfDoc(page.file) && fileState?.state !== 'failed'" class="sr-only">{{ page.text }}</div>
        </div>

        <!-- Recordings and HEIC photos: MaterialMedia reads the material and loads this file's bytes itself. -->
        <div v-else-if="page.kind === 'media'" class="stage media-stage">
          <MaterialMedia :key="page.key" class="media-view" :material="materialId" :file="page.file" :location="mediaLocations[page.file]" />
        </div>

        <!-- Everything else scales with CSS zoom from its design width. -->
        <div v-else class="stage" :style="{ zoom: scale }">
          <article v-if="page.kind === 'slides'" class="slide" :class="{ flash: flashPage === page.key, dense: slideDense }">
            <template v-if="slideLines.length">
              <p class="slide-title">{{ slideLines[0] }}</p>
              <p v-for="(line, i) in slideLines.slice(1)" :key="i" class="slide-line"><span class="slide-dot" aria-hidden="true" />{{ line }}</p>
            </template>
            <p v-else class="slide-line empty">This slide has no readable text.</p>
            <footer class="slide-foot"><span>{{ displayTitle }}</span><span>{{ page.number }}</span></footer>
          </article>

          <figure v-else-if="page.kind === 'image'" class="photo">
            <div class="photo-frame" :class="{ flash: flashPage === page.key }">
              <img v-if="imageUrl(page.image)" :src="imageUrl(page.image)" :alt="`${page.unit} ${page.number} of ${displayTitle}`" />
              <div v-else-if="fileState?.state === 'failed'" class="photo-state" role="alert">
                <p><strong>Couldn't load this file. Try again.</strong></p>
                <p v-if="fileState.message" class="hint">{{ fileState.message }}</p>
                <button type="button" class="secondary sand small" @click="retryFile(page.file)">Try again</button>
              </div>
              <div v-else class="photo-state" role="status">Loading {{ page.unit.toLowerCase() }} {{ page.number }}…</div>
              <span v-if="grading.grade" class="stamp">{{ grading.grade }}</span>
            </div>
            <figcaption v-if="grading.note" class="photo-note">Grader’s note: {{ grading.note }}</figcaption>
            <p v-if="grading.rest" class="photo-text">{{ grading.rest }}</p>
          </figure>

          <article v-else-if="page.kind === 'markdown' && md" class="doc md" v-html="markdownHtml" />

          <article v-else class="doc" :class="[page.kind]">
            <template v-if="page.kind === 'other'">
              <section v-for="section in page.sections" :key="section.location" class="doc-section" :data-location="section.location">
                <p class="eyebrow">{{ section.label }}</p>
                <div class="doc-text" :class="{ mono: section.mono }">{{ section.text }}</div>
              </section>
            </template>
            <template v-else>
              <div v-for="section in page.sections" :key="section.location" class="doc-run" :class="{ mono: section.mono }" :data-location="section.location">{{ section.text }}</div>
            </template>
            <p v-if="!page.sections.length" class="hint">This file has no readable text.</p>
            <p v-if="page.kind === 'markdown' && !md && !markdownFailed" class="hint" role="status">Loading the formatted notes…</p>
          </article>
        </div>
      </div>
    </div>

    <div v-if="status === 'ready' && chips.length" class="chips">
      <span class="eyebrow chips-label">{{ skillsLabel(page) }}</span>
      <button v-for="skill in chips" :key="skill.skill" type="button" class="chip" :class="{ draft: skill.status === 'DRAFT' }"
        :aria-label="skill.status === 'DRAFT' ? `Review the draft skill ${skill.title}` : `Open the lesson for ${skill.title}`" @click="openChip(skill)">
        <PixelIcon :sprite="skill.status === 'DRAFT' ? 'bud' : 'leaf'" :size="18" />
        <span>{{ skill.title }}</span>
        <span v-if="skill.status === 'DRAFT'" class="to-review">to review</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.viewer { border: 1px solid #ECECE8; border-radius: 16px; overflow: hidden; background: #F3F3F0; }

.toolbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 10px; padding: 8px 10px; background: #FFFFFF; border-bottom: 1px solid #ECECE8; }
.tool-group { display: flex; align-items: center; gap: 4px; }
.tool { display: inline-flex; align-items: center; justify-content: center; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 10px; background: var(--inset); color: var(--ink); font-size: 16px; line-height: 1; }
.tool:hover:not(:disabled) { background: #ECECE9; }
.tool:disabled { color: #BDBDB8; opacity: 1; }
.page-label { min-width: 104px; font-size: 13px; font-weight: 600; text-align: center; white-space: nowrap; }
.page-label.solo { min-width: 0; padding: 0 6px; }
.zoom-label { width: 48px; color: var(--muted); font-size: 12px; font-weight: 600; text-align: center; }
.ask { min-height: 34px; margin-left: 6px; padding: 8px 12px; border-radius: 10px; font-size: 13px; white-space: nowrap; }

.state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; height: 560px; padding: 24px; color: var(--muted); font-size: 14px; text-align: center; }
.state-title { margin: 0; color: var(--ink); font-size: 15px; font-weight: 600; }
.state .hint { margin: 0 0 10px; max-width: 360px; }
.state .secondary { margin-top: 8px; }

.body { display: grid; grid-template-columns: minmax(0, 1fr); height: 560px; }
.body.with-thumbs { grid-template-columns: 104px minmax(0, 1fr); }

.rail { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 12px 10px; overflow-y: auto; border-right: 1px solid #ECECE8; background: #FAFAF8; }
.rail-file { align-self: stretch; overflow: hidden; color: var(--faint); font-size: 11px; font-weight: 600; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.thumb { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 0; border: 0; background: transparent; }
.thumb-tile { display: flex; flex-direction: column; gap: 4px; width: 62px; height: 80px; padding: 8px 7px; overflow: hidden; background: #FFFFFF; box-shadow: 0 0 0 1px #E2E2DE; }
.thumb-tile.slides { width: 84px; height: 47px; border-top: 4px solid #2F7D9B; }
.thumb-tile.image { height: 82px; padding: 0; background: var(--inset-2); }
.thumb-tile.pdf.drawn { height: auto; padding: 0; }
.thumb-tile.markdown, .thumb-tile.text, .thumb-tile.code, .thumb-tile.other { align-items: center; justify-content: center; }
.thumb-tile img { display: block; width: 100%; height: 100%; object-fit: cover; }
.thumb-tile.current { box-shadow: 0 0 0 2px #4A775A; }
.bar { display: block; flex: none; height: 3px; background: #D9D9D4; }
.thumb-num { color: var(--faint); font-size: 11px; font-weight: 500; }
.thumb-num.current { color: var(--ink); font-weight: 700; }

.canvas { position: relative; overflow: auto; padding: 24px; outline-offset: -3px; }
.file-caption { margin: -8px 0 12px; overflow: hidden; color: var(--faint); font-size: 12px; font-weight: 600; text-align: center; text-overflow: ellipsis; white-space: nowrap; }
.stage { width: max-content; margin: 0 auto; }
.media-stage { width: min(100%, 640px); }
.media-view { padding: 14px; border-radius: 12px; background: #FFFFFF; box-shadow: 0 0 0 1px var(--card-border); }

.page-frame { position: relative; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 10px 24px rgba(0, 0, 0, .08); }
.page-frame.placeholder { display: flex; align-items: center; justify-content: center; color: var(--muted); font-size: 14px; }
.text-page { width: 500px; min-height: 647px; padding: 48px 50px 54px; color: #1C1C1A; font-family: "Newsreader", Georgia, serif; }
.text-page-body { margin: 0; font-size: 15px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.file-problem { display: flex; align-items: center; justify-content: space-between; gap: 12px; max-width: 500px; margin: 0 auto 14px; padding: 10px 12px; border-radius: 12px; background: var(--coral-wash); color: var(--coral-text); font-size: 13px; }
.file-problem p { margin: 0; }
.small { min-height: 32px; padding: 0 12px; border-radius: 10px; font-size: 13px; white-space: nowrap; }

.slide { position: relative; display: flex; flex-direction: column; justify-content: center; gap: 18px; width: 640px; aspect-ratio: 16 / 9; padding: 40px 52px 44px; background: #FFFFFF; border-top: 12px solid #2F7D9B; box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 10px 24px rgba(0, 0, 0, .08); }
.slide-title { margin: 0; color: #12333F; font-family: var(--font-body); font-size: 34px; font-weight: 700; line-height: 1.15; overflow-wrap: anywhere; }
.slide-line { display: flex; gap: 12px; margin: 0; color: #2F3B40; font-size: 20px; line-height: 1.45; overflow-wrap: anywhere; }
.slide-line.empty { color: var(--faint); font-size: 16px; }
.slide-dot { flex: none; width: 8px; height: 8px; margin-top: 11px; background: #E3A233; }
.slide.dense { gap: 10px; }
.slide.dense .slide-title { font-size: 26px; }
.slide.dense .slide-line { font-size: 15px; }
.slide.dense .slide-dot { margin-top: 8px; }
.slide-foot { position: absolute; right: 52px; bottom: 14px; left: 52px; display: flex; justify-content: space-between; gap: 12px; color: #8E9BA2; font-size: 12px; }
.slide-foot span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.photo { display: flex; flex-direction: column; align-items: center; gap: 10px; margin: 0; }
.photo-frame { position: relative; width: 420px; box-shadow: 0 10px 24px rgba(0, 0, 0, .1); background: #FFFFFF; }
.photo-frame img { display: block; width: 100%; height: auto; }
.photo-state { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; aspect-ratio: 3 / 4; padding: 24px; background: var(--inset-2); color: var(--muted); font-size: 13px; text-align: center; }
.photo-state p { margin: 0; }
.stamp { position: absolute; top: 18px; right: 18px; padding: 0 10px; border: 3px solid #C0503C; color: #C0503C; font-family: var(--font-body); font-size: 28px; font-weight: 700; background: rgba(255, 255, 255, .85); transform: rotate(-6deg); }
.photo-note { max-width: 420px; color: var(--soft); font-size: 13px; text-align: center; }
.photo-text { max-width: 420px; margin: 0; color: var(--soft); font-size: 14px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }

.doc { display: flex; flex-direction: column; gap: 10px; width: 580px; padding: 36px 44px; background: #FFFFFF; box-shadow: 0 1px 2px rgba(0, 0, 0, .08), 0 10px 24px rgba(0, 0, 0, .06); }
.doc.text, .doc.code { gap: 0; }
.doc-run { color: var(--soft); font-size: 15px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.doc-run.mono { color: var(--ink); font-family: var(--font-mono); font-size: 13px; line-height: 1.7; white-space: pre; overflow-wrap: normal; }
.doc.code { overflow-x: auto; }
.doc-section { display: flex; flex-direction: column; gap: 6px; }
.doc-section + .doc-section { margin-top: 8px; }
.doc-text { color: var(--soft); font-size: 15px; line-height: 1.6; white-space: pre-wrap; overflow-wrap: anywhere; }
.doc-text.mono { padding: 14px 16px; border-radius: 10px; background: var(--inset); color: var(--ink); font-family: var(--font-mono); font-size: 13px; line-height: 1.7; }

/* Rendered Markdown (raw HTML is off, so only Markdown's own elements appear). */
.md :deep(> *) { margin: 0; }
.md :deep(h1) { padding-bottom: 10px; margin-bottom: 4px; border-bottom: 1px solid #ECECE8; font-family: var(--font-body); font-size: 28px; font-weight: 700; line-height: 1.2; }
.md :deep(h2) { margin-top: 12px; font-family: var(--font-body); font-size: 19px; font-weight: 700; line-height: 1.3; }
.md :deep(h3), .md :deep(h4), .md :deep(h5), .md :deep(h6) { margin-top: 8px; font-family: var(--font-body); font-size: 16px; font-weight: 700; line-height: 1.35; }
.md :deep(p) { color: var(--soft); font-size: 15px; line-height: 1.6; overflow-wrap: anywhere; }
.md :deep(ul), .md :deep(ol) { padding-left: 22px; color: var(--soft); font-size: 15px; line-height: 1.55; }
.md :deep(li + li) { margin-top: 2px; }
.md :deep(pre) { margin-top: 4px; padding: 14px 16px; overflow-x: auto; border-radius: 10px; background: var(--inset); font-family: var(--font-mono); font-size: 13px; line-height: 1.7; }
.md :deep(code) { font-family: var(--font-mono); font-size: 13px; }
.md :deep(:not(pre) > code) { padding: 1px 5px; border-radius: 5px; background: var(--inset); }
.md :deep(blockquote) { padding-left: 14px; border-left: 3px solid var(--ring); color: var(--muted); }
.md :deep(table) { border-collapse: collapse; font-size: 14px; }
.md :deep(th), .md :deep(td) { padding: 6px 10px; border: 1px solid var(--line); text-align: left; }
.md :deep(hr) { width: 100%; height: 1px; border: 0; background: #ECECE8; }
.md :deep(a) { color: #2A6B85; text-underline-offset: 3px; }

/* A cited location is highlighted briefly when the viewer opens at it. */
.page-frame.flash, .slide.flash, .photo-frame.flash { outline: 3px solid var(--sand-edge); outline-offset: 4px; animation: viewerFrame 1.8s ease-out both; }
.canvas :deep(.flash-text) { border-radius: 6px; background: var(--sand-soft); box-shadow: 0 0 0 6px var(--sand-soft); animation: viewerText 1.8s ease-out both; }
@keyframes viewerFrame { 0%, 55% { outline-color: var(--sand-edge); } 100% { outline-color: transparent; } }
@keyframes viewerText { 0%, 55% { background: var(--sand-soft); box-shadow: 0 0 0 6px var(--sand-soft); } 100% { background: transparent; box-shadow: 0 0 0 6px transparent; } }

.chips { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px; background: #FFFFFF; border-top: 1px solid #ECECE8; }
.chips-label { font-size: 12px; white-space: nowrap; }
.chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px 4px 6px; border: 1px solid #ECECE8; border-radius: 999px; background: #FFFFFF; color: var(--ink); font-size: 12px; font-weight: 600; white-space: nowrap; }
.chip:hover { background: var(--inset); }
.chip.draft { border-style: dashed; border-color: var(--sand-edge); }
.to-review { color: var(--new-text); font-weight: 700; }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
