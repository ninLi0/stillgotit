import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { executionLimits } from "../src/assembly.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { User } from "../src/concepts/Registering/Registering.ts";
import { Budgeting } from "../src/concepts/Budgeting/Budgeting.ts";
import * as concept from "../src/concepts/Budgeting/refusals.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// Exam dates and confirmed tradeoffs (design/compositions/Planning.md) through HTTP and the engine gateways.
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// A fixed instant keeps study dates stable: 11:00 in New York on 2026-11-02.
const NOW = new Date("2026-11-02T16:00:00Z"), TODAY = "2026-11-02";
const day = (offset: number) => new Date(Date.parse(TODAY) + offset * 86_400_000).toISOString().slice(0, 10);
const WAITING = "Your plan will update when you finish or stop your current activity.";
const OWN_COURSE = "Choose one of your own courses.";
const BEGIN_ADMISSION = "Choose your own current activity and check its prerequisites. Update the plan if requirements changed.";

interface Candidate { key: string; subject: string; definition: string; latestDay: string; earliestDay: string; priority: number; deadlineRefs: string[] }
interface Item { item: string; candidate: Candidate; day: string; status: string }
interface Cut { deadline: string; candidateKey: string; omittedScope: string; minutes: number; reason: string; consequence: string }
interface PlanRead {
  data: { today: string; next: Item | null; plan: { plan: string; status: string; urgent: boolean; horizonEnd: string; items: Item[] } | null };
  exams: { exam: string; date: string; covered: string[] }[];
  proposal: { plan: string; explanation: string; examUrgent: boolean; estimatedExamMinutes: number; availableExamMinutes: number; focusExam: string; focusExamDate: string;
    locallyCurrent: boolean; contextCurrent: boolean; sessionInProgress: boolean }[];
  proposalItems: { item: string; candidate: Candidate; day: string }[];
  cuts: { cut: Cut }[];
}

async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Unused", skills: [] }),
    generate: async () => { throw new Error("These tests make no tutor requests."); },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock: () => NOW });
  // The assembled endpoints without the host's admission checks, to see each endpoint's own answer.
  const endpoints = createGateway({ application: runtime.application, executionLimits });
  // The planning concept without reactions, to change saved state behind the application's back.
  const planning = new Budgeting(connection.db, "StudyPlanning", () => TODAY);
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
      return { status: response.status, body: await response.json() };
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
      read: async (course: string) => await ok("/planning/read", { course }) as PlanRead,
      // The endpoint's own answer, without admission.
      direct: (path: string, input: Record<string, unknown>) => endpoints.invoke(path, { session: signedIn.session, ...input }, { timeoutMs: 5000 }),
      // The exported gateway, with admission.
      native: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { session: signedIn.session, ...input }, { timeoutMs: 5000 }),
      // A course with one unit, one source, and confirmed skills with the given titles.
      async course(title: string, skillTitles: string[]) {
        const { course } = await ok("/courses/create", { title });
        const form = new FormData(); form.set("course", course); form.set("title", "Notes"); form.set("requestId", crypto.randomUUID());
        form.append("files", new File(["# Notes\nRows meet columns."], "notes.md", { type: "text/markdown" }));
        const { material } = await ok("/courses/materials/add", form);
        const { unit } = await ok("/courses/units/add", { course, title: "Unit" });
        const skills: string[] = [];
        for (const skillTitle of skillTitles) {
          const { skill } = await ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: skillTitle, outcome: `Do ${skillTitle}`, gate: `Show ${skillTitle}` });
          await ok("/courses/skills/confirm", { skill });
          skills.push(skill);
        }
        return { course: course as string, unit: unit as string, material: material as string, skills };
      },
    };
  }
  return { runtime, planning, learner };
}

const refusedBy = (value: string) => ({ ok: false, error: { kind: "domain", value } }) as const;
// Over HTTP a refusal is its category with its sentence as `detail`: the planning concept's message, or the composition's own sentence.
const refused = (detail: string) => ({ status: 400, body: { error: "INVALID_REQUEST", detail } });
const message = (Refusal: new () => Error) => new Refusal().message;
const SKILLS_REFUSAL = "Choose confirmed skills from this course, each once.", PROPOSAL_REFUSAL = "Choose one of your proposed plans.";
const examWorkIn = (items: { candidate: Candidate }[], exam: string) => items.filter(({ candidate }) => candidate.deadlineRefs.includes(exam));

test("setting an exam needs a budget, today or later, and confirmed course skills; the same date replaces its skills; removal proposes again", async () => {
  const app = await setup(), maya = await app.learner("exam-maya");
  const { course, unit, material, skills: [a, b, c] } = await maya.course("Linear algebra", ["Vectors", "Matrices", "Determinants"]);
  const other = await maya.course("Physics", ["Forces"]);
  const { skill: draft } = await maya.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Draft", outcome: "o", gate: "g" });

  // Before a budget exists, the planning concept refuses the exam.
  expect(await maya.post("/planning/exams/set", { course, date: day(10), covered: [a] })).toEqual(refused(message(concept.DeadlinePreferencesUnavailable)));
  expect(await maya.direct("/planning/exams/set", { course, date: day(10), covered: [a] })).toEqual(refusedBy("DEADLINE_PREFERENCES_UNAVAILABLE"));
  await maya.ok("/planning/configure", { course, dailyMinutes: 60 });
  const routine = await maya.read(course);

  // A past date and an empty skill list reach the planning concept's own refusal.
  for (const input of [{ date: day(-1), covered: [a] }, { date: day(10), covered: [] }]) {
    expect(await maya.post("/planning/exams/set", { course, ...input })).toEqual(refused(message(concept.InvalidDeadlineDetails)));
    expect(await maya.direct("/planning/exams/set", { course, ...input })).toEqual(refusedBy("INVALID_DEADLINE_DETAILS"));
  }
  // A repeated skill, a draft, or a skill from another course is refused before the concept is called.
  for (const covered of [[a, a], [a, draft], [other.skills[0]], ["missing"]]) {
    expect(await maya.post("/planning/exams/set", { course, date: day(10), covered })).toEqual(refused(SKILLS_REFUSAL));
    expect(await maya.direct("/planning/exams/set", { course, date: day(10), covered })).toEqual(refusedBy("EXAM_SKILLS_UNAVAILABLE"));
  }
  expect((await maya.read(course)).exams).toEqual([]);
  expect((await maya.read(course)).data.plan!.plan).toBe(routine.data.plan!.plan);

  // Covered skills and their proposal: b and c get exam work that ends the day before the exam; a stays routine.
  const first = await maya.ok("/planning/exams/set", { course, date: day(10), covered: [b] });
  expect(first).toEqual({ exam: expect.any(String), refreshed: true });
  const { exam } = first as { exam: string };
  const replaced = await maya.ok("/planning/exams/set", { course, date: day(10), covered: [b, c] });
  expect(replaced).toEqual({ exam, refreshed: true });
  let read = await maya.read(course);
  expect(read.exams).toEqual([{ exam, date: day(10), covered: [b, c] }]);
  // Everything fits a 60-minute budget, so the proposal needed no confirmation and is active.
  expect(read.proposal).toEqual([]);
  expect(read.data.plan).toMatchObject({ status: "ACTIVE", horizonEnd: day(9) });
  expect(read.data.plan!.plan).not.toBe(routine.data.plan!.plan);
  const examWork = examWorkIn(read.data.plan!.items, exam);
  expect(examWork.map(({ candidate }) => candidate.subject).sort()).toEqual([b, c].sort());
  for (const { candidate } of examWork) {
    expect(candidate).toMatchObject({ latestDay: day(9), deadlineRefs: [exam], priority: 1100 });
    expect(candidate.key).toEndWith(`:exam:${exam}`);
  }
  expect(read.data.plan!.items.find(({ candidate }) => candidate.subject === a)!.candidate.deadlineRefs).toEqual([]);

  // Removing the exam deactivates it and proposes again without exam work. Removing it again succeeds.
  expect(await maya.ok("/planning/exams/remove", { course, date: day(10) })).toEqual({ exam, refreshed: true });
  read = await maya.read(course);
  expect(read.exams).toEqual([]);
  expect(read.data.plan!.horizonEnd).toBe(day(6));
  expect(read.data.plan!.items.every(({ candidate }) => candidate.deadlineRefs.length === 0)).toBe(true);
  expect(await maya.ok("/planning/exams/remove", { course, date: day(10) })).toEqual({ exam, refreshed: true });
  expect(await maya.post("/planning/exams/remove", { course, date: day(11) })).toEqual(refused(message(concept.DeadlineRemoveUnavailable)));
  expect(await maya.direct("/planning/exams/remove", { course, date: day(11) })).toEqual(refusedBy("DEADLINE_REMOVE_UNAVAILABLE"));
  // Setting the date again restores the same exam.
  expect(await maya.ok("/planning/exams/set", { course, date: day(10), covered: [c] })).toEqual({ exam, refreshed: true });
  expect((await maya.read(course)).exams).toEqual([{ exam, date: day(10), covered: [c] }]);
}, 60_000);

test("new exam cuts wait for confirmation in order; approved cuts later refresh routinely; confirm and decline work once", async () => {
  const app = await setup(), lee = await app.learner("exam-lee");
  const { course, skills } = await lee.course("Linear algebra", ["Vectors", "Matrices", "Determinants", "Eigenvalues", "Projections"]);
  const elsewhere = await lee.course("Physics", []);
  await lee.ok("/planning/configure", { course: elsewhere.course, dailyMinutes: 30 });
  const otherCoursePlan = (await lee.read(elsewhere.course)).data.plan!.plan;
  await lee.ok("/planning/configure", { course, dailyMinutes: 20 });
  const routine = (await lee.read(course)).data.plan!.plan;

  // Forty minutes of preparation and twenty available before tomorrow's exam: two activities are cut.
  const { exam } = await lee.ok("/planning/exams/set", { course, date: day(1), covered: skills.slice(0, 4) }) as { exam: string };
  let read = await lee.read(course);
  expect(read.data.plan!.plan).toBe(routine);
  expect(read.exams).toEqual([{ exam, date: day(1), covered: skills.slice(0, 4) }]);
  expect(read.proposal).toEqual([{ plan: expect.any(String), explanation: expect.stringContaining(`Preparation for the exam on ${day(1)} comes first.`), examUrgent: true,
    estimatedExamMinutes: 40, availableExamMinutes: 20, focusExam: exam, focusExamDate: day(1), locallyCurrent: true, contextCurrent: true, sessionInProgress: false }]);
  let pending = read.proposal[0]!.plan;
  // Activities and cuts keep the planning concept's order.
  const items = await app.runtime.application.concepts.StudyPlanning._items({ plan: pending });
  const cuts = await app.runtime.application.concepts.StudyPlanning._cuts({ plan: pending });
  expect(read.proposalItems).toEqual(items.map(({ item, candidate, day: when }) => ({ item, candidate, day: when })));
  // Today holds the two exam activities that fit; the unrelated review moves to a later day.
  expect(read.proposalItems.map(({ day: when, candidate }) => [when, candidate.deadlineRefs])).toEqual([[TODAY, [exam]], [TODAY, [exam]], [day(1), []]]);
  expect(read.proposalItems.slice(0, 2).every(({ candidate }) => candidate.latestDay === TODAY)).toBe(true);
  expect(read.cuts).toEqual(cuts);
  expect(read.cuts).toHaveLength(2);
  expect(read.cuts.every(({ cut }) => cut.deadline === exam && cut.minutes === 10 && cut.consequence === `No scheduled preparation for: ${cut.omittedScope}`)).toBe(true);

  // A routine refresh makes a new proposal with the same unapproved cuts, so it waits too.
  await lee.ok("/planning/propose", { course });
  read = await lee.read(course);
  expect(read.data.plan!.plan).toBe(routine);
  expect(read.proposal[0]!.plan).not.toBe(pending);
  pending = read.proposal[0]!.plan;

  // Only a plan of this learner and course can be confirmed here.
  for (const plan of ["missing", otherCoursePlan]) {
    expect(await lee.post("/planning/tradeoffs/confirm", { course, plan })).toEqual(refused(PROPOSAL_REFUSAL));
    expect(await lee.direct("/planning/tradeoffs/confirm", { course, plan })).toEqual(refusedBy("PROPOSAL_UNAVAILABLE"));
    expect(await lee.direct("/planning/tradeoffs/decline", { course, plan })).toEqual(refusedBy("PROPOSAL_UNAVAILABLE"));
  }
  expect(await lee.ok("/planning/tradeoffs/confirm", { course, plan: pending })).toEqual({ plan: pending });
  read = await lee.read(course);
  expect(read.data.plan).toMatchObject({ plan: pending, status: "ACTIVE", urgent: true });
  expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
  expect(await lee.post("/planning/tradeoffs/confirm", { course, plan: pending })).toEqual(refused(message(concept.TradeoffPlanUnavailable)));
  expect(await lee.direct("/planning/tradeoffs/confirm", { course, plan: pending })).toEqual(refusedBy("TRADEOFF_PLAN_UNAVAILABLE"));

  // The approved cuts no longer need confirmation: a routine refresh activates by itself.
  await lee.ok("/planning/propose", { course });
  read = await lee.read(course);
  expect(read.proposal).toEqual([]);
  expect(read.data.plan!.plan).not.toBe(pending);
  const refreshed = read.data.plan!.plan;

  // Covering one more skill adds a new cut, which waits. Declining keeps the active plan.
  await lee.ok("/planning/exams/set", { course, date: day(1), covered: skills });
  read = await lee.read(course);
  expect(read.data.plan!.plan).toBe(refreshed);
  expect(read.cuts).toHaveLength(3);
  const declined = read.proposal[0]!.plan;
  expect(await lee.ok("/planning/tradeoffs/decline", { course, plan: declined })).toEqual({ plan: declined });
  read = await lee.read(course);
  expect(read.data.plan!.plan).toBe(refreshed);
  expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
  expect((await app.runtime.application.concepts.StudyPlanning._plan({ plan: declined }))[0]!.status).toBe("DECLINED");
  expect(await lee.post("/planning/tradeoffs/decline", { course, plan: declined })).toEqual(refused(message(concept.PlanDeclineUnavailable)));
  expect(await lee.direct("/planning/tradeoffs/decline", { course, plan: declined })).toEqual(refusedBy("PLAN_DECLINE_UNAVAILABLE"));
}, 60_000);

test("confirming waits for the current activity and current inputs; declining is allowed during an activity", async () => {
  const app = await setup(), ana = await app.learner("exam-ana");
  const { course, skills } = await ana.course("Linear algebra", ["Vectors", "Matrices", "Determinants"]);
  await ana.ok("/planning/configure", { course, dailyMinutes: 20 });
  const routine = await ana.read(course);
  await ana.ok("/planning/exams/set", { course, date: day(1), covered: skills });
  const pending = (await ana.read(course)).proposal[0]!.plan;

  await ana.ok("/planning/begin", { course, item: routine.data.next!.item });
  let read = await ana.read(course);
  expect(read.proposal[0]).toMatchObject({ plan: pending, sessionInProgress: true, locallyCurrent: true, contextCurrent: true });
  expect(await ana.post("/planning/tradeoffs/confirm", { course, plan: pending })).toEqual(refused(message(concept.TradeoffSessionInProgress)));
  expect(await ana.direct("/planning/tradeoffs/confirm", { course, plan: pending })).toEqual(refusedBy("TRADEOFF_SESSION_IN_PROGRESS"));
  expect(await ana.ok("/planning/tradeoffs/decline", { course, plan: pending })).toEqual({ plan: pending });
  read = await ana.read(course);
  expect(read.proposal).toEqual([]);
  expect(read.data.plan!.plan).toBe(routine.data.plan!.plan);
  expect(read.data.next).toMatchObject({ item: routine.data.next!.item, status: "IN_PROGRESS" });

  // Stopping refreshes the plan. Declining approved nothing, so the same cuts wait again.
  await ana.ok("/planning/stop", { course, item: routine.data.next!.item, actualMinutes: 5 });
  read = await ana.read(course);
  expect(read.proposal).toHaveLength(1);
  const waiting = read.proposal[0]!.plan;
  // An exam saved without a refresh changes the local inputs, so the waiting proposal is out of date.
  await app.planning.setDeadline({ owner: ana.user, scope: course, date: day(5), covered: [skills[0]!] });
  expect((await ana.read(course)).proposal[0]).toMatchObject({ plan: waiting, locallyCurrent: false, sessionInProgress: false });
  expect(await ana.post("/planning/tradeoffs/confirm", { course, plan: waiting })).toEqual(refused(message(concept.TradeoffPlanOutdated)));
  expect(await ana.direct("/planning/tradeoffs/confirm", { course, plan: waiting })).toEqual(refusedBy("TRADEOFF_PLAN_OUTDATED"));
}, 60_000);

test("another learner's course is refused at admission with the sentence and by each planning endpoint with COURSE_UNAVAILABLE", async () => {
  const app = await setup(), owner = await app.learner("exam-owner"), outsider = await app.learner("exam-outsider");
  const { course, skills } = await owner.course("Linear algebra", ["Vectors", "Matrices"]);
  await owner.ok("/planning/configure", { course, dailyMinutes: 10 });
  const { exam } = await owner.ok("/planning/exams/set", { course, date: day(1), covered: skills }) as { exam: string };
  const before = await owner.read(course), pending = before.proposal[0]!.plan, item = before.data.next!.item;

  const requests: [string, Record<string, unknown>][] = [
    ["/planning/exams/set", { date: day(2), covered: [skills[0]] }],
    ["/planning/exams/remove", { date: day(1) }],
    ["/planning/tradeoffs/confirm", { plan: pending }],
    ["/planning/tradeoffs/decline", { plan: pending }],
  ];
  for (const target of [course, "missing-course"]) {
    for (const [path, input] of requests) {
      expect(await outsider.post(path, { course: target, ...input }), path).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: OWN_COURSE } });
      expect(await outsider.native(path, { course: target, ...input }), path).toEqual({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail: OWN_COURSE } });
    }
    // Every planning endpoint answers COURSE_UNAVAILABLE first, before any plan or item check.
    const endpoints: [string, Record<string, unknown>][] = [...requests, ["/planning/read", {}], ["/planning/configure", { dailyMinutes: 30, focusNote: "" }],
      ["/planning/propose", {}], ["/planning/begin", { item }], ["/planning/finish", { item, actualMinutes: 5 }], ["/planning/stop", { item, actualMinutes: 5 }],
      ["/planning/miss", { item }], ["/planning/tradeoffs/confirm", { plan: "missing" }]];
    for (const [path, input] of endpoints) expect(await outsider.direct(path, { course: target, ...input }), path).toEqual(refusedBy("COURSE_UNAVAILABLE"));
    expect(await outsider.post("/planning/read", { course: target })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: OWN_COURSE } });
  }
  // Nothing of the owner's changed, and the owner's own requests still work.
  const after = await owner.read(course);
  expect(after).toEqual(before);
  expect(after.exams).toEqual([{ exam, date: day(1), covered: skills }]);
}, 60_000);

test("in an owned course, each endpoint refuses an unknown or another learner's item, and a refresh it cannot make, with the concept's code", async () => {
  const app = await setup(), owner = await app.learner("item-owner"), outsider = await app.learner("item-outsider");
  const { course } = await owner.course("Linear algebra", ["Vectors"]);
  await owner.ok("/planning/configure", { course, dailyMinutes: 30 });
  const before = await owner.read(course), foreignItem = before.data.next!.item;
  const own = await outsider.course("Physics", ["Forces"]);

  // Without a budget, a refresh of the outsider's own course is refused with the planning concept's code.
  expect(await outsider.direct("/planning/propose", { course: own.course })).toEqual(refusedBy("PLAN_PREFERENCES_UNAVAILABLE"));
  await outsider.ok("/planning/configure", { course: own.course, dailyMinutes: 30 });
  const ownPlan = await outsider.read(own.course);
  const ITEM_ADMISSION = "Choose an activity from your own course.";
  for (const item of [foreignItem, "missing-item"]) {
    expect(await outsider.direct("/planning/begin", { course: own.course, item })).toEqual(refusedBy("ACTIVITY_BEGIN_UNAVAILABLE"));
    expect(await outsider.direct("/planning/finish", { course: own.course, item, actualMinutes: 5 })).toEqual(refusedBy("ACTIVITY_FINISH_UNAVAILABLE"));
    expect(await outsider.direct("/planning/stop", { course: own.course, item, actualMinutes: 5 })).toEqual(refusedBy("ACTIVITY_STOP_UNAVAILABLE"));
    expect(await outsider.direct("/planning/miss", { course: own.course, item })).toEqual(refusedBy("ACTIVITY_MISS_UNAVAILABLE"));
    // Over HTTP, admission declines the same requests first.
    expect(await outsider.post("/planning/begin", { course: own.course, item })).toEqual(refused(BEGIN_ADMISSION));
    for (const path of ["/planning/finish", "/planning/stop"]) expect(await outsider.post(path, { course: own.course, item, actualMinutes: 5 }), path).toEqual(refused(ITEM_ADMISSION));
    expect(await outsider.post("/planning/miss", { course: own.course, item })).toEqual(refused(ITEM_ADMISSION));
  }
  // During an activity in the same course, a refresh is refused with the concept's code instead of going unanswered.
  await outsider.ok("/planning/begin", { course: own.course, item: ownPlan.data.next!.item });
  expect(await outsider.direct("/planning/propose", { course: own.course })).toEqual(refusedBy("PLAN_SESSION_IN_PROGRESS"));
  expect((await outsider.read(own.course)).data.plan!.plan).toBe(ownPlan.data.plan!.plan);
  expect(await owner.read(course)).toEqual(before);
}, 60_000);

test("an activity elsewhere keeps the plan until it ends; finishing or stopping refreshes every course with a budget", async () => {
  const app = await setup(), kai = await app.learner("exam-kai");
  const physics = await kai.course("Physics", ["Forces"]);
  const algebra = await kai.course("Linear algebra", ["Vectors", "Matrices"]);
  await kai.ok("/planning/configure", { course: physics.course, dailyMinutes: 30 });
  await kai.ok("/planning/configure", { course: algebra.course, dailyMinutes: 10 });
  const physicsPlan = await kai.read(physics.course), algebraPlan = await kai.read(algebra.course);

  // An activity in another course: the exam is saved, the plan is unchanged, and the answer says so.
  await kai.ok("/planning/begin", { course: physics.course, item: physicsPlan.data.next!.item });
  const saved = await kai.ok("/planning/exams/set", { course: algebra.course, date: day(1), covered: algebra.skills });
  expect(saved).toEqual({ exam: expect.any(String), refreshed: false, notice: WAITING });
  const { exam } = saved as { exam: string };
  let read = await kai.read(algebra.course);
  expect(read.exams).toEqual([{ exam, date: day(1), covered: algebra.skills }]);
  expect(read.proposal).toEqual([]);
  expect(read.data.plan!.plan).toBe(algebraPlan.data.plan!.plan);

  // Finishing the physics activity refreshes both courses. Algebra's exam cut now waits for confirmation.
  await kai.ok("/planning/finish", { course: physics.course, item: physicsPlan.data.next!.item, actualMinutes: 12 });
  expect((await kai.read(physics.course)).data.plan!.plan).not.toBe(physicsPlan.data.plan!.plan);
  read = await kai.read(algebra.course);
  expect(read.proposal[0]).toMatchObject({ focusExam: exam, focusExamDate: day(1), examUrgent: true });
  expect(read.cuts).toHaveLength(1);

  // An activity in the same course: removing the exam waits too, and stopping the activity applies it.
  await kai.ok("/planning/begin", { course: algebra.course, item: read.data.next!.item });
  expect(await kai.ok("/planning/exams/remove", { course: algebra.course, date: day(1) })).toEqual({ exam, refreshed: false, notice: WAITING });
  expect((await kai.read(algebra.course)).proposal).toHaveLength(1);
  await kai.ok("/planning/stop", { course: algebra.course, item: read.data.next!.item, actualMinutes: 3 });
  read = await kai.read(algebra.course);
  expect([read.exams, read.proposal, read.cuts]).toEqual([[], [], []]);
  expect(read.data.plan!.items.every(({ candidate }) => candidate.deadlineRefs.length === 0)).toBe(true);
}, 60_000);

test("an activity in one course does not refuse a budget, a missed activity, or an adjustment in another; finishing refreshes both", async () => {
  const app = await setup(), noa = await app.learner("replan-noa");
  const physics = await noa.course("Physics", ["Forces"]);
  const algebra = await noa.course("Linear algebra", ["Vectors", "Matrices"]);
  await noa.ok("/learning/confidence", { skill: algebra.skills[0], confidence: 60 });
  await noa.ok("/planning/configure", { course: physics.course, dailyMinutes: 30 });
  await noa.ok("/planning/configure", { course: algebra.course, dailyMinutes: 10 });
  const physicsPlan = await noa.read(physics.course), algebraPlan = await noa.read(algebra.course);
  await noa.ok("/planning/begin", { course: physics.course, item: physicsPlan.data.next!.item });

  // A new budget in the other course is saved and answered; its plan waits for the activity to end.
  expect(await noa.post("/planning/configure", { course: algebra.course, dailyMinutes: 40 })).toMatchObject({ status: 200 });
  let read = await noa.read(algebra.course);
  expect(read.data).toMatchObject({ preferences: { dailyMinutes: 40 } });
  expect(read.data.plan!.plan).toBe(algebraPlan.data.plan!.plan);
  // Marking an activity of the other course missed is answered and saved, and the plan waits too.
  const missed = algebraPlan.data.next!.item;
  expect(await noa.post("/planning/miss", { course: algebra.course, item: missed })).toEqual({ status: 200, body: { item: missed } });
  // An estimate adjustment in the other course is answered as well.
  expect(await noa.post("/learning/adjust", { skill: algebra.skills[0], adjustmentKey: crypto.randomUUID(), value: 30, reason: "I forgot most of it." }))
    .toEqual({ status: 200, body: { adjustment: expect.any(String) } });
  read = await noa.read(algebra.course);
  expect(read.data.plan!.plan).toBe(algebraPlan.data.plan!.plan);
  expect(read.data.plan!.items.find(({ item }) => item === missed)!.status).toBe("MISSED");
  expect((await noa.read(physics.course)).data.next).toMatchObject({ item: physicsPlan.data.next!.item, status: "IN_PROGRESS" });

  // Finishing the physics activity refreshes both courses.
  await noa.ok("/planning/finish", { course: physics.course, item: physicsPlan.data.next!.item, actualMinutes: 12 });
  expect((await noa.read(physics.course)).data.plan!.plan).not.toBe(physicsPlan.data.plan!.plan);
  read = await noa.read(algebra.course);
  expect(read.data.plan!.plan).not.toBe(algebraPlan.data.plan!.plan);
  expect(read.data).toMatchObject({ preferences: { dailyMinutes: 40 }, plan: { status: "ACTIVE" } });
}, 60_000);

test("urgent mode skips the prerequisite check only for exam work of an urgent active plan whose exam is still active", async () => {
  const app = await setup(), rio = await app.learner("exam-rio");
  const { course, skills: [base, next] } = await rio.course("Linear algebra", ["Vectors", "Matrices"]);
  await app.runtime.application.concepts.SkillMapping.setPrerequisites({ owner: rio.user, skill: next!, prerequisites: [base!] });
  // A provisional estimate is not ready, so `next` fails the usual prerequisite check. It also ranks `base` below `next`.
  await rio.ok("/learning/confidence", { skill: base, confidence: 50 });
  await rio.ok("/planning/configure", { course, dailyMinutes: 10 });

  // The exam covers `next`; its prerequisite becomes exam work too. Only `next` fits today, so `base` is cut.
  const { exam } = await rio.ok("/planning/exams/set", { course, date: day(1), covered: [next] }) as { exam: string };
  let read = await rio.read(course);
  expect(read.cuts.map(({ cut }) => cut.omittedScope)).toEqual(["Fresh check: Vectors"]);
  await rio.ok("/planning/tradeoffs/confirm", { course, plan: read.proposal[0]!.plan });
  read = await rio.read(course);
  expect(read.data.plan!.urgent).toBe(true);
  expect(read.data.next!.candidate).toMatchObject({ subject: next, deadlineRefs: [exam] });
  expect(await rio.ok("/planning/begin", { course, item: read.data.next!.item })).toEqual({ item: read.data.next!.item });

  // Stopping refreshes the plan; the same approved cut lets the new urgent plan activate routinely.
  await rio.ok("/planning/stop", { course, item: read.data.next!.item, actualMinutes: 0 });
  read = await rio.read(course);
  expect(read.data.plan!.urgent).toBe(true);
  const urgentItem = read.data.next!;
  expect(urgentItem.candidate.deadlineRefs).toEqual([exam]);

  // The exam is removed while the urgent plan is still active: urgency no longer applies.
  await app.planning.removeDeadline({ owner: rio.user, scope: course, date: day(1) });
  expect((await rio.read(course)).data.plan!.urgent).toBe(true);
  expect(await rio.post("/planning/begin", { course, item: urgentItem.item })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: BEGIN_ADMISSION } });

  // A routine plan keeps the prerequisite check for the same skill.
  await rio.ok("/planning/propose", { course });
  read = await rio.read(course);
  expect(read.data.plan!.urgent).toBe(false);
  const routineItem = read.data.plan!.items.find(({ candidate, day: when }) => candidate.subject === next && when === TODAY)!;
  expect(routineItem.candidate.deadlineRefs).toEqual([]);
  expect(await rio.post("/planning/begin", { course, item: routineItem.item })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: BEGIN_ADMISSION } });
  expect((await rio.read(course)).data.next!.status).toBe("TODO");
}, 60_000);
