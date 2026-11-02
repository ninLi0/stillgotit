import { afterAll, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";
import { TREE_KINDS } from "../src/computations/tree-kinds.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

// The in-page seeding script (scripts/seed-in-page.js), which fills a course with activity through the app's own HTTP API.
// The first tests read it as text. The last ones evaluate it as the browser would and run it against the real
// application with a canned tutor, the way it runs in a signed-in page.
const SCRIPT = await readFile(resolve(import.meta.dir, "../scripts/seed-in-page.js"), "utf8");
const WIRE = await readFile(resolve(import.meta.dir, "../generated/wire.ts"), "utf8");
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>;
type Summary = Record<string, any>;
type Seed = ((manifest: Record<string, unknown>) => Promise<Summary>) & { progress: { running: boolean; lines: string[]; summary: Summary | null }; courses(): Promise<any[]> };

/** Evaluates the script as a page would, with `fetch` as the page's, and answers the completion value and the page's globals. */
function evaluate(fetch: Fetch) {
  const page = { window: {} as Record<string, unknown>, fetch, crypto, console };
  const context = vm.createContext(page);
  const completion = vm.runInContext(SCRIPT, context);
  return { completion, context, seed: page.window.stillgotitSeed as Seed };
}

test("the script is plain JavaScript that defines window.stillgotitSeed and nothing else", () => {
  expect(SCRIPT).not.toMatch(/^\s*(import|export)\b/m);
  let requests = 0;
  const { completion, context, seed } = evaluate(async () => { requests++; return Response.json({}); });
  expect(completion).toBeUndefined();
  expect(Object.keys(context).sort()).toEqual(["console", "crypto", "fetch", "window"]);
  expect(Object.keys(context.window)).toEqual(["stillgotitSeed"]);
  expect(typeof seed).toBe("function");
  expect(typeof seed.courses).toBe("function");
  expect(seed.progress).toMatchObject({ running: false, lines: [], summary: null });
  // Evaluating the file sends nothing.
  expect(requests).toBe(0);
});

test("every request goes to an /api path of the generated HTTP contract, never to a private route", () => {
  const contract = new Set([...WIRE.matchAll(/^ {2}"(\/[^"]+)": \{$/gm)].map((match) => match[1]!));
  expect(contract.size).toBeGreaterThan(50);
  // The one fetch in the script sends every request to /api plus the path it was given.
  expect([...SCRIPT.matchAll(/\bfetch\(/g)]).toHaveLength(1);
  expect(SCRIPT).toContain("fetch(`/api${path}`, { method: \"POST\", credentials: \"same-origin\"");
  // Every path the script names, wherever it names one, is a public endpoint of the contract.
  const paths = new Set([...SCRIPT.matchAll(/["'`](\/(?:courses|learning|planning|settings|auth|internal|ai)\b[^"'`]*)["'`]/g)].map((match) => match[1]!));
  expect(paths.size).toBeGreaterThanOrEqual(20);
  for (const path of paths) {
    expect(contract.has(path), `${path} is in generated/wire.ts`).toBe(true);
    expect(path.startsWith("/internal/"), path).toBe(false);
  }
  // Each request is sent through the script's own helpers, which all use that fetch.
  const sent = new Set([...SCRIPT.matchAll(/\b(?:call|send|sendKeyed)\("([^"]+)"/g)].map((match) => match[1]!));
  expect([...sent].sort()).toEqual([...paths].sort());
});

test("the script checks tree kinds against the server's catalog", () => {
  const listed = /const TREE_KINDS = (\[[^\]]*\]);/.exec(SCRIPT)?.[1];
  expect(listed).toBeDefined();
  expect(JSON.parse(listed!)).toEqual([...TREE_KINDS]);
});

test("a manifest with a mistake is refused before any request is sent", async () => {
  let requests = 0;
  const { seed } = evaluate(async () => { requests++; return Response.json({}); });
  await expect(seed(undefined as never)).rejects.toThrow("Call stillgotitSeed with a manifest object");
  await expect(seed({ course: "c", lesson: 4 })).rejects.toThrow("\"lesson\" is not a manifest field");
  await expect(seed({ course: "c", skills: -1, confidence: 2, treeKind: "Cherry", examInDays: 3 })).rejects.toThrow(
    "skills must be a whole number of 0 or more. confidence must be a share from 0 to 1, such as 0.5. examInDays needs budgetMinutes");
  await expect(seed({ course: "c", treeKind: "Cherry" })).rejects.toThrow(`treeKind must be one of ${TREE_KINDS.join(", ")}.`);
  await expect(seed({ materials: ["m"] })).rejects.toThrow("course must be the id of one of your courses.");
  expect(requests).toBe(0);
  expect(seed.progress.running).toBe(false);
});

test("a second run, or loading the script again, is refused while a run is going", async () => {
  // The page's first request waits until the test lets it answer, so the run stays in progress meanwhile.
  let answer!: (response: Response) => void;
  const waiting = new Promise<Response>((resolve) => { answer = resolve; });
  const { context, seed } = evaluate(() => waiting);
  const run = seed({ course: "c", skills: 1, log: () => undefined });
  expect(seed.progress.running).toBe(true);
  await expect(seed({ course: "c", skills: 1 })).rejects.toThrow("A seeding run is already going in this page.");
  expect(() => vm.runInContext(SCRIPT, context)).toThrow("A seeding run is still going in this page.");
  expect((context.window as Record<string, unknown>).stillgotitSeed).toBe(seed);
  answer(Response.json({ error: "UNAUTHORIZED", detail: "Sign in to continue." }, { status: 401 }));
  await expect(run).resolves.toMatchObject({ failures: [{ step: "start", error: "UNAUTHORIZED" }] });
  expect(seed.progress.running).toBe(false);
  // Once the run is over, the file loads again and replaces the function.
  expect(vm.runInContext(SCRIPT, context)).toBeUndefined();
  expect((context.window as Record<string, unknown>).stillgotitSeed).not.toBe(seed);
});

/** The application with a canned tutor whose answers depend on the request, and a page signed in to it. */
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [];
  let calls = 0, questions = 0, failOpening = true;
  const suggestions: Record<string, { title: string; outcome: string; gate: string }[]> = {
    "Vectors notes": [
      { title: "Add vectors", outcome: "Add two vectors and draw the result.", gate: "Add two new pairs of vectors and explain the parallelogram rule." },
      { title: "Scale vectors", outcome: "Multiply a vector by a number.", gate: "Scale two new vectors and explain what a negative factor does." },
      { title: "Compute dot products", outcome: "Compute a dot product and read the angle from it.", gate: "Compute two new dot products and explain when one is zero." },
    ],
    "Matrices notes": [
      { title: "add vectors ", outcome: "The same skill as in the vectors notes, worded again.", gate: "Add two vectors." },
      { title: "Multiply matrices", outcome: "Compute a matrix product.", gate: "Solve two new products and explain why order matters." },
      { title: "Check matrix dimensions", outcome: "Decide whether two matrices can be multiplied.", gate: "Check three new pairs and explain each decision." },
    ],
  };
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async (_owner, source) => {
      calls++;
      const skills = suggestions[source.data.title];
      if (!skills) throw new Error("Canned interruption: this material cannot be read.");
      return { unitTitle: `From ${source.data.title}`, skills };
    },
    generate: async (_owner, sources, _instruction, context, schema) => {
      calls++;
      const properties = schema.properties as Record<string, unknown>;
      const citations = [{ material: sources[0]!.material, location: sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content" }];
      if (properties.explanation) {
        // The first lesson's opening fails once, so the run asks for it again as "Retry tutor reply" does.
        if (failOpening) { failOpening = false; throw new Error("Canned interruption: the opening was lost."); }
        return { explanation: "Start from the definition, then work one example.", citations };
      }
      if (properties.question) return { question: `${++questions}. Compute $u \\cdot v$ for u = (1, 2) and v = (3, 4). Then explain what the sign of the result tells you.`, citations };
      if (properties.rationale) {
        const text = (context as { response: { text: string } }).response.text;
        return text.includes("not sure") ? { result: "SLIP", gateMet: false, rationale: "The attempt stops before the working is finished." }
          : { result: "INDEPENDENT", gateMet: true, rationale: "The attempt meets the stated requirements." };
      }
      return { text: "Here is one more example, worked step by step.", citations };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor });
  cleanups.push(async () => {
    await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });
  const jar = new Map<string, string>();
  /** The page's own fetch: same origin, with the sign-in cookie, answered by the application. */
  const pageFetch: Fetch = async (url, init) => {
    const response = await runtime.handle(new Request(`${ORIGIN}${url}`, { method: init.method, body: init.body,
      headers: { ...init.headers, Origin: ORIGIN, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } }));
    for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
    return response;
  };
  async function ok(path: string, body: Record<string, unknown> | FormData = {}) {
    const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", body: body instanceof FormData ? body : JSON.stringify(body),
      headers: { Origin: ORIGIN, Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) } }));
    for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
    const payload = await response.json();
    expect(response.status, `${path}: ${JSON.stringify(payload)}`).toBe(200);
    return payload;
  }
  const start = await ok("/auth/commons/start");
  await ok("/auth/commons/finish", provider.approve(start.address, { subject: "seeder", username: "seeder" }));
  owners.push((await ok("/auth/commons/resume")).user);
  const { course } = await ok("/courses/create", { title: "Linear Algebra" });
  async function upload(title: string) {
    const form = new FormData();
    form.set("course", course); form.set("title", title); form.set("requestId", crypto.randomUUID());
    form.append("files", new File([`# ${title}\nA vector has a size and a direction. A matrix acts on vectors.`], `${title}.md`, { type: "text/markdown" }));
    return (await ok("/courses/materials/add", form)).material as string;
  }
  const materials = { broken: await upload("Scanned notes"), vectors: await upload("Vectors notes"), matrices: await upload("Matrices notes") };
  return { connection, course, materials, ok, pageFetch, signOut: () => jar.clear(), get calls() { return calls; } };
}

test("a run fills the course through the HTTP API, records what it could not do, and a second run changes nothing", async () => {
  const app = await setup(), lines: string[] = [];
  const { seed } = evaluate(app.pageFetch);
  const manifest = { course: app.course, materials: [app.materials.broken, "not-a-material", app.materials.vectors, app.materials.matrices],
    skills: 5, topics: ["Vectors", "Matrices"], confidence: 0.6, lessons: 3, practice: 2, adjustments: 1,
    budgetMinutes: 10, examInDays: 1, examTitle: "Quiz 3", treeKind: "cherry", archive: 1, log: (line: string) => lines.push(line) };
  const running = seed(manifest);
  // One run at a time: a second call while the first runs is refused at once.
  await expect(seed(manifest)).rejects.toThrow("A seeding run is already going in this page.");
  expect(seed.progress.running).toBe(true);
  const summary = await running;
  const plan = await app.ok("/planning/read", { course: app.course }), today = plan.data.today as string;
  const tomorrow = new Date(Date.parse(today) + 86_400_000).toISOString().slice(0, 10);
  expect(summary).toMatchObject({ course: app.course, skills: 5, confidence: 3, lessons: 3, practice: 2, adjustments: 1, treeKind: "cherry", archived: 1,
    plan: { budgetMinutes: 10, exams: [tomorrow], active: true, waitingForDecision: false, tradeoff: "declined once, then confirmed" }, skipped: [] });
  // The unreadable material failed twice, once on the retry, and the run went on with the other two.
  expect(summary.failures).toEqual([{ step: "skills", endpoint: "/api/courses/skills/suggest", error: "INVALID_REQUEST",
    detail: "The tutor could not produce a usable answer. Try again. Your saved work is still available." }]);
  expect(summary.notes).toEqual([expect.stringContaining("not-a-material is not one of this course's materials")]);
  expect(seed.progress).toMatchObject({ running: false, summary });
  expect(seed.progress.lines.length).toBe(lines.length);
  expect(lines).toContain("  The opening did not arrive (The tutor could not produce a usable answer. Try again. Your saved work is still available.). Asking once more.");

  // Skills keep the tutor's wording, skip a title already in the course, and spread over the two topics.
  const course = await app.ok("/courses/read", { course: app.course });
  const unit = (title: string) => course.units.find((row: { title: string }) => row.title === title).unit;
  const titles = (title: string) => course.skills.filter((skill: { unit: string }) => skill.unit === unit(title)).map((skill: { title: string }) => skill.title).sort();
  expect(course.units.map((row: { title: string }) => row.title).sort()).toEqual(["Matrices", "Vectors"]);
  expect(course.skills.every((skill: { status: string }) => skill.status === "CONFIRMED")).toBe(true);
  expect(titles("Vectors")).toEqual(["Add vectors", "Check matrix dimensions", "Compute dot products"]);
  expect(titles("Matrices")).toEqual(["Multiply matrices", "Scale vectors"]);
  expect(course.skills.find((skill: { title: string }) => skill.title === "Multiply matrices")).toMatchObject({ outcome: "Compute a matrix product.", gate: "Solve two new products and explain why order matters." });
  expect(course.looks).toEqual([{ unit: unit("Vectors"), kind: "cherry" }]);

  // Every skill's own read, as the lesson page sees it.
  const reads = await Promise.all(course.skills.map(async (skill: { skill: string }) => (await app.ok("/learning/read", { skill: skill.skill })).data));
  const sessions = reads.flatMap((read) => read.sessions);
  const cases = reads.flatMap((read) => read.cases).sort((a, b) => Date.parse(a.performedAt) - Date.parse(b.performedAt));
  expect(reads.filter((read) => read.track).map((read) => read.explanation.start.confidence).sort()).toEqual([20, 58, 95]);
  const lessons = sessions.filter((session) => session.lesson).sort((a, b) => a.session < b.session ? -1 : 1);
  expect(lessons.map((lesson) => lesson.lesson.request)).toEqual(["Explain this with a worked example.", "Why does this matter for the exam?", "Walk me through the definition slowly."]);
  expect(lessons.map((lesson) => lesson.status)).toEqual(["CLOSED", "OPEN", "CLOSED"]);
  for (const [index, lesson] of lessons.entries()) {
    expect(lesson.lesson.explanation).toBe("Start from the definition, then work one example.");
    expect(lesson.dialogue.map(({ turn }: { turn: { speaker: string; text: string } }) => [turn.speaker, turn.text])).toEqual([
      ["LEARNER", ["Can you show one more example with different numbers?", "How would I check my answer on a problem like this?", "What changes if one of the conditions is dropped?"][index]],
      ["TUTOR", "Here is one more example, worked step by step."]]);
  }
  // Practice: a plausible attempt and a weak one, each quoting its question, declared without help and assessed.
  expect(cases.map((item) => [item.judgment.result, item.help])).toEqual([["INDEPENDENT", "NONE"], ["SLIP", "NONE"]]);
  for (const item of cases) {
    expect(sessions.find((session) => session.session === item.task).status).toBe("CLOSED");
    expect(item.work.response.text).toMatch(/^“Compute … for u = \(1, 2\) and v = \(3, 4\)”: /);
  }
  expect(cases[1].work.response.text).toContain("I am not sure which step comes first.");
  const adjusted = reads.flatMap((read) => read.explanation?.changes.filter((change: { kind: string }) => change.kind === "ADJUSTMENT") ?? []);
  // The adjustment moves the estimate visibly, with a reason in full sentences.
  expect(adjusted).toHaveLength(1);
  expect(Math.abs(adjusted[0].after - adjusted[0].before)).toBeGreaterThanOrEqual(10);
  expect(adjusted[0].reason).toMatch(adjusted[0].after > adjusted[0].before ? /^I worked through the problem set questions on this on paper without any help, and I got them right\. /
    : /^I tried to explain this to a classmate yesterday and got stuck halfway through\. /);
  // The first finished conversation is archived: the first lesson.
  const archived = await app.ok("/learning/archived", { course: app.course });
  expect(archived.sessions.map((row: { studySession: string }) => row.studySession)).toEqual([lessons[0].session]);
  // The plan is active with the preparation it could not fit deferred, after one declined proposal.
  expect(plan.data.preferences).toMatchObject({ dailyMinutes: 10, focusNote: "Getting ready for Quiz 3." });
  expect(plan.data.plan.deferred.length).toBeGreaterThan(0);
  const planning = JSON.stringify(await app.connection.db.collection("studyplanning.learners").find({}).toArray());
  expect(planning).toContain("\"status\":\"DECLINED\"");

  // The same manifest again finds every count met: nothing is asked of the tutor and nothing changes.
  const calls = app.calls;
  const again = await seed(manifest);
  expect(app.calls).toBe(calls);
  expect(again).toMatchObject({ skills: 5, confidence: 3, lessons: 3, practice: 2, adjustments: 1, treeKind: "cherry", archived: 1, failures: [], notes: [],
    plan: { budgetMinutes: 10, exams: [tomorrow], active: true, tradeoff: "not run, because a plan was already active" } });
  expect(again.skipped).toEqual([
    "Skills: the course already has 5 confirmed skills (5 asked for).",
    "Starting confidence: 3 of 5 skills already have one (3 asked for).",
    "Lessons: the course already has 3 lessons (3 asked for).",
    "Practice: the course already has 2 assessed attempts (2 asked for).",
    "Adjustments: the course already has 1 adjustment (1 asked for).",
    `Plan: the course already has a budget of 10 minutes, an exam on ${tomorrow}, and an active plan.`,
    "Tree kind: “Vectors” already grows a cherry tree.",
    "Archive: the course already has 1 archived conversation (1 asked for).",
  ]);
  expect(await app.ok("/courses/read", { course: app.course })).toEqual(course);

  // The course list helper names each course with its topics and materials, for writing a manifest.
  expect(await seed.courses()).toEqual([{ course: app.course, title: "Linear Algebra", status: "ACTIVE", topics: expect.arrayContaining(["Vectors", "Matrices"]),
    materials: expect.arrayContaining([{ material: app.materials.vectors, title: "Vectors notes" }]) }]);
});

test("a run without a sign-in stops at once and says why", async () => {
  const app = await setup();
  app.signOut();
  const { seed } = evaluate(app.pageFetch);
  const summary = await seed({ course: app.course, materials: [app.materials.vectors], skills: 2, log: () => undefined });
  expect(summary).toEqual({ course: app.course, skipped: [], notes: [expect.stringContaining("The sign-in ended, so the run stopped.")],
    failures: [{ step: "start", endpoint: "/api/courses/read", error: "UNAUTHORIZED", detail: expect.any(String) }] });
  expect(app.calls).toBe(0);
  expect(seed.progress.running).toBe(false);
});

test("a plan whose preparation fits says why no trade-off was offered", async () => {
  const app = await setup();
  const { seed } = evaluate(app.pageFetch);
  const summary = await seed({ course: app.course, materials: [app.materials.vectors], skills: 2, budgetMinutes: 30, examInDays: 7, log: () => undefined });
  expect(summary).toMatchObject({ skills: 2, failures: [], plan: { budgetMinutes: 30, active: true, waitingForDecision: false, tradeoff: "none offered: the preparation fits before the exam" } });
  expect(summary.notes).toEqual([expect.stringContaining("no trade-off was offered, because preparing the 2 skills takes at most 20 minutes and the budget gives 210 minutes before the exam.")]);
  expect(summary.skipped).toEqual(["Starting confidence: none asked for.", "Lessons: none asked for.", "Practice: none asked for.", "Adjustments: none asked for.",
    "Tree kind: none asked for.", "Archive: none asked for."]);
});
