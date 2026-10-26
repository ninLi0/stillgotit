import { afterAll, expect, test } from "bun:test";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// Choosing a topic's tree (design/compositions/Courses.md) through HTTP, the exported runtime gateway, and the raw
// invoker that the gateway wraps.
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const UNKNOWN_KIND = "Choose one of the offered tree kinds.";
// Courses.md, "Course and skill refusals": a unit that is unknown or another learner's.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";

async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider();
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => { throw new Error("These tests request no suggestions."); },
    generate: async () => { throw new Error("These tests make no tutor requests."); },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close(); });

  async function learner(name: string) {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> = {}) {
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json",
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") }, body: JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    const start = await ok("/auth/commons/start");
    await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
    const { user } = await ok("/auth/commons/resume") as { user: User };
    // A second session for the same learner, which stands in for another device.
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in signedIn) throw new Error("Test session was refused");
    return {
      user, post, ok,
      // The exported gateway, which applies admission and the learner's lock.
      native: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { session: signedIn.session, ...input }, { timeoutMs: 5000 }),
      // The assembled invoker that the gateway wraps, which skips admission.
      raw: (path: string, input: Record<string, unknown>) => runtime.application.invoker.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 }),
      looks: async (course: string) => (await ok("/courses/read", { course })).looks as { unit: string; kind: string }[],
      // A course with one unit for each title.
      async course(title: string, unitTitles: string[]) {
        const { course } = await ok("/courses/create", { title });
        const units: string[] = [];
        for (const unitTitle of unitTitles) units.push((await ok("/courses/units/add", { course, title: unitTitle })).unit);
        return { course: course as string, units };
      },
    };
  }
  return { runtime, learner };
}

const byUnit = (rows: { unit: string; kind: string }[]) => [...rows].sort((a, b) => a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0);

test("ChooseUnitLook saves a unit's tree kind, the course read returns it on every session, and ClearUnitLook restores the default", async () => {
  const app = await setup(), ada = await app.learner("look-ada");
  const algebra = await ada.course("Linear algebra", ["Vectors", "Matrices"]), physics = await ada.course("Physics", ["Forces"]);
  const [vectors, matrices] = algebra.units as [string, string], [forces] = physics.units as [string];
  // No unit has a chosen kind yet, so the page draws each unit's default kind.
  expect(await ada.looks(algebra.course)).toEqual([]);

  expect(await ada.ok("/courses/units/look", { unit: vectors, kind: "willow" })).toEqual({ kind: "willow" });
  expect(await ada.looks(algebra.course)).toEqual([{ unit: vectors, kind: "willow" }]);
  // The learner's other session reads the same choice, so it follows them to another device.
  expect(await ada.native("/courses/read", { course: algebra.course })).toMatchObject({ ok: true, value: { looks: [{ unit: vectors, kind: "willow" }] } });

  // Choosing the same kind again succeeds and changes nothing, so a browser whose reply was lost can send it again.
  expect(await ada.ok("/courses/units/look", { unit: vectors, kind: "willow" })).toEqual({ kind: "willow" });
  expect(await ada.looks(algebra.course)).toEqual([{ unit: vectors, kind: "willow" }]);

  expect(await ada.ok("/courses/units/look", { unit: matrices, kind: "pine" })).toEqual({ kind: "pine" });
  expect(await ada.ok("/courses/units/look", { unit: vectors, kind: "oak" })).toEqual({ kind: "oak" });
  expect(await ada.looks(algebra.course)).toEqual(byUnit([{ unit: vectors, kind: "oak" }, { unit: matrices, kind: "pine" }]));
  // Each course read lists only its own units.
  expect(await ada.ok("/courses/units/look", { unit: forces, kind: "palm" })).toEqual({ kind: "palm" });
  expect(await ada.looks(physics.course)).toEqual([{ unit: forces, kind: "palm" }]);
  expect(await ada.looks(algebra.course)).toEqual(byUnit([{ unit: vectors, kind: "oak" }, { unit: matrices, kind: "pine" }]));

  // Clearing restores the default, and clearing again succeeds and changes nothing.
  expect(await ada.ok("/courses/units/look/clear", { unit: vectors })).toEqual({});
  expect(await ada.looks(algebra.course)).toEqual([{ unit: matrices, kind: "pine" }]);
  expect(await ada.ok("/courses/units/look/clear", { unit: vectors })).toEqual({});
  expect(await ada.looks(algebra.course)).toEqual([{ unit: matrices, kind: "pine" }]);

  // The exported gateway and the raw invoker choose and clear as HTTP does.
  expect(await ada.native("/courses/units/look", { unit: vectors, kind: "cypress" })).toEqual({ ok: true, value: { kind: "cypress" } });
  expect(await ada.raw("/courses/units/look", { unit: vectors, kind: "jacaranda" })).toMatchObject({ ok: true, value: { kind: "jacaranda" } });
  expect(await ada.looks(algebra.course)).toEqual(byUnit([{ unit: vectors, kind: "jacaranda" }, { unit: matrices, kind: "pine" }]));
  expect(await ada.native("/courses/units/look/clear", { unit: matrices })).toEqual({ ok: true, value: {} });
  expect(await ada.raw("/courses/units/look/clear", { unit: vectors })).toMatchObject({ ok: true, value: {} });
  expect(await ada.looks(algebra.course)).toEqual([]);
}, 60_000);

test("every offered kind can be chosen, an unknown kind is refused with UNKNOWN_TREE_KIND, and a kind no longer offered is left out of the read", async () => {
  const app = await setup(), ben = await app.learner("look-ben");
  const { course, units: [unit] } = await ben.course("Statics", ["Moments"]);
  for (const kind of ["oak", "pine", "birch", "willow", "maple", "cherry", "palm", "cypress", "baobab", "spruce", "jacaranda", "bonsai"]) {
    expect(await ben.ok("/courses/units/look", { unit, kind }), kind).toEqual({ kind });
  }
  expect(await ben.looks(course)).toEqual([{ unit: unit!, kind: "bonsai" }]);

  // Case matters, and a kind that was never offered, or one an earlier version offered, is refused.
  for (const kind of ["Oak", "OAK", " oak", "aspen", "", "constructor", "toString"]) {
    expect(await ben.post("/courses/units/look", { unit, kind }), kind).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: UNKNOWN_KIND } });
    expect(await ben.native("/courses/units/look", { unit, kind }), kind)
      .toEqual({ ok: false, error: { kind: "domain", value: "UNKNOWN_TREE_KIND", detail: UNKNOWN_KIND } });
    expect(await ben.raw("/courses/units/look", { unit, kind }), kind).toMatchObject({ ok: false, error: { kind: "domain", value: "UNKNOWN_TREE_KIND" } });
  }
  // The boundary refuses other input as invalid before the flow starts, without a refusal sentence: a kind that is not
  // a string of at most 100 characters, a missing unit or kind, and any extra field.
  const inputs = [{ unit, kind: "o".repeat(101) }, { unit, kind: 3 }, { unit, kind: null }, { unit, kind: ["oak"] }, { unit, kind: { kind: "oak" } },
    { unit }, { kind: "oak" }, { unit: "u".repeat(101), kind: "oak" }, { unit, kind: "oak", owner: ben.user }];
  for (const body of inputs) {
    expect(await ben.post("/courses/units/look", body), JSON.stringify(body).slice(0, 80)).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
  }
  // A refusal saves nothing.
  expect(await ben.looks(course)).toEqual([{ unit: unit!, kind: "bonsai" }]);

  // A remembered kind that the code no longer offers, saved here directly, never reaches the browser.
  await app.runtime.application.concepts.TreeStyling.choose({ owner: ben.user, item: unit as never, style: "aspen" as never });
  expect(await ben.looks(course)).toEqual([]);
  expect(await ben.ok("/courses/units/look", { unit, kind: "maple" })).toEqual({ kind: "maple" });
  expect(await ben.looks(course)).toEqual([{ unit: unit!, kind: "maple" }]);
}, 60_000);

test("another learner's unit and an unknown unit get COURSE_UNAVAILABLE on every path, and nothing changes", async () => {
  const app = await setup(), owner = await app.learner("look-owner"), outsider = await app.learner("look-outsider");
  const { course, units: [unit] } = await owner.course("Optics", ["Lenses"]);
  await owner.ok("/courses/units/look", { unit, kind: "willow" });
  await outsider.course("Outsider course", ["Lenses"]);
  const before = await owner.looks(course);
  const { TreeStyling } = app.runtime.application.concepts;

  const requests: [string, Record<string, unknown>][] = [
    ["/courses/units/look", { kind: "oak" }],
    // An unknown kind for a unit that is not the learner's gets the unit's refusal, not the kind's.
    ["/courses/units/look", { kind: "aspen" }],
    ["/courses/units/look/clear", {}],
  ];
  for (const [path, input] of requests) {
    const label = `${path} ${JSON.stringify(input)}`;
    expect(await outsider.post(path, { unit, ...input }), label).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(await outsider.native(path, { unit, ...input }), label).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    expect(await outsider.raw(path, { unit, ...input }), label).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
    // No request field names an owner: a forged owner field never acts as the unit's owner.
    expect((await outsider.post(path, { unit, ...input, owner: owner.user })).status, label).toBeGreaterThanOrEqual(400);
    // An unknown unit gets the same answer as another learner's unit.
    const unknown = crypto.randomUUID();
    expect(await owner.post(path, { unit: unknown, ...input }), label).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(await owner.native(path, { unit: unknown, ...input }), label).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    expect(await owner.raw(path, { unit: unknown, ...input }), label).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
  }
  // The owner's choice is unchanged, and nothing was saved for the outsider or for the unknown units.
  expect(await owner.looks(course)).toEqual(before);
  expect(await TreeStyling._styles({ owner: owner.user })).toEqual([{ item: unit, style: "willow" }]);
  expect(await TreeStyling._styles({ owner: outsider.user })).toEqual([]);
  // The outsider cannot read the owner's course either.
  expect(await outsider.post("/courses/read", { course })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });

  // A request without a session is refused before any read.
  const anonymous = await app.runtime.handle(new Request(`${ORIGIN}/api/courses/units/look`, { method: "POST",
    headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ unit, kind: "oak" }) }));
  expect(anonymous.status).toBe(401);
  expect(await owner.looks(course)).toEqual(before);
}, 60_000);
