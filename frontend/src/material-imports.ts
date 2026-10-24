/**
 * Importing materials in the browser ("Accepting an upload" and "Unfinished imports in the library" in
 * design/compositions/Materials.md): the upload form's checks and answers, the sentences of the import cards, and the
 * import listings on show, so any page that changes a course's imports can ask them to list again.
 */
import { HostError, importMaterial, refusalStartsNewImport, type ImportEntry } from "./host-api.ts";
import type { StillGotItHttp } from "../../generated/wire.ts";

type MaterialId = StillGotItHttp["/courses/materials/read"]["input"]["material"];

// The browser checks only the number of files and their combined size, with the server's sentences. The route checks the rest.
const MAX_FILES = 12, MAX_UPLOAD_BYTES = 95 * 1_048_576;
const NO_UPLOAD_ANSWER = "The upload didn't get an answer in time. It may still be saving. Wait a minute, then choose Import material again. The app continues from what it already saved.";

/** A file's size in the upload limit's unit: 1 MB is 1,048,576 bytes. */
export function fileSize(bytes: number) {
  return bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
}

/** The import listings on show, by course. */
const listings = new Map<string, Set<() => Promise<void>>>();

/** Registers a listing of the course's unfinished imports while it is on show. Answers the function that removes it. */
export function showImportListing(course: string, list: () => Promise<void>): () => void {
  const shown = listings.get(course) ?? new Set();
  listings.set(course, shown.add(list));
  return () => { shown.delete(list); if (!shown.size) listings.delete(course); };
}

/** Asks every listing on show for the course to list again. Settles when they have finished. */
export async function listImportsAgain(course: string): Promise<void> {
  await Promise.all([...listings.get(course) ?? []].map((list) => list()));
}

/**
 * Sends an upload form (`course`, `title`, `requestId`, `files`) and answers the saved material, if any, and the
 * sentence to show. `restart` gives the form a new request ID. The form starts a new request ID after an answer with
 * a material or a state, and after IMPORT_REMOVED or IMPORT_REQUEST_CONFLICT. It keeps the request ID after any
 * other refusal and when no answer arrives, so a retry continues from what the server already saved. After an answer
 * with a state, and when no answer arrives, the course's import listings list again.
 */
export async function submitImport(form: FormData, restart: () => void): Promise<{ material?: MaterialId; message: string }> {
  const files = form.getAll("files").filter((file): file is File => file instanceof File), course = String(form.get("course"));
  if (!files.length) throw new Error("Choose at least one file to import.");
  if (files.length > MAX_FILES) throw new Error("Choose up to 12 files for one import.");
  if (files.reduce((total, file) => total + file.size, 0) > MAX_UPLOAD_BYTES) throw new Error("Choose files with a combined size of 95 MB or less.");
  let answer: Awaited<ReturnType<typeof importMaterial>>;
  try { answer = await importMaterial(form); }
  catch (problem) {
    if (refusalStartsNewImport(problem)) restart();
    // No answer, or a page that is not the app's: the import may have reached the library. The listing runs in the
    // background, because a server that did not answer may also be slow to list.
    if (problem instanceof HostError && !problem.answered) { void listImportsAgain(course); throw new Error(NO_UPLOAD_ANSWER); }
    throw problem;
  }
  restart();
  if ("material" in answer) return { material: answer.material, message: "Material saved. Check the readable text, then find skills in it." };
  await listImportsAgain(course);
  return { message: answer.state === "TRANSCRIBING"
    ? "Upload saved. Your recording is being transcribed. This usually takes a few minutes, and longer for long recordings. You can keep studying."
    : "Upload saved. Your material will appear in a moment." };
}

/** Whether an import is still transcribing or saving, so the library lists again soon. */
export function importsInProgress(entries: ImportEntry[]) {
  return entries.some((entry) => entry.state === "TRANSCRIBING" || entry.state === "SAVING");
}

export const fileStateLabels: Record<ImportEntry["files"][number]["state"], string> = { DONE: "Done", WAITING: "Waiting", TRANSCRIBING: "Transcribing", FAILED: "Couldn't transcribe" };

/** The import card's status sentence. */
export function importStatus(entry: ImportEntry) {
  return entry.state === "TRANSCRIBING" ? "Transcribing. This usually takes a few minutes, and longer for long recordings. You can keep studying."
    : entry.state === "FAILED" ? "Couldn't finish this import." : "Saving…";
}

/** The import's failure sentence. A transcription failure follows "Couldn't transcribe NAME." */
export function importFailure(entry: ImportEntry) {
  if (!entry.detail) return "";
  const failed = entry.state === "SAVING" ? undefined : entry.files.find((file) => file.state === "FAILED");
  return failed ? `Couldn't transcribe ${failed.name}. ${entry.detail}` : entry.detail;
}

/** The library's announcement for the materials a listing saved, with their titles from the reloaded course. */
export function readyNotice(saved: MaterialId[], materials: { material: string; title: string }[]) {
  return saved.map((id) => `“${materials.find((item) => item.material === id)?.title ?? "Your material"}” is ready. Check the transcript, then find skills in it.`).join(" ");
}
