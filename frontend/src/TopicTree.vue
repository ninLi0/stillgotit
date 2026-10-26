<script setup lang="ts">
import { computed, ref } from "vue";
import TreePicker from "./TreePicker.vue";
import TreePreview from "./TreePreview.vue";
import { chooseKind } from "./tree-looks.ts";
import { kindFor } from "./tree-kinds.ts";

// The selected topic's tree: a small picture of its kind, the kind's name and description, and "Change tree", which
// opens the tree picker. Home shows it under the grove and the Forest view inside the open topic. `label` is the
// small heading above the kind's name: the topic's title by default.
const props = defineProps<{ unit: string; topic: string; chosen: string | null; label?: string }>();
const picker = ref<InstanceType<typeof TreePicker> | null>(null);
const kind = computed(() => kindFor(props.unit, props.chosen));
const said = ref("");

function choose(next: string | null) {
  chooseKind(props.unit, next);
  said.value = `${props.topic} now grows ${article(kindFor(props.unit, next).name)}.`;
}
function article(name: string) { return `${/^[AEIOU]/.test(name) ? "an" : "a"} ${name.toLowerCase()}`; }
</script>

<template>
  <div class="topic-tree">
    <span class="topic-tree-picture"><TreePreview :key="kind.id" class="topic-tree-grow" :kind="kind" :size="56" /></span>
    <div class="topic-tree-text">
      <p class="eyebrow topic-tree-label">{{ label ?? topic }}</p>
      <strong class="topic-tree-name">{{ kind.name }}</strong>
      <span class="topic-tree-about">{{ kind.description }}</span>
    </div>
    <button type="button" class="secondary meadow topic-tree-change" aria-haspopup="dialog" :aria-label="`Change tree for ${topic}`" @click="picker?.open()">Change tree</button>
    <p class="sr-only" role="status">{{ said }}</p>
    <TreePicker ref="picker" :unit="unit" :topic="topic" :chosen="chosen" @choose="choose" />
  </div>
</template>

<style scoped>
.topic-tree { display: flex; align-items: center; flex-wrap: wrap; gap: 10px 12px; min-width: 0; }
.topic-tree-picture { flex: none; display: grid; place-items: end center; width: 56px; height: 56px; overflow: hidden; border-radius: 12px; }
/* A new kind grows into place with a small overshoot. */
.topic-tree-grow { transform-origin: 50% 100%; animation: sgPop var(--dur-enter) var(--ease-grow) both; }
.topic-tree-text { flex: 1 1 140px; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.topic-tree-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.topic-tree-name { font-size: 15px; line-height: 1.3; }
.topic-tree-about { font-size: 13px; line-height: 1.4; color: var(--muted); }
.topic-tree-change { flex: none; min-height: 38px; padding: 0 14px; font-size: 13px; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
</style>
