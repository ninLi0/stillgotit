<script setup lang="ts">
import { computed, ref, watch } from "vue";
import PixelIcon from "./PixelIcon.vue";
import type { IconName } from "./pixel-art.ts";
import { useSlidingMark } from "./sliding-mark.ts";

// The app's sidebar (design/revamp/README.md): brand, course switcher (the slot, owned by App.vue), the nav rows with
// their biome capsules and badges, the Conversations group (the second slot, owned by CourseWorkspace.vue), and at the
// bottom the Today card and Settings. A lesson has no row of its own here: the Conversations group marks the
// conversation on screen. Under 760px it becomes a top bar with the nav rows as a horizontal strip.
export type ShellView = "home" | "plan" | "setup" | "chat" | "memory";
const props = defineProps<{ view: ShellView; forestOpen: boolean; materialsBadge: number; homeBadge?: number;
  today: { spent: number; total: number } | null; username: string }>();
const emit = defineEmits<{ navigate: [view: ShellView]; forest: []; settings: [] }>();

type Row = { view: ShellView | "forest"; label: string; icon: IconName; biome: string; badge?: number };
const rows = computed<Row[]>(() => [
  { view: "home", label: "Home", icon: "home", biome: "meadow", badge: props.homeBadge },
  { view: "plan", label: "Plan", icon: "calendar", biome: "ocean" },
  { view: "setup", label: "Materials", icon: "school", biome: "sand", badge: props.materialsBadge },
  { view: "forest", label: "Forest view", icon: "tree", biome: "meadow" },
  { view: "memory", label: "Memory", icon: "memory", biome: "dawn" },
]);
function isCurrent(row: Row) {
  if (row.view === "forest") return props.forestOpen;
  if (props.forestOpen) return false;
  return row.view === "home" ? props.view === "home" || props.view === "chat" : props.view === row.view;
}
function go(row: Row) { if (row.view === "forest") emit("forest"); else emit("navigate", row.view); }
// The current row's capsule is one element that slides to the next current row on the move curve and takes on its
// biome's tint on the way, instead of each row painting its own background.
const nav = ref<HTMLElement | null>(null);
const current = computed(() => rows.value.find(isCurrent) ?? null);
const capsule = useSlidingMark(nav, ".nav-row.current");
const capsuleStyle = computed(() => {
  const b = capsule.box.value;
  return b ? { transform: `translate(${b.x}px, ${b.y}px)`, width: `${b.w}px`, height: `${b.h}px` } : { display: "none" };
});
watch(() => current.value?.view, (now, before) => { void capsule.place(!!now && !!before); });
const cells = computed(() => {
  const t = props.today; const on = t && t.total > 0 ? Math.round(Math.min(1, t.spent / t.total) * 15) : 0;
  return Array.from({ length: 15 }, (_, i) => i < on);
});
</script>

<template>
  <aside class="shell-sidebar">
    <div class="brand"><PixelIcon name="leaf" :size="24" /><span class="brand-name">StillGotIt</span></div>
    <slot name="switcher" />
    <nav ref="nav" class="nav" aria-label="Study views">
      <span class="nav-capsule" :class="[current?.biome, { sliding: capsule.sliding.value }]" :style="capsuleStyle" data-mark aria-hidden="true" />
      <button v-for="row in rows" :key="row.view" type="button" class="nav-row" :class="[row.biome, { current: isCurrent(row) }]" :aria-current="isCurrent(row) ? 'page' : undefined" @click="go(row)">
        <PixelIcon :name="row.icon" :size="24" /><span class="nav-label">{{ row.label }}</span>
        <span v-if="row.badge" class="badge" :aria-label="`${row.badge} waiting`">{{ row.badge }}</span>
      </button>
    </nav>
    <slot name="conversations" />
    <div class="bottom">
      <div class="today card">
        <div class="today-top"><PixelIcon name="sun" :size="20" /><span class="eyebrow">Today</span><span class="today-min">{{ today ? `${today.spent} of ${today.total} min` : 'No study time set' }}</span></div>
        <span class="today-cells" role="img" :aria-label="today ? `${today.spent} of ${today.total} minutes studied today` : 'No daily study time set'">
          <span v-for="(on, i) in cells" :key="i" class="today-cell" :class="{ on }" />
        </span>
      </div>
      <button type="button" class="foot-row" aria-haspopup="dialog" @click="emit('settings')"><PixelIcon name="settings" :size="20" /><span class="foot-label">{{ username }}</span><span class="sr-only"> · Settings</span></button>
    </div>
  </aside>
</template>

<style scoped>
.shell-sidebar { display: flex; flex-direction: column; gap: 14px; padding: 20px 12px 14px 14px; min-width: 0; position: sticky; top: 0; height: 100dvh; overflow-y: auto; }
.brand { display: flex; align-items: center; gap: 8px; padding: 0 6px; }
.brand-name { font: 500 20px var(--font-display); color: var(--ink); }
.nav { position: relative; display: flex; flex-direction: column; gap: 4px; }
.nav-row { position: relative; display: flex; align-items: center; gap: 10px; width: 100%; min-height: 42px; padding: 0 12px 0 10px; border: 0; border-radius: 999px; background: transparent; color: var(--soft); font-size: 15px; font-weight: 600; text-align: left; }
.nav-row:hover { background: var(--inset-2); color: var(--ink); }
/* The current row shows the capsule behind it, so it paints no background of its own, even under the pointer. */
.nav-row.current, .nav-row.current:hover { background: transparent; color: var(--ink); font-weight: 700; }
.nav-capsule { position: absolute; left: 0; top: 0; border-radius: 999px; pointer-events: none; }
.nav-capsule.sliding { transition: transform var(--dur-move) var(--ease-move), width var(--dur-move) var(--ease-move), height var(--dur-move) var(--ease-move), background-color var(--dur-move) var(--ease-move); }
.nav-capsule.meadow { background: var(--meadow-nav); }
.nav-capsule.ocean { background: var(--ocean-nav); }
.nav-capsule.sand { background: var(--sand-nav); }
.nav-capsule.dawn { background: var(--dawn-nav); }
.nav-label { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.badge { display: inline-grid; place-items: center; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--coral); color: var(--on-fill); font-size: 12px; font-weight: 700; }
.nav-row.current .badge { background: var(--on-fill); color: var(--coral); }
.bottom { margin-top: auto; display: flex; flex-direction: column; gap: 6px; }
.today { padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.today-top { display: flex; align-items: center; gap: 6px; }
.today-min { margin-left: auto; font-size: 13px; font-weight: 700; color: var(--ink); white-space: nowrap; }
.today-cells { display: flex; gap: 2px; }
.today-cell { flex: 1 1 0; height: 6px; border-radius: 1px; background: var(--sun-off); }
.today-cell.on { background: var(--sun); }
.foot-row { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 0 10px; border: 0; border-radius: 12px; background: transparent; color: var(--soft); font-size: 13px; font-weight: 600; text-align: left; }
.foot-row:hover { background: var(--inset-2); color: var(--ink); }
.foot-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 760px) {
  .shell-sidebar { position: static; height: auto; padding: 12px 14px 4px; gap: 10px; overflow: visible; }
  .brand { padding: 0; }
  .nav { flex-direction: row; overflow-x: auto; gap: 4px; padding-bottom: 4px; scrollbar-width: none; }
  .nav-row { width: auto; flex: none; min-height: 38px; font-size: 14px; }
  .nav-label { overflow: visible; }
  .bottom { flex-direction: row; flex-wrap: wrap; margin-top: 0; }
  .today { flex: 1 1 100%; padding: 8px 10px; }
  .foot-row { width: auto; flex: 1 1 0; min-width: 0; }
}
</style>
