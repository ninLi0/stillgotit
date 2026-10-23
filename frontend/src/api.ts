import { createHttpClient } from "@mit-sdg/sync-engine-http/client";
import type { StillGotItHttp } from "../../generated/wire.ts";

// The host supplies this field. All other types come from the generated HTTP contract.
type BrowserWire = {
  [Path in keyof StillGotItHttp as Path extends `/internal/${string}` ? never : Path]: Omit<StillGotItHttp[Path], "input"> & {
    input: Omit<StillGotItHttp[Path]["input"], "recoveryKey">;
  };
};

export const api = createHttpClient<BrowserWire>({ baseUrl: "/api" });
export type Course = StillGotItHttp["/courses"]["output"]["courses"][number];

export function errorMessage(code: string): string {
  switch (code) {
    case "UNAUTHORIZED": return "Your session ended. Sign in again.";
    case "FORBIDDEN": return "This sign-in could not be completed. Start again with Commons.";
    case "INVALID_REQUEST": return "Check the field and try again.";
    case "CONFLICT": return "This request conflicts with saved work. Reload to see the latest version.";
    case "NETWORK_ERROR": case "BAD_JSON": case "BAD_STATUS": case "RESPONSE_TOO_LARGE": case "HEADER_RESOLUTION_FAILED":
      return "The server did not answer. Check your connection and try again. Your saved work is still there.";
    default: return "The app could not complete the request. Your saved work is still there. Try again.";
  }
}

// The browser client reports these itself, with technical details meant for developers.
const clientFailures = new Set(["NETWORK_ERROR", "BAD_JSON", "BAD_STATUS", "RESPONSE_TOO_LARGE", "HEADER_RESOLUTION_FAILED"]);

/** The server's plain explanation when it sent one, otherwise a message for the error code. */
export function failureText(result: { error: unknown; detail?: unknown }): string {
  const code = String(result.error);
  return !clientFailures.has(code) && typeof result.detail === "string" && result.detail.trim() ? result.detail : errorMessage(code);
}

export function unwrap<T extends object>(result: T): Exclude<T, { error: unknown }> {
  if ("error" in result) throw new Error(failureText(result as { error: unknown }));
  return result as Exclude<T, { error: unknown }>;
}
