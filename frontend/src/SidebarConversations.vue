<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { messageTime } from "./labels.ts";
import { recentGroups, shortAgo, type RecentSession } from "./recent-groups.ts";

// The sidebar's Conversations group, after ChatGPT's list of recent chats: "+ New conversation" first, then the
// learner's latest lessons and practice sessions in the course (/learning/recent), grouped by the day of their last
// activity. Selecting a row opens that conversation. On phones the sidebar is a top bar, so the group folds behind a
// "Conversations" button and opens below it like a drawer.
const props = defineProps<{ rows: readonly RecentSession[]; current: string | null; loaded: boolean; error: string }>();
const emit = defineEmits<{ open: [row: RecentSession]; new: []; retry: [] }>();

// Relative times ("5 min") are worked out against a clock that moves on each minute.
const now = ref(new Date());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => { ticker = setInterval(() => { now.value = new Date(); }, 60_000); });
onBeforeUnmount(() => clearInterval(ticker));
const groups = computed(() => recentGroups(props.rows, now.value));

const expanded = ref(false), toggle = ref<HTMLButtonElement | null>(null);
/** True when the sidebar is the phone top bar, where the group is folded. */
function folded() { return window.matchMedia("(max-width: 760px)").matches; }
async function collapse() {
  if (!expanded.value || !folded()) return;
  expanded.value = false; await nextTick(); toggle.value?.focus();
}
// On phones the drawer closes once a choice is made, and focus returns to its button.
function choose(row: RecentSession) { emit("open", row); void collapse(); }
function startNew() { emit("new"); void collapse(); }
</script>

<template>
  <section class="conversations" :class="{ expanded }" aria-labelledby="conversations-title" @keydown.esc="collapse">
    <h2 id="conversations-title" class="eyebrow conv-title">Conversations</h2>
    <button ref="toggle" type="button" class="conv-toggle" :aria-expanded="expanded" aria-controls="conversations-body" @click="expanded = !expanded">
      <span class="conv-toggle-label">Conversations</span><span v-if="rows.length" class="conv-count">{{ rows.length }}</span>
      <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path :d="expanded ? 'M3 7.5 6 4.5 9 7.5' : 'M3 4.5 6 7.5 9 4.5'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" /></svg>
    </button>
    <div id="conversations-body" class="conv-body">
      <button type="button" class="conv-new" @click="startNew"><span aria-hidden="true">+</span> New conversation</button>
      <div v-if="error" class="conv-note" role="alert"><p>{{ error }}</p><button type="button" class="quiet" @click="emit('retry')">Try again</button></div>
      <p v-else-if="loaded && !rows.length" class="conv-note">Your lessons and practice will appear here.</p>
      <template v-for="group in groups" :key="group.label">
        <h3 :id="`conversations-${group.label.replace(/ /g, '-').toLowerCase()}`" class="conv-day">{{ group.label }}</h3>
        <ul class="conv-list" :aria-labelledby="`conversations-${group.label.replace(/ /g, '-').toLowerCase()}`">
          <li v-for="row in group.rows" :key="row.studySession">
            <button type="button" class="conv-row" :class="{ current: row.studySession === current }" :aria-current="row.studySession === current ? 'true' : undefined" :title="row.title" @click="choose(row)">
              <span class="conv-line"><span class="conv-name">{{ row.title }}</span><span v-if="row.status === 'OPEN'" class="conv-open" aria-hidden="true" /></span>
              <span class="conv-meta" aria-hidden="true"><span class="conv-skill">{{ row.skillTitle }}</span><span v-if="row.lastActivity" class="conv-ago"> · {{ shortAgo(row.lastActivity, now) }}</span></span>
              <span class="sr-only">, {{ row.skillTitle }}{{ row.status === 'OPEN' ? ', open' : '' }}<template v-if="row.lastActivity">, last active {{ messageTime(row.lastActivity) }}</template></span>
            </button>
          </li>
        </ul>
      </template>
    </div>
  </section>
</template>

<style scoped>
/* On wide screens the group fills the sidebar between the views and the Today card, and scrolls on its own. */
.conversations { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 140px; }
.conv-title { padding: 4px 12px 6px; }
.conv-toggle { display: none; }
.conv-body { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; margin: 0 -4px; padding: 0 4px 4px; }
.conv-new { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--dawn-soft-text); font-size: 14px; font-weight: 700; text-align: left; }
.conv-new:hover { background: var(--inset-2); }
.conv-note { margin: 4px 12px; font-size: 13px; color: var(--muted); }
.conv-note p { margin: 0; }
.conv-note .quiet { padding: 4px 0; font-size: 13px; }
.conv-day { margin: 12px 12px 4px; font-size: 12px; font-weight: 700; color: var(--muted); }
.conv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
/* A row is the sidebar's capsule in the lesson's dawn tint when its conversation is the one on screen. */
.conv-row { display: flex; flex-direction: column; gap: 1px; width: 100%; min-height: 44px; padding: 5px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--ink); text-align: left; transition: background-color var(--dur-quick) var(--ease-enter); }
.conv-row:hover { background: var(--inset-2); }
.conv-row.current, .conv-row.current:hover { background: #DEDAFF; }
.conv-line { display: flex; align-items: center; gap: 8px; min-width: 0; }
.conv-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 600; }
.conv-row.current .conv-name { font-weight: 700; }
/* Open conversations carry a small dawn square, like the lesson's tab squares. */
.conv-open { flex: none; width: 6px; height: 6px; background: var(--dawn-soft-text); }
/* The meta line follows the lesson tabs' meta (12 px, weight 500) in muted grey, which stays above 4.5:1 on the hover
   and current backgrounds. */
.conv-meta { display: flex; min-width: 0; font-size: 12px; font-weight: 500; color: var(--muted); white-space: nowrap; }
.conv-skill { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.conv-ago { flex: none; white-space: pre; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 760px) {
  .conversations { flex: none; min-height: 0; }
  .conv-title { display: none; }
  .conv-toggle { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 12px; border: 0; border-radius: 12px; background: var(--inset); color: var(--ink); font-size: 14px; font-weight: 700; text-align: left; }
  .conv-toggle:hover, .conv-toggle[aria-expanded="true"] { background: var(--inset-2); }
  .conv-toggle-label { flex: 1; }
  .conv-count { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 6px; border-radius: 999px; background: #FFFFFF; color: var(--soft); font-size: 12px; font-weight: 700; }
  .conv-toggle svg { flex: none; color: var(--muted); }
  .conv-body { display: none; max-height: 55dvh; margin: 6px 0 0; padding: 6px; border-radius: 14px; box-shadow: 0 0 0 1px var(--ring); animation: sgRise var(--dur-enter) var(--ease-enter) both; }
  .expanded .conv-body { display: flex; }
}
</style>
