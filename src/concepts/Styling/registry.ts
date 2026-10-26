import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Styling.md" with { type: "text" };
import { Styling } from "./Styling.ts";

export const styling = registerConcept({ class: Styling, spec, refusals: {} });
