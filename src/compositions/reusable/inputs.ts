import type { EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { isMediaList } from "../../concepts/GroundedTutoring/media.ts";

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

export const structuredInput: EndpointValidator = (value) => ({ ok: typeof value === "object" && value !== null && !Array.isArray(value) });
export const structuredOutput: EndpointValidator = structuredInput;

export const proposalInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  const record = value as Record<string, unknown>;
  return { ok: Object.entries(record).every(([key, field]) =>
    (key === "session" && field === null) || (typeof field === "string" && field.length <= 16000)) &&
    ["unit", "material", "title", "outcome", "gate"].every((key) => typeof record[key] === "string" && (record[key] as string).trim().length > 0) };
};

export const proposalSaveInput: EndpointValidator = (value) => {
  const basic = proposalInput(value);
  if (!basic.ok) return basic;
  const key = (value as Record<string, unknown>).proposalKey;
  return typeof key === "string" && key.trim().length > 0 && key.length <= 100
    ? { ok: true }
    : { ok: false, detail: "Provide the original request key when saving a skill draft." };
};

/** Confirmed-skill text changes. Blank text reaches SkillMapping, which refuses it with its own message. */
export const skillTextInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  return { ok: Object.entries(value as Record<string, unknown>).every(([key, field]) =>
    (key === "session" && field === null) || (typeof field === "string" && field.length <= 16000)) };
};

/** A skill and the complete list of its prerequisite skills; an empty list clears them. */
export const prerequisitesInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  const ok = Object.entries(value as Record<string, unknown>).every(([key, field]) =>
    key === "session" ? field === null || typeof field === "string"
    : key === "prerequisites" ? Array.isArray(field) && field.every((id) => typeof id === "string" && id.length <= 4096)
    : typeof field === "string" && field.length <= 4096);
  return ok ? { ok: true } : { ok: false, detail: "Send the skill and a list of its prerequisite skills." };
};

/** SkillMapping.setEmphasis accepts only true or false, so any other value is refused before the action runs. */
export const emphasisInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  const ok = Object.entries(value as Record<string, unknown>).every(([key, field]) =>
    key === "session" ? field === null || typeof field === "string"
    : key === "emphasized" ? typeof field === "boolean"
    : typeof field === "string" && field.length <= 4096);
  return ok ? { ok: true } : { ok: false, detail: "Choose whether your professor emphasized this unit." };
};

export const materialInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  const record = value as Record<string, unknown>;
  return { ok: ["course", "importKey", "title", "locator"].every((key) => typeof record[key] === "string" && (record[key] as string).trim().length > 0) &&
    (record.session === null || typeof record.session === "string") && typeof record.content === "string" && record.content.length <= 500000 &&
    isMediaList(record.originals) && (record.origin === "COURSE" || record.origin === "REFERENCE") };
};

/** JSON commands carry learner input only. Definitions and provider output are server-owned. */
export const learningInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  const record = value as Record<string, unknown>;
  const numeric = new Set(["confidence", "dialogueLength", "turnIndex", "dailyMinutes", "actualMinutes"]);
  const flags = new Set(["reviewed", "unseen", "outsideHelp", "gateMet"]);
  const ok = Object.entries(record).every(([key, field]) => key === "session" ? field === null || typeof field === "string"
    : numeric.has(key) ? typeof field === "number" && Number.isFinite(field) && field >= 0
    : flags.has(key) ? typeof field === "boolean"
    : typeof field === "string" && field.length <= (key === "text" || key === "request" || key === "reason" ? 12000 : 300));
  return ok ? { ok: true } : { ok: false, detail: "Check the supplied text, numbers, and review choices." };
};
