import { Budgeting } from "../concepts/Budgeting/Budgeting.ts";
import { upgradeEarlierDocuments } from "../concepts/Budgeting/upgrade.ts";
import { MasteryEstimating } from "../concepts/MasteryEstimating/MasteryEstimating.ts";
import { AssessmentReviewing } from "../concepts/AssessmentReviewing/AssessmentReviewing.ts";
import { GroundedTutoring } from "../concepts/GroundedTutoring/GroundedTutoring.ts";
import { MaterialKeeping } from "../concepts/MaterialKeeping/MaterialKeeping.ts";
import type { Db } from "mongodb";
import { assembleApplication } from "../assembly.ts";
import { FederatingConcept } from "../concepts/Federating/Federating.ts";
import type { Provider } from "../concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "../concepts/Registering/Registering.ts";
import { SessioningConcept } from "../concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../concepts/SkillMapping.ts";
import { RegistrationRecoveryStore } from "../storage/RegistrationRecoveryStore.ts";
import { createApplicationHttp } from "./http.ts";
import { Gemini } from "./gemini.ts";
import { MaterialFiles } from "./material-files.ts";
import { MaterialImportStore } from "../storage/MaterialImportStore.ts";
import { CourseTutor } from "./tutor.ts";
import { ProviderFiles } from "./provider-files.ts";
import { TranscriptionWorker, type TranscriptionWorkerOptions } from "./transcription-worker.ts";
import type { MaterialRouteOptions } from "./material-routes.ts";
import { TutorGenerating } from "../concepts/Generating/registry.ts";
import { TreeStyling, TutorPreferring, ViewPreferring } from "../concepts.ts";
import { TutorFailures, tutorGenerator } from "./tutor-generation.ts";

/**
 * Assembles the application and its host. The transcription worker is created here but started by the server
 * (`runtime.worker.start()`), so tests and tools that create a runtime do not transcribe in the background.
 */
export async function createRuntime({ database, provider, providerOrigin, publicOrigin, clock = () => new Date(), tutor: suppliedTutor, gemini = new Gemini(),
  files = new MaterialFiles(), limits, transcribeModel = process.env.GEMINI_TRANSCRIBE_MODEL, worker: workerOptions = {} }: {
  database: Db; provider: Provider; providerOrigin: string; publicOrigin: string; clock?: () => Date;
  tutor?: Pick<CourseTutor, "suggest" | "generate">; gemini?: Gemini; files?: MaterialFiles;
  /** Shorter upload and listing limits, for tests. */
  limits?: MaterialRouteOptions["limits"];
  /** `GEMINI_TRANSCRIBE_MODEL`. Without it, transcription uses the server's tutor model. */
  transcribeModel?: string;
  worker?: Partial<Pick<TranscriptionWorkerOptions, "intervalMs" | "renewMs" | "log">>;
}) {
  // StudyPlanning documents saved before the concept was named Budgeting are rewritten once, before any request reads them.
  await upgradeEarlierDocuments(database, "StudyPlanning");
  await moveMaterialCollection(database);
  const imports = new MaterialImportStore(database, "MaterialImport", clock), failures = new TutorFailures();
  const providerFiles = new ProviderFiles(database, gemini, files, clock);
  const tutor = suppliedTutor ?? new CourseTutor(gemini, files, providerFiles);
  const worker = new TranscriptionWorker({ imports, files, gemini, providers: providerFiles, model: transcribeModel?.trim() || undefined, clock, ...workerOptions });
  const application = assembleApplication({
    TutorGenerating: new TutorGenerating(tutorGenerator(tutor, failures)),
    TutorPreferring: new TutorPreferring(database, "TutorPreferring"),
    ViewPreferring: new ViewPreferring(database, "ViewPreferring"),
    TreeStyling: new TreeStyling(database, "TreeStyling"),
    Registering: new RegisteringConcept(database),
    CommonsFederating: new FederatingConcept<User>(database, provider, "CommonsFederating", clock),
    Sessioning: new SessioningConcept<User>(database, "Sessioning", clock),
    SkillMapping: await createSkillMapping(database),
    AssessmentReviewing: new AssessmentReviewing(database, "AssessmentReviewing", clock),
    MasteryEstimating: new MasteryEstimating(database, "MasteryEstimating", clock),
    StudyPlanning: new Budgeting(database, "StudyPlanning", () => clock().toLocaleDateString("en-CA", { timeZone: "America/New_York" })),
    Library: new MaterialKeeping(database, "Library"),
    GroundedTutoring: new GroundedTutoring(database, "GroundedTutoring", clock),
  }, clock);
  const recovery = new RegistrationRecoveryStore(database, providerOrigin);
  const http = createApplicationHttp({ application, recovery, publicOrigin, clock, gemini, failures, files, imports, transcription: worker, limits });
  return { application, recovery, gemini, files, imports, tutor, providerFiles, worker, ...http };
}

const formerMaterials = "groundedtutoring.materials", libraryMaterials = "library.materials";

/**
 * A one-time data move, added on October 25, 2026, when the material library moved out of GroundedTutoring into its own
 * concept. Deployed materials are in the collection that GroundedTutoring used, and the Library instance reads its own
 * collection, so the old collection is renamed once before the concepts are constructed. When the old collection is
 * missing, or the new one already exists, nothing changes. This is the one place the host writes to a concept's
 * collections, and it can be removed after the next deploy.
 */
export async function moveMaterialCollection(database: Db): Promise<void> {
  const present = async () => new Set((await database.listCollections({ name: { $in: [formerMaterials, libraryMaterials] } }, { nameOnly: true })
    .toArray()).map(({ name }) => name));
  const found = await present();
  if (!found.has(formerMaterials) || found.has(libraryMaterials)) return;
  try {
    await database.collection(formerMaterials).rename(libraryMaterials);
  } catch (error) {
    // Another process that started at the same time may have finished the same move first.
    if ((await present()).has(libraryMaterials)) return;
    throw error;
  }
  console.log(`Moved the saved materials from ${formerMaterials} to ${libraryMaterials}.`);
}
