import type { StillGotItHttp } from "../../generated/wire.ts";

type DraftSave = Omit<StillGotItHttp["/courses/skills/propose"]["input"], "session">;
type DraftContent = Omit<DraftSave, "proposalKey">;
type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const fields = ["proposalKey", "unit", "material", "title", "outcome", "gate"] as const;

/** Keep each request until its result is acknowledged. A retry sends the saved input. */
export class DraftSaveQueue {
  constructor(private readonly storage: QueueStorage, private readonly key: string) {}

  read(): DraftSave[] {
    const text = this.storage.getItem(this.key);
    if (text === null) return [];
    try {
      const value: unknown = JSON.parse(text);
      if (Array.isArray(value) && value.every((item) => item !== null && typeof item === "object" &&
        fields.every((field) => typeof item[field] === "string" && item[field].trim().length > 0))) {
        return value;
      }
    } catch { /* Report unusable saved work without silently replacing it. */ }
    throw new Error("The pending skill saves could not be read. Keep this tab open and inspect the saved drafts before starting again.");
  }

  start(drafts: DraftContent[]) {
    if (this.read().length) throw new Error("Finish the pending skill saves first.");
    if (!drafts.length || drafts.some((draft) => fields.filter((field) => field !== "proposalKey")
      .some((field) => typeof draft[field] !== "string" || !draft[field].trim() || draft[field].length > 16000))) {
      throw new Error("Choose a unit and source, and fill in every skill's title, outcome, and requirements.");
    }
    this.write(drafts.map((draft) => ({ ...draft, proposalKey: crypto.randomUUID() })));
  }

  async drain(save: (draft: DraftSave) => Promise<unknown>) {
    const pending = this.read();
    while (pending.length) {
      await save(structuredClone(pending[0]!));
      pending.shift();
      this.write(pending);
    }
  }

  private write(pending: DraftSave[]) {
    try {
      if (pending.length) this.storage.setItem(this.key, JSON.stringify(pending));
      else this.storage.removeItem(this.key);
    } catch {
      throw new Error("The browser could not save draft progress. Keep this tab open and retry when browser storage is available.");
    }
  }
}
