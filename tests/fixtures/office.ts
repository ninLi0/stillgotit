/** Small Office and PDF files built in memory for extraction edge cases. */
import { strToU8, zipSync } from "fflate";

const xml = (body: string) => strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`);
const A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"';
const P = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const R = 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RELS = 'xmlns="http://schemas.openxmlformats.org/package/2006/relationships"';
const MAIN = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

/** Each slide is raw `<a:p>` markup. `order` lists slide file numbers in presentation order. */
export function pptx(slides: string[], order?: number[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  slides.forEach((body, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = xml(`<p:sld ${A} ${P} ${R}><p:cSld><p:spTree><p:sp><p:txBody>${body}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
  });
  if (order) {
    files["ppt/presentation.xml"] = xml(`<p:presentation ${A} ${P} ${R}><p:sldIdLst>${order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`);
    files["ppt/_rels/presentation.xml.rels"] = xml(`<Relationships ${RELS}>${slides.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`);
  }
  return zipSync(files);
}

/** Each sheet is raw `<row>` markup. Shared strings are raw `<si>` bodies. */
export function xlsx(sheets: { name: string; rows: string }[], shared: string[] = []): Uint8Array {
  const files: Record<string, Uint8Array> = {
    "xl/workbook.xml": xml(`<workbook ${MAIN} ${R}><sheets>${sheets.map((sheet, i) =>
      `<sheet name="${sheet.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": xml(`<Relationships ${RELS}>${sheets.map((_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>`),
    "xl/sharedStrings.xml": xml(`<sst ${MAIN} count="${shared.length}">${shared.map((item) => `<si>${item}</si>`).join("")}</sst>`),
  };
  sheets.forEach((sheet, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = xml(`<worksheet ${MAIN}><sheetData>${sheet.rows}</sheetData></worksheet>`); });
  return zipSync(files);
}

/** A minimal Word file. Paragraphs are raw `<w:p>` markup. */
export function docx(paragraphs: string, extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    "[Content_Types].xml": xml(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`),
    "_rels/.rels": xml(`<Relationships ${RELS}><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": xml(`<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`),
    ...extra,
  });
}

/** A PDF with one Helvetica text line per page. An empty string makes a page with no text. */
export function pdf(pages: string[]): Uint8Array {
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${4 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const [i, text] of pages.entries()) {
    const stream = text ? `BT /F1 14 Tf 72 720 Td (${text.replace(/[()\\]/g, "\\$&")}) Tj ET` : "";
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  }
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => { const offset = body.length; body += `${i + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(body);
}

/** A 1×1 PNG image. */
export const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
