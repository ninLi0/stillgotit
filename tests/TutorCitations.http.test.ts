import { afterAll, expect, spyOn, test } from "bun:test";
import { createRuntime } from "../src/host/runtime.ts";
import { MemoryProvider } from "../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import type { CourseTutor } from "../src/host/tutor.ts";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { openLesson } from "./fixtures/open-lesson.ts";
import { cannedTask } from "./fixtures/fake-gemini.ts";
const ORIGIN = "http://localhost:5173", cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

const TITLE = "Week 7 notes: vectors and span", FILE = "week7-notes.md";

// The harness of Learning.continue.http.test.ts, with a tutor that names the material the way Gemini 4 Argon did in the P5
// test: a practice task cites it by its file name (the browser fixture's canned task), and a lesson's opening by its title.
async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${crypto.randomUUID().replaceAll("-", "")}` });
  const provider = new MemoryProvider(), owners: string[] = [], cited: unknown[] = [];
  const tutor: Pick<CourseTutor, "generate" | "suggest"> = {
    suggest: async () => ({ unitTitle: "Vectors", skills: [] }),
    generate: async (_owner, sources, _instruction, _context, schema) => {
      const properties = schema.properties as Record<string, unknown>;
      if (properties.question) { const task = cannedTask(sources); cited.push(...task.citations); return task; }
      const citations = [{ material: sources[0]!.data.title, location: "content" }];
      cited.push(...citations);
      return properties.explanation ? { explanation: "Two vectors that are not parallel span a plane.", citations } : { text: "Yes, any two of them.", citations };
    },
  };
  const runtime = await createRuntime({ database: connection.db, provider, providerOrigin: "https://commons.example", publicOrigin: ORIGIN, tutor });
  cleanups.push(async () => { await runtime.gateway.beginDrain(); await connection.db.dropDatabase(); await connection.client.close();
    for (const owner of owners) await rm(resolve(".data/files", createHash("sha256").update(owner).digest("hex")), { recursive: true, force: true }); });
  const jar = new Map<string, string>();
  async function post(path: string, body: Record<string, unknown> | FormData = {}) {
    const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`, { method: "POST", headers: { Origin: ORIGIN,
      Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "), ...(body instanceof FormData ? {} : { "Content-Type": "application/json" }) }, body: body instanceof FormData ? body : JSON.stringify(body) }));
    for (const line of response.headers.getSetCookie()) { const [pair] = line.split(";"), index = pair!.indexOf("="); jar.set(pair!.slice(0, index), pair!.slice(index + 1)); }
    const payload = await response.json();
    return { status: response.status, body: payload.data ?? payload };
  }
  async function ok(path: string, body: Record<string, unknown> | FormData = {}) { const result = await post(path, body); expect(result, path).toMatchObject({ status: 200 }); return result.body; }
  const start = await ok("/auth/commons/start");
  await ok("/auth/commons/finish", provider.approve(start.address, { subject: "citer", username: "citer" }));
  owners.push((await ok("/auth/commons/resume")).user);
  return { ok, cited };
}

test("a practice task that names its material by file name, and a lesson that names it by title, are saved with the material's identity", async () => {
  const { ok, cited } = await setup();
  const { course } = await ok("/courses/create", { title: "Linear algebra" });
  const form = new FormData(); form.set("course", course); form.set("title", TITLE); form.set("requestId", crypto.randomUUID());
  form.append("files", new File(["# Vectors and span\nTwo vectors that are not parallel span a plane."], FILE, { type: "text/markdown" }));
  const { material } = await ok("/courses/materials/add", form);
  const { unit } = await ok("/courses/units/add", { course, title: "Vectors" });
  const { skill } = await ok("/courses/skills/propose", { proposalKey: crypto.randomUUID(), unit, material, title: "Span", outcome: "Decide what a set of vectors spans", gate: "Two fresh sets and why" });
  await ok("/courses/skills/confirm", { skill });
  await ok("/learning/confidence", { skill, confidence: 50 });

  const warnings: string[] = [], warn = spyOn(console, "warn").mockImplementation((line: string) => { warnings.push(line); });
  try {
    const { lesson } = await openLesson(ok, { skill, request: "Explain span." });
    const { task } = await ok("/learning/task", { skill });
    // The tutor wrote the title and the file name, never the identity; the location is the notes' first lines.
    const [byTitle, byFile] = cited as { material: string; location: string }[];
    expect(byTitle).toEqual({ material: TITLE, location: "content" });
    expect(byFile!.material).toBe(FILE);
    expect(byFile!.location).toMatch(/^[0-9a-f]{16}\/lines\/1-2$/);

    const { sessions } = await ok("/learning/read", { skill });
    const saved = (session: string) => sessions.find((row: { session: string }) => row.session === session).citations;
    expect(saved(lesson)).toEqual([{ material, location: "content" }]);
    expect(saved(task)).toEqual([{ material, location: byFile!.location }]);
    expect(warnings).toEqual(["Tutor citation named a source by its title; resolved to the material.", "Tutor citation named a source by its file name; resolved to the material."]);
  } finally { warn.mockRestore(); }
}, 60_000);
