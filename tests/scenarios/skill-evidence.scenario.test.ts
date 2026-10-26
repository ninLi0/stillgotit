import { afterAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRuntime } from "../../src/host/runtime.ts";
import { MemoryProvider } from "../../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";
import type { CourseTutor } from "../../src/host/tutor.ts";
import { failureText } from "../../frontend/src/api.ts";
import { planDay, sourceLabel } from "../../frontend/src/labels.ts";
import { PendingAdjustment } from "../../frontend/src/pending-adjustment.ts";

// One learner's journey through the brief "Evidence behind each skill's estimate", end to end through HTTP.
// The tests run in order and share one application, so each step starts where the previous one ended.

const ORIGIN = "http://localhost:5173", DAY = 86_400_000, cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const UNAVAILABLE_SKILL = "Choose one of your confirmed skills before adjusting its estimate.";
const RESPOND_DECLINED = "Choose an open session, check the latest dialogue, and attach only your own work from this course, each file once.";
const LESSON_TEXT = "# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match.";
// A complete one-pixel PNG, so the importer treats each upload as a photo.
const PNG = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
const READABLE_DAY = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}$/;
const decay = (value: number, days: number) => value * 2 ** (-days / 60);

type Runtime = Awaited<ReturnType<typeof createRuntime>>;
type Change = { at: string; kind: string; source: string; before: number; after: number; decay: number; days: number; reason: string };

/** The harness of tests/Learning.http.test.ts, with a clock the scenario can move forward and a server restart. */
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), runtimes: Runtime[] = [], owners: string[] = [];
  let offset = 0, questions = 0;
  const clock = () => new Date(Date.now() + offset);
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [] }),
    generate: async (_owner, sources, _instruction, context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      // The tutor cites the first saved location of the first source, as a real answer cites a passage.
      const material = sources[0]!.material, location = sources[0]!.data.originals[0]?.renditions[0]?.location ?? "content";
      if (properties.explanation) return { explanation: "Match a row to a column. The inner dimensions must match.", citations: [{ material, location }] };
      // Each practice task needs a question the learner has not seen.
      if (properties.question) return { question: `Practice ${++questions}: compute [[1,2],[3,4]] × [[2,0],[1,2]]. Why does order matter?`, citations: [{ material, location }] };
      if (properties.rationale) {
        const { help, fresh } = context as { help: string; fresh: boolean };
        return { result: help === "HINT" ? "SUPPORTED" : "INDEPENDENT", gateMet: help === "NONE" && fresh, rationale: "Both results and the explanation meet the saved gate." };
      }
      return { text: "Changing order pairs different rows and columns.", citations: [{ material, location }] };
    },
  };
  const open = async () => {
    const opened = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor, clock });
    runtimes.push(opened);
    return opened;
  };
  let runtime = await open();
  cleanups.push(async () => {
    for (const opened of runtimes) await opened.gateway.beginDrain();
    await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true });
  });
  function browser() {
    const jar = new Map<string, string>();
    const cookies = () => [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      if (["/learning/respond", "/learning/question"].includes(path) && !(body instanceof FormData)) body = { channel: "TEXT", attachments: [], ...body };
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN, Cookie: cookies(),
        ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      const payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
    async function signIn(name: string) {
      const start = await ok("/auth/commons/start");
      await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name }));
      const identity = await ok("/auth/commons/resume");
      owners.push(identity.user);
      return identity.user as string;
    }
    /** The host's material-file download, which answers with bytes rather than JSON. */
    function download(body: Record<string, unknown>) {
      return runtime.handle(new Request(`${ORIGIN}/api/courses/materials/file`, { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json", Cookie: cookies() }, body: JSON.stringify(body) }));
    }
    /** One file uploaded the way the skill page uploads a photo of paper work: one material per file. */
    async function upload(course: string, title: string, file: File) {
      const form = new FormData(); form.set("course", course); form.set("title", title); form.set("requestId", crypto.randomUUID()); form.append("files", file);
      return (await ok("/courses/materials/add", form)).material as string;
    }
    return { post, ok, signIn, download, upload };
  }
  return { browser, get concepts() { return runtime.application.concepts; }, advance: (days: number) => { offset += days * DAY; },
    restart: async () => { await runtime.gateway.beginDrain(); runtime = await open(); } };
}

/** Session storage for the page's pending adjustment, kept across a simulated reload. */
function tabStorage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

describe("Evidence behind each skill's estimate", () => {
  let app: Awaited<ReturnType<typeof setup>>;
  let learner: ReturnType<typeof app.browser>, other: ReturnType<typeof app.browser>;
  let user = "", outsider = "", course = "", unit = "", skill = "", definition = "", track = "", lessonMaterial = "";
  const storage = tabStorage();
  const photo = (name: string) => new File([PNG], name, { type: "image/png" });
  const read = async () => learner.ok("/learning/read", { skill });
  const adjustments = async () => app.concepts.MasteryEstimating._adjustments({ track });
  const explain = async (at: Date) => (await app.concepts.MasteryEstimating._explanation({ learner: user, subject: skill, definition, at }))[0]!.explanation;

  test("Show the starting basis and the provisional sentence from `basis` prominently when there is no scored evidence yet", async () => {
    app = await setup();
    learner = app.browser(); other = app.browser();
    user = await learner.signIn("maya"); outsider = await other.signIn("leo");
    ({ course } = await learner.ok("/courses/create", { title: "Linear algebra" }));
    lessonMaterial = await learner.upload(course, "Matrix multiplication", new File([LESSON_TEXT], "lesson.md", { type: "text/markdown" }));
    ({ unit } = await learner.ok("/courses/units/add", { course, title: "Products" }));
    ({ skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: lessonMaterial, title: "Products", outcome: "Multiply matrices", gate: "Two products and why order matters" }));
    await learner.ok("/courses/skills/confirm", { skill });

    // Before a starting point exists there is no explanation, so the page asks for starting confidence.
    expect(await read()).toMatchObject({ explanation: null, track: null, estimate: null });

    ({ track } = await learner.ok("/learning/confidence", { skill, confidence: 60 }));
    app.advance(1);
    const data = await read();
    definition = data.skill.current;
    expect(data.explanation.start).toMatchObject({ confidence: 60, startingBasis: "SELF_REPORTED" });
    // Only time has changed the estimate so far.
    expect(data.explanation.changes.map((change: Change) => change.kind)).toEqual(["TIME"]);
    expect(data.explanation.changes[0].after).toBeCloseTo(decay(60, 1), 3);
    expect(data.explanation.provisional).toBe(true);
    expect(data.explanation.basis).toContain("Started from your reported confidence.");
    expect(data.explanation.basis).toContain("No scored evidence yet; this estimate is provisional.");
    expect(data.explanation.basis).toBe((await explain(new Date(data.explanation.changes[0].at))).basis);
    expect(data.estimate.ready).toBe(false);
  }, 60_000);

  test("The timeline shows every change the concept reports, in order, with readable dates (\"Fri, Oct 23\") and rounded values; nothing is computed in the browser that the concept already computes.", async () => {
    // The learner practises and is assessed: fresh independent work that meets the gate.
    const { task } = await learner.ok("/learning/task", { skill });
    await learner.ok("/learning/respond", { studySession: task, text: "First [[4,4],[10,8]]. Order changes which rows meet which columns.", dialogueLength: 0 });
    await learner.ok("/learning/assess", { studySession: task, dialogueLength: 1, reviewed: true, unseen: true, outsideHelp: false });
    app.advance(3);

    const data = await read(), timeline = data.explanation, [attempt, time] = timeline.changes as Change[];
    const assessed = data.cases.find((item: { task: string }) => item.task === task);
    expect(timeline.changes.map((change: Change) => change.kind)).toEqual(["ATTEMPT", "TIME"]);
    expect(timeline.start).toMatchObject({ confidence: 60, startingBasis: "SELF_REPORTED" });
    // The attempt row names the assessed case, folds in the day of decay before it, and shows what the attempt did.
    expect(attempt).toMatchObject({ source: assessed.case, after: 95, days: 1, reason: "" });
    expect(attempt!.before).toBeCloseTo(decay(60, 1), 3);
    // The time row shows how three days without practice lowered the estimate.
    expect(time).toMatchObject({ source: "", before: 95, days: 3, reason: "" });
    expect(time!.after).toBeCloseTo(decay(95, 3), 3);
    expect(timeline).toMatchObject({ ignored: [], provisional: false });
    expect(timeline.basis).toContain("1 assessed attempt(s) affect this estimate.");

    // Every row is the concept's own change at the read's instant, in the concept's order, with the concept's values.
    const at = new Date(time!.at), own = await explain(at);
    expect(timeline.changes.map((change: Change) => [Date.parse(change.at), change.after])).toEqual(own.changes.map((change) => [change.at.getTime(), change.after]));
    expect(attempt!.before).toBe(own.changes[0]!.decayed);
    expect(time!.before).toBe(own.changes[1]!.before);
    expect(timeline.basis).toBe(own.basis);
    expect(Date.parse(timeline.start.at)).toBe(own.replayStart.getTime());
    // The readiness sentence and flag are the concept's.
    const [estimate] = await app.concepts.MasteryEstimating._estimate({ learner: user, subject: skill, definition, at });
    expect(data.estimate).toMatchObject({ basis: estimate!.basis, ready: estimate!.ready });
    expect(data.estimate.ready).toBe(true);
    // Values arrive unrounded for the page to round, and every date is one the page's formatter reads as a day.
    expect(Number.isInteger(time!.after)).toBe(false);
    for (const value of [timeline.start.at, ...timeline.changes.map((change: Change) => change.at)]) expect(planDay(value)).toMatch(READABLE_DAY);
  }, 60_000);

  test("The skill page shows the adjustment in the timeline and the new estimate.", async () => {
    // The page prepares the adjustment with a fresh key, sends it, and forgets the key once the answer arrives.
    const pending = new PendingAdjustment(storage, skill), reason = "I could not redo the second product without my notes.";
    const input = pending.prepare(40, reason);
    const { adjustment } = await learner.ok("/learning/adjust", input);
    pending.finish(input.adjustmentKey);
    expect(pending.read()).toBeNull();

    const data = await read(), changes = data.explanation.changes as Change[];
    expect(changes.map((change) => change.kind)).toEqual(["ATTEMPT", "ADJUSTMENT", "TIME"]);
    // The adjustment row carries the learner's reason and the new value.
    expect(changes[1]).toMatchObject({ source: adjustment, reason, after: 40, days: 3 });
    expect(changes[1]!.before).toBeCloseTo(decay(95, 3), 3);
    expect(data.estimate.value).toBeCloseTo(40, 3);
    // An adjustment is not practice: the concept's readiness sentence says fresh work is still needed.
    const [estimate] = await app.concepts.MasteryEstimating._estimate({ learner: user, subject: skill, definition, at: new Date(changes[2]!.at) });
    expect(data.estimate).toMatchObject({ basis: estimate!.basis, ready: false });
    expect(data.estimate.basis).toContain("Your manual adjustments are included.");
    expect(data.estimate.basis).toContain("Fresh independent work is needed to establish readiness.");
    expect(await adjustments()).toHaveLength(1);
  }, 60_000);

  test("`adjust` takes an operation key so a retry adds no second row", async () => {
    const pending = new PendingAdjustment(storage, skill), reason = "I redid both products from the problem set.";
    const input = pending.prepare(55, reason);
    // The server saves the adjustment, but its reply is lost: the page never sees the answer and keeps the key.
    await learner.post("/learning/adjust", input);
    const saved = await adjustments();
    expect(saved).toHaveLength(2);

    // The tab reloads, and the server restarts as well. The unanswered adjustment comes back with the same key.
    await app.restart();
    const reloaded = new PendingAdjustment(storage, skill);
    expect(reloaded.read()).toEqual(input);
    // The page reads the skill again, and the timeline shows that the adjustment was saved.
    expect((await read()).explanation.changes.filter((change: Change) => change.source === saved[1]!.adjustment)).toHaveLength(1);

    // Sending it again reuses the same key and input, returns the saved adjustment, and adds nothing.
    const retry = reloaded.prepare(55, reason);
    expect(retry).toEqual(input);
    expect(await learner.ok("/learning/adjust", retry)).toEqual({ adjustment: saved[1]!.adjustment });
    reloaded.finish(retry.adjustmentKey);
    expect(reloaded.read()).toBeNull();
    expect(await adjustments()).toEqual(saved);
    const data = await read(), rows = (data.explanation.changes as Change[]).filter((change) => change.kind === "ADJUSTMENT");
    expect(rows.map((row) => [row.source, row.after, row.reason])).toEqual([[saved[0]!.adjustment, 40, saved[0]!.reason], [saved[1]!.adjustment, 55, reason]]);
    expect(data.estimate.value).toBeCloseTo(55, 3);
  }, 60_000);

  test("Several attachments: each attached photo is listed in the sent message", async () => {
    // The learner uploads three photos for one answer, as the composer does, then removes the second before sending.
    const uploaded: string[] = [];
    for (const name of ["page-1.png", "page-2.png", "page-3.png"]) uploaded.push(await learner.upload(course, `My work: ${name}`, photo(name)));
    const [first, removed, third] = uploaded;
    const { task } = await learner.ok("/learning/task", { skill });
    await learner.ok("/learning/respond", { studySession: task, text: "My two pages of working.", attachments: [first, third], dialogueLength: 0 });

    const session = (await read()).sessions.find((item: { session: string }) => item.session === task);
    // One learner turn holds both photos, in the order attached. The removed photo was never sent.
    expect(session.dialogue).toHaveLength(1);
    expect(session.dialogue[0].turn).toMatchObject({ speaker: "LEARNER", text: "My two pages of working." });
    expect(session.dialogue[0].turn.media.map((file: { name: string; mediaType: string }) => [file.name, file.mediaType])).toEqual([["page-1.png", "image/png"], ["page-3.png", "image/png"]]);
    // The removed photo is still one of the learner's saved materials, but it is in no message.
    expect((await learner.ok("/courses/materials/read", { material: removed })).title).toBe("My work: page-2.png");
    expect(JSON.stringify(session.dialogue)).not.toContain("page-2.png");
  }, 60_000);

  test("Several attachments: the server refuses an attachment that is not the learner's own material, as today", async () => {
    const { course: theirs } = await other.ok("/courses/create", { title: "Their course" });
    const foreign = await other.upload(theirs, "My work: their-page.png", photo("their-page.png"));
    const own = await learner.upload(course, "My work: page-4.png", photo("page-4.png"));
    const before = await read(), session = before.sessions.find((item: { status: string; task: unknown }) => item.status === "OPEN" && item.task);

    const refused = await learner.post("/learning/respond", { studySession: session.session, text: "One more page.", attachments: [own, foreign], dialogueLength: session.dialogue.length });
    expect(refused).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: RESPOND_DECLINED } });
    // The page shows the server's specific reason.
    expect(failureText(refused.body)).toBe(RESPOND_DECLINED);
    // Nothing was saved.
    expect((await read()).sessions.find((item: { session: string }) => item.session === session.session).dialogue).toEqual(session.dialogue);
  }, 60_000);

  test("Opening a source shows the text at the cited location and names the file and location as the labels do today (\"Lecture 4 · Page 1\").", async () => {
    const { lesson } = await learner.ok("/learning/lesson", { skill, request: "Explain why the inner dimensions must match." });
    const session = (await read()).sessions.find((item: { session: string }) => item.session === lesson);
    const [citation] = session.citations as { material: string; location: string }[];
    expect(citation!.material).toBe(lessonMaterial);

    // The existing course read returns the passage saved at the cited location.
    const material = await learner.ok("/courses/materials/read", { material: citation!.material });
    const passages = material.originals.flatMap((file: { renditions: { kind: string; location: string; text?: string }[] }) => file.renditions.filter((part) => part.location === citation!.location));
    expect(passages).toEqual([{ kind: "TEXT", location: citation!.location, text: LESSON_TEXT }]);
    // The page labels the passage with the material's title and the place in it.
    expect(sourceLabel(citation!.location, material.title)).toBe("Matrix multiplication · Lines 1–2");
    // Another learner cannot read the passage, and the refusal says so (Learning.md, "Refusal sentences").
    expect(await other.post("/courses/materials/read", { material: citation!.material }))
      .toEqual({ status: 403, body: { error: "FORBIDDEN", detail: "This material is not available in this course. Reload the page to see its materials." } });
  }, 60_000);

  test("If the location is an image, show the image.", async () => {
    const whiteboard = await learner.upload(course, "Whiteboard", photo("whiteboard.png"));
    const { skill: reading } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material: whiteboard, title: "Read the whiteboard", outcome: "Read a worked product", gate: "Explain each step" });
    await learner.ok("/courses/skills/confirm", { skill: reading });
    const { lesson } = await learner.ok("/learning/lesson", { skill: reading, request: "Walk me through the whiteboard." });
    const session = (await learner.ok("/learning/read", { skill: reading })).sessions.find((item: { session: string }) => item.session === lesson);
    const [citation] = session.citations as { material: string; location: string }[];
    expect(citation!.material).toBe(whiteboard);
    expect(sourceLabel(citation!.location, "Whiteboard")).toBe("Whiteboard · Image");

    // The cited location is an image rendition, and the host download returns that exact image to its owner.
    const material = await learner.ok("/courses/materials/read", { material: whiteboard });
    const parts = material.originals.flatMap((file: { renditions: { kind: string; location: string; file?: string; mediaType?: string }[] }) => file.renditions.filter((part) => part.location === citation!.location));
    expect(parts).toEqual([{ kind: "IMAGE", location: citation!.location, file: expect.any(String), mediaType: "image/png" }]);
    const image = await learner.download({ material: whiteboard, file: parts[0].file });
    expect(image.status).toBe(200);
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(PNG);
    // Nobody else can load it, even with the exact references.
    expect((await other.download({ material: whiteboard, file: parts[0].file })).status).toBe(403);
    expect((await app.browser().download({ material: whiteboard, file: parts[0].file })).status).toBe(401);
  }, 60_000);

  test("Every new endpoint checks the session and ownership; another learner cannot adjust or read another's estimate.", async () => {
    const at = new Date(), before = await explain(at), saved = await adjustments(), estimate = (await read()).estimate;

    const attempt = { skill, adjustmentKey: crypto.randomUUID(), value: 99, reason: "I am sure they know this." };
    const refused = await other.post("/learning/adjust", attempt);
    expect(refused).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: UNAVAILABLE_SKILL } });
    // The page shows the specific reason, which does not reveal whether the skill exists.
    expect(failureText(refused.body)).toBe(UNAVAILABLE_SKILL);
    // The other learner cannot read the estimate either.
    expect(await other.post("/learning/read", { skill })).toEqual({ status: 400, body: { error: "INVALID_REQUEST" } });
    // Without a session, nothing is adjusted.
    expect((await app.browser().post("/learning/adjust", attempt)).status).toBe(401);

    // Nothing changed for the owner, and no track was made for the other learner.
    expect(await adjustments()).toEqual(saved);
    expect(await explain(at)).toEqual(before);
    expect((await read()).estimate.value).toBeCloseTo(estimate.value, 3);
    expect(await app.concepts.MasteryEstimating._tracks({ learner: outsider, subject: skill })).toEqual([]);
  }, 60_000);
});
