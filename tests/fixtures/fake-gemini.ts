/**
 * A fake Gemini API for tests: generateContent, the Files API's resumable upload and file status, and the model
 * list. Response shapes follow Google's documented REST answers.
 */
import { DEFAULT_MODEL } from "../../src/host/gemini.ts";
import type { SourceContext } from "../../src/tutor-types.ts";

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

// ---- Canned interactive examples ----
// One lesson example of each kind, about matrix products like the browser fixture's canned lesson. The browser fixture
// (browser-app.ts) adds them to its lesson answers when the instruction carries the interactive-example instruction, one
// kind per answer in this order, and tests/AnswerWidgets.test.ts checks that the host accepts every one of them.

/** The four canned examples, each pointing at `source`, the passage the canned answer cites. */
export function cannedWidgets(source: { material: string; location: string }) {
  return [
    { kind: "slider", title: "One entry of a product", formula: "a * 3 + 2 * b",
      variables: [{ name: "a", label: "First entry of row 1 of A", min: -5, max: 5, step: 1, value: 1 },
        { name: "b", label: "Second entry of column 1 of B", min: -5, max: 5, step: 1, value: 4 }], output: "Entry in row 1, column 1 of AB", source },
    { kind: "table", caption: "Which products are defined", columns: ["A", "B", "AB"],
      rows: [["2 × 3", "3 × 4", "2 × 4"], ["3 × 2", "2 × 2", "3 × 2"], ["1 × 3", "3 × 1", "1 × 1"], ["2 × 3", "2 × 3", "Not defined"]], source },
    { kind: "steps", title: "Forming the entry in row 1, column 1 of AB", steps: ["Take row 1 of A: [1, 2].", "Take column 1 of B: [3, 4].",
      "Multiply the matching entries: 1 × 3 = 3 and 2 × 4 = 8.", "Add the products: 3 + 8 = 11, the entry in row 1, column 1."], source },
    { kind: "choice", question: "A is 2 × 3 and B is 3 × 4. What size is AB?", options: ["2 × 4", "3 × 3", "4 × 2", "AB is not defined"], answer: "2 × 4",
      explanation: "The inner sizes, 3 and 3, match, so AB keeps the outer ones: 2 rows and 4 columns.", source },
  ] as const;
}

/** An example as the tutor writes it into an answer: a fenced block with the example's JSON. */
export function widgetBlock(widget: unknown): string {
  return `\`\`\`stillgotit-widget\n${JSON.stringify(widget, null, 2)}\n\`\`\``;
}

// ---- Canned practice task ----

/** The question of the browser fixture's canned practice task. */
export const CANNED_TASK_QUESTION = "1. Multiply A = [[1, 2], [3, 4]] by B = [[2, 0], [1, 2]].\n\n2. Multiply C = [[2, 1], [0, 3]] by D = [[1, 2], [4, 0]].\n\n" +
  "Show how you form each entry. Explain why changing the order can change the answer.";

/**
 * The browser fixture's canned practice task (browser-app.ts). Like Gemini 4 Argon in the P5 test, it names the cited
 * material by its first file's name, or by its title when it has no file, instead of by its identity, so the fixture's
 * practice flow goes through the host's resolution of names (src/host/tutor-generation.ts). When another source has the
 * same title or file name, which the host would refuse as ambiguous, it cites the identity instead.
 */
export function cannedTask(sources: readonly SourceContext[]) {
  const source = sources[0]!, file = source.data.originals[0];
  const name = file?.name ?? source.data.title, location = file?.renditions[0]?.location ?? "content";
  const unique = sources.filter((item) => item.data.title === name || item.data.originals.some((other) => other.name === name)).length === 1;
  return { question: CANNED_TASK_QUESTION, citations: [{ material: unique ? name : source.material, location }] };
}
