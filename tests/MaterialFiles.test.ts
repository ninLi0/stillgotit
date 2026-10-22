import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { strToU8 } from "fflate";
import { MaterialFiles } from "../src/host/material-files.ts";
import { DiskStore, S3Store, type FileStore } from "../src/host/file-store.ts";
import type { ImportOperation } from "../src/storage/MaterialImportStore.ts";
import { pdf, png } from "./fixtures/office.ts";
import { fakeS3 } from "./fixtures/fake-s3.ts";

let directory: string, s3: ReturnType<typeof fakeS3>;
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), "stillgotit-files-")); s3 = fakeS3(); });
afterAll(async () => { s3?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

const lesson = "Matrix multiplication\nMultiply each row of A by each column of B. The inner dimensions must match.";
const generated: Record<string, Uint8Array> = {
  "lesson.md": strToU8(lesson), "lesson.png": png, "scan.pdf": pdf(["", ""]),
  "lesson.ipynb": strToU8(JSON.stringify({ cells: [{ cell_type: "markdown", source: [lesson] }, { cell_type: "code", source: ["A = [[1, 2], [3, 4]]"] }] })),
};
const contents = async (name: string) => generated[name] ?? new Uint8Array(await readFile(resolve(import.meta.dir, "fixtures/materials", name)));
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const disk = () => new DiskStore(resolve(directory, "retained"));

async function imported(names: string[], store: FileStore = disk()) {
  const files = new MaterialFiles(store);
  const uploads = await Promise.all(names.map(async (name) => new File([new Uint8Array(await contents(name))], name, { type: "application/octet-stream" })));
  const operation: ImportOperation = { owner: "sam", requestId: crypto.randomUUID(), importKey: crypto.randomUUID(), kind: "MATERIAL_IMPORT",
    request: { scope: "linear-algebra", title: names.join(", "), origin: "COURSE", sources: await files.describe(uploads) }, stage: "CREATED", revision: 0 };
  operation.sources = await files.retain(operation, uploads); operation.stage = "SOURCES_SAVED"; operation.revision = 1;
  return { files, operation, uploads };
}

describe("Retained material processing", () => {
  test("PDF imports keep page text and serve the original from the store", async () => {
    const { files, operation } = await imported(["lesson.pdf"]);
    const result = await files.prepare(operation), original = result.originals[0]!;
    const key = sha(original.file).slice(0, 16);
    expect(result.content).toContain("Matrix multiplication");
    expect(original.renditions.map((part) => [part.kind, part.location])).toEqual([["TEXT", `${key}/page/1`], ["TEXT", `${key}/page/2`]]);
    expect(original.file).toBe(`${operation.importKey}/${sha(await contents("lesson.pdf"))}.pdf`);
    expect(await files.read("sam", original.file)).toEqual(Buffer.from(await contents("lesson.pdf")));
    expect(await readdir(resolve(directory, "retained", sha("sam"), operation.importKey))).toEqual([original.file.split("/")[1]!]);
    await expect(files.read("other-learner", original.file)).rejects.toThrow("This saved file is no longer available.");
  });

  test.each([
    ["lesson.md", "lines/1-2", "Matrix multiplication"], ["lesson.docx", "document", "Matrix multiplication"],
    ["lesson.pptx", "slide/1", "Matrix multiplication"], ["lesson.xlsx", "sheet/Matrices/rows/1-4", "Matrix A"],
    ["lesson.ipynb", "cell/1", "Matrix multiplication"],
  ])("reads %s with stable locations", async (name, location, text) => {
    const { files, operation } = await imported([name]);
    const result = await files.prepare(operation), original = result.originals[0]!;
    expect(result.content).toContain(text);
    expect(original.renditions[0]).toMatchObject({ kind: "TEXT", location: `${sha(original.file).slice(0, 16)}/${location}` });
    expect(await files.prepare(operation)).toEqual(result);
  });

  test("a photo remains readable without invented OCR text", async () => {
    const { files, operation } = await imported(["lesson.png"]);
    const result = await files.prepare(operation), original = result.originals[0]!;
    expect(result.content).toBe("");
    expect(original.renditions).toEqual([{ kind: "IMAGE", location: `${sha(original.file).slice(0, 16)}/image`, file: original.file, mediaType: "image/png" }]);
    expect(await files.read("sam", original.file)).toEqual(Buffer.from(png));
  });

  test("several files keep their order and separate location keys", async () => {
    const { files, operation } = await imported(["lesson.pdf", "lesson.md", "lesson.png"]);
    const result = await files.prepare(operation);
    expect(result.originals.map((file) => file.name)).toEqual(["lesson.pdf", "lesson.md", "lesson.png"]);
    expect(new Set(result.originals.map((file) => file.renditions[0]!.location.split("/")[0])).size).toBe(3);
  });

  test("a scan without text and without other readable files is refused", async () => {
    const { files, operation } = await imported(["scan.pdf"]);
    await expect(files.prepare(operation)).rejects.toThrow("No readable content was found. Use an unlocked document, clear image, or text file.");
  });
});

describe("Upload checks", () => {
  test("unsupported files are refused before anything is saved", async () => {
    const store = new DiskStore(resolve(directory, "refused")), files = new MaterialFiles(store);
    for (const name of ["lesson.zip", "lecture.mp3"]) {
      await expect(files.describe([new File([strToU8(lesson)], "lesson.md"), new File([strToU8("PK\x03\x04\0")], name)]))
        .rejects.toThrow("This file type can't be imported. Upload a PDF, image, text, notebook, Word, PowerPoint, or Excel file.");
    }
    expect(await readdir(directory)).not.toContain("refused");
  });

  test("the existing upload limits still apply", async () => {
    const files = new MaterialFiles(disk()), small = () => new File(["x"], "a.md");
    await expect(files.describe([])).rejects.toThrow("Choose up to 12 files with a combined size of 25 MB or less.");
    await expect(files.describe(Array.from({ length: 13 }, small))).rejects.toThrow("Choose up to 12 files");
    await expect(files.describe([new File([new Uint8Array(25 * 1024 * 1024 + 1)], "big.md")])).rejects.toThrow("Choose up to 12 files");
    expect(await files.describe(Array.from({ length: 12 }, small))).toHaveLength(12);
  });

  test("changed bytes on a retry are refused", async () => {
    const { files, operation } = await imported(["lesson.md"]);
    await expect(files.retain(operation, [new File(["Changed"], "lesson.md")])).rejects.toThrow("The uploaded files differ from the original request.");
  });

  test("missing, foreign, and malformed file references are refused", async () => {
    const store = disk(), { files, operation } = await imported(["lesson.md"], store);
    const original = operation.sources![0]!, other = `${crypto.randomUUID()}/${original.file.split("/")[1]}`;
    await expect(files.prepare({ ...operation, sources: [{ ...original, file: other }] })).rejects.toThrow("A saved source file is missing. Upload the files again.");
    await store.delete(`${sha("sam")}/${original.file}`);
    await expect(files.prepare(operation)).rejects.toThrow("A saved source file is missing. Upload the files again.");
    await expect(files.read("sam", "../../.env")).rejects.toThrow("Invalid retained file reference.");
    await expect(files.read("sam", `${operation.importKey}/../../.env`)).rejects.toThrow("Invalid retained file reference.");
  });
});

describe("S3-backed material files", () => {
  test("originals are saved to and read from the bucket", async () => {
    s3.requests.length = 0;
    const { files, operation } = await imported(["lesson.pdf", "lesson.png"], new S3Store(s3.client));
    const result = await files.prepare(operation);
    const keys = result.originals.map((file) => `${sha("sam")}/${file.file}`);
    expect([...s3.objects.keys()]).toEqual(expect.arrayContaining(keys));
    expect(s3.objects.get(keys[0]!)).toEqual(new Uint8Array(await contents("lesson.pdf")));
    expect(result.content).toContain("Matrix multiplication");
    expect(await files.read("sam", result.originals[1]!.file)).toEqual(Buffer.from(png));
    expect(s3.requests.filter((request) => request.startsWith("PUT"))).toEqual(keys.map((key) => `PUT /stillgotit-test/${key}`));
  });
});
