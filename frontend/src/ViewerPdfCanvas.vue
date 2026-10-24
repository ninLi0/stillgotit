<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { RenderTask } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { PDFDocumentProxy } from "./ViewerPdf.ts";

// One PDF page drawn to a canvas at `width` CSS pixels times the device pixel ratio, so text stays sharp at every zoom.
// With `lazy`, the page is drawn only once it scrolls near view (used for the thumbnail rail). A new size cancels the
// drawing in progress first, since pdf.js cannot draw twice into one canvas at once.
const props = defineProps<{ doc: PDFDocumentProxy; page: number; width: number; lazy?: boolean }>();
const emit = defineEmits<{ failed: [] }>();
const root = ref<HTMLElement | null>(null), canvas = ref<HTMLCanvasElement | null>(null);
// Letter-size proportions until the page reports its own.
const ratio = ref(11 / 8.5);
const visible = ref(!props.lazy);
let task: RenderTask | null = null, generation = 0, timer: ReturnType<typeof setTimeout> | undefined, observer: IntersectionObserver | null = null;
// Browsers refuse canvases much larger than this many pixels.
const MAX_PIXELS = 16_000_000;

async function draw() {
  const mine = ++generation;
  if (task) { task.cancel(); try { await task.promise; } catch { /* cancelled */ } task = null; }
  if (mine !== generation || !visible.value || !canvas.value) return;
  try {
    const page = await props.doc.getPage(props.page);
    if (mine !== generation || !canvas.value) return;
    const base = page.getViewport({ scale: 1 });
    ratio.value = base.height / base.width;
    let scale = (props.width / base.width) * Math.min(window.devicePixelRatio || 1, 3);
    if (base.width * base.height * scale * scale > MAX_PIXELS) scale = Math.sqrt(MAX_PIXELS / (base.width * base.height));
    const viewport = page.getViewport({ scale });
    const element = canvas.value;
    element.width = Math.floor(viewport.width);
    element.height = Math.floor(viewport.height);
    task = page.render({ canvas: element, viewport });
    await task.promise;
    if (mine === generation) task = null;
  } catch (problem) {
    if ((problem as { name?: string } | null)?.name === "RenderingCancelledException" || mine !== generation) return;
    emit("failed");
  }
}
function schedule(delay: number) { clearTimeout(timer); timer = setTimeout(() => void draw(), delay); }

watch(() => [props.doc, props.page] as const, () => schedule(0));
// Zooming and resizing redraw once the size settles.
watch(() => props.width, () => schedule(90));
watch(visible, (now) => { if (now) schedule(0); });
onMounted(() => {
  if (props.lazy && root.value && "IntersectionObserver" in window) {
    observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) { visible.value = true; observer?.disconnect(); } }, { rootMargin: "240px" });
    observer.observe(root.value);
  } else visible.value = true;
  schedule(0);
});
onBeforeUnmount(() => { generation++; clearTimeout(timer); observer?.disconnect(); task?.cancel(); });
</script>

<template>
  <span ref="root" class="pdf-canvas" :style="{ width: `${Math.round(width)}px`, height: `${Math.round(width * ratio)}px` }">
    <canvas ref="canvas" aria-hidden="true" />
  </span>
</template>

<style scoped>
.pdf-canvas { display: block; position: relative; background: #FFFFFF; }
canvas { display: block; width: 100%; height: 100%; }
</style>
