import type { StillGotItHttp } from "../../generated/wire.ts";
import type { ViewerSkill } from "./revamp-types.ts";

// The Materials viewer's pages, built from one material read (design/revamp/README.md, "Materials", Viewer).
// Locations look like `key/page/N`, `key/slide/N`, `key/image`, `key/lines/A-B`, `key/cell/N`, `key/document` or
// `key/sheet/NAME/rows/A-B`, where `key` is the first 16 hexadecimal characters of SHA-256 of the file reference
// (design/material-data.md). PDFs, slides and images get one page each; text, Markdown, code and other documents get one
// scrolling page per file, split into sections by location.

export type MaterialRead = StillGotItHttp["/courses/materials/read"]["output"];
export type Original = MaterialRead["originals"][number];
export type Rendition = Original["renditions"][number];
export type ImageRendition = Extract<Rendition, { kind: "IMAGE" }>;
export type TextRendition = Extract<Rendition, { kind: "TEXT" }>;

export type FileKind = "pdf" | "slides" | "image" | "markdown" | "text" | "code" | "other";
/** One block of readable text in a document page, at one source location. */
export type Section = { location: string; label: string; text: string; mono: boolean };
export type ViewerPage = {
  /** Unique within the material: the file reference and the page number. */
  key: string;
  file: string;
  fileName: string;
  kind: FileKind;
  /** The position within its file (or within the material, for photos), from 1, and the total it counts against. */
  number: number;
  count: number;
  /** The source location the page shows; for a document page, its first section. */
  location: string;
  /** "Page", "Slide", "Photo", "Image", or "" for a document page. */
  unit: string;
  /** The readable text saved at this location, for PDF, slide and image pages. */
  text: string;
  image?: ImageRendition;
  /** The document's sections, for text, Markdown, code and other files. */
  sections: Section[];
};

export const PAGED: readonly FileKind[] = ["pdf", "slides", "image"];
export const isPaged = (kind: FileKind) => PAGED.includes(kind);

const CODE = new Set(["py", "js", "mjs", "cjs", "ts", "tsx", "jsx", "java", "c", "h", "cc", "cpp", "hpp", "cxx", "cs", "go", "rs", "rb", "php",
  "swift", "kt", "kts", "scala", "m", "jl", "r", "sql", "sh", "bash", "zsh", "fish", "ps1", "lua", "hs", "ml", "mli", "ex", "exs", "erl", "clj",
  "lisp", "scm", "rkt", "pl", "dart", "vue", "svelte", "html", "htm", "css", "scss", "sass", "less", "json", "yaml", "yml", "toml", "xml", "ini",
  "cfg", "conf", "tex", "sty", "bib", "v", "sv", "vhd", "asm", "s", "f", "f90", "mat", "proto", "graphql", "dockerfile", "makefile", "cmake"]);

/** The part of a location after its file key, such as `page/2`. */
export function locationTail(location: string): string {
  const slash = location.indexOf("/");
  return slash < 0 ? location : location.slice(slash + 1);
}
const keyOfLocation = (location: string) => location.includes("/") ? location.slice(0, location.indexOf("/")) : null;

function extension(name: string): string {
  const base = name.split(/[\\/]/).at(-1)!.toLowerCase();
  const dot = base.lastIndexOf(".");
  return dot < 0 ? base : base.slice(dot + 1);
}

/** How the viewer shows one retained file: by its name first, as the importer reads it, then by its locations. */
export function fileKind(original: Original): FileKind {
  const ext = extension(original.name);
  if (ext === "pdf" || original.mediaType === "application/pdf") return "pdf";
  if (original.renditions.some((part) => part.kind === "IMAGE") || ["png", "jpg", "jpeg", "webp"].includes(ext)) return "image";
  if (ext === "pptx") return "slides";
  if (["md", "markdown", "mdown", "mkd"].includes(ext)) return "markdown";
  if (["docx", "xlsx", "xlsm", "ipynb"].includes(ext)) return "other";
  if (CODE.has(ext)) return "code";
  const tails = original.renditions.map((part) => locationTail(part.location));
  if (tails.some((tail) => tail.startsWith("page/"))) return "pdf";
  if (tails.some((tail) => tail.startsWith("slide/"))) return "slides";
  if (tails.every((tail) => tail.startsWith("lines/"))) return "text";
  return "other";
}

/** The file's location key, taken from its saved locations, or a key computed earlier for a file with none. */
export function fileKey(original: Original, computed: Record<string, string>): string | null {
  for (const part of original.renditions) { const key = keyOfLocation(part.location); if (key) return key; }
  return computed[original.file] ?? null;
}

/** The location key the importer gives a file reference. Needs a secure context; null when it cannot be computed. */
export async function digestKey(file: string): Promise<string | null> {
  try {
    const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(file)));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 16);
  } catch { return null; }
}

/** A location as a short label for an eyebrow, such as "Page 2", "Lines 1–100" or "Sheet Grades". */
export function locationLabel(location: string): string {
  const tail = locationTail(location);
  let match: RegExpExecArray | null;
  if ((match = /^page\/(\d+)$/.exec(tail))) return `Page ${match[1]}`;
  if ((match = /^slide\/(\d+)$/.exec(tail))) return `Slide ${match[1]}`;
  if ((match = /^cell\/(\d+)$/.exec(tail))) return `Cell ${match[1]}`;
  if ((match = /^lines\/(\d+)-(\d+)$/.exec(tail))) return `Lines ${match[1]}–${match[2]}`;
  if ((match = /^sheet\/(.+)\/rows\/(\d+)-(\d+)$/.exec(tail))) return match[2] === "1" ? `Sheet ${match[1]}` : `Sheet ${match[1]}, rows ${match[2]}–${match[3]}`;
  if ((match = /^time\/([\d:]+)-([\d:]+)$/.exec(tail))) return `${match[1]}–${match[2]}`;
  if (tail === "image") return "Image";
  if (tail === "document") return "Document";
  if (location === "content") return "Text";
  return tail.replaceAll("/", " ");
}

const numberIn = (location: string, word: "page" | "slide") => {
  const match = new RegExp(`^${word}/(\\d+)$`).exec(locationTail(location));
  return match ? Number(match[1]) : null;
};
const textAt = (original: Original, location: string) =>
  original.renditions.flatMap((part) => part.kind === "TEXT" && part.location === location ? [part.text] : []).join("\n\n");
const linesStart = (location: string) => Number(/^lines\/(\d+)-/.exec(locationTail(location))?.[1] ?? 0);

/**
 * The pages of one material, in saved file order. `pdfCounts` holds the page count of each PDF that pdf.js has opened;
 * before that, a PDF has as many pages as its last page with text. `keys` holds location keys computed for files that
 * saved no locations. Photos of graded work are numbered across the material, since each photo is its own file.
 */
export function buildPages(read: MaterialRead, pdfCounts: Record<string, number>, keys: Record<string, string>, graded: boolean): ViewerPage[] {
  const pages: ViewerPage[] = [];
  for (const original of read.originals) {
    const kind = fileKind(original), key = fileKey(original, keys);
    const base = { file: original.file, fileName: original.name, kind, text: "", sections: [] as Section[] };
    if (kind === "pdf" || kind === "slides") {
      const word = kind === "pdf" ? "page" : "slide";
      const known = Math.max(0, ...original.renditions.map((part) => numberIn(part.location, word) ?? 0));
      const count = Math.max(1, kind === "pdf" ? pdfCounts[original.file] ?? known : known);
      for (let n = 1; n <= count; n++) {
        const location = key ? `${key}/${word}/${n}` : "content";
        pages.push({ ...base, key: `${original.file}#${n}`, number: n, count, location, unit: kind === "pdf" ? "Page" : "Slide", text: textAt(original, location) });
      }
    } else if (kind === "image") {
      const images = original.renditions.filter((part): part is ImageRendition => part.kind === "IMAGE");
      images.forEach((image, i) => pages.push({ ...base, key: `${original.file}#${i + 1}`, number: i + 1, count: images.length, location: image.location,
        unit: graded ? "Photo" : "Image", text: textAt(original, image.location), image }));
    } else {
      const texts = original.renditions.filter((part): part is TextRendition => part.kind === "TEXT");
      if (kind === "text" || kind === "markdown" || kind === "code") texts.sort((a, b) => linesStart(a.location) - linesStart(b.location));
      const mono = kind === "code" || (kind === "other" && /^(cell|sheet)\//.test(locationTail(texts[0]?.location ?? "")));
      const sections = texts.map((part) => ({ location: part.location, label: locationLabel(part.location), text: part.text, mono }));
      pages.push({ ...base, key: `${original.file}#1`, number: 1, count: 1, location: sections[0]?.location ?? (key ? `${key}/document` : "content"), unit: "", sections });
    }
  }
  // Each photo is its own file, so photos count across the material ("Photo 2 of 3").
  if (pages.length > 1 && pages.every((page) => page.kind === "image")) pages.forEach((page, i) => { page.number = i + 1; page.count = pages.length; });
  // A material saved with readable text and no retained files shows that text.
  if (!pages.length && read.content.trim()) {
    pages.push({ key: "content#1", file: "", fileName: read.title, kind: "text", number: 1, count: 1, location: "content", unit: "", text: "",
      sections: [{ location: "content", label: "Text", text: read.content, mono: false }] });
  }
  return pages;
}

/** The page that shows a location, and whether the location is a section inside a document page. */
export function findLocation(pages: readonly ViewerPage[], location: string): ViewerPage | null {
  if (location === "content") return pages[0] ?? null;
  return pages.find((page) => page.location === location || page.sections.some((section) => section.location === location)) ?? null;
}

/** The Markdown source of a document page, with each block at its original line number so source maps match. */
export function markdownSource(page: ViewerPage): string {
  let out = "", line = 1;
  for (const section of page.sections) {
    const match = /^lines\/(\d+)-(\d+)$/.exec(locationTail(section.location));
    if (match) { while (line < Number(match[1])) { out += "\n"; line++; } }
    out += section.text + "\n";
    line = match ? Number(match[2]) + 1 : line + section.text.split("\n").length;
  }
  return out;
}

/** The section of a document page that holds a line number, for "lines/A-B" locations. */
export function sectionForLine(page: ViewerPage, line: number): Section | null {
  return page.sections.find((section) => {
    const match = /^lines\/(\d+)-(\d+)$/.exec(locationTail(section.location));
    return match ? line >= Number(match[1]) && line <= Number(match[2]) : false;
  }) ?? null;
}
/** The line range of a "lines/A-B" location. */
export function lineRange(location: string): [number, number] | null {
  const match = /^lines\/(\d+)-(\d+)$/.exec(locationTail(location));
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** The skills shown under a page: those whose saved locations include it, or every skill when none has locations. */
export function pageSkills(skills: readonly ViewerSkill[], page: ViewerPage | undefined): ViewerSkill[] {
  if (!skills.some((skill) => skill.locations?.length)) return [...skills];
  if (!page) return [];
  const here = new Set([page.location, ...page.sections.map((section) => section.location)]);
  return skills.filter((skill) => skill.locations?.some((location) => here.has(location)));
}

/** The label of the "Ask about …" button. */
export function askLabel(page: ViewerPage | undefined): string {
  if (!page) return "Ask about this page";
  if (page.kind === "pdf") return "Ask about this page";
  if (page.kind === "slides") return "Ask about this slide";
  if (page.kind === "image") return page.unit === "Photo" ? "Ask about this photo" : "Ask about this image";
  if (page.kind === "code") return "Ask about this code";
  if (page.kind === "markdown" || page.kind === "text") return "Ask about these notes";
  return "Ask about this section";
}

/** The draft question for a lesson about one page or section, such as "Can you explain page 2 of Lecture 4?". */
export function askQuestion(page: ViewerPage, location: string, title: string): string {
  if (page.kind === "pdf") return `Can you explain page ${page.number} of ${title}?`;
  if (page.kind === "slides") return `Can you explain slide ${page.number} of ${title}?`;
  if (page.kind === "image") return page.count > 1 ? `Can you explain ${page.unit.toLowerCase()} ${page.number} of ${title}?` : `Can you explain the image in ${title}?`;
  const tail = locationTail(location);
  if (location === "content" || tail === "document" || page.sections.length <= 1) return `Can you explain ${title}?`;
  const label = locationLabel(location);
  return `Can you explain ${label.charAt(0).toLowerCase()}${label.slice(1)} of ${title}?`;
}

/** The footer's label, such as "Skills from this page" or "Skills in these notes". */
export function skillsLabel(page: ViewerPage | undefined): string {
  if (!page || isPaged(page.kind)) return `Skills from this ${(page?.unit || "page").toLowerCase()}`;
  return page.kind === "markdown" || page.kind === "text" ? "Skills in these notes" : "Skills in this file";
}

/**
 * The grade and the grader's note written in graded work's readable text, such as "Score: 18/20" and
 * "Grader's note: Check the pivot in row 2." Each is null when the text does not state it. `rest` is the text without
 * the lines they came from, so the page does not repeat them.
 */
export function gradeNote(text: string): { grade: string | null; note: string | null; rest: string } {
  const noteLine = /^\s*(?:grader['’]?s?\s+)?(?:note|feedback|comments?)\s*[:–—-]\s*(.+)$/im.exec(text);
  const gradeLine = /^\s*(?:grade|score|mark|total)\s*[:–—-]\s*(.{1,16})$/im.exec(text);
  const fraction = /\b(\d{1,3}(?:\.\d+)?\s*\/\s*\d{1,3})\b/.exec(text)?.[1]?.replace(/\s+/g, "");
  const used = new Set([noteLine?.[0], gradeLine?.[0]].filter((line): line is string => !!line).map((line) => line.trim()));
  const rest = text.split("\n").filter((line) => !used.has(line.trim())).join("\n").trim();
  return { grade: gradeLine?.[1]?.trim() ?? fraction ?? null, note: noteLine?.[1]?.trim() ?? null, rest };
}
