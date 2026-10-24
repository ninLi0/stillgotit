import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { strToU8 } from "fflate";
import {
  FILES_CHANGED, MaterialFiles, NO_FILES, NO_READABLE_CONTENT, READING_TOO_LONG, RECORDINGS_NEED_TUTOR, TOO_LARGE_UPLOAD, TOO_MANY_FILES,
} from "../src/host/material-files.ts";
import { DiskStore, S3Store, type FileStore } from "../src/host/file-store.ts";
import type { ImportOperation } from "../src/storage/MaterialImportStore.ts";
import { isMediaList } from "../src/concepts/GroundedTutoring/media.ts";
import { ARCHIVE, RECORDING_UNREADABLE } from "../src/host/extract.ts";
import { pdf, png } from "./fixtures/office.ts";
import { heif, jpeg, mp4, scannedPdf, wav, webm } from "./fixtures/media.ts";
import { fakeS3 } from "./fixtures/fake-s3.ts";

let directory: string, s3: ReturnType<typeof fakeS3>;
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), "stillgotit-files-")); s3 = fakeS3(); });
afterAll(async () => { s3?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

const MB = 1024 * 1024;
const lesson = "Matrix multiplication\nMultiply each row of A by each column of B. The inner dimensions must match.";
const generated: Record<string, () => Uint8Array> = {
  "lesson.md": () => strToU8(lesson), "lesson.png": () => png, "scan.pdf": () => scannedPdf([null, null]), "blank.pdf": () => pdf([""]),
  "lesson.ipynb": () => strToU8(JSON.stringify({ cells: [{ cell_type: "markdown", source: [lesson] }, { cell_type: "code", source: ["A = [[1, 2], [3, 4]]"] }] })),
  "lecture.wav": () => wav(2), "photo.heic": () => heif(), "renamed.heic": () => jpeg, "clip.mp4": () => mp4({ seconds: 3 }),
  "voice.webm": () => webm({ seconds: 2 }), "empty.md": () => new Uint8Array(),
};
const contents = async (name: string) => generated[name]?.() ?? new Uint8Array(await readFile(resolve(import.meta.dir, "fixtures/materials", name)));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const disk = (name = "retained") => new DiskStore(resolve(directory, name));
const upload = async (name: string, type = "application/octet-stream") => new File([new Uint8Array(await contents(name))], name, { type });

/** Runs the upload route's file steps: inspect, retain, and read. */
async function imported(names: string[], store: FileStore = disk(), recordings = true) {
  const files = new MaterialFiles(store), uploads = await Promise.all(names.map((name) => upload(name)));
  const inspected = await files.inspect(uploads, { recordings });
  const operation: ImportOperation = { owner: "sam", requestId: crypto.randomUUID(), importKey: crypto.randomUUID(), kind: "MATERIAL_IMPORT",
    request: { scope: "linear-algebra", title: names.join(", "), origin: "COURSE", sources: inspected.sources }, stage: "CREATED", revision: 0 };
  operation.sources = await files.retain(operation, uploads, inspected);
  operation.stage = "SOURCES_SAVED"; operation.revision = 1;
  return { files, operation, uploads, inspected, store };
}

describe("Before saving", () => {
  test("inspection hashes each received file and detects how it is read, without saving anything", async () => {
    const store = disk("inspected"), files = new MaterialFiles(store);
    const uploads = await Promise.all(["lesson.md", "photo.heic", "lecture.wav"].map((name) => upload(name)));
    const inspected = await files.inspect(uploads, { recordings: true });
    expect(inspected.sources).toEqual(await Promise.all(["lesson.md", "photo.heic", "lecture.wav"].map(async (name) => ({
      kind: "UPLOAD", name, size: (await contents(name)).length, sha256: sha(await contents(name)) }))));
    expect(inspected.detected.map((item) => [item.kind, item.mediaType])).toEqual([["text", undefined], ["image", "image/heic"], ["recording", "audio/wav"]]);
    expect(await readdir(directory)).not.toContain("inspected");
  });

  test("count, size, and type refusals save nothing", async () => {
    const store = disk("refused"), files = new MaterialFiles(store), small = () => new File(["x"], "a.md");
    await expect(files.inspect([], { recordings: true })).rejects.toThrow(NO_FILES);
    await expect(files.inspect(Array.from({ length: 13 }, small), { recordings: true })).rejects.toThrow(TOO_MANY_FILES);
    await expect(files.inspect([new File([new Uint8Array(95 * MB + 1)], "big.md")], { recordings: true })).rejects.toThrow(TOO_LARGE_UPLOAD);
    await expect(files.inspect([new File([new Uint8Array(50 * MB)], "a.md"), new File([new Uint8Array(45 * MB + 1)], "b.md")], { recordings: true })).rejects.toThrow(TOO_LARGE_UPLOAD);
    await expect(files.inspect([new File([strToU8(lesson)], "lesson.md"), new File([strToU8("PK\x03\x04\0")], "lesson.zip")], { recordings: true })).rejects.toThrow(ARCHIVE);
    await expect(files.inspect([new File([strToU8("not audio")], "lecture.mp3")], { recordings: true })).rejects.toThrow(RECORDING_UNREADABLE);
    expect(await files.inspect(Array.from({ length: 12 }, small), { recordings: true })).toMatchObject({ sources: expect.any(Array) });
    expect(await readdir(directory)).not.toContain("refused");
    expect([NO_FILES, TOO_MANY_FILES, TOO_LARGE_UPLOAD]).toEqual(["Choose at least one file to import.", "Choose up to 12 files for one import.",
      "Choose files with a combined size of 95 MB or less."]);
  });

  test("recordings and videos are refused when the server has no Gemini key", async () => {
    const files = new MaterialFiles(disk());
    for (const name of ["lecture.wav", "clip.mp4", "voice.webm"]) {
      await expect(files.inspect([await upload("lesson.md"), await upload(name)], { recordings: false })).rejects.toThrow(RECORDINGS_NEED_TUTOR);
    }
    expect((await files.inspect([await upload("lesson.md"), await upload("photo.heic")], { recordings: false })).sources).toHaveLength(2);
  });
});

describe("Retained material processing", () => {
  test("PDF imports keep page text and serve the original from the store", async () => {
    const { files, operation, uploads, inspected } = await imported(["lesson.pdf"]);
    const result = await files.readUpload(operation, uploads, inspected.detected), original = result.originals[0]!;
    const key = sha(original.file).slice(0, 16);
    expect(result.content).toContain("Matrix multiplication");
    expect(original.renditions.map((part) => [part.kind, part.location])).toEqual([["TEXT", `${key}/page/1`], ["TEXT", `${key}/page/2`]]);
    expect(original.file).toBe(`${operation.importKey}/${sha(await contents("lesson.pdf"))}.pdf`);
    expect(original.mediaType).toBe("application/pdf");
    expect(await files.read("sam", original.file)).toEqual(Buffer.from(await contents("lesson.pdf")));
    expect(await readdir(resolve(directory, "retained", sha("sam"), operation.importKey))).toEqual([original.file.split("/")[1]!]);
    await expect(files.read("other-learner", original.file)).rejects.toThrow("This saved file is no longer available.");
  });

  test.each([
    ["lesson.md", "lines/1-2", "Matrix multiplication"], ["lesson.docx", "document", "Matrix multiplication"],
    ["lesson.pptx", "slide/1", "Matrix multiplication"], ["lesson.xlsx", "sheet/Matrices/rows/1-4", "Matrix A"],
    ["lesson.ipynb", "cell/1", "Matrix multiplication"],
  ])("reads %s with stable locations", async (name, location, text) => {
    const { files, operation, uploads, inspected } = await imported([name]);
    const result = await files.readUpload(operation, uploads, inspected.detected), original = result.originals[0]!;
    expect(result.content).toContain(text);
    expect(original.renditions[0]).toMatchObject({ kind: "TEXT", location: `${sha(original.file).slice(0, 16)}/${location}` });
    expect(await files.readUpload(operation, uploads, inspected.detected)).toEqual(result);
  });

  test("documents are read from the received bytes, not read back from the store", async () => {
    const { files, operation, uploads, inspected, store } = await imported(["lesson.md"]);
    await store.delete(`${sha("sam")}/${operation.sources![0]!.file}`);
    expect((await files.readUpload(operation, uploads, inspected.detected)).content).toContain("Matrix multiplication");
  });

  test("photos, HEIC photos, and scanned PDFs are readable without invented text", async () => {
    const { files, operation, uploads, inspected } = await imported(["lesson.png", "photo.heic", "renamed.heic", "scan.pdf"]);
    const result = await files.readUpload(operation, uploads, inspected.detected);
    expect(result.content).toBe("");
    const [photo, heic, renamed, scan] = result.originals;
    expect(photo!.renditions).toEqual([{ kind: "IMAGE", location: `${sha(photo!.file).slice(0, 16)}/image`, file: photo!.file, mediaType: "image/png" }]);
    expect(heic!.mediaType).toBe("image/heic");
    expect(heic!.renditions).toEqual([{ kind: "IMAGE", location: `${sha(heic!.file).slice(0, 16)}/image`, file: heic!.file, mediaType: "image/heic" }]);
    // A photo named .heic whose bytes are JPEG is saved as JPEG.
    expect([renamed!.mediaType, renamed!.renditions[0]]).toEqual(["image/jpeg", expect.objectContaining({ mediaType: "image/jpeg" })]);
    expect(scan!.renditions.map((part) => part.kind)).toEqual(["PAGE", "PAGE"]);
    expect(isMediaList(result.originals)).toBe(true);
    expect(await files.read("sam", photo!.file)).toEqual(Buffer.from(png));
  });

  test("recordings keep their detected type and wait for transcription", async () => {
    const { files, operation, uploads, inspected } = await imported(["lesson.md", "clip.mp4", "voice.webm"]);
    const result = await files.readUpload(operation, uploads, inspected.detected);
    expect(result.originals.map((file) => [file.mediaType, file.renditions.length])).toEqual([["application/octet-stream", 1], ["video/mp4", 0], ["audio/webm", 0]]);
    expect(result.recordings).toEqual([result.originals[1]!.file, result.originals[2]!.file]);
    // A recording alone is readable content: its transcript comes later.
    const alone = await imported(["lecture.wav"]);
    expect((await alone.files.readUpload(alone.operation, alone.uploads, alone.inspected.detected)).recordings).toHaveLength(1);
  });

  test("several files keep their order and separate location keys", async () => {
    const { files, operation, uploads, inspected } = await imported(["lesson.pdf", "lesson.md", "lesson.png"]);
    const result = await files.readUpload(operation, uploads, inspected.detected);
    expect(result.originals.map((file) => file.name)).toEqual(["lesson.pdf", "lesson.md", "lesson.png"]);
    expect(new Set(result.originals.map((file) => file.renditions[0]!.location.split("/")[0])).size).toBe(3);
  });

  test("files with nothing readable are refused while reading, after the originals are saved", async () => {
    const { files, operation, uploads, inspected } = await imported(["empty.md"]);
    await expect(files.readUpload(operation, uploads, inspected.detected)).rejects.toThrow(NO_READABLE_CONTENT);
    expect(await files.read("sam", operation.sources![0]!.file)).toEqual(Buffer.from([]));
    expect(NO_READABLE_CONTENT).toBe("No readable content was found in these files. Check that they aren't empty, or export documents that contain pictures to PDF and import the PDF.");
  });

  test("reading stops after its time limit", async () => {
    const { files, operation, inspected } = await imported(["lesson.pdf"]);
    // A file whose bytes never finish arriving stands in for a reader that runs too long.
    class Stalled extends File { override bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Promise(() => undefined); } }
    await expect(files.readUpload(operation, [new Stalled([], "lesson.pdf")], inspected.detected, 20)).rejects.toThrow(READING_TOO_LONG);
    expect(READING_TOO_LONG).toBe("Reading these files took too long. Import a smaller unit.");
  });
});

describe("Upload checks", () => {
  test("a plain text upload keeps a media type without parameters, so the import can be saved", async () => {
    // A browser upload parsed by Bun reports text files as "text/plain;charset=utf-8".
    const form = new FormData(); form.append("file", new File([lesson], "notes.txt", { type: "text/plain" }));
    const received = (await new Response(form).formData()).get("file") as File;
    expect(received.type).toContain(";");
    const files = new MaterialFiles(disk()), inspected = await files.inspect([received], { recordings: true });
    const operation: ImportOperation = { owner: "sam", requestId: crypto.randomUUID(), importKey: crypto.randomUUID(), kind: "MATERIAL_IMPORT",
      request: { scope: "linear-algebra", title: "Notes", origin: "COURSE", sources: inspected.sources }, stage: "CREATED", revision: 0 };
    const sources = await files.retain(operation, [received], inspected);
    expect(sources[0]!.mediaType).toBe("text/plain");
    expect(isMediaList(sources)).toBe(true);
  });

  test("changed bytes on a retry are refused", async () => {
    const { files, operation } = await imported(["lesson.md"]);
    const changed = [new File(["Changed"], "lesson.md")];
    await expect(files.retain(operation, changed, await files.inspect(changed, { recordings: true }))).rejects.toThrow(FILES_CHANGED);
  });

  test("missing, foreign, and malformed file references are refused", async () => {
    const store = disk(), { files, operation } = await imported(["lesson.md"], store);
    const original = operation.sources![0]!;
    await store.delete(`${sha("sam")}/${original.file}`);
    await expect(files.read("sam", original.file)).rejects.toThrow("This saved file is no longer available.");
    await expect(files.size("sam", original.file)).rejects.toThrow("This saved file is no longer available.");
    await expect(files.read("sam", "../../.env")).rejects.toThrow("Invalid retained file reference.");
    await expect(files.read("sam", `${operation.importKey}/../../.env`)).rejects.toThrow("Invalid retained file reference.");
  });

  test("a retained file streams with its size", async () => {
    const { files, operation } = await imported(["lesson.pdf"]);
    const { stream, size } = await files.open("sam", operation.sources![0]!.file);
    expect(size).toBe((await contents("lesson.pdf")).length);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(new Uint8Array(await contents("lesson.pdf")));
  });

  test("removing an import deletes every file its declared sources can have, saved or not", async () => {
    const { files, operation, store } = await imported(["lesson.md", "lesson.png"]);
    const unsaved = { kind: "UPLOAD" as const, name: "never-saved.pdf", size: 3, sha256: sha("abc") };
    await files.deleteImport({ ...operation, request: { ...operation.request, sources: [...operation.request.sources, unsaved] } });
    for (const source of operation.sources!) expect(await store.exists(`${sha("sam")}/${source.file}`)).toBe(false);
    // Deleting again is harmless.
    await files.deleteImport(operation);
  });
});

describe("S3-backed material files", () => {
  test("originals are saved to, read from, and streamed from the bucket", async () => {
    s3.requests.length = 0;
    const { files, operation, uploads, inspected } = await imported(["lesson.pdf", "lesson.png"], new S3Store(s3.client));
    const result = await files.readUpload(operation, uploads, inspected.detected);
    const keys = result.originals.map((file) => `${sha("sam")}/${file.file}`);
    expect([...s3.objects.keys()]).toEqual(expect.arrayContaining(keys));
    expect(s3.objects.get(keys[0]!)).toEqual(new Uint8Array(await contents("lesson.pdf")));
    expect(result.content).toContain("Matrix multiplication");
    expect(await files.read("sam", result.originals[1]!.file)).toEqual(Buffer.from(png));
    expect(s3.requests.filter((request) => request.startsWith("PUT"))).toEqual(keys.map((key) => `PUT /stillgotit-test/${key}`));
    const { stream, size } = await files.open("sam", result.originals[0]!.file);
    expect(size).toBe((await contents("lesson.pdf")).length);
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(new Uint8Array(await contents("lesson.pdf")));
    await files.deleteImport(operation);
    for (const key of keys) expect(s3.objects.has(key)).toBe(false);
  });

  test("a large recording is written in one request from the received file", async () => {
    s3.requests.length = 0;
    const big = new Uint8Array(wav(400, { rate: 16000 }));
    expect(big.length).toBeGreaterThan(12 * MB);
    const files = new MaterialFiles(new S3Store(s3.client)), received = [new File([big], "long.wav")];
    const inspected = await files.inspect(received, { recordings: true });
    const operation: ImportOperation = { owner: "sam", requestId: crypto.randomUUID(), importKey: crypto.randomUUID(), kind: "MATERIAL_IMPORT",
      request: { scope: "linear-algebra", title: "Lecture", origin: "COURSE", sources: inspected.sources }, stage: "CREATED", revision: 0 };
    const [saved] = await files.retain(operation, received, inspected);
    expect(s3.requests.filter((request) => request.startsWith("PUT"))).toHaveLength(1);
    expect(s3.objects.get(`${sha("sam")}/${saved!.file}`)).toEqual(big);
  });
});
