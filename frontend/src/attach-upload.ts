/**
 * Attaching files to an answer ("Accepting an upload" in design/compositions/Materials.md). Each chosen file keeps one
 * request ID until an answer with its material arrives, so trying again never saves the work twice. IMPORT_REMOVED and
 * IMPORT_REQUEST_CONFLICT start a new request ID. An upload that answers SAVING or TRANSCRIBING finishes later in
 * Course materials, so the course's import listings list again and its card shows without a reload.
 */
import { HostError, refusalStartsNewImport, uploadMaterial } from "./host-api.ts";
import { listImportsAgain } from "./material-imports.ts";

/** One study page's attach control. `course` answers the page's course. */
export function useAttachUpload(course: () => string) {
  // One request ID per chosen file (name, size, last change) until that file's material arrives.
  const pending = new Map<string, string>();
  /** The files chosen in the input. The input is cleared, so choosing the same file again, to try again, fires another change. */
  function take(event: Event): File[] {
    const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []);
    input.value = "";
    return files;
  }
  /** Uploads the file as "My work: NAME" and answers its material. */
  async function upload(file: File) {
    const key = `${file.name}\n${file.size}\n${file.lastModified}`;
    const requestId = pending.get(key) ?? crypto.randomUUID();
    pending.set(key, requestId);
    const form = new FormData(); form.set("course", course()); form.set("title", `My work: ${file.name}`); form.set("requestId", requestId); form.append("files", file);
    try {
      const { material } = await uploadMaterial(form);
      pending.delete(key);
      return material;
    } catch (problem) {
      if (refusalStartsNewImport(problem)) pending.delete(key);
      if (problem instanceof HostError && (problem.code === "SAVING" || problem.code === "TRANSCRIBING")) void listImportsAgain(course());
      throw problem;
    }
  }
  return { take, upload };
}
