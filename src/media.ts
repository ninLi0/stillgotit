/**
 * Prepared source values. The host verifies the referenced bytes before supplying them.
 * This module describes a value rather than a concept: MaterialKeeping and GroundedTutoring both validate it,
 * and the host and the import store build it, so it lives beside them instead of inside either concept.
 */
export type MediaRendition = {
  readonly kind: "TEXT";
  readonly location: string;
  readonly text: string;
} | {
  readonly kind: "IMAGE";
  readonly location: string;
  readonly file: string;
  readonly mediaType: ImageMediaType;
} | {
  /** One page of its own original PDF that has no selectable text. The tutor reads it from the retained PDF. */
  readonly kind: "PAGE";
  readonly location: string;
  readonly page: number;
};

export type ImageMediaType = "image/png" | "image/jpeg" | "image/webp" | "image/heic" | "image/heif";
const imageMediaTypes: readonly unknown[] = ["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"];

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
    return nonblank(value.location) && nonblank(value.file) && imageMediaTypes.includes(value.mediaType);
  }
  if (fields(value, ["kind", "location", "page"]) && value.kind === "PAGE") {
    return nonblank(value.location) && typeof value.page === "number" && Number.isSafeInteger(value.page) && value.page > 0;
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
    listOf(value.renditions, rendition) && listOf(value.limitations, nonblank) && pagesFit(value.mediaType, value.renditions);
}

/**
 * A page rendition appears only in a PDF original, at most once for each page, and never beside a text rendition
 * for the same page. A text rendition is for a page when it has that page's location or a location ending in
 * `/page/N` for that page number.
 */
function pagesFit(mediaType: string, renditions: readonly MediaRendition[]): boolean {
  const pages = renditions.filter((part) => part.kind === "PAGE");
  if (pages.length === 0) return true;
  const numbers = new Set(pages.map((part) => part.page)), locations = new Set(pages.map((part) => part.location));
  return mediaType === "application/pdf" && numbers.size === pages.length && !renditions.some((part) =>
    part.kind === "TEXT" && (locations.has(part.location) || numbers.has(Number(/\/page\/(\d+)$/.exec(part.location)?.[1]))));
}

export function isMediaList(value: unknown): value is MediaList {
  return listOf(value, media);
}
