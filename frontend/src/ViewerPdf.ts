import type { PDFDocumentProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

// pdf.js for the Materials viewer, loaded only when a PDF is shown so other screens do not download it. The legacy
// build is used because the modern one needs very recent browser features (such as Map.prototype.getOrInsertComputed);
// the API is the same. The bytes always come from the host's checked file route (host-api.ts, materialFile).

type PdfLib = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let library: Promise<PdfLib> | null = null;

function pdfjs(): Promise<PdfLib> {
  library ??= Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), import("pdfjs-dist/legacy/build/pdf.worker.min.mjs?url")])
    .then(([lib, worker]) => { lib.GlobalWorkerOptions.workerSrc = worker.default; return lib; });
  // A failed download (for example while offline) is tried again next time.
  library.catch(() => { library = null; });
  return library;
}

/** Opens a PDF from its bytes. The caller destroys the document when it is no longer shown. */
export async function openPdf(blob: Blob): Promise<PDFDocumentProxy> {
  const lib = await pdfjs();
  const data = new Uint8Array(await blob.arrayBuffer());
  return lib.getDocument({ data, verbosity: lib.VerbosityLevel.ERRORS }).promise;
}

export type { PDFDocumentProxy };
