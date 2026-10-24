import type { Collection, Db } from "mongodb";
import type { Gemini } from "./gemini.ts";
import type { StoreCall } from "./file-store.ts";
import { KeyedLocks } from "./locks.ts";
import type { MaterialFiles } from "./material-files.ts";

/** A saved reference is reused while at least one hour remains before Gemini deletes its copy. */
export const REUSE_MARGIN_MS = 60 * 60 * 1000;
/** Used only when Google does not report an expiry. Gemini keeps a file for 48 hours. */
const ASSUMED_LIFETIME_MS = 47 * 60 * 60 * 1000;

/** One host record per retained file, keyed by its file-store key. These are host records, not concept state. */
interface ReferenceRecord { _id: string; name: string; uri: string; mediaType: string; expiresAt: Date; savedAt: Date }

/** What a `fileData` part needs, plus the file-store key to forget if Gemini reports the copy gone. */
export interface FileReference { key: string; mimeType: string; fileUri: string }

export interface ReferenceOptions {
  /** Stops the upload and the wait for ACTIVE. */
  signal?: AbortSignal;
  /** Uploads made during tutor requests take turns across the process, so one such file is in memory at once. */
  exclusive?: boolean;
  /** Bytes the caller already holds, such as the worker's recording. Otherwise the file is read from the store. */
  bytes?: Uint8Array;
  uploadTimeoutMs?: number;
  activeTimeoutMs?: number;
  storeCall?: StoreCall;
}

/** Keeps Gemini Files API references in the host's own MongoDB collection. References never leave the server. */
export class ProviderFiles {
  private readonly records: Collection<ReferenceRecord>;
  private indexes: Promise<unknown> | undefined;
  /** Only one upload of a given file runs at a time; another request for that file waits for it. */
  private readonly uploads = new Map<string, Promise<FileReference>>();
  private readonly turns = new KeyedLocks();

  constructor(database: Db, private readonly gemini: Pick<Gemini, "uploadFile" | "waitForActive">,
    private readonly files: Pick<MaterialFiles, "read" | "storeKey">, private readonly clock = () => new Date(), name = "ProviderFiles") {
    this.records = database.collection(`${name.toLowerCase()}.references`, {
      readPreference: "primary", readConcern: { level: "majority" }, writeConcern: { w: "majority", j: true },
    });
  }

  #ready() {
    // MongoDB removes a record once its expiry has passed.
    this.indexes ??= this.records.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  /** A reference to one retained file, reused while it is still valid and uploaded again otherwise. */
  async reference(owner: string, file: string, mediaType: string, options: ReferenceOptions = {}): Promise<FileReference> {
    const key = this.files.storeKey(owner, file);
    const saved = await this.records.findOne({ _id: key });
    if (saved && saved.mediaType === mediaType && saved.expiresAt.getTime() - this.clock().getTime() >= REUSE_MARGIN_MS) {
      return { key, mimeType: saved.mediaType, fileUri: saved.uri };
    }
    const running = this.uploads.get(key);
    if (running) return await stoppable(running, options.signal);
    const upload = this.#upload(owner, file, key, mediaType, options);
    this.uploads.set(key, upload);
    try { return await upload; }
    finally { if (this.uploads.get(key) === upload) this.uploads.delete(key); }
  }

  /** Forgets the references used in a request after Gemini answered that a referenced file is missing or expired. */
  async forget(keys: readonly string[]): Promise<void> {
    if (keys.length) await this.records.deleteMany({ _id: { $in: [...keys] } });
  }

  async #upload(owner: string, file: string, key: string, mediaType: string, options: ReferenceOptions): Promise<FileReference> {
    const work = async () => {
      const bytes = options.bytes ?? await stoppable(this.files.read(owner, file, options.storeCall), options.signal);
      // The Files API name is the byte digest from the file reference, never the learner's file name.
      const digest = file.slice(file.indexOf("/") + 1, file.lastIndexOf("."));
      const limit = (milliseconds?: number) => {
        const signals = [options.signal, milliseconds ? AbortSignal.timeout(milliseconds) : undefined].filter((signal): signal is AbortSignal => !!signal);
        return signals.length ? AbortSignal.any(signals) : undefined;
      };
      const uploaded = await this.gemini.uploadFile(bytes, { mimeType: mediaType, displayName: digest, signal: limit(options.uploadTimeoutMs) });
      const active = await this.gemini.waitForActive(uploaded, limit(options.activeTimeoutMs));
      const now = this.clock(), reported = active.expirationTime ? new Date(active.expirationTime) : null;
      const expiresAt = reported && Number.isFinite(reported.getTime()) ? reported : new Date(now.getTime() + ASSUMED_LIFETIME_MS);
      // Saved before the tutor call, so a retry after a failed call reuses this copy.
      await this.#ready();
      await this.records.replaceOne({ _id: key }, { name: active.name, uri: active.uri, mediaType, expiresAt, savedAt: now }, { upsert: true });
      return { key, mimeType: mediaType, fileUri: active.uri };
    };
    return options.exclusive ? this.turns.run("tutor-upload", work, options.signal) : work();
  }
}

function stoppable<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work;
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason ?? new Error("Stopped."));
    if (signal.aborted) { stop(); return; }
    signal.addEventListener("abort", stop, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", stop));
  });
}
