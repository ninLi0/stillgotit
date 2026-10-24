# Material import operation store

The host uses `MaterialImportStore` to preserve one import across requests and application restarts. This service owns its operations collection. It does not create materials, call concepts, process files, call Gemini, or authenticate a browser. The host obtains the owner from Sessioning and checks course ownership before using it. Store writes happen outside reaction `where` conditions.

## Request and saved record

`getOrCreate` accepts `owner`, `requestId`, and `request`. The browser keeps the same request ID for retries of one intended import. A new intended import uses a new request ID. The server generates the separate `importKey` used later by GroundedTutoring. Neither identifier grants access.

The request has `scope` (the course ID), `title`, `origin` (`COURSE` or `REFERENCE`), and a nonempty ordered `sources` list. An upload descriptor has `kind: UPLOAD`, `name`, `size` in bytes, and a lowercase SHA-256 digest in `sha256`. A reference descriptor has `kind: REFERENCE` and `locator`. These are declared sources, not proof that bytes were uploaded, checked, or processed. Later import steps must verify the uploaded content against its declared digest and retain reference content as a fixed snapshot.

Inputs must contain exactly their declared fields. Identities, titles, names, and locators must be nonblank strings. Sizes must be nonnegative safe integers. Digests must contain 64 lowercase hexadecimal characters. Lists must not have missing elements. Strings are preserved exactly; list order matters and record field order does not.

The saved operation contains:

| Field | Meaning |
| --- | --- |
| `owner`, `requestId` | The pair that selects one operation. |
| `kind` | `MATERIAL_IMPORT`. |
| `importKey` | The server-generated key for the later material action. |
| `request` | A fixed copy of the validated original request. |
| `createdAt` | The server time when the operation was created. Operations saved before this field existed lack it. |
| `stage` | `CREATED`, `SOURCES_SAVED`, `TRANSCRIBING`, `READY`, `COMPLETE`, or `DISCARDED`. |
| `revision` | `0` at creation. Each saved change after creation increases it, except a worker's claim. |
| `sources` | From SOURCES_SAVED on: the retained originals, with no renditions. |
| `partial` | From TRANSCRIBING on: the originals as read at upload. Each recording's renditions and limitations are still empty. |
| `recordings` | From TRANSCRIBING on: one entry for each distinct audio or video file, in original order. Two originals with the same bytes and the same file extension share one retained file and so one entry, and the finished transcript serves both. |
| `failure` | Optional, only in TRANSCRIBING: a failure of the final preparation. |
| `prepared` | From READY on: the exact `addMaterial` input. |
| `material` | In COMPLETE: the saved material identity. |
| `filesDeleted` | Only in DISCARDED: `false` when the import is removed, and `true` once every file its declared sources can have under its import key has been deleted. |

A recording entry contains:

| Field | Meaning |
| --- | --- |
| `file` | The retained reference of one audio or video original. |
| `status` | `WAITING`, `DONE`, or `FAILED`. |
| `attempts` | Automatic attempts made since the import started or the learner last retried it. |
| `retryAt` | Optional. The earliest time a waiting recording may be claimed. |
| `claim` | Optional. A worker's `token` and the `until` time when the claim ends. |
| `segments` | Only when DONE: the ordered transcript segments, each with whole-second `start` and `end` and nonblank `text`. |
| `failure` | Only when FAILED: a failure. |

A failure has a `reason` code, the learner's `sentence`, and a `retryable` flag that says whether the learner may retry. The [materials composition](compositions/Materials.md) lists each reason and sentence.

The library derives one state from each listed operation:

| Saved progress | Library state |
| --- | --- |
| TRANSCRIBING with a failure that cannot be retried | `FAILED`. The learner cannot retry it. |
| TRANSCRIBING with a failed recording and no recording waiting | `FAILED`. The learner may retry it when every failure is retryable. |
| Any other TRANSCRIBING, including one whose recordings are all DONE and that the worker has not yet finished | `TRANSCRIBING` |
| READY whose save AddMaterial refused as invalid during that listing | `FAILED`. The learner may remove it but not retry it. |
| Any other READY | `SAVING` |

The listing learns about an invalid-input refusal from its own save attempt; the store does not record it. Operations in other stages are not listed.

## Rules

```text
when getOrCreate is called
where any input is malformed
then refuse INVALID_IMPORT_REQUEST before storage work

when getOrCreate is called with valid input
where owner and requestId already select an operation with the same request
then return the saved operation without changing its key, request, or progress,
     including an operation that is DISCARDED

when getOrCreate is called with valid input
where owner and requestId already select an operation with a different request
then refuse IMPORT_REQUEST_CONFLICT and preserve the saved operation

when getOrCreate is called with valid input
where owner and requestId select no operation
then save the owner, request ID, generated import key, request, server time,
     CREATED stage, and revision 0 together; return the saved operation

when get is called
where owner or requestId is malformed
then refuse INVALID_IMPORT_REQUEST before reading storage

when get is called with valid input
where both owner and requestId match a saved operation
then return that operation without changing it

when get is called with valid input
where no operation matches both owner and requestId
then return null without creating an operation or collection

when pending is called
where owner or course is malformed
then refuse INVALID_IMPORT_REQUEST before reading storage

when pending is called with valid input
then return the owner's TRANSCRIBING and READY operations whose request scope
     is course, ordered by createdAt and then requestId, without changing them;
     return an empty list when there are none

when startTranscription is called with owner, requestId, revision, partial, and recordings
where the operation is SOURCES_SAVED at revision, partial lists the saved sources'
      files in the same order, and recordings names one or more of those files, each once,
      each with no renditions in partial
then save partial and one WAITING entry with 0 attempts for each recording,
     set TRANSCRIBING, and increase the revision

when claim is called with now, a new token, an until time, and an optional previous owner
where some TRANSCRIBING operation with no failure that cannot be retried has a WAITING
      recording whose retryAt is absent or not after now, and whose claim is absent or
      ended before now
then pick the first owner with such a recording after the previous owner in owner order,
     wrapping around, or the first such owner when no previous owner is given; set the
     claim of the first such recording in that owner's oldest such operation to the token
     and until time, without changing the revision; return the owner, requestId, and file

when claim is called
where no recording qualifies
then return null without changing anything

when renew is called with owner, requestId, file, token, and a new until time
where the operation is TRANSCRIBING and that recording is WAITING with this token
then set the claim's until time and return true

when renew is called
where the operation or the recording no longer matches
then return false without changing anything

when saveTranscript is called with owner, requestId, file, token, and segments
where segments are malformed
then refuse INVALID_IMPORT_REQUEST before storage work

when saveTranscript is called with valid input
where the operation is TRANSCRIBING and that recording is WAITING with this token
then set the recording DONE with the segments, remove its claim and retryAt,
     and increase the revision

when saveTranscript is called with valid input
where that recording is already DONE with the same segments
then return the operation unchanged

when saveTranscript is called with valid input
where the operation is not TRANSCRIBING, or the recording is held by another token or by none
then refuse IMPORT_PROGRESS_CONFLICT and change nothing

when failTranscript is called with owner, requestId, file, token, failure, and an optional retryAt
where the operation is TRANSCRIBING and that recording is WAITING with this token
then with retryAt, keep the recording WAITING, add 1 to its attempts, save retryAt,
     and remove its claim; without retryAt, set it FAILED with the failure and
     remove its claim; in both cases increase the revision

when failTranscript is called
where the operation is not TRANSCRIBING, or the recording is held by another token or by none
then refuse IMPORT_PROGRESS_CONFLICT and change nothing

when preparable is called
then return the TRANSCRIBING operations whose recordings are all DONE and that have no
     operation failure, ordered by createdAt and then requestId, without changing them

when failPreparation is called with owner, requestId, revision, and failure
where the operation is TRANSCRIBING at revision and every recording is DONE
then save the failure as the operation failure and increase the revision

when retry is called with owner and requestId
where the operation is TRANSCRIBING with any failure that is not retryable,
      whether or not another recording is still WAITING
then refuse IMPORT_NOT_RETRYABLE and change nothing

when retry is called with owner and requestId
where the operation is TRANSCRIBING and has failures that are all retryable
then set every FAILED recording WAITING with 0 attempts and no retryAt, remove
     any operation failure, increase the revision, and return the operation

when retry is called with owner and requestId
where the operation has no failure, or is in another stage
then return it unchanged; return null when no operation matches

when savePrepared is called
where the operation is SOURCES_SAVED with no recordings, or TRANSCRIBING with every
      recording DONE and no failure, at the given revision, and prepared matches the
      saved owner, key, course, title, and origin
then save prepared, set READY, and increase the revision

when complete is called
where the operation is READY at the given revision
then save the material identity, set COMPLETE, and increase the revision

when discard is called with owner and requestId
where the operation is CREATED, SOURCES_SAVED, or TRANSCRIBING
then set DISCARDED with filesDeleted false, remove every claim, increase the
     revision, and return it

when discard is called with owner, requestId, and the host's report that AddMaterial
     refused the operation's prepared input as invalid
where the operation is READY
then set DISCARDED with filesDeleted false, increase the revision, and return it

when discard is called with owner and requestId and no such report
where the operation is READY
then refuse IMPORT_ALREADY_SAVED and change nothing

when discard is called with owner and requestId
where the operation is COMPLETE
then refuse IMPORT_ALREADY_SAVED and change nothing

when discard is called with owner and requestId
where the operation is DISCARDED
then return it unchanged; return null when no operation matches

when deletable is called
then return the DISCARDED operations whose filesDeleted is false, ordered by
     createdAt and then requestId, without changing them

when markFilesDeleted is called with owner and requestId
where the operation is DISCARDED
then set filesDeleted to true and return the operation; a repeat returns it unchanged

when markFilesDeleted is called with owner and requestId
where the operation is in another stage
then refuse IMPORT_PROGRESS_CONFLICT and change nothing
```

These describe ordinary host methods, not registered concept actions or executable reactions. An invalid saved record is a storage error; the helper does not replace it or allocate a new key. Unexpected database errors remain errors. The host returns a safe error and allows a matching retry.

## Persistence and retries

Snapshot validated input before the first database wait. Unique indexes protect `(owner, requestId)` and `(owner, importKey)`. More indexes serve the worker's searches for waiting recordings, imports ready to finish, and removed imports with files left, and the library's search by learner and course. One document write saves the entire operation. After a duplicate insert, read the winning owner/request pair and apply the same match or conflict rule. An unrelated uniqueness failure remains a database error.

Use primary reads with majority read concern and majority, journaled writes. Return no candidate key after a failed or uncertain write. A retry reads any completed write. The records have no automatic expiry. `get`, `pending`, `preparable`, and `deletable` create no indexes and change no state. No method returns MongoDB's internal `_id`.

The stages advance in this order. `saveSources` advances CREATED to SOURCES_SAVED with retained-file references. An import without recordings then goes from SOURCES_SAVED to READY through `savePrepared`. An import with recordings goes from SOURCES_SAVED to TRANSCRIBING through `startTranscription`, and from TRANSCRIBING to READY through `savePrepared` once every recording is DONE. `complete` advances READY to COMPLETE with the saved material identity. `discard` ends an import before READY, or ends a READY import whose prepared input AddMaterial refused as invalid. `markFilesDeleted` records that a removed import's files are gone. `savePrepared` requires the owner, key, course, title, and origin to match the saved request.

Each transition requires the expected stage and revision, and an atomic update advances both. Transcript saves and failures instead require the recording's claim token, and one atomic update checks the stage and the claim together. A claim and its renewal are atomic updates of one recording that leave the revision unchanged. `markFilesDeleted` is an atomic update that requires DISCARDED. An exact replay of a saved checkpoint returns current progress. Changed preparation, a different material result, a lost claim, or a competing stale transition causes `IMPORT_PROGRESS_CONFLICT`. A caller can reread and retry after another matching request finishes. A lost reply never requires a new import key.

The HTTP host checks ownership, hashes the actual uploaded bytes, retains originals, and reads documents. For an import without recordings, it saves READY, calls GroundedTutoring, and records the returned material identity. For an import with recordings, it saves TRANSCRIBING, and the transcription worker saves each transcript. On each turn, the worker also saves READY for every operation that `preparable` returns, and finishes deleting files for every operation that `deletable` returns, so neither step depends on the process that started the import or removed it. The next learner request that lists imports, or a repeated upload, calls GroundedTutoring and records COMPLETE. A failure between the material save and COMPLETE is recovered by retrying `addMaterial` with the same frozen input and key. GroundedTutoring owns that material and its retry mapping. The [materials composition](compositions/Materials.md) describes these flows.

The store never verifies a file by itself. It receives host-prepared references and values. Tests cover concurrent starts and checkpoints, conflicts, owner isolation, frozen input, lost replies, and recovery in a new process. They also cover:
- claims by two workers, and claims that alternate between owners;
- a claim that ends while its worker is stopped, and a renewal after the claim was lost;
- transcript replays, and automatic and learner retries;
- a retry refused while another recording waits;
- an operation ready to finish after a stop, and a removed operation with files left after a stop;
- discarding during a claim, and discarding a READY operation only with the host's invalid-input report;
- the pending list's owner, course, and order.

File-processing and HTTP tests check the surrounding flow.
