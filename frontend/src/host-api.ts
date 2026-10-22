import type { StillGotItHttp } from "../../generated/wire.ts";
/** File and provider transport sits beside the generated concept endpoints. */
export async function hostRequest<T>(path: string, body: unknown = {}): Promise<T> {
  const response = await fetch(`/api${path}`, { method: "POST", credentials: "same-origin",
    headers: body instanceof FormData ? {} : { "Content-Type": "application/json" },
    body: body instanceof FormData ? body : JSON.stringify(body) });
  // A proxy timeout or outage returns a page instead of JSON.
  const result = await response.json().catch(() => ({ error: "UNAVAILABLE",
    detail: "The server did not answer in time. Try again. Your saved work is still available." }));
  if (!response.ok || result.error) throw new Error(result.detail || (result.error === "UNAUTHORIZED"
    ? "Your session ended. Sign in again." : "The request could not finish. Your saved work is still available."));
  return result as T;
}

/** Binary transport prepares files before the private generated material action. */
export function uploadMaterial(form: FormData) {
  return hostRequest<StillGotItHttp["/internal/materials/add"]["output"]>("/courses/materials/add", form);
}

/** Whether the server can reach Gemini. `reason` explains why AI features are off. */
export type AIStatus = { available: boolean; reason: string };
export function aiStatus() { return hostRequest<AIStatus>("/ai/status"); }
