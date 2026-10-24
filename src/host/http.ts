import { admissions, composition as Access } from "../compositions/access.ts";
import { learningInput, structuredInput } from "../compositions/reusable/inputs.ts";
import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { createGateway, type Invoker, type InvocationResult } from "@mit-sdg/sync-engine/boundary";
import { executionLimits, type assembleApplication } from "../assembly.ts";
import type { Attempt } from "../concepts/Federating/Federating.ts";
import type { Session } from "../concepts/Sessioning/Sessioning.ts";
import type { RegistrationRecoveryStore } from "../storage/RegistrationRecoveryStore.ts";
import { ATTEMPT_COOKIE, BODY_LIMIT, SESSION_COOKIE, stillGotItPolicy } from "./http-policy.ts";
import { KeyedLocks } from "./locks.ts";
import type { Gemini } from "./gemini.ts";
import type { TutorFailures } from "./tutor-generation.ts";
import type { MaterialFiles } from "./material-files.ts";
import type { MaterialImportStore } from "../storage/MaterialImportStore.ts";
import type { Material } from "../concepts/GroundedTutoring/GroundedTutoring.ts";

type Application = ReturnType<typeof assembleApplication>;

export function createApplicationHttp({ application, recovery, publicOrigin, clock = () => new Date(), gemini, failures, files, imports }: {
  application: Application;
  recovery: Pick<RegistrationRecoveryStore, "getOrCreate">;
  publicOrigin: string;
  clock?: () => Date;
  gemini?: Pick<Gemini, "status" | "transcribe">;
  failures?: TutorFailures;
  files?: MaterialFiles;
  imports?: MaterialImportStore;
}) {
  const rawGateway = createGateway({ application, executionLimits });
  const policy = stillGotItPolicy(publicOrigin);
  const inner = createHttpHandler({ application, gateway: rawGateway, policy });
  const preparedInner = createHttpHandler({ application, gateway: rawGateway, policy: stillGotItPolicy(publicOrigin, 4 * 1024 * 1024) });
  const locks = new KeyedLocks();
  const { CommonsFederating, Registering, Sessioning } = application.concepts;

  async function admission(path: string, body: Record<string, unknown>, owner: string) {
    const entry = admissions[path as keyof typeof admissions];
    if (!entry) return null;
    const values = Object.fromEntries(entry.fields.map((field) => [field, field === "assessment" ? body.case : body[field]]));
    const missing = Object.values(values).some((value) => value === undefined);
    if (!missing && await application.form(entry.check({ ...values, owner }))) return null;
    // A declined practice start names the prerequisite to work on first, when one is not ready.
    if (!missing && "prerequisite" in entry) {
      const found = await application.form(entry.prerequisite.check({ ...values, owner })) as { title?: unknown } | null;
      if (found && typeof found.title === "string") return { entry, detail: entry.prerequisite.detail({ title: found.title }) };
    }
    return { entry, detail: entry.detail };
  }

  // Native callers use the same declared admission checks and learner lock as HTTP.
  // The raw invoker remains internal; it assumes these application preconditions.
  const admittedInvoker: Invoker<Record<string, { input: unknown; output: unknown }>> = {
    async invoke(path, input, options = {}) {
      const learning = path.startsWith("/learning/") || path.startsWith("/planning/") || path === "/courses/skills/suggest";
      const courseMutation = ["/courses/create", "/courses/units/add", "/courses/skills/propose", "/courses/skills/edit", "/courses/skills/confirm"].includes(path);
      if (!learning && !courseMutation) {
        return rawGateway.invoke(path, input, options);
      }
      const refuse = (value: string): InvocationResult => ({ ok: false, error: { kind: "domain", value } });
      const invalid = (detail: string): InvocationResult => ({ ok: false, error: { kind: "framework", code: "INVALID_INPUT", detail } });
      if (options.signal?.aborted) return { ok: false, error: { kind: "framework", code: "ABORTED" } };
      if (!(learning ? learningInput(input) : structuredInput(input)).ok) return invalid("Check the supplied text, numbers, and review choices.");
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
  const gateway = createGateway({ executionLimits, application: {
    publicInterface: application.publicInterface,
    invoker: admittedInvoker,
    beginDrain: () => rawGateway.beginDrain(),
    whenIdle: () => rawGateway.whenIdle(),
  } });

  async function learner(request: Request) {
    const session = cookie(request.headers.get("Cookie"), SESSION_COOKIE);
    if (!session) return null;
    const identity = await Sessioning.use({ session: session as Session });
    return "error" in identity ? null : identity.subject;
  }

  function internal(request: Request, body: unknown) {
    return new Request(new URL("/api/internal/materials/add", request.url), { method: "POST", headers: {
      "Content-Type": "application/json", Origin: publicOrigin, Cookie: request.headers.get("Cookie") ?? "",
    }, body: JSON.stringify(body) });
  }

  async function importMaterial(request: Request): Promise<Response> {
    const owner = await learner(request);
    if (!owner) return failure("UNAUTHORIZED", 401);
    if (!files || !imports) return failure("UNAVAILABLE", 503);
    if (!request.headers.get("Content-Type")?.startsWith("multipart/form-data")) return failure("INVALID_REQUEST", 400);
    const form = await request.formData();
    const course = form.get("course"), title = form.get("title"), requestId = form.get("requestId");
    const uploaded = form.getAll("files");
    if (typeof course !== "string" || typeof title !== "string" || !title.trim() || title.length > 160 ||
      typeof requestId !== "string" || !requestId.trim() || requestId.length > 100 || !uploaded.every((file) => file instanceof File)) {
      return failure("INVALID_REQUEST", 400);
    }
    if (!await application.form(Access.CourseReady({ owner, course }))) return failure("FORBIDDEN", 403);
    const sources = await files.describe(uploaded);
    return locks.run(`import:${owner}:${requestId}`, async () => {
      const identity = { owner, requestId };
      let operation = await imports.getOrCreate({ ...identity, request: { scope: course, title, origin: "COURSE", sources } });
      if (operation.stage === "CREATED") operation = await imports.saveSources({ ...identity, revision: operation.revision, sources: await files.retain(operation, uploaded) });
      if (operation.stage === "SOURCES_SAVED") operation = await imports.savePrepared({ ...identity, revision: operation.revision, prepared: {
        owner, scope: course, importKey: operation.importKey, title, locator: `upload:${operation.importKey}`, origin: "COURSE",
        ...await files.prepare(operation),
      } });
      return locks.run(`user:${owner}`, async () => {
        if (await learner(request) !== owner) return failure("UNAUTHORIZED", 401);
        if (!await application.form(Access.CourseReady({ owner, course }))) return failure("FORBIDDEN", 403);
        if (operation.stage === "COMPLETE") return Response.json({ material: operation.material });
        const prepared = operation.prepared!;
        const response = await preparedInner(internal(request, { course, importKey: prepared.importKey, title: prepared.title,
          locator: prepared.locator, content: prepared.content, originals: prepared.originals, origin: prepared.origin }));
        await rawGateway.whenIdle();
        if (!response.ok) return response;
        const result = await response.clone().json() as { material?: string };
        if (typeof result.material !== "string") throw new Error("The material save did not return an identity.");
        await imports.complete({ ...identity, revision: operation.revision, material: result.material });
        return response;
      });
    });
  }

  async function providerRequest(request: Request, path: string): Promise<Response> {
    const owner = await learner(request);
    if (!owner) return failure("UNAUTHORIZED", 401);
    const body = await readBody(request);
    if (!body) return failure("INVALID_REQUEST", 400);
    // Availability only: whether this server has a Gemini key. The key never leaves the server.
    if (path === "/api/ai/status") return Response.json(gemini?.status() ?? { available: false, reason: "The AI tutor is not set up on this server." });
    if (path === "/api/courses/materials/file") {
      if (typeof body.material !== "string") return failure("INVALID_REQUEST", 400);
      const material = body.material as Material;
      const session = cookie(request.headers.get("Cookie"), SESSION_COOKIE);
      const permitted = await rawGateway.invoke("/courses/materials/read", { session, material });
      if (!permitted.ok) return failure("FORBIDDEN", 403);
      const data = permitted.value as { originals: import("../concepts/GroundedTutoring/media.ts").MediaList };
      const allowed = data.originals.flatMap((file) => [file.file, ...file.renditions.flatMap((part) => part.kind === "IMAGE" ? [part.file] : [])]);
      if (typeof body.file !== "string" || !allowed.includes(body.file) || !files) return failure("FORBIDDEN", 403);
      return new Response(new Uint8Array(await files.read(owner, body.file)), { headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff",
      } });
    }
    return failure("INVALID_REQUEST", 404);
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

      let response = await inner(prepared());
      await rawGateway.whenIdle();
      // A competing registration or link may have completed. Re-read before one bounded retry.
      if (response.status === 409 && identity.expiresAt > clock()) {
        const [savedLink] = await CommonsFederating._user({ attempt });
        const [savedAccount] = recoveryKey ? await Registering._byRecoveryKey({ recoveryKey }) : [];
        if (savedLink || savedAccount) {
          response = await inner(prepared());
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
      if (path === "/api/courses/materials/add") return await importMaterial(request);
      if (path === "/api/learning/transcribe") {
        const owner = await learner(request);
        if (!owner) return failure("UNAUTHORIZED", 401);
        if (!gemini || !request.headers.get("Content-Type")?.startsWith("multipart/form-data")) return failure("INVALID_REQUEST", 400);
        const recording = (await request.formData()).get("recording");
        if (!(recording instanceof File)) return failure("INVALID_REQUEST", 400);
        const transcript = await gemini.transcribe(recording);
        return await learner(request) === owner ? Response.json(transcript) : failure("UNAUTHORIZED", 401);
      }
      if (path.startsWith("/api/learning/") || path.startsWith("/api/planning/") || path === "/api/courses/skills/suggest") {
        const owner = await learner(request);
        if (!owner) return failure("UNAUTHORIZED", 401);
        return locks.run(`user:${owner}`, async () => {
          const entry = admissions[path.slice(4) as keyof typeof admissions];
          if (entry) {
            const body = await readBody(request.clone());
            if (!body || !learningInput(body).ok) return failure("INVALID_REQUEST", 400);
            const declined = await admission(path.slice(4), body, owner);
            if (declined) {
              return Response.json({ error: "INVALID_REQUEST", detail: declined.detail }, { status: 400, headers: { "Cache-Control": "no-store" } });
            }
          }
          failures?.take(owner);
          let response: Response;
          try { response = await inner(request); }
          finally { await rawGateway.whenIdle(); }
          // GENERATION_FAILED reaches HTTP as a bare INVALID_REQUEST. Add the provider's reason so the learner knows to retry.
          const reason = failures?.take(owner);
          return reason && response.status === 400
            ? Response.json({ error: "INVALID_REQUEST", detail: reason }, { status: 400, headers: { "Cache-Control": "no-store" } }) : response;
        });
      }
      if (path.startsWith("/api/ai/") || path === "/api/courses/materials/file") {
        return await providerRequest(request, path);
      }
      if (path === "/api/auth/commons/resume" || path === "/api/auth/commons/choose") {
        return await resume(request);
      }
      if (path === "/api/auth/commons/finish") {
        const attempt = cookie(request.headers.get("Cookie"), ATTEMPT_COOKIE);
        if (!attempt) return failure("FORBIDDEN", 403);
        return await locks.run(`attempt:${attempt}`, async () => {
          try { return await inner(request); }
          finally { await rawGateway.whenIdle(); }
        });
      }
      if (path === "/api/courses/create" || path === "/api/courses/units/add" ||
        ["/api/courses/skills/propose", "/api/courses/skills/edit", "/api/courses/skills/confirm"].includes(path)) {
        const session = cookie(request.headers.get("Cookie"), SESSION_COOKIE);
        if (!session) return await inner(request);
        const identity = await Sessioning.use({ session: session as Session });
        if ("error" in identity) return await inner(request);
        return await locks.run(`user:${identity.subject}`, async () => {
          try { return await inner(request); }
          finally { await rawGateway.whenIdle(); }
        });
      }
      return await inner(request);
    } catch (error) {
      if (multipart || path.startsWith("/api/ai/") || path.startsWith("/api/learning/") || path.startsWith("/api/planning/") || path === "/api/courses/skills/suggest") {
        const detail = error instanceof Error && error.name !== "MongoServerError" ? error.message : "This operation could not finish. Your saved work is available to retry.";
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

function failure(error: string, status: number) {
  return Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
}
