import { StudyPlanning } from "./src/concepts/StudyPlanning/StudyPlanning.ts";
import { MasteryEstimating } from "./src/concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "./src/concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "./src/concepts/GroundedTutoring/GroundedTutoring.ts";
import { MongoClient } from "mongodb";
import { httpWire } from "@mit-sdg/sync-engine-http/tooling";
import { assembleApplication } from "./src/assembly.ts";
import { TutorPreferring, ViewPreferring } from "./src/concepts.ts";
import { FederatingConcept } from "./src/concepts/Federating/Federating.ts";
import { MemoryProvider } from "./src/concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "./src/concepts/Registering/Registering.ts";
import { SessioningConcept } from "./src/concepts/Sessioning/Sessioning.ts";
import { SkillMapping } from "./src/concepts/SkillMapping.ts";
import { localMongoUri } from "./src/storage/mongo.ts";
import { stillGotItPolicy } from "./src/host/http-policy.ts";

function assembleForChecks() {
  // Construction only: tools inspect declarations and never run database actions.
  // No connection or index creation is needed for checks and generation.
  const client = new MongoClient(localMongoUri);
  return assembleApplication({
    Registering: new RegisteringConcept(client.db("stillgotit_spec_check")),
    CommonsFederating: new FederatingConcept<User>(
      client.db("stillgotit_spec_check"), new MemoryProvider(), "CommonsFederating",
    ),
    Sessioning: new SessioningConcept<User>(client.db("stillgotit_spec_check")),
    SkillMapping: new SkillMapping(client.db("stillgotit_spec_check")),
    AssessmentReviewing: new AssessmentReviewing(client.db("stillgotit_spec_check")),
    MasteryEstimating: new MasteryEstimating(client.db("stillgotit_spec_check")),
    StudyPlanning: new StudyPlanning(client.db("stillgotit_spec_check")),
    GroundedTutoring: new GroundedTutoring(client.db("stillgotit_spec_check")),
    TutorPreferring: new TutorPreferring(client.db("stillgotit_spec_check"), "TutorPreferring"),
    ViewPreferring: new ViewPreferring(client.db("stillgotit_spec_check"), "ViewPreferring"),
  });
}

export default {
  assemble: assembleForChecks,
  title: "StillGotIt",
  wireName: "StillGotItWire",
  projections: [httpWire({ policy: stillGotItPolicy("http://localhost:5173"), name: "StillGotItHttp" })],
  design: {
    version: 1,
    documents: [new URL("./design/stages/materials.md", import.meta.url),
      ...["Courses", "Learning", "Importing", "LearningReads", "Progress", "Planning", "LearningComputations", "LearningAccess", "Settings"].map((name) => new URL(`./design/compositions/${name}.md`, import.meta.url))],
  },
};
