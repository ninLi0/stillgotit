import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { ImportOperation, ImportRequest } from "../storage/MaterialImportStore.ts";
import type { MediaList, MediaValue } from "../concepts/GroundedTutoring/media.ts";
import { classify, extract, type Source } from "./extract.ts";
import { fileStore, type FileStore } from "./file-store.ts";

export const UPLOAD_LIMIT = 25 * 1024 * 1024;
const READ_TIMEOUT = 120_000;
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeExtension = (name: string) => /^\.[a-z0-9]{1,10}$/i.test(extname(name)) ? extname(name).toLowerCase() : ".bin";

/** Retains uploads in the file store and reads them in memory. Nothing is written to the local disk in S3 mode. */
export class MaterialFiles {
  constructor(private readonly store: FileStore = fileStore()) {}

  async describe(files: File[]): Promise<ImportRequest["sources"]> {
    if (!files.length || files.length > 12 || files.reduce((n, file) => n + file.size, 0) > UPLOAD_LIMIT) {
      throw new Error("Choose up to 12 files with a combined size of 25 MB or less.");
    }
    return Promise.all(files.map(async (file) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      classify(file.name, bytes); // Refuse unsupported types before anything is saved.
      return { kind: "UPLOAD" as const, name: file.name, size: file.size, sha256: digest(bytes) };
    }));
  }

  async retain(operation: ImportOperation, files: File[]): Promise<MediaList> {
    const result: MediaValue[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!, source = operation.request.sources[i];
      const bytes = new Uint8Array(await file.arrayBuffer()), hash = digest(bytes);
      if (!source || source.kind !== "UPLOAD" || hash !== source.sha256 || file.size !== source.size || file.name !== source.name) {
        throw new Error("The uploaded files differ from the original request.");
      }
      const reference = `${operation.importKey}/${hash}${safeExtension(file.name)}`;
      await this.store.put(this.key(operation.owner, reference), bytes);
      // Bun reports text uploads as "text/plain;charset=utf-8". Saved media types keep only the type itself.
      const mediaType = file.type.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
      result.push({ file: reference, name: file.name, mediaType, renditions: [], limitations: [] });
    }
    return result;
  }

  async prepare(operation: ImportOperation): Promise<{ originals: MediaList; content: string }> {
    const sources: Source[] = [];
    for (const { file, name, mediaType } of operation.sources ?? []) {
      const bytes = file.startsWith(`${operation.importKey}/`) ? await this.store.get(this.key(operation.owner, file)) : null;
      if (!bytes) throw new Error("A saved source file is missing. Upload the files again.");
      sources.push({ file, name, mediaType, bytes });
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Reading these files took too long. Import a smaller unit.")), READ_TIMEOUT); });
    try {
      const prepared = await Promise.race([extract(sources), late]);
      if (!prepared.content.trim() && !prepared.originals.some((file) => file.renditions.length)) {
        throw new Error("No readable content was found. Use an unlocked document, clear image, or text file.");
      }
      return prepared;
    } finally { clearTimeout(timer); }
  }

  /** Returns a retained original or image rendition. Callers check material access first. */
  async read(owner: string, file: string): Promise<Buffer> {
    const bytes = await this.store.get(this.key(owner, file));
    if (!bytes) throw new Error("This saved file is no longer available.");
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** Store keys group files by learner digest and import key. */
  private key(owner: string, file: string) {
    const match = /^([a-f0-9-]{36})\/([a-f0-9]{64}\.[a-z0-9]{1,10})$/.exec(file);
    if (!match) throw new Error("Invalid retained file reference.");
    return `${digest(owner)}/${match[1]}/${match[2]}`;
  }
}
