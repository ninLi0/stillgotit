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

A text rendition has `kind: TEXT`, a nonblank `location`, and nonblank `text`. An image rendition has `kind: IMAGE`, a nonblank `location`, a retained `file` reference, and `mediaType` set to `image/png`, `image/jpeg`, or `image/webp`. The original may have a different format; the importer prepares a readable rendition. The current importer produces this representation; extraction tests verify representative files.

Locations are stable source labels, such as `lesson/page/2` or `lecture/time/00:30-00:45`. The importer assigns them consistently within a material. These methods preserve the supplied locations; tutoring citation checks use them. Multiple renditions can show the same source location, such as text and an image of one page.

`MediaList` preserves original-file order and each file's rendition and limitation order. Unknown fields and malformed records are rejected. The stored values contain only the declared fields. Uploads of lecture audio can be retained originals. Temporary microphone recordings are not retained file references.

## Readability and ownership

A material needs nonblank `content` or at least one valid readable rendition. A filename, file reference, MIME type, or `readable: true` flag by itself is insufficient. Valid metadata with no renditions can accompany readable content or another readable original; its reported limitations remain available.

GroundedTutoring validates this representation and saves it. The host must first verify that referenced files exist, are retained, belong to the learner, and can be used as stated. The concept does not open files or run extraction, rendering, transcription, or AI calls. Structural validation is not proof that a scan was read correctly.

Learner, scope, material, and file references are nonblank strings. Values are preserved exactly, without trimming or case folding. `origin` is `COURSE` or `REFERENCE`. Invalid material fields cause `INVALID_TUTORING_MATERIAL` before any storage work. Malformed query identifiers cause a `TypeError`; a well-formed but unknown identifier returns no rows.

## Import keys and retries

`addMaterial` also requires a nonblank `importKey`. The host supplies it for one saved import. A missing, malformed, or blank key causes `INVALID_MATERIAL_IMPORT_KEY` before storage work. Material-field validation comes first. The key grants no access; the host must still verify the session, course, and files.

The pair `(owner, importKey)` identifies one material. A matching retry returns that material's ID without changing it. A retry with different scope, title, locator, content, originals, or origin causes `MATERIAL_IMPORT_CONFLICT`. Strings compare exactly. List order matters, including original files, renditions, and limitations. Record field order does not matter. Comparison uses the complete saved values, not a content hash.

An intentional new import uses a new key, even when its content matches an earlier import. Another learner can use the same key without recovering the first learner's record. Keys do not expire and are not returned by `_materials` or `_material`.

The host must save the key and prepared input before calling the action. Retrying with regenerated file references or changed extraction output is a conflict. The [import operation store](material-import-store.md) saves the original request, retained sources, exact prepared input, and completed material identity at separate checkpoints.

## Storage behavior

`addMaterial` snapshots validated input before its first database wait. It looks for the learner's import key, then creates a material only if the key is unused. One document write saves the material, key, and ID together. A unique index on `(owner, importKey)` settles concurrent creates. A client that loses the insert race reads the winning record and applies the same match or conflict rule. Other database failures remain errors. If a reply is lost after a save, a later call can recover the material with the same key and input.

Reads use the primary with majority read concern. Writes use majority, journaled acknowledgement. The key index covers only records with string keys. Older materials without keys remain readable and are not claimed by matching content. There is no material-update action.

`_materials` filters by both owner and scope, orders by material ID, and returns only ID, title, locator, and origin. `_material` returns the full material for one ID, or no row. Both queries are read-only. `_material` is an internal lookup; an application ownership check is required before its result reaches a browser.

GroundedTutoring is registered with its full specification, including lessons and practice. The [checked P2 stage](stages/materials.md) connects material import, ownership checks, AI proposals, and skill confirmation. File and provider operations remain host responsibilities.
