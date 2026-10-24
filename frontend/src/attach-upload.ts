/**
 * Attaching a file to an answer ("Accepting an upload" in design/compositions/Materials.md). The chosen file keeps one
 * request ID until an answer with its material arrives, so trying again never saves the work twice. IMPORT_REMOVED and
 * IMPORT_REQUEST_CONFLICT start a new request ID. An upload that answers SAVING or TRANSCRIBING finishes later in
 * Course materials, so the course's import listings list again and its card shows without a reload.
 */
import { HostError, refusalStartsNewImport, uploadMaterial } from "./host-api.ts";
import { listImportsAgain } from "./material-imports.ts";

/** One study page's attach control. `course` answers the page's course. */
export function useAttachUpload(course: () => string) {
  let chosen = { file: "", requestId: "" };
  /** The file chosen in the input. The input is cleared, so choosing the same file again, to try again, fires another change. */
  function take(event: Event): File | undefined {
    const input = event.target as HTMLInputElement, file = input.files?.[0];
    if (file) input.value = "";
    return file;
  }
  /** Uploads the file as "My work: NAME" and answers its material. */
  async function upload(file: File) {
    const key = `${file.name}\n${file.size}\n${file.lastModified}`;
    if (chosen.file !== key) chosen = { file: key, requestId: crypto.randomUUID() };
    const form = new FormData(); form.set("course", course()); form.set("title", `My work: ${file.name}`); form.set("requestId", chosen.requestId); form.append("files", file);
    try {
      const { material } = await uploadMaterial(form);
      chosen = { file: "", requestId: "" };
      return material;
    } catch (problem) {
      if (refusalStartsNewImport(problem)) chosen = { file: "", requestId: "" };
      if (problem instanceof HostError && (problem.code === "SAVING" || problem.code === "TRANSCRIBING")) void listImportsAgain(course());
      throw problem;
    }
  }
  return { take, upload };
}
