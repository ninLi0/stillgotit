import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { createRuntime } from "../../src/host/runtime.ts";
import { MemoryProvider } from "../../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";
import { pdf, png } from "../fixtures/office.ts";
import type { Gemini, GeminiPart } from "../../src/host/gemini.ts";
import type { ExtractContext, ExtractedRow } from "../../src/tutor-types.ts";
import type { User } from "../../src/concepts/Registering/Registering.ts";
import { refusalDetail } from "../../src/host/http-policy.ts";

/*
 * The journey in the graded-import brief, end to end through HTTP. One learner imports a returned midterm into a course with two
 * confirmed skills; then a classmate tries the same graded work. The harness follows tests/Importing.http.test.ts, with one change:
 * the canned answers come from a fake AI provider behind the host's own tutor, so the host reads the retained files, sends them, and
 * validates every answer as it does in production. The tests run in order and share the journey's state. Each test's name is the
 * brief sentence it proves.
 */

const ORIGIN = "http://localhost:5173", DAY = 86_400_000, ZONE = "America/New_York", LIMIT = 60_000;
const SENTENCE = "Choose graded work that you imported into one of your courses.";
/** The skill read's answer for another learner's skill (Courses.md, "Course and skill refusals"). */
const SKILL_UNAVAILABLE = { status: 400, body: { error: "INVALID_REQUEST", detail: "This skill is not available. Reload the page to see your skills." } };
// A refusal whose design gives a sentence now carries it to the browser (host pass, D31).
const declined = (code: string) => ({ status: 400, body: { error: "INVALID_REQUEST", detail: refusalDetail("/courses/graded/confirm", code) } });
const FORBIDDEN = { status: 403, body: { error: "FORBIDDEN", detail: SENTENCE } };
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

type ProviderCall = { parts: GeminiPart[]; schema: { properties?: Record<string, unknown> } };
const textOf = (part: GeminiPart | undefined) => part && "text" in part ? part.text : "";

async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [], calls: ProviderCall[] = [];
  let extraction: (context: ExtractContext) => unknown = () => ({ rows: [] });
  // Only the provider's reply is canned. An extraction reads the offered skills from the request's last part; a lesson cites the text of its first source.
  const gemini = {
    status: () => ({ available: true, reason: "" }),
    json: async (_instructions: string, parts: GeminiPart[], schema: ProviderCall["schema"]) => {
      calls.push({ parts, schema });
      const properties = schema.properties ?? {};
      if (properties.rows) return extraction(JSON.parse(textOf(parts.at(-1))) as ExtractContext);
      if (properties.explanation) {
        const { material } = JSON.parse(textOf(parts[0])) as { material: string };
        return { explanation: "Each entry pairs a row of the first matrix with a column of the second, so the order of the factors matters.", citations: [{ material, location: "content" }] };
      }
      throw new Error("This scenario asks the tutor only to read graded work and to teach one lesson.");
    },
  } as unknown as Gemini;
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, gemini });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  function browser() {
    const jar = new Map<string, string>();
    async function send(path: string, body: Record<string, unknown> | FormData) {
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: body instanceof FormData ? body : JSON.stringify(body) }));
      for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
      return response;
    }
    async function post(path: string, body: Record<string, unknown> | FormData = {}) {
      const response = await send(path, body), payload = await response.json();
      return { status: response.status, body: payload.data ?? payload };
    }
    async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
    /** Opens one retained original, as the library's file view does. */
    async function download(material: string, file: string) {
      const response = await send("/courses/materials/file", { material, file });
      expect(response.status).toBe(200);
      return new Uint8Array(await response.arrayBuffer());
    }
    async function signIn(name: string) { const start = await ok("/auth/commons/start"); await ok("/auth/commons/finish", provider.approve(start.address, { subject: name, username: name })); const identity = await ok("/auth/commons/resume"); owners.push(identity.user); return identity as { user: User }; }
    return { post, ok, download, signIn };
  }
  return { browser, runtime, calls, extract: (answer: (context: ExtractContext) => unknown) => { extraction = answer; } };
}
type Browser = ReturnType<Awaited<ReturnType<typeof setup>>["browser"]>;

function upload(course: string, title: string, files: File[]) {
  const form = new FormData(); form.set("course", course); form.set("title", title); form.set("requestId", crypto.randomUUID());
  for (const file of files) form.append("files", file);
  return form;
}
const notesFile = (name: string, text: string) => new File([text], name, { type: "text/markdown" });
async function confirmedSkill(learner: Browser, unit: string, material: string, draft: { title: string; outcome: string; gate: string }) {
  const { skill } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, ...draft });
  await learner.ok("/courses/skills/confirm", { skill });
  return skill as string;
}

const PRODUCTS = { title: "Products", outcome: "Multiply matrices", gate: "Two products and why" };
const DIMENSIONS = { title: "Dimensions", outcome: "Check matrix sizes before multiplying", gate: "Three pairs of sizes and why" };
/** The returned midterm: a PDF with a text layer and a photo of one page. */
const PAPER = pdf(["Question 1   5/5   Correct.", "Question 2(b)   6/10   You gave the size of AB as 3x2.", "Bonus   1/2"]) as Uint8Array<ArrayBuffer>;
const PHOTO = png as Uint8Array<ArrayBuffer>;

/** The tutor's reading of the midterm, one row per marked question in paper order. */
function midterm({ skills }: ExtractContext) {
  const id = (title: string) => skills.find((skill) => skill.title === title)?.skill ?? "";
  return { rows: [
    { label: "Question 1", mark: "5/5", feedback: "Correct.", excerpt: "AB = [[4,4],[10,8]]", skill: id("Products"), result: "INDEPENDENT",
      rationale: "Every entry is right and the factors are in the right order." },
    { label: "Question 2(b)", mark: "6/10", feedback: "You found that AB is defined, but gave its size as 3x2.", excerpt: "A is 2x3 and B is 3x2, so AB is 3x2.",
      skill: id("Dimensions"), result: "GAP", rationale: "The answer misreads which dimensions give the size of the product." },
    { label: "Bonus", mark: "1/2", feedback: "", excerpt: "", skill: "", result: "UNCERTAIN", rationale: "No confirmed skill in this course covers eigenvalues." },
  ] };
}
/** One question as the import screen sends it: the extracted values, the tutor's proposal, and the learner's skill and result. */
const confirmRow = (row: ExtractedRow, choice: { skill?: string; result?: ExtractedRow["result"] } = {}) => ({ label: row.label, mark: row.mark, feedback: row.feedback,
  excerpt: row.excerpt, rationale: row.rationale, proposedResult: row.result, skill: choice.skill ?? row.skill, result: choice.result ?? row.result });

/** A calendar date written YYYY-MM-DD, moved by whole days. */
const shift = (day: string, days: number) => new Date(Date.parse(`${day}T12:00:00Z`) + days * DAY).toISOString().slice(0, 10);
const newYorkDate = (at: number | string) => new Date(at).toLocaleDateString("en-CA", { timeZone: ZONE });
/** MasteryEstimating's decay: time without practice halves an estimate every 60 days. */
const decayed = (value: number, from: string, to: number) => value * 2 ** (-(to - Date.parse(from)) / DAY / 60);

type Judgment = { judgment: string; revision: number; result: string; gateMet: boolean; rationale: string; origin: string };
type CaseData = { case: string; author: string; subject: string; task: string | null; help: string; fresh: boolean; performedAt: string; judgment: Judgment;
  history: Judgment[]; clarifications: unknown[]; work: { question: string; criteria: string; response: unknown; originalMark: string; originalFeedback: string } };
type SkillRead = { cases: CaseData[]; track: { inputs: Record<string, unknown>[] } | null; estimate: { value: number; basis: string; ready: boolean } | null };
type ImportedRow = { case: string; skill: string; label: string; mark: string; feedback: string; performedAt: string; result: string };

// The journey's state, filled in as the tests run.
let app!: Awaited<ReturnType<typeof setup>>, learner!: Browser, classmate!: Browser, user!: User, classmateUser!: User, session!: string;
let course!: string, notes!: string, productsUnit!: string, products!: string, dimensions!: string, outside!: string;
let graded!: string, today!: string, performedOn!: string, rows!: ExtractedRow[], first!: string, second!: string;
let beforeImport!: { products: SkillRead; dimensions: SkillRead }, betweenImports!: SkillRead;

const readSkill = async (skill: string) => await learner.ok("/learning/read", { skill }) as SkillRead;
const readImports = async () => await learner.ok("/courses/graded/read", { material: graded }) as { imported: ImportedRow[]; today: string };
/** Everything an import could change, as the learner reads it: this work's imports, and each skill's cases and mastery inputs. */
async function saved() {
  const skill = async (id: string) => { const { cases, track } = await readSkill(id); return { cases, inputs: track?.inputs ?? null }; };
  return { imports: (await readImports()).imported, products: await skill(products), dimensions: await skill(dimensions), outside: await skill(outside) };
}
/** The same request through the host's native gateway, which keeps the refusal's own code. */
const native = (path: string, body: Record<string, unknown>) => app.runtime.gateway.invoke(path, { session, ...body }, { timeoutMs: 5000 });
const refused = (value: string) => { const detail = refusalDetail("/courses/graded/confirm", value); return detail === undefined ? ({ ok: false, error: { kind: "domain", value } } as const) : ({ ok: false, error: { kind: "domain", value, detail } } as const); };

beforeAll(async () => {
  app = await setup();
  learner = app.browser();
  ({ user } = await learner.signIn("midterm-learner"));
  ({ course } = await learner.ok("/courses/create", { title: "Linear algebra" }));
  ({ material: notes } = await learner.ok("/courses/materials/add", upload(course, "Matrix multiplication",
    [notesFile("matrices.md", "# Matrix multiplication\nMultiply rows by columns. Inner dimensions must match. AB has the rows of A and the columns of B.")])));
  ({ unit: productsUnit } = await learner.ok("/courses/units/add", { course, title: "Products" }));
  products = await confirmedSkill(learner, productsUnit, notes, PRODUCTS);
  const { unit: sizes } = await learner.ok("/courses/units/add", { course, title: "Dimensions" });
  dimensions = await confirmedSkill(learner, sizes, notes, DIMENSIONS);
  // Another course of the same learner. Its confirmed skill lies outside the graded work's course.
  const { course: physics } = await learner.ok("/courses/create", { title: "Physics" });
  const { material: vectors } = await learner.ok("/courses/materials/add", upload(physics, "Vectors", [notesFile("vectors.md", "# Vectors\nAdd vectors tip to tail.")]));
  const { unit: motion } = await learner.ok("/courses/units/add", { course: physics, title: "Vectors" });
  outside = await confirmedSkill(learner, motion, vectors, { title: "Add vectors", outcome: "Add two vectors", gate: "Two sums and why" });
  // The learner reports a starting confidence for both skills, so each has an estimate before any graded evidence.
  for (const skill of [products, dimensions]) await learner.ok("/learning/confidence", { skill, confidence: 50 });
  const signedIn = await app.runtime.application.concepts.Sessioning.start({ subject: user });
  if ("error" in signedIn) throw new Error("The native session was refused");
  session = signedIn.session as string;
  app.extract(midterm);
}, LIMIT);

describe("Import graded coursework as evidence", () => {
  test("Upload through the existing material pipeline (`/api/courses/materials/add` and the host importer), so the file is retained, its text and images are available to the tutor, and the learner can view it.", async () => {
    ({ material: graded } = await learner.ok("/courses/materials/add", upload(course, "Graded work: Midterm 1", [
      new File([PAPER], "midterm-1.pdf", { type: "application/pdf" }), new File([PHOTO], "page-3.png", { type: "image/png" })])));
    const read = await learner.ok("/courses/materials/read", { material: graded }) as { title: string; origin: string; content: string; originals: { file: string; name: string; mediaType: string }[] };
    expect(read).toMatchObject({ title: "Graded work: Midterm 1", origin: "COURSE" });
    expect(read.originals.map(({ name, mediaType }) => ({ name, mediaType }))).toEqual([{ name: "midterm-1.pdf", mediaType: "application/pdf" }, { name: "page-3.png", mediaType: "image/png" }]);
    // The PDF's text layer is read, and the learner can open each original exactly as uploaded.
    expect(read.content).toContain("Question 2(b)");
    expect(await learner.download(graded, read.originals[0]!.file)).toEqual(PAPER);
    expect(await learner.download(graded, read.originals[1]!.file)).toEqual(PHOTO);
  }, LIMIT);

  test("The material is marked as graded work in its title or locator so the library shows it as such.", async () => {
    const { materials } = await learner.ok("/courses/read", { course }) as { materials: { material: string; title: string }[] };
    expect(materials.map(({ material, title }) => ({ material, title }))).toEqual(expect.arrayContaining([
      { material: notes, title: "Matrix multiplication" }, { material: graded, title: "Graded work: Midterm 1" }]));
    // The title alone makes it graded work: the graded endpoints open it and refuse the ungraded notes.
    const earlier = newYorkDate(Date.now()), opened = await readImports();
    expect(opened.imported).toEqual([]);
    expect([earlier, newYorkDate(Date.now())]).toContain(opened.today);
    today = opened.today;
    expect(await learner.post("/courses/graded/read", { material: notes })).toEqual(FORBIDDEN);
  }, LIMIT);

  test("The tutor reads each question's mark and feedback and proposes which course skill it shows and how well.", async () => {
    const asked = app.calls.length;
    ({ rows } = await learner.ok("/courses/graded/extract", { material: graded }) as { rows: ExtractedRow[] });
    expect(app.calls.length).toBe(asked + 1);
    // The tutor is offered exactly this course's confirmed skills, and its rows come back in paper order, exactly as it read them.
    const offered = JSON.parse(textOf(app.calls.at(-1)!.parts.at(-1))) as ExtractContext;
    expect(offered.skills).toEqual([{ skill: products, ...PRODUCTS }, { skill: dimensions, ...DIMENSIONS }].sort((a, b) => a.skill < b.skill ? -1 : 1));
    expect(rows).toEqual(midterm(offered).rows as ExtractedRow[]);
    expect(rows.map(({ label, mark, feedback, skill, result }) => ({ label, mark, feedback, skill, result }))).toEqual([
      { label: "Question 1", mark: "5/5", feedback: "Correct.", skill: products, result: "INDEPENDENT" },
      { label: "Question 2(b)", mark: "6/10", feedback: "You found that AB is defined, but gave its size as 3x2.", skill: dimensions, result: "GAP" },
      { label: "Bonus", mark: "1/2", feedback: "", skill: "", result: "UNCERTAIN" }]);
    // Reading the marks saves nothing.
    expect((await readImports()).imported).toEqual([]);
  }, LIMIT);

  test("The tutor request sends the retained file (PDF or images) inline as the other kinds do, so handwriting and marks in photos can be read.", async () => {
    const request = app.calls.filter((call) => call.schema.properties?.rows).at(-1)!;
    const inline = request.parts.flatMap((part) => "inlineData" in part ? [part.inlineData] : []);
    expect(inline).toContainEqual({ mimeType: "application/pdf", data: Buffer.from(PAPER).toString("base64") });
    expect(inline).toContainEqual({ mimeType: "image/png", data: Buffer.from(PHOTO).toString("base64") });
    // The graded work is the only source. Its text goes with it, and no other course material is sent.
    const source = JSON.parse(textOf(request.parts[0])) as { material: string; title: string; content: string };
    expect(source).toMatchObject({ material: graded, title: "Graded work: Midterm 1" });
    expect(source.content).toContain("Question 1");
    expect(JSON.stringify(request.parts)).not.toContain(notes);
  }, LIMIT);

  test("The learner checks and edits the mapping, then confirms.", async () => {
    performedOn = shift(today, -3);
    beforeImport = { products: await readSkill(products), dimensions: await readSkill(dimensions) };
    const confirm = async (row: ReturnType<typeof confirmRow>) => await learner.ok("/courses/graded/confirm", { material: graded, performedOn, outsideHelp: false, row }) as { case: string };
    // The screen sends the checked rows that are mapped to a skill, one per request, in paper order. The bonus has no skill, so it is not sent.
    const answer = await confirm(confirmRow(rows[0]!));
    expect(Object.keys(answer)).toEqual(["case"]);
    first = answer.case;
    // When the first answer arrives, that question is imported and the other skill is untouched.
    expect((await readImports()).imported.map(({ case: id, label }) => ({ case: id, label }))).toEqual([{ case: first, label: "Question 1" }]);
    betweenImports = await readSkill(dimensions);
    // The learner changed the second question's result from the tutor's Gap to Slip.
    second = (await confirm(confirmRow(rows[1]!, { result: "SLIP" }))).case;
    expect(second).not.toBe(first);
    expect((await readImports()).imported.map(({ label }) => label).sort()).toEqual(["Question 1", "Question 2(b)"]);
  }, LIMIT);

  test("Skills without evidence keep their estimates.", async () => {
    const before = beforeImport.dimensions.estimate!;
    expect(before.value).toBeCloseTo(50, 2);
    expect(betweenImports.cases).toEqual([]);
    expect(betweenImports.track?.inputs).toEqual([]);
    expect(betweenImports.estimate?.value).toBeCloseTo(before.value, 3);
    expect(betweenImports.estimate?.basis).toContain("No scored evidence yet");
  }, LIMIT);

  test("`fresh` is true (new problems); `gateMet` is false (an import cannot show the complete demonstration gate); `performedAt` is the date the learner entered; `mark` and `feedback` are the original grader's.", async () => {
    const { originals } = await learner.ok("/courses/materials/read", { material: graded });
    const expected = [
      { skill: products, assessment: first, row: rows[0]!, draft: PRODUCTS, result: "INDEPENDENT",
        rationale: `You kept the tutor's proposed result, Independent, when importing graded work. Tutor's reason: ${rows[0]!.rationale}` },
      { skill: dimensions, assessment: second, row: rows[1]!, draft: DIMENSIONS, result: "SLIP",
        rationale: `You changed the tutor's proposed result from Gap to Slip when importing graded work. Tutor's reason for Gap: ${rows[1]!.rationale}` },
    ];
    for (const { skill, assessment, row, draft, result, rationale } of expected) {
      const { cases } = await readSkill(skill);
      expect(cases).toHaveLength(1);
      expect(cases[0]).toMatchObject({ case: assessment, author: user, subject: skill, task: null, help: "NONE", fresh: true,
        work: { question: row.label, criteria: `${draft.outcome}\nFull demonstration gate: ${draft.gate}`, originalMark: row.mark, originalFeedback: row.feedback,
          response: { text: row.excerpt, attachments: originals, citations: [{ material: graded }] } },
        judgment: { revision: 1, result, gateMet: false, origin: "AI", rationale } });
      expect(cases[0]!.history).toHaveLength(1);
      // The performance instant is the start of the entered date in New York.
      expect(newYorkDate(cases[0]!.performedAt)).toBe(performedOn);
      expect(newYorkDate(Date.parse(cases[0]!.performedAt) - 1)).toBe(shift(performedOn, -1));
    }
  }, LIMIT);

  test("The original marks are stored unchanged and shown as the grader gave them.", async () => {
    const { imported } = await readImports(), performedAt = (await readSkill(products)).cases[0]!.performedAt;
    expect(imported).toEqual([
      { case: first, skill: products, label: "Question 1", mark: "5/5", feedback: "Correct.", performedAt, result: "INDEPENDENT" },
      { case: second, skill: dimensions, label: "Question 2(b)", mark: "6/10", feedback: "You found that AB is defined, but gave its size as 3x2.", performedAt, result: "SLIP" },
    ].sort((a, b) => a.case < b.case ? -1 : 1));
  }, LIMIT);

  test("Each confirmed question becomes an imported assessment case whose judgment updates that skill's mastery as of the performance date.", async () => {
    // MasteryEstimating replays a track from its oldest informative evidence when that is older than the track's start. The reported
    // confidence, 50, is therefore the estimate on the performance date. The result moves it there (Independent work without the full
    // gate raises it to 60; a Slip lowers it by 5), and the days since then without practice lower it with a 60-day half-life.
    const expected = [
      { skill: products, assessment: first, row: rows[0]!, signal: "INDEPENDENT", moved: 60 },
      { skill: dimensions, assessment: second, row: rows[1]!, signal: "SLIP", moved: 45 },
    ];
    for (const { skill, assessment, row, signal, moved } of expected) {
      expect(beforeImport[skill === products ? "products" : "dimensions"].estimate?.value).toBeCloseTo(50, 2);
      const read = await readSkill(skill), at = Date.now(), performedAt = read.cases[0]!.performedAt;
      expect(read.cases).toMatchObject([{ case: assessment, task: null, work: { originalMark: row.mark, originalFeedback: row.feedback } }]);
      expect(newYorkDate(performedAt)).toBe(performedOn);
      expect(read.track?.inputs).toMatchObject([{ evidence: assessment, revision: 1, performedAt, signal, fresh: true, gateMet: false }]);
      expect(read.estimate?.basis).toContain("1 assessed attempt(s) affect this estimate.");
      expect(read.estimate?.value).toBeCloseTo(decayed(moved, performedAt, at), 2);
    }
  }, LIMIT);

  test("The `sourceKey` identifies the material, question, and skill, so a repeat confirm is refused by the concept rather than duplicated.", async () => {
    const before = await saved();
    const repeat = { material: graded, performedOn, outsideHelp: false, row: confirmRow(rows[0]!) };
    expect(await learner.post("/courses/graded/confirm", repeat)).toEqual(declined("GRADED_SOURCE_USED"));
    expect(await native("/courses/graded/confirm", repeat)).toEqual(refused("GRADED_SOURCE_USED"));
    // The same question with other spacing, another date, and another result is still the same question.
    const respaced = { ...repeat, performedOn: shift(performedOn, -1), row: { ...repeat.row, label: "  Question 1 ", result: "SLIP" } };
    expect(await native("/courses/graded/confirm", respaced)).toEqual(refused("GRADED_SOURCE_USED"));
    expect(await saved()).toEqual(before);
    const [kept] = await app.runtime.application.concepts.AssessmentReviewing._case({ case: first as never });
    expect(kept?.sourceKey).toBe(`graded${JSON.stringify([graded, "Question 1", products])}`);
  }, LIMIT);

  test("The performance date is required and may not be after today.", async () => {
    const before = await saved();
    // The learner maps the bonus question to Products, then leaves the date blank or picks tomorrow.
    for (const [date, code] of [["", "GRADED_DATE_INVALID"], [shift(today, 1), "GRADED_DATE_FUTURE"]] as const) {
      const body = { material: graded, performedOn: date, outsideHelp: false, row: confirmRow(rows[2]!, { skill: products }) };
      expect(await learner.post("/courses/graded/confirm", body), code).toEqual(declined(code));
      expect(await native("/courses/graded/confirm", body), code).toEqual(refused(code));
    }
    expect(await saved()).toEqual(before);
  }, LIMIT);

  test("At least one row must be mapped to a skill to confirm.", async () => {
    const before = await saved();
    const body = { material: graded, performedOn, outsideHelp: false, row: confirmRow(rows[2]!) };
    expect(body.row.skill).toBe("");
    expect(await learner.post("/courses/graded/confirm", body)).toEqual(declined("GRADED_ROW_UNMAPPED"));
    expect(await native("/courses/graded/confirm", body)).toEqual(refused("GRADED_ROW_UNMAPPED"));
    expect(await saved()).toEqual(before);
  }, LIMIT);

  test("A result of INDEPENDENT is allowed only when the learner declared no help; otherwise the strongest result is SUPPORTED.", async () => {
    const before = await saved();
    const body = { material: graded, performedOn, outsideHelp: true, row: confirmRow(rows[2]!, { skill: products, result: "INDEPENDENT" }) };
    expect(await learner.post("/courses/graded/confirm", body)).toEqual(declined("GRADED_HELP_CONFLICT"));
    expect(await native("/courses/graded/confirm", body)).toEqual(refused("GRADED_HELP_CONFLICT"));
    expect(await saved()).toEqual(before);
  }, LIMIT);

  test("the proposed skill (one of the course's confirmed skills, or none)", async () => {
    const before = await saved();
    // A confirmed skill of the learner's own Physics course is outside the graded work's course.
    const body = { material: graded, performedOn, outsideHelp: false, row: confirmRow(rows[2]!, { skill: outside }) };
    expect(await learner.post("/courses/graded/confirm", body)).toEqual(declined("GRADED_SKILL_UNAVAILABLE"));
    expect(await native("/courses/graded/confirm", body)).toEqual(refused("GRADED_SKILL_UNAVAILABLE"));
    expect(await saved()).toEqual(before);
  }, LIMIT);

  test("Recommendation: keep it out of lessons; it is evidence, not course material.", async () => {
    const asked = app.calls.length, { skills } = await learner.ok("/courses/read", { course });
    const draft = { title: "Order of factors", outcome: "Explain why AB and BA differ", gate: "Two pairs and why" };
    // Finding skills in the graded work and proposing a skill from it are refused before the tutor is asked.
    const attempts: [string, Record<string, unknown>][] = [["/courses/skills/suggest", { material: graded }],
      ["/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit: productsUnit, material: graded, ...draft }]];
    for (const [path, body] of attempts) {
      expect(await learner.post(path, body), path).toEqual(declined("GRADED_MATERIAL_NOT_SOURCE"));
      expect(await native(path, body), path).toEqual(refused("GRADED_MATERIAL_NOT_SOURCE"));
    }
    expect((await learner.ok("/courses/read", { course })).skills).toEqual(skills);
    // A draft from the notes cannot be moved onto the graded work either.
    const { skill: drafted } = await learner.ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit: productsUnit, material: notes, ...draft });
    const edit = { skill: drafted, unit: productsUnit, material: graded, ...draft, title: "Order matters" };
    expect(await learner.post("/courses/skills/edit", edit)).toEqual(declined("GRADED_MATERIAL_NOT_SOURCE"));
    expect(await native("/courses/skills/edit", edit)).toEqual(refused("GRADED_MATERIAL_NOT_SOURCE"));
    expect(await app.runtime.application.concepts.SkillMapping._materials({ skill: drafted })).toEqual([{ material: notes }]);
    expect(((await learner.ok("/courses/read", { course })).skills as { skill: string; title: string }[]).find((row) => row.skill === drafted)?.title).toBe(draft.title);
    expect(app.calls.length).toBe(asked);
    // A lesson on Products teaches from the course notes and never sends the graded work.
    await learner.ok("/learning/lesson", { skill: products, request: "Explain why the order of the factors matters." });
    expect(app.calls.length).toBe(asked + 1);
    const lesson = JSON.stringify(app.calls.at(-1)!.parts);
    expect(lesson).toContain(notes);
    expect(lesson).not.toContain(graded);
  }, LIMIT);

  test("Corrections use the existing regrade and manual-correction flow.", async () => {
    const current = (await readSkill(dimensions)).cases[0]!;
    const claim = { case: second, basedOn: current.judgment.judgment, result: "INDEPENDENT", reason: "The grader misread my answer: I wrote that AB is 2x2." };
    // Manual correction. Claiming that the import met the full demonstration gate is refused and changes nothing.
    expect(await learner.post("/learning/correct", { ...claim, gateMet: true })).toEqual(declined("IMPORTED_GATE_UNAVAILABLE"));
    expect(await native("/learning/correct", { ...claim, gateMet: true })).toEqual(refused("IMPORTED_GATE_UNAVAILABLE"));
    expect((await readSkill(dimensions)).cases[0]!.history).toHaveLength(1);
    // The same correction with the gate kept false is accepted. It becomes the effective judgment and replaces the import's mastery input.
    const { judgment } = await learner.ok("/learning/correct", { ...claim, gateMet: false }) as { judgment: string };
    const read = await readSkill(dimensions);
    expect(read.cases[0]).toMatchObject({ judgment: { judgment, revision: 2, result: "INDEPENDENT", gateMet: false, origin: "MANUAL", rationale: claim.reason },
      work: { originalMark: "6/10", originalFeedback: rows[1]!.feedback } });
    expect(read.cases[0]!.history.map(({ revision, result, gateMet, origin }) => ({ revision, result, gateMet, origin }))).toEqual([
      { revision: 1, result: "SLIP", gateMet: false, origin: "AI" }, { revision: 2, result: "INDEPENDENT", gateMet: false, origin: "MANUAL" }]);
    expect(read.track?.inputs).toMatchObject([{ evidence: second, revision: 2, signal: "INDEPENDENT", gateMet: false, performedAt: current.performedAt }]);
    // The grader's mark stays as given beside the corrected result.
    expect((await readImports()).imported.find((row) => row.case === second)).toMatchObject({ mark: "6/10", result: "INDEPENDENT" });
    // Regrade. Importing.md: an imported case has no practice task to regrade, so Regrade refuses it before any clarification or tutor request.
    const asked = app.calls.length, regrade = { case: second, basedOn: judgment, reason: "Please look at my final size again." };
    expect(await learner.post("/learning/regrade", regrade)).toEqual(declined("REGRADE_IMPORTED_UNAVAILABLE"));
    expect(await native("/learning/regrade", regrade)).toEqual(refused("REGRADE_IMPORTED_UNAVAILABLE"));
    expect(app.calls.length).toBe(asked);
    const after = (await readSkill(dimensions)).cases[0]!;
    expect(after.clarifications).toEqual([]);
    expect(after.history).toHaveLength(2);
  }, LIMIT);

  test("Every endpoint checks the session, course ownership, and that the material belongs to the learner and course.", async () => {
    classmate = app.browser();
    ({ user: classmateUser } = await classmate.signIn("classmate"));
    const before = await saved(), asked = app.calls.length;
    const confirm = { material: graded, performedOn, outsideHelp: false, row: confirmRow(rows[2]!, { skill: products }) };
    // Without a session, each graded endpoint is refused.
    const signedOut = app.browser();
    const attempts: [string, Record<string, unknown>][] = [["/courses/graded/extract", { material: graded }], ["/courses/graded/confirm", confirm], ["/courses/graded/read", { material: graded }]];
    for (const [path, body] of attempts) expect(await signedOut.post(path, body), path).toMatchObject({ status: 401, body: { error: "UNAUTHORIZED" } });
    // A classmate can neither have the tutor read this learner's graded work nor import a question from it, even into this learner's skill.
    expect(await classmate.post("/courses/graded/extract", { material: graded })).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SENTENCE } });
    expect(await classmate.post("/courses/graded/confirm", confirm)).toEqual({ status: 400, body: { error: "INVALID_REQUEST", detail: SENTENCE } });
    expect(app.calls.length).toBe(asked);
    expect(await saved()).toEqual(before);
    expect(await app.runtime.application.concepts.AssessmentReviewing._cases({ author: classmateUser, subject: products })).toEqual([]);
  }, LIMIT);

  test("Another learner's imports are never visible.", async () => {
    const before = await saved();
    expect(await classmate.post("/courses/graded/read", { material: graded })).toEqual(FORBIDDEN);
    // Nor are they visible through the skill page's read of this learner's skill.
    expect(await classmate.post("/learning/read", { skill: products })).toEqual(SKILL_UNAVAILABLE);
    expect(await saved()).toEqual(before);
    expect(before.imports).toHaveLength(2);
  }, LIMIT);
});
