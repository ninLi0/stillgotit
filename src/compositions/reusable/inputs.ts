import type { EndpointValidator } from "@mit-sdg/sync-engine/boundary";

/** ConceptBox's text-only boundary, with a bound on each submitted field. */
export const textInput: EndpointValidator = (value) => {
  const ok = typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.entries(value).every(([name, field]) =>
      (typeof field === "string" && field.length <= 4096) ||
      (field === null && (name === "session" || name === "attempt")),
    );
  return ok ? { ok: true } : { ok: false, detail: "Expected short text fields." };
};

export const courseInput: EndpointValidator = (value) => {
  const basic = textInput(value);
  if (!basic.ok) return basic;
  const title = (value as Record<string, unknown>).title;
  return typeof title === "string" && title.trim().length > 0 && title.trim().length <= 160
    ? { ok: true }
    : { ok: false, detail: "Enter a course title with 1 to 160 characters." };
};

export function recordOutput(textFields: readonly string[], dateFields: readonly string[] = []): EndpointValidator {
  return (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false };
    const record = value as Record<string, unknown>;
    const fields = [...textFields, ...dateFields];
    const ok = Object.keys(record).length === fields.length &&
      textFields.every((name) => typeof record[name] === "string") &&
      dateFields.every((name) => record[name] instanceof Date && Number.isFinite(record[name].getTime()));
    return { ok };
  };
}

export const courseListOutput: EndpointValidator = (value) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ok: false };
  const record = value as Record<string, unknown>;
  return { ok: Object.keys(record).length === 1 && Array.isArray(record.courses) &&
    record.courses.every((course) => recordOutput(["course", "title"])(course).ok) };
};

export const errorOutput: EndpointValidator = (value) =>
  typeof value === "string" && value.length > 0 ? { ok: true } : { ok: false };

export const validators = { input: textInput, output: recordOutput([]), domainError: errorOutput };
