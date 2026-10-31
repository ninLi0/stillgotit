import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Archiving.md" with { type: "text" };
import { Archiving } from "./Archiving.ts";

export const archiving = registerConcept({ class: Archiving, spec, refusals: {} });
