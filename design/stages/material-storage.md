# GroundedTutoring

## Purpose

Keep readable course material for a learner. This checked stage implements material storage only.

## Principle

A learner imports a source. Its readable content and original references remain available. A retry with the same import key and input returns the saved material. Changed input requires a new key.

## Types

```types
external Learner
  The material owner.
external Scope
  The course containing the material.
MaterialOrigin is COURSE or REFERENCE
  Material from coursework or a chosen reference.
opaque MediaValue
  A retained source with readable renditions and extraction limitations, as defined in design/material-data.md.
opaque MediaList
  An ordered list of MediaValue records.
```

## State

```state
a set of Materials with
  an owner Learner
  an optional importKey String
  a scope Scope
  a title String
  a locator String
  a content String
  an originals seq of MediaValue
  an origin MaterialOrigin
Rule: materials contain readable text or readable retained media. Their file references preserve extraction limitations. Unreadable uploads do not become teaching material.
Rule: material inputs match their declared types and the material data representation. References are nonblank strings. Malformed material inputs are refused before any state change.
Rule: every new material has a nonblank importKey supplied by the host. Only materials saved before import keys were introduced may lack one. Each (owner, importKey) pair identifies at most one material. The key grants no access and is not returned by material queries.
Rule: a retry compares scope, title, locator, content, originals, and origin with the saved material. Strings compare exactly, including case and whitespace. List order matters; record field order does not. A matching retry returns the saved material without changing it. Changed input needs a new key and creates a new material. A key belonging to another owner does not recover that owner's material.
Rule: blank text is empty or contains only whitespace. New identities are unique. now is server time. Refused actions change no state; unmentioned state stays unchanged.
```

## Actions

```actions
addMaterial(owner: Learner, importKey: String, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin) : returns (material: Material)
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
_materials(owner: Learner, scope: Scope) : many (material: Material, title: String, locator: String, origin: MaterialOrigin)
  Returns the owner's materials in the scope, ordered by material identity. Returns no rows when none match.

_material(material: Material) : optional (owner: Learner, scope: Scope, title: String, locator: String, content: String, originals: MediaList, origin: MaterialOrigin)
  Returns the saved material and retained file references. Returns no row for an unknown material.
```
