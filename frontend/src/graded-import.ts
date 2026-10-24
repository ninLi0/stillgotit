import { ref } from "vue";
import type { StillGotItHttp } from "../../generated/wire.ts";

type Wire = StillGotItHttp;
export type Material = Wire["/courses/graded/confirm"]["input"]["material"];
export type ExtractedRow = Wire["/courses/graded/extract"]["output"]["rows"][number];
export type ConfirmRow = Wire["/courses/graded/confirm"]["input"]["row"];
export type Result = ConfirmRow["result"];
export type ImportedRow = Wire["/courses/graded/read"]["output"]["imported"][number];
type Track = Wire["/learning/read"]["output"]["data"]["track"];
type TrackInput = NonNullable<Track>["inputs"][number];

/** The title prefix that marks a material as graded work (design/compositions/Importing.md, gradedTitle). */
export const GRADED_PREFIX = "Graded work: ";
export function isGradedTitle(title: string) {
  return title.startsWith(GRADED_PREFIX) && /\S/.test(title.slice(GRADED_PREFIX.length));
}

/** The sentences the design gives for each refusal and warning. */
export const sentences = {
  materialUnavailable: "Choose graded work that you imported into one of your courses.",
  skillsUnavailable: "Confirm at least one skill in this course before importing graded work.",
  marksMissing: "No question marks were found, and a total score alone cannot update individual skills.",
  nothingChecked: "Check at least one question and map it to a skill.",
  dateInvalid: "Enter the date the work was performed.",
  dateFuture: "The performance date cannot be after today.",
  rowInvalid: "Review the extracted rows again.",
  unmapped: "Map the question to a skill.",
  helpConflict: "With help, the strongest result is “Success with help”.",
  skillUnavailable: "Map the question to a confirmed skill in this course.",
  noReadableContent: "No readable content was found. Use an unlocked document, clear image, or text file.",
  photosInstead: "Upload photos of the pages instead.",
  pdfTooLarge: "This PDF is larger than 15 MB, so the tutor cannot see its marks. Upload photos of its pages instead.",
  photoTooLarge: "This photo is larger than 15 MB, so the tutor cannot read it. Upload a smaller photo of the page.",
  separateUploads: "Each upload is separate. Uploading the same paper again lets its questions be imported again.",
} as const;

export const results = ["INDEPENDENT", "SUPPORTED", "SLIP", "GAP", "UNCERTAIN"] as const satisfies readonly Result[];
/** The same labels the skill page uses for assessment results. */
export const resultLabels: Record<Result, string> = {
  INDEPENDENT: "Independent success", SUPPORTED: "Success with help", SLIP: "Small execution error", GAP: "Needs more understanding", UNCERTAIN: "More evidence needed",
};
const isResult = (value: unknown): value is Result => typeof value === "string" && (results as readonly string[]).includes(value);

/** The tutor's inline limit per file and the upload route's total, as the host enforces them. */
export const FILE_LIMIT = 15 * 1024 * 1024, UPLOAD_LIMIT = 25 * 1024 * 1024, UPLOAD_COUNT = 12;
/** The host's title limit, less the graded prefix. */
export const NAME_LIMIT = 160 - GRADED_PREFIX.length;
const isPdf = (file: File) => /\.pdf$/i.test(file.name);
const isPhoto = (file: File) => /\.(png|jpe?g|webp)$/i.test(file.name);

/** The first reason these files cannot be graded work, or an empty string. */
export function filesProblem(files: readonly File[]): string {
  if (!files.length) return "Choose the graded work to upload.";
  if (files.length > UPLOAD_COUNT || files.reduce((total, file) => total + file.size, 0) > UPLOAD_LIMIT) return "Choose up to 12 files with a combined size of 25 MB or less.";
  for (const file of files) {
    if (!isPdf(file) && !isPhoto(file)) return "Upload graded work as a PDF or as photos of the pages (PNG, JPEG, or WebP).";
    if (file.size > FILE_LIMIT) return isPdf(file) ? sentences.pdfTooLarge : sentences.photoTooLarge;
  }
  return "";
}

/**
 * One extracted question as the review keeps it: the eight fields Confirm takes, plus the learner's choices.
 * `pending` is true when the row was sent and no answer arrived. It stays as sent until ReadImports shows whether it was imported.
 */
export type KeptRow = ConfirmRow & { checked: boolean; imported: boolean; pending?: boolean };
/** `started` is true once a question of the current sequence is imported. The date and help choice stay fixed until it finishes. */
export type KeptReview = { performedOn: string; outsideHelp: boolean; started: boolean; rows: KeptRow[] };

const rowFields = ["label", "mark", "feedback", "excerpt", "rationale", "proposedResult", "skill", "result"] as const;
type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * Keeps each material's review in session storage until its checked questions are imported, following DraftSaveQueue.
 * A failed or lost reply leaves the review in place, so a retry sends the same kept row with its original label.
 */
export class KeptReviews {
  constructor(private readonly storage: QueueStorage) {}

  private key(material: Material) { return `stillgotit-graded-import:${material}`; }

  read(material: Material): KeptReview | null {
    const text = this.storage.getItem(this.key(material));
    if (text === null) return null;
    try {
      const value: unknown = JSON.parse(text);
      if (value !== null && typeof value === "object") {
        const review = value as Record<string, unknown>;
        if (typeof review.performedOn === "string" && typeof review.outsideHelp === "boolean" && typeof review.started === "boolean" &&
          Array.isArray(review.rows) && review.rows.length > 0 && review.rows.every((row) => row !== null && typeof row === "object" &&
            rowFields.every((field) => typeof row[field] === "string") && isResult(row.result) && isResult(row.proposedResult) &&
            typeof row.checked === "boolean" && typeof row.imported === "boolean" && (row.pending === undefined || typeof row.pending === "boolean"))) {
          return review as KeptReview;
        }
      }
    } catch { /* Report unusable saved work without silently replacing it. */ }
    throw new Error("The kept questions for this work could not be read. Read the work again to start over.");
  }

  save(material: Material, review: KeptReview) {
    try { this.storage.setItem(this.key(material), JSON.stringify(review)); }
    catch { throw new Error("The browser could not keep your review. Keep this tab open, and confirm again when browser storage is available."); }
  }

  remove(material: Material) {
    try { this.storage.removeItem(this.key(material)); } catch { /* Nothing to remove. */ }
  }
}

/** Exactly the eight fields Confirm takes. The host refuses any other field. */
export function confirmRow(row: KeptRow): ConfirmRow {
  return { label: row.label, mark: row.mark, feedback: row.feedback, excerpt: row.excerpt, rationale: row.rationale,
    proposedResult: row.proposedResult, skill: row.skill, result: row.result };
}

const sameLabel = (a: string, b: string) => a.trim() === b.trim();
/** An earlier import has this row's trimmed label and skill, so Confirm would refuse it. */
export function alreadyImported(row: Pick<ConfirmRow, "label" | "skill">, imports: readonly ImportedRow[]) {
  return !!row.skill && imports.some((item) => item.skill === row.skill && sameLabel(item.label, row.label));
}
/** Labels of earlier imports from this work for the row's skill under a different label. */
export function earlierLabels(row: Pick<ConfirmRow, "label" | "skill">, imports: readonly ImportedRow[]) {
  if (!row.skill) return [];
  return [...new Set(imports.filter((item) => item.skill === row.skill && !sameLabel(item.label, row.label)).map((item) => item.label.trim()))];
}

/**
 * Rows for a new extraction. A skill that is no longer confirmed becomes no skill. Rows that match an earlier import,
 * rows whose skill already has an import under another label, and rows with no skill start unchecked.
 */
export function newRows(extracted: readonly ExtractedRow[], imports: readonly ImportedRow[], confirmed: ReadonlySet<string>, outsideHelp: boolean): KeptRow[] {
  return extracted.map((row) => {
    const skill = confirmed.has(row.skill) ? row.skill : "";
    const imported = alreadyImported({ label: row.label, skill }, imports);
    return { label: row.label, mark: row.mark, feedback: row.feedback, excerpt: row.excerpt, rationale: row.rationale, proposedResult: row.result,
      skill, result: outsideHelp && row.result === "INDEPENDENT" ? "SUPPORTED" : row.result, imported,
      checked: !!skill && !imported && !earlierLabels({ label: row.label, skill }, imports).length };
  });
}

/** The first check Confirm would refuse for this row, in the design's order, as its sentence. Empty when the row is ready. */
export function rowProblem(row: ConfirmRow, outsideHelp: boolean, confirmed: ReadonlySet<string>): string {
  const text = (value: unknown, max: number, blank: boolean) => typeof value === "string" && value.length <= max && (blank || !!value.trim());
  if (!text(row.label, 100, false) || !text(row.mark, 50, false) || !text(row.feedback, 2000, true) || !text(row.excerpt, 500, true) ||
    !text(row.rationale, 500, false) || !text(row.skill, 300, true) || !isResult(row.proposedResult) || !isResult(row.result)) return sentences.rowInvalid;
  if (!row.skill) return sentences.unmapped;
  if (outsideHelp && row.result === "INDEPENDENT") return sentences.helpConflict;
  if (!confirmed.has(row.skill)) return sentences.skillUnavailable;
  return "";
}

/** Whether the text is a real calendar date written YYYY-MM-DD. */
export function isCalendarDate(day: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return false;
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const value = new Date(0);
  value.setUTCFullYear(year, month - 1, date);
  return value.getUTCFullYear() === year && value.getUTCMonth() === month - 1 && value.getUTCDate() === date;
}

/** Confirm's date checks. `today` is the server's New York date from ReadImports. */
export function dateProblem(day: string, today: string): string {
  if (!isCalendarDate(day)) return sentences.dateInvalid;
  if (day > today) return sentences.dateFuture;
  return "";
}

const STUDY_TIME_ZONE = "America/New_York";
const dayParts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: STUDY_TIME_ZONE });
const longDay = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: STUDY_TIME_ZONE });

/** The New York calendar date of an instant, written YYYY-MM-DD. */
export function calendarDay(instant: string | number): string {
  const parts = Object.fromEntries(dayParts.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** A YYYY-MM-DD date, or an instant, as "October 23, 2026". */
export function readableDay(day: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  // Noon UTC falls on the same calendar day in New York.
  if (match) return longDay.format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
  const time = Date.parse(day);
  return Number.isNaN(time) ? day : longDay.format(new Date(time));
}

/**
 * The New York date the skill's current estimate history starts, or null without an estimate. The concept starts the
 * history at the earlier of its starting date and its oldest informative evidence, so the latest revision of each
 * evidence counts unless its signal is Uncertain.
 */
export function estimateStart(track: Track): string | null {
  if (!track) return null;
  const latest = new Map<string, TrackInput>();
  for (const input of track.inputs) if ((latest.get(input.evidence)?.revision ?? -Infinity) < input.revision) latest.set(input.evidence, input);
  const times = [track.initializedAt, ...[...latest.values()].filter((input) => input.signal !== "UNCERTAIN").map((input) => input.performedAt)]
    .map((value) => Date.parse(value)).filter((time) => !Number.isNaN(time));
  return times.length ? calendarDay(Math.min(...times)) : null;
}

/** "A", "A and B", or "A, B, and C". */
export function listText(items: readonly string[]) {
  return items.length < 3 ? items.join(" and ") : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

/**
 * Shared by every GradedImport on the page: a library row asks the course's import screen to open its graded work,
 * and the rows wait while the screen is working.
 */
export const reviewRequest = ref<{ course: string; material: Material } | null>(null);
export const importBusy = ref(false);
