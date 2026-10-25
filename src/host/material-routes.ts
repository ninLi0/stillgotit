import type { InvocationResult } from "@mit-sdg/sync-engine/boundary";
import type { MediaList } from "../media.ts";
import {
  ImportAlreadySaved, ImportNotRetryable, ImportRequestConflict, type ImportOperation, type MaterialImportStore,
} from "../storage/MaterialImportStore.ts";
import { StoreUnavailable } from "./file-store.ts";
import type { KeyedLocks } from "./locks.ts";
import { READ_TIMEOUT, TOO_LARGE_UPLOAD, UPLOAD_BODY_LIMIT, type MaterialFiles } from "./material-files.ts";
import { Refusal } from "./refusal.ts";
import { Budget, QUEUE_WAIT_MS, STORE_WRITE_MS, UPLOAD_BUDGET_MS, UploadQueue, UploadTimeout } from "./upload-queue.ts";

export const IMPORT_REMOVED = "This import was removed. Choose the files again.";
export const IMPORT_REQUEST_CONFLICT = "This upload doesn't match the import started with these details. Choose the files again to start a new import.";
export const IMPORT_NOT_RETRYABLE = "This import can't be retried. Remove it and upload the files again.";
export const IMPORT_ALREADY_SAVED = "This import is already in your library. Reload the page to see it.";
export const IMPORT_UNAVAILABLE = "This import is no longer available. Reload the page.";
export const REMOVE_FAILED = "This import could not be removed. Ask the app owner for help.";
/** The concept refused the prepared input before saving anything, so no material holds the key. */
export const SAVE_INVALID = "This import could not be saved. Remove it and upload the files again.";
/** A refusal that does not go away: a material may already hold the key. */
export const SAVE_STUCK = "This import could not be saved yet. Your files are kept. Ask the app owner for help.";
/** A listing stops waiting for locks after this long and leaves the rest of its imports SAVING. */
export const LIST_WAIT_MS = 60_000;
/** After the upload's answer, a stuck store or database call holds the upload queue for at most this long. */
const QUEUE_HOLD_AFTER_BUDGET_MS = STORE_WRITE_MS;

/** AddMaterial refusals that mean the input was refused before anything was saved. */
const INVALID_INPUT = new Set(["INVALID_TUTORING_MATERIAL", "INVALID_MATERIAL_IMPORT_KEY", "INVALID_INPUT"]);

export type FileState = "DONE" | "WAITING" | "TRANSCRIBING" | "FAILED";
/** One unfinished import in the library. */
export interface ImportEntry {
  requestId: string;
  title: string;
  state: "TRANSCRIBING" | "SAVING" | "FAILED";
  files: { name: string; state: FileState }[];
  detail?: string;
  canRetry: boolean;
  canRemove: boolean;
}

type SaveOutcome =
  | { kind: "saved"; material: string }
  | { kind: "invalid" | "refused"; code: string }
  | { kind: "unauthorized" | "forbidden" | "temporary" };

export interface MaterialRouteOptions {
  imports: MaterialImportStore;
  files: MaterialFiles;
  locks: KeyedLocks;
  clock: () => Date;
  /** The session's learner, or null. */
  learner(request: Request): Promise<string | null>;
  session(request: Request): string | null;
  courseReady(owner: string, course: string): Promise<boolean>;
  /** The private AddMaterial endpoint, run to completion. */
  addMaterial(input: Record<string, unknown>): Promise<InvocationResult>;
  readMaterial(session: string | null, material: string): Promise<InvocationResult>;
  /** Whether the server has a Gemini key, which recordings and videos need. */
  recordingsAvailable(): boolean;
  /** Asks the transcription worker for a turn. */
  wake(): void;
  limits?: { uploadBudgetMs?: number; queueWaitMs?: number; storeWriteMs?: number; readTimeoutMs?: number; listWaitMs?: number };
  log?: (message: string) => void;
}

const noStore = { "Cache-Control": "no-store" };
export const failure = (error: string, status: number) => Response.json({ error }, { status, headers: noStore });
export const refusal = (error: Refusal) => Response.json({ error: error.code, detail: error.message }, { status: error.status, headers: noStore });
const answer = (value: unknown) => Response.json(value, { headers: noStore });
const unfinished = (requestId: string, state: "TRANSCRIBING" | "SAVING") => answer({ requestId, state });
const validRequestId = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 100;

/**
 * Reads a multipart body while counting its bytes, and stops reading as soon as it passes `limit`.
 * Returns null for a malformed form.
 */
export async function readForm(request: Request, limit: number, sentence: string): Promise<FormData | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(type)) return null;
  const declared = request.headers.get("Content-Length");
  if (declared !== null && Number(declared) > limit) {
    await request.body?.cancel().catch(() => undefined);
    throw new Refusal(sentence);
  }
  if (!request.body) return null;
  let size = 0;
  const counted = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      size += chunk.byteLength;
      if (size > limit) controller.error(new Refusal(sentence));
      else controller.enqueue(chunk);
    },
  }));
  try { return await new Response(counted, { headers: { "Content-Type": type } }).formData(); }
  catch {
    if (size > limit) throw new Refusal(sentence);
    return null;
  }
}

/** The upload route, the library's import routes, and the file route. */
export function createMaterialRoutes(options: MaterialRouteOptions) {
  const { imports, files, locks, clock } = options;
  const limits = {
    uploadBudgetMs: UPLOAD_BUDGET_MS, queueWaitMs: QUEUE_WAIT_MS, storeWriteMs: STORE_WRITE_MS, readTimeoutMs: READ_TIMEOUT, listWaitMs: LIST_WAIT_MS,
    ...options.limits,
  };
  const log = options.log ?? ((message: string) => console.warn(message));
  const queue = new UploadQueue(limits.queueWaitMs);

  /**
   * Saves a READY import as a material. The caller holds the import's lock; this takes the learner's lock,
   * rechecks the session and course, calls AddMaterial with the frozen input, and records COMPLETE.
   */
  function save(request: Request, owner: string, operation: ImportOperation, signal?: AbortSignal): Promise<SaveOutcome> {
    return locks.run(`user:${owner}`, async (): Promise<SaveOutcome> => {
      const session = options.session(request);
      if (!session || await options.learner(request) !== owner) return { kind: "unauthorized" };
      if (!await options.courseReady(owner, operation.request.scope)) return { kind: "forbidden" };
      const prepared = operation.prepared!, { requestId, importKey } = operation;
      let result: InvocationResult;
      try {
        result = await options.addMaterial({ session, course: prepared.scope, importKey: prepared.importKey, title: prepared.title,
          locator: prepared.locator, content: prepared.content, originals: prepared.originals, origin: prepared.origin });
      } catch (error) {
        log(`Saving import ${requestId} (import key ${importKey}) failed (${errorName(error)}); the next listing tries again.`);
        return { kind: "temporary" };
      }
      if (result.ok) {
        const material = (result.value as { material?: unknown } | null)?.material;
        if (typeof material !== "string") return { kind: "temporary" };
        try { await imports.complete({ owner, requestId, revision: operation.revision, material }); }
        catch (error) {
          // The material is saved. The next request calls AddMaterial again and receives the same material.
          log(`Recording import ${requestId} (import key ${importKey}) as saved failed (${errorName(error)}); the next listing tries again.`);
          return { kind: "temporary" };
        }
        return { kind: "saved", material };
      }
      const code = refusalCode(result.error);
      if (code === "NOT_SIGNED_IN") return { kind: "unauthorized" };
      if (code === "COURSE_UNAVAILABLE") return { kind: "forbidden" };
      if (INVALID_INPUT.has(code)) {
        log(`Saving import ${requestId} (import key ${importKey}) was refused: ${code}. No material was saved for this key.`);
        return { kind: "invalid", code };
      }
      if (result.error.kind === "domain") {
        log(`Saving import ${requestId} (import key ${importKey}) was refused: ${code}. A material may already hold this key.`);
        return { kind: "refused", code };
      }
      log(`Saving import ${requestId} (import key ${importKey}) failed (${code}); the next listing tries again.`);
      return { kind: "temporary" };
    }, signal);
  }

  /** `/api/courses/materials/add`. The route answers within its budget, from saved progress when it can. */
  async function upload(request: Request): Promise<Response> {
    const owner = await options.learner(request);
    if (!owner) return failure("UNAUTHORIZED", 401);
    if (!/^multipart\/form-data\s*;/i.test(request.headers.get("Content-Type") ?? "")) return failure("INVALID_REQUEST", 400);
    const budget = new Budget(limits.uploadBudgetMs, limits.storeWriteMs);
    let release: (() => void) | undefined, requestId = "", saving = false;
    const leave = () => release?.();

    const work = (async (): Promise<Response> => {
      // The upload takes its turn in the queue before its body is read.
      release = await queue.enter();
      const form = await readForm(request, UPLOAD_BODY_LIMIT, TOO_LARGE_UPLOAD);
      if (!form) return failure("INVALID_REQUEST", 400);
      const course = form.get("course"), title = form.get("title"), id = form.get("requestId"), uploaded = form.getAll("files");
      if (typeof course !== "string" || typeof title !== "string" || !title.trim() || title.length > 160 || !validRequestId(id) ||
        !uploaded.every((file): file is File => file instanceof File)) return failure("INVALID_REQUEST", 400);
      requestId = id;
      if (!await options.courseReady(owner, course)) return failure("FORBIDDEN", 403);
      // "Before saving" checks. A refusal here saves nothing.
      const inspected = await files.inspect(uploaded, { recordings: options.recordingsAvailable() });
      return locks.run(`import:${owner}:${requestId}`, async () => {
        let operation: ImportOperation;
        try {
          operation = await imports.getOrCreate({ owner, requestId, request: { scope: course, title, origin: "COURSE", sources: inspected.sources } });
        } catch (error) {
          if (error instanceof ImportRequestConflict) throw new Refusal(IMPORT_REQUEST_CONFLICT, "IMPORT_REQUEST_CONFLICT", 409);
          throw error;
        }
        if (operation.stage === "DISCARDED") throw new Refusal(IMPORT_REMOVED, "IMPORT_REMOVED", 409);
        if (operation.stage === "CREATED") {
          const sources = await files.retain(operation, uploaded, inspected, () => budget.storeCall());
          operation = await imports.saveSources({ owner, requestId, revision: operation.revision, sources });
        }
        if (operation.stage === "SOURCES_SAVED") {
          // "While reading" checks, from the bytes received in this request.
          const read = await files.readUpload(operation, uploaded, inspected.detected, limits.readTimeoutMs);
          leave();
          if (read.recordings.length) {
            operation = await imports.startTranscription({ owner, requestId, revision: operation.revision, partial: read.originals, recordings: read.recordings });
            options.wake();
          } else {
            operation = await imports.savePrepared({ owner, requestId, revision: operation.revision, prepared: {
              owner, scope: course, importKey: operation.importKey, title, locator: `upload:${operation.importKey}`,
              content: read.content, originals: read.originals, origin: "COURSE",
            } });
          }
        } else leave();
        if (operation.stage === "TRANSCRIBING") return unfinished(requestId, "TRANSCRIBING");
        if (operation.stage === "COMPLETE") return answer({ material: operation.material });
        saving = true;
        let outcome: SaveOutcome;
        try { outcome = await save(request, owner, operation, budget.signal); }
        catch (error) {
          // The learner's lock was still held when the budget ran out. The next listing saves the material.
          if (budget.expired) return unfinished(requestId, "SAVING");
          throw error;
        }
        if (outcome.kind === "saved") return answer({ material: outcome.material });
        if (outcome.kind === "unauthorized") return failure("UNAUTHORIZED", 401);
        if (outcome.kind === "forbidden") return failure("FORBIDDEN", 403);
        // The import is READY. The listing shows it and saves it, or explains why it can't.
        return unfinished(requestId, "SAVING");
      }, budget.signal);
    })();

    // The queue is released after reading, or when the work ends, and never more than 30 seconds after the budget.
    void work.catch(() => undefined).finally(() => { leave(); budget.dispose(); });
    void budget.expiry.then(() => { const timer = setTimeout(leave, QUEUE_HOLD_AFTER_BUDGET_MS); timer.unref?.(); });
    try {
      const outcome = await Promise.race([work, budget.expiry.then(() => null)]);
      if (outcome) return outcome;
      return saving ? unfinished(requestId, "SAVING") : refusal(new UploadTimeout());
    } catch (error) {
      // A store call cut short by the end of the budget is the budget running out.
      if (error instanceof StoreUnavailable && budget.remaining() <= 10) return refusal(new UploadTimeout());
      if (error instanceof Refusal) return refusal(error);
      throw error;
    }
  }

  /** `/api/courses/materials/imports`: saves every READY import, then lists the unfinished ones. */
  async function list(request: Request, owner: string, body: Record<string, unknown>): Promise<Response> {
    const course = body.course;
    if (typeof course !== "string") return failure("INVALID_REQUEST", 400);
    if (!await options.courseReady(owner, course)) return failure("FORBIDDEN", 403);
    const saved: string[] = [], invalid = new Set<string>(), stuck = new Set<string>();
    const wait = AbortSignal.timeout(limits.listWaitMs);
    for (const ready of (await imports.pending({ owner, course })).filter((operation) => operation.stage === "READY")) {
      let outcome: SaveOutcome | null;
      try {
        outcome = await locks.run(`import:${owner}:${ready.requestId}`, async () => {
          // Another request may have saved it while this one waited.
          const operation = await imports.get({ owner, requestId: ready.requestId });
          return operation?.stage === "READY" ? save(request, owner, operation, wait) : null;
        }, wait);
      } catch (error) {
        if (!wait.aborted) throw error;
        break;
      }
      if (!outcome) continue;
      if (outcome.kind === "saved") saved.push(outcome.material);
      else if (outcome.kind === "unauthorized") return failure("UNAUTHORIZED", 401);
      else if (outcome.kind === "forbidden") return failure("FORBIDDEN", 403);
      else if (outcome.kind === "invalid") invalid.add(ready.requestId);
      else if (outcome.kind === "refused") stuck.add(ready.requestId);
    }
    const now = clock();
    const listed = (await imports.pending({ owner, course })).map((operation) => entry(operation, now, invalid.has(operation.requestId), stuck.has(operation.requestId)));
    return answer({ imports: listed, saved });
  }

  /**
   * Reads an import under its lock, or answers why it is not available to this learner. The import is found by
   * the session's learner and the request ID together, so a request ID never reaches another learner's import.
   */
  async function available(owner: string, requestId: string): Promise<ImportOperation | Response> {
    const operation = await imports.get({ owner, requestId });
    if (!operation || !await options.courseReady(owner, operation.request.scope)) {
      return refusal(new Refusal(IMPORT_UNAVAILABLE, "IMPORT_UNAVAILABLE", 404));
    }
    if (operation.stage === "COMPLETE") return refusal(new Refusal(IMPORT_ALREADY_SAVED, "IMPORT_ALREADY_SAVED", 409));
    return operation;
  }

  /** `/api/courses/materials/imports/retry`. */
  async function retry(_request: Request, owner: string, body: Record<string, unknown>): Promise<Response> {
    const requestId = body.requestId;
    if (!validRequestId(requestId)) return failure("INVALID_REQUEST", 400);
    return locks.run(`import:${owner}:${requestId}`, async () => {
      const found = await available(owner, requestId);
      if (found instanceof Response) return found;
      // Only listed imports can be retried; a removed import or one still being uploaded is not available.
      if (found.stage !== "TRANSCRIBING" && found.stage !== "READY") return refusal(new Refusal(IMPORT_UNAVAILABLE, "IMPORT_UNAVAILABLE", 404));
      let operation: ImportOperation | null;
      try { operation = await imports.retry({ owner, requestId }); }
      catch (error) {
        if (error instanceof ImportNotRetryable) return refusal(new Refusal(IMPORT_NOT_RETRYABLE, "IMPORT_NOT_RETRYABLE", 409));
        throw error;
      }
      if (!operation) return refusal(new Refusal(IMPORT_UNAVAILABLE, "IMPORT_UNAVAILABLE", 404));
      if (operation.revision !== found.revision) options.wake();
      return answer(entry(operation, clock(), false, false));
    });
  }

  /** `/api/courses/materials/imports/remove`. */
  async function remove(request: Request, owner: string, body: Record<string, unknown>): Promise<Response> {
    const requestId = body.requestId;
    if (!validRequestId(requestId)) return failure("INVALID_REQUEST", 400);
    try {
      return await locks.run(`import:${owner}:${requestId}`, async () => {
        const found = await available(owner, requestId);
        if (found instanceof Response) return found;
        if (found.stage === "DISCARDED") return await deleteFiles(found);
        if (found.stage !== "READY") {
          const discarded = await imports.discard({ owner, requestId });
          return discarded ? await deleteFiles(discarded) : refusal(new Refusal(IMPORT_UNAVAILABLE, "IMPORT_UNAVAILABLE", 404));
        }
        // A READY import may already be a material. Only a refusal as invalid shows that no material holds its key.
        const outcome = await save(request, owner, found);
        if (outcome.kind === "saved") return refusal(new Refusal(IMPORT_ALREADY_SAVED, "IMPORT_ALREADY_SAVED", 409));
        if (outcome.kind === "unauthorized") return failure("UNAUTHORIZED", 401);
        if (outcome.kind === "forbidden") return refusal(new Refusal(IMPORT_UNAVAILABLE, "IMPORT_UNAVAILABLE", 404));
        if (outcome.kind !== "invalid") return refusal(new Refusal(REMOVE_FAILED));
        const discarded = await imports.discard({ owner, requestId, invalidInput: true });
        return discarded ? await deleteFiles(discarded) : refusal(new Refusal(IMPORT_UNAVAILABLE, "IMPORT_UNAVAILABLE", 404));
      });
    } catch (error) {
      if (error instanceof ImportAlreadySaved) return refusal(new Refusal(IMPORT_ALREADY_SAVED, "IMPORT_ALREADY_SAVED", 409));
      throw error;
    } finally {
      // The worker finishes any deletion that failed here, and drops a transcription of a removed import.
      options.wake();
    }
  }

  /** Deletes a removed import's files. The import is removed even when a deletion fails; the worker finishes it. */
  async function deleteFiles(operation: ImportOperation): Promise<Response> {
    if (!operation.filesDeleted) {
      try {
        await files.deleteImport(operation);
        await imports.markFilesDeleted(operation);
      } catch (error) { log(`Deleting the files of removed import ${operation.requestId} failed (${errorName(error)}); the worker tries again.`); }
    }
    return answer({});
  }

  /** `/api/courses/materials/file`: checks access through ReadMaterial, then streams the exact saved file. */
  async function file(request: Request, owner: string, body: Record<string, unknown>): Promise<Response> {
    if (typeof body.material !== "string") return failure("INVALID_REQUEST", 400);
    const permitted = await options.readMaterial(options.session(request), body.material);
    if (!permitted.ok) return failure("FORBIDDEN", 403);
    const originals = (permitted.value as { originals: MediaList }).originals;
    const allowed = originals.flatMap((item) => [item.file, ...item.renditions.flatMap((part) => part.kind === "IMAGE" ? [part.file] : [])]);
    if (typeof body.file !== "string" || !allowed.includes(body.file)) return failure("FORBIDDEN", 403);
    const { stream, size } = await files.open(owner, body.file);
    return new Response(stream, { headers: {
      "Content-Type": "application/octet-stream", "Content-Length": String(size), "Content-Disposition": "attachment",
      "X-Content-Type-Options": "nosniff", ...noStore,
    } });
  }

  return { upload, list, retry, remove, file, save };
}

/** The library's view of one TRANSCRIBING or READY import. */
export function entry(operation: ImportOperation, now: Date, invalid: boolean, stuck: boolean): ImportEntry {
  const recordings = operation.recordings ?? [];
  const references = operation.partial ?? operation.sources ?? operation.prepared?.originals ?? [];
  const files = operation.request.sources.map((source, i) => {
    const recording = recordings.find((item) => item.file === references[i]?.file);
    const state: FileState = !recording || recording.status === "DONE" ? "DONE" : recording.status === "FAILED" ? "FAILED"
      : recording.claim && recording.claim.until.getTime() > now.getTime() ? "TRANSCRIBING" : "WAITING";
    return { name: source.kind === "UPLOAD" ? source.name : source.locator, state };
  });
  const failures = [
    ...operation.failure ? [operation.failure] : [],
    ...recordings.flatMap((recording) => recording.status === "FAILED" && recording.failure ? [recording.failure] : []),
  ];
  const failed = recordings.some((recording) => recording.status === "FAILED");
  const final = failures.some((item) => !item.retryable);
  const base = { requestId: operation.requestId, title: operation.request.title };
  if (operation.stage === "READY") {
    return invalid ? { ...base, state: "FAILED", files, detail: SAVE_INVALID, canRetry: false, canRemove: true }
      : { ...base, state: "SAVING", files, ...stuck ? { detail: SAVE_STUCK } : {}, canRetry: false, canRemove: false };
  }
  const waiting = recordings.some((recording) => recording.status === "WAITING");
  const state = final || failed && !waiting ? "FAILED" : "TRANSCRIBING";
  return { ...base, state, files, ...failures[0] ? { detail: failures[0].sentence } : {}, canRetry: failed && !final, canRemove: true };
}

function refusalCode(error: Exclude<InvocationResult, { ok: true }>["error"]): string {
  if (error.kind === "framework") return error.code;
  const value = error.value as unknown;
  if (typeof value === "string") return value;
  const record = value as { error?: unknown; code?: unknown } | null;
  return typeof record?.error === "string" ? record.error : typeof record?.code === "string" ? record.code : "UNKNOWN_REFUSAL";
}

/** Error names only. Messages can hold database or provider details. */
function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "unknown error";
}
