"""Prepare retained sources for tutoring. Reads a host-owned manifest on stdin."""
import hashlib
import json
import mimetypes
import pathlib
import stat
import subprocess
import sys
import tempfile
import zipfile
import shutil

import fitz
from PIL import Image, ImageOps
from docx import Document
from pptx import Presentation
from openpyxl import load_workbook

# Keep native PDF diagnostics separate from the machine-readable result.
fitz.set_messages(stream=sys.stderr)

MAX_PAGES = 50
MAX_FILES = 60
MAX_EXPANDED = 50 * 1024 * 1024
MAX_TEXT = 500_000
Image.MAX_IMAGE_PIXELS = 40_000_000

request = json.load(sys.stdin)
root = pathlib.Path(request["directory"]).resolve()
prefix = request["prefix"]
originals = []
texts = []
expanded = 0


def text_part(parts, location, text):
    if text.strip():
        texts.append(f"[{location}]\n{text}")
        if sum(map(len, texts)) > MAX_TEXT:
            raise ValueError("This material contains too much text. Import a smaller unit.")
        parts.append({"kind": "TEXT", "location": location, "text": text})


def image_part(parts, location, image):
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((1500, 1500))
    filename = hashlib.sha256(location.encode()).hexdigest() + ".jpg"
    image.save(root / filename, "JPEG", quality=90)
    parts.append({"kind": "IMAGE", "location": location, "file": prefix + "/" + filename, "mediaType": "image/jpeg"})


def pdf_parts(path, parts, key):
    with fitz.open(path) as pdf:
        if pdf.needs_pass:
            raise ValueError("This PDF needs a password. Upload an unlocked copy.")
        if len(pdf) > MAX_PAGES:
            raise ValueError(f"A source can contain at most {MAX_PAGES} pages. Import a smaller unit.")
        for i, page in enumerate(pdf):
            location = f"{key}/page/{i + 1}"
            text_part(parts, location, page.get_text())
            pix = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
            image_part(parts, location, Image.frombytes("RGB", (pix.width, pix.height), pix.samples))


def office_pdf(path, parts, key, limits):
    executable = shutil.which("soffice") or shutil.which("libreoffice")
    if not executable:
        limits.append("Document rendering is unavailable. Text and embedded images are retained; layout and drawn diagrams may be incomplete.")
        return False
    with tempfile.TemporaryDirectory(prefix="stillgotit-office-") as temporary:
        directory = pathlib.Path(temporary)
        try:
            result = subprocess.run([executable, "-env:UserInstallation=" + (directory / "profile").as_uri(),
                "--headless", "--convert-to", "pdf", "--outdir", str(directory), str(path)],
                capture_output=True, timeout=45)
            rendered = directory / (path.stem + ".pdf")
            if result.returncode != 0 or not rendered.is_file():
                raise ValueError("Rendering failed")
            pdf_parts(rendered, parts, key + "/rendered")
            return True
        except (subprocess.TimeoutExpired, ValueError):
            limits.append("The document could not be rendered. Available text is retained; inspect equations and diagrams in the original.")
            return False


def process(source, depth=0):
    global expanded
    if len(originals) >= MAX_FILES:
        raise ValueError("The import has too many files. Split it into smaller units.")
    relative = source["file"].removeprefix(prefix + "/")
    path = (root / relative).resolve()
    if path.parent != root or not path.is_file():
        raise ValueError("A retained source is missing.")
    suffix = pathlib.Path(source["name"]).suffix.lower()
    parts, limits = [], []
    key = hashlib.sha256(source["file"].encode()).hexdigest()[:16]
    record = {**source, "renditions": parts, "limitations": limits}
    originals.append(record)
    if suffix == ".pdf":
        pdf_parts(path, parts, key)
    elif suffix in (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tif", ".tiff"):
        with Image.open(path) as picture:
            image_part(parts, key + "/image", picture)
            if getattr(picture, "n_frames", 1) > 1:
                limits.append("Only the first image frame was retained for reading.")
    elif suffix == ".docx":
        document = Document(path)
        text_part(parts, key + "/document", "\n".join(p.text for p in document.paragraphs))
        for i, table in enumerate(document.tables):
            text_part(parts, f"{key}/table/{i + 1}", "\n".join("\t".join(cell.text for cell in row.cells) for row in table.rows))
        office_pdf(path, parts, key, limits)
    elif suffix == ".pptx":
        presentation = Presentation(path)
        if len(presentation.slides) > MAX_PAGES:
            raise ValueError("This presentation has too many slides. Import a smaller unit.")
        for i, slide in enumerate(presentation.slides):
            text_part(parts, f"{key}/slide/{i + 1}", "\n".join(shape.text for shape in slide.shapes if shape.has_text_frame))
        office_pdf(path, parts, key, limits)
    elif suffix in (".doc", ".ppt", ".odt", ".odp", ".rtf", ".xls", ".ods"):
        if not office_pdf(path, parts, key, limits):
            raise ValueError("This file needs LibreOffice rendering. Install LibreOffice or export the source as PDF.")
    elif suffix in (".xlsx", ".xlsm"):
        workbook = load_workbook(path, read_only=True, data_only=False)
        try:
            for sheet in workbook:
                if sheet.max_row > 20000 or sheet.max_column > 200:
                    raise ValueError("This sheet is too large for one import. Select a smaller range.")
                for start in range(1, sheet.max_row + 1, 100):
                    end = min(start + 99, sheet.max_row)
                    rows = []
                    for row in sheet.iter_rows(min_row=start, max_row=end):
                        rows.append(" | ".join(f"{cell.coordinate}: {cell.value}" for cell in row if cell.value is not None))
                    text_part(parts, f"{key}/sheet/{sheet.title}/rows/{start}-{end}", "\n".join(rows))
            limits.append("Cell values and formulas are retained. Embedded charts and worksheet formatting are not interpreted.")
        finally:
            workbook.close()
    elif suffix == ".ipynb":
        notebook = json.loads(path.read_text(encoding="utf-8"))
        for i, cell in enumerate(notebook.get("cells", [])):
            text_part(parts, f"{key}/cell/{i + 1}", "".join(cell.get("source", [])))
        limits.append("Notebook source cells are read without executing code. Saved graphical outputs are not interpreted.")
    elif suffix == ".zip":
        if depth >= 1:
            raise ValueError("Nested archives are not supported. Extract them before importing.")
        with zipfile.ZipFile(path) as archive:
            files = [info for info in archive.infolist() if not info.is_dir() and not info.filename.startswith("__MACOSX/")]
            if len(files) + len(originals) > MAX_FILES:
                raise ValueError("The archive contains too many files.")
            for item in files:
                entry = pathlib.PurePosixPath(item.filename)
                if entry.is_absolute() or ".." in entry.parts or stat.S_ISLNK(item.external_attr >> 16) or item.flag_bits & 1:
                    raise ValueError("The archive contains an unsafe path, link, or encrypted entry.")
                expanded += item.file_size
                if expanded > MAX_EXPANDED:
                    raise ValueError("The archive expands beyond the import size limit.")
                data = archive.read(item)
                extension = entry.suffix.lower()
                if len(extension) > 12 or not all(c.isalnum() or c == "." for c in extension):
                    extension = ".bin"
                filename = hashlib.sha256(data).hexdigest() + extension
                (root / filename).write_bytes(data)
                process({"file": prefix + "/" + filename, "name": item.filename,
                         "mediaType": mimetypes.guess_type(item.filename)[0] or "application/octet-stream"}, depth + 1)
        limits.append("Archive contents are retained as separate source files.")
    elif suffix in (".mp3", ".m4a", ".wav", ".ogg", ".flac", ".webm", ".mp4", ".mpeg", ".mpga"):
        # The host transcribes retained lecture audio through its provider.
        limits.append("Audio transcription is required before this source is ready.")
    else:
        try:
            content = path.read_text(encoding="utf-8-sig")
        except UnicodeError:
            raise ValueError("This binary format is not supported. Export it as PDF, an image, or text.")
        if "\x00" in content:
            raise ValueError("This file is not readable text.")
        lines = content.splitlines()
        for start in range(0, len(lines), 100):
            text_part(parts, f"{key}/lines/{start + 1}-{min(start + 100, len(lines))}", "\n".join(lines[start:start + 100]))


try:
    for source in request["sources"]:
        process(source)
    print(json.dumps({"originals": originals, "content": "\n\n".join(texts)}))
except Exception as error:
    print(json.dumps({"error": str(error) or "The file could not be read."}))
    sys.exit(1)
