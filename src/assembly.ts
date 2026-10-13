import { assemble, type ConceptImplementation } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";
import type { FederatingConcept } from "./concepts/Federating/Federating.ts";
import type { RegisteringConcept, User } from "./concepts/Registering/Registering.ts";
import type { SessioningConcept } from "./concepts/Sessioning/Sessioning.ts";
import type { SkillMapping } from "./concepts/SkillMapping.ts";
import { composition as accounts } from "./compositions/reusable/accounts.ts";
import { composition as commons } from "./compositions/reusable/commons.ts";
import { composition as Courses } from "./compositions/courses.ts";

export function assembleApplication(instances: {
  Registering: ConceptImplementation<typeof RegisteringConcept>;
  CommonsFederating: ConceptImplementation<typeof FederatingConcept<User>>;
  Sessioning: ConceptImplementation<typeof SessioningConcept<User>>;
  SkillMapping: ConceptImplementation<typeof SkillMapping>;
}) {
  return assemble({
    conceptSet: applicationConceptSet,
    instances,
    composition: { reusable: { accounts, commons }, Courses },
    queryCache: "none",
  });
}
