// Refusals from the MaterialKeeping specification. The codes keep the names they had when GroundedTutoring
// kept materials, so the browser and the HTTP clients see the same answers.
export class InvalidTutoringMaterial extends Error {
  readonly code = "INVALID_TUTORING_MATERIAL";
  constructor() { super("Provide a title, source location, and readable material."); this.name = "InvalidTutoringMaterial"; }
}
export class InvalidMaterialImportKey extends Error {
  readonly code = "INVALID_MATERIAL_IMPORT_KEY";
  constructor() { super("Provide a nonblank import key."); this.name = "InvalidMaterialImportKey"; }
}
export class MaterialImportConflict extends Error {
  readonly code = "MATERIAL_IMPORT_CONFLICT";
  constructor() { super("Use the original material input for this import key."); this.name = "MaterialImportConflict"; }
}
export class MaterialDeleted extends Error {
  readonly code = "MATERIAL_DELETED";
  constructor() { super("This material was deleted. Import the files again to use them."); this.name = "MaterialDeleted"; }
}
export class MaterialDeleteUnavailable extends Error {
  readonly code = "MATERIAL_DELETE_UNAVAILABLE";
  constructor() { super("Choose one of your materials to delete."); this.name = "MaterialDeleteUnavailable"; }
}
