import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import {
  ARCHIVE, classify, extract, IMAGE_UNREADABLE, joinContent, MAX_TEXT, OFFICE_LIMITATION, OLD_OFFICE, OTHER_AUDIO, OTHER_IMAGE, OTHER_VIDEO,
  RECORDING_TOO_LONG, RECORDING_UNREADABLE, TOO_MUCH_TEXT, transcriptText, UNSUPPORTED,
} from "../src/host/extract.ts";
import { wholeSeconds } from "../src/host/media-detect.ts";
import { docx, pdf, png, pptx, xlsx } from "./fixtures/office.ts";
import { adts, aiff, avi, flac, flv, heif, jpeg, mp3, mp4, mpegPs, ogg, scannedPdf, wav, webm, wmv } from "./fixtures/media.ts";

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

  test("a page without selectable text becomes a page location that the tutor reads from the original", async () => {
    const result = await read("scan.pdf", pdf(["First page", "", "Third page", ""]));
    expect(texts(result.renditions)).toEqual([[`${key}/page/1`, "First page"], [`${key}/page/2`, "PAGE"], [`${key}/page/3`, "Third page"], [`${key}/page/4`, "PAGE"]]);
    expect(result.renditions[1]).toEqual({ kind: "PAGE", location: `${key}/page/2`, page: 2 });
    expect(result.limitations).toEqual(["Pages 2 and 4 have no selectable text. The tutor reads those pages as images."]);
    expect(result.content).toBe(`[${key}/page/1]\nFirst page\n\n[${key}/page/3]\nThird page`);
    expect((await read("one.pdf", pdf(["Text", ""]))).limitations).toEqual(["Page 2 has no selectable text. The tutor reads that page as an image."]);
    const three = await read("three.pdf", pdf(["", "Text", "", "", "Text"]));
    expect(three.limitations).toEqual(["Pages 1, 3, and 4 have no selectable text. The tutor reads those pages as images."]);
  });

  test("a scanned PDF is accepted with a page location for every page and empty content", async () => {
    const scan = await read("scan.pdf", scannedPdf([null, null, null]));
    expect(scan.renditions).toEqual([1, 2, 3].map((page) => ({ kind: "PAGE", location: `${key}/page/${page}`, page })));
    expect(scan.limitations).toEqual(["This PDF has no selectable text. The tutor reads its pages as images."]);
    expect(scan.content).toBe("");
  });

  test("a partly scanned PDF keeps its text and marks the scanned page", async () => {
    const partly = await read("partly.pdf", scannedPdf(["Eigenvalues solve det(A - tI) = 0.", null]));
    expect(texts(partly.renditions)).toEqual([[`${key}/page/1`, "Eigenvalues solve det(A - tI) = 0."], [`${key}/page/2`, "PAGE"]]);
    expect(partly.limitations).toEqual(["Page 2 has no selectable text. The tutor reads that page as an image."]);
  });

  test("refuses locked, damaged, and overly long PDFs", async () => {
    await expect(read("locked.pdf", await fixture("locked.pdf"))).rejects.toThrow("This PDF needs a password. Upload an unlocked copy.");
    await expect(read("broken.pdf", strToU8("%PDF-1.4 this is not a PDF"))).rejects.toThrow("This PDF can't be read. Check that it opens, or export it to PDF.");
    // A file named .pdf without a PDF header is refused before anything is saved.
    expect(() => classify("fake.pdf", strToU8("Hello"))).toThrow("This PDF can't be read. Check that it opens, or export it to PDF.");
    expect(classify("late.pdf", strToU8(`${" ".repeat(100)}%PDF-1.7`))).toEqual({ kind: "pdf", mediaType: "application/pdf" });
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
    await expect(read("photo.png", strToU8("not an image"))).rejects.toThrow(IMAGE_UNREADABLE);
  });

  test("HEIC and HEIF photos are images, and the type comes from the bytes", async () => {
    const heic = await read("IMG_0001.HEIC", heif());
    expect(heic.renditions).toEqual([{ kind: "IMAGE", location: `${key}/image`, file: reference, mediaType: "image/heic" }]);
    expect(heic.limitations).toEqual([]);
    for (const brand of ["heic", "heix", "hevc", "hevx", "heim", "heis"]) expect(classify("a.heif", heif(brand, [brand]))).toEqual({ kind: "image", mediaType: "image/heic" });
    for (const brand of ["mif1", "msf1"]) expect(classify("a.heic", heif(brand, [brand]))).toEqual({ kind: "image", mediaType: "image/heif" });
    // A photo named .heic whose bytes are JPEG is saved as JPEG.
    expect(classify("photo.heic", jpeg)).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(classify("photo.png", jpeg)).toEqual({ kind: "image", mediaType: "image/jpeg" });
    expect(() => classify("photo.heic", heif("avif", ["mif1", "avif"]))).toThrow(IMAGE_UNREADABLE);
    expect(() => classify("photo.heic", heif("isom", ["mp41"]))).toThrow(IMAGE_UNREADABLE);
    expect(IMAGE_UNREADABLE).toBe("This image can't be read. Upload a PNG, JPEG, WebP, HEIC, or HEIF image.");
  });

  test("too much text is refused", async () => {
    await expect(read("long.txt", strToU8("word ".repeat(120_000)))).rejects.toThrow("This material contains too much text. Import a smaller unit.");
  });

  test("the text limit counts the joined content exactly, including locations and separators", async () => {
    const location = `${key}/lines/1-1`, overhead = location.length + 3;
    const exact = await read("exact.txt", strToU8("x".repeat(MAX_TEXT - overhead)));
    expect(exact.content).toHaveLength(MAX_TEXT);
    expect(exact.content).toBe(joinContent([exact]));
    await expect(read("over.txt", strToU8("x".repeat(MAX_TEXT - overhead + 1)))).rejects.toThrow(TOO_MUCH_TEXT);
  });

  test("an unknown extension is read as text when it is UTF-8", async () => {
    expect(texts((await read("Makefile", strToU8("all:\n\techo hi\n"))).renditions)).toEqual([[`${key}/lines/1-2`, "all:\n\techo hi"]]);
    expect(classify("notes.tex", strToU8("\\section{A}"))).toEqual({ kind: "text" });
  });
});

describe("Caption files", () => {
  const vtt = [
    "WEBVTT Kind: captions", "Language: en", "",
    "NOTE Recorded in lecture 3.", "This note has two lines.", "",
    "STYLE", "::cue { color: yellow }", "",
    "intro", "00:00:00.000 --> 00:00:02.500 align:start position:10%", "<v Professor Jackson>Welcome back. Today we look at", "<i>concept design</i>.", "",
    "00:00:02.600 --> 00:00:04.000", "It starts from purposes &amp; ends", "",
    // A long pause after a cue that does not end a sentence keeps the paragraph going.
    "00:00:07.000 --> 00:00:08.000", "with <00:00:07.500><c>syncs</c>.", "",
    "00:00:11.000 --> 00:00:12.000", "<v Professor Jackson>After a pause, a new paragraph.", "",
    "3", "00:00:12.200 --> 00:00:13.000", "<v.loud Student>Can a concept   have two purposes?", "",
  ].join("\n");
  const vttText = "Professor Jackson: Welcome back. Today we look at concept design. It starts from purposes & ends with syncs.\n\n" +
    "Professor Jackson: After a pause, a new paragraph.\n\nStudent: Can a concept have two purposes?";

  test("a WebVTT file is read as paragraphs without its header, notes, styles, cue names, times, or tags", async () => {
    expect(transcriptText(vtt)).toBe(vttText);
    const result = await read("lecture3.vtt", strToU8(vtt));
    expect(texts(result.renditions)).toEqual([[`${key}/lines/1-5`, vttText]]);
    expect(result.limitations).toEqual([]);
    // The original stays as it was received; only its readable text changes.
    expect(result).toMatchObject({ file: reference, name: "lecture3.vtt", mediaType: "application/octet-stream" });
  });

  test("a SubRip file is read as paragraphs without its cue numbers, times, or tags", async () => {
    const srt = "1\r\n00:00:01,000 --> 00:00:03,000\r\n<i>Matrix multiplication</i> is not\r\ncommutative.\r\n\r\n" +
      "2\r\n00:00:03,500 --> 00:00:05,000\r\n<font color=\"#ffff00\">AB</font> and BA can differ.\r\n\r\n" +
      "3\r\n00:00:08,000 --> 00:00:10,000\r\nCheck the inner dimensions first.\r\n";
    const text = "Matrix multiplication is not commutative. AB and BA can differ.\n\nCheck the inner dimensions first.";
    expect(texts((await read("lecture.srt", strToU8(srt))).renditions)).toEqual([[`${key}/lines/1-3`, text]]);
  });

  test("a caption file is recognized by its content, whatever its name", async () => {
    expect(texts((await read("captions.txt", strToU8(vtt))).renditions)).toEqual([[`${key}/lines/1-5`, vttText]]);
    expect(texts((await read("notes.vtt", strToU8("Not captions\n"))).renditions)).toEqual([[`${key}/lines/1-1`, "Not captions"]]);
  });

  test("ordinary text that mentions cue times is unchanged", async () => {
    const notes = "Lecture notes\n00:00:01.000 --> 00:00:02.000 is how a cue time looks.\n\n1. Read <i>Chapter 3</i> &amp; take notes.";
    expect(transcriptText(notes)).toBeNull();
    expect(texts((await read("notes.txt", strToU8(notes))).renditions)).toEqual([[`${key}/lines/1-4`, notes]]);
  });

  test("speakers, pauses, and loosely written cues", () => {
    // A voice tag starts a paragraph when the speaker changes; a cue without one continues the current speaker.
    expect(transcriptText("WEBVTT\n00:01.000 --> 00:02.000\n<v Ann>Hi.\n<v Bob>Hello <b>there</b>.\n\n00:02.500 --> 00:03.000\nStill Bob.\n\n" +
      "00:06.000 --> 00:07.000\nAfter a pause.")).toBe("Ann: Hi.\n\nBob: Hello there. Still Bob.\n\nBob: After a pause.");
    // Cues without a blank line between them, text after a blank line inside a cue, and angle brackets that are not tags.
    expect(transcriptText("1\n00:00:01,000 --> 00:00:02,000\nNo blank line.\n2\n00:00:02,000 --> 00:00:03,000\nNext cue.\n\nSame cue. x < y, a<b and c>d"))
      .toBe("No blank line. Next cue. Same cue. x < y, a<b and c>d");
  });

  test("blocks hold 100 lines and end with a paragraph, and a file with no cue text has no readable text", async () => {
    const cues = Array.from({ length: 60 }, (_, i) => `${i + 1}\n00:${String(i).padStart(2, "0")}:00,000 --> 00:${String(i).padStart(2, "0")}:01,000\nSentence ${i + 1}.`);
    const result = await read("long.srt", strToU8(cues.join("\n\n")));
    const paragraphs = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `Sentence ${from + i}.`).join("\n\n");
    expect(texts(result.renditions)).toEqual([[`${key}/lines/1-99`, paragraphs(1, 50)], [`${key}/lines/101-119`, paragraphs(51, 60)]]);
    const empty = await read("empty.vtt", strToU8("WEBVTT\n\nNOTE Nothing was said.\n\n00:01.000 --> 00:02.000\n<c> </c>\n"));
    expect(empty.renditions).toEqual([]);
    expect(empty.content).toBe("");
  });
});

describe("Recordings and videos", () => {
  const seconds = (name: string, bytes: Uint8Array) => {
    const detected = classify(name, bytes);
    if (detected.kind !== "recording") throw new Error(`${name} is not a recording`);
    return { mediaType: detected.mediaType, video: detected.recording.video, seconds: detected.recording.seconds, whole: wholeSeconds(detected.recording) };
  };

  test.each([
    ["lecture.wav", () => wav(3), "audio/wav", 3],
    ["alaw.wav", () => wav(2, { format: 6, bits: 8 }), "audio/wav", 2],
    ["mulaw.wav", () => wav(2, { format: 7, bits: 8 }), "audio/wav", 2],
    ["stereo.wav", () => wav(1.5, { rate: 44100, channels: 2 }), "audio/wav", 1.5],
    ["voice.aiff", () => aiff(2.5), "audio/aiff", 2.5],
    ["voice.aif", () => aiff(1, 44100), "audio/aiff", 1],
    ["music.flac", () => flac(6), "audio/flac", 6],
    ["voice.opus", () => ogg(7), "audio/ogg", 7],
    ["voice.ogg", () => ogg(3, "vorbis"), "audio/ogg", 3],
    ["voice.oga", () => ogg(2), "audio/ogg", 2],
    ["memo.m4a", () => mp4({ seconds: 9, video: false, brand: "M4A " }), "audio/mp4", 9],
    ["audio-only.mp4", () => mp4({ seconds: 4, video: false }), "audio/mp4", 4],
    ["audio-only.mov", () => mp4({ seconds: 4, video: false, quicktime: true }), "audio/mp4", 4],
    ["clip.mp4", () => mp4({ seconds: 9 }), "video/mp4", 9],
    ["clip.m4v", () => mp4({ seconds: 3 }), "video/mp4", 3],
    ["clip.mov", () => mp4({ seconds: 4, quicktime: true }), "video/mov", 4],
    ["clip.3gp", () => mp4({ seconds: 4, brand: "3gp4" }), "video/3gpp", 4],
    ["clip.3gpp", () => mp4({ seconds: 5, brand: "3gp6" }), "video/3gpp", 5],
    ["recorded.webm", () => webm({ seconds: 3.5 }), "audio/webm", 3.5],
    ["camera.webm", () => webm({ seconds: 2.5, video: true }), "video/webm", 2.5],
    ["declared.webm", () => webm({ seconds: 2, duration: true }), "audio/webm", 2],
    ["clip.mpg", () => mpegPs(6), "video/mpeg", 6],
    ["clip.mpeg", () => mpegPs(2), "video/mpeg", 2],
    ["clip.avi", () => avi(5), "video/avi", 5],
    ["clip.flv", () => flv(4), "video/x-flv", 4],
    ["clip.wmv", () => wmv(8), "video/wmv", 8],
  ] as const)("%s has its type and length read from its container", (name, make, mediaType, length) => {
    const found = seconds(name, make());
    expect(found.mediaType).toBe(mediaType);
    expect(found.video).toBe(mediaType.startsWith("video/"));
    expect(found.seconds).toBeCloseTo(length, 5);
  });

  test("streams without a length header are measured by their frames or last timestamp", () => {
    // 128 kbit/s MPEG-1 Layer III frames last 1,152 / 44,100 seconds each.
    const mp3Length = seconds("lecture.mp3", mp3(5));
    expect(mp3Length).toMatchObject({ mediaType: "audio/mp3", video: false, whole: 6 });
    expect(mp3Length.seconds).toBeCloseTo(Math.ceil(5 * 44100 / 1152) * 1152 / 44100, 6);
    expect(seconds("lecture.mpga", mp3(2, { id3: false })).seconds).toBeCloseTo(Math.ceil(2 * 44100 / 1152) * 1152 / 44100, 6);
    // A Xing header gives the frame count directly.
    expect(seconds("vbr.mp3", mp3(1, { xing: 1000 })).seconds).toBeCloseTo(1000 * 1152 / 44100, 6);
    expect(seconds("voice.aac", adts(4)).seconds).toBeCloseTo(Math.ceil(4 * 44100 / 1024) * 1024 / 44100, 6);
    // A browser-made WebM has no duration and clusters of unknown size; the last block gives the length.
    expect(seconds("browser.webm", webm({ seconds: 61.24 })).seconds).toBeCloseTo(61.24, 6);
    // A fragmented MP4 from a browser declares no length; its fragments do.
    const fragmented = seconds("browser.mp4", mp4({ seconds: 10, video: false, fragmented: true }));
    expect(fragmented.mediaType).toBe("audio/mp4");
    expect(Math.abs(fragmented.seconds - 10)).toBeLessThan(1024 / 48000);
  });

  test("a recording longer than two hours is refused before saving", () => {
    // One byte per second: 7,201 bytes of 1 Hz audio last 7,201 seconds.
    expect(() => classify("long.wav", wav(7201, { rate: 1, bits: 8 }))).toThrow(RECORDING_TOO_LONG);
    expect(seconds("limit.wav", wav(7200, { rate: 1, bits: 8 })).seconds).toBe(7200);
    expect(() => classify("long.mp3", mp3(1, { xing: Math.ceil(7201 * 44100 / 1152) }))).toThrow(RECORDING_TOO_LONG);
    expect(RECORDING_TOO_LONG).toBe("Recordings and videos can be at most 2 hours long. Split the recording and import each part.");
  });

  test.each([
    ["empty.wav", new Uint8Array()],
    ["text.mp3", strToU8("not audio at all")],
    ["plain.m4a", strToU8("plain")],
    ["id3-only.mp3", strToU8("ID3\u0003\0\0\0")],
    ["silent.wav", wav(0)],
    ["nolength.flac", flac(6, { samples: 0 })],
    ["cut.mp4", mp4({ seconds: 3 }).slice(0, 40)],
    ["zero.webm", webm({ seconds: 0 })],
    ["wrong.webm", wav(3)],
    ["wrong.ogg", mp3(1)],
  ])("%s is refused as unreadable", (name, bytes) => {
    expect(() => classify(name, bytes)).toThrow(RECORDING_UNREADABLE);
  });

  test("Ogg video and Windows Media audio are refused like their own formats", () => {
    expect(() => classify("video.ogg", ogg(3, "theora"))).toThrow(OTHER_VIDEO);
    expect(() => classify("audio.wmv", wmv(3, { video: false }))).toThrow(OTHER_AUDIO);
  });

  test("a recording gets no renditions at upload and is listed for transcription", async () => {
    const recording = `${crypto.randomUUID()}/${"b".repeat(64)}.wav`;
    const result = await extract([
      { file: reference, name: "notes.md", mediaType: "text/markdown", bytes: strToU8("Eigenvalues") },
      { file: recording, name: "lecture.wav", mediaType: "audio/wav", bytes: wav(2) },
    ]);
    expect(result.recordings).toEqual([recording]);
    expect(result.originals[1]).toEqual({ file: recording, name: "lecture.wav", mediaType: "audio/wav", renditions: [], limitations: [] });
    expect(result.content).toBe(`[${key}/lines/1-1]\nEigenvalues`);
  });
});

describe("Refusals", () => {
  test.each([
    ...[".zip", ".7z", ".rar", ".tar", ".gz", ".tgz", ".bz2", ".xz"].map((extension) => [`lesson${extension}`, zipSync({ "a.md": strToU8("# A") }), ARCHIVE] as const),
    ...[".doc", ".dot", ".ppt", ".pps", ".pot", ".xls", ".xlt"].map((extension) => [`old${extension}`, strToU8("old"), OLD_OFFICE] as const),
    ...[".gif", ".bmp", ".tif", ".tiff", ".avif"].map((extension) => [`picture${extension}`, strToU8("GIF89a"), OTHER_IMAGE] as const),
    ...[".wma", ".amr", ".caf", ".pcm", ".raw"].map((extension) => [`voice${extension}`, wav(1), OTHER_AUDIO] as const),
    ...[".mkv", ".ogv"].map((extension) => [`clip${extension}`, mp4({ seconds: 1 }), OTHER_VIDEO] as const),
    ["stream.ts", Uint8Array.from([0x47, 0x40, 0x00, 0x10, 0x00, 0xff, 0xfe]), OTHER_VIDEO],
    ["notes.rtf", strToU8("{\\rtf1 Hello}"), UNSUPPORTED],
    ["data.bin", strToU8("text"), UNSUPPORTED],
    ["program", Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 0, 1]), UNSUPPORTED],
    ["latin.txt", Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), UNSUPPORTED],
  ] as const)("%s is refused before saving", (name, bytes, message) => {
    expect(() => classify(name, bytes)).toThrow(message);
  });

  test("each refusal sentence tells the learner what to do instead", () => {
    expect(UNSUPPORTED).toBe("This file type can't be imported. Upload a PDF, image, audio recording, video, text, notebook, Word, PowerPoint, or Excel file.");
    expect(ARCHIVE).toBe("ZIP and other archive files can't be imported. Unzip them and choose the files inside.");
    expect(OLD_OFFICE).toBe("This older Office format can't be imported. Save the file as .docx, .pptx, or .xlsx, or export it to PDF.");
    expect(OTHER_IMAGE).toBe("This image format can't be imported. Upload a PNG, JPEG, WebP, HEIC, or HEIF image.");
    expect(OTHER_AUDIO).toBe("This audio format can't be imported. Save the recording as MP3 or M4A and import it again.");
    expect(OTHER_VIDEO).toBe("This video format can't be imported. Save the video as MP4 and import it again.");
    expect(RECORDING_UNREADABLE).toBe("This recording can't be read. Check that it plays, then save it as MP3, M4A, or MP4 and import it again.");
  });

  test("how each file is read comes from its name and bytes", () => {
    expect(classify("LESSON.PDF", strToU8("%PDF-1.4"))).toEqual({ kind: "pdf", mediaType: "application/pdf" });
    expect(classify("Makefile", strToU8("all:\n"))).toEqual({ kind: "text" });
    expect(classify("lesson.docx", new Uint8Array())).toEqual({ kind: "docx" });
    // `.ts` is TypeScript source when it is UTF-8 text.
    expect(classify("solver.ts", strToU8("export const x = 1;\n"))).toEqual({ kind: "text" });
  });
});
