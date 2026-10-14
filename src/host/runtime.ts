import { StudyPlanning } from "../concepts/StudyPlanning/StudyPlanning.ts";
import { MasteryEstimating } from "../concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../concepts/GroundedTutoring/GroundedTutoring.ts";
import type { Db } from "mongodb";
import { assembleApplication } from "../assembly.ts";
import { FederatingConcept } from "../concepts/Federating/Federating.ts";
import type { Provider } from "../concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "../concepts/Registering/Registering.ts";
import { SessioningConcept } from "../concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../concepts/SkillMapping.ts";
import { RegistrationRecoveryStore } from "../storage/RegistrationRecoveryStore.ts";
import { createApplicationHttp } from "./http.ts";
import { ChatGPTConnection } from "./chatgpt.ts";
import { MaterialFiles } from "./material-files.ts";
import { MaterialImportStore } from "../storage/MaterialImportStore.ts";
import { CourseTutor } from "./tutor.ts";
import { TutorGenerating } from "../concepts/Generating/registry.ts";
import { tutorGenerator } from "./tutor-generation.ts";

export async function createRuntime({ database, provider, providerOrigin, publicOrigin, clock = () => new Date(), tutor: suppliedTutor }: {
  database: Db; provider: Provider; providerOrigin: string; publicOrigin: string; clock?: () => Date;
  tutor?: Pick<CourseTutor, "suggest" | "generate">;
}) {
  const chatgpt = new ChatGPTConnection(publicOrigin), files = new MaterialFiles(), imports = new MaterialImportStore(database);
  const tutor = suppliedTutor ?? new CourseTutor(chatgpt, files);
  const application = assembleApplication({
    TutorGenerating: new TutorGenerating(tutorGenerator(tutor)),
    Registering: new RegisteringConcept(database),
    CommonsFederating: new FederatingConcept<User>(database, provider, "CommonsFederating", clock),
    Sessioning: new SessioningConcept<User>(database, "Sessioning", clock),
    SkillMapping: await createSkillMapping(database),
    AssessmentReviewing: new AssessmentReviewing(database, "AssessmentReviewing", clock),
    MasteryEstimating: new MasteryEstimating(database, "MasteryEstimating", clock),
    StudyPlanning: new StudyPlanning(database, "StudyPlanning", () => clock().toLocaleDateString("en-CA", { timeZone: "America/New_York" })),
    GroundedTutoring: new GroundedTutoring(database, "GroundedTutoring", clock),
  }, clock);
  const recovery = new RegistrationRecoveryStore(database, providerOrigin);
  const http = createApplicationHttp({ application, recovery, publicOrigin, clock, chatgpt, files, imports });
  return { application, recovery, chatgpt, files, imports, tutor, ...http };
}
