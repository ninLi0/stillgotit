import { admissions, composition as Access } from "../compositions/access.ts";
import { tutorRefusals } from "../compositions/settings.ts";
import { gradedConfirmInput, gradedExtractInput, learningInput, structuredInput, tutorChoiceInput } from "../compositions/reusable/inputs.ts";
import { levelSupported, modelOffered } from "../computations/tutor.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { createGateway, type EndpointValidator, type Invoker, type InvocationResult, type InvokeOptions } from "@mit-sdg/sync-engine/boundary";
import { executionLimits, type assembleApplication } from "../assembly.ts";
import type { Attempt } from "../concepts/Federating/Federating.ts";
import type { Session } from "../concepts/Sessioning/Sessioning.ts";
import type { RegistrationRecoveryStore } from "../storage/RegistrationRecoveryStore.ts";
import { ATTEMPT_COOKIE, BODY_LIMIT, SESSION_COOKIE, refusalDetail, stillGotItPolicy } from "./http-policy.ts";
import { KeyedLocks } from "./locks.ts";
import type { Gemini } from "./gemini.ts";
import type { TutorFailures } from "./tutor-generation.ts";
import type { MaterialFiles } from "./material-files.ts";
import type { MaterialImportStore } from "../storage/MaterialImportStore.ts";
import { createMaterialRoutes, failure, readForm, refusal, type MaterialRouteOptions } from "./material-routes.ts";
import { Refusal } from "./refusal.ts";
import { AUDIO_LIMIT } from "./gemini.ts";

/** The dictation route reads at most a 15 MB recording plus the rest of its form. */
export const DICTATION_BODY_LIMIT = AUDIO_LIMIT + 1024 * 1024;
const DICTATION_TOO_LARGE = "Use an audio recording under 15 MB.";

type Application = ReturnType<typeof assembleApplication>;

// Graded commands run like learning commands, with their own input check. Reading earlier imports is not a command.
const gradedCommands: Record<string, EndpointValidator> = { "/courses/graded/extract": gradedExtractInput, "/courses/graded/confirm": gradedConfirmInput };
/** Commands that run under the learner's lock after admission, with the tutor's failure reason added over HTTP. Paths exclude `/api`. */
const learnerCommand = (path: string) => path.startsWith("/learning/") || path.startsWith("/planning/") || path === "/courses/skills/suggest" || Object.hasOwn(gradedCommands, path);
const commandInput = (path: string, value: unknown) => (gradedCommands[path] ?? learningInput)(value);
/** Course changes that run under the learner's lock, over HTTP and through the native gateway. Paths exclude `/api`. */
const courseCommands = new Set(["/courses/create", "/courses/units/add", "/courses/units/emphasis", "/courses/skills/propose",
  "/courses/skills/edit", "/courses/skills/confirm", "/courses/skills/details", "/courses/skills/revise", "/courses/skills/sources/add",
  "/courses/skills/prerequisites", "/courses/skills/archive", "/courses/skills/restore"]);

/**
 * An answer from the exported runtime gateway. A refusal whose code has a sentence also carries that sentence as
 * `detail` beside its code, as the same refusal does over HTTP.
 */
export type RuntimeAnswer = InvocationResult | { ok: false; error: { kind: "domain"; value: unknown; detail: string } };

export function createApplicationHttp({ application, recovery, publicOrigin, clock = () => new Date(), gemini, failures, files, imports, transcription, limits, log }: {
  application: Application;
  recovery: Pick<RegistrationRecoveryStore, "getOrCreate">;
  publicOrigin: string;
  clock?: () => Date;
  gemini?: Pick<Gemini, "status" | "transcribe">;
  failures?: TutorFailures;
  files?: MaterialFiles;
  imports?: MaterialImportStore;
  /** The transcription worker, woken after an upload saves TRANSCRIBING and after a retry or removal. */
  transcription?: { wake(): void };
  limits?: MaterialRouteOptions["limits"];
  log?: (message: string) => void;
}) {
  const rawGateway = createGateway({ application, executionLimits });
  // The HTTP adapter answers a refusal with its public category alone, but the gateway's answer still names the code:
  // `{ kind: "domain", value: CODE }`. The adapter accepts only the gateway that createGateway registered for this
  // application, so the code is noted by wrapping that gateway's own invoke. `explained` then adds the code's sentence.
  const refusals = new AsyncLocalStorage<{ code?: string }>();
  const invokeGateway = rawGateway.invoke.bind(rawGateway);
  rawGateway.invoke = async (path, input, options) => {
    const result = await invokeGateway(path, input, options);
    const waiting = refusals.getStore();
    if (waiting && !result.ok && result.error.kind === "domain" && typeof result.error.value === "string") waiting.code = result.error.value;
    return result;
  };
  const policy = stillGotItPolicy(publicOrigin);
  const inner = createHttpHandler({ application, gateway: rawGateway, policy });
  const locks = new KeyedLocks();
  const { CommonsFederating, Registering, Sessioning } = application.concepts;

  /** Evaluates the path's admission formers in order and returns the first that declines, or null when all admit. */
  async function admission(path: string, body: Record<string, unknown>, owner: string) {
    const entries: readonly { check: (input: Record<string, unknown>) => Parameters<Application["form"]>[0]; fields: readonly string[]; detail: string;
      prerequisite?: { check: (input: Record<string, unknown>) => Parameters<Application["form"]>[0]; detail: (input: { title: string }) => string } }[] =
      admissions[path as keyof typeof admissions] ?? [];
    for (const entry of entries) {
      const values = Object.fromEntries(entry.fields.map((field) => [field, field === "assessment" ? body.case : body[field]]));
      const missing = Object.values(values).some((value) => value === undefined);
      if (!missing && await application.form(entry.check({ ...values, owner }))) continue;
      // A declined practice start names the prerequisite to work on first, when one is not ready.
      if (!missing && entry.prerequisite) {
        const found = await application.form(entry.prerequisite.check({ ...values, owner })) as { title?: unknown } | null;
        if (found && typeof found.title === "string") return { entry, detail: entry.prerequisite.detail({ title: found.title }) };
      }
      return { entry, detail: entry.detail };
    }
    return null;
  }

  /**
   * The adapter's response to `request`. When it is a refusal whose code has a sentence, the sentence is added as
   * `detail`. A response that already explains itself, or that is not that code's refusal, is returned unchanged.
   */
  async function explained(handler: (request: Request) => Promise<Response>, request: Request): Promise<Response> {
    const waiting: { code?: string } = {};
    const response = await refusals.run(waiting, () => handler(request));
    const code = waiting.code;
    const detail = code === undefined ? undefined : refusalDetail(new URL(request.url).pathname.slice("/api".length), code);
    if (code === undefined || detail === undefined || response.ok) return response;
    const body = await response.clone().json().catch(() => null) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body) || "detail" in body ||
      (body as { error?: unknown }).error !== policy.publicErrors?.[code]) return response;
    const headers = new Headers(response.headers);
    headers.delete("Content-Length");
    return new Response(JSON.stringify({ ...body, detail }), { status: response.status, statusText: response.statusText, headers });
  }

  // Native callers use the same declared admission checks and learner lock as HTTP.
  // The raw invoker remains internal; it assumes these application preconditions.
  const admittedInvoker: Invoker<Record<string, { input: unknown; output: unknown }>> = {
    async invoke(path, input, options = {}) {
      const learning = learnerCommand(path);
      const courseMutation = courseCommands.has(path);
      if (!learning && !courseMutation) {
        return rawGateway.invoke(path, input, options);
      }
      const refuse = (value: string): InvocationResult => ({ ok: false, error: { kind: "domain", value } });
      const invalid = (detail: string): InvocationResult => ({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail } });
      if (options.signal?.aborted) return { ok: false, error: { kind: "framework", code: "ABORTED" } };
      const checked = learning ? commandInput(path, input) : structuredInput(input);
      if (!checked.ok) return invalid(checked.detail ?? "Check the supplied text, numbers, and review choices.");
      const body = input as Record<string, unknown>;
      if (typeof body.session !== "string") return refuse("NOT_SIGNED_IN");
      try {
        const identity = await Sessioning.use({ session: body.session as Session });
        if ("error" in identity) return refuse("NOT_SIGNED_IN");
        return await locks.run(`user:${identity.subject}`, async () => {
          if (options.signal?.aborted) return { ok: false as const, error: { kind: "framework" as const, code: "ABORTED" as const } };
          const declined = await admission(path, body, identity.subject);
          if (declined) return invalid(declined.detail);
          try { return await rawGateway.invoke(path, input, options); }
          finally { await rawGateway.whenIdle(); }
        });
      } catch {
        return { ok: false, error: { kind: "framework", code: "INTERNAL_ERROR" } };
      }
    },
  };
  const admittedGateway = createGateway({ executionLimits, application: {
    publicInterface: application.publicInterface,
    invoker: admittedInvoker,
    beginDrain: () => rawGateway.beginDrain(),
    whenIdle: () => rawGateway.whenIdle(),
  } });
  // A refusal from the gateway carries only its code. Native callers also get the code's sentence as `detail` beside it,
  // as HTTP callers do; createGateway drops any other field of a refusal, so the sentence is added after it.
  const gateway = {
    beginDrain: () => admittedGateway.beginDrain(),
    whenIdle: () => admittedGateway.whenIdle(),
    async invoke(path: string, input: unknown, options?: InvokeOptions): Promise<RuntimeAnswer> {
      const result = await admittedGateway.invoke(path, input, options);
      if (result.ok || result.error.kind !== "domain" || typeof result.error.value !== "string") return result;
      const detail = refusalDetail(path, result.error.value);
      return detail === undefined ? result : { ok: false, error: { kind: "domain", value: result.error.value, detail } };
    },
  };

  async function learner(request: Request) {
    const session = cookie(request.headers.get("Cookie"), SESSION_COOKIE);
    if (!session) return null;
    const identity = await Sessioning.use({ session: session as Session });
    return "error" in identity ? null : identity.subject;
  }

  const session = (request: Request) => cookie(request.headers.get("Cookie"), SESSION_COOKIE);
  const materials = files && imports ? createMaterialRoutes({
    imports, files, locks, clock, limits, log, learner, session,
    courseReady: async (owner, course) => typeof course === "string" && !!await application.form(Access.CourseReady({ owner, course })),
    // The private material endpoint, called in process with the session's token. It answers the exact refusal code.
    addMaterial: async (input) => {
      try { return await rawGateway.invoke("/internal/materials/add", input as never); }
      finally { await rawGateway.whenIdle(); }
    },
    readMaterial: (token, material) => rawGateway.invoke("/courses/materials/read", { session: token, material } as never),
    recordingsAvailable: () => gemini?.status().available ?? false,
    wake: () => transcription?.wake(),
  }) : null;

  async function providerRequest(request: Request, path: string): Promise<Response> {
    const owner = await learner(request);
    if (!owner) return failure("UNAUTHORIZED", 401);
    const body = await readBody(request);
    if (!body) return failure("INVALID_REQUEST", 400);
    // Availability only: whether this server has a Gemini key. The key never leaves the server.
    if (path === "/api/ai/status") return Response.json(gemini?.status() ?? { available: false, reason: "The AI tutor is not set up on this server." });
    const route = materials && {
      "/api/courses/materials/file": materials.file, "/api/courses/materials/imports": materials.list,
      "/api/courses/materials/imports/retry": materials.retry, "/api/courses/materials/imports/remove": materials.remove,
    }[path];
    if (route) return route(request, owner, body);
    return path.startsWith("/api/courses/materials/") ? failure("UNAVAILABLE", 503) : failure("INVALID_REQUEST", 404);
  }

  async function resume(request: Request): Promise<Response> {
    const attempt = cookie(request.headers.get("Cookie"), ATTEMPT_COOKIE) as Attempt | null;
    if (!attempt) return failure("FORBIDDEN", 403);
    const body = await readBody(request);
    if (!body) return failure("INVALID_REQUEST", 400);
    const choosing = new URL(request.url).pathname === "/api/auth/commons/choose";
    if (choosing && (typeof body.username !== "string" || body.username.length > 4096)) {
      return failure("INVALID_REQUEST", 400);
    }

    return locks.run(`attempt:${attempt}`, async () => {
      const [identity] = await CommonsFederating._identity({ attempt });
      if (!identity) return failure("FORBIDDEN", 403);
      const [linked] = await CommonsFederating._user({ attempt });
      // Only a confirmed server-side subject selects a key. Ignore any key supplied by the browser.
      const recoveryKey = linked ? "" : (await recovery.getOrCreate({ subject: identity.subject })).recoveryKey;
      if (identity.expiresAt <= clock()) return failure("FORBIDDEN", 403);
      const username = choosing ? body.username : identity.username;
      const prepared = () => new Request(request.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: publicOrigin,
          Cookie: request.headers.get("Cookie") ?? "",
        },
        body: JSON.stringify({ username, recoveryKey }),
      });

      let response = await explained(inner, prepared());
      await rawGateway.whenIdle();
      // A competing registration or link may have completed. Re-read before one bounded retry.
      if (response.status === 409 && identity.expiresAt > clock()) {
        const [savedLink] = await CommonsFederating._user({ attempt });
        const [savedAccount] = recoveryKey ? await Registering._byRecoveryKey({ recoveryKey }) : [];
        if (savedLink || savedAccount) {
          response = await explained(inner, prepared());
          await rawGateway.whenIdle();
        }
      }
      if (identity.expiresAt <= clock()) {
        // The response has not reached the browser. Withhold all cookies if a session was created too late.
        const issued = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`));
        const token = issued ? cookie(issued.split(";")[0]!, SESSION_COOKIE) : null;
        if (token) {
          try { await Sessioning.end({ session: token as Session }); }
          catch { /* The undisclosed session will expire if cleanup fails. */ }
        }
        return failure("FORBIDDEN", 403);
      }
      return response;
    });
  }

  async function handle(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/internal/")) return failure("FORBIDDEN", 403);
    // Check before the wrapper does any work, as well as inside the reference adapter.
    if (request.method !== "POST") return failure("INVALID_REQUEST", 405);
    if (request.headers.get("Origin") !== publicOrigin) return failure("FORBIDDEN", 403);
    const multipart = path === "/api/courses/materials/add" || path === "/api/learning/transcribe";
    if (!multipart && request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") {
      return failure("INVALID_REQUEST", 400);
    }
    try {
      if (path === "/api/courses/materials/add") return materials ? await materials.upload(request) : failure("UNAVAILABLE", 503);
      if (path === "/api/learning/transcribe") {
        const owner = await learner(request);
        if (!owner) return failure("UNAUTHORIZED", 401);
        if (!gemini) return failure("INVALID_REQUEST", 400);
        // The body limit is checked while reading, so a larger body is refused before it is held in memory.
        const form = await readForm(request, DICTATION_BODY_LIMIT, DICTATION_TOO_LARGE);
        const recording = form?.get("recording");
        if (!(recording instanceof File)) return failure("INVALID_REQUEST", 400);
        const transcript = await gemini.transcribe(recording);
        return await learner(request) === owner ? Response.json(transcript) : failure("UNAUTHORIZED", 401);
      }
      if (path.startsWith("/api/") && learnerCommand(path.slice(4))) {
        const owner = await learner(request);
        if (!owner) return failure("UNAUTHORIZED", 401);
        return locks.run(`user:${owner}`, async () => {
          if (path.slice(4) in admissions) {
            const body = await readBody(request.clone());
            if (!body || !commandInput(path.slice(4), body).ok) return failure("INVALID_REQUEST", 400);
            const declined = await admission(path.slice(4), body, owner);
            if (declined) {
              return Response.json({ error: "INVALID_REQUEST", detail: declined.detail }, { status: 400, headers: { "Cache-Control": "no-store" } });
            }
          }
          failures?.take(owner);
          let response: Response;
          try { response = await explained(inner, request); }
          finally { await rawGateway.whenIdle(); }
          // GENERATION_FAILED carries Generating's general sentence. The provider's reason replaces it, so the learner knows why and can retry.
          const reason = failures?.take(owner);
          return reason && response.status === 400
            ? Response.json({ error: "INVALID_REQUEST", detail: reason }, { status: 400, headers: { "Cache-Control": "no-store" } }) : response;
        });
      }
      // Tutor settings take no learner lock, so saving a choice never waits behind a running lesson.
      if (path === "/api/settings/tutor/choose") {
        const body = await readBody(request.clone());
        const response = await explained(inner, request);
        // The adapter reports either ChooseTutor refusal as INVALID_REQUEST. The same declared computations name which
        // one the flow returned; the catalog is fixed while the server runs, so they always agree with the flow.
        if (response.status !== 400 || !body || !tutorChoiceInput(body).ok) return response;
        const { model, level } = body as { model: string; level: string };
        const code = !modelOffered({ model }) ? "UNKNOWN_TUTOR_MODEL" : !levelSupported({ model, level }) ? "UNSUPPORTED_THINKING_LEVEL" : null;
        return code ? Response.json({ error: "INVALID_REQUEST", detail: tutorRefusals[code] }, { status: 400, headers: { "Cache-Control": "no-store" } }) : response;
      }
      if (path.startsWith("/api/ai/") || path === "/api/courses/materials/file" || path.startsWith("/api/courses/materials/imports")) {
        return await providerRequest(request, path);
      }
      if (path === "/api/auth/commons/resume" || path === "/api/auth/commons/choose") {
        return await resume(request);
      }
      if (path === "/api/auth/commons/finish") {
        const attempt = cookie(request.headers.get("Cookie"), ATTEMPT_COOKIE);
        if (!attempt) return failure("FORBIDDEN", 403);
        return await locks.run(`attempt:${attempt}`, async () => {
          try { return await explained(inner, request); }
          finally { await rawGateway.whenIdle(); }
        });
      }
      if (path.startsWith("/api/") && courseCommands.has(path.slice(4))) {
        const session = cookie(request.headers.get("Cookie"), SESSION_COOKIE);
        if (!session) return await explained(inner, request);
        const identity = await Sessioning.use({ session: session as Session });
        if ("error" in identity) return await explained(inner, request);
        return await locks.run(`user:${identity.subject}`, async () => {
          try { return await explained(inner, request); }
          finally { await rawGateway.whenIdle(); }
        });
      }
      return await explained(inner, request);
    } catch (error) {
      if (error instanceof Refusal) return refusal(error);
      if (multipart || path.startsWith("/api/ai/") || path.startsWith("/api/courses/materials/") || (path.startsWith("/api/") && learnerCommand(path.slice(4)))) {
        const detail = error instanceof Error && !error.name.startsWith("Mongo") ? error.message : "This operation could not finish. Your saved work is available to retry.";
        return Response.json({ error: "OPERATION_FAILED", detail }, { status: 400, headers: { "Cache-Control": "no-store" } });
      }
      // Never return database errors, codes, keys, or session values to the browser or logs.
      return failure("INTERNAL_ERROR", 500);
    }
  }

  return { handle, gateway };
}

/** Reject ambiguous cookies rather than selecting an attacker-supplied duplicate. */
function cookie(header: string | null, name: string): string | null {
  const values = (header ?? "").split(";").map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return null;
  try { return decodeURIComponent(values[0]!.slice(name.length + 1)) || null; }
  catch { return null; }
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > BODY_LIMIT) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return body !== null && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : null;
  } catch { return null; }
}

