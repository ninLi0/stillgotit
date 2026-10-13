import { httpPolicy } from "@mit-sdg/sync-engine-http/policy";

export const SESSION_COOKIE = "__Host-stillgotit-session";
export const ATTEMPT_COOKIE = "__Host-stillgotit-sign-in";
export const BODY_LIMIT = 16_384;

export function stillGotItPolicy(publicOrigin: string) {
  return httpPolicy({
    publicOrigin,
    basePath: "/api",
    requestOrigins: { allowed: [publicOrigin], requireOrigin: true },
    limits: { requestBodyBytes: BODY_LIMIT },
    publicErrors: {
      NOT_SIGNED_IN: "UNAUTHORIZED",
      SIGN_IN_EXPIRED: "FORBIDDEN",
      SIGN_IN_REFUSED: "FORBIDDEN",
      NOT_CONFIRMED: "FORBIDDEN",
      ALREADY_LINKED: "CONFLICT",
      INVALID_USERNAME: "INVALID_REQUEST",
      USERNAME_TAKEN: "CONFLICT",
      RECOVERY_KEY_CONFLICT: "CONFLICT",
      INVALID_COURSE_TITLE: "INVALID_REQUEST",
      COURSE_EXISTS: "CONFLICT",
    },
    cookies: {
      session: {
        name: "stillgotit-session", input: "session",
        issue: ["/auth/commons/resume", "/auth/commons/choose"].map((path) =>
          ({ path, value: "session", expires: "expiresAt" })),
        clear: ["/auth/logout"],
      },
      signIn: {
        name: "stillgotit-sign-in", input: "attempt",
        issue: [{ path: "/auth/commons/start", value: "attempt", expires: "expiresAt" }],
        clear: ["/auth/commons/resume", "/auth/commons/choose"],
      },
    },
  });
}
