/** Prepared source values. The host verifies the referenced bytes before supplying them. */
export type MediaRendition = {
  readonly kind: "TEXT";
  readonly location: string;
  readonly text: string;
} | {
  readonly kind: "IMAGE";
  readonly location: string;
  readonly file: string;
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp";
};

export interface MediaValue {
  readonly file: string;
  readonly name: string;
  readonly mediaType: string;
  readonly renditions: readonly MediaRendition[];
  readonly limitations: readonly string[];
}

export type MediaList = readonly MediaValue[];

export function nonblank(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

function rendition(value: unknown): value is MediaRendition {
  if (fields(value, ["kind", "location", "text"]) && value.kind === "TEXT") {
    return nonblank(value.location) && nonblank(value.text);
  }
  if (fields(value, ["kind", "location", "file", "mediaType"]) && value.kind === "IMAGE") {
    return nonblank(value.location) && nonblank(value.file) &&
      (value.mediaType === "image/png" || value.mediaType === "image/jpeg" || value.mediaType === "image/webp");
  }
  return false;
}

/** A sparse array must not bypass validation by omitting an element. */
function listOf<T>(value: unknown, valid: (item: unknown) => item is T): value is T[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index) || !valid(value[index])) return false;
  }
  return true;
}

function media(value: unknown): value is MediaValue {
  return fields(value, ["file", "name", "mediaType", "renditions", "limitations"]) &&
    nonblank(value.file) && nonblank(value.name) && typeof value.mediaType === "string" &&
    /^[A-Za-z0-9!#$%&'*+.^_`|~-]+\/[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(value.mediaType) &&
    listOf(value.renditions, rendition) && listOf(value.limitations, nonblank);
}

export function isMediaList(value: unknown): value is MediaList {
  return listOf(value, media);
}
