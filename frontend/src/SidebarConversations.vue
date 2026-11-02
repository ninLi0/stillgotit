<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { messageTime } from "./labels.ts";
import { recentGroups, shortAgo, type RecentSession } from "./recent-groups.ts";
import type { ArchivedSession, ConversationList } from "./conversation-list.ts";

// The sidebar's Conversations group, after ChatGPT's list of recent chats, and the one place to pick a conversation:
// "+ New conversation" first, then the learner's latest lessons and practice sessions in the course (/learning/recent),
// grouped by the day of their last activity. Selecting a row opens that conversation, and the highlighted row is the one
// on screen; the lesson page shows only that one. On phones the sidebar is a top bar, so the whole group, "+ New
// conversation" included, folds behind a "Conversations" button and opens below it like a drawer.
//
// A row's "⋯" button opens a small menu with "Archive conversation", so archiving takes two deliberate clicks; the note
// below "+ New conversation" then names the conversation and offers Undo. "Show older conversations" reads the next 40.
// The group ends with "Archived conversations", folded, whose rows open read-only and each have Restore.
const props = defineProps<{ list: ConversationList; current: string | null }>();
const emit = defineEmits<{ open: [row: RecentSession | ArchivedSession]; new: [] }>();

// Relative times ("5 min") are worked out against a clock that moves on each minute.
const now = ref(new Date());
let ticker: ReturnType<typeof setInterval> | undefined;
onMounted(() => { ticker = setInterval(() => { now.value = new Date(); }, 60_000); });
onBeforeUnmount(() => clearInterval(ticker));
const groups = computed(() => recentGroups(props.list.rows, now.value));

const expanded = ref(false), toggle = ref<HTMLButtonElement | null>(null), body = ref<HTMLElement | null>(null);
/** True when the sidebar is the phone top bar, where the group is folded. */
function folded() { return window.matchMedia("(max-width: 760px)").matches; }
async function collapse() {
  if (!expanded.value || !folded()) return;
  expanded.value = false; await nextTick(); toggle.value?.focus();
}
// On phones the drawer closes once a choice is made, and focus returns to its button.
function choose(row: RecentSession | ArchivedSession) { menuFor.value = null; props.list.clearNote(); emit("open", row); void collapse(); }
function startNew() { menuFor.value = null; props.list.clearNote(); emit("new"); void collapse(); }

// ---- A row's menu ----
// One menu is open at a time. It closes on Escape, which returns focus to its "⋯" button, and when focus or a click
// lands outside its row.
const menuFor = ref<string | null>(null);
const menuId = (row: RecentSession) => `conversation-menu-${row.studySession}`;
function moreButton(session: string) { return body.value?.querySelector<HTMLButtonElement>(`[data-more="${session}"]`) ?? null; }
async function toggleMenu(row: RecentSession) {
  menuFor.value = menuFor.value === row.studySession ? null : row.studySession;
  if (!menuFor.value) return;
  await nextTick(); body.value?.querySelector<HTMLButtonElement>(`#${CSS.escape(menuId(row))} button`)?.focus();
}
/** Escape in an open menu closes only the menu; on phones the drawer stays open. */
async function escapeMenu(event: KeyboardEvent, row: RecentSession) {
  if (menuFor.value !== row.studySession) return;
  event.stopPropagation();
  menuFor.value = null; await nextTick(); moreButton(row.studySession)?.focus();
}
function leaveRow(event: FocusEvent) {
  const row = event.currentTarget as HTMLElement, next = event.relatedTarget as Node | null;
  if (next && !row.contains(next)) menuFor.value = null;
}
function clickOutside(event: PointerEvent) {
  if (menuFor.value && !(event.target instanceof Element && event.target.closest(".conv-item.menu-open"))) menuFor.value = null;
}
onMounted(() => document.addEventListener("pointerdown", clickOutside));
onBeforeUnmount(() => document.removeEventListener("pointerdown", clickOutside));

// ---- Archive, Undo, Restore and older pages; focus goes where the learner's next step is ----
const undoButton = ref<HTMLButtonElement | null>(null), noteText = ref<HTMLElement | null>(null), archivedFold = ref<HTMLButtonElement | null>(null);
const olderNote = ref<HTMLElement | null>(null);
function rowButton(session: string) { return body.value?.querySelector<HTMLButtonElement>(`[data-conversation="${session}"]`) ?? null; }
/** The archived row leaves the list; focus moves to Undo, or to the reason when archiving failed. */
async function archive(row: RecentSession) {
  menuFor.value = null;
  const done = await props.list.archive(row);
  await nextTick();
  (done ? undoButton.value : noteText.value)?.focus();
}
/** Undo restores the conversation, and focus returns to its row. */
async function undo() {
  const row = props.list.note?.undo;
  const done = await props.list.undo();
  await nextTick();
  ((done && row ? rowButton(row.studySession) : null) ?? noteText.value)?.focus();
}
/** A restored row leaves the archived list; focus moves to the next archived row's Restore, or to the list's button. */
async function restore(row: ArchivedSession, index: number) {
  const done = await props.list.restore(row);
  await nextTick();
  if (!done) { noteText.value?.focus(); return; }
  const buttons = body.value?.querySelectorAll<HTMLButtonElement>(".conv-restore") ?? [];
  (buttons[Math.min(index, buttons.length - 1)] ?? archivedFold.value)?.focus();
}
/** Older conversations join the list; focus moves to the first of them, or to the note when none came. */
async function older() {
  const first = await props.list.showOlder();
  await nextTick();
  const rows = body.value?.querySelectorAll<HTMLButtonElement>(".conv-recent .conv-row") ?? [];
  (first !== null ? rows[first] : olderNote.value)?.focus();
}
</script>

<template>
  <section class="conversations" :class="{ expanded }" aria-labelledby="conversations-title" @keydown.esc="collapse">
    <h2 id="conversations-title" class="eyebrow conv-title">Conversations</h2>
    <button ref="toggle" type="button" class="conv-toggle" :aria-expanded="expanded" aria-controls="conversations-body" @click="expanded = !expanded">
      <span class="conv-toggle-label">Conversations</span><span v-if="list.rows.length" class="conv-count">{{ list.rows.length }}</span>
      <svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path :d="expanded ? 'M3 7.5 6 4.5 9 7.5' : 'M3 4.5 6 7.5 9 4.5'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" /></svg>
    </button>
    <div id="conversations-body" ref="body" class="conv-body">
      <button type="button" class="conv-new" @click="startNew"><span aria-hidden="true">+</span> New conversation</button>
      <div role="status"><div v-if="list.note && !list.note.failed" class="conv-note conv-done"><p ref="noteText" tabindex="-1">{{ list.note.text }}</p><button v-if="list.note.undo" ref="undoButton" type="button" class="quiet" :disabled="list.busy" @click="undo">Undo</button></div></div>
      <div role="alert"><div v-if="list.note?.failed" class="conv-note"><p ref="noteText" tabindex="-1">{{ list.note.text }}</p></div></div>
      <div v-if="list.error" class="conv-note" role="alert"><p>{{ list.error }}</p><button type="button" class="quiet" @click="list.load()">Try again</button></div>
      <p v-else-if="list.loaded && !list.rows.length" class="conv-note">Your lessons and practice will appear here.</p>
      <div class="conv-recent">
        <template v-for="group in groups" :key="group.label">
          <h3 :id="`conversations-${group.label.replace(/ /g, '-').toLowerCase()}`" class="conv-day">{{ group.label }}</h3>
          <ul class="conv-list" :aria-labelledby="`conversations-${group.label.replace(/ /g, '-').toLowerCase()}`">
            <li v-for="row in group.rows" :key="row.studySession" class="conv-item" :class="{ 'menu-open': menuFor === row.studySession }" @focusout="leaveRow" @keydown.esc="escapeMenu($event, row)">
              <button type="button" class="conv-row" :class="{ current: row.studySession === current }" :aria-current="row.studySession === current ? 'true' : undefined" :title="row.title" :data-conversation="row.studySession" @click="choose(row)">
                <span class="conv-line"><span class="conv-name">{{ row.title }}</span><span v-if="row.status === 'OPEN'" class="conv-open" aria-hidden="true" /></span>
                <span class="conv-meta" aria-hidden="true"><span v-if="row.kind === 'LESSON'" class="conv-skill">{{ row.skillTitle }}</span><span v-if="row.lastActivity" class="conv-ago">{{ row.kind === 'LESSON' ? ' · ' : '' }}{{ shortAgo(row.lastActivity, now) }}</span></span>
                <span class="sr-only">{{ row.kind === 'LESSON' ? `, ${row.skillTitle}` : '' }}{{ row.status === 'OPEN' ? ', open' : '' }}<template v-if="row.lastActivity">, last active {{ messageTime(row.lastActivity) }}</template></span>
              </button>
              <button type="button" class="conv-more" :aria-expanded="menuFor === row.studySession" :aria-controls="menuId(row)" :aria-label="`More actions for ${row.title}`" :title="`More actions for ${row.title}`" :data-more="row.studySession" :disabled="list.busy" @click="toggleMenu(row)">
                <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16"><rect x="2" y="7" width="2.5" height="2.5" fill="currentColor" /><rect x="6.75" y="7" width="2.5" height="2.5" fill="currentColor" /><rect x="11.5" y="7" width="2.5" height="2.5" fill="currentColor" /></svg>
              </button>
              <div v-if="menuFor === row.studySession" :id="menuId(row)" class="conv-menu">
                <button type="button" class="conv-menu-item" :disabled="list.busy" @click="archive(row)">Archive conversation</button>
              </div>
            </li>
          </ul>
        </template>
      </div>
      <button v-if="list.more" type="button" class="conv-older" :disabled="list.olderBusy" @click="older">{{ list.olderBusy ? 'Loading older conversations…' : 'Show older conversations' }}</button>
      <p v-if="list.olderNote" ref="olderNote" class="conv-note" tabindex="-1" :role="list.olderNote.failed ? 'alert' : 'status'">{{ list.olderNote.text }}</p>
      <div class="conv-archived">
        <button ref="archivedFold" type="button" class="conv-fold" :aria-expanded="list.archivedOpen" aria-controls="conversations-archived" @click="list.toggleArchived()">
          <span>Archived conversations</span><svg aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path :d="list.archivedOpen ? 'M3 7.5 6 4.5 9 7.5' : 'M3 4.5 6 7.5 9 4.5'" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" /></svg>
        </button>
        <div v-if="list.archivedOpen" id="conversations-archived">
          <div v-if="list.archivedError" class="conv-note" role="alert"><p>{{ list.archivedError }}</p><button type="button" class="quiet" @click="list.loadArchived()">Try again</button></div>
          <p v-else-if="!list.archivedLoaded" class="conv-note">Loading your archived conversations…</p>
          <p v-else-if="!list.archivedRows.length" class="conv-note">Nothing is archived. A conversation you archive from its ⋯ button waits here until you restore it.</p>
          <ul v-else class="conv-list" aria-label="Archived conversations">
            <li v-for="(row, index) in list.archivedRows" :key="row.studySession" class="conv-item conv-archived-item">
              <button type="button" class="conv-row" :class="{ current: row.studySession === current }" :aria-current="row.studySession === current ? 'true' : undefined" :title="row.title" @click="choose(row)">
                <span class="conv-line"><span class="conv-name">{{ row.title }}</span></span>
                <span class="conv-meta" aria-hidden="true"><span v-if="row.kind === 'LESSON'" class="conv-skill">{{ row.skillTitle }}</span><span v-if="row.lastActivity" class="conv-ago">{{ row.kind === 'LESSON' ? ' · ' : '' }}{{ shortAgo(row.lastActivity, now) }}</span></span>
                <span class="sr-only">{{ row.kind === 'LESSON' ? `, ${row.skillTitle}` : '' }}, archived, opens read-only<template v-if="row.lastActivity">, last active {{ messageTime(row.lastActivity) }}</template></span>
              </button>
              <button type="button" class="quiet conv-restore" :disabled="list.busy" :aria-label="`Restore ${row.title}`" @click="restore(row, index)">Restore</button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* On wide screens the group fills the sidebar between the views and the Today card, and scrolls on its own. */
.conversations { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 140px; }
.conv-title { padding: 4px 12px 6px; }
.conv-toggle { display: none; }
.conv-body { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; margin: 0 -4px; padding: 0 4px 4px; }
.conv-new { display: flex; align-items: center; flex: none; gap: 8px; width: 100%; min-height: 36px; padding: 0 12px; border: 0; border-radius: 999px; background: transparent; color: var(--dawn-soft-text); font-size: 14px; font-weight: 700; text-align: left; }
.conv-new:hover { background: var(--inset-2); }
.conv-note { margin: 4px 12px; font-size: 13px; color: var(--muted); }
.conv-note p { margin: 0; }
.conv-note .quiet { padding: 4px 0; font-size: 13px; }
/* What the last archive or restore did, with Undo beside it when there is one. */
.conv-done { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; color: var(--soft); }
.conv-done p { min-width: 0; overflow-wrap: anywhere; }
.conv-day { margin: 12px 12px 4px; font-size: 12px; font-weight: 700; color: var(--muted); }
.conv-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
.conv-item { position: relative; }
/* A row is the sidebar's capsule in the lesson's dawn tint when its conversation is the one on screen. */
.conv-row { display: flex; flex-direction: column; gap: 1px; width: 100%; min-height: 44px; padding: 5px 14px; border: 0; border-radius: 999px; background: transparent; color: var(--ink); text-align: left; transition: background-color var(--dur-quick) var(--ease-enter); }
.conv-item:hover .conv-row, .conv-item.menu-open .conv-row { background: var(--inset-2); }
.conv-row.current, .conv-item:hover .conv-row.current, .conv-item.menu-open .conv-row.current { background: var(--dawn-nav); }
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
/* The "⋯" button sits over the row's right end, centred on the 44-pixel row even while the menu opens below. It shows while the pointer is over the row, while the row or its menu
   has focus, on the current row, and always on touch screens, which have no hover. It takes the row's background, so
   the end of a long title disappears under it instead of showing through. */
.conv-more { position: absolute; top: 7px; right: 6px; display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 0; border-radius: 999px; background: var(--inset-2); color: var(--soft); opacity: 0; transition: opacity var(--dur-quick) var(--ease-enter), background-color var(--dur-quick) var(--ease-enter); }
.conv-row.current + .conv-more { background: var(--dawn-nav); }
.conv-item:hover .conv-more, .conv-item:focus-within .conv-more, .conv-item.menu-open .conv-more, .conv-row.current + .conv-more { opacity: 1; }
.conv-more:hover:not(:disabled), .conv-more[aria-expanded="true"] { background: var(--inset-3); color: var(--ink); }
.conv-more:disabled { color: var(--faint); }
@media (hover: none) { .conv-more { opacity: 1; } }
/* The menu opens just under its row and moves the rows below down, so the narrow, scrolling sidebar never cuts it off.
   It is a card like the course menu. */
.conv-menu { display: flex; flex-direction: column; margin: 4px 4px 6px 14px; padding: 4px; border-radius: 12px; background: var(--card); box-shadow: 0 6px 18px rgb(var(--shadow) / .10), 0 0 0 1px var(--ring); animation: sgRise var(--dur-enter) var(--ease-enter) both; }
.conv-menu-item { padding: 8px 10px; border: 0; border-radius: 8px; background: transparent; color: var(--ink); font-size: 14px; text-align: left; }
.conv-menu-item:hover:not(:disabled) { background: var(--inset-2); }
/* "Show older conversations" reads like a quiet row at the end of the list. */
.conv-older { flex: none; width: 100%; min-height: 36px; margin-top: 6px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--soft); font-size: 13px; font-weight: 700; text-align: left; }
.conv-older:hover:not(:disabled) { background: var(--inset-2); color: var(--ink); }
.conv-older:disabled { color: var(--muted); }
/* The archived list is folded at the end of the group, under a rule, like Archived courses in the course menu. */
.conv-archived { flex: none; margin-top: 10px; padding-top: 4px; border-top: 1px solid var(--line); }
.conv-fold { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 36px; padding: 0 14px; border: 0; border-radius: 999px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 700; text-align: left; }
.conv-fold:hover { background: var(--inset-2); color: var(--ink); }
.conv-fold svg { flex: none; }
.conv-archived-item { display: flex; align-items: center; gap: 4px; }
.conv-archived-item .conv-row { flex: 1; min-width: 0; }
.conv-restore { flex: none; padding: 4px 10px 4px 4px; font-size: 13px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
@media (max-width: 760px) {
  .conversations { flex: none; min-height: 0; }
  .conv-title { display: none; }
  .conv-toggle { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 40px; padding: 0 12px; border: 0; border-radius: 12px; background: var(--inset); color: var(--ink); font-size: 14px; font-weight: 700; text-align: left; }
  .conv-toggle:hover, .conv-toggle[aria-expanded="true"] { background: var(--inset-2); }
  .conv-toggle-label { flex: 1; }
  .conv-count { display: inline-grid; place-items: center; min-width: 22px; height: 20px; padding: 0 6px; border-radius: 999px; background: var(--card); color: var(--soft); font-size: 12px; font-weight: 700; }
  .conv-toggle svg { flex: none; color: var(--muted); }
  .conv-body { display: none; max-height: 55dvh; margin: 6px 0 0; padding: 6px; border-radius: 14px; box-shadow: 0 0 0 1px var(--ring); animation: sgRise var(--dur-enter) var(--ease-enter) both; }
  .expanded .conv-body { display: flex; }
  /* The drawer is narrow and touch-first, so the "⋯" button always shows. */
  .conv-more { opacity: 1; }
}
</style>
