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
    default: return "The app could not complete the request. Your saved work is still there. Try again.";
  }
}

export function unwrap<T extends object>(result: T): Exclude<T, { error: unknown }> {
  if ("error" in result) throw new Error((result as { detail?: string }).detail || errorMessage(String(result.error)));
  return result as Exclude<T, { error: unknown }>;
}
