import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { Material, MaterialData } from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import type { MediaValue } from "../src/concepts/GroundedTutoring/media.ts";
import { DiskStore } from "../src/host/file-store.ts";
import { DEFAULT_MODEL, Gemini, GeminiError, objectSchema } from "../src/host/gemini.ts";
import { MaterialFiles } from "../src/host/material-files.ts";
import { ProviderFiles, REUSE_MARGIN_MS } from "../src/host/provider-files.ts";
import { CourseTutor } from "../src/host/tutor.ts";
import { TutorFailures, tutorGenerator } from "../src/host/tutor-generation.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";
import { answer, fakeGemini, googleError, type FakeGeminiOptions } from "./fixtures/fake-gemini.ts";

const MB = 1024 * 1024, HOUR = 3600_000, KEY = "test-key-not-real";
const schema = objectSchema({ answer: { type: "string" } });
let connection: Awaited<ReturnType<typeof connectMongo>>, directory: string;
beforeAll(async () => {
  connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_${randomUUID().replaceAll("-", "")}` });
  directory = await mkdtemp(resolve(tmpdir(), "stillgotit-tutor-files-"));
});
afterAll(async () => {
  await connection?.db.dropDatabase(); await connection?.client.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

/** A tutor wired to a fake Gemini, a disk store, and a provider file store with its own clock. */
async function setup(options: FakeGeminiOptions = {}, timeoutMs?: number) {
  let now = new Date(Date.UTC(2026, 9, 23, 12));
  const clock = () => now;
  const google = fakeGemini({ now: clock, ...options });
  const gemini = new Gemini({ key: KEY, fetch: google.fetch, pollMs: 1 });
  const store = new DiskStore(resolve(directory, randomUUID())), files = new MaterialFiles(store);
  const name = `ProviderFiles_${randomUUID()}`;
  const providers = new ProviderFiles(connection.db, gemini, files, clock, name);
  const tutor = new CourseTutor(gemini, files, providers, timeoutMs);
  const records = connection.db.collection(`${name.toLowerCase()}.references`);
  const importKey = randomUUID();
  /** Retains a file for "sam" and returns its media value. */
  async function retain(name: string, size: number, mediaType: string, fill = 1): Promise<MediaValue> {
    const bytes = new Uint8Array(size).fill(fill), digest = new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
    const extension = name.slice(name.lastIndexOf(".")), file = `${importKey}/${digest}${extension}`;
    await store.put(files.storeKey("sam", file), bytes);
    const image = mediaType.startsWith("image/");
    return { file, name, mediaType, limitations: [], renditions: image ? [{ kind: "IMAGE", location: `k-${digest.slice(0, 6)}/image`, file, mediaType: mediaType as "image/png" }]
      : [{ kind: "TEXT", location: `k-${digest.slice(0, 6)}/page/1`, text: "Text" }] };
  }
  const source = (originals: MediaValue[], material = "m1"): { material: Material; data: MaterialData<string, string> } =>
    ({ material: material as Material, data: { owner: "sam", scope: "course", title: "Lecture notes", locator: "upload:1", content: "Text", origin: "COURSE", originals } });
  const ask = (...sources: ReturnType<typeof source>[]) => tutor.generate("sam", sources, "Explain.", { request: "Teach me" }, schema, [], { model: DEFAULT_MODEL, level: "MEDIUM" });
  const parts = (index = -1) => google.generations().at(index)!.body!.contents[0].parts as { text?: string; inlineData?: { mimeType: string }; fileData?: { mimeType: string; fileUri: string } }[];
  return { google, tutor, providers, records, retain, source, ask, parts, advance: (ms: number) => { now = new Date(now.getTime() + ms); } };
}

describe("Sending files to the tutor", () => {
  test("PDFs and images go inline within 15 MB each and 30 MB in total, and by Files API reference after that", async () => {
    const app = await setup();
    const files = [await app.retain("a.pdf", 10 * MB, "application/pdf", 1), await app.retain("b.png", 10 * MB, "image/png", 2),
      await app.retain("c.pdf", 10 * MB, "application/pdf", 3), await app.retain("d.jpg", 1 * MB, "image/jpeg", 4), await app.retain("big.pdf", 15 * MB + 1, "application/pdf", 5)];
    await app.ask(app.source(files));
    const attached = app.parts().filter((part) => part.inlineData || part.fileData);
    expect(attached.map((part) => part.inlineData ? `inline ${part.inlineData.mimeType}` : `reference ${part.fileData!.mimeType}`)).toEqual([
      "inline application/pdf", "inline image/png", "inline application/pdf", "reference image/jpeg", "reference application/pdf"]);
    expect(attached[3]!.fileData!.fileUri).toStartWith("https://generativelanguage.googleapis.com/v1beta/files/");
    const sent = JSON.parse(app.parts()[0]!.text!).sources.map((item: { sent: string }) => item.sent);
    expect(sent[3]).toBe("The image is attached by file reference.");
    expect(sent[4]).toBe("The original PDF is attached by file reference, so pages without selectable text can be read from it.");
    // Uploads carry the byte digest as their name, never the learner's file name.
    expect(app.google.uploads.map((file) => file.displayName)).toEqual([files[3]!.file.split("/")[1]!.split(".")[0], files[4]!.file.split("/")[1]!.split(".")[0]]);
    expect(JSON.stringify(app.google.calls.filter((call) => call.url.includes("/upload/")).map((call) => call.body))).not.toContain("big.pdf");
  });

  test("a saved reference is reused while at least one hour remains, and replaced after that", async () => {
    const app = await setup({ lifetimeMs: 48 * HOUR });
    const big = await app.retain("big.pdf", 16 * MB, "application/pdf");
    await app.ask(app.source([big]));
    const [record] = await app.records.find().toArray();
    expect(record).toMatchObject({ name: "files/file2", uri: "https://generativelanguage.googleapis.com/v1beta/files/file2", mediaType: "application/pdf",
      expiresAt: new Date(Date.UTC(2026, 9, 25, 12)), savedAt: new Date(Date.UTC(2026, 9, 23, 12)) });
    expect(record!._id).toEndWith(big.file.split("/")[1]);
    app.advance(47 * HOUR - 1);
    await app.ask(app.source([big]));
    expect(app.google.uploads).toHaveLength(1);
    expect(app.parts().find((part) => part.fileData)!.fileData!.fileUri).toBe(record!.uri);
    // Now less than one hour remains.
    app.advance(2);
    expect(REUSE_MARGIN_MS).toBe(HOUR);
    await app.ask(app.source([big]));
    expect(app.google.uploads).toHaveLength(2);
    const replaced = await app.records.find().toArray();
    expect(replaced).toHaveLength(1);
    expect(replaced[0]!.uri).not.toBe(record!.uri);
    expect(app.parts().find((part) => part.fileData)!.fileData!.fileUri).toBe(replaced[0]!.uri);
    // MongoDB removes a record once its expiry passes.
    const indexes = await app.records.indexes();
    expect(indexes.find((index) => index.key.expiresAt === 1)).toMatchObject({ expireAfterSeconds: 0 });
  });

  test("a finished upload keeps its reference when the tutor call then fails, so a retry reuses it", async () => {
    let fail = true;
    const app = await setup({ generate: () => fail ? googleError(503, { status: "UNAVAILABLE", message: "Overloaded." }) : answer('{"answer":"ok"}') });
    const big = await app.retain("big.pdf", 16 * MB, "application/pdf");
    await expect(app.ask(app.source([big]))).rejects.toMatchObject({ reason: "BUSY" });
    expect(await app.records.countDocuments()).toBe(1);
    fail = false;
    expect(await app.ask(app.source([big]))).toEqual({ answer: "ok" });
    expect(app.google.uploads).toHaveLength(1);
  });

  test("a failed upload fails the request with the file's name, and nothing is sent without it", async () => {
    const app = await setup({ startUpload: () => googleError(500, { status: "INTERNAL", message: "Backend error." }) });
    const big = await app.retain("Lecture 3.pdf", 16 * MB, "application/pdf");
    const error = await app.ask(app.source([big])).catch((problem: Error) => problem) as Error;
    expect(error).toBeInstanceOf(GeminiError);
    expect(error.message).toBe("The tutor could not receive the course file “Lecture 3.pdf”. Try again in a minute.");
    expect(app.google.generations()).toHaveLength(0);
    const failures = new TutorFailures();
    failures.record("sam", error);
    expect(failures.take("sam")).toBe("The tutor could not receive the course file “Lecture 3.pdf”. Try again in a minute. Your saved work is still available.");
  });

  test("an upload that runs past the request's time limit fails as a file that could not be received", async () => {
    const app = await setup({ beforeFinish: () => Bun.sleep(500) }, 100);
    const big = await app.retain("slow.pdf", 16 * MB, "application/pdf");
    const started = performance.now();
    await expect(app.ask(app.source([big]))).rejects.toMatchObject({ reason: "FILE_UPLOAD" });
    expect(performance.now() - started).toBeLessThan(450);
    expect(app.google.generations()).toHaveLength(0);
  });

  test("when Gemini reports a referenced file missing, the request's references are forgotten and a retry uploads again", async () => {
    let gone = true;
    const app = await setup({ generate: () => gone ? googleError(403, { status: "PERMISSION_DENIED", message: "You do not have permission to access the File file2 or it may not exist." }) : answer('{"answer":"ok"}') });
    const big = await app.retain("big.pdf", 16 * MB, "application/pdf"), other = await app.retain("other.png", 16 * MB, "image/png", 9);
    const error = await app.ask(app.source([big, other])).catch((problem: Error) => problem) as Error;
    expect(error.message).toBe("The tutor's copy of a course file had expired. Try again.");
    expect(await app.records.countDocuments()).toBe(0);
    gone = false;
    await app.ask(app.source([big, other]));
    expect(app.google.uploads).toHaveLength(4);
    const failures = new TutorFailures();
    failures.record("sam", error);
    expect(failures.take("sam")).toBe("The tutor's copy of a course file had expired. Try again. Your saved work is still available.");
  });

  test("tutor uploads run one at a time across requests, and one file is uploaded once for requests that need it together", async () => {
    const release = Promise.withResolvers<void>();
    const app = await setup({ beforeFinish: () => release.promise });
    const first = await app.retain("first.pdf", 16 * MB, "application/pdf", 1), second = await app.retain("second.pdf", 16 * MB, "application/pdf", 2);
    const requests = [app.ask(app.source([first])), app.ask(app.source([second]))];
    await Bun.sleep(50);
    // A third request needs the file that is already uploading; it waits for that upload.
    requests.push(app.ask(app.source([first])));
    await Bun.sleep(50);
    expect(app.google.state.activeUploads).toBe(1);
    release.resolve();
    await Promise.all(requests);
    expect(app.google.state.mostUploadsAtOnce).toBe(1);
    expect(app.google.uploads).toHaveLength(2);
    expect(app.google.generations()).toHaveLength(3);
  });

  test("a recording's transcript and a scanned PDF's page locations are accepted as citations", async () => {
    const pages: MediaValue = { file: "scan.pdf", name: "Scan.pdf", mediaType: "application/pdf", limitations: [], renditions: [{ kind: "PAGE", location: "9c1f0e2ab34d5e6f/page/2", page: 2 }] };
    const lecture: MediaValue = { file: "talk.mp4", name: "Talk.mp4", mediaType: "video/mp4", limitations: [], renditions: [{ kind: "TEXT", location: "a3c58e7f20d1b694/time/59:48-1:00:21", text: "The determinant is zero." }] };
    for (const location of ["9c1f0e2ab34d5e6f/page/2", "a3c58e7f20d1b694/time/59:48-1:00:21"]) {
      const generate = tutorGenerator({ suggest: async () => ({ unitTitle: "", skills: [] }), generate: async () => ({ explanation: "Explained.", citations: [{ material: "m1", location }] }) });
      const data: MaterialData<string, string> = { owner: "sam", scope: "course", title: "Lecture", locator: "upload:1", content: "", origin: "COURSE", originals: [pages, lecture] };
      const result = await generate("sam", { kind: "LESSON", sources: [{ material: "m1" as Material, data }], context: {}, work: [] } as never);
      expect(result.citations).toEqual([{ material: "m1" as Material, location }]);
    }
  });
});
