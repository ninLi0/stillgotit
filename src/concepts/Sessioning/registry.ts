import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Sessioning.md" with { type: "text" };
import type { Db } from "mongodb";
import type { User } from "../Registering/Registering.ts";
import { NotSignedIn, SessioningConcept } from "./Sessioning.ts";

class Sessioning extends SessioningConcept<User> {}

/** Sessions for agents. Each subject is an agent's name, such as `describer`. */
class AgentSessioning extends SessioningConcept<string> {}

export const sessioning = registerConcept({
  class: Sessioning,
  spec,
  refusals: { NOT_SIGNED_IN: NotSignedIn },
  floors: { mongo: ({ database }: { database: Db }, name: string) => new Sessioning(database, name) },
});

export const agentSessioning = registerConcept({
  class: AgentSessioning,
  spec,
  refusals: { NOT_SIGNED_IN: NotSignedIn },
  floors: { mongo: ({ database }: { database: Db }, name: string) => new AgentSessioning(database, name) },
});
