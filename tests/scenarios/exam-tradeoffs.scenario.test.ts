import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import { executionLimits } from "../../src/assembly.ts";
import { MemoryProvider } from "../../src/concepts/Federating/provider.ts";
import { MasteryEstimating } from "../../src/concepts/MasteryEstimating/MasteryEstimating.ts";
import type { User } from "../../src/concepts/Registering/Registering.ts";
import { StudyPlanning } from "../../src/concepts/StudyPlanning/StudyPlanning.ts";
import * as concept from "../../src/concepts/StudyPlanning/refusals.ts";
import type { CourseTutor } from "../../src/host/tutor.ts";
import { createRuntime } from "../../src/host/runtime.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";
import { examProblem, examRefusal, PlanningFailure, settle, tradeoffRefusal, type CourseRead, type CourseSkill, type ExamInput, type PlanRead } from "../../frontend/src/planning.ts";

// The brief's journey for exam dates and confirmed tradeoffs (design/compositions/Planning.md), walked through HTTP.
// One learner sets, changes, and removes an exam and decides on the proposals it causes; a second learner tries each new
// endpoint. Each test's name is the sentence of the brief or of Planning.md that it proves. The tests run in order and
// share the journey's state, so a failure early on also fails the steps after it.
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

// A fixed instant keeps study dates stable: 11:00 in New York on 2026-11-02.
const NOW = new Date("2026-11-02T16:00:00Z"), TODAY = "2026-11-02";
const day = (offset: number) => new Date(Date.parse(TODAY) + offset * 86_400_000).toISOString().slice(0, 10);
// The exam is three days ahead, so today and the next two days are study days before it.
const EXAM_DAY = day(3);
const PREPARATION_FIRST = `Preparation for the exam on ${EXAM_DAY} comes first.`;
const WAITING = "Your plan will update when you finish or stop your current activity.";
const OWN_COURSE = "Choose one of your own courses.";
// The composition's own refusals for covered skills (Planning.md, SetExam) and for a plan of another course or learner.
const SKILLS_REFUSAL = "Choose confirmed skills from this course, each once.";
const PROPOSAL_REFUSAL = "Choose one of your proposed plans.";
// What the screen shows for a bare refusal it cannot explain (frontend/src/api.ts). No refusal may end up showing this.
const GENERIC = "Check the field and try again.";
const CUT_REASON = "This activity does not fit before the exam within its dates and the available budget.";
// Over HTTP a refusal is its category with its sentence as `detail`: the planning concept's message or the composition's own.
const refused = (detail: string) => ({ status: 400, body: { error: "INVALID_REQUEST", detail } });
const signedOut = { status: 401, body: { error: "UNAUTHORIZED" } };
const refusedBy = (value: string) => ({ ok: false, error: { kind: "domain", value } }) as const;

async function start() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Unused", skills: [] }),
    generate: async () => { throw new Error("This scenario makes no tutor requests."); },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock: () => NOW });
  // The assembled endpoints without the host's admission checks, to see which refusal an endpoint gave.
  const endpoints = createGateway({ application: runtime.application, executionLimits });
  // Concepts without reactions: the planning concept to read saved records, and mastery to change the planning context
  // without the plan refresh that every HTTP change of it causes.
  const planning = new StudyPlanning(connection.db, "StudyPlanning", () => TODAY);
  const mastery = new MasteryEstimating(connection.db, "MasteryEstimating", () => NOW);
  cleanups.push(async () => {
    await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });

  function request(path: string, body: Record<string, unknown> | FormData, cookie: string) {
    return runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie,
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
  }
  // A request from a browser that is not signed in.
  async function anonymous(path: string, body: Record<string, unknown>) {
    const response = await request(path, body, "");
    return { status: response.status, body: await response.json() };
  }

  async function learner(name: string) {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (path === "/planning/configure" && !(body instanceof FormData)) body = { focusNote: "", ...body };
      const response = await request(path, body, [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      return { status: response.status, body: await response.json() };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body);
      expect(result, path).toMatchObject({ status: 200 });
      return result.body;
    }
    const begun = await ok("/auth/commons/start");
    await ok("/auth/commons/finish", provider.approve(begun.address, { subject: name, username: name }));
    const { user } = await ok("/auth/commons/resume") as { user: User };
    owners.push(user);
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in signedIn) throw new Error("Test session was refused");
    return {
      user, post, ok,
      read: async (course: string) => await ok("/planning/read", { course }) as PlanRead,
      skills: async (course: string) => (await ok("/courses/read", { course }) as CourseRead).skills,
      // The endpoint's own answer, without admission. Over HTTP most of these refusals arrive without their code.
      direct: (path: string, input: Record<string, unknown>) => endpoints.invoke(path, { session: signedIn.session, ...input }, { timeoutMs: 5000 }),
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
  return { runtime, planning, mastery, learner, anonymous };
}

type App = Awaited<ReturnType<typeof start>>;
type Learner = Awaited<ReturnType<App["learner"]>>;

// The journey's learner, course, and skills. Vectors, Matrices, Determinants, Eigenvalues, and Projections are confirmed;
// Least squares is still a draft. The daily budget is ten minutes, and every activity takes ten minutes.
let app: App, owner: Learner, course: string, skills: CourseSkill[], draft: string;
let vectors: string, matrices: string, determinants: string, eigenvalues: string, projections: string;
let routinePlan: string;
let opened: Promise<void> | undefined;
function journey() {
  return opened ??= (async () => {
    app = await start();
    owner = await app.learner("journey-owner");
    const made = await owner.course("Linear algebra", ["Vectors", "Matrices", "Determinants", "Eigenvalues", "Projections"]);
    course = made.course;
    [vectors, matrices, determinants, eigenvalues, projections] = made.skills as [string, string, string, string, string];
    ({ skill: draft } = await owner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit: made.unit, material: made.material,
      title: "Least squares", outcome: "Fit a line to data", gate: "Show a fitted line" }) as { skill: string });
    await owner.ok("/planning/configure", { course, dailyMinutes: 10 });
    skills = await owner.skills(course);
    routinePlan = (await owner.read(course)).data.plan!.plan;
  })();
}

// What the planner shows for an answer, as StudyPlanner.vue's `change` does: the answer's own sentence, or, for a refusal
// that arrives without one, the sentence the page works out from a fresh read of the plan.
async function shown(answer: unknown, explain: () => Promise<string>): Promise<string> {
  try { settle(answer as object); return ""; } catch (problem) {
    if (!(problem instanceof PlanningFailure)) throw problem;
    return problem.bare ? await explain() : problem.message;
  }
}
// Every refusal the journey meets, with the HTTP answer and the sentence the learner would see. The last test checks them.
const heard: { refusal: string; answer: { status: number; body: Record<string, unknown> }; shown: string; expected: string }[] = [];
async function hear(refusal: string, answer: { status: number; body: Record<string, unknown> }, expected: string, explain: () => Promise<string>) {
  heard.push({ refusal, answer, shown: await shown(answer.body, explain), expected });
}
const examExplanation = (learner: Learner, at: string, input: ExamInput) => async () => examRefusal(input, await learner.read(at), skills);
const tradeoffExplanation = (learner: Learner, at: string, plan: string, confirming: boolean) => async () => tradeoffRefusal(plan, (await learner.read(at)).proposal[0], confirming);

// Saved planning records, including removed exams and every plan's status, to show that a refusal saved nothing.
const saved = async (learner: string, scope: string) => ({ exams: await app.planning._exams({ learner, scope }), plans: await app.planning._plans({ learner, scope }) });
const statusOf = async (plan: string) => (await app.planning._plan({ plan }))[0]?.status;
// A cut names omitted work by its activity text, which ends with the skill's title.
const subjectOf = (activity: string) => skills.find((row) => row.status === "CONFIRMED" && activity.endsWith(row.title))!.skill;
const sorted = (values: string[]) => [...values].sort();

// State the steps hand on.
let exam: string, firstExamPlan: string, firstProposal: string, activity: string, stale: string, confirmed: string, approvedCutKeys: string[];
let laterProposal: string, laterCuts: PlanRead["cuts"], retriedProposal: string;

describe("Exam dates and confirmed tradeoffs: one learner's journey through HTTP", () => {
  test("After setting or removing an exam, a new proposal is created. If it needs no new cuts it activates routinely.", async () => {
    await journey();
    // Twenty minutes of preparation for two skills fit the thirty minutes before the exam.
    const answer = await owner.ok("/planning/exams/set", { course, date: EXAM_DAY, covered: [vectors, matrices] });
    expect(answer).toEqual({ exam: expect.any(String), refreshed: true });
    exam = (answer as { exam: string }).exam;
    const read = await owner.read(course);
    expect(read.exams).toEqual([{ exam, date: EXAM_DAY, covered: [vectors, matrices] }]);
    // Nothing waits for the learner: the new proposal needed no cuts, so it is already the active plan.
    expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
    expect(read.data.plan).toMatchObject({ status: "ACTIVE", focusExam: exam, examUrgent: false, estimatedExamMinutes: 20, availableExamMinutes: 30, examCuts: [], needsConfirmation: false });
    firstExamPlan = read.data.plan!.plan;
    expect(firstExamPlan).not.toBe(routinePlan);
    const plans = (await saved(owner.user, course)).plans;
    expect(plans.find(({ plan }) => plan === routinePlan)!.status).toBe("SUPERSEDED");
    expect(plans.filter(({ status }) => status === "ACTIVE").map(({ plan }) => plan)).toEqual([firstExamPlan]);
    expect(plans.some(({ status }) => status === "PROPOSED")).toBe(false);
  }, 60_000);

  test("Candidate generation marks preparation for the nearest active exam with examRefs, with latestDay before the exam", async () => {
    await journey();
    const read = await owner.read(course), plan = read.data.plan!;
    const preparation = plan.items.filter(({ candidate }) => candidate.examRefs.length > 0);
    const routine = plan.items.filter(({ candidate }) => candidate.examRefs.length === 0);
    expect(sorted(preparation.map(({ candidate }) => candidate.subject))).toEqual(sorted([vectors, matrices]));
    for (const { candidate } of preparation) {
      expect(candidate).toMatchObject({ examRefs: [exam], latestDay: day(2), reason: `Preparation for the exam on ${EXAM_DAY}. This skill needs fresh independent evidence.` });
      expect(candidate.key).toEndWith(`:exam:${exam}`);
    }
    // Exam work comes first: it takes today and tomorrow, ahead of every routine review, and the skills the exam does not
    // cover keep routine reviews with no exam reference.
    expect(plan.items.map(({ day: when, candidate }) => [when, candidate.examRefs.length > 0])).toEqual([[TODAY, true], [day(1), true], [day(2), false], [day(3), false], [day(4), false]]);
    expect(sorted(routine.map(({ candidate }) => candidate.subject))).toEqual(sorted([determinants, eigenvalues, projections]));
    expect(Math.min(...preparation.map(({ candidate }) => candidate.priority))).toBeGreaterThan(Math.max(...routine.map(({ candidate }) => candidate.priority)));
    // The learner reads the reason with today's activity and the plan's explanation.
    expect(read.data.next).toMatchObject({ day: TODAY, status: "TODO", candidate: { examRefs: [exam], reason: preparation[0]!.candidate.reason } });
    expect(plan.explanation).toContain(PREPARATION_FIRST);
    expect(plan.horizonEnd).toBe(day(6));
  }, 60_000);

  test("Setting an exam needs a date of today or later and at least one covered skill; both refusals reach the learner with the concept's own message.", async () => {
    await journey();
    const before = await owner.read(course), records = await saved(owner.user, course);
    const attempts: [string, ExamInput][] = [["a date before today", { date: day(-1), covered: [vectors] }], ["no covered skill", { date: day(4), covered: [] }]];
    for (const [refusal, input] of attempts) {
      const answer = await owner.post("/planning/exams/set", { course, ...input });
      expect(answer, refusal).toEqual(refused(new concept.InvalidExamDetails().message));
      expect(await owner.direct("/planning/exams/set", { course, ...input }), refusal).toEqual(refusedBy("INVALID_EXAM_DETAILS"));
      // The page checks the same rule before it sends, so normally the request is never made.
      expect(examProblem(input, before.data, skills), refusal).toBe(new concept.InvalidExamDetails().message);
      await hear(refusal, answer, new concept.InvalidExamDetails().message, examExplanation(owner, course, input));
    }
    // Nothing was saved: no new exam, the existing exam keeps its skills, and no plan was proposed.
    expect(await owner.read(course)).toEqual(before);
    expect(await saved(owner.user, course)).toEqual(records);
  }, 60_000);

  test("Exams cover skills, chosen by the learner from the course's confirmed skills.", async () => {
    await journey();
    const before = await owner.read(course), records = await saved(owner.user, course);
    // A draft skill alongside a confirmed one, on the existing exam's date and on a new date.
    const attempts: [string, ExamInput][] = [["an unconfirmed skill on the exam's date", { date: EXAM_DAY, covered: [vectors, draft] }],
      ["an unconfirmed skill on a new date", { date: day(4), covered: [draft] }]];
    for (const [refusal, input] of attempts) {
      const answer = await owner.post("/planning/exams/set", { course, ...input });
      expect(answer, refusal).toEqual(refused(SKILLS_REFUSAL));
      expect(await owner.direct("/planning/exams/set", { course, ...input }), refusal).toEqual(refusedBy("EXAM_SKILLS_UNAVAILABLE"));
      expect(examProblem(input, before.data, skills), refusal).toBe(SKILLS_REFUSAL);
      await hear(refusal, answer, SKILLS_REFUSAL, examExplanation(owner, course, input));
    }
    expect(await owner.read(course)).toEqual(before);
    expect(await saved(owner.user, course)).toEqual(records);
    expect(before.exams).toEqual([{ exam, date: EXAM_DAY, covered: [vectors, matrices] }]);
  }, 60_000);

  test("When exam preparation does not fit the daily budget before the exam, the plan gives exam work priority, explains which preparation it would leave out, and asks the learner to confirm those cuts before the plan changes.", async () => {
    await journey();
    const before = await owner.read(course);
    // The exam also covers Determinants and Eigenvalues: forty minutes of preparation, thirty minutes before the exam.
    expect(await owner.ok("/planning/exams/set", { course, date: EXAM_DAY, covered: [vectors, matrices, determinants, eigenvalues] })).toEqual({ exam, refreshed: true });
    const read = await owner.read(course);
    // Nothing changed yet: the active plan and today's activity are exactly as before.
    expect(read.data).toEqual(before.data);
    expect(read.proposal).toHaveLength(1);
    const proposal = read.proposal[0]!;
    firstProposal = proposal.plan;
    expect(proposal).toMatchObject({ focusExam: exam, focusExamDate: EXAM_DAY, examUrgent: true, estimatedExamMinutes: 40, availableExamMinutes: 30 });
    expect(await statusOf(firstProposal)).toBe("PROPOSED");
    expect((await app.planning._plan({ plan: firstProposal }))[0]).toMatchObject({ needsConfirmation: true });
    // Priority: every study day before the exam holds only preparation; the routine review waits for the exam day.
    expect(read.proposalItems.map(({ day: when, candidate }) => [when, candidate.examRefs])).toEqual([[TODAY, [exam]], [day(1), [exam]], [day(2), [exam]], [day(3), []]]);
    // The left-out preparation is named with its minutes, reason, and consequence.
    expect(read.cuts).toHaveLength(1);
    const { cut } = read.cuts[0]!;
    expect(cut).toEqual({ exam, candidateKey: expect.stringMatching(new RegExp(`:exam:${exam}$`)), omittedScope: expect.stringMatching(/^Set confidence and try /),
      minutes: 10, reason: CUT_REASON, consequence: `No scheduled preparation for: ${cut.omittedScope}` });
    // Each covered skill is either scheduled before the exam or named as a cut.
    const scheduled = read.proposalItems.filter(({ candidate }) => candidate.examRefs.includes(exam)).map(({ candidate }) => candidate.subject);
    expect(sorted([...scheduled, subjectOf(cut.omittedScope)])).toEqual(sorted([vectors, matrices, determinants, eigenvalues]));
  }, 60_000);

  test("Reading the plan now also returns the active exams, and the PROPOSED plan when one needs confirmation: its cuts (activity, minutes, reason, consequence), estimatedExamMinutes, availableExamMinutes, examUrgent, and the focus exam's date.", async () => {
    await journey();
    const read = await owner.read(course);
    expect(read.exams).toEqual([{ exam, date: EXAM_DAY, covered: [vectors, matrices, determinants, eigenvalues] }]);
    expect(read.proposal).toEqual([{ plan: firstProposal, explanation: expect.stringContaining(PREPARATION_FIRST), examUrgent: true, estimatedExamMinutes: 40, availableExamMinutes: 30,
      focusExam: exam, focusExamDate: EXAM_DAY, locallyCurrent: true, contextCurrent: true, sessionInProgress: false }]);
    // The activities and cuts are the saved proposal's own, in the planning concept's order.
    expect(read.proposalItems).toEqual((await app.planning._items({ plan: firstProposal })).map(({ item, candidate, day: when }) => ({ item, candidate, day: when })));
    expect(read.cuts).toEqual(await app.planning._cuts({ plan: firstProposal }));
    // The active plan is still returned beside the proposal.
    expect(read.data.plan).toMatchObject({ plan: firstExamPlan, status: "ACTIVE" });
    // Reading changes nothing.
    expect(await owner.read(course)).toEqual(read);
  }, 60_000);

  test("Every new endpoint checks the session and course ownership. Another learner's exams and plans are never visible or changeable.", async () => {
    await journey();
    const outsider = await app.learner("journey-outsider");
    const own = await outsider.course("Physics", []);
    const before = await owner.read(course), records = await saved(owner.user, course);
    // One attempt on each new endpoint, using the owner's real exam date, skill, and waiting proposal.
    const attempts: [string, Record<string, unknown>][] = [
      ["/planning/exams/set", { date: EXAM_DAY, covered: [vectors] }],
      ["/planning/exams/remove", { date: EXAM_DAY }],
      ["/planning/tradeoffs/confirm", { plan: firstProposal }],
      ["/planning/tradeoffs/decline", { plan: firstProposal }],
    ];
    // Without a session, nothing is answered.
    for (const [path, input] of [...attempts, ["/planning/read", {}] as [string, Record<string, unknown>]]) {
      expect(await app.anonymous(path, { course, ...input }), path).toEqual(signedOut);
    }
    // Another learner can neither read the owner's course nor change anything in it.
    const reading = await outsider.post("/planning/read", { course });
    expect(reading).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: OWN_COURSE } });
    await hear("another learner reads the course", reading, OWN_COURSE, async () => "");
    for (const [path, input] of attempts) {
      const answer = await outsider.post(path, { course, ...input });
      expect(answer, path).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: OWN_COURSE } });
      await hear(`another learner calls ${path}`, answer, OWN_COURSE, async () => "");
    }
    // Naming their own course does not reach the owner's proposal either.
    for (const [path, confirming] of [["/planning/tradeoffs/confirm", true], ["/planning/tradeoffs/decline", false]] as const) {
      const answer = await outsider.post(path, { course: own.course, plan: firstProposal });
      expect(answer, path).toEqual(refused(PROPOSAL_REFUSAL));
      expect(await outsider.direct(path, { course: own.course, plan: firstProposal }), path).toEqual(refusedBy("PROPOSAL_UNAVAILABLE"));
      await hear(`another learner's own course with the owner's plan at ${path}`, answer, new concept.TradeoffPlanUnavailable().message,
        tradeoffExplanation(outsider, own.course, firstProposal, confirming));
    }
    // Nothing changed for the owner, and nothing was saved for the outsider.
    expect(await owner.read(course)).toEqual(before);
    expect(await saved(owner.user, course)).toEqual(records);
    expect(await saved(outsider.user, course)).toEqual({ exams: [], plans: [] });
    expect(await saved(outsider.user, own.course)).toEqual({ exams: [], plans: [] });
    const ownRead = await outsider.read(own.course);
    expect([ownRead.exams, ownRead.proposal, ownRead.proposalItems, ownRead.cuts]).toEqual([[], [], [], []]);
  }, 60_000);

  test("Both are refused while an activity is in progress, with the concept's message (Planning.md keeps this for confirming and allows declining)", async () => {
    await journey();
    const before = await owner.read(course);
    // Today's activity is exam preparation from the active plan.
    activity = before.data.next!.item;
    expect(before.data.next).toMatchObject({ day: TODAY, status: "TODO", candidate: { examRefs: [exam] } });
    expect(await owner.ok("/planning/begin", { course, item: activity })).toEqual({ item: activity });
    let read = await owner.read(course);
    expect(read.proposal[0]).toMatchObject({ plan: firstProposal, sessionInProgress: true, locallyCurrent: true, contextCurrent: true });

    const answer = await owner.post("/planning/tradeoffs/confirm", { course, plan: firstProposal });
    expect(answer).toEqual(refused(new concept.TradeoffSessionInProgress().message));
    expect(await owner.direct("/planning/tradeoffs/confirm", { course, plan: firstProposal })).toEqual(refusedBy("TRADEOFF_SESSION_IN_PROGRESS"));
    await hear("confirming during an activity", answer, new concept.TradeoffSessionInProgress().message, tradeoffExplanation(owner, course, firstProposal, true));
    read = await owner.read(course);
    expect(read.proposal[0]!.plan).toBe(firstProposal);
    expect(read.data.plan!.plan).toBe(firstExamPlan);
    expect(read.data.next).toMatchObject({ item: activity, status: "IN_PROGRESS" });

    // Declining changes neither the active plan nor the activity, so it is allowed.
    expect(await owner.ok("/planning/tradeoffs/decline", { course, plan: firstProposal })).toEqual({ plan: firstProposal });
    read = await owner.read(course);
    expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
    expect(read.data.plan!.plan).toBe(firstExamPlan);
    expect(read.data.next).toMatchObject({ item: activity, status: "IN_PROGRESS" });
    expect(await statusOf(firstProposal)).toBe("DECLINED");
  }, 60_000);

  test("In both answers, refreshed is false exactly when an activity is in progress, and the answer carries the notice; the plan updates when the activity stops.", async () => {
    await journey();
    const before = await owner.read(course), plans = (await saved(owner.user, course)).plans;
    // A second exam is saved during the activity, then removed again. Neither change refreshes the plan.
    const set = await owner.ok("/planning/exams/set", { course, date: day(5), covered: [vectors] });
    expect(set).toEqual({ exam: expect.any(String), refreshed: false, notice: WAITING });
    const second = (set as { exam: string }).exam;
    let read = await owner.read(course);
    expect(read.exams).toEqual([{ exam, date: EXAM_DAY, covered: [vectors, matrices, determinants, eigenvalues] }, { exam: second, date: day(5), covered: [vectors] }]);
    expect(read.data).toEqual(before.data);
    expect(read.proposal).toEqual([]);
    expect(await owner.ok("/planning/exams/remove", { course, date: day(5) })).toEqual({ exam: second, refreshed: false, notice: WAITING });
    read = await owner.read(course);
    expect(read.exams).toEqual(before.exams);
    expect(read.data).toEqual(before.data);
    expect((await saved(owner.user, course)).plans).toEqual(plans);

    // Stopping after ten minutes refreshes the plan. Today's time is spent, so only twenty minutes remain before the exam,
    // and the same preparation now needs two cuts. Declining earlier approved nothing, so the proposal waits again.
    expect(await owner.ok("/planning/stop", { course, item: activity, actualMinutes: 10 })).toEqual({ item: activity });
    read = await owner.read(course);
    expect(read.data.plan!.plan).toBe(firstExamPlan);
    expect(read.proposal[0]).toMatchObject({ focusExam: exam, examUrgent: true, estimatedExamMinutes: 40, availableExamMinutes: 20,
      locallyCurrent: true, contextCurrent: true, sessionInProgress: false });
    expect(read.proposalItems.map(({ day: when, candidate }) => [when, candidate.examRefs])).toEqual([[day(1), [exam]], [day(2), [exam]], [day(3), []]]);
    expect(read.cuts).toHaveLength(2);
    stale = read.proposal[0]!.plan;
  }, 60_000);

  test("Confirming activates the proposal using the current basis from PlanContext", async () => {
    await journey();
    const waiting = await owner.read(course);
    // The planning context changes while the proposal waits: the learner's starting confidence for Projections is saved
    // without the refresh that the HTTP confidence endpoint would cause.
    const definition = skills.find(({ skill }) => skill === projections)!.current;
    await app.mastery.initialize({ learner: owner.user, subject: projections, definition, confidence: 50, basis: "SELF_REPORTED" });
    let read = await owner.read(course);
    expect(read.proposal[0]).toMatchObject({ plan: stale, locallyCurrent: true, contextCurrent: false, sessionInProgress: false });
    const answer = await owner.post("/planning/tradeoffs/confirm", { course, plan: stale });
    expect(answer).toEqual(refused(new concept.TradeoffPlanOutdated().message));
    expect(await owner.direct("/planning/tradeoffs/confirm", { course, plan: stale })).toEqual(refusedBy("TRADEOFF_PLAN_OUTDATED"));
    await hear("confirming an out-of-date proposal", answer, new concept.TradeoffPlanOutdated().message, tradeoffExplanation(owner, course, stale, true));
    read = await owner.read(course);
    expect(read.data.plan!.plan).toBe(firstExamPlan);
    expect(read.proposal[0]!.plan).toBe(stale);

    // Update plan proposes from the current context; the same cuts still wait, and confirming now works.
    const { plan: fresh } = await owner.ok("/planning/propose", { course }) as { plan: string };
    expect(fresh).not.toBe(stale);
    read = await owner.read(course);
    expect(read.proposal[0]).toMatchObject({ plan: fresh, locallyCurrent: true, contextCurrent: true, sessionInProgress: false });
    expect(read.cuts).toEqual(waiting.cuts);
    expect(await owner.ok("/planning/tradeoffs/confirm", { course, plan: fresh })).toEqual({ plan: fresh });
    confirmed = fresh;
    approvedCutKeys = waiting.cuts.map(({ cut }) => cut.candidateKey);

    read = await owner.read(course);
    expect(read.data.plan).toMatchObject({ plan: confirmed, status: "ACTIVE", focusExam: exam, examUrgent: true });
    expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
    // One action activated it and replaced the earlier active plan, whose unstarted work is replaced, not missed.
    expect(await statusOf(firstExamPlan)).toBe("SUPERSEDED");
    expect(await statusOf(stale)).toBe("SUPERSEDED");
    const replaced = (await app.planning._items({ plan: firstExamPlan })).filter(({ item }) => item !== activity);
    expect(replaced.map(({ status }) => status)).toEqual(["REPLACED", "REPLACED", "REPLACED", "REPLACED"]);
    // The approved cuts stay visible as deferred work in the active plan.
    expect(sorted(read.data.plan!.deferred.map(({ candidate }) => candidate.key))).toEqual(sorted(approvedCutKeys));
  }, 60_000);

  test("Setting the same date again replaces its covered skills.", async () => {
    await journey();
    const before = await owner.read(course);
    // Vectors and Matrices leave the exam; Projections joins it.
    expect(await owner.ok("/planning/exams/set", { course, date: EXAM_DAY, covered: [determinants, eigenvalues, projections] })).toEqual({ exam, refreshed: true });
    const read = await owner.read(course);
    expect(read.exams).toEqual([{ exam, date: EXAM_DAY, covered: [determinants, eigenvalues, projections] }]);
    // Projections adds preparation that cannot fit, a cut the learner has not approved, so the active plan stays.
    expect(read.data).toEqual(before.data);
    expect(read.proposal[0]).toMatchObject({ focusExam: exam, examUrgent: true, estimatedExamMinutes: 50, availableExamMinutes: 20 });
    expect(read.cuts).toHaveLength(3);
    expect(read.cuts.some(({ cut }) => !approvedCutKeys.includes(cut.candidateKey))).toBe(true);
    // Unfinished preparation for Vectors and Matrices is carried (Planning.md), and Projections now has exam work too.
    const examWork = [...read.proposalItems.filter(({ candidate }) => candidate.examRefs.includes(exam)).map(({ candidate }) => candidate.subject),
      ...read.cuts.map(({ cut }) => subjectOf(cut.omittedScope))];
    expect(sorted(examWork)).toEqual(sorted([vectors, matrices, determinants, eigenvalues, projections]));
    laterProposal = read.proposal[0]!.plan;
    laterCuts = read.cuts;
  }, 60_000);

  test("declining marks it DECLINED and keeps the active plan", async () => {
    await journey();
    const before = await owner.read(course);
    expect(await owner.ok("/planning/tradeoffs/decline", { course, plan: laterProposal })).toEqual({ plan: laterProposal });
    const read = await owner.read(course);
    expect(await statusOf(laterProposal)).toBe("DECLINED");
    expect(read.data).toEqual(before.data);
    expect(read.data.plan).toMatchObject({ plan: confirmed, status: "ACTIVE" });
    expect(read.exams).toEqual(before.exams);
    expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
  }, 60_000);

  test("Removing an exam deactivates it. Proposals that depended on it become outdated, and a new proposal is made.", async () => {
    await journey();
    // Declining approved nothing, so Update plan makes the same cuts wait again. This proposal depends on the exam.
    const { plan: dependent } = await owner.ok("/planning/propose", { course }) as { plan: string };
    let read = await owner.read(course);
    expect(read.proposal[0]!.plan).toBe(dependent);
    expect(read.cuts).toEqual(laterCuts);

    expect(await owner.ok("/planning/exams/remove", { course, date: EXAM_DAY })).toEqual({ exam, refreshed: true });
    read = await owner.read(course);
    // The exam is kept but inactive, so the plan no longer lists it.
    expect(read.exams).toEqual([]);
    expect((await app.planning._exams({ learner: owner.user, scope: course })).filter(({ date }) => date === EXAM_DAY))
      .toEqual([expect.objectContaining({ exam, active: false })]);
    // The dependent proposal was replaced and can no longer be confirmed.
    expect(await statusOf(dependent)).toBe("SUPERSEDED");
    const answer = await owner.post("/planning/tradeoffs/confirm", { course, plan: dependent });
    expect(answer).toEqual(refused(new concept.TradeoffPlanUnavailable().message));
    expect(await owner.direct("/planning/tradeoffs/confirm", { course, plan: dependent })).toEqual(refusedBy("TRADEOFF_PLAN_UNAVAILABLE"));
    await hear("confirming a proposal replaced after the exam was removed", answer, new concept.TradeoffPlanUnavailable().message, tradeoffExplanation(owner, course, dependent, true));
    // The new proposal needed no cuts, so it activated: every skill is back to a routine review over seven days.
    expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
    const plan = read.data.plan!;
    expect(plan).toMatchObject({ status: "ACTIVE", examUrgent: false, horizonEnd: day(6), estimatedExamMinutes: 0, availableExamMinutes: 0 });
    expect(plan.focusExam).toBeUndefined();
    expect(plan.plan).not.toBe(confirmed);
    expect(await statusOf(confirmed)).toBe("SUPERSEDED");
    expect(plan.items.every(({ candidate }) => candidate.examRefs.length === 0)).toBe(true);
    expect(sorted(plan.items.map(({ candidate }) => candidate.subject))).toEqual(sorted([vectors, matrices, determinants, eigenvalues, projections]));
    expect(plan.explanation).not.toContain("exam");
  }, 60_000);

  test("Setting the same date again keeps the exam's identity and makes it active again, so a retry after a lost reply saves it once", async () => {
    await journey();
    const before = await owner.read(course);
    const request = { course, date: EXAM_DAY, covered: [vectors, matrices] };
    // The server saves the exam, but the reply is lost and the learner sends the same request again.
    const lost = await owner.post("/planning/exams/set", request);
    expect(lost).toMatchObject({ status: 200 });
    const retry = await owner.ok("/planning/exams/set", request);
    // The removed exam comes back with the same identity, and the retry gives the same answer.
    expect(retry).toEqual({ exam, refreshed: true });
    expect(lost.body).toEqual(retry);
    const read = await owner.read(course);
    expect(read.exams).toEqual([{ exam, date: EXAM_DAY, covered: [vectors, matrices] }]);
    expect((await app.planning._exams({ learner: owner.user, scope: course })).filter(({ date }) => date === EXAM_DAY)).toHaveLength(1);
    // Its unfinished preparation is carried again and cannot all fit, so one proposal waits; the active plan stays.
    expect(read.data).toEqual(before.data);
    expect(read.proposal).toHaveLength(1);
    expect(read.proposal[0]).toMatchObject({ focusExam: exam, estimatedExamMinutes: 50, availableExamMinutes: 20 });
    expect((await saved(owner.user, course)).plans.filter(({ status }) => status === "PROPOSED")).toHaveLength(1);
    retriedProposal = read.proposal[0]!.plan;
  }, 60_000);

  test("Repeating a confirmation or decline after it succeeded is refused by the concept, because the plan is no longer proposed; after a lost answer the plan read shows the saved decision", async () => {
    await journey();
    const before = await owner.read(course);
    const decline = { course, plan: retriedProposal };
    expect(await owner.post("/planning/tradeoffs/decline", decline)).toEqual({ status: 200, body: { plan: retriedProposal } });
    let answer = await owner.post("/planning/tradeoffs/decline", decline);
    expect(answer).toEqual(refused(new concept.PlanDeclineUnavailable().message));
    expect(await owner.direct("/planning/tradeoffs/decline", decline)).toEqual(refusedBy("PLAN_DECLINE_UNAVAILABLE"));
    await hear("declining again after a lost reply", answer, new concept.PlanDeclineUnavailable().message, tradeoffExplanation(owner, course, retriedProposal, false));
    let read = await owner.read(course);
    expect(await statusOf(retriedProposal)).toBe("DECLINED");
    expect(read.data).toEqual(before.data);
    expect(read.proposal).toEqual([]);

    // Update plan brings the same cuts back for a decision; this time the learner confirms and the reply is lost.
    const { plan: again } = await owner.ok("/planning/propose", { course }) as { plan: string };
    expect((await owner.read(course)).proposal[0]!.plan).toBe(again);
    const confirm = { course, plan: again };
    expect(await owner.post("/planning/tradeoffs/confirm", confirm)).toEqual({ status: 200, body: { plan: again } });
    answer = await owner.post("/planning/tradeoffs/confirm", confirm);
    expect(answer).toEqual(refused(new concept.TradeoffPlanUnavailable().message));
    expect(await owner.direct("/planning/tradeoffs/confirm", confirm)).toEqual(refusedBy("TRADEOFF_PLAN_UNAVAILABLE"));
    await hear("confirming again after a lost reply", answer, new concept.TradeoffPlanUnavailable().message, tradeoffExplanation(owner, course, again, true));
    read = await owner.read(course);
    expect(read.data.plan).toMatchObject({ plan: again, status: "ACTIVE", focusExam: exam, examUrgent: true });
    expect([read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], []]);
  }, 60_000);

  test("Removing an exam that is already removed succeeds again and leaves it inactive, so a retry after a lost reply is harmless", async () => {
    await journey();
    const request = { course, date: EXAM_DAY };
    expect(await owner.post("/planning/exams/remove", request)).toEqual({ status: 200, body: { exam, refreshed: true } });
    expect(await owner.ok("/planning/exams/remove", request)).toEqual({ exam, refreshed: true });
    const read = await owner.read(course);
    expect([read.exams, read.proposal, read.proposalItems, read.cuts]).toEqual([[], [], [], []]);
    expect(read.data.plan).toMatchObject({ status: "ACTIVE", examUrgent: false });
    expect(read.data.plan!.focusExam).toBeUndefined();
    expect(read.data.plan!.items.map(({ candidate }) => candidate.examRefs)).toEqual([[], [], [], [], []]);
    expect((await app.planning._exams({ learner: owner.user, scope: course })).filter(({ date }) => date === EXAM_DAY))
      .toEqual([expect.objectContaining({ exam, active: false })]);
  }, 60_000);

  test("Refusals reach the learner as the specific reason, not 'Check the field and try again' (the server sends each refusal's sentence as its detail)", async () => {
    await journey();
    expect(heard.map(({ refusal }) => refusal)).toEqual([
      "a date before today", "no covered skill", "an unconfirmed skill on the exam's date", "an unconfirmed skill on a new date",
      "another learner reads the course", "another learner calls /planning/exams/set", "another learner calls /planning/exams/remove",
      "another learner calls /planning/tradeoffs/confirm", "another learner calls /planning/tradeoffs/decline",
      "another learner's own course with the owner's plan at /planning/tradeoffs/confirm", "another learner's own course with the owner's plan at /planning/tradeoffs/decline",
      "confirming during an activity", "confirming an out-of-date proposal", "confirming a proposal replaced after the exam was removed",
      "declining again after a lost reply", "confirming again after a lost reply",
    ]);
    for (const { refusal, shown: sentence, expected } of heard) {
      expect(sentence, refusal).toBe(expected);
      expect(sentence, refusal).not.toBe(GENERIC);
    }
    // Every refusal arrives with its sentence: admission's own, the concept's message, or the composition's. The page shows
    // the server's sentence, so it needs no fresh read to explain a refusal.
    for (const { refusal, answer, expected } of heard) expect(answer.body.detail, refusal).toBe(expected);
  }, 60_000);
});
