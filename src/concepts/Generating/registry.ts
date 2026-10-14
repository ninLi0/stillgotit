import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Generating.md" with { type: "text" };
import type { User } from "../Registering/Registering.ts";
import type { TutorRequest, TutorAnswer } from "../../learning-data.ts";
import { Generating, GenerationFailed } from "./Generating.ts";
export class TutorGenerating extends Generating<User, TutorRequest, TutorAnswer> {}
export const generating = registerConcept({ class: TutorGenerating, spec, refusals: { GENERATION_FAILED: GenerationFailed } });
