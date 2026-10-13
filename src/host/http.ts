import { createHttpHandler } from "@mit-sdg/sync-engine-http/handler";
import { createGateway } from "@mit-sdg/sync-engine/boundary";
import type { assembleApplication } from "../assembly.ts";
import type { Attempt } from "../concepts/Federating/Federating.ts";
import type { Session } from "../concepts/Sessioning/Sessioning.ts";
import type { RegistrationRecoveryStore } from "../storage/RegistrationRecoveryStore.ts";
import { ATTEMPT_COOKIE, BODY_LIMIT, SESSION_COOKIE, stillGotItPolicy } from "./http-policy.ts";
import { KeyedLocks } from "./locks.ts";

type Application = ReturnType<typeof assembleApplication>;

export function createApplicationHttp({ application, recovery, publicOrigin, clock = () => new Date() }: {
  application: Application;
  recovery: Pick<RegistrationRecoveryStore, "getOrCreate">;
  publicOrigin: string;
  clock?: () => Date;
}) {
  const gateway = createGateway({ application });
  const policy = stillGotItPolicy(publicOrigin);
  const inner = createHttpHandler({ application, gateway, policy });
  const locks = new KeyedLocks();
  const { CommonsFederating, Registering, Sessioning } = application.concepts;

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
      await gateway.whenIdle();
      // A competing registration or link may have completed. Re-read before one bounded retry.
      if (response.status === 409 && identity.expiresAt > clock()) {
        const [savedLink] = await CommonsFederating._user({ attempt });
        const [savedAccount] = recoveryKey ? await Registering._byRecoveryKey({ recoveryKey }) : [];
        if (savedLink || savedAccount) {
          response = await inner(prepared());
          await gateway.whenIdle();
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
    // Check before the wrapper does any work, as well as inside the reference adapter.
    if (request.method !== "POST") return failure("INVALID_REQUEST", 405);
    if (request.headers.get("Origin") !== publicOrigin) return failure("FORBIDDEN", 403);
    if (request.headers.get("Content-Type")?.split(";")[0]?.trim() !== "application/json") {
      return failure("INVALID_REQUEST", 400);
    }
    try {
      if (path === "/api/auth/commons/resume" || path === "/api/auth/commons/choose") {
        return await resume(request);
      }
      if (path === "/api/auth/commons/finish") {
        const attempt = cookie(request.headers.get("Cookie"), ATTEMPT_COOKIE);
        if (!attempt) return failure("FORBIDDEN", 403);
        return await locks.run(`attempt:${attempt}`, async () => {
          try { return await inner(request); }
          finally { await gateway.whenIdle(); }
        });
      }
      if (path === "/api/courses/create") {
        const session = cookie(request.headers.get("Cookie"), SESSION_COOKIE);
        if (!session) return await inner(request);
        const identity = await Sessioning.use({ session: session as Session });
        if ("error" in identity) return await inner(request);
        return await locks.run(`user:${identity.subject}`, async () => {
          try { return await inner(request); }
          finally { await gateway.whenIdle(); }
        });
      }
      return await inner(request);
    } catch {
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
