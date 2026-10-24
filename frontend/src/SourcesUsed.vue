<script setup lang="ts">
import { computed, onBeforeUnmount, reactive } from "vue";
import { api, errorMessage, failureText } from "./api.ts";
import { materialFile } from "./host-api.ts";
import { sourceLabel } from "./labels.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
import type { OpenSource } from "./revamp-types.ts";
type Citation = StillGotItHttp["/learning/read"]["output"]["data"]["sessions"][number]["citations"][number];
type MaterialData = StillGotItHttp["/courses/materials/read"]["output"];
type Rendition = MaterialData["originals"][number]["renditions"][number];
type Loaded<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "failed"; message: string };
type Part = { kind: "TEXT"; text: string } | { kind: "IMAGE"; image: Loaded<string> };
// `titles` names each course material, for labels before its passage is opened. `idPrefix` keeps element ids unique.
// `variant` picks the look: "chips" under a tutor answer ("From <source> ↗"), or "rail" for the Taught from card.
// Choosing a source opens its passage here, as before, and also emits `open` so the shell can show it in Materials.
const props = withDefaults(defineProps<{ citations: readonly Citation[]; titles: Record<string, string>; idPrefix: string; variant?: "chips" | "rail" }>(), { variant: "chips" });
const emit = defineEmits<{ open: [source: OpenSource] }>();
const open = reactive(new Set<string>());
const reads = reactive(new Map<string, Loaded<MaterialData>>());
const images = reactive(new Map<string, Loaded<string>>());
const objectUrls: string[] = [];

function keyOf(citation: Citation) { return `${citation.material}\n${citation.location}`; }
function imageKey(citation: Citation, file: string) { return `${citation.material}\n${file}`; }
/** Every rendition saved at the cited location, in saved order: file by file, then each file's renditions. */
function matching(citation: Citation, data: MaterialData): Rendition[] {
  return data.originals.flatMap((file) => file.renditions.filter((part) => part.location === citation.location));
}
/** The read reports a material or course that is not the learner's as a bare FORBIDDEN, without the concept's reason. */
function readFailure(result: { error: unknown; detail?: unknown }) {
  const detail = typeof result.detail === "string" && result.detail.trim();
  return result.error === "FORBIDDEN" && !detail ? "This source is not available in your courses." : failureText(result);
}

const entries = computed(() => props.citations.map((citation, index) => {
  const read = reads.get(citation.material);
  const label = sourceLabel(citation.location, read?.state === "ready" ? read.value.title : props.titles[citation.material]);
  const parts: Part[] = read?.state === "ready" ? matching(citation, read.value).map((part) => part.kind === "TEXT"
    ? { kind: "TEXT", text: part.text } : { kind: "IMAGE", image: images.get(imageKey(citation, part.file)) ?? { state: "loading" } }) : [];
  return { citation, key: keyOf(citation), id: `${props.idPrefix}-${index}`, label, open: open.has(keyOf(citation)),
    read: read ?? { state: "loading" } as Loaded<MaterialData>, parts };
}));

// Two citations into one material share its read, including one that is still loading.
const readsInFlight = new Map<string, Promise<void>>();
function readMaterial(citation: Citation): Promise<void> {
  const material = citation.material;
  if (reads.get(material)?.state === "ready") return Promise.resolve();
  const running = readsInFlight.get(material);
  if (running) return running;
  reads.set(material, { state: "loading" });
  const reading = (async () => {
    try {
      const result = await api.courses.materials.read({ material });
      reads.set(material, "error" in result ? { state: "failed", message: readFailure(result) } : { state: "ready", value: result });
    } catch {
      reads.set(material, { state: "failed", message: errorMessage("NETWORK_ERROR") });
    } finally { readsInFlight.delete(material); }
  })();
  readsInFlight.set(material, reading);
  return reading;
}
async function loadImage(citation: Citation, part: Extract<Rendition, { kind: "IMAGE" }>) {
  const key = imageKey(citation, part.file), known = images.get(key);
  if (known && known.state !== "failed") return;
  images.set(key, { state: "loading" });
  try {
    const url = URL.createObjectURL(await materialFile(citation.material, part.file, part.mediaType));
    objectUrls.push(url);
    images.set(key, { state: "ready", value: url });
  } catch (problem) {
    images.set(key, { state: "failed", message: problem instanceof Error ? problem.message : "This image could not be loaded. Try again." });
  }
}
/** Read the material, then load any cited images. A failed step is tried again. */
async function show(citation: Citation) {
  await readMaterial(citation);
  const read = reads.get(citation.material);
  if (read?.state !== "ready") return;
  await Promise.all(matching(citation, read.value).map((part) => part.kind === "IMAGE" ? loadImage(citation, part) : undefined));
}
function toggle(citation: Citation) {
  const key = keyOf(citation);
  if (open.has(key)) { open.delete(key); return; }
  open.add(key);
  emit("open", { material: citation.material, location: citation.location });
  void show(citation);
}
onBeforeUnmount(() => objectUrls.forEach((url) => URL.revokeObjectURL(url)));
</script>

<template>
  <div class="sources" :class="variant">
    <ul class="source-list" :aria-label="variant === 'rail' ? 'Sources this skill is taught from' : 'Sources used'">
      <li v-for="entry in entries" :key="entry.key">
        <span v-if="variant === 'chips'" class="from" aria-hidden="true">From</span>
        <button type="button" class="source-toggle" :aria-expanded="entry.open" :aria-controls="entry.id" @click="toggle(entry.citation)"><span v-if="variant === 'rail'" class="file-tag" aria-hidden="true">FILE</span><span class="source-name">{{ entry.label }}</span><span aria-hidden="true"> ↗</span></button>
        <div v-show="entry.open" :id="entry.id" class="passage" role="region" :aria-label="entry.label">
          <template v-if="entry.open">
            <p v-if="entry.read.state === 'loading'" class="hint" role="status">Opening the passage…</p>
            <div v-else-if="entry.read.state === 'failed'" class="passage-problem" role="alert">
              <p>{{ entry.read.message }}</p><button type="button" class="source-retry" @click="show(entry.citation)">Try again</button>
            </div>
            <template v-else>
              <p class="passage-label">{{ entry.label }}</p>
              <template v-if="entry.parts.length">
                <template v-for="(part, partIndex) in entry.parts" :key="partIndex">
                  <p v-if="part.kind === 'TEXT'" class="passage-text" tabindex="0">{{ part.text }}</p>
                  <figure v-else class="passage-figure">
                    <img v-if="part.image.state === 'ready'" :src="part.image.value" :alt="entry.label" />
                    <div v-else-if="part.image.state === 'failed'" class="passage-problem" role="alert">
                      <p>{{ part.image.message }}</p><button type="button" class="source-retry" @click="show(entry.citation)">Try again</button>
                    </div>
                    <p v-else class="hint" role="status">Loading the image…</p>
                  </figure>
                </template>
              </template>
              <template v-else>
                <p v-if="entry.citation.location !== 'content'" class="hint">The cited part, {{ entry.label }}, could not be shown on its own. The full readable text is below.</p>
                <p class="passage-text" tabindex="0">{{ entry.read.value.content.trim() || 'This source has no readable text.' }}</p>
              </template>
            </template>
          </template>
        </div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.source-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.chips .source-list{margin-top:12px}
.chips li{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--muted)}
.chips .source-toggle{padding:3px 10px;border:1px solid var(--line);border-radius:999px;background:#FFFFFF;color:var(--ink);font-size:12px;font-weight:600;text-align:left;max-width:100%;overflow-wrap:anywhere}
.chips .source-toggle:hover{background:var(--inset)}
.rail .source-toggle{display:flex;align-items:center;gap:8px;width:100%;text-align:left;border:0;border-radius:10px;background:#F7F5FD;padding:8px 10px;font-size:13px;font-weight:600;color:var(--dawn-soft-text)}
.rail .source-toggle:hover{background:var(--dawn-soft)}
.source-name{flex:1;min-width:0;overflow-wrap:anywhere}
.chips .source-name{flex:initial}
.file-tag{flex:none;font-size:9px;font-weight:800;padding:2px 5px;border-radius:5px;background:var(--coral-wash);color:#B5502B}
.source-toggle[aria-expanded="true"]{box-shadow:0 0 0 2px var(--dawn-edge)}
.passage{flex-basis:100%;margin:2px 0 10px;padding:12px 14px;border:1px solid var(--line);border-left:3px solid var(--dawn-edge);border-radius:10px;background:#FFFFFF;color:var(--ink)}
.passage-label{margin:0 0 8px;font-size:12px;font-weight:600;color:var(--muted)}
.passage-text{margin:0 0 8px;max-height:260px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:13px;line-height:1.7}
.passage-text:focus-visible{outline:3px solid var(--dawn-edge);outline-offset:2px}
.passage .hint{font-size:12px;margin:0 0 8px}
.passage-figure{margin:0 0 8px}
.passage-figure img{display:block;max-width:100%;max-height:420px;height:auto;border-radius:6px;border:1px solid var(--line);background:var(--inset)}
.passage-problem{font-size:13px;border-left:3px solid var(--coral);padding:4px 0 4px 10px;margin:0 0 8px}
.passage-problem p{margin:0 0 4px}
.source-retry{border:0;background:transparent;padding:4px 0;font-size:12px;color:var(--ink);text-decoration:underline;text-underline-offset:3px}
</style>
