import { composition as Access } from "./compositions/access.ts";
import { composition as Reads } from "./compositions/learning-reads.ts";
import { composition as Progress } from "./compositions/progress.ts";
import { composition as Planning } from "./compositions/planning.ts";
import { composition as Learning } from "./compositions/learning.ts";
import { composition as Settings } from "./compositions/settings.ts";
import type { StudyPlanning } from "./concepts/StudyPlanning/StudyPlanning.ts";
import type { MasteryEstimating } from "./concepts/MasteryEstimating/MasteryEstimating.ts";
import type { AssessmentReviewing } from "./concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { assemble, type ConceptImplementation } from "@mit-sdg/sync-engine/assembly";
import { applicationConceptSet, TutorPreferring, ViewPreferring } from "./concepts.ts";
import type { Db } from "mongodb";
import type { FederatingConcept } from "./concepts/Federating/Federating.ts";
import type { RegisteringConcept, User } from "./concepts/Registering/Registering.ts";
import type { SessioningConcept } from "./concepts/Sessioning/Sessioning.ts";
import type { SkillMapping } from "./concepts/SkillMapping.ts";
import type { GroundedTutoring } from "./concepts/GroundedTutoring/GroundedTutoring.ts";
import type { Material, MaterialKeeping } from "./concepts/MaterialKeeping/MaterialKeeping.ts";
import { composition as accounts } from "./compositions/reusable/accounts.ts";
import { composition as commons } from "./compositions/reusable/commons.ts";
import { composition as Courses } from "./compositions/courses.ts";
import { composition as Importing } from "./compositions/importing.ts";
import { TutorGenerating } from "./concepts/Generating/registry.ts";

// Apply the same deadline to the interpreter and its HTTP gateway.
// Cloudflare ends requests after about 100 s. Gemini calls stop at 80 s; this limit ends any request before Cloudflare does.
export const executionLimits = {
  maxActiveRootFlows: 64, maxPendingRequests: 64,
  maxActionsPerFlow: 1000, maxFiringsPerFlow: 2000,
  maxRowsPerEvaluation: 20000, maxRequestDurationMs: 90_000,
};

export function assembleApplication(instances: {
  AssessmentReviewing: ConceptImplementation<typeof AssessmentReviewing>;
  MasteryEstimating: ConceptImplementation<typeof MasteryEstimating>;
  StudyPlanning: ConceptImplementation<typeof StudyPlanning>;
  Registering: ConceptImplementation<typeof RegisteringConcept>;
  CommonsFederating: ConceptImplementation<typeof FederatingConcept<User>>;
  Sessioning: ConceptImplementation<typeof SessioningConcept<User>>;
  SkillMapping: ConceptImplementation<typeof SkillMapping>;
  Library: ConceptImplementation<typeof MaterialKeeping<User, string>>;
  GroundedTutoring: ConceptImplementation<typeof GroundedTutoring<User, Material>>;
  TutorGenerating?: ConceptImplementation<typeof TutorGenerating>;
  TutorPreferring?: ConceptImplementation<typeof TutorPreferring>;
  ViewPreferring?: ConceptImplementation<typeof ViewPreferring>;
}, clock = () => new Date()) {
  return assemble({
    conceptSet: applicationConceptSet,
    instances: { ...instances, TutorGenerating: instances.TutorGenerating ?? new TutorGenerating(),
      TutorPreferring: instances.TutorPreferring ?? new TutorPreferring(unconfiguredDatabase("TutorPreferring"), "TutorPreferring"),
      ViewPreferring: instances.ViewPreferring ?? new ViewPreferring(unconfiguredDatabase("ViewPreferring"), "ViewPreferring") },
    composition: { reusable: { accounts, commons }, Courses, Learning, Importing, Reads, Progress, Planning, Access, Settings },
    queryCache: "none",
    executionLimits,
    clock,
  });
}

/**
 * Assemblies built only for account or course checks may omit TutorPreferring and ViewPreferring, as they may omit TutorGenerating's provider.
 * Each stand-in store refuses every read and write, so a tutor choice or home view is never saved to or read from an unintended database.
 */
const unconfiguredDatabase = (instance: string) => ({ collection: () => new Proxy({}, {
  get: () => () => Promise.reject(new Error(`${instance} has no database in this assembly.`)),
}) }) as unknown as Db;
