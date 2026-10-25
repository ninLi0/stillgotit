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
