# MaterialKeeping

## Purpose

Keep a person's source materials so they can be read and cited later, and so that bringing the same material in again returns the saved copy instead of a duplicate.

## Principle

Sam adds his week 3 notes to his linear algebra course. He gives a title, the place the notes came from, their readable text, and the retained slide file, and the application supplies an import key for this import. The notes appear in Sam's list for that course, and reading them back returns the same text, slides, and extraction limits. The reply to Sam's request was lost, so the application adds the notes again with the same key, and MaterialKeeping returns the saved material instead of making a copy. A later request under that key with a different title is refused, because changed input needs a new key. Leo's list for the same course does not include Sam's notes, and Leo's request under Sam's key saves a material of Leo's own rather than recovering Sam's.

## Types

```types
external Owner
  The identity that owns a material.
external Scope
  The context to which a material belongs, such as a course.
MaterialOrigin is COURSE or REFERENCE
  Material brought from the owner's course or chosen as a reference.
opaque MediaValue
  A retained file reference with a name, media type, content locations, readable renditions, and any extraction limitations. Covers documents, slides, sheets, text, code, notebooks, images, uploaded source audio, and supported archive contents. Does not contain temporary microphone recordings. Its concrete representation is defined in design/material-data.md; the host verifies referenced files before supplying these values.
opaque MediaList
  An ordered sequence of MediaValue records. The order preserves pages, slides, files, or other supplied parts.
opaque SourceRecords
  Owned materials with their source content and retained files.
```

## State

```state
a set of Materials with
  an owner Owner
  an optional importKey String
  a scope Scope
  a title String
  a locator String
  a content String
  an originals seq of MediaValue
  an origin MaterialOrigin
Rule: materials contain readable text or readable retained media. Their file references preserve extraction limitations. Unreadable uploads do not become materials.
Rule: material inputs match their declared types and the material data representation. References are nonblank strings. Malformed material inputs are refused before any state change.
Rule: every new material has a nonblank importKey supplied by the application. Only materials saved before import keys were introduced may lack one. Each (owner, importKey) pair identifies at most one material. The key grants no access and is not returned by material queries.
Rule: a retry compares scope, title, locator, content, originals, and origin with the saved material. Strings compare exactly, including case and whitespace. List order matters; record field order does not. A matching retry returns the saved material without changing it. Changed input needs a new key and creates a new material. A key belonging to another owner does not recover that owner's material.
Rule: saved materials never change. A changed source is added as a new material.
Rule: an unknown material belongs to no owner.
Rule: blank text is empty or contains only whitespace. New identities are unique. Refused actions change no state; unmentioned state stays unchanged.
```

## Actions

```actions
add(owner: Owner, importKey: String, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin) : returns (material: Material)
  where owner, scope, title, locator, content, originals, or origin does not match its declared type or representation, title or locator is blank, or neither content nor originals contains readable source material
  then
    refuses INVALID_TUTORING_MATERIAL "Provide a title, source location, and readable material."
  where material fields are valid and importKey is not a nonblank string
  then
    refuses INVALID_MATERIAL_IMPORT_KEY "Provide a nonblank import key."
  where material fields and importKey are valid, owner has a material with importKey, and any supplied material field differs from that material
  then
    refuses MATERIAL_IMPORT_CONFLICT "Use the original material input for this import key."
  where material fields and importKey are valid, owner has a material with importKey, and every supplied material field matches that material
  then
    returns material
  where material fields and importKey are valid and owner has no material with importKey
  then
    create material with owner, importKey, scope, title, locator, content, originals, and origin together
    returns material
```

## Queries

```queries
_materials(owner: Owner, scope: Scope) : many (material: Material, title: String, locator: String, origin: MaterialOrigin)
  Returns the owner's materials in the scope, ordered by material identity. Returns no rows when none match.

_material(material: Material) : optional (owner: Owner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin)
  Returns the saved material and retained file references. Returns no row for an unknown material. The row names the material's owner, so the application can compare it with the person asking before it shows the material.

_sourceSet(owner: Owner, scope: Scope) : one (sources: SourceRecords)
  Returns only this owner's sources in scope, ordered by material identity, or an empty list.
```
