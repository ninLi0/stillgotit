import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Preferring.md" with { type: "text" };
import { Preferring } from "./Preferring.ts";

export const preferring = registerConcept({ class: Preferring, spec, refusals: {} });
