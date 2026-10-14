import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { MaterialFiles } from "../src/host/material-files.ts";
import type { ImportOperation } from "../src/storage/MaterialImportStore.ts";

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(resolve(tmpdir(), "stillgotit-files-"));
  const child = Bun.spawn([".venv/bin/python", "tests/fixtures/make-materials.py", directory], { stdout: "pipe", stderr: "pipe" });
  const errors = await new Response(child.stderr).text();
  if (await child.exited) throw new Error(errors);
});
afterAll(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function imported(name: string) {
  const files = new MaterialFiles(resolve(directory, "retained"));
  const file = new File([new Uint8Array(await readFile(resolve(directory, name)))], name, { type: "application/octet-stream" });
  const operation: ImportOperation = { owner: "sam", requestId: crypto.randomUUID(), importKey: crypto.randomUUID(), kind: "MATERIAL_IMPORT",
    request: { scope: "linear-algebra", title: name, origin: "COURSE", sources: await files.describe([file]) }, stage: "CREATED", revision: 0 };
  operation.sources = await files.retain(operation, [file]); operation.stage = "SOURCES_SAVED"; operation.revision = 1;
  return { files, operation };
}

describe("Retained material processing", () => {
  test("PDF imports keep page text and readable page images", async () => {
    const { files, operation } = await imported("lesson.pdf");
    const result = await files.prepare(operation);
    expect(result.content).toContain("Matrix multiplication");
    const image = result.originals[0]!.renditions.find((part) => part.kind === "IMAGE")!;
    expect(image.location).toContain("/page/1");
    if (image.kind === "IMAGE") expect((await files.read("sam", image.file)).length).toBeGreaterThan(100);
    expect(await files.read("sam", result.originals[0]!.file)).toEqual(await readFile(resolve(directory, "lesson.pdf")));
    await expect(files.read("other-learner", result.originals[0]!.file)).rejects.toThrow();
  });

  test.each(["lesson.md", "lesson.docx", "lesson.pptx", "lesson.xlsx", "lesson.ipynb", "lesson.zip"])("reads %s with stable locations", async (name) => {
    const { files, operation } = await imported(name);
    const result = await files.prepare(operation);
    expect(result.content).toContain(name.endsWith("xlsx") ? "Matrix A" : "Matrix multiplication");
    expect(result.originals.some((source) => source.renditions.some((part) => part.kind === "TEXT" && part.location.length > 0))).toBe(true);
  }, 120_000);

  test("a photo remains readable without invented OCR text", async () => {
    const { files, operation } = await imported("lesson.png");
    const result = await files.prepare(operation);
    expect(result.content).toBe("");
    expect(result.originals[0]!.renditions[0]!.kind).toBe("IMAGE");
  });

  test("archive traversal is refused and no outside file is extracted", async () => {
    const { files, operation } = await imported("unsafe.zip");
    await expect(files.prepare(operation)).rejects.toThrow("unsafe path");
    expect(await readdir(directory)).not.toContain("outside.txt");
    await expect(files.read("sam", "../../.env")).rejects.toThrow("Invalid retained file");
  });
});
