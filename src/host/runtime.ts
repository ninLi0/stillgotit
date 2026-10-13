import type { Db } from "mongodb";
import { assembleApplication } from "../assembly.ts";
import { FederatingConcept } from "../concepts/Federating/Federating.ts";
import type { Provider } from "../concepts/Federating/provider.ts";
import { RegisteringConcept, type User } from "../concepts/Registering/Registering.ts";
import { SessioningConcept } from "../concepts/Sessioning/Sessioning.ts";
import { createSkillMapping } from "../concepts/SkillMapping.ts";
import { RegistrationRecoveryStore } from "../storage/RegistrationRecoveryStore.ts";
import { createApplicationHttp } from "./http.ts";

export async function createRuntime({ database, provider, providerOrigin, publicOrigin, clock = () => new Date() }: {
  database: Db; provider: Provider; providerOrigin: string; publicOrigin: string; clock?: () => Date;
}) {
  const application = assembleApplication({
    Registering: new RegisteringConcept(database),
    CommonsFederating: new FederatingConcept<User>(database, provider, "CommonsFederating", clock),
    Sessioning: new SessioningConcept<User>(database, "Sessioning", clock),
    SkillMapping: await createSkillMapping(database),
  });
  const recovery = new RegistrationRecoveryStore(database, providerOrigin);
  const http = createApplicationHttp({ application, recovery, publicOrigin, clock });
  return { application, recovery, ...http };
}
