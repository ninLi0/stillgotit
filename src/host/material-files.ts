import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { extname, resolve } from "node:path";
import type { ImportOperation, ImportRequest } from "../storage/MaterialImportStore.ts";
import type { MediaList, MediaValue } from "../concepts/GroundedTutoring/media.ts";

export const UPLOAD_LIMIT = 25 * 1024 * 1024;
const audio = new Set([".mp3", ".m4a", ".wav", ".ogg", ".flac", ".webm", ".mp4", ".mpeg", ".mpga"]);
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeExtension = (name: string) => /^\.[a-z0-9]{1,10}$/i.test(extname(name)) ? extname(name).toLowerCase() : ".bin";

export class MaterialFiles {
  constructor(private readonly directory = resolve(".data/files"), private readonly python = resolve(".venv/bin/python")) {}

  async describe(files: File[]): Promise<ImportRequest["sources"]> {
    if (!files.length || files.length > 12 || files.reduce((n, file) => n + file.size, 0) > UPLOAD_LIMIT) {
      throw new Error("Choose up to 12 files with a combined size of 25 MB or less.");
    }
    return Promise.all(files.map(async (file) => ({
      kind: "UPLOAD" as const, name: file.name, size: file.size, sha256: digest(new Uint8Array(await file.arrayBuffer())),
    })));
  }

  async retain(operation: ImportOperation, files: File[]): Promise<MediaList> {
    const directory = this.folder(operation.owner, operation.importKey);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const result: MediaValue[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!, source = operation.request.sources[i];
      const bytes = new Uint8Array(await file.arrayBuffer()), hash = digest(bytes);
      if (!source || source.kind !== "UPLOAD" || hash !== source.sha256 || file.size !== source.size || file.name !== source.name) {
        throw new Error("The uploaded files differ from the original request.");
      }
      const filename = hash + safeExtension(file.name);
      await writeFile(resolve(directory, filename), bytes, { mode: 0o600 });
      result.push({ file: `${operation.importKey}/${filename}`, name: file.name,
        mediaType: file.type || "application/octet-stream", renditions: [], limitations: [] });
    }
    return result;
  }

  async prepare(operation: ImportOperation): Promise<{ originals: MediaList; content: string }> {
    const prepared = await this.run("process-material.py", [], {
      directory: this.folder(operation.owner, operation.importKey), prefix: operation.importKey,
      sources: operation.sources?.map(({ file, name, mediaType }) => ({ file, name, mediaType })),
    }) as { originals: MediaValue[]; content: string };
    for (let index = 0; index < prepared.originals.length; index++) {
      const original = prepared.originals[index]!;
      if (!audio.has(extname(original.name).toLowerCase())) continue;
      const speech = await this.speech(this.path(operation.owner, original.file));
      const renditions = speech.segments.filter((s) => s.text.trim()).map((s) => ({
        kind: "TEXT" as const, location: `audio/${digest(original.file).slice(0, 16)}/${s.start}-${s.end}`, text: s.text,
      }));
      prepared.originals[index] = { ...original, renditions, limitations: ["This automatic transcript has not been checked by the learner."] };
      prepared.content += `\n\n${speech.text}`;
    }
    if (!prepared.content.trim() && !prepared.originals.some((file) => file.renditions.length)) {
      throw new Error("No readable content was found. Use an unlocked document, clear image, or text file.");
    }
    return prepared;
  }

  async read(owner: string, file: string): Promise<Buffer> { return readFile(this.path(owner, file)); }

  async transcribe(owner: string, file: File): Promise<{ text: string }> {
    if (!audio.has(safeExtension(file.name)) || file.size > UPLOAD_LIMIT || file.size === 0) throw new Error("Use an audio recording under 25 MB.");
    const directory = resolve(this.directory, digest(owner), "temporary");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const path = resolve(directory, crypto.randomUUID() + safeExtension(file.name));
    try {
      await writeFile(path, new Uint8Array(await file.arrayBuffer()), { mode: 0o600 });
      const result = await this.speech(path);
      if (!result.text.trim()) throw new Error("No speech was detected. Record again or type your response.");
      return { text: result.text };
    } finally { await rm(path, { force: true }); }
  }

  private folder(owner: string, importKey: string) {
    if (!/^[a-f0-9-]{36}$/.test(importKey)) throw new Error("Invalid retained source.");
    return resolve(this.directory, digest(owner), importKey);
  }
  private path(owner: string, file: string) {
    const match = /^([a-f0-9-]{36})\/([a-f0-9]{64}\.[a-z0-9]{1,10})$/.exec(file);
    if (!match) throw new Error("Invalid retained file reference.");
    return resolve(this.folder(owner, match[1]!), match[2]!);
  }
  private speech(path: string): Promise<{ text: string; segments: { start: number; end: number; text: string }[] }> {
    return this.run("transcribe.py", [path]) as Promise<{ text: string; segments: { start: number; end: number; text: string }[] }>;
  }
  private async run(script: string, args: string[], input?: unknown): Promise<unknown> {
    const child = Bun.spawn([this.python, resolve("scripts", script), ...args], {
      stdin: input === undefined ? "ignore" : new Blob([JSON.stringify(input)]), stdout: "pipe", stderr: "pipe",
      env: { ...process.env, WHISPER_CACHE: resolve(".data/models") },
    });
    const timeout = setTimeout(() => child.kill(), 180_000);
    try {
      const [output, , exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      let result: { error?: string };
      try { result = JSON.parse(output); } catch { throw new Error("The file processor could not finish. Check the local Python setup."); }
      if (exitCode !== 0 || result.error) throw new Error(result.error || "The file could not be processed.");
      return result;
    } finally { clearTimeout(timeout); if (child.exitCode === null) child.kill(); }
  }
}
