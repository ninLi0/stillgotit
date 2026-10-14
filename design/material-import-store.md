# Material import operation store

The host uses `MaterialImportStore` to preserve one import across requests and application restarts. This service owns its operations collection. It does not create materials, call concepts, process files, or authenticate a browser. The host obtains the owner from Sessioning and checks course ownership before using it. Store writes happen outside reaction `where` conditions.

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
| `stage` | `CREATED`, `SOURCES_SAVED`, `READY`, or `COMPLETE`. |
| `revision` | `0` at creation. Each saved transition increases it. |

## Rules

```text
when getOrCreate is called
where any input is malformed
then refuse INVALID_IMPORT_REQUEST before storage work

when getOrCreate is called with valid input
where owner and requestId already select an operation with the same request
then return the saved operation without changing its key, request, or progress

when getOrCreate is called with valid input
where owner and requestId already select an operation with a different request
then refuse IMPORT_REQUEST_CONFLICT and preserve the saved operation

when getOrCreate is called with valid input
where owner and requestId select no operation
then save the owner, request ID, generated import key, request, CREATED stage,
     and revision 0 together; return the saved operation

when get is called
where owner or requestId is malformed
then refuse INVALID_IMPORT_REQUEST before reading storage

when get is called with valid input
where both owner and requestId match a saved operation
then return that operation without changing it

when get is called with valid input
where no operation matches both owner and requestId
then return null without creating an operation or collection
```

These describe ordinary host methods, not registered concept actions or executable reactions. An invalid saved record is a storage error; the helper does not replace it or allocate a new key. Unexpected database errors remain errors. The host returns a safe error and allows a matching retry.

## Persistence and retries

Snapshot validated input before the first database wait. Unique indexes protect `(owner, requestId)` and `(owner, importKey)`. One document write saves the entire operation. After a duplicate insert, read the winning owner/request pair and apply the same match or conflict rule. An unrelated uniqueness failure remains a database error.

Use primary reads with majority read concern and majority, journaled writes. Return no candidate key after a failed or uncertain write. A retry reads any completed write. The records have no automatic expiry. `get` creates no indexes and changes no state. Neither method returns MongoDB's internal `_id`.

`saveSources` advances CREATED to SOURCES_SAVED with retained-file references. `savePrepared` advances SOURCES_SAVED to READY with the exact `addMaterial` input. Its owner, key, course, title, and origin must match the saved request. `complete` advances READY to COMPLETE with the saved material identity.

Each transition requires the expected stage and revision. An atomic update advances both. An exact replay of a saved checkpoint returns current progress. Changed preparation, a different material result, or a competing stale transition causes `IMPORT_PROGRESS_CONFLICT`. A caller can reread and retry after another matching request finishes. A lost reply never requires a new import key.

The HTTP host checks ownership, hashes the actual uploaded bytes, retains originals, prepares readable content, saves its checkpoint, and calls GroundedTutoring. It then records the returned material identity. A failure between the material save and COMPLETE is recovered by retrying `addMaterial` with the same frozen input and key. GroundedTutoring owns that material and its retry mapping.

The store never verifies a file by itself. It receives host-prepared references and values. Tests cover concurrent starts and checkpoints, conflicts, owner isolation, frozen input, lost replies, and recovery in a new process. File-processing and HTTP tests check the surrounding flow.
