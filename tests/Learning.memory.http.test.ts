import { afterAll, expect, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const ORIGIN = "http://localhost:5173", DAY = 86_400_000, cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const SAMPLE_DAYS = [1, 3, 7, 14, 30, 60, 90];
// Courses.md, "Course and skill refusals": the general sentence for a course that is not the learner's.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";
// Policy prototype-1, as MasteryEstimating.md states it. The test checks the read against these numbers; the read itself
// takes every value from the concept.
const halve = (value: number, days: number) => value * 2 ** (-days / 60);
/** The first whole day after the read on which `estimate`, left alone, is below 70%. */
const firstDayBelow = (estimate: number) => { let day = 1; while (halve(estimate, day) >= 70) day++; return day; };

type Point = { days: number; at: string; value: number };
type MemorySkill = {
  skill: string; title: string; unit: string; unitTitle: string; startingConfidence: number | null; startedAt: string | null; estimate: number | null;
  projection: Point[] | null; reviewBy: Point | null; belowNow: boolean | null; leftAlone: { at: string; value: number }[] | null;
};
type MemoryAnswer = { asOf: string; policy: { policy: string; halfLifeDays: number; reviewThreshold: number; readinessDays: number; reference: { days: number; value: number }[] }; skills: MemorySkill[] };

// The harness of Learning.evidence.http.test.ts, with its movable clock.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  let offset = 0, questions = 0;
  const clock = () => new Date(Date.now() + offset);
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.explanation) return { explanation: "Match a row to a column.", citations: [{ material, location }] };
      if (properties.question) return { question: `Practice ${++questions}: compute [[1,2],[3,4]] × [[2,0],[1,2]]. Why does order matter?`, citations: [{ material, location }] };
      if (properties.rationale) {
        const { help, fresh } = context as { help: string; fresh: boolean };
        return { result: help === "HINT" ? "SUPPORTED" : "INDEPENDENT", gateMet: help === "NONE" && fresh, rationale: "Both results and the explanation meet the saved gate." };
      }
      return { text: "Changing order pairs different rows and columns.", citations: [{ material, location }] };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  function browser() {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachments: [], ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
    async function signIn(name: string) { const start = await ok("/auth/commons/start"); await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name })); const identity = await ok("/auth/commons/resume"); owners.push(identity.user); return identity; }
    return { post, ok, signIn };
  }
  /** A session for native callers: `gateway` applies admission, `raw` is the assembled invoker that bypasses it. */
  async function native(user: string) {
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user as never });
    if ("error" in signedIn) throw new Error("Test session was refused");
    return {
      gateway: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 }),
      raw: (path: string, input: Record<string, unknown>) => runtime.application.invoker.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 }),
    };
  }
  return { browser, native, advance: (days: number) => { offset += days * DAY; } };
}
type App = Awaited<ReturnType<typeof setup>>;
function upload(course: string, name = "lesson.md", text = "# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match.") {
  const form = new FormData(); form.set("course", course); form.set("title", name); form.set("requestId", crypto.randomUUID());
  form.append("files", new File([text], name, { type: "text/markdown" })); return form;
}
async function learningFixture(app: App, name: string) {
  const learner = app.browser(), { user } = await learner.signIn(name);
  const { course } = await learner.ok("/courses/create", { title: "Linear algebra" });
  const { material } = await learner.ok("/courses/materials/add", upload(course));
  const { unit } = await learner.ok("/courses/units/add", { course, title: "Products" });
  const confirmed = async (title: string) => {
    const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title, outcome: `Work with ${title.toLowerCase()}`, gate: "Two worked examples and why" });
    await learner.ok("/courses/skills/confirm", { skill });
    return skill as string;
  };
  return { learner, user, course, unit, material, confirmed };
}
/** One fresh, unaided practice attempt, which the canned assessment judges an independent success that meets the gate. */
async function practise(learner: ReturnType<App["browser"]>, skill: string) {
  const { task } = await learner.ok("/learning/task", { skill });
  await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
  await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
}
const memory = async (learner: ReturnType<App["browser"]>, course: string) => await learner.ok("/learning/memory", { course }) as MemoryAnswer;
const row = (answer: MemoryAnswer, skill: string) => answer.skills.find((item) => item.skill === skill)!;

/** A projection never rises, sits on whole days after the read, and halves over 60 days. */
function expectDecaying(answer: MemoryAnswer, item: MemorySkill) {
  const asOf = Date.parse(answer.asOf), projection = item.projection!;
  expect(projection.map((point) => point.days)).toEqual(SAMPLE_DAYS);
  for (const point of projection) expect(Date.parse(point.at)).toBe(asOf + point.days * DAY);
  const values = [item.estimate!, ...projection.map((point) => point.value)];
  for (let index = 1; index < values.length; index++) expect(values[index]!).toBeLessThanOrEqual(values[index - 1]!);
  const day60 = projection.find((point) => point.days === 60)!;
  expect(Math.round(day60.value)).toBe(Math.round(item.estimate! / 2));
  expect(day60.value).toBeCloseTo(item.estimate! / 2, 6);
}

test("Memory answers the policy and its reference curve, a curve for a skill with a starting point, and no curve without one", async () => {
  const app = await setup(), { learner, course, unit, material, confirmed } = await learningFixture(app, "memory-reader");
  const started = await confirmed("Products"), unstarted = await confirmed("Transposes");
  await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Inverses", outcome: "Invert matrices", gate: "One inverse and why" });
  const before = Date.now();
  await learner.ok("/learning/confidence", { skill: started, confidence: 50 });
  const answer = await memory(learner, course);

  // The policy's settings come from MasteryEstimating, with the reference curve of an estimate of 100% left alone.
  expect(answer.policy).toMatchObject({ policy: "prototype-1", halfLifeDays: 60, reviewThreshold: 70, readinessDays: 14 });
  expect(answer.policy.reference.map((point) => point.days)).toEqual([0, ...SAMPLE_DAYS]);
  for (const point of answer.policy.reference) expect(point.value).toBeCloseTo(halve(100, point.days), 9);

  // Only confirmed skills are listed, in skill identity order; the draft is left out.
  expect(answer.skills.map((item) => item.skill)).toEqual([started, unstarted].sort());
  const curve = row(answer, started);
  expect(curve).toMatchObject({ title: "Products", unit, unitTitle: "Products", startingConfidence: 50, belowNow: true, reviewBy: null });
  expect(Date.parse(curve.startedAt!)).toBeGreaterThanOrEqual(before - 1000);
  expect(curve.estimate!).toBeCloseTo(50, 3);
  expectDecaying(answer, curve);
  // Left alone from its starting point, the skill follows its own projection, because nothing has changed it.
  expect(curve.leftAlone!.map((point) => point.at)).toEqual([curve.startedAt!, answer.asOf, ...curve.projection!.map((point) => point.at)]);
  expect(curve.leftAlone![0]!.value).toBe(50);
  curve.projection!.forEach((point, index) => expect(curve.leftAlone![index + 2]!.value).toBeCloseTo(point.value, 9));

  // A skill without a starting point keeps its row with no curve.
  expect(row(answer, unstarted)).toEqual({ skill: unstarted, title: "Transposes", unit, unitTitle: "Products", startingConfidence: null, startedAt: null,
    estimate: null, projection: null, reviewBy: null, belowNow: null, leftAlone: null });
  // A course with no confirmed skill answers an empty list and the same policy.
  const { course: empty } = await learner.ok("/courses/create", { title: "Statistics" });
  expect(await memory(learner, empty)).toMatchObject({ skills: [], policy: { halfLifeDays: 60, reviewThreshold: 70 } });
}, 60_000);

test("a skill lifted to 95% by an assessment falls below the review threshold on the day the half-life gives, and the day moves with time", async () => {
  const app = await setup(), { learner, user, course, confirmed } = await learningFixture(app, "memory-practiser");
  const skill = await confirmed("Products");
  await learner.ok("/learning/confidence", { skill, confidence: 50 });
  await practise(learner, skill);

  const answer = await memory(learner, course), curve = row(answer, skill);
  expect(curve.estimate!).toBeCloseTo(95, 3);
  expect(curve.belowNow).toBe(false);
  expectDecaying(answer, curve);
  // 95% halves every 60 days, so it is still 70% or more on day 26 and below it on day 27.
  expect(firstDayBelow(curve.estimate!)).toBe(27);
  expect(curve.reviewBy).toMatchObject({ days: 27 });
  expect(Date.parse(curve.reviewBy!.at)).toBe(Date.parse(answer.asOf) + 27 * DAY);
  expect(curve.reviewBy!.value).toBeLessThan(70);
  expect(curve.reviewBy!.value).toBeCloseTo(halve(curve.estimate!, 27), 6);
  // The assessment lifted the curve above the one it would have followed from its 50% start.
  expect(curve.leftAlone![0]!.value).toBe(50);
  curve.projection!.forEach((point, index) => expect(point.value).toBeGreaterThan(curve.leftAlone![index + 2]!.value));

  // Twenty days later, without practice, the estimate has fallen and the review day is seven days away. The browser's
  // session has ended by then, so a new session reads the course.
  const readLater = async () => { const result = await (await app.native(user)).gateway("/learning/memory", { course }) as { ok: true; value: MemoryAnswer }; return row(result.value, skill); };
  app.advance(20);
  const later = await readLater();
  expect(later.estimate!).toBeCloseTo(halve(95, 20), 2);
  expect(later.reviewBy).toMatchObject({ days: firstDayBelow(later.estimate!) });
  expect(later.reviewBy!.days).toBe(7);
  // Past the review day it is already below the threshold, so there is no review day to find.
  app.advance(10);
  expect(await readLater()).toMatchObject({ belowNow: true, reviewBy: null });
}, 60_000);

test("Memory refuses a course the learner does not own on every path and shows nothing of it", async () => {
  const app = await setup(), { learner, user, course, confirmed } = await learningFixture(app, "memory-owner");
  const skill = await confirmed("Products");
  await learner.ok("/learning/confidence", { skill, confidence: 80 });
  const other = app.browser(), outsider = await other.signIn("memory-outsider");
  const { course: own } = await other.ok("/courses/create", { title: "Statistics" });

  for (const target of [course, "missing-course"]) {
    const answer = await other.post("/learning/memory", { course: target });
    expect(answer).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
    expect(JSON.stringify(answer.body)).not.toContain(skill);
    const foreign = await app.native(outsider.user);
    expect(await foreign.gateway("/learning/memory", { course: target })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
    expect(await foreign.raw("/learning/memory", { course: target })).toMatchObject({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE" } });
  }
  // The outsider's own course lists only the outsider's skills, which are none.
  expect((await memory(other, own)).skills).toEqual([]);
  // The owner reads the curve on every path, and a request without a session is refused before any read.
  const owner = await app.native(user);
  for (const path of [owner.gateway, owner.raw]) {
    const result = await path("/learning/memory", { course }) as { ok: true; value: MemoryAnswer };
    expect(result).toMatchObject({ ok: true });
    expect(result.value.skills.map((item) => [item.skill, item.reviewBy?.days])).toEqual([[skill, firstDayBelow(result.value.skills[0]!.estimate!)]]);
  }
  expect((await app.browser().post("/learning/memory", { course })).status).toBe(401);
}, 60_000);
