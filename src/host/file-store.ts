import { mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { S3Client } from "bun";
import { Refusal } from "./refusal.ts";

/** Per-call options. `timeout` replaces the store's default time limit for this call. */
export interface StoreCall { timeout?: number }

/** Retained bytes by key. Keys are host-built paths such as `owner/import/file.pdf`. */
export interface FileStore {
  /** Saves bytes. A Blob, such as a received upload, is streamed without another full copy. */
  put(key: string, data: Uint8Array | Blob, options?: StoreCall): Promise<void>;
  /** Returns null when no file has this key. */
  get(key: string, options?: StoreCall): Promise<Uint8Array | null>;
  /** The file's size in bytes, or null when no file has this key. */
  size(key: string, options?: StoreCall): Promise<number | null>;
  /** Streams a file's bytes. Callers check that the file exists first. */
  stream(key: string): ReadableStream<Uint8Array>;
  exists(key: string, options?: StoreCall): Promise<boolean>;
  delete(key: string, options?: StoreCall): Promise<void>;
}

export const STORE_TIMEOUT = 30_000;
export const STORE_UNAVAILABLE = "Saved files are unavailable right now. Try again later.";
export const STORE_LATE = "The file store did not respond in time. Try again.";
const validKey = (key: string) => /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/i.test(key) && !key.split("/").includes("..");

/** The file store failed or did not answer in time. The message is safe to show. */
export class StoreUnavailable extends Refusal {}

/** Bounds each call and replaces storage errors, which can name paths or buckets, with one plain message. */
async function guarded<T>(key: string, timeout: number, work: () => Promise<T>): Promise<T> {
  if (!validKey(key)) throw new Refusal("Invalid retained file reference.");
  if (!(timeout > 0)) throw new StoreUnavailable(STORE_LATE);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StoreUnavailable(STORE_LATE)), timeout); });
  try { return await Promise.race([work(), late]); }
  catch (error) {
    if (error instanceof StoreUnavailable) throw error;
    const { name, code } = error as { name?: string; code?: string };
    console.error(`File store request failed (${name ?? "Error"}${code ? ` ${code}` : ""}).`);
    const failure = new StoreUnavailable(STORE_UNAVAILABLE);
    failure.cause = error;
    throw failure;
  } finally { clearTimeout(timer); }
}

const missing = (error: unknown) => ["ENOENT", "NoSuchKey", "ERR_S3_FILE_NOT_FOUND"].includes((error as { code?: string })?.code ?? "");

/** Local development store under `.data/files`. */
export class DiskStore implements FileStore {
  constructor(private readonly directory = resolve(".data/files"), private readonly timeout = STORE_TIMEOUT) {}
  private path(key: string) {
    if (!validKey(key)) throw new Refusal("Invalid retained file reference.");
    const path = resolve(this.directory, key);
    if (!path.startsWith(this.directory + sep)) throw new Refusal("Invalid retained file reference.");
    return path;
  }
  put(key: string, data: Uint8Array | Blob, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => {
      const path = this.path(key);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      if (data instanceof Uint8Array) { await writeFile(path, data, { mode: 0o600 }); return; }
      const handle = await open(path, "w", 0o600);
      try { for await (const chunk of data.stream()) await handle.write(chunk); }
      finally { await handle.close(); }
    });
  }
  get(key: string, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => {
      try { return new Uint8Array(await readFile(this.path(key))); }
      catch (error) { if (missing(error)) return null; throw error; }
    });
  }
  size(key: string, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => {
      try { const found = await stat(this.path(key)); return found.isFile() ? found.size : null; }
      catch (error) { if (missing(error)) return null; throw error; }
    });
  }
  stream(key: string) { return Bun.file(this.path(key)).stream(); }
  exists(key: string, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => {
      try { return (await stat(this.path(key))).isFile(); }
      catch (error) { if (missing(error)) return false; throw error; }
    });
  }
  delete(key: string, options: StoreCall = {}) { return guarded(key, options.timeout ?? this.timeout, () => rm(this.path(key), { force: true })); }
}

/** S3-compatible object storage through Bun's built-in client. */
export class S3Store implements FileStore {
  constructor(private readonly client: S3Client, private readonly timeout = STORE_TIMEOUT) {}
  put(key: string, data: Uint8Array | Blob, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => { await this.client.write(key, data, { type: "application/octet-stream" }); });
  }
  get(key: string, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => {
      try { return await this.client.file(key).bytes(); }
      catch (error) { if (missing(error)) return null; throw error; }
    });
  }
  size(key: string, options: StoreCall = {}) {
    return guarded(key, options.timeout ?? this.timeout, async () => {
      try { return await this.client.size(key); }
      catch (error) { if (missing(error)) return null; throw error; }
    });
  }
  stream(key: string) {
    if (!validKey(key)) throw new Refusal("Invalid retained file reference.");
    return this.client.file(key).stream();
  }
  exists(key: string, options: StoreCall = {}) { return guarded(key, options.timeout ?? this.timeout, () => this.client.exists(key)); }
  delete(key: string, options: StoreCall = {}) { return guarded(key, options.timeout ?? this.timeout, () => this.client.delete(key)); }
}

/** These are the variable names Bun's S3Client reads by default. */
export const S3_VARIABLES = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_REGION", "S3_SESSION_TOKEN"] as const;

/** Uses S3 when S3_BUCKET is set and the local disk otherwise. Partial S3 settings stop startup. */
export function fileStore(env: Record<string, string | undefined> = process.env): FileStore {
  const configured = S3_VARIABLES.filter((name) => env[name]?.trim());
  if (!configured.length) return new DiskStore();
  const absent = (["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const).filter((name) => !env[name]?.trim());
  if (absent.length) throw new Error(`S3 file storage is partly configured. Set ${absent.join(", ")}.`);
  return new S3Store(new S3Client({
    bucket: env.S3_BUCKET, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    endpoint: env.S3_ENDPOINT || undefined, region: env.S3_REGION || undefined, sessionToken: env.S3_SESSION_TOKEN || undefined,
  }));
}
