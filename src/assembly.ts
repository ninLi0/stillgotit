import { composition as Access } from "./compositions/access.ts";
import { composition as Reads } from "./compositions/learning-reads.ts";
import { composition as Progress } from "./compositions/progress.ts";
import { composition as Planning } from "./compositions/planning.ts";
import { composition as Learning } from "./compositions/learning.ts";
import type { StudyPlanning } from "./concepts/StudyPlanning/StudyPlanning.ts";
import type { MasteryEstimating } from "./concepts/MasteryEstimating/MasteryEstimating.ts";
import type { AssessmentReviewing } from "./concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { assemble, type ConceptImplementation } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet } from "./concepts.ts";
import type { FederatingConcept } from "./concepts/Federating/Federating.ts";
import type { RegisteringConcept, User } from "./concepts/Registering/Registering.ts";
import type { SessioningConcept } from "./concepts/Sessioning/Sessioning.ts";
import type { SkillMapping } from "./concepts/SkillMapping.ts";
import type { GroundedTutoring } from "./concepts/GroundedTutoring/GroundedTutoring.ts";
import { composition as accounts } from "./compositions/reusable/accounts.ts";
import { composition as commons } from "./compositions/reusable/commons.ts";
import { composition as Courses } from "./compositions/courses.ts";
import { TutorGenerating } from "./concepts/Generating/registry.ts";

// Apply the same deadline to the interpreter and its HTTP gateway.
export const executionLimits = {
  maxActiveRootFlows: 64, maxPendingRequests: 64,
  maxActionsPerFlow: 1000, maxFiringsPerFlow: 2000,
  maxRowsPerEvaluation: 20000, maxRequestDurationMs: 240000,
};

export function assembleApplication(instances: {
  AssessmentReviewing: ConceptImplementation<typeof AssessmentReviewing>;
  MasteryEstimating: ConceptImplementation<typeof MasteryEstimating>;
  StudyPlanning: ConceptImplementation<typeof StudyPlanning>;
  Registering: ConceptImplementation<typeof RegisteringConcept>;
  CommonsFederating: ConceptImplementation<typeof FederatingConcept<User>>;
  Sessioning: ConceptImplementation<typeof SessioningConcept<User>>;
  SkillMapping: ConceptImplementation<typeof SkillMapping>;
  GroundedTutoring: ConceptImplementation<typeof GroundedTutoring<User, string>>;
  TutorGenerating?: ConceptImplementation<typeof TutorGenerating>;
}, clock = () => new Date()) {
  return assemble({
    conceptSet: applicationConceptSet,
    instances: { ...instances, TutorGenerating: instances.TutorGenerating ?? new TutorGenerating() },
    composition: { reusable: { accounts, commons }, Courses, Learning, Reads, Progress, Planning, Access },
    queryCache: "none",
    executionLimits,
    clock,
  });
}
