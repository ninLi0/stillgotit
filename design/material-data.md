# Material data

This document defines the concrete values used by GroundedTutoring's material methods. The importer prepares these values before calling `addMaterial`.

## Retained files

Each `MediaValue` has these fields:

| Field | Meaning |
| --- | --- |
| `file` | A nonblank, stable reference assigned by the host to a retained original file. |
| `name` | The original file's nonblank display name. |
| `mediaType` | Its MIME type, such as `application/pdf` or `audio/mpeg`. |
| `renditions` | An ordered list of readable text or images derived from the original. It may be empty when extraction produced nothing usable. |
| `limitations` | An ordered list of nonblank descriptions of extraction gaps. An empty list means the producer reported no gaps. |

A text rendition has `kind: TEXT`, a nonblank `location`, and nonblank `text`. An image rendition has `kind: IMAGE`, a nonblank `location`, a retained `file` reference, and `mediaType` set to `image/png`, `image/jpeg`, or `image/webp`. The original may have a different format; the importer prepares a readable rendition. This representation does not claim that any file importer is implemented.

Locations are stable source labels, such as `lesson/page/2` or `lecture/time/00:30-00:45`. The importer assigns them consistently within a material. These methods preserve the supplied locations; the later citation checks will use them. Multiple renditions can show the same source location, such as text and an image of one page.

`MediaList` preserves original-file order and each file's rendition and limitation order. Unknown fields and malformed records are rejected. The stored values contain only the declared fields. Uploads of lecture audio can be retained originals. Temporary microphone recordings are not retained file references.

## Readability and ownership

A material needs nonblank `content` or at least one valid readable rendition. A filename, file reference, MIME type, or `readable: true` flag by itself is insufficient. Valid metadata with no renditions can accompany readable content or another readable original; its reported limitations remain available.

GroundedTutoring validates this representation and saves it. The host must first verify that referenced files exist, are retained, belong to the learner, and can be used as stated. The concept does not open files or run extraction, rendering, transcription, or AI calls. Structural validation is not proof that a scan was read correctly.

Learner, scope, material, and file references are nonblank strings. Values are preserved exactly, without trimming or case folding. `origin` is `COURSE` or `REFERENCE`. Invalid action inputs cause `INVALID_TUTORING_MATERIAL` before any storage work. Malformed query identifiers cause a `TypeError`; a well-formed but unknown identifier returns no rows.

## This implementation step

`addMaterial` snapshots validated input before its first database wait. One insert saves the complete material and returns a new ID. There is no material-update action. Repeated calls create separate records, even if their content matches; safe import retries require the operation tracking described in [runtime responsibilities](runtime.md#provider-and-file-operations).

`_materials` filters by both owner and scope, orders by material ID, and returns only ID, title, locator, and origin. `_material` returns the full material for one ID, or no row. Both queries are read-only. `_material` is an internal lookup; an application ownership check is required before its result reaches a browser.

Only these three methods are implemented in this step. GroundedTutoring remains outside the running application assembly while its other methods are pending. No upload endpoint, AI skill proposal, ownership reaction, or file processor is added by this step.
