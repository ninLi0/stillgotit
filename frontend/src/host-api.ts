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

/**
 * A retained file of one of the learner's materials, such as the image a citation points to. The host first checks
 * the learner's access to the material and this exact file reference. It sends the bytes without a type, so the
 * caller passes the saved media type, which lets the browser show the image.
 */
export async function materialFile(material: string, file: string, mediaType: string): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch("/api/courses/materials/file", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ material, file }) });
  } catch {
    throw new Error("The server did not answer. Check your connection and try again.");
  }
  if (!response.ok) {
    const result = await response.json().catch(() => null) as { detail?: unknown } | null;
    throw new Error(typeof result?.detail === "string" && result.detail ? result.detail
      : response.status === 401 ? "Your session ended. Sign in again."
      : response.status === 403 ? "This file is not available in your courses." : "This file could not be loaded. Try again.");
  }
  try { return new Blob([await response.arrayBuffer()], { type: mediaType }); }
  catch { throw new Error("The file stopped loading. Check your connection and try again."); }
}

/** Whether the server can reach Gemini. `reason` explains why AI features are off. */
export type AIStatus = { available: boolean; reason: string };
export function aiStatus() { return hostRequest<AIStatus>("/ai/status"); }
