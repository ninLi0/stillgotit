import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import { classify, extract, OFFICE_LIMITATION, UNSUPPORTED } from "../src/host/extract.ts";
import { docx, pdf, png, pptx, xlsx } from "./fixtures/office.ts";

const reference = `${crypto.randomUUID()}/${"a".repeat(64)}.bin`;
const key = createHash("sha256").update(reference).digest("hex").slice(0, 16);
const fixture = async (name: string) => new Uint8Array(await readFile(resolve(import.meta.dir, "fixtures/materials", name)));
const read = async (name: string, bytes: Uint8Array) => {
  const result = await extract([{ file: reference, name, mediaType: "application/octet-stream", bytes }]);
  return { ...result.originals[0]!, content: result.content };
};
const texts = (renditions: readonly { kind: string; location: string; text?: string }[]) =>
  renditions.map((part) => [part.location, part.kind === "TEXT" ? part.text : part.kind]);
/** Rewrites every declared uncompressed size in a ZIP file. */
function declare(zip: Uint8Array, size: number) {
  const copy = zip.slice(), view = new DataView(copy.buffer);
  for (let i = 0; i + 4 <= copy.length; i++) {
    if (view.getUint32(i, true) === 0x04034b50) view.setUint32(i + 22, size, true);
    if (view.getUint32(i, true) === 0x02014b50) view.setUint32(i + 24, size, true);
  }
  return copy;
}

describe("PDF extraction", () => {
  test("keeps text for each page with page locations and no page images", async () => {
    const result = await read("lesson.pdf", await fixture("lesson.pdf"));
    expect(texts(result.renditions)).toEqual([
      [`${key}/page/1`, "Matrix multiplication\nMultiply each row of A by each column of B."],
      [`${key}/page/2`, "Inner dimensions\nA (m x n) times B (n x p) gives an m x p matrix."],
    ]);
    expect(result.limitations).toEqual([]);
    expect(result.content).toBe(`[${key}/page/1]\nMatrix multiplication\nMultiply each row of A by each column of B.\n\n` +
      `[${key}/page/2]\nInner dimensions\nA (m x n) times B (n x p) gives an m x p matrix.`);
  });

  test("reports pages without selectable text", async () => {
    const result = await read("scan.pdf", pdf(["First page", "", "Third page", ""]));
    expect(result.renditions.map((part) => part.location)).toEqual([`${key}/page/1`, `${key}/page/3`]);
    expect(result.limitations).toEqual(["Pages 2 and 4 have no selectable text."]);
    expect((await read("one.pdf", pdf(["Text", ""]))).limitations).toEqual(["Page 2 has no selectable text."]);
    const scan = await read("scan.pdf", pdf(["", ""]));
    expect(scan.renditions).toEqual([]);
    expect(scan.limitations).toEqual(["This PDF has no selectable text. It may be a scanned document."]);
  });

  test("refuses locked, damaged, and overly long PDFs", async () => {
    await expect(read("locked.pdf", await fixture("locked.pdf"))).rejects.toThrow("This PDF needs a password. Upload an unlocked copy.");
    await expect(read("broken.pdf", strToU8("%PDF-1.4 this is not a PDF"))).rejects.toThrow("This PDF can't be read. Check that it opens, or export it to PDF.");
    await expect(read("long.pdf", pdf(Array.from({ length: 51 }, (_, i) => `Page ${i + 1}`)))).rejects.toThrow("A source can contain at most 50 pages. Import a smaller unit.");
    expect((await read("fifty.pdf", pdf(Array.from({ length: 50 }, (_, i) => `Page ${i + 1}`)))).renditions).toHaveLength(50);
  });
});

describe("Office extraction", () => {
  test("Word text uses one document location and decodes entities", async () => {
    const result = await read("lesson.docx", await fixture("lesson.docx"));
    expect(texts(result.renditions)).toEqual([[`${key}/document`, "Matrix multiplication\n\nRows of A & columns of B combine when 2 < 3 is false.\n\nA11\n\nA12"]]);
    expect(result.limitations).toEqual([OFFICE_LIMITATION]);
  });

  test("PowerPoint text uses one location per slide in slide order", async () => {
    const result = await read("lesson.pptx", await fixture("lesson.pptx"));
    expect(texts(result.renditions)).toEqual([
      [`${key}/slide/1`, "Matrix multiplication\nRows of A & columns of B"],
      [`${key}/slide/2`, "Inner dimensions\n(m × n) times (n × p) is \"m × p\""],
    ]);
    expect(result.limitations).toEqual([OFFICE_LIMITATION]);
  });

  test("slides follow the presentation order, then file numbers", async () => {
    const slide = (text: string) => `<a:p><a:r><a:t>${text}</a:t></a:r></a:p>`;
    const listed = await read("order.pptx", pptx([slide("Second"), slide("First")], [2, 1]));
    expect(texts(listed.renditions)).toEqual([[`${key}/slide/1`, "First"], [`${key}/slide/2`, "Second"]]);
    const numbered = await read("numbers.pptx", pptx(Array.from({ length: 11 }, (_, i) => slide(`Slide ${i + 1}`))));
    expect(numbered.renditions.map((part) => part.kind === "TEXT" && part.text)).toEqual(Array.from({ length: 11 }, (_, i) => `Slide ${i + 1}`));
  });

  test("slide text joins runs, keeps breaks, decodes entities, and skips fallback copies", async () => {
    const body = `<a:p><a:r><a:t>Rows &amp; </a:t></a:r><a:r><a:t xml:space="preserve">columns</a:t></a:r><a:br/><a:r><a:t>&lt;A&gt; &#x3B1; &#946; &quot;q&quot; &apos;s&apos; &amp;lt;</a:t></a:r></a:p>` +
      `<a:p></a:p><mc:AlternateContent xmlns:mc="m"><mc:Choice Requires="a14"><a:p><a:r><a:t>Chosen</a:t></a:r></a:p></mc:Choice>` +
      `<mc:Fallback><a:p><a:r><a:t>Duplicate</a:t></a:r></a:p></mc:Fallback></mc:AlternateContent><a:p><a:r><a:t/></a:r></a:p>`;
    const result = await read("runs.pptx", pptx([body]));
    expect(texts(result.renditions)).toEqual([[`${key}/slide/1`, "Rows & columns\n<A> α β \"q\" 's' &lt;\nChosen"]]);
  });

  test("Excel text uses one location per sheet with cell references", async () => {
    const result = await read("lesson.xlsx", await fixture("lesson.xlsx"));
    expect(texts(result.renditions)).toEqual([
      [`${key}/sheet/Matrices/rows/1-4`, "A1: Matrix A | B1: Column 1 | C1: Column 2\nA2: Row 1 | B2: 1 | C2: 2\nA3: Row 2 | B3: 3 | C3: 4\nB4: =SUM(B2:B3)"],
      [`${key}/sheet/Notes & tips/rows/1-1`, "A1: Check <dimensions> first"],
    ]);
    expect(result.limitations).toEqual([OFFICE_LIMITATION]);
  });

  test("Excel cells cover shared, inline, rich, boolean, error, and formula values", async () => {
    const rows = `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><r><t>In</t></r><r><t>line</t></r></is></c></row>` +
      `<row r="3"><c t="b"><v>1</v></c><c t="e"><v>#DIV/0!</v></c><c><f>A3*2</f><v>2</v></c><c r="E3" s="1"/><c r="F3" t="str"><f>"x"&amp;"y"</f><v>xy</v></c></row>` +
      `<row r="4"><c r="AB4" t="s"><v>2</v></c></row>`;
    const shared = ["<t>Plain &amp; simple</t>", "<r><t>Ri</t></r><r><t>ch</t></r><rPh sb=\"0\" eb=\"1\"><t>hint</t></rPh>", "<t>Line_x000D_break</t>"];
    const result = await read("cells.xlsx", xlsx([{ name: "Data &amp; more", rows }, { name: "Empty", rows: "" }], shared));
    expect(texts(result.renditions)).toEqual([[`${key}/sheet/Data & more/rows/1-4`,
      "A1: Plain & simple | B1: Rich | C1: Inline\nA3: TRUE | B3: #DIV/0! | C3: =A3*2 = 2 | F3: =\"x\"&\"y\" = xy\nAB4: Line\rbreak"]]);
  });

  test("refuses sheets and presentations beyond the limits", async () => {
    await expect(read("tall.xlsx", xlsx([{ name: "Tall", rows: `<row r="20001"><c r="A20001"><v>1</v></c></row>` }]))).rejects.toThrow("This sheet is too large for one import. Select a smaller range.");
    await expect(read("wide.xlsx", xlsx([{ name: "Wide", rows: `<row r="1"><c r="GS1"><v>1</v></c></row>` }]))).rejects.toThrow("This sheet is too large");
    await expect(read("long.pptx", pptx(Array.from({ length: 51 }, () => "<a:p><a:r><a:t>x</a:t></a:r></a:p>")))).rejects.toThrow("This presentation has too many slides. Import a smaller unit.");
  });

  test("refuses damaged Office files with a clear message", async () => {
    const garbage = strToU8("PK\x03\x04 not really a zip file");
    await expect(read("bad.docx", garbage)).rejects.toThrow("This Word file can't be read. Check that it opens, or export it to PDF.");
    await expect(read("bad.pptx", garbage)).rejects.toThrow("This PowerPoint file can't be read. Check that it opens, or export it to PDF.");
    await expect(read("bad.xlsx", garbage)).rejects.toThrow("This Excel file can't be read. Check that it opens, or export it to PDF.");
    await expect(read("empty.docx", zipSync({ "notes.txt": strToU8("No document part") }))).rejects.toThrow("This Word file can't be read.");
  });

  test("refuses files that declare too much unpacked data before inflating them", async () => {
    const big = 60 * 1024 * 1024;
    await expect(read("bomb.pptx", declare(pptx(["<a:p><a:r><a:t>x</a:t></a:r></a:p>"]), big))).rejects.toThrow("This file is too large to read once it is unpacked. Import a smaller unit.");
    await expect(read("bomb.docx", declare(docx("<w:p/>"), big))).rejects.toThrow("This file is too large to read once it is unpacked.");
    await expect(read("bomb.xlsx", declare(xlsx([{ name: "A", rows: "" }]), big))).rejects.toThrow("This file is too large to read once it is unpacked.");
  });

  test("an entry that understates its size inflates only to the declared size", async () => {
    const slide = "<a:p><a:r><a:t>Matrix</a:t></a:r></a:p>".repeat(50_000);
    const result = await read("liar.pptx", declare(pptx([slide]), 1000));
    expect(result.content.length).toBeLessThan(1000);
    const word = docx(`<w:p><w:r><w:t>${"Matrix ".repeat(200_000)}</w:t></w:r></w:p>`);
    // The truncated Word XML no longer parses, so the file is refused instead of expanding.
    await expect(read("liar.docx", declare(word, 1000))).rejects.toThrow("This Word file can't be read.");
  });
});

describe("Text, notebooks, and images", () => {
  test("text keeps 100-line locations and removes a byte-order mark", async () => {
    const lines = Array.from({ length: 250 }, (_, i) => `Line ${i + 1}`);
    const result = await read("notes.md", strToU8(`${String.fromCharCode(0xfeff)}${lines.join("\r\n")}\n`));
    expect(result.renditions.map((part) => part.location)).toEqual([`${key}/lines/1-100`, `${key}/lines/101-200`, `${key}/lines/201-250`]);
    expect(result.renditions[0]!.kind === "TEXT" && result.renditions[0]!.text.startsWith("Line 1\nLine 2\n")).toBe(true);
    expect(result.limitations).toEqual([]);
    expect((await read("solve.py", strToU8("x = 1\n"))).renditions).toEqual([{ kind: "TEXT", location: `${key}/lines/1-1`, text: "x = 1" }]);
  });

  test("notebooks keep one location per cell", async () => {
    const notebook = JSON.stringify({ cells: [{ cell_type: "markdown", source: ["# Matrix ", "multiplication"] }, { cell_type: "code", source: "" }, { cell_type: "code", source: "A @ B" }] });
    const result = await read("lesson.ipynb", strToU8(notebook));
    expect(texts(result.renditions)).toEqual([[`${key}/cell/1`, "# Matrix multiplication"], [`${key}/cell/3`, "A @ B"]]);
    expect(result.limitations).toEqual(["Notebook source cells are read without executing code. Saved graphical outputs are not interpreted."]);
    await expect(read("broken.ipynb", strToU8("{ cells: "))).rejects.toThrow("This notebook can't be read. Check that it is a valid Jupyter notebook file.");
    await expect(read("list.ipynb", strToU8("[]"))).rejects.toThrow("This notebook can't be read.");
  });

  test("images are passed through as their own image rendition", async () => {
    const result = await read("photo.png", png);
    expect(result.renditions).toEqual([{ kind: "IMAGE", location: `${key}/image`, file: reference, mediaType: "image/png" }]);
    expect(result.content).toBe("");
    const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16]), webp = strToU8("RIFF\0\0\0\0WEBPVP8 ");
    expect((await read("photo.jpg", jpeg)).renditions[0]).toMatchObject({ mediaType: "image/jpeg" });
    expect((await read("photo.webp", webp)).renditions[0]).toMatchObject({ mediaType: "image/webp" });
    await expect(read("photo.png", strToU8("not an image"))).rejects.toThrow("This image can't be read. Upload a PNG, JPEG, or WebP image.");
  });

  test("too much text is refused", async () => {
    await expect(read("long.txt", strToU8("word ".repeat(120_000)))).rejects.toThrow("This material contains too much text. Import a smaller unit.");
  });
});

describe("Refusals", () => {
  test.each([
    ["lesson.zip", zipSync({ "a.md": strToU8("# A") }), UNSUPPORTED],
    ["lecture.mp3", strToU8("ID3\u0003\0\0\0"), UNSUPPORTED],
    ["lecture.m4a", strToU8("plain"), UNSUPPORTED],
    ["notes.rtf", strToU8("{\\rtf1 Hello}"), UNSUPPORTED],
    ["data.bin", strToU8("text"), UNSUPPORTED],
    ["program", Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0, 1]), UNSUPPORTED],
    ["latin.txt", Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), UNSUPPORTED],
    ["slides.ppt", strToU8("old"), "This older Office format can't be imported. Save the file as .docx, .pptx, or .xlsx, or export it to PDF."],
    ["report.doc", strToU8("old"), "This older Office format can't be imported."],
    ["anim.gif", strToU8("GIF89a"), "This image format can't be imported. Upload a PNG, JPEG, or WebP image."],
  ])("%s is refused", (name, bytes, message) => {
    expect(() => classify(name, bytes)).toThrow(message);
  });

  test("the unsupported-type message lists what can be imported", () => {
    expect(UNSUPPORTED).toBe("This file type can't be imported. Upload a PDF, image, text, notebook, Word, PowerPoint, or Excel file.");
    expect(classify("LESSON.PDF", new Uint8Array())).toBe("pdf");
    expect(classify("Makefile", strToU8("all:\n"))).toBe("text");
  });
});
