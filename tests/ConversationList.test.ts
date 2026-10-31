import { describe, expect, test } from "bun:test";
import { isArchived, readDone, readStarted, setArchived, useConversationList, type ArchivedSession, type ListRequests } from "../frontend/src/conversation-list.ts";
import type { RecentSession } from "../frontend/src/recent-groups.ts";

// The sidebar's list of conversations (frontend/src/conversation-list.ts) against a fake server: `total` conversations,
// newest first, of which the archived ones are left out before each page of 40, as /learning/recent does.

const row = (id: string) => ({ studySession: id, skill: "skill", skillTitle: "Products", kind: "LESSON", status: "OPEN", title: `Lesson ${id}`,
  startedAt: "2026-10-28T15:00:00Z", lastActivity: "2026-10-28T15:00:00Z" }) as RecentSession;

function fakeServer(total: number, prefix: string) {
  const all = Array.from({ length: total }, (_, index) => row(`${prefix}-${total - index}`));
  const archived = new Map<string, string>(), asked: string[] = [];
  let failNext: string | null = null;
  const fail = () => { const reason = failNext; failNext = null; if (reason) throw new Error(reason); };
  const requests: ListRequests = {
    recent: async (_course, pages) => { asked.push(`recent ${pages}`); fail(); return all.filter((item) => !archived.has(item.studySession)).slice(0, pages * 40); },
    archived: async () => { asked.push("archived"); fail(); return all.filter((item) => archived.has(item.studySession)).map((item) => ({ ...item, archivedAt: archived.get(item.studySession)! }) as ArchivedSession); },
    archive: async (session) => { asked.push(`archive ${session}`); fail(); if (!archived.has(session)) archived.set(session, new Date().toISOString()); return {}; },
    restore: async (session) => { asked.push(`restore ${session}`); fail(); archived.delete(session); return {}; },
  };
  return { all, archived, asked, requests, failOnce(reason: string) { failNext = reason; } };
}
const ids = (rows: readonly RecentSession[]) => rows.map((item) => String(item.studySession));

describe("Older conversations", () => {
  test("the first read asks for one page, and Show older asks for one more each time until a read comes back short", async () => {
    const server = fakeServer(81, "older"), list = useConversationList("course", { requests: server.requests });
    expect(list.more).toBe(false);
    await list.load();
    expect(server.asked).toEqual(["recent 1"]);
    expect(ids(list.rows)).toEqual(ids(server.all.slice(0, 40)));
    expect(list.more).toBe(true);
    // The second page joins the list, and the first of its conversations is where focus goes.
    expect(await list.showOlder()).toBe(40);
    expect(list.rows).toHaveLength(80);
    expect(list.more).toBe(true);
    // Every later read keeps the pages shown, so the list stays whole.
    await list.load();
    expect(server.asked).toEqual(["recent 1", "recent 2", "recent 2"]);
    expect(await list.showOlder()).toBe(80);
    expect(ids(list.rows)).toEqual(ids(server.all));
    // The third page held one conversation, so there is nothing older and the row goes away.
    expect(list.more).toBe(false);
    expect(await list.showOlder()).toBeNull();
    expect(server.asked.at(-1)).toBe("recent 3");
  });

  test("a full first page with nothing older says so, and a failed read of older ones keeps the list and can be tried again", async () => {
    const server = fakeServer(40, "full"), list = useConversationList("course", { requests: server.requests });
    await list.load();
    expect(list.more).toBe(true);
    server.failOnce("The server did not answer. Check your connection and try again.");
    expect(await list.showOlder()).toBeNull();
    expect(list.olderNote).toEqual({ text: "The server did not answer. Check your connection and try again.", failed: true });
    expect(list.pages).toBe(1);
    expect(list.rows).toHaveLength(40);
    expect(list.more).toBe(true);
    expect(await list.showOlder()).toBeNull();
    expect(list.olderNote).toEqual({ text: "There are no older conversations.", failed: false });
    expect(list.more).toBe(false);
    list.clearNote();
    expect(list.olderNote).toBeNull();
  });

  test("a failed first read shows its reason, a later failure keeps the last list, and an older answer never replaces a newer one", async () => {
    const server = fakeServer(3, "fail"), list = useConversationList("course", { requests: server.requests });
    server.failOnce("Your session ended. Sign in again.");
    await list.load();
    expect(list.error).toBe("Your session ended. Sign in again.");
    expect(list.more).toBe(false);
    await list.load();
    expect(list.error).toBe("");
    expect(list.rows).toHaveLength(3);
    server.failOnce("The server did not answer.");
    await list.load();
    expect(list.error).toBe("");
    expect(list.rows).toHaveLength(3);

    // A slow read that started first answers last; its answer is dropped.
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    const original = server.requests.recent;
    let calls = 0;
    server.requests.recent = async (course, pages) => { const answer = await original(course, pages); if (++calls === 1) { await slow; return answer.slice(0, 1); } return answer; };
    const first = list.load(), second = list.load();
    await second;
    release(); await first;
    expect(list.rows).toHaveLength(3);
  });
});

describe("Archiving from the sidebar", () => {
  test("archiving names the conversation with Undo, Undo restores it, and every study page sees the change at once", async () => {
    let changes = 0;
    const server = fakeServer(3, "undo"), list = useConversationList("course", { requests: server.requests, changed: () => { changes++; } });
    await list.load();
    const target = list.rows[0]!;
    expect(isArchived(target.studySession, [])).toBe(false);
    expect(await list.archive(target)).toBe(true);
    expect(list.note).toEqual({ text: "“Lesson undo-3” is archived.", undo: target, failed: false });
    // Home's Continue card is told to read again.
    expect(changes).toBe(1);
    expect(isArchived(target.studySession, [])).toBe(true);
    // The list is read again, without the archived conversation. The archived list is folded, so it is not read.
    expect(server.asked).toEqual(["recent 1", "archive undo-3", "recent 1"]);
    expect(ids(list.rows)).toEqual(["undo-2", "undo-1"]);

    expect(await list.undo()).toBe(true);
    expect(list.note).toEqual({ text: "“Lesson undo-3” is back in Conversations.", undo: null, failed: false });
    expect(isArchived(target.studySession, [target.studySession])).toBe(false);
    expect(ids(list.rows)).toEqual(["undo-3", "undo-2", "undo-1"]);
    expect(changes).toBe(2);
    // With nothing to undo, Undo does nothing.
    expect(await list.undo()).toBe(false);
    expect(changes).toBe(2);
  });

  test("a refused archive shows the reason and changes nothing", async () => {
    let changes = 0;
    const server = fakeServer(2, "refused"), list = useConversationList("course", { requests: server.requests, changed: () => { changes++; } });
    await list.load();
    server.failOnce("Choose one of your own conversations to archive.");
    expect(await list.archive(list.rows[0]!)).toBe(false);
    expect(list.note).toEqual({ text: "Choose one of your own conversations to archive.", undo: null, failed: true });
    expect(isArchived("refused-2", [])).toBe(false);
    expect(list.rows).toHaveLength(2);
    expect(list.busy).toBe(false);
    expect(changes).toBe(0);
  });

  test("the archived list is read when it opens and after each change while it is open, and Restore moves a conversation back", async () => {
    const server = fakeServer(3, "shelf"), list = useConversationList("course", { requests: server.requests });
    await list.load();
    await list.archive(list.rows[1]!);
    expect(server.asked).not.toContain("archived");
    await list.toggleArchived();
    expect(list.archivedOpen).toBe(true);
    expect(list.archivedLoaded).toBe(true);
    expect(list.archivedRows.map((item) => String(item.studySession))).toEqual(["shelf-2"]);
    const restored = list.archivedRows[0]!;
    expect(await list.restore(restored)).toBe(true);
    expect(list.note).toEqual({ text: "“Lesson shelf-2” is back in Conversations.", undo: null, failed: false });
    expect(list.archivedRows).toEqual([]);
    expect(ids(list.rows)).toEqual(["shelf-3", "shelf-2", "shelf-1"]);
    // Folded again, the list is no longer read.
    await list.toggleArchived();
    const reads = server.asked.filter((ask) => ask === "archived").length;
    await list.refresh();
    expect(server.asked.filter((ask) => ask === "archived")).toHaveLength(reads);
    // A failed read of the archived list shows its reason; opening it again reads it again.
    server.failOnce("The server did not answer.");
    await list.toggleArchived();
    expect(list.archivedError).toBe("The server did not answer.");
    await list.loadArchived();
    expect(list.archivedError).toBe("");
  });
});

describe("Archived state on the study pages", () => {
  test("a page's read replaces the changes made before it started, and keeps one made while it was on its way", async () => {
    const requests = fakeServer(0, "page").requests;
    await setArchived("page-a" as RecentSession["studySession"], true, requests);
    // The read started after the archive, so what it says is current.
    const after = readStarted();
    readDone(after, ["page-a"]);
    expect(isArchived("page-a", [])).toBe(false);
    expect(isArchived("page-a", ["page-a"])).toBe(true);
    // A restore made while a read is on its way is kept, since that read may not include it.
    const during = readStarted();
    await setArchived("page-a" as RecentSession["studySession"], false, requests);
    readDone(during, ["page-a"]);
    expect(isArchived("page-a", ["page-a"])).toBe(false);
    // A read that did not return the conversation leaves its change alone.
    readDone(readStarted(), ["page-b"]);
    expect(isArchived("page-a", ["page-a"])).toBe(false);
  });
});
