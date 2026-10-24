/**
 * A fake Gemini API for tests: generateContent, the Files API's resumable upload and file status, and the model
 * list. Response shapes follow Google's documented REST answers.
 */
import { DEFAULT_MODEL } from "../../src/host/gemini.ts";

const HOST = "https://generativelanguage.googleapis.com";

export interface GeminiCall {
  url: string;
  method: string;
  headers: Headers;
  /** Parsed JSON for JSON bodies; the byte length for raw uploads. */
  body: Record<string, any> | null;
  bytes?: number;
}

export interface UploadedFile { name: string; displayName: string; mimeType: string; size: number; state: string; uri: string; expirationTime: string }

export interface FakeGeminiOptions {
  /** The generateContent answer. The default is a JSON answer `{"answer":"grounded"}`. */
  generate?: (call: GeminiCall) => Response | Promise<Response>;
  /** Answers the start of an upload instead of the fake, for failure cases. */
  startUpload?: (call: GeminiCall) => Response | undefined;
  /** Waits before finishing each upload, to hold uploads open. */
  beforeFinish?: (file: UploadedFile) => Promise<void>;
  /** The state reported after the upload and how many status checks pass before ACTIVE. */
  processing?: number;
  failProcessing?: boolean;
  /** The expiry Google reports for each upload, from the upload time. */
  lifetimeMs?: number;
  now?: () => Date;
  outputTokenLimit?: number | null;
}

export const answer = (text: string, extra: Record<string, unknown> = {}) => Response.json({
  candidates: [{ content: { role: "model", parts: [{ text: "Planning the answer.", thought: true }, { text }] }, finishReason: "STOP", ...extra }],
  modelVersion: DEFAULT_MODEL,
});
export const googleError = (status: number, error: Record<string, unknown>) => Response.json({ error: { code: status, ...error } }, { status });

export function fakeGemini(options: FakeGeminiOptions = {}) {
  const calls: GeminiCall[] = [], uploads: UploadedFile[] = [], files = new Map<string, UploadedFile & { checks: number }>();
  const pending = new Map<string, { displayName: string; mimeType: string; size: number }>();
  const state = { activeUploads: 0, mostUploadsAtOnce: 0 };
  let counter = 0;
  const now = options.now ?? (() => new Date());

  const fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init: RequestInit = {}) => {
    const url = new URL(String(input)), method = init.method ?? "GET", headers = new Headers(init.headers);
    const raw = init.body instanceof Uint8Array || init.body instanceof ArrayBuffer || init.body instanceof Blob;
    const call: GeminiCall = { url: String(input), method, headers, body: null };
    if (raw) call.bytes = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer()).length;
    else if (typeof init.body === "string") call.body = JSON.parse(init.body);
    calls.push(call);
    if (init.signal?.aborted) throw init.signal.reason;

    if (url.pathname === "/upload/v1beta/files" && headers.get("X-Goog-Upload-Command") === "start") {
      const refused = options.startUpload?.(call);
      if (refused) return refused;
      const id = `upload-${++counter}`;
      pending.set(id, { displayName: call.body?.file?.display_name ?? "", mimeType: headers.get("X-Goog-Upload-Header-Content-Type") ?? "",
        size: Number(headers.get("X-Goog-Upload-Header-Content-Length")) });
      return new Response(null, { headers: { "x-goog-upload-url": `${HOST}/upload/v1beta/files?upload_id=${id}&upload_protocol=resumable`, "x-goog-upload-status": "active" } });
    }
    if (url.pathname === "/upload/v1beta/files" && headers.get("X-Goog-Upload-Command") === "upload, finalize") {
      const started = pending.get(url.searchParams.get("upload_id") ?? "");
      if (!started) return googleError(404, { status: "NOT_FOUND", message: "Upload not found." });
      const id = `file${++counter}`, expiration = new Date(now().getTime() + (options.lifetimeMs ?? 48 * 3600_000)).toISOString();
      const file = { name: `files/${id}`, displayName: started.displayName, mimeType: started.mimeType, size: call.bytes ?? 0,
        state: options.failProcessing ? "FAILED" : options.processing ? "PROCESSING" : "ACTIVE", uri: `${HOST}/v1beta/files/${id}`, expirationTime: expiration };
      state.activeUploads++;
      state.mostUploadsAtOnce = Math.max(state.mostUploadsAtOnce, state.activeUploads);
      // Like a real connection, an aborted request stops waiting at once.
      const aborted = new Promise<never>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true }));
      aborted.catch(() => undefined);
      try { await Promise.race([options.beforeFinish?.(file), aborted]); }
      finally { state.activeUploads--; }
      uploads.push(file);
      files.set(file.name, { ...file, checks: 0, state: options.failProcessing ? "FAILED" : file.state });
      return Response.json({ file: { ...describe(file), state: file.state === "FAILED" ? "PROCESSING" : file.state } });
    }
    if (url.pathname.startsWith("/v1beta/files/") && method === "GET") {
      const file = files.get(url.pathname.slice("/v1beta/".length));
      if (!file) return googleError(404, { status: "NOT_FOUND", message: "File not found." });
      file.checks++;
      if (file.state === "PROCESSING" && file.checks >= (options.processing ?? 0)) file.state = "ACTIVE";
      return Response.json(describe(file));
    }
    if (url.pathname.endsWith(":generateContent")) return options.generate ? options.generate(call) : answer('{"answer":"grounded"}');
    if (url.pathname.startsWith("/v1beta/models/") && method === "GET") {
      if (options.outputTokenLimit === null) return googleError(503, { status: "UNAVAILABLE", message: "Try later." });
      return Response.json({ name: `models/${decodeURIComponent(url.pathname.split("/").at(-1)!)}`, inputTokenLimit: 1_048_576, outputTokenLimit: options.outputTokenLimit ?? 65_536 });
    }
    return googleError(404, { status: "NOT_FOUND", message: `No route for ${method} ${url.pathname}` });
  }) as typeof globalThis.fetch;

  const generations = () => calls.filter((call) => call.url.endsWith(":generateContent"));
  return { fetch, calls, uploads, files, state, generations };
}

function describe(file: UploadedFile) {
  return { name: file.name, displayName: file.displayName, mimeType: file.mimeType, sizeBytes: String(file.size), createTime: "2026-10-23T12:00:00.000000Z",
    updateTime: "2026-10-23T12:00:00.000000Z", expirationTime: file.expirationTime, sha256Hash: "ZmFrZQ==", uri: file.uri, state: file.state, source: "UPLOADED" };
}
