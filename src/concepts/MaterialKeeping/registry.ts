import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/MaterialKeeping.md" with { type: "text" };
import type { User } from "../Registering/Registering.ts";
import type { Course } from "../SkillMapping.ts";
import { MaterialKeeping } from "./MaterialKeeping.ts";
import * as refusal from "./refusals.ts";

/** MaterialKeeping bound as the stage's Library instance: Owner is Registering.User and Scope is SkillMapping.Course. */
class Library extends MaterialKeeping<User, Course> {}
export const materialKeeping = registerConcept({
  class: Library, spec, refusals: {
    INVALID_TUTORING_MATERIAL: refusal.InvalidTutoringMaterial,
    INVALID_MATERIAL_IMPORT_KEY: refusal.InvalidMaterialImportKey,
    MATERIAL_IMPORT_CONFLICT: refusal.MaterialImportConflict,
  },
});
