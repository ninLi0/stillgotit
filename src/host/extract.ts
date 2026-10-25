import { createHash } from "node:crypto";
import { extname } from "node:path";
import { unzipSync, zipSync } from "fflate";
import mammoth from "mammoth";
import { extractText, getDocumentProxy } from "unpdf";
import type { ImageMediaType, MediaRendition, MediaValue } from "../media.ts";
import { imageType, isPdf, OggVideo, readRecording, WindowsAudio, recordingFamilies, type RecordingInfo } from "./media-detect.ts";
import { Refusal } from "./refusal.ts";

export const MAX_PAGES = 50, MAX_TEXT = 500_000, MAX_EXPANDED = 50 * 1024 * 1024, MAX_ROWS = 20_000, MAX_COLUMNS = 200;
/** Recordings and videos may be at most 2 hours long, so a whole transcript fits in one answer from the model. */
export const MAX_RECORDING_SECONDS = 2 * 60 * 60;
export const UNSUPPORTED = "This file type can't be imported. Upload a PDF, image, audio recording, video, text, notebook, Word, PowerPoint, or Excel file.";
export const ARCHIVE = "ZIP and other archive files can't be imported. Unzip them and choose the files inside.";
export const OLD_OFFICE = "This older Office format can't be imported. Save the file as .docx, .pptx, or .xlsx, or export it to PDF.";
export const OTHER_IMAGE = "This image format can't be imported. Upload a PNG, JPEG, WebP, HEIC, or HEIF image.";
export const OTHER_AUDIO = "This audio format can't be imported. Save the recording as MP3 or M4A and import it again.";
export const OTHER_VIDEO = "This video format can't be imported. Save the video as MP4 and import it again.";
export const IMAGE_UNREADABLE = "This image can't be read. Upload a PNG, JPEG, WebP, HEIC, or HEIF image.";
export const RECORDING_UNREADABLE = "This recording can't be read. Check that it plays, then save it as MP3, M4A, or MP4 and import it again.";
export const RECORDING_TOO_LONG = "Recordings and videos can be at most 2 hours long. Split the recording and import each part.";
export const TOO_MUCH_TEXT = "This material contains too much text. Import a smaller unit.";
export const OFFICE_LIMITATION = "Images and charts in this file aren't included. Export it to PDF to keep them.";
export const AUDIO_LIMITATION = "This transcript was written by the AI tutor from the recording. Words and times may contain mistakes. Play the recording to check.";
export const VIDEO_LIMITATION = "This transcript was written by the AI tutor from the video. It includes short notes about text and diagrams on screen, but not the pictures themselves. Words and times may contain mistakes. Play the video to check.";
const NOTEBOOK_LIMITATION = "Notebook source cells are read without executing code. Saved graphical outputs are not interpreted.";
const TOO_LARGE = "This file is too large to read once it is unpacked. Import a smaller unit.";
const unreadable = (kind: string) => `This ${kind} can't be read. Check that it opens, or export it to PDF.`;

export type Kind = "pdf" | "image" | "recording" | "docx" | "pptx" | "xlsx" | "notebook" | "text";
/** How one file is read. PDFs, images, and recordings carry the media type detected from their bytes. */
export type Detected =
  | { kind: "pdf"; mediaType: "application/pdf" }
  | { kind: "image"; mediaType: ImageMediaType }
  | { kind: "recording"; mediaType: string; recording: RecordingInfo }
  | { kind: "docx" | "pptx" | "xlsx" | "notebook" | "text"; mediaType?: undefined };

const named: Record<string, Kind | string> = {
  ".pdf": "pdf", ".png": "image", ".jpg": "image", ".jpeg": "image", ".webp": "image", ".heic": "image", ".heif": "image",
  ".docx": "docx", ".pptx": "pptx", ".xlsx": "xlsx", ".xlsm": "xlsx", ".ipynb": "notebook",
};
const refusedNames: [string, string[]][] = [
  [ARCHIVE, [".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"]],
  [OLD_OFFICE, [".doc", ".dot", ".ppt", ".pps", ".pot", ".xls", ".xlt"]],
  [OTHER_IMAGE, [".gif", ".bmp", ".tif", ".tiff", ".avif"]],
  [OTHER_AUDIO, [".wma", ".amr", ".caf", ".pcm", ".raw"]],
  [OTHER_VIDEO, [".mkv", ".ogv"]],
  // Formats that may decode as text but are not meant to be read as text, plus common binaries.
  [UNSUPPORTED, [".rtf", ".odt", ".odp", ".ods", ".pages", ".key", ".numbers", ".exe", ".dmg", ".bin"]],
];
for (const [sentence, extensions] of refusedNames) for (const extension of extensions) named[extension] = sentence;
for (const extension of Object.keys(recordingFamilies)) named[extension] = "recording";

const utf8 = new TextDecoder("utf-8", { fatal: true });
function decodeText(bytes: Uint8Array): string | null {
  try { const text = utf8.decode(bytes); return text.includes("\0") ? null : text; } catch { return null; }
}

/**
 * How much of a file `classify` needs: the whole file for recordings and text (unknown names and `.ts`),
 * the start for PDFs and images, and nothing for Office files and notebooks, which are checked while reading.
 */
export function bytesNeeded(name: string): "all" | "start" | "none" {
  const kind = named[extname(name).toLowerCase()];
  return kind === undefined || kind === "recording" ? "all" : kind === "pdf" || kind === "image" ? "start" : "none";
}
export const START_BYTES = 4096;

/** Returns how a file is read, from its name and its bytes, or throws a learner-facing refusal. */
export function classify(name: string, bytes: Uint8Array): Detected {
  const extension = extname(name).toLowerCase(), kind = named[extension];
  // `.ts` names both TypeScript source and MPEG transport streams. Only text is readable.
  if (extension === ".ts") { if (decodeText(bytes) === null) throw new Refusal(OTHER_VIDEO); return { kind: "text" }; }
  if (kind === undefined) { if (decodeText(bytes) === null) throw new Refusal(UNSUPPORTED); return { kind: "text" }; }
  if (kind === "pdf") { if (!isPdf(bytes)) throw new Refusal(unreadable("PDF")); return { kind, mediaType: "application/pdf" }; }
  if (kind === "image") {
    // A photo named .heic whose bytes are JPEG is saved as JPEG.
    const mediaType = imageType(bytes);
    if (!mediaType) throw new Refusal(IMAGE_UNREADABLE);
    return { kind, mediaType };
  }
  if (kind === "recording") {
    let recording: RecordingInfo | null;
    try { recording = readRecording(recordingFamilies[extension]!, extension, bytes); }
    catch (error) {
      if (error instanceof OggVideo) throw new Refusal(OTHER_VIDEO);
      if (error instanceof WindowsAudio) throw new Refusal(OTHER_AUDIO);
      throw error;
    }
    if (!recording) throw new Refusal(RECORDING_UNREADABLE);
    if (recording.seconds > MAX_RECORDING_SECONDS) throw new Refusal(RECORDING_TOO_LONG);
    return { kind, mediaType: recording.mediaType, recording };
  }
  if (kind === "docx" || kind === "pptx" || kind === "xlsx" || kind === "notebook") return { kind };
  throw new Refusal(kind);
}

/** The material's content: every text rendition in file and rendition order, as `[location]` and its text. */
export function joinContent(originals: readonly MediaValue[]): string {
  return originals.flatMap((file) => file.renditions.flatMap((part) => part.kind === "TEXT" ? [`[${part.location}]\n${part.text}`] : [])).join("\n\n");
}

/** The first 16 hexadecimal characters of the SHA-256 digest of the file reference. */
export const locationKey = (file: string) => createHash("sha256").update(file).digest("hex").slice(0, 16);

/** One file to read. `bytes` may be the received upload, which is copied once when its turn comes. */
export interface Source { file: string; name: string; mediaType: string; bytes: Uint8Array | Blob; detected?: Detected }

/**
 * Collects renditions for one import. The location key format matches earlier imports. Recordings and videos
 * get no renditions here; their transcripts are added after transcription. `recordings` names each distinct
 * retained recording once: identical files share one reference, so one transcript serves every original that has it.
 */
export async function extract(sources: readonly Source[]): Promise<{ originals: MediaValue[]; content: string; recordings: string[] }> {
  const originals: MediaValue[] = [], recordings: string[] = [];
  let length = 0, parts = 0;
  for (const { file, name, mediaType, bytes: received, detected: known } of sources) {
    const renditions: MediaRendition[] = [], limitations: string[] = [];
    const key = locationKey(file);
    const add = (location: string, text: string) => {
      if (!text.trim()) return false;
      // Count the exact content length, including the blank line between parts.
      length += location.length + text.length + 3 + (parts++ ? 2 : 0);
      if (length > MAX_TEXT) throw new Refusal(TOO_MUCH_TEXT);
      renditions.push({ kind: "TEXT", location, text });
      return true;
    };
    // Each file is copied once from the received bytes when it is read, and that copy goes to its reader.
    const copied = !(received instanceof Uint8Array), bytes = received instanceof Uint8Array ? received
      : known?.kind === "recording" ? new Uint8Array() : await received.bytes();
    const detected = known ?? classify(name, bytes);
    if (detected.kind === "recording") { if (!recordings.includes(file)) recordings.push(file); }
    else if (detected.kind === "pdf") await pdf(copied ? bytes : bytes.slice(), key, add, renditions, limitations);
    else if (detected.kind === "image") renditions.push({ kind: "IMAGE", location: `${key}/image`, file, mediaType: detected.mediaType });
    else if (detected.kind === "docx") { add(`${key}/document`, await docx(bytes)); limitations.push(OFFICE_LIMITATION); }
    else if (detected.kind === "pptx") { slides(bytes).forEach((text, i) => add(`${key}/slide/${i + 1}`, text)); limitations.push(OFFICE_LIMITATION); }
    else if (detected.kind === "xlsx") { for (const sheet of sheets(bytes)) add(`${key}/sheet/${sheet.name}/rows/1-${sheet.last}`, sheet.text); limitations.push(OFFICE_LIMITATION); }
    else if (detected.kind === "notebook") { notebook(bytes).forEach((text, i) => add(`${key}/cell/${i + 1}`, text)); limitations.push(NOTEBOOK_LIMITATION); }
    else {
      const text = decodeText(bytes);
      if (text === null) throw new Refusal(UNSUPPORTED);
      // A WebVTT or SubRip caption file is read as paragraphs, without its cue numbers and times.
      const transcript = transcriptText(text);
      const lines = (transcript ?? text).split(/\r\n|[\n\r\v\f\x1c-\x1e\x85]/);
      if (lines.at(-1) === "") lines.pop();
      for (let start = 0; start < lines.length; start += 100) {
        let end = Math.min(start + 100, lines.length);
        // A transcript's block ends with its last paragraph, not with the blank line after it.
        if (transcript !== null) while (end > start + 1 && !lines[end - 1]!.trim()) end--;
        add(`${key}/lines/${start + 1}-${end}`, lines.slice(start, end).join("\n"));
      }
    }
    originals.push({ file, name, mediaType, renditions, limitations });
  }
  return { originals, content: joinContent(originals), recordings };
}

/** Text for each page with text, and a page rendition for each page without it. No page images are made. */
async function pdf(bytes: Uint8Array, key: string, add: (location: string, text: string) => boolean, renditions: MediaRendition[], limitations: string[]) {
  let file: Awaited<ReturnType<typeof getDocumentProxy>>;
  // pdf.js may take ownership of the buffer it reads, so it always gets its own copy.
  try { file = await getDocumentProxy(bytes, { verbosity: 0 }); }
  catch (error) { throw new Refusal((error as Error)?.name === "PasswordException" ? "This PDF needs a password. Upload an unlocked copy." : unreadable("PDF")); }
  try {
    if (file.numPages > MAX_PAGES) throw new Refusal(`A source can contain at most ${MAX_PAGES} pages. Import a smaller unit.`);
    let pages: string[];
    try { pages = (await extractText(file, { mergePages: false })).text; } catch { throw new Refusal(unreadable("PDF")); }
    const blank: number[] = [];
    pages.forEach((text, i) => {
      const location = `${key}/page/${i + 1}`;
      if (!add(location, text)) { blank.push(i + 1); renditions.push({ kind: "PAGE", location, page: i + 1 }); }
    });
    if (blank.length && blank.length === pages.length) limitations.push("This PDF has no selectable text. The tutor reads its pages as images.");
    else if (blank.length === 1) limitations.push(`Page ${blank[0]} has no selectable text. The tutor reads that page as an image.`);
    else if (blank.length) limitations.push(`Pages ${series(blank)} have no selectable text. The tutor reads those pages as images.`);
  } finally { await file.loadingTask.destroy().catch(() => undefined); }
}

const series = (items: number[]) => items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;

/** Unzips only wanted entries. fflate never inflates past an entry's declared size, so the sum bounds memory. */
function unzip(bytes: Uint8Array, wanted: (name: string) => boolean, kind: string): Record<string, Uint8Array> {
  let entries = 0, total = 0;
  try {
    return unzipSync(bytes, { filter: (entry) => {
      if (++entries > 10_000) throw new Refusal(TOO_LARGE);
      if (!wanted(entry.name)) return false;
      total += entry.originalSize;
      if (total > MAX_EXPANDED) throw new Refusal(TOO_LARGE);
      return true;
    } });
  } catch (error) { throw new Refusal((error as Error)?.message === TOO_LARGE ? TOO_LARGE : unreadable(kind)); }
}

async function docx(bytes: Uint8Array): Promise<string> {
  // mammoth unzips without size checks, so it reads a bounded copy that holds only the XML parts.
  const parts = unzip(bytes, (name) => /\.(xml|rels)$/i.test(name), "Word file");
  try { return (await mammoth.extractRawText({ buffer: Buffer.from(zipSync(parts, { level: 0 })) })).value.trim(); }
  catch { throw new Refusal(unreadable("Word file")); }
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
  if (order.length > MAX_PAGES) throw new Refusal("This presentation has too many slides. Import a smaller unit.");
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
        if (row > MAX_ROWS) throw new Refusal("This sheet is too large for one import. Select a smaller range.");
      }
      if (tagName === "row" && (tag.close || tag.empty)) { if (cells.length) { rows.push(cells.join(" | ")); last = row; } cells = []; }
      if (tagName === "c" && !tag.close) {
        const ref = attribute(tag.attributes, "r"), match = ref ? /^([A-Z]+)(\d+)$/i.exec(ref) : null;
        col = match ? column(match[1]!) : col + 1;
        if (col > MAX_COLUMNS) throw new Refusal("This sheet is too large for one import. Select a smaller range.");
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
  catch { throw new Refusal("This notebook can't be read. Check that it is a valid Jupyter notebook file."); }
  if (!Array.isArray(cells)) throw new Refusal("This notebook can't be read. Check that it is a valid Jupyter notebook file.");
  return cells.map((cell) => {
    const source = (cell as { source?: unknown } | null)?.source;
    return Array.isArray(source) ? source.filter((line) => typeof line === "string").join("") : typeof source === "string" ? source : "";
  });
}

/** A WebVTT file's first line is "WEBVTT", alone or followed by a space or tab and more text. */
const WEBVTT = /^WEBVTT(?:[ \t]|$)/;
const CUE_TIME = String.raw`(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})`;
/** A cue's timing line, such as "00:01:02.500 --> 00:01:04.000 align:start" in WebVTT or "00:01:02,500 --> 00:01:04,000" in SubRip. */
const TIMING = new RegExp(String.raw`^\s*${CUE_TIME}\s*-->\s*${CUE_TIME}(?:\s|$)`);
/** A voice tag, such as "<v Professor Jackson>" or "<v.loud Sam>". Its group is the speaker's name. */
const VOICE = /<v(?:\.[^\s<>]*)?[ \t]+([^<>]*)>/;
/** Class, italic, bold, underline, ruby, and language tags, SubRip font tags, their end tags, and times inside a cue. */
const CUE_TAG = /<\/(?:c|i|b|u|v|lang|ruby|rt|font|s)[ \t]*>|<(?:c|i|b|u|v|ruby|rt|s)(?:\.[^\s<>]*)?>|<(?:lang|font)(?:\.[^\s<>]*)?[ \t][^<>]*>|<(?:\d+:)?\d{1,2}:\d{2}[.,]\d{1,3}>/gi;
const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/;
/** A paragraph ends with a sentence when the next cue starts more than this many seconds later. */
const PAUSE_SECONDS = 2;

const cueSeconds = (match: RegExpExecArray, at: number) =>
  Number(match[at] ?? 0) * 3600 + Number(match[at + 1]) * 60 + Number(match[at + 2]) + Number(match[at + 3]!.padEnd(3, "0")) / 1000;
/** Cue text without its tags, with character references decoded and every run of whitespace made one space. */
const cueText = (text: string) =>
  decodeXml(text.replace(CUE_TAG, "").replace(/&nbsp;/gi, " ").replace(/&(?:lrm|rlm);/gi, "")).replace(/[\s\x1c-\x1e\x85]+/g, " ").trim();

/**
 * The readable text of a WebVTT or SubRip caption file, or null when the text is neither. It keeps what was said, in
 * file order, as paragraphs separated by blank lines, and leaves out headers, comments, styles, cue numbers, and times
 * (design/material-data.md, "Caption files"). Only the start of the text decides whether it is a caption file.
 */
export function transcriptText(text: string): string | null {
  const head = text.slice(0, 4096).split(/\r\n|[\n\r]/), vtt = WEBVTT.test(head[0]!);
  if (!vtt) {
    // A SubRip file starts with a cue: its number and then its timing line. A timing line alone is accepted too.
    const first = head.findIndex((line) => line.trim());
    if (first < 0 || !(TIMING.test(head[first]!) || (/^\d+$/.test(head[first]!.trim()) && TIMING.test(head[first + 1] ?? "")))) return null;
  }
  const lines = text.split(/\r\n|[\n\r]/), cues: { start: number; end: number; lines: string[] }[] = [];
  // `skip` holds through the WebVTT header and through NOTE, STYLE, and REGION blocks, each of which ends at a blank line.
  let skip = vtt, blockStart = true;
  lines.forEach((line, i) => {
    const starts = blockStart;
    blockStart = !line.trim();
    if (blockStart) { skip = false; return; }
    const timing = TIMING.exec(line);
    if (timing) { skip = false; cues.push({ start: cueSeconds(timing, 1), end: cueSeconds(timing, 5), lines: [] }); return; }
    if (skip) return;
    if (vtt && starts && /^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/.test(line)) { skip = true; return; }
    // The line before a timing line names that cue: an identifier in WebVTT, a number in SubRip.
    if (TIMING.test(lines[i + 1] ?? "") && (starts || /^\d+$/.test(line.trim()))) return;
    // Text after a blank line inside a cue stays with that cue.
    cues.at(-1)?.lines.push(line);
  });
  const paragraphs: { speaker: string; parts: string[] }[] = [];
  let last: { end: number; text: string } | undefined;
  for (const cue of cues) {
    // A voice tag names the speaker for the rest of its cue. A cue without one continues the current speaker.
    let speaker: string | undefined, said = "";
    for (const line of cue.lines) {
      const pieces = line.split(VOICE);
      for (let p = 0; p < pieces.length; p += 2) {
        if (p) speaker = cueText(pieces[p - 1]!) || speaker;
        const piece = cueText(pieces[p]!);
        if (!piece) continue;
        let paragraph = paragraphs.at(-1);
        const pause = !said && !!last && SENTENCE_END.test(last.text) && cue.start - last.end > PAUSE_SECONDS;
        if (!paragraph || pause || (speaker !== undefined && speaker !== paragraph.speaker)) {
          paragraph = { speaker: speaker ?? paragraph?.speaker ?? "", parts: [] };
          paragraphs.push(paragraph);
        }
        paragraph.parts.push(piece);
        said = piece;
      }
    }
    if (said) last = { end: cue.end, text: said };
  }
  return paragraphs.map(({ speaker, parts }) => (speaker ? `${speaker}: ` : "") + parts.join(" ")).join("\n\n");
}
