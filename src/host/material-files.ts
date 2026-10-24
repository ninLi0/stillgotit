import { createHash } from "node:crypto";
import { extname } from "node:path";
import type { ImportOperation } from "../storage/MaterialImportStore.ts";
import type { MediaValue } from "../concepts/GroundedTutoring/media.ts";
import { bytesNeeded, classify, extract, START_BYTES, type Detected } from "./extract.ts";
import { fileStore, type FileStore, type StoreCall } from "./file-store.ts";
import { Refusal } from "./refusal.ts";

/** In this design, 1 MB is 1,048,576 bytes. */
export const MB = 1024 * 1024;
export const MAX_FILES = 12;
/** The combined size of one upload's files. */
export const UPLOAD_LIMIT = 95 * MB;
/** The server-wide body limit: the files plus 1 MB for the other form fields. */
export const UPLOAD_BODY_LIMIT = 96 * MB;
export const READ_TIMEOUT = 45_000;
export const NO_FILES = "Choose at least one file to import.";
export const TOO_MANY_FILES = "Choose up to 12 files for one import.";
export const TOO_LARGE_UPLOAD = "Choose files with a combined size of 95 MB or less.";
export const RECORDINGS_NEED_TUTOR = "Recordings and videos need the AI tutor, which isn't set up on this server. Ask the app owner to add a Gemini API key.";
export const NO_READABLE_CONTENT = "No readable content was found in these files. Check that they aren't empty, or export documents that contain pictures to PDF and import the PDF.";
export const READING_TOO_LONG = "Reading these files took too long. Import a smaller unit.";
export const FILES_CHANGED = "The uploaded files differ from the original request.";
export const FILE_GONE = "This saved file is no longer available.";

const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const safeExtension = (name: string) => /^\.[a-z0-9]{1,10}$/i.test(extname(name)) ? extname(name).toLowerCase() : ".bin";

/** Hashes a received file while streaming it, without another full copy. */
async function sha256(file: Blob): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of file.stream()) hash.update(chunk);
  return hash.digest("hex");
}

/** Declared upload sources and how each file is read, after the "Before saving" checks. */
export interface Inspected {
  sources: { kind: "UPLOAD"; name: string; size: number; sha256: string }[];
  detected: Detected[];
}

/** One import's documents as read at upload. Recordings keep empty renditions until they are transcribed. */
export interface ReadUpload { originals: MediaValue[]; content: string; recordings: string[] }

/** Retains uploads in the file store and reads them in memory. Nothing is written to the local disk in S3 mode. */
export class MaterialFiles {
  constructor(private readonly store: FileStore = fileStore()) {}

  /**
   * The "Before saving" checks: the number of files, their combined size, each file's type from its name and
   * bytes, and each recording's length. Files are checked one at a time. Nothing is saved.
   */
  async inspect(files: File[], { recordings }: { recordings: boolean }): Promise<Inspected> {
    if (!files.length) throw new Refusal(NO_FILES);
    if (files.length > MAX_FILES) throw new Refusal(TOO_MANY_FILES);
    if (files.reduce((total, file) => total + file.size, 0) > UPLOAD_LIMIT) throw new Refusal(TOO_LARGE_UPLOAD);
    const result: Inspected = { sources: [], detected: [] };
    for (const file of files) {
      const needed = bytesNeeded(file.name);
      const bytes = needed === "all" ? await file.bytes() : needed === "start" ? await file.slice(0, START_BYTES).bytes() : new Uint8Array();
      const detected = classify(file.name, bytes);
      // Only Gemini can transcribe a recording, so it is refused before anything is saved.
      if (detected.kind === "recording" && !recordings) throw new Refusal(RECORDINGS_NEED_TUTOR);
      result.sources.push({ kind: "UPLOAD", name: file.name, size: file.size, sha256: await sha256(file) });
      result.detected.push(detected);
    }
    return result;
  }

  /** Streams the received originals to the file store under the import key. Each write gets `call()`'s limit. */
  async retain(operation: ImportOperation, files: File[], inspected: Inspected, call: () => StoreCall = () => ({})): Promise<MediaValue[]> {
    const result: MediaValue[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i]!, source = operation.request.sources[i], checked = inspected.sources[i], detected = inspected.detected[i];
      // The digest was computed from these bytes in this request, and it matches the saved request.
      if (!source || source.kind !== "UPLOAD" || !checked || !detected || checked.sha256 !== source.sha256 ||
        file.size !== source.size || file.name !== source.name || files.length !== operation.request.sources.length) throw new Refusal(FILES_CHANGED);
      const reference = `${operation.importKey}/${source.sha256}${safeExtension(file.name)}`;
      await this.store.put(this.key(operation.owner, reference), file, call());
      result.push({ file: reference, name: file.name, mediaType: detected.mediaType ?? declaredType(file), renditions: [], limitations: [] });
    }
    return result;
  }

  /**
   * The "While reading" checks. Documents are read from the bytes received in this request, not read back
   * from the file store. Each file is copied once when its turn comes.
   */
  async readUpload(operation: ImportOperation, files: File[], detected: readonly Detected[], timeout = READ_TIMEOUT): Promise<ReadUpload> {
    const saved = operation.sources ?? [];
    if (saved.length !== files.length || detected.length !== files.length) throw new Refusal(FILES_CHANGED);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Refusal(READING_TOO_LONG)), timeout); });
    try {
      const read = await Promise.race([extract(saved.map((source, i) => ({
        file: source.file, name: source.name, mediaType: source.mediaType, bytes: files[i]!, detected: detected[i],
      }))), late]);
      if (!read.recordings.length && !read.originals.some((file) => file.renditions.length)) throw new Refusal(NO_READABLE_CONTENT);
      return read;
    } finally { clearTimeout(timer); }
  }

  /** Returns a retained original or image rendition. Callers check material access first. */
  async read(owner: string, file: string, call: StoreCall = {}): Promise<Buffer> {
    const bytes = await this.store.get(this.key(owner, file), call);
    if (!bytes) throw new Refusal(FILE_GONE);
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  /** A retained file's size, without reading it. */
  async size(owner: string, file: string, call: StoreCall = {}): Promise<number> {
    const size = await this.store.size(this.key(owner, file), call);
    if (size === null) throw new Refusal(FILE_GONE);
    return size;
  }

  /** Streams a retained file. Callers check material access first. */
  async open(owner: string, file: string): Promise<{ stream: ReadableStream<Uint8Array>; size: number }> {
    const size = await this.size(owner, file);
    return { stream: this.store.stream(this.key(owner, file)), size };
  }

  /** Deletes every file that the import's declared sources can have under its import key. */
  async deleteImport(operation: Pick<ImportOperation, "owner" | "importKey" | "request">, call: StoreCall = {}): Promise<void> {
    for (const source of operation.request.sources) {
      if (source.kind !== "UPLOAD") continue;
      await this.store.delete(this.key(operation.owner, `${operation.importKey}/${source.sha256}${safeExtension(source.name)}`), call);
    }
  }

  /** The file-store key of a retained file. Keys group files by learner digest and import key. */
  storeKey(owner: string, file: string): string { return this.key(owner, file); }

  private key(owner: string, file: string) {
    const match = /^([a-f0-9-]{36})\/([a-f0-9]{64}\.[a-z0-9]{1,10})$/.exec(file);
    if (!match) throw new Refusal("Invalid retained file reference.");
    return `${digest(owner)}/${match[1]}/${match[2]}`;
  }
}

/** Text and Office files keep the browser's type. Bun reports text uploads as "text/plain;charset=utf-8". */
function declaredType(file: File) {
  return file.type.split(";")[0]!.trim().toLowerCase() || "application/octet-stream";
}
