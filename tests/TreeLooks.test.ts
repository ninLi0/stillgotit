import { describe, expect, test } from "bun:test";
import { createTreeLooks, type LookServer } from "../frontend/src/tree-looks.ts";

// The page's tree looks against a stand-in server and a stand-in local storage. Each call to the server waits until the
// test answers it, so the tests can choose the order in which answers arrive.
type Call = { path: "look" | "clear"; unit: string; kind?: string; answer(result: object): void };
function server() {
  const calls: Call[] = [];
  const waiting = (path: Call["path"], unit: string, kind?: string) =>
    new Promise<object>((answer) => { calls.push({ path, unit, ...(kind ? { kind } : {}), answer }); });
  const looks: LookServer = { choose: (unit, kind) => waiting("look", unit, kind), clear: (unit) => waiting("clear", unit) };
  return { calls, looks };
}
function storage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries));
  return { values, store: { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); } } };
}
// Lets the page's promises run after an answer.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Tree looks in the browser", () => {
  test("a choice shows at once and stays once saved; a refused choice goes back to the saved kind with the reason", async () => {
    const { calls, looks: remote } = server(), { store } = storage();
    const looks = createTreeLooks(remote, () => store);
    await looks.receiveLooks(["u1"], [{ unit: "u1", kind: "oak" }]);
    expect(looks.chosenKind("u1")).toBe("oak");

    const saving = looks.chooseKind("u1", "willow");
    expect(looks.chosenKind("u1")).toBe("willow");
    expect(calls.map(({ path, unit, kind }) => ({ path, unit, kind }))).toEqual([{ path: "look", unit: "u1", kind: "willow" }]);
    calls[0]!.answer({ kind: "willow" });
    expect(await saving).toBeNull();
    expect(looks.chosenKind("u1")).toBe("willow");

    const refused = looks.chooseKind("u1", "pine");
    calls[1]!.answer({ error: "INVALID_REQUEST", detail: "Choose one of the offered tree kinds." });
    expect(await refused).toBe("Choose one of the offered tree kinds.");
    expect(looks.chosenKind("u1")).toBe("willow");

    // A request that does not reach the server goes back too, with the connection sentence.
    const lost = looks.chooseKind("u1", "palm");
    calls[2]!.answer({ error: "NETWORK_ERROR" });
    expect(await lost).toMatch(/did not answer/);
    expect(looks.chosenKind("u1")).toBe("willow");
  });

  test("choosing null clears the saved kind, so the unit grows its default kind", async () => {
    const { calls, looks: remote } = server(), { store } = storage();
    const looks = createTreeLooks(remote, () => store);
    await looks.receiveLooks(["u1"], [{ unit: "u1", kind: "oak" }]);
    const clearing = looks.chooseKind("u1", null);
    expect(looks.chosenKind("u1")).toBeNull();
    expect(calls[0]!.path).toBe("clear");
    calls[0]!.answer({});
    expect(await clearing).toBeNull();
    expect(looks.chosenKind("u1")).toBeNull();
  });

  test("an earlier choice's answer never undoes a later choice, whichever answer arrives first", async () => {
    const { calls, looks: remote } = server(), { store } = storage();
    const looks = createTreeLooks(remote, () => store);
    await looks.receiveLooks(["u1"], []);
    const first = looks.chooseKind("u1", "oak"), second = looks.chooseKind("u1", "pine");
    // The later answer arrives first, then the earlier one.
    calls[1]!.answer({ kind: "pine" });
    expect(await second).toBeNull();
    calls[0]!.answer({ kind: "oak" });
    expect(await first).toBeNull();
    expect(looks.chosenKind("u1")).toBe("pine");

    // A failed choice that a later choice replaced reports nothing, because the learner sees the later choice.
    const third = looks.chooseKind("u1", "birch"), fourth = looks.chooseKind("u1", "maple");
    calls[2]!.answer({ error: "NETWORK_ERROR" });
    expect(await third).toBeNull();
    expect(looks.chosenKind("u1")).toBe("maple");
    calls[3]!.answer({ kind: "maple" });
    expect(await fourth).toBeNull();
    expect(looks.chosenKind("u1")).toBe("maple");
  });

  test("a course read replaces the saved kinds of its units, and a kind the catalogue lacks counts as none", async () => {
    const { looks: remote } = server(), { store } = storage();
    const looks = createTreeLooks(remote, () => store);
    await looks.receiveLooks(["u1", "u2"], [{ unit: "u1", kind: "oak" }, { unit: "u2", kind: "pine" }]);
    // Another device cleared u2 and changed u1, so the next read has only u1's new kind.
    await looks.receiveLooks(["u1", "u2"], [{ unit: "u1", kind: "cherry" }]);
    expect([looks.chosenKind("u1"), looks.chosenKind("u2")]).toEqual(["cherry", null]);
    await looks.receiveLooks(["u1"], [{ unit: "u1", kind: "aspen" }]);
    expect(looks.chosenKind("u1")).toBeNull();
  });

  test("a choice this browser kept before the server kept them is sent once and then forgotten", async () => {
    const { calls, looks: remote } = server();
    const { values, store } = storage({ "stillgotit.tree.u1": "willow", "stillgotit.tree.u2": "palm", "stillgotit.tree.u3": "aspen", "stillgotit.tree.other": "oak" });
    const looks = createTreeLooks(remote, () => store);
    // The server already has a kind for u2, which is the later choice, so the kept key is forgotten without a request.
    // The kept kind for u3 is not offered, so it is forgotten too. Units outside the read are left alone.
    const read = looks.receiveLooks(["u1", "u2", "u3"], [{ unit: "u2", kind: "oak" }]);
    // A second read while the first carry-over is on its way sends nothing more.
    const again = looks.receiveLooks(["u1", "u2", "u3"], [{ unit: "u2", kind: "oak" }]);
    expect(calls.map(({ path, unit, kind }) => ({ path, unit, kind }))).toEqual([{ path: "look", unit: "u1", kind: "willow" }]);
    calls[0]!.answer({ kind: "willow" });
    await Promise.all([read, again]);
    expect(looks.chosenKind("u1")).toBe("willow");
    expect(looks.chosenKind("u2")).toBe("oak");
    expect([...values.keys()]).toEqual(["stillgotit.tree.other"]);
    // The next read finds no kept key and sends nothing.
    await looks.receiveLooks(["u1", "u2", "u3"], [{ unit: "u1", kind: "willow" }, { unit: "u2", kind: "oak" }]);
    expect(calls).toHaveLength(1);
  });

  test("a refused carry-over forgets the key, and one that does not reach the server or finds the session ended keeps it", async () => {
    for (const [error, keeps] of [["INVALID_REQUEST", false], ["FORBIDDEN", false], ["UNAUTHORIZED", true], ["NETWORK_ERROR", true]] as const) {
      const { calls, looks: remote } = server(), { values, store } = storage({ "stillgotit.tree.u1": "willow" });
      const looks = createTreeLooks(remote, () => store);
      const read = looks.receiveLooks(["u1"], []);
      calls[0]!.answer({ error });
      await read;
      expect(values.has("stillgotit.tree.u1"), error).toBe(keeps);
      expect(looks.chosenKind("u1"), error).toBeNull();
    }
  });

  test("a choice the learner makes while a carry-over is on its way stays on screen", async () => {
    const { calls, looks: remote } = server(), { store } = storage({ "stillgotit.tree.u1": "willow" });
    const looks = createTreeLooks(remote, () => store);
    const read = looks.receiveLooks(["u1"], []);
    const choice = looks.chooseKind("u1", "bonsai");
    calls[1]!.answer({ kind: "bonsai" });
    expect(await choice).toBeNull();
    calls[0]!.answer({ kind: "willow" });
    await read;
    await settle();
    expect(looks.chosenKind("u1")).toBe("bonsai");
  });

  test("blocked local storage carries nothing over and breaks nothing", async () => {
    const { calls, looks: remote } = server();
    const looks = createTreeLooks(remote, () => { throw new Error("Storage is blocked."); });
    await looks.receiveLooks(["u1"], [{ unit: "u1", kind: "oak" }]);
    expect(calls).toEqual([]);
    expect(looks.chosenKind("u1")).toBe("oak");
  });
});
