# Material data

This document defines the concrete values that the [MaterialKeeping](concepts/MaterialKeeping.md) concept saves. The application's instance of it is called Library. The importer prepares these values before calling `Library.add`, and GroundedTutoring uses the same `MediaValue` representation for files that a learner attaches to a response.

## Retained files

Each `MediaValue` has these fields:

| Field | Meaning |
| --- | --- |
| `file` | A nonblank, stable reference assigned by the host to a retained original file. |
| `name` | The original file's nonblank display name. |
| `mediaType` | Its MIME type, such as `application/pdf`, `image/heic`, `audio/mp3`, or `video/mp4`. |
| `renditions` | An ordered list of readable text, images, or pages derived from the original. It may be empty when extraction produced nothing usable. |
| `limitations` | An ordered list of nonblank descriptions of extraction gaps. An empty list means the producer reported no gaps. |

A rendition has one of three kinds:

- A text rendition has `kind: TEXT`, a nonblank `location`, and nonblank `text`. Page text, slide text, transcript segments, and the other text formats use it.
- An image rendition has `kind: IMAGE`, a nonblank `location`, a retained `file` reference, and `mediaType` set to `image/png`, `image/jpeg`, `image/webp`, `image/heic`, or `image/heif`. For an uploaded image, the rendition refers to the original file itself.
- A page rendition has `kind: PAGE`, a nonblank `location`, and a positive whole-number `page`. It stands for one page of its own original PDF that has no selectable text. It has no text and no file of its own; the tutor reads that page from the original PDF. A page rendition appears only in a PDF original, at most once for each page, and never beside a text rendition for the same page.

The importer produces this representation; extraction tests verify representative files. Materials saved before page renditions and HEIC images were accepted stay valid, because the new values only add to what is accepted.

`MediaList` preserves original-file order and each file's rendition and limitation order. Unknown fields and malformed records are rejected. The stored values contain only the declared fields. Temporary microphone recordings are not retained file references.

## Locations

Locations are stable source labels. Each starts with a key: the first 16 hexadecimal characters of the SHA-256 digest of the file reference. The importer assigns them consistently within a material. MaterialKeeping preserves the supplied locations, and the host's citation checks use them. A citation may name any rendition's location, or `content` when the material's content is not blank. Multiple renditions can show the same source location.

| Source | Location | Example |
| --- | --- | --- |
| PDF page, with or without text | `key/page/N` | `9c1f0e2ab34d5e6f/page/3` |
| Image, including HEIC and HEIF | `key/image` | `d04e7a5c19b2f368/image` |
| Recording or video segment | `key/time/START-END` | `4be0c1d29a7f3e65/time/00:30-00:45` |
| Text, Markdown, code, or caption file lines | `key/lines/A-B` | `51e8a0d3c7f2b964/lines/101-200` |
| Notebook cell | `key/cell/N` | `7a2c4e9f0b1d3865/cell/4` |
| Word document | `key/document` | `e3b7c1a09d4f2658/document` |
| PowerPoint slide | `key/slide/N` | `0f9d2b6e4a8c1735/slide/7` |
| Excel sheet | `key/sheet/NAME/rows/1-LAST` | `6c4a8e1f3d0b2975/sheet/Grades/rows/1-40` |

A time is a whole number of seconds from the start of the recording. A time under one hour is written `MM:SS`, with two digits for each part. A time of one hour or more is written `H:MM:SS`. For example, `a3c58e7f20d1b694/time/59:48-1:00:21` runs from 59 minutes 48 seconds to 1 hour 0 minutes 21 seconds, and `a3c58e7f20d1b694/time/1:02:05-1:02:40` lies in the second hour. Each start is earlier than its end.

## The importer

The upload route reads each document in memory with TypeScript (`src/host/extract.ts`), from the bytes it received in the request; it does not read them back from the file store. It does not start other programs or write temporary files. For a recording or video, it reads only the file's header and timestamps, to learn its type and length; Gemini transcribes it later, as described under [Recordings and transcripts](#recordings-and-transcripts). The material's `content` joins every text rendition, in file and rendition order, as `[location]` followed by its text. A material made only of scanned pages and images may have empty `content`.

| File | Renditions and locations | Limitation |
| --- | --- | --- |
| PDF | Text for each page with text, at `key/page/N`. A page rendition at `key/page/N` for each page with no selectable text. No page images are made; the original PDF stays retained and goes to the tutor. | With no text on any page: "This PDF has no selectable text. The tutor reads its pages as images." With some pages: "Pages 2 and 5 have no selectable text. The tutor reads those pages as images." With one page: "Page 2 has no selectable text. The tutor reads that page as an image." |
| PNG, JPEG, WebP, HEIC, HEIF | One image rendition at `key/image` that refers to the original file. | None. |
| Audio recording | Transcript segments as text, at `key/time/START-END`. | "This transcript was written by the AI tutor from the recording. Words and times may contain mistakes. Play the recording to check." |
| Video | Transcript segments as text, with notes of on-screen text, at `key/time/START-END`. | "This transcript was written by the AI tutor from the video. It includes short notes about text and diagrams on screen, but not the pictures themselves. Words and times may contain mistakes. Play the video to check." |
| Text, Markdown, code | Text in blocks of 100 lines, at `key/lines/A-B`. Files must be UTF-8. | None. |
| WebVTT or SubRip captions | The transcript as paragraphs, in blocks of up to 100 lines, at `key/lines/A-B`, as described under [Caption files](#caption-files). | None. |
| Notebook (`.ipynb`) | The source of each nonblank cell, at `key/cell/N`. | Code is not run, and saved outputs are not read. |
| Word (`.docx`) | All document text, at `key/document`. | Images and charts are not included. |
| PowerPoint (`.pptx`) | The text of each slide, at `key/slide/N`, in the presentation's slide order. | Images and charts are not included. |
| Excel (`.xlsx`, `.xlsm`) | Each sheet's cell values as `A1: value`, at `key/sheet/NAME/rows/1-LAST`. Formulas appear as `=FORMULA = value`. | Images and charts are not included. |

A file's type comes from its bytes, not only its name. The importer saves the media type it detects for PDFs, images, recordings, and videos, and sends that type to Gemini. Text and Office files keep the type the browser declared, as before. A photo named `.heic` whose bytes are JPEG is saved as JPEG. A file with an unknown extension is still read as text when it decodes as UTF-8. A text file that starts like a WebVTT or SubRip caption file is read as captions, whatever its name.

| Accepted names | Detected from | Saved media type |
| --- | --- | --- |
| `.pdf` | `%PDF-` near the start | `application/pdf` |
| `.png`, `.jpg`, `.jpeg`, `.webp` | The PNG, JPEG, or WebP signature | `image/png`, `image/jpeg`, `image/webp` |
| `.heic`, `.heif` | An ISO media `ftyp` brand `heic`, `heix`, `hevc`, `hevx`, `heim`, or `heis` | `image/heic` |
| `.heic`, `.heif` | An ISO media `ftyp` brand `mif1` or `msf1` | `image/heif` |
| `.wav` | RIFF `WAVE`, including 16-bit PCM, A-law, and mu-law audio inside WAV | `audio/wav` |
| `.mp3`, `.mpga` | An ID3 tag or MPEG audio frames | `audio/mp3` |
| `.aif`, `.aiff` | `FORM` with `AIFF` or `AIFC` | `audio/aiff` |
| `.aac` | ADTS frames | `audio/aac` |
| `.ogg`, `.oga`, `.opus` | `OggS` pages with Vorbis or Opus audio | `audio/ogg` |
| `.flac` | `fLaC` | `audio/flac` |
| `.m4a`, and `.mp4`, `.mov`, or `.3gp` with no video track | An ISO media `ftyp` box | `audio/mp4` |
| `.webm` with no video track | EBML with only audio tracks | `audio/webm` |
| `.mp4`, `.m4v` | An ISO media `ftyp` box with a video track | `video/mp4` |
| `.mov` | A QuickTime `ftyp`, `moov`, or `mdat` box with a video track | `video/mov` |
| `.mpeg`, `.mpg` | An MPEG program stream pack header | `video/mpeg` |
| `.avi` | RIFF `AVI ` | `video/avi` |
| `.flv` | `FLV` | `video/x-flv` |
| `.webm` with a video track | EBML with a video track | `video/webm` |
| `.wmv` | An ASF header with a video stream | `video/wmv` |
| `.3gp`, `.3gpp` | A 3GPP `ftyp` brand with a video track | `video/3gpp` |

The importer reads a recording's length from its container header. When the header has none, as in many browser-made WebM and Ogg recordings and in MP3, ADTS, and MPEG streams, it reads the last timestamp or counts the frames. A recording whose type or length cannot be read this way is refused as unreadable.

## Acceptance and limits

Each refusal is a complete sentence that tells the learner what to do instead. Before sending, the browser checks the number of files and their combined size. The upload route repeats those checks and makes every other "Before saving" check before any file is saved. "While reading" checks run in the upload route after the originals are saved, so a refused import keeps its retained files under its import key, as before. "After transcription" checks run in the transcription worker, and their sentence appears in the library. The upload route answers each refusal as `OPERATION_FAILED` with the sentence as its detail, except four that the browser must tell apart: `UPLOAD_BUSY`, `UPLOAD_TIMEOUT`, `IMPORT_REMOVED`, and `IMPORT_REQUEST_CONFLICT`. Each of these also carries its sentence as its detail. In this design, 1 MB is 1,048,576 bytes.

| Rule | Limit | Checked | Refusal sentence |
| --- | --- | --- | --- |
| Files in one upload | At least 1 | Before saving | Choose at least one file to import. |
| Files in one upload | At most 12 | Before saving | Choose up to 12 files for one import. |
| Combined size of one upload | At most 95 MB | Before saving | Choose files with a combined size of 95 MB or less. |
| Uploads handled at once (`UPLOAD_BUSY`) | One handled and one waiting, for at most 20 seconds | Before saving | Another upload is being saved. Try again in a minute. |
| Time for one upload request (`UPLOAD_TIMEOUT`) | At most 85 seconds | Throughout the upload route | Saving this upload took too long. Try again in a minute, or upload fewer files at a time. The app continues from what it already saved. |
| Archives (`.zip`, `.7z`, `.rar`, `.tar`, `.gz`, `.tgz`, `.bz2`, `.xz`) | Refused | Before saving | ZIP and other archive files can't be imported. Unzip them and choose the files inside. |
| Older Office formats (`.doc`, `.dot`, `.ppt`, `.pps`, `.pot`, `.xls`, `.xlt`) | Refused | Before saving | This older Office format can't be imported. Save the file as .docx, .pptx, or .xlsx, or export it to PDF. |
| Other image formats (`.gif`, `.bmp`, `.tif`, `.tiff`, `.avif`) | Refused | Before saving | This image format can't be imported. Upload a PNG, JPEG, WebP, HEIC, or HEIF image. |
| Other audio formats (`.wma`, `.amr`, `.caf`, and raw `.pcm` or `.raw` audio without a header) | Refused | Before saving | This audio format can't be imported. Save the recording as MP3 or M4A and import it again. |
| Other video formats (`.mkv`, `.ogv`, and a `.ts` file that is not UTF-8 text; a UTF-8 `.ts` file is read as TypeScript source) | Refused | Before saving | This video format can't be imported. Save the video as MP4 and import it again. |
| Any other type that is not UTF-8 text | Refused | Before saving | This file type can't be imported. Upload a PDF, image, audio recording, video, text, notebook, Word, PowerPoint, or Excel file. |
| An image whose bytes are not a supported image | Refused | Before saving | This image can't be read. Upload a PNG, JPEG, WebP, HEIC, or HEIF image. |
| A recording or video whose type or length can't be read | Refused | Before saving | This recording can't be read. Check that it plays, then save it as MP3, M4A, or MP4 and import it again. |
| Length of one recording or video | At most 2 hours | Before saving | Recordings and videos can be at most 2 hours long. Split the recording and import each part. |
| A recording or video when the server has no Gemini key | Refused | Before saving | Recordings and videos need the AI tutor, which isn't set up on this server. Ask the app owner to add a Gemini API key. |
| A request ID whose import was removed (`IMPORT_REMOVED`) | Refused | Before saving | This import was removed. Choose the files again. |
| A request ID reused with different files or a different title (`IMPORT_REQUEST_CONFLICT`) | Refused | Before saving | This upload doesn't match the import started with these details. Choose the files again to start a new import. |
| Pages in one PDF | At most 50 | While reading | A source can contain at most 50 pages. Import a smaller unit. |
| Slides in one presentation | At most 50 | While reading | This presentation has too many slides. Import a smaller unit. |
| Size of one sheet | At most 20,000 rows and 200 columns | While reading | This sheet is too large for one import. Select a smaller range. |
| Unpacked size of one Office file | At most 50 MB | While reading | This file is too large to read once it is unpacked. Import a smaller unit. |
| A locked PDF | Refused | While reading | This PDF needs a password. Upload an unlocked copy. |
| A damaged PDF, Word, PowerPoint, or Excel file | Refused | While reading | This PDF (or Word file, PowerPoint file, Excel file) can't be read. Check that it opens, or export it to PDF. |
| A damaged notebook | Refused | While reading | This notebook can't be read. Check that it is a valid Jupyter notebook file. |
| Time to read one upload | At most 45 seconds | While reading | Reading these files took too long. Import a smaller unit. |
| Text in one import | At most 500,000 characters | While reading, and again after transcription | This material contains too much text. Import a smaller unit. In the library, after transcription: This material contains too much text. Remove this import and import a smaller unit. |
| Readable content | At least one text, image, or page rendition, or one recording or video | While reading | No readable content was found in these files. Check that they aren't empty, or export documents that contain pictures to PDF and import the PDF. |
| One transcription call | At most 10 minutes | After transcription | Transcribing took too long. Try again, or split the recording into shorter parts. |
| One transcript | The model's largest output | After transcription | The transcript was too long to finish. Remove this import, split the recording into shorter parts, and import each part. |

Three limits never refuse an import. They decide how a file reaches the tutor:

| Rule | Limit | Checked | Effect when exceeded |
| --- | --- | --- | --- |
| One inline file | At most 15 MB | Each tutor request and each transcription | The file goes by Files API reference. |
| Inline files in one tutor request | At most 30 MB in total | Each tutor request | Later files go by Files API reference. |
| Images in one tutor request | At most 40 | Each tutor request | Later images are left out with a note to the tutor. |

When a Files API upload fails, the request fails with the sentence given in the [materials composition](compositions/Materials.md).

Some limits are the app's own and lower than what Gemini accepts. A PDF or presentation may have at most 50 pages, and a tutor request carries at most 40 images, although Gemini reads up to 1,000 pages and 3,600 images in one request. The lower limits keep each request's cost down and let the tutor answer within the 80-second limit of an interactive request. A recording may be at most 2 hours long so that its whole transcript fits in one answer from the model. Raw audio without a header, such as headerless L16, A-law, or mu-law audio, is refused although Gemini reads it, because without a header the importer cannot check its length; the same audio inside a WAV file is accepted. PDFs need no size limit of their own, because a PDF over the inline limit goes by Files API reference, and the Files API accepts PDFs larger than 50 MB, up to 2 GB per file. The [materials composition](compositions/Materials.md) names the live call that must confirm this before implementation relies on it.

## Recordings and transcripts

Gemini transcribes each recording and video once, after the upload is saved and outside the upload request. The [materials composition](compositions/Materials.md) describes the step, its retries, and its recovery after a restart. The transcript then serves as the recording's text, the way page text serves a PDF:

- Each segment becomes one text rendition at `key/time/START-END`, in time order.
- Segments are ordered by their start. A start earlier than the previous segment's end moves to that end. A segment left with no time of its own is joined to the previous segment. A time past the recording's length is set to that length. Blank segments are dropped.
- The text is what was said, in the spoken language, with spoken math written in symbols. A video's segments also contain short notes of on-screen text, equations, and diagrams, written as `[On screen: …]`.
- The original carries the transcript limitation for its kind, from the importer table.
- The material's `content` joins these renditions like any other text. Citations, skill suggestions, lessons, practice, and graded-work extraction all read the transcript.

The original recording stays retained, downloadable, and playable. The tutor does not receive the recording again after import.

## Caption files

A WebVTT or SubRip caption file is a transcript with times, saved as text. The importer recognizes one by how it starts, not by its name. A WebVTT file's first line is `WEBVTT`, alone or followed by a space or tab. A SubRip file starts with a cue: a cue number, then a timing line such as `00:00:01,000 --> 00:00:03,500`; a file that starts with the timing line itself counts too. So a `.txt` file that starts with `WEBVTT` is read as captions, and a `.vtt` or `.srt` file that starts any other way is read as plain text.

The readable text keeps what was said and leaves out the rest:

- The header, `NOTE`, `STYLE`, and `REGION` blocks, cue identifiers and numbers, timing lines, and cue settings are left out.
- Tags inside a cue, such as `<c>`, `<i>`, `<b>`, `<u>`, and SubRip's `<font>`, and times inside a cue are removed. Character references such as `&amp;` become the characters they stand for.
- A voice tag such as `<v Professor Jackson>` puts `Professor Jackson: ` at the start of each of that speaker's paragraphs. A cue without a voice tag continues the current speaker.
- The lines of one cue are joined with spaces, and cues are joined into paragraphs in file order. A new paragraph starts when the speaker changes, or when a cue ends a sentence and the next cue starts more than 2 seconds after it ends. A cue ends a sentence when its text ends with `.`, `!`, `?`, or `…`, before any closing quote or bracket. Runs of spaces and line breaks become one space.
- Text after a blank line inside a cue stays with that cue. A cue number right before a timing line is left out even when no blank line comes before it.
- Paragraphs are separated by a blank line. The text is split into blocks of 100 lines like other text, except that a block ends with its last paragraph rather than the blank line after it, so its location may end one line early, as in `key/lines/1-99`.

The original caption file stays retained and downloadable, with its times. A caption file with no cue text has no readable text. Caption files imported before this rule keep the text they were saved with.

For example, a WebVTT file with a cue from `00:00:00.000` to `00:00:02.500` reading `<v Professor Jackson>Welcome back.`, and a cue from `00:00:05.000` reading `<v Student>Can a concept have two purposes?`, becomes two paragraphs: "Professor Jackson: Welcome back." and "Student: Can a concept have two purposes?".

## Examples

- A three-page scanned PDF whose key is `9c1f0e2ab34d5e6f` has page renditions at `9c1f0e2ab34d5e6f/page/1`, `9c1f0e2ab34d5e6f/page/2`, and `9c1f0e2ab34d5e6f/page/3`, no text renditions, and the limitation "This PDF has no selectable text. The tutor reads its pages as images." When it is the material's only file, the material's `content` is empty. A citation of `9c1f0e2ab34d5e6f/page/2` opens page 2 of the original.
- A PDF whose key is `2d7b9e01c4a6f853` has text on page 1 and none on page 2. It has a text rendition at `2d7b9e01c4a6f853/page/1`, a page rendition at `2d7b9e01c4a6f853/page/2`, and the limitation "Page 2 has no selectable text. The tutor reads that page as an image."
- A HEIC photo whose key is `d04e7a5c19b2f368` has one image rendition at `d04e7a5c19b2f368/image` with `mediaType: image/heic`, which refers to the original file.
- A 50-second voice note whose key is `4be0c1d29a7f3e65` might have two text renditions: `4be0c1d29a7f3e65/time/00:00-00:21` with "Today we find the eigenvalues of a 2 × 2 matrix." and `4be0c1d29a7f3e65/time/00:21-00:50` with "First solve det(A − λI) = 0." Its content is `[4be0c1d29a7f3e65/time/00:00-00:21]`, a line break, the first text, a blank line, `[4be0c1d29a7f3e65/time/00:21-00:50]`, a line break, and the second text. A citation of `4be0c1d29a7f3e65/time/00:21-00:50` starts the player at 0:21.
- A 75-minute lecture video whose key is `a3c58e7f20d1b694` has segments such as `a3c58e7f20d1b694/time/59:48-1:00:21`, which crosses the hour, and `a3c58e7f20d1b694/time/1:02:05-1:02:40`. A segment may read "The determinant is zero here. [On screen: det [[2, 4], [1, 2]] = 0]".

## Retained file storage

Uploads are limited to 12 files and 95 MB in total. The server accepts an upload body of at most 96 MB: the files plus 1 MB for the other form fields. The real form fields and multipart framing add only a few kilobytes, so the largest accepted upload sends about 99.6 million bytes, which stays under a 100 MB edge limit whether the edge counts 1,000,000 or 1,048,576 bytes to the megabyte. In production, no bytes pass through the local disk. The upload route hashes each file while streaming it and streams the bytes to the file store, without a second full copy. Retained files live in a file store under `SHA-256(owner)/importKey/SHA-256(bytes).ext`. When `S3_BUCKET`, `S3_ACCESS_KEY_ID`, and `S3_SECRET_ACCESS_KEY` are set, the store is S3-compatible object storage; `S3_ENDPOINT`, `S3_REGION`, and `S3_SESSION_TOKEN` are optional. Partial S3 settings stop startup. Without them, development uses `.data/files`. In the upload route, each store call gets at most 30 seconds and never runs past the route's 85-second budget. During a tutor request, store calls keep their 30-second limit inside the request's own limit. Outside requests, the transcription worker's store calls get 30 seconds, or 120 seconds for a file larger than 25 MB. Storage errors reach the learner as one plain message.

A download or view first checks the learner's access to the material and the exact file reference. It then streams the bytes from the store, without loading the whole file. Removing an unfinished import deletes every file that its declared sources can have under its import key, whether or not the upload had finished saving them. When that deletion fails, the transcription worker finishes it on a later turn.

## Readability and ownership

A material needs nonblank `content` or at least one valid readable rendition. Text, image, and page renditions are readable; a page rendition is readable because the tutor reads that page from the retained PDF. A filename, file reference, MIME type, or `readable: true` flag by itself is insufficient. Valid metadata with no renditions can accompany readable content or another readable original; its reported limitations remain available.

MaterialKeeping validates this representation and saves it. The host must first verify that referenced files exist, are retained, belong to the learner, and can be used as stated. The concept does not open files or run extraction, rendering, transcription, or AI calls. Structural validation is not proof that a scan was read correctly or that a transcript is accurate.

Learner, scope, material, and file references are nonblank strings. Values are preserved exactly, without trimming or case folding. `origin` is `COURSE` or `REFERENCE`. Invalid material fields cause `INVALID_TUTORING_MATERIAL` before any storage work. Malformed query identifiers cause a `TypeError`; a well-formed but unknown identifier returns no rows.

## Import keys and retries

`add` also requires a nonblank `importKey`. The host supplies it for one saved import. A missing, malformed, or blank key causes `INVALID_MATERIAL_IMPORT_KEY` before storage work. Material-field validation comes first. The key grants no access; the host must still verify the session, course, and files.

The pair `(owner, importKey)` identifies one material. A matching retry returns that material's ID without changing it. A retry with different scope, title, locator, content, originals, or origin causes `MATERIAL_IMPORT_CONFLICT`. Strings compare exactly. List order matters, including original files, renditions, and limitations. Record field order does not matter. Comparison uses the complete saved values, not a content hash.

An intentional new import uses a new key, even when its content matches an earlier import. Another learner can use the same key without recovering the first learner's record. Keys do not expire and are not returned by `_materials` or `_material`.

The host must save the key and prepared input before calling the action. Retrying with regenerated file references or changed extraction output is a conflict. The [import operation store](material-import-store.md) saves the original request, retained sources, exact prepared input, and completed material identity at separate checkpoints.

## Storage behavior

`add` snapshots validated input before its first database wait. It looks for the learner's import key, then creates a material only if the key is unused. One document write saves the material, key, and ID together. A unique index on `(owner, importKey)` settles concurrent creates. A client that loses the insert race reads the winning record and applies the same match or conflict rule. Other database failures remain errors. If a reply is lost after a save, a later call can recover the material with the same key and input.

Reads use the primary with majority read concern. Writes use majority, journaled acknowledgement. The key index covers only records with string keys. Older materials without keys remain readable and are not claimed by matching content. There is no material-update action.

`_materials` filters by both owner and scope, orders by material ID, and returns only ID, title, locator, and origin. `_material` returns the full material for one ID, or no row. `_sourceSet` returns the owner's materials in one scope with their content and originals, which the application uses to build tutor requests. All three queries are read-only. `_material` is an internal lookup; an application ownership check is required before its result reaches a browser.

MaterialKeeping and GroundedTutoring are each registered with their full specifications. The [checked P2 stage](stages/materials.md) connects material import, ownership checks, AI proposals, and skill confirmation. File and provider operations remain host responsibilities.
