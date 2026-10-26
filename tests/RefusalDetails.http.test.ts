import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { assessmentReviewing } from "../src/concepts/AssessmentReviewing/registry.ts";
import { commonsFederating } from "../src/concepts/Federating/registry.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { generating } from "../src/concepts/Generating/registry.ts";
import { groundedTutoring } from "../src/concepts/GroundedTutoring/registry.ts";
import { materialKeeping } from "../src/concepts/MaterialKeeping/registry.ts";
import { InvalidInitialConfidence } from "../src/concepts/MasteryEstimating/refusals.ts";
import { masteryEstimating } from "../src/concepts/MasteryEstimating/registry.ts";
import { registering } from "../src/concepts/Registering/registry.ts";
import { sessioning } from "../src/concepts/Sessioning/registry.ts";
import { UnitCourseUnavailableError } from "../src/concepts/SkillMapping.ts";
import { skillMapping } from "../src/concepts/SkillMapping.registry.ts";
import { budgeting } from "../src/concepts/Budgeting/registry.ts";
import { SESSION_COOKIE, refusalDetail, refusalDetails, scopedRefusalDetails, stillGotItPolicy } from "../src/host/http-policy.ts";
import { createRuntime } from "../src/host/runtime.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// A refusal's sentence reaches HTTP and native callers as `detail` (src/host/http.ts). The adapter itself sends only the
// public category, so these tests check the host's map against its sources and then follow refusals through both paths.
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const message = (Refusal: new () => Error) => new Refusal().message;
const OWN_COURSE = "Choose one of your own courses.";
const ADJUST_SKILL = "Choose one of your confirmed skills before adjusting its estimate.";
// Courses.md, "Course and skill refusals": the general sentences on every endpoint without a more specific one.
const COURSE_UNAVAILABLE = "This course is not available. Reload the page to see your courses.";
const SKILL_UNAVAILABLE = "This skill is not available. Reload the page to see your skills.";
const SIGNED_OUT = "Your session has ended. Sign in again.";
// What TutorFailures records when the tutor fails without a provider error, and Generating's own general sentence.
const TUTOR_REASON = "The tutor could not produce a usable answer. Try again. Your saved work is still available.";
const GENERATION_FAILED = "The tutor could not finish. Check your connection and retry. Your saved work is still available.";

test("the host's sentences are the ones the concepts and compositions state, as the generated read-back lists them", async () => {
  const readBack = await Bun.file(resolve(import.meta.dir, "../generated/stillgotit.md")).text();
  // Every concept refusal, with its specification's sentence.
  const stated = [...readBack.matchAll(/^ {2}- Refuses `([A-Z_]+)`: (.+)$/gm)].map(([, code, sentence]) => [code!, sentence!] as const);
  expect(stated.length).toBeGreaterThan(100);
  for (const [code, sentence] of stated) expect(refusalDetails[code], code).toBe(sentence);
  // Every refusal class that carries its own message carries that same sentence.
  for (const { refusals } of [registering, commonsFederating, sessioning, skillMapping, materialKeeping, groundedTutoring, assessmentReviewing, masteryEstimating, budgeting, generating]) {
    for (const [code, signal] of Object.entries(refusals ?? {})) {
      const Refusal = signal as unknown as new () => Error;
      if (Refusal.length === 0 && message(Refusal)) expect(message(Refusal), code).toBe(refusalDetails[code]!);
    }
  }
  // Every composition answer that states a detail. The engine keeps only the code, so the host must restate the sentence.
  const composed = [...readBack.matchAll(/RequestBoundary\.respond \(detail: "([^"]+)", error: "([A-Z_]+)"/g)].map(([, sentence, code]) => [code!, sentence!] as const);
  expect(composed.length).toBeGreaterThan(0);
  for (const [code, sentence] of composed) expect(scopedRefusalDetails[code]?.detail ?? refusalDetails[code], code).toBe(sentence);
});

test("a more specific sentence applies only where its design gives it, the general one everywhere else, and every public code has a sentence", () => {
  // Planning.md and Learning.md: the planning endpoints and Adjust keep their more specific sentences.
  for (const path of ["/planning/read", "/planning/configure", "/planning/tradeoffs/decline"]) expect(refusalDetail(path, "COURSE_UNAVAILABLE"), path).toBe(OWN_COURSE);
  expect(refusalDetail("/learning/adjust", "SKILL_UNAVAILABLE")).toBe(ADJUST_SKILL);
  // Courses.md, "Course and skill refusals": every other endpoint gives the general sentence.
  for (const path of ["/courses/read", "/courses/archive", "/courses/skills/details", "/learning/progress", "/learning/continue"]) {
    expect(refusalDetail(path, "COURSE_UNAVAILABLE"), path).toBe(COURSE_UNAVAILABLE);
  }
  for (const path of ["/learning/read", "/learning/confidence", "/learning/lesson", "/learning/task"]) expect(refusalDetail(path, "SKILL_UNAVAILABLE"), path).toBe(SKILL_UNAVAILABLE);
  // A concept's sentence applies on every endpoint.
  expect(refusalDetail("/courses/units/add", "UNIT_COURSE_UNAVAILABLE")).toBe(message(UnitCourseUnavailableError));
  // Learning.md, "Refusal sentences": the four codes that once reached the browser as their category alone.
  const openSession = "This session is closed or is not one of yours. Choose one of your open sessions.";
  for (const path of ["/learning/respond", "/learning/transcript", "/learning/assess", "/learning/retry"]) expect(refusalDetail(path, "SESSION_UNAVAILABLE"), path).toBe(openSession);
  expect(refusalDetail("/learning/hint", "SESSION_CHANGED")).toBe("This session closed before the tutor's answer could be saved. Your own work in it is still saved.");
  expect(refusalDetail("/learning/task", "SKILL_CHANGED")).toBe("This skill changed while the tutor was answering, so nothing was saved. Try again.");
  expect(refusalDetail("/courses/skills/suggest", "MATERIAL_UNAVAILABLE")).toBe("This material is not available in this course. Reload the page to see its materials.");
  // Every code in the policy's table has a non-empty sentence: on every endpoint, or on the endpoints its design names.
  const publicCodes = Object.keys(stillGotItPolicy(ORIGIN).publicErrors ?? {});
  const sentence = (code: string) => Object.hasOwn(refusalDetails, code) ? refusalDetails[code] : scopedRefusalDetails[code]?.detail;
  expect(publicCodes.length).toBeGreaterThan(100);
  expect(publicCodes.filter((code) => !sentence(code)?.trim())).toEqual([]);
});

async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  // Suggestions are unused, and every lesson fails without a provider error.
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Unused", skills: [] }),
    generate: async () => { throw new Error("The tutor is unavailable in this test."); },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor });
  cleanups.push(async () => {
    await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });

  async function send(path: string, body: Record<string, unknown> | FormData, cookie: string) {
    return runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookie,
      ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
  }
  async function learner(name: string) {
    const jar = new Map<string, string>();
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      const response = await send(path, body, [...jar].map(([key, value]) => `${key}=${value}`).join("; "));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      return { status: response.status, body: await response.json() };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
      const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body;
    }
    const start = await ok("/auth/commons/start");
    await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
    const { user } = await ok("/auth/commons/resume");
    owners.push(user);
    const signedIn = await runtime.application.concepts.Sessioning.start({ subject: user });
    if ("error" in signedIn) throw new Error("The test session was refused.");
    const { course } = await ok("/courses/create", { title: "Linear algebra" });
    const form = new FormData(); form.set("course", course); form.set("title", "Notes"); form.set("requestId", crypto.randomUUID());
    form.append("files", new File(["# Notes\nMultiply rows by columns."], "notes.md", { type: "text/markdown" }));
    const { material } = await ok("/courses/materials/add", form);
    const { unit } = await ok("/courses/units/add", { course, title: "Products" });
    const { skill } = await ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Products", outcome: "Multiply matrices", gate: "Two products" });
    await ok("/courses/skills/confirm", { skill });
    return {
      post, ok, course: course as string, skill: skill as string,
      /** The exported runtime gateway, with admission, as a native caller with its own session. */
      native: (path: string, input: Record<string, unknown>) => runtime.gateway.invoke(path, { ...input, session: signedIn.session }, { timeoutMs: 5000 }),
    };
  }
  return { send, learner };
}

test("a refusal reaches the browser and native callers with its sentence, and an explanation the host already gives wins", async () => {
  const app = await setup(), maya = await app.learner("detail-maya"), sam = await app.learner("detail-sam");

  // A concept's refusal on a learning path: MasteryEstimating's sentence.
  const confidence = message(InvalidInitialConfidence);
  expect(await maya.post("/learning/confidence", { skill: maya.skill, confidence: 150 })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: confidence } });
  expect(await maya.native("/learning/confidence", { skill: maya.skill, confidence: 150 }))
    .toEqual({ ok: false, error: { kind: "domain", value: "INVALID_INITIAL_CONFIDENCE", detail: confidence } });
  // A concept's refusal on a course change, under a different public category: SkillMapping's sentence.
  const unitCourse = message(UnitCourseUnavailableError);
  expect(await sam.post("/courses/units/add", { course: maya.course, title: "Taken" })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: unitCourse } });
  expect(await sam.native("/courses/units/add", { course: maya.course, title: "Taken" }))
    .toEqual({ ok: false, error: { kind: "domain", value: "UNIT_COURSE_UNAVAILABLE", detail: unitCourse } });

  // The planning endpoints keep their more specific course sentence. On /planning/configure, admission declines another
  // learner's course first with its own sentence, which wins as on every admitted command.
  expect(await sam.post("/planning/read", { course: maya.course })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: OWN_COURSE } });
  expect(await sam.native("/planning/read", { course: maya.course })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: OWN_COURSE } });
  expect(await sam.post("/planning/configure", { course: maya.course, dailyMinutes: 20, focusNote: "" }))
    .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Choose your own course before setting its study budget." } });
  // Adjust keeps its more specific skill sentence.
  const adjust = { skill: maya.skill, adjustmentKey: crypto.randomUUID(), value: 90, reason: "I know this." };
  expect(await sam.post("/learning/adjust", adjust)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: ADJUST_SKILL } });
  // A course endpoint and the learning reads give the general sentences, over HTTP and to native callers.
  expect(await sam.post("/courses/read", { course: maya.course })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
  expect(await sam.native("/courses/read", { course: maya.course })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
  expect(await sam.post("/learning/progress", { course: maya.course })).toEqual({ status: 403, body: { error: "FORBIDDEN", detail: COURSE_UNAVAILABLE } });
  expect(await sam.native("/learning/progress", { course: maya.course })).toEqual({ ok: false, error: { kind: "domain", value: "COURSE_UNAVAILABLE", detail: COURSE_UNAVAILABLE } });
  expect(await sam.post("/learning/read", { skill: maya.skill })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SKILL_UNAVAILABLE } });
  expect(await sam.native("/learning/read", { skill: maya.skill })).toEqual({ ok: false, error: { kind: "domain", value: "SKILL_UNAVAILABLE", detail: SKILL_UNAVAILABLE } });

  // An ended session: Sessioning's sentence, while the adapter still clears the session cookie and forbids caching.
  const signedOut = await app.send("/courses", {}, `${SESSION_COOKIE}=ended-session`);
  expect({ status: signedOut.status, body: await signedOut.json() }).toEqual({ status: 401, body: { error: "UNAUTHORIZED", detail: SIGNED_OUT } });
  expect(signedOut.headers.getSetCookie()).toEqual([expect.stringMatching(new RegExp(`^${SESSION_COOKIE}=;.*Max-Age=0`))]);
  expect(signedOut.headers.get("Cache-Control")).toBe("no-store");

  // The tutor's recorded reason replaces Generating's general sentence over HTTP; a native caller gets the general one.
  expect(await maya.post("/learning/lesson", { skill: maya.skill, request: "Explain products." })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: TUTOR_REASON } });
  expect(await maya.native("/learning/lesson", { skill: maya.skill, request: "Explain products." }))
    .toEqual({ ok: false, error: { kind: "domain", value: "GENERATION_FAILED", detail: GENERATION_FAILED } });
  // Admission's own sentence still answers before the concept is reached.
  expect(await maya.post("/learning/task", { skill: maya.skill }))
    .toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: "Set starting confidence and check the prerequisites before starting fresh practice." } });
}, 60_000);
