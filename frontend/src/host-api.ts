import type { StillGotItHttp } from "../../generated/wire.ts";
import { errorMessage } from "./api.ts";

type CourseId = StillGotItHttp["/courses/read"]["input"]["course"];
type MaterialId = StillGotItHttp["/courses/materials/read"]["input"]["material"];

/**
 * A host route that did not succeed. `code` is the app's error code, such as `UPLOAD_BUSY`, and the message is the
 * sentence to show. `answered` is false when no answer from the app arrived: the network failed, the browser stopped
 * waiting (`TIMEOUT`) or the caller cancelled (`CANCELLED`), or something other than the app answered
 * (`NOT_APP_ANSWER`), such as a proxy's error page.
 */
export class HostError extends Error {
  constructor(message: string, readonly code: string, readonly answered: boolean) {
    super(message);
    this.name = "HostError";
  }
}

const NO_ANSWER = "The server did not answer in time. Try again. Your saved work is still available.";
const NOT_FINISHED = "The request could not finish. Your saved work is still available.";

/** Why no answer arrived. */
function noAnswer(signal: AbortSignal | undefined, code = "NETWORK_ERROR"): HostError {
  if (signal?.aborted) {
    const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
    return timedOut ? new HostError(NO_ANSWER, "TIMEOUT", false) : new HostError("The request was cancelled.", "CANCELLED", false);
  }
  return code === "NETWORK_ERROR" ? new HostError(errorMessage("NETWORK_ERROR"), code, false) : new HostError(NO_ANSWER, code, false);
}

async function send(path: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`/api${path}`, { method: "POST", credentials: "same-origin", signal,
      headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
      body: body instanceof FormData ? body : JSON.stringify(body) });
  } catch {
    throw noAnswer(signal);
  }
}

/** The app answers with a JSON object. A proxy timeout or outage answers with a page instead. */
async function appAnswer(response: Response, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const result: unknown = await response.json().catch(() => undefined);
  if (result === null || typeof result !== "object" || Array.isArray(result)) throw noAnswer(signal, "NOT_APP_ANSWER");
  return result as Record<string, unknown>;
}

/** The app's refusal, with its own sentence when it sent one. */
function refusal(result: Record<string, unknown>, status: number, fallback = NOT_FINISHED): HostError {
  const code = typeof result.error === "string" ? result.error : `HTTP_${status}`;
  const detail = typeof result.detail === "string" && result.detail.trim() ? result.detail
    : code === "UNAUTHORIZED" ? errorMessage("UNAUTHORIZED") : fallback;
  return new HostError(detail, code, true);
}

/** File and provider transport sits beside the generated concept endpoints. Failures throw a HostError. */
export async function hostRequest<T>(path: string, body: unknown = {}, signal?: AbortSignal): Promise<T> {
  const response = await send(path, body, signal);
  const result = await appAnswer(response, signal);
  if (!response.ok || result.error) throw refusal(result, response.status);
  return result as T;
}

/** What the upload route answers: the saved material, or an import that finishes later. */
export type UploadAnswer = { material: MaterialId } | { requestId: string; state: "TRANSCRIBING" | "SAVING" };

/** The longest the browser waits for an upload. The route answers within 85 seconds; Cloudflare gives up after 100. */
const UPLOAD_WAIT_MS = 120_000;

/** Sends an upload form (`course`, `title`, `requestId`, `files`) to the upload route. */
export async function importMaterial(form: FormData): Promise<UploadAnswer> {
  const signal = AbortSignal.timeout(UPLOAD_WAIT_MS);
  const result = await hostRequest<Record<string, unknown>>("/courses/materials/add", form, signal);
  if (typeof result.material === "string") return { material: result.material as MaterialId };
  if (typeof result.requestId === "string" && (result.state === "TRANSCRIBING" || result.state === "SAVING")) {
    return { requestId: result.requestId, state: result.state };
  }
  throw noAnswer(undefined, "NOT_APP_ANSWER");
}

/**
 * The request-ID rule after a failed upload ("Accepting an upload" in design/compositions/Materials.md). A removed
 * import, or a request ID that belongs to different files or a different title, needs a new request ID. Any other
 * refusal, and an upload that got no answer, keeps the request ID, so a retry continues from saved progress.
 */
export function refusalStartsNewImport(problem: unknown): boolean {
  return problem instanceof HostError && problem.answered && (problem.code === "IMPORT_REMOVED" || problem.code === "IMPORT_REQUEST_CONFLICT");
}

/**
 * Uploads a file that must be attached to an answer at once. A photo or PDF is saved during the upload; when the
 * upload answers with an import that finishes later, there is nothing to attach yet, and the HostError's code is
 * that answer's state. The caller keeps the form's request ID until a material arrives, so trying again after
 * `SAVING` answers the same material instead of saving a second one.
 */
export async function uploadMaterial(form: FormData): Promise<{ material: MaterialId }> {
  const answer = await importMaterial(form);
  if ("material" in answer) return answer;
  throw new HostError(answer.state === "TRANSCRIBING"
    ? "This recording was added to Course materials to be transcribed, so it can't be attached here. Attach a photo of your work."
    : "Your work was saved but isn't ready to attach yet. Try again in a minute.", answer.state, true);
}

/** One unfinished import in the library ("Unfinished imports in the library" in design/compositions/Materials.md). */
export type ImportEntry = {
  requestId: string;
  title: string;
  state: "TRANSCRIBING" | "SAVING" | "FAILED";
  files: { name: string; state: "DONE" | "WAITING" | "TRANSCRIBING" | "FAILED" }[];
  detail?: string;
  canRetry: boolean;
  canRemove: boolean;
};
export type ImportListing = { imports: ImportEntry[]; saved: MaterialId[] };

const importStates = new Set(["TRANSCRIBING", "SAVING", "FAILED"]), fileStates = new Set(["DONE", "WAITING", "TRANSCRIBING", "FAILED"]);
function isEntry(value: unknown): value is ImportEntry {
  const entry = value as Partial<Record<keyof ImportEntry, unknown>> | null;
  return !!entry && typeof entry.requestId === "string" && typeof entry.title === "string" && importStates.has(entry.state as string) &&
    Array.isArray(entry.files) && entry.files.every((file: { name?: unknown; state?: unknown } | null) =>
      typeof file?.name === "string" && fileStates.has(file.state as string)) &&
    (entry.detail === undefined || typeof entry.detail === "string") && typeof entry.canRetry === "boolean" && typeof entry.canRemove === "boolean";
}

/** Lists the course's unfinished imports. The route first saves every import whose transcripts are finished. */
export async function listImports(course: CourseId): Promise<ImportListing> {
  const result = await hostRequest<Record<string, unknown>>("/courses/materials/imports", { course });
  if (!Array.isArray(result.imports) || !result.imports.every(isEntry) ||
    !Array.isArray(result.saved) || !result.saved.every((item) => typeof item === "string")) throw noAnswer(undefined, "NOT_APP_ANSWER");
  return { imports: result.imports, saved: result.saved as MaterialId[] };
}

/** Retries an import's failed transcriptions. Answers the import's entry. */
export async function retryImport(requestId: string): Promise<ImportEntry> {
  const result = await hostRequest<unknown>("/courses/materials/imports/retry", { requestId });
  if (!isEntry(result)) throw noAnswer(undefined, "NOT_APP_ANSWER");
  return result;
}

/** Removes an unfinished import and its retained files. */
export async function removeImport(requestId: string): Promise<void> {
  await hostRequest<Record<string, never>>("/courses/materials/imports/remove", { requestId });
}

/**
 * Reads one saved file of a material through the file route, which checks the learner's access first. The bytes
 * come back as a local object of the file's own media type, ready to view, play, or download.
 */
export async function materialFile(material: MaterialId, file: string, mediaType: string, signal?: AbortSignal): Promise<Blob> {
  const response = await send("/courses/materials/file", { material, file }, signal);
  if (response.ok && response.headers.get("Content-Type")?.startsWith("application/octet-stream")) {
    let bytes: Blob;
    try { bytes = await response.blob(); }
    catch { throw noAnswer(signal); }
    return bytes.slice(0, bytes.size, mediaType);
  }
  throw refusal(await appAnswer(response, signal), response.status, "That file could not be opened. Try again.");
}

/** Whether the server can reach Gemini. `reason` explains why AI features are off. */
export type AIStatus = { available: boolean; reason: string };
export function aiStatus() { return hostRequest<AIStatus>("/ai/status"); }
