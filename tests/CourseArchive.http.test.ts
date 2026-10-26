import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// Archiving and restoring a course (design/compositions/Courses.md) through HTTP and the exported runtime gateway.
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// A fixed instant keeps study dates stable: 11:00 in New York on 2026-11-02.
const NOW = new Date("2026-11-02T16:00:00Z"), DAY = 86_400_000;
const ARCHIVE_UNAVAILABLE = "Choose one of your active courses.", RESTORE_UNAVAILABLE = "Choose one of your archived courses.";
const IN_PROGRESS = "Finish or stop the current activity in this course before archiving it.";
// Courses.md, "Course and skill refusals": a course that is unknown or another learner's.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";

async function setup(clock: () => Date = () => NOW) {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => { throw new Error("These tests request no suggestions."); },
    generate: async () => { throw new Error("These tests make no tutor requests."); },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock });
  cleanups.push(async () => {
    await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });

  async function learner(name: string) {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (path === "/planning/configure" && !(body instanceof FormData)) body = { focusNote: "", ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    const start = await ok("/auth/commons/start");
    await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
    const { user } = await ok("/auth/commons/resume") as { user: User };
    owners.push(user);
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in signedIn) throw new Error("Test session was refused");
    return {
      user, post, ok,
      // The exported gateway, with the learner's lock.
      native: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { session: signedIn.session, ...input }, { timeoutMs: 5000 }),
      courses: async () => (await ok("/courses")).courses as { course: string; title: string; status: string }[],
      // The plan read's `data`, which post() unwraps.
      plan: async (course: string) => await ok("/planning/read", { course }) as { next: { item: string } | null; plan: { plan: string } | null },
      // A course with one unit, one source, confirmed skills with the given titles, and one draft.
      async course(title: string, skillTitles: string[]) {
        const { course } = await ok("/courses/create", { title });
        const form = new FormData(); form.set("course", course); form.set("title", "Notes"); form.set("requestId", crypto.randomUUID());
        form.append("files", new File(["# Notes\nRows meet columns."], "notes.md", { type: "text/markdown" }));
        const { material } = await ok("/courses/materials/add", form);
        const { unit } = await ok("/courses/units/add", { course, title: "Unit" });
        const skills: string[] = [];
        for (const skillTitle of [...skillTitles, "A draft"]) {
          const { skill } = await ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: skillTitle, outcome: `Do ${skillTitle}`, gate: `Show ${skillTitle}` });
          if (skillTitle !== "A draft") await ok("/courses/skills/confirm", { skill });
          skills.push(skill);
        }
        return { course: course as string, unit: unit as string, material: material as string, skills: skills.slice(0, -1), draft: skills.at(-1)! };
      },
    };
  }
  return { runtime, learner };
}

test("ArchiveCourse sets a course aside with everything kept and still readable; RestoreCourse brings it back", async () => {
  const app = await setup(), ada = await app.learner("archive-ada");
  const first = await ada.course("Linear algebra", ["Vectors", "Matrices"]);
  const second = await ada.course("Linear algebra (copy)", ["Vectors"]);
  await ada.ok("/learning/confidence", { skill: first.skills[0], confidence: 60 });
  await ada.ok("/planning/configure", { course: first.course, dailyMinutes: 20 });
  const read = await ada.ok("/courses/read", { course: first.course }), plan = await ada.plan(first.course);
  const progress = await ada.ok("/learning/progress", { course: first.course });
  expect(await ada.courses()).toEqual([first, second].map(({ course }) => ({ course, title: expect.any(String), status: "ACTIVE" }))
    .sort((a, b) => a.course < b.course ? -1 : 1));

  expect(await ada.ok("/courses/archive", { course: first.course })).toEqual({});
  const listed = await ada.courses();
  expect(listed.find((row) => row.course === first.course)).toEqual({ course: first.course, title: "Linear algebra", status: "ARCHIVED" });
  expect(listed.find((row) => row.course === second.course)).toEqual({ course: second.course, title: "Linear algebra (copy)", status: "ACTIVE" });
  // The archived course keeps its units, skills in every status, sources, versions, estimates, and plan, and stays readable.
  expect(await ada.ok("/courses/read", { course: first.course })).toEqual(read);
  expect(read.skills.map((row: { skill: string; status: string }) => [row.skill, row.status]))
    .toEqual([...first.skills.map((skill) => [skill, "CONFIRMED"]), [first.draft, "DRAFT"]].sort((a, b) => a[0]! < b[0]! ? -1 : 1));
  expect(await ada.ok("/learning/progress", { course: first.course })).toEqual(progress);
  expect(await ada.plan(first.course)).toEqual(plan);

  // Archiving again is refused with the concept's code and sentence.
  expect(await ada.post("/courses/archive", { course: first.course })).toEqual({ status: 409, body: { error: "CONFLICT", detail: ARCHIVE_UNAVAILABLE } });
  expect(await ada.native("/courses/archive", { course: first.course }))
    .toEqual({ ok: false, error: { kind: "domain", value: "COURSE_ARCHIVE_UNAVAILABLE", detail: ARCHIVE_UNAVAILABLE } });

  expect(await ada.ok("/courses/restore", { course: first.course })).toEqual({});
  expect((await ada.courses()).find((row) => row.course === first.course)!.status).toBe("ACTIVE");
  expect(await ada.ok("/courses/read", { course: first.course })).toEqual(read);
  // Restoring again is refused the same way, and the native gateway archives and restores as HTTP does.
  expect(await ada.post("/courses/restore", { course: first.course })).toEqual({ status: 409, body: { error: "CONFLICT", detail: RESTORE_UNAVAILABLE } });
  expect(await ada.native("/courses/restore", { course: first.course }))
    .toEqual({ ok: false, error: { kind: "domain", value: "COURSE_RESTORE_UNAVAILABLE", detail: RESTORE_UNAVAILABLE } });
  expect(await ada.native("/courses/archive", { course: second.course })).toEqual({ ok: true, value: {} });
  expect(await ada.native("/courses/restore", { course: second.course })).toEqual({ ok: true, value: {} });
}, 60_000);

test("another learner's course and an unknown course get COURSE_UNAVAILABLE, and nothing changes", async () => {
  const app = await setup(), owner = await app.learner("archive-owner"), outsider = await app.learner("archive-outsider");
  const active = await owner.course("Physics", ["Forces"]), archived = await owner.course("Physics (copy)", ["Forces"]);
  await owner.ok("/courses/archive", { course: archived.course });
  await outsider.course("Outsider course", ["Forces"]);
  const before = { courses: await owner.courses(), reads: await Promise.all([active, archived].map(({ course }) => owner.ok("/courses/read", { course }))) };
  const outsiderCourses = await outsider.courses();

  const requests: [string, string][] = [["/courses/archive", active.course], ["/courses/restore", archived.course], ["/courses/archive", archived.course], ["/courses/restore", active.course]];
  for (const [path, course] of requests) {
    expect(await outsider.post(path, { course }), path).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(await outsider.native(path, { course }), path).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    // No request field names an owner: a forged owner field never acts as the course's owner.
    expect((await outsider.post(path, { course, owner: owner.user })).status, path).toBeGreaterThanOrEqual(400);
    // An unknown course gets the same answer as another learner's course.
    expect(await owner.post(path, { course: crypto.randomUUID() }), path).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(await owner.native(path, { course: crypto.randomUUID() }), path).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
  }
  expect({ courses: await owner.courses(), reads: await Promise.all([active, archived].map(({ course }) => owner.ok("/courses/read", { course }))) }).toEqual(before);
  expect(await outsider.courses()).toEqual(outsiderCourses);
}, 60_000);

test("a course with an activity in progress is refused before archiving, and archives once the activity ends", async () => {
  const app = await setup(), ben = await app.learner("archive-ben");
  const busy = await ben.course("Mechanics", ["Forces"]), other = await ben.course("Optics", ["Lenses"]);
  await ben.ok("/planning/configure", { course: busy.course, dailyMinutes: 30 });
  const { next } = await ben.plan(busy.course);
  await ben.ok("/planning/begin", { course: busy.course, item: next!.item });
  const before = await ben.courses();

  expect(await ben.post("/courses/archive", { course: busy.course })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: IN_PROGRESS } });
  expect(await ben.native("/courses/archive", { course: busy.course }))
    .toEqual({ ok: false, error: { kind: "domain", value: "COURSE_ACTIVITY_IN_PROGRESS", detail: IN_PROGRESS } });
  expect(await ben.courses()).toEqual(before);
  // Only the course with the activity waits; another course can be archived and restored meanwhile.
  expect(await ben.ok("/courses/archive", { course: other.course })).toEqual({});
  expect(await ben.ok("/courses/restore", { course: other.course })).toEqual({});

  await ben.ok("/planning/stop", { course: busy.course, item: next!.item, actualMinutes: 4 });
  expect(await ben.ok("/courses/archive", { course: busy.course })).toEqual({});
  expect((await ben.courses()).find((row) => row.course === busy.course)!.status).toBe("ARCHIVED");
}, 60_000);

test("finishing or stopping an activity refreshes the plans of active courses and skips archived ones", async () => {
  const app = await setup(), cy = await app.learner("archive-cy");
  const working = await cy.course("Physics", ["Forces", "Energy", "Momentum"]), setAside = await cy.course("Algebra", ["Vectors"]);
  await cy.ok("/planning/configure", { course: working.course, dailyMinutes: 60 });
  await cy.ok("/planning/configure", { course: setAside.course, dailyMinutes: 10 });

  // While both courses are active, finishing an activity in one refreshes the other's plan.
  let asidePlan = (await cy.plan(setAside.course)).plan!.plan;
  let next = (await cy.plan(working.course)).next!;
  await cy.ok("/planning/begin", { course: working.course, item: next.item });
  await cy.ok("/planning/finish", { course: working.course, item: next.item, actualMinutes: 5 });
  expect((await cy.plan(setAside.course)).plan!.plan).not.toBe(asidePlan);

  // Once a course is archived, finishing or stopping an activity elsewhere leaves its plan alone.
  await cy.ok("/courses/archive", { course: setAside.course });
  asidePlan = (await cy.plan(setAside.course)).plan!.plan;
  for (const end of ["/planning/finish", "/planning/stop"]) {
    const workingPlan = (await cy.plan(working.course)).plan!.plan;
    next = (await cy.plan(working.course)).next!;
    expect(next, end).not.toBeNull();
    await cy.ok("/planning/begin", { course: working.course, item: next.item });
    await cy.ok(end, { course: working.course, item: next.item, actualMinutes: 5 });
    expect((await cy.plan(working.course)).plan!.plan, end).not.toBe(workingPlan);
    expect((await cy.plan(setAside.course)).plan!.plan, end).toBe(asidePlan);
  }
  const plans = await app.runtime.application.concepts.StudyPlanning._plans({ owner: cy.user, scope: setAside.course });
  expect(plans.filter((row) => row.status === "PROPOSED")).toEqual([]);
}, 90_000);

test("restoring a course with a study budget proposes its reviews again, and a course without one gets no plan", async () => {
  let now = NOW;
  const app = await setup(() => now), dee = await app.learner("archive-dee");
  const planned = await dee.course("Statics", ["Forces", "Moments"]), unplanned = await dee.course("Optics", ["Lenses"]);
  const { StudyPlanning } = app.runtime.application.concepts;
  const madeOn = async (plan: string) => (await StudyPlanning._plan({ plan: plan as never }))[0]!.inputs.today;
  await dee.ok("/learning/confidence", { skill: planned.skills[0], confidence: 40 });
  await dee.ok("/planning/configure", { course: planned.course, dailyMinutes: 30 });
  const old = (await dee.plan(planned.course)).plan!.plan;
  expect(await madeOn(old)).toBe("2026-11-02");
  await dee.ok("/courses/archive", { course: planned.course });
  await dee.ok("/courses/archive", { course: unplanned.course });

  // A day passes while the course is set aside. Nothing refreshes its plan, which still starts on the day it was made.
  now = new Date(NOW.getTime() + DAY);
  expect((await dee.plan(planned.course)).plan!.plan).toBe(old);

  // Restoring it proposes its reviews from the new day, and the routine proposal replaces the old plan.
  expect(await dee.ok("/courses/restore", { course: planned.course })).toEqual({});
  const fresh = (await dee.plan(planned.course)).plan!.plan;
  expect(fresh).not.toBe(old);
  expect(await madeOn(fresh)).toBe("2026-11-03");
  const plans = await StudyPlanning._plans({ owner: dee.user, scope: planned.course });
  const status = (plan: string) => plans.find((row) => row.plan === plan)?.status;
  expect(plans).toHaveLength(2);
  expect([status(old), status(fresh)]).toEqual(["SUPERSEDED", "ACTIVE"]);

  // A course with no study budget has nothing to plan, so restoring it makes no proposal.
  expect(await dee.ok("/courses/restore", { course: unplanned.course })).toEqual({});
  expect(await StudyPlanning._plans({ owner: dee.user, scope: unplanned.course })).toEqual([]);
  expect((await dee.plan(unplanned.course)).plan).toBeNull();
}, 60_000);
