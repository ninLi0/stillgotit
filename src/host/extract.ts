import { createHash } from "node:crypto";
import { extname } from "node:path";
import { unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { MediaRendition, MediaValue } from "../concepts/GroundedTutoring/media.ts";

export const MAX_PAGES = 50, MAX_TEXT = 500_000, MAX_EXPANDED = 50 * 1024 * 1024, MAX_ROWS = 20_000, MAX_COLUMNS = 200;
export const UNSUPPORTED = "This file type can't be imported. Upload a PDF, image, text, notebook, Word, PowerPoint, or Excel file.";
export const OFFICE_LIMITATION = "Images and charts in this file aren't included. Export it to PDF to keep them.";
const NOTEBOOK_LIMITATION = "Notebook source cells are read without executing code. Saved graphical outputs are not interpreted.";
const OLD_OFFICE = "This older Office format can't be imported. Save the file as .docx, .pptx, or .xlsx, or export it to PDF.";
const OTHER_IMAGE = "This image format can't be imported. Upload a PNG, JPEG, or WebP image.";
const TOO_LARGE = "This file is too large to read once it is unpacked. Import a smaller unit.";
const unreadable = (kind: string) => `This ${kind} can't be read. Check that it opens, or export it to PDF.`;

type Kind = "pdf" | "image" | "docx" | "pptx" | "xlsx" | "notebook" | "text";
const kinds: Record<string, Kind | string> = {
  ".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".docx": "docx", ".pptx": "pptx",
  ".xlsx": "xlsx", ".xlsm": "xlsx", ".ipynb": "notebook",
  ".doc": OLD_OFFICE, ".dot": OLD_OFFICE, ".ppt": OLD_OFFICE, ".pps": OLD_OFFICE, ".pot": OLD_OFFICE, ".xls": OLD_OFFICE, ".xlt": OLD_OFFICE,
  ".gif": OTHER_IMAGE, ".bmp": OTHER_IMAGE, ".tif": OTHER_IMAGE, ".tiff": OTHER_IMAGE, ".heic": OTHER_IMAGE, ".heif": OTHER_IMAGE, ".avif": OTHER_IMAGE,
};
// Formats that decode as text but are not meant to be read as text, plus common binaries.
for (const extension of [".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".rtf", ".odt", ".odp", ".ods", ".pages", ".key", ".numbers",
  ".mp3", ".m4a", ".wav", ".ogg", ".flac", ".aac", ".webm", ".mp4", ".mpeg", ".mpga", ".mov", ".avi", ".mkv", ".exe", ".dmg", ".bin"]) kinds[extension] = UNSUPPORTED;

const utf8 = new TextDecoder("utf-8", { fatal: true });
function decodeText(bytes: Uint8Array): string | null {
  try { const text = utf8.decode(bytes); return text.includes("\0") ? null : text; } catch { return null; }
}

/** Returns how a file is read, or throws a learner-facing refusal. Text is recognized by content. */
export function classify(name: string, bytes: Uint8Array): Kind {
  const kind = kinds[extname(name).toLowerCase()];
  if (kind === undefined) { if (decodeText(bytes) === null) throw new Error(UNSUPPORTED); return "text"; }
  if (!["pdf", "image", "docx", "pptx", "xlsx", "notebook"].includes(kind)) throw new Error(kind);
  return kind as Kind;
}

export interface Source { file: string; name: string; mediaType: string; bytes: Uint8Array }

/** Collects renditions for one import. The location key format matches earlier imports. */
export async function extract(sources: readonly Source[]): Promise<{ originals: MediaValue[]; content: string }> {
  const originals: MediaValue[] = [], texts: string[] = [];
  let size = 0;
  for (const { file, name, mediaType, bytes } of sources) {
    const renditions: MediaRendition[] = [], limitations: string[] = [];
    const key = createHash("sha256").update(file).digest("hex").slice(0, 16);
    const add = (location: string, text: string) => {
      if (!text.trim()) return false;
      const part = `[${location}]\n${text}`;
      texts.push(part); size += part.length;
      if (size > MAX_TEXT) throw new Error("This material contains too much text. Import a smaller unit.");
      renditions.push({ kind: "TEXT", location, text });
      return true;
    };
    const kind = classify(name, bytes);
    if (kind === "pdf") await pdf(bytes, key, add, limitations);
    else if (kind === "image") renditions.push({ kind: "IMAGE", location: `${key}/image`, file, mediaType: imageType(bytes) });
    else if (kind === "docx") { add(`${key}/document`, await docx(bytes)); limitations.push(OFFICE_LIMITATION); }
    else if (kind === "pptx") { slides(bytes).forEach((text, i) => add(`${key}/slide/${i + 1}`, text)); limitations.push(OFFICE_LIMITATION); }
    else if (kind === "xlsx") { for (const sheet of sheets(bytes)) add(`${key}/sheet/${sheet.name}/rows/1-${sheet.last}`, sheet.text); limitations.push(OFFICE_LIMITATION); }
    else if (kind === "notebook") { notebook(bytes).forEach((text, i) => add(`${key}/cell/${i + 1}`, text)); limitations.push(NOTEBOOK_LIMITATION); }
    else {
      const lines = decodeText(bytes)!.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85]/);
      if (lines.at(-1) === "") lines.pop();
      for (let start = 0; start < lines.length; start += 100) {
        add(`${key}/lines/${start + 1}-${Math.min(start + 100, lines.length)}`, lines.slice(start, start + 100).join("\n"));
      }
    }
    originals.push({ file, name, mediaType, renditions, limitations });
  }
  return { originals, content: texts.join("\n\n") };
}

async function pdf(bytes: Uint8Array, key: string, add: (location: string, text: string) => boolean, limitations: string[]) {
  let file: Awaited<ReturnType<typeof getDocumentProxy>>;
  // pdf.js may take ownership of the buffer it reads, so it gets a copy.
  try { file = await getDocumentProxy(bytes.slice(), { verbosity: 0 }); }
  catch (error) { throw new Error((error as Error)?.name === "PasswordException" ? "This PDF needs a password. Upload an unlocked copy." : unreadable("PDF")); }
  try {
    if (file.numPages > MAX_PAGES) throw new Error(`A source can contain at most ${MAX_PAGES} pages. Import a smaller unit.`);
    let pages: string[];
    try { pages = (await extractText(file, { mergePages: false })).text; } catch { throw new Error(unreadable("PDF")); }
    const blank = pages.flatMap((text, i) => add(`${key}/page/${i + 1}`, text) ? [] : [i + 1]);
    if (blank.length === pages.length) limitations.push("This PDF has no selectable text. It may be a scanned document.");
    else if (blank.length) limitations.push(`${blank.length === 1 ? "Page" : "Pages"} ${series(blank)} ${blank.length === 1 ? "has" : "have"} no selectable text.`);
  } finally { await file.loadingTask.destroy().catch(() => undefined); }
}

const series = (items: number[]) => items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

function imageType(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" {
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  throw new Error("This image can't be read. Upload a PNG, JPEG, or WebP image.");
}

/** Unzips only wanted entries. fflate never inflates past an entry's declared size, so the sum bounds memory. */
function unzip(bytes: Uint8Array, wanted: (name: string) => boolean, kind: string): Record<string, Uint8Array> {
  let entries = 0, total = 0;
  try {
    return unzipSync(bytes, { filter: (entry) => {
      if (++entries > 10_000) throw new Error(TOO_LARGE);
      if (!wanted(entry.name)) return false;
      total += entry.originalSize;
      if (total > MAX_EXPANDED) throw new Error(TOO_LARGE);
      return true;
    } });
  } catch (error) { throw new Error((error as Error)?.message === TOO_LARGE ? TOO_LARGE : unreadable(kind)); }
}

async function docx(bytes: Uint8Array): Promise<string> {
  // mammoth unzips without size checks, so it reads a bounded copy that holds only the XML parts.
  const parts = unzip(bytes, (name) => /\.(xml|rels)$/i.test(name), "Word file");
  try { return (await mammoth.extractRawText({ buffer: Buffer.from(zipSync(parts, { level: 0 })) })).value.trim(); }
  catch { throw new Error(unreadable("Word file")); }
}

type Tag = { close: boolean; name: string; attributes: string; empty: boolean } | { text: string };
/** A linear XML tokenizer. Office parts are flat enough that tags and text are all these readers need. */
function* tokens(xml: string): Generator<Tag> {
  // Tags stop at the next "<", so malformed input cannot cause repeated scans.
  const pattern = /<(\/?)([A-Za-z_][\w.:-]*)([^<>]*)>|<[^<>]*>|([^<]+)/g;
  for (let match; (match = pattern.exec(xml));) {
    if (match[4] !== undefined) yield { text: decodeXml(match[4]) };
    else if (match[2]) yield { close: match[1] === "/", name: match[2], attributes: match[3]!, empty: match[3]!.endsWith("/") };
  }
}
const local = (name: string) => name.slice(name.indexOf(":") + 1);
const attribute = (attributes: string, name: string) => {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(attributes);
  return match ? decodeXml(match[1] ?? match[2]!) : undefined;
};
export function decodeXml(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(lt|gt|amp|quot|apos));/gi, (whole, decimal?: string, hex?: string, named?: string) => {
    if (named) return { lt: "<", gt: ">", amp: "&", quot: "\"", apos: "'" }[named.toLowerCase() as "lt"];
    const code = decimal ? Number(decimal) : parseInt(hex!, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
  });
}
const xmlText = (bytes: Uint8Array | undefined) => bytes ? new TextDecoder().decode(bytes) : "";

/** Orders parts by the package's own list, such as slides in presentation.xml. Falls back to file numbers. */
function ordered(files: Record<string, Uint8Array>, list: string, relations: string, item: string, folder: string, part: RegExp) {
  const targets = new Map<string, string>();
  for (const tag of tokens(xmlText(files[relations]))) {
    if ("name" in tag && local(tag.name) === "Relationship") {
      const id = attribute(tag.attributes, "Id"), target = attribute(tag.attributes, "Target");
      if (id && target) targets.set(id, target.startsWith("/") ? target.slice(1) : folder + target.replace(/^\.\//, ""));
    }
  }
  const listed: { path: string; name?: string }[] = [];
  for (const tag of tokens(xmlText(files[list]))) {
    if ("name" in tag && !tag.close && local(tag.name) === item) {
      const path = targets.get(attribute(tag.attributes, "[\\w.-]+:id") ?? "");
      if (path && files[path] && !listed.some((entry) => entry.path === path)) listed.push({ path, name: attribute(tag.attributes, "name") });
    }
  }
  if (listed.length) return listed;
  return Object.keys(files).filter((name) => part.test(name)).map((path) => ({ path, number: Number(part.exec(path)![1]) }))
    .sort((a, b) => a.number - b.number).map(({ path, number }) => ({ path, name: `Sheet${number}` }));
}

function slides(bytes: Uint8Array): string[] {
  const part = /^ppt\/slides\/slide(\d+)\.xml$/;
  const files = unzip(bytes, (name) => part.test(name) || name === "ppt/presentation.xml" || name === "ppt/_rels/presentation.xml.rels", "PowerPoint file");
  const order = ordered(files, "ppt/presentation.xml", "ppt/_rels/presentation.xml.rels", "sldId", "ppt/", part);
  if (order.length > MAX_PAGES) throw new Error("This presentation has too many slides. Import a smaller unit.");
  return order.map(({ path }) => {
    const lines: string[] = [];
    let line = "", inText = false, fallback = 0;
    for (const tag of tokens(xmlText(files[path]))) {
      if ("text" in tag) { if (inText && !fallback) line += tag.text; continue; }
      const name = local(tag.name);
      // AlternateContent repeats content for older readers. Read only the preferred choice.
      if (tag.name === "mc:Fallback" && !tag.empty) fallback += tag.close ? -1 : 1;
      else if (name === "t") inText = !tag.close && !tag.empty;
      else if (tag.name === "a:br" && !fallback) line += "\n";
      else if (tag.name === "a:p" && (tag.close || tag.empty) && !fallback) { if (line.trim()) lines.push(line); line = ""; }
    }
    if (line.trim()) lines.push(line);
    return lines.join("\n");
  });
}

const column = (letters: string) => [...letters.toUpperCase()].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const letters = (n: number): string => n > 0 ? letters(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + (n - 1) % 26) : "";
const unescapeOffice = (text: string) => text.replace(/_x([0-9a-f]{4})_/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

function sheets(bytes: Uint8Array): { name: string; last: number; text: string }[] {
  const part = /^xl\/worksheets\/sheet(\d+)\.xml$/;
  const files = unzip(bytes, (name) => part.test(name) || ["xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/sharedStrings.xml"].includes(name), "Excel file");
  const shared: string[] = [];
  let item = "", skip = 0, inText = false;
  for (const tag of tokens(xmlText(files["xl/sharedStrings.xml"]))) {
    if ("text" in tag) { if (inText && !skip) item += tag.text; continue; }
    const name = local(tag.name);
    if (name === "rPh" && !tag.empty) skip += tag.close ? -1 : 1; // Phonetic hints repeat the text.
    else if (name === "t") inText = !tag.close && !tag.empty;
    else if (name === "si" && (tag.close || tag.empty)) { shared.push(unescapeOffice(item)); item = ""; }
  }
  return ordered(files, "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "sheet", "xl/", part).map(({ path, name }) => {
    const rows: string[] = [];
    let row = 0, col = 0, last = 0, cells: string[] = [], cell: { ref: string; type?: string } | null = null;
    let value = "", formula = "", field: "v" | "f" | "t" | null = null, phonetic = 0;
    for (const tag of tokens(xmlText(files[path]))) {
      if ("text" in tag) { if (field === "f") formula += tag.text; else if (field && !phonetic) value += tag.text; continue; }
      const tagName = local(tag.name);
      if (tagName === "rPh" && !tag.empty) phonetic += tag.close ? -1 : 1;
      if (tagName === "row" && !tag.close) {
        row = Number(attribute(tag.attributes, "r")) || row + 1; col = 0; cells = [];
        if (row > MAX_ROWS) throw new Error("This sheet is too large for one import. Select a smaller range.");
      }
      if (tagName === "row" && (tag.close || tag.empty)) { if (cells.length) { rows.push(cells.join(" | ")); last = row; } cells = []; }
      if (tagName === "c" && !tag.close) {
        const ref = attribute(tag.attributes, "r"), match = ref ? /^([A-Z]+)(\d+)$/i.exec(ref) : null;
        col = match ? column(match[1]!) : col + 1;
        if (col > MAX_COLUMNS) throw new Error("This sheet is too large for one import. Select a smaller range.");
        cell = tag.empty ? null : { ref: letters(col) + row, type: attribute(tag.attributes, "t") }; value = ""; formula = "";
      }
      if (cell && (tagName === "v" || tagName === "f" || (tagName === "t" && cell.type === "inlineStr"))) field = tag.close || tag.empty ? null : tagName as "v" | "f" | "t";
      if (tagName === "c" && tag.close && cell) {
        let shown = cell.type === "s" ? (/^\d+$/.test(value.trim()) ? shared[Number(value)] ?? "" : "") : cell.type === "b" ? (value === "1" ? "TRUE" : "FALSE") : value;
        shown = unescapeOffice(shown);
        if (formula) shown = shown ? `=${formula} = ${shown}` : `=${formula}`;
        if (shown.trim()) cells.push(`${cell.ref}: ${shown}`);
        cell = null; field = null;
      }
    }
    return { name: name ?? path, last, text: rows.join("\n") };
  });
}

function notebook(bytes: Uint8Array): string[] {
  let cells: unknown;
  try { cells = (JSON.parse(decodeText(bytes)!) as { cells?: unknown }).cells; }
  catch { throw new Error("This notebook can't be read. Check that it is a valid Jupyter notebook file."); }
  if (!Array.isArray(cells)) throw new Error("This notebook can't be read. Check that it is a valid Jupyter notebook file.");
  return cells.map((cell) => {
    const source = (cell as { source?: unknown } | null)?.source;
    return Array.isArray(source) ? source.filter((line) => typeof line === "string").join("") : typeof source === "string" ? source : "";
  });
}
