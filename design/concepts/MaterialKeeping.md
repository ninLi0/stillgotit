# MaterialKeeping

## Purpose

Keep a person's materials, both the sources they learn from and their own work kept as evidence, so they can be read and cited later, so that bringing the same material in again returns the saved copy instead of a duplicate, so that a person's own work is never mistaken for a source, and so that a person can delete a material for good while the places that cited it can still say what happened to it.

## Principle

Sam adds his week 3 notes to his linear algebra course. He gives a title, the place the notes came from, their readable text, and the retained slide file, and the application supplies an import key for this import and says that the notes are a source. The notes appear in Sam's list for that course, and reading them back returns the same text, slides, and extraction limits. The reply to Sam's request was lost, so the application adds the notes again with the same key, and MaterialKeeping returns the saved material instead of making a copy. A later request under that key with a different title is refused, because changed input needs a new key. Leo's list for the same course does not include Sam's notes, and Leo's request under Sam's key saves a material of Leo's own rather than recovering Sam's. Later Sam photographs his answer to a practice problem, and the application adds the photo as his work. It appears in his list marked as work and reads back like the notes, but Sam's sources still contain only the notes, so the photo is never taught from. At the end of the term Sam deletes the notes. They leave his list and can no longer be read, and their text and file references are no longer stored. What remains is the fact that Sam's material with that identity, in that course, was deleted, so a page that cited it can say so instead of showing nothing. A late retry of the original import under its old key is refused rather than bringing the notes back; importing the files again gives them a new key and a new material.

## Types

```types
external Owner
  The identity that owns a material.
external Scope
  The context to which a material belongs, such as a course.
MaterialOrigin is COURSE or REFERENCE
  Material brought from the owner's course or chosen as a reference.
MaterialPurpose is SOURCE or WORK
  What a material is for: a SOURCE that the owner learns from, or the owner's own WORK, such as a photo of an answer, kept as evidence of an attempt and never used as a source.
opaque MediaValue
  A retained file reference with a name, media type, content locations, readable renditions, and any extraction limitations. Covers documents, slides, sheets, text, code, notebooks, images, uploaded source audio, and supported archive contents. Does not contain temporary microphone recordings. Its concrete representation is defined in design/material-data.md; the host verifies referenced files before supplying these values.
opaque MediaList
  An ordered sequence of MediaValue records. The order preserves pages, slides, files, or other supplied parts.
opaque SourceRecords
  Owned materials with their readable content and retained files.
```

## State

```state
a set of Materials with
  an owner Owner
  an optional importKey String
  a scope Scope
a set of Kept Materials with
  a title String
  a locator String
  a content String
  an originals seq of MediaValue
  an origin MaterialOrigin
  a purpose MaterialPurpose
Rule: every material is created as a kept material. A material that is not kept was deleted by its owner: it keeps only its owner, import key, and scope, so the owner's pages can recognize it as deleted and a retry under its import key cannot create it again. A deleted material never becomes kept again.
Rule: materials contain readable text or readable retained media. Their file references preserve extraction limitations. Unreadable uploads do not become materials.
Rule: material inputs match their declared types and the material data representation. References are nonblank strings. Malformed material inputs are refused before any state change.
Rule: every new material has a purpose supplied by the application. A material saved before purposes were recorded has none stored and is a SOURCE, so every query reads it as SOURCE. A material's purpose never changes.
Rule: every new material has a nonblank importKey supplied by the application. Only materials saved before import keys were introduced may lack one. Each (owner, importKey) pair identifies at most one material. The key grants no access and is not returned by material queries.
Rule: a retry compares scope, title, locator, content, originals, origin, and purpose with the saved kept material. Strings compare exactly, including case and whitespace. List order matters; record field order does not. A matching retry returns the saved material without changing it. Changed input needs a new key and creates a new material. A key belonging to another owner does not recover that owner's material.
Rule: kept materials never change. A changed source is added as a new material. Deleting a material removes its title, locator, content, originals, origin, and purpose together.
Rule: an unknown material belongs to no owner. Only its owner can delete a material.
Rule: blank text is empty or contains only whitespace. New identities are unique and begin with the server time at which they were made, so material identities made this way sort in the order their materials were added. Materials saved before identities recorded a time have identities that record none. Refused actions change no state; unmentioned state stays unchanged.
```

## Actions

```actions
add(owner: Owner, importKey: String, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin, purpose: MaterialPurpose) : returns (material: Material)
  where owner, scope, title, locator, content, originals, origin, or purpose does not match its declared type or representation, title or locator is blank, or neither content nor originals contains readable source material
  then
    refuses INVALID_TUTORING_MATERIAL "Provide a title, source location, and readable material."
  where material fields are valid and importKey is not a nonblank string
  then
    refuses INVALID_MATERIAL_IMPORT_KEY "Provide a nonblank import key."
  where material fields and importKey are valid and owner has a deleted material with importKey
  then
    refuses MATERIAL_DELETED "This material was deleted. Import the files again to use them."
  where material fields and importKey are valid, owner has a kept material with importKey, and any supplied material field differs from that material
  then
    refuses MATERIAL_IMPORT_CONFLICT "Use the original material input for this import key."
  where material fields and importKey are valid, owner has a kept material with importKey, and every supplied material field matches that material
  then
    returns material
  where material fields and importKey are valid and owner has no material with importKey
  then
    create material with owner, importKey, scope, title, locator, content, originals, origin, and purpose together, as a kept material
    returns material

delete(owner: Owner, material: Material) : returns ()
  where material is unknown, belongs to another owner, or is not kept
  then
    refuses MATERIAL_DELETE_UNAVAILABLE "Choose one of your materials to delete."
  where material is one of owner's kept materials
  then
    remove material from Kept Materials, so its title, locator, content, originals, origin, and purpose are no longer stored
    returns
```

## Queries

```queries
_materials(owner: Owner, scope: Scope) : many (material: Material, title: String, locator: String, origin: MaterialOrigin, purpose: MaterialPurpose)
  Returns the owner's kept materials in the scope, of either purpose, each with its purpose, ordered by material identity. Returns no rows when none match.

_material(material: Material) : optional (owner: Owner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin, purpose: MaterialPurpose)
  Returns the kept material and retained file references. Returns no row for an unknown or deleted material. The row names the material's owner, so the application can compare it with the person asking before it shows the material.

_sourceSet(owner: Owner, scope: Scope) : one (sources: SourceRecords)
  Returns only this owner's kept materials in scope whose purpose is SOURCE, ordered by material identity, or an empty list. The owner's work is never among them.

_workSet(owner: Owner, scope: Scope) : one (work: SourceRecords)
  Returns only this owner's kept materials in scope whose purpose is WORK, ordered by material identity, or an empty list.

_deleted(material: Material) : optional (owner: Owner, scope: Scope)
  Returns the owner and scope of a deleted material. Returns no row for a kept or unknown material. The row names the owner, so the application tells only that person that the material was deleted.

_deletions(owner: Owner, scope: Scope) : many (material: Material)
  Returns the owner's deleted materials in the scope, ordered by material identity. Returns no rows when none match.
```
