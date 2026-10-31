import { computed, reactive, ref, shallowRef } from "vue";
import { api, unwrap } from "./api.ts";
import { RECENT_PAGE, RECENT_PAGES } from "../../src/computations/conversation-pages.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";
import type { RecentSession } from "./recent-groups.ts";

/** One archived conversation as /learning/archived answers it, most recently archived first. */
export type ArchivedSession = StillGotItHttp["/learning/archived"]["output"]["sessions"][number];
type Session = RecentSession["studySession"];

// ---- Which conversations are archived, for every study page ----
// A study page knows which of its skill's conversations are archived from its own read (/learning/read names them in
// `archived`). An archive or restore made on this page, from the sidebar or from a study page, is noted here, so every
// study page that is kept open shows it at once. A page's next read of its skill replaces the note for the
// conversations that read returned, unless the change was made while that read was on its way.
const changes = reactive(new Map<string, { archived: boolean; at: number }>());
let clock = 0;

/** Whether a conversation is archived: the latest change made on this page, or else what the page's read said. */
export function isArchived(session: string, archivedInRead: readonly string[]): boolean {
  const change = changes.get(session);
  return change ? change.archived : archivedInRead.includes(session);
}
/** Marks the start of a read of a skill. Pass the answer to `readDone` with the conversations the read returned. */
export function readStarted(): number { return ++clock; }
export function readDone(started: number, sessions: readonly string[]) {
  for (const session of sessions) {
    const change = changes.get(session);
    if (change && change.at < started) changes.delete(session);
  }
}

/** The two requests that archive and restore a conversation. Tests pass their own. */
export type ArchiveRequests = { archive(studySession: Session): Promise<unknown>; restore(studySession: Session): Promise<unknown> };
const serverArchive: ArchiveRequests = {
  archive: async (studySession) => unwrap(await api.learning.archive({ studySession })),
  restore: async (studySession) => unwrap(await api.learning.restore({ studySession })),
};
/** Archives or restores a conversation and notes the change for every study page. A refusal throws its sentence. */
export async function setArchived(session: Session, archived: boolean, requests: ArchiveRequests = serverArchive) {
  await (archived ? requests.archive(session) : requests.restore(session));
  changes.set(session, { archived, at: ++clock });
}

// ---- The sidebar's Conversations group ----
/** The reads the sidebar's list makes, with the archive requests. Tests pass their own. */
export type ListRequests = ArchiveRequests & {
  recent(course: string, pages: number): Promise<readonly RecentSession[]>;
  archived(course: string): Promise<readonly ArchivedSession[]>;
};
const serverList: ListRequests = {
  ...serverArchive,
  recent: async (course, pages) => unwrap(await api.learning.recent({ course, pages })).sessions,
  archived: async (course) => unwrap(await api.learning.archived({ course })).sessions,
};
const message = (problem: unknown, fallback: string) => problem instanceof Error && problem.message ? problem.message : fallback;

/**
 * The sidebar's list of conversations in a course (design/compositions/LearningReads.md, "Conversations in the
 * sidebar"): the latest ones, older ones a page of 40 at a time, the archived ones, and the note that reports an archive
 * or a restore with Undo.
 *
 * The first read asks for one page, as the sidebar always did. "Show older conversations" asks for one more, and every
 * later read asks for as many pages as are shown, so the list stays whole while conversations move to the top. The
 * archived list is read only while it is open. `changed` runs after each archive or restore made here, so other views
 * that list open conversations, such as Home's Continue card, can read again. A study page reports its own changes, and
 * its refused steps, through `pageChanged`, which reads both lists again and clears the note.
 */
export function useConversationList(course: string, { requests = serverList, changed = () => undefined }: { requests?: ListRequests; changed?: () => void } = {}) {
  const rows = shallowRef<readonly RecentSession[]>([]), loaded = ref(false), error = ref("");
  const pages = ref(1), olderBusy = ref(false), olderNote = ref<{ text: string; failed: boolean } | null>(null);
  // Answers that arrive out of order are dropped: only the latest read of each list is shown.
  let reading = 0, archivedReading = 0;

  /** Reads the list again with the pages shown. A failed first read shows its reason; a later failure keeps the last list. */
  async function load() {
    const ask = ++reading;
    try {
      const answer = await requests.recent(course, pages.value);
      if (ask === reading) { rows.value = answer; error.value = ""; }
    } catch (problem) {
      if (ask === reading && (!loaded.value || error.value)) error.value = message(problem, "Your conversations could not be loaded.");
    } finally { if (ask === reading) loaded.value = true; }
  }
  /** Older conversations may exist when the last read filled every page it asked for. */
  const more = computed(() => olderBusy.value || (loaded.value && !error.value && pages.value < RECENT_PAGES && rows.value.length >= pages.value * RECENT_PAGE));
  /**
   * Reads one more page. Answers the position of the first older conversation, or null when none came: then the note
   * says there are no older conversations, or why they could not be loaded.
   */
  async function showOlder(): Promise<number | null> {
    if (olderBusy.value || !more.value) return null;
    const before = rows.value.length, ask = ++reading;
    olderBusy.value = true; olderNote.value = null; pages.value++;
    try {
      const answer = await requests.recent(course, pages.value);
      if (ask === reading) { rows.value = answer; error.value = ""; }
      if (answer.length > before) return before;
      olderNote.value = { text: "There are no older conversations.", failed: false };
      return null;
    } catch (problem) {
      pages.value--;
      olderNote.value = { text: message(problem, "Older conversations could not be loaded. Try again."), failed: true };
      return null;
    } finally { olderBusy.value = false; }
  }

  const archivedOpen = ref(false), archivedRows = shallowRef<readonly ArchivedSession[]>([]), archivedLoaded = ref(false), archivedError = ref("");
  async function loadArchived() {
    if (!archivedOpen.value) return;
    const ask = ++archivedReading;
    try {
      const answer = await requests.archived(course);
      if (ask === archivedReading) { archivedRows.value = answer; archivedError.value = ""; }
    } catch (problem) {
      if (ask === archivedReading) archivedError.value = message(problem, "Your archived conversations could not be loaded.");
    } finally { if (ask === archivedReading) archivedLoaded.value = true; }
  }
  /** Opens or folds the archived list. It is read each time it opens, so it shows archives made in another tab. */
  async function toggleArchived() {
    archivedOpen.value = !archivedOpen.value;
    if (archivedOpen.value) await loadArchived();
  }
  /** Reads both lists again, after a change here or on a study page. */
  async function refresh() { await Promise.all([load(), loadArchived()]); }

  // The note under "+ New conversation" says what the last archive or restore did. After an archive it offers Undo.
  const note = ref<{ text: string; undo: RecentSession | null; failed: boolean } | null>(null), busy = ref(false);
  async function change(row: RecentSession, archived: boolean, done: string, undo: boolean) {
    if (busy.value) return false;
    busy.value = true; note.value = null;
    try {
      await setArchived(row.studySession, archived, requests);
      note.value = { text: done, undo: undo ? row : null, failed: false };
      changed();
      return true;
    } catch (problem) {
      note.value = { text: message(problem, "The conversation could not be changed. Try again."), undo: null, failed: true };
      return false;
    } finally {
      busy.value = false;
      await refresh();
    }
  }
  const archive = (row: RecentSession) => change(row, true, `“${row.title}” is archived.`, true);
  const restore = (row: RecentSession) => change(row, false, `“${row.title}” is back in Conversations.`, false);
  /** Undo restores the conversation the note named. */
  async function undo() { const row = note.value?.undo; return row ? restore(row) : false; }
  function clearNote() { note.value = null; olderNote.value = null; }
  /**
   * A study page changed a conversation, for example by restoring, continuing, or finishing it, or had a step on one
   * refused because it changed in another tab. The note may then name a conversation that is already back, and its Undo
   * would act on it again, so the note goes. Both lists read again, so the sidebar agrees with the page.
   */
  async function pageChanged() { note.value = null; await refresh(); }

  return reactive({ rows, loaded, error, pages, more, olderBusy, olderNote, load, showOlder,
    archivedOpen, archivedRows, archivedLoaded, archivedError, loadArchived, toggleArchived, refresh,
    note, busy, archive, restore, undo, clearNote, pageChanged });
}
export type ConversationList = ReturnType<typeof useConversationList>;
