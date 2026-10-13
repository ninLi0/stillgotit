import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Federating.md" with { type: "text" };
import type { Db } from "mongodb";
import type { User } from "../Registering/Registering.ts";
import { AlreadyLinked, FederatingConcept, NotConfirmed, SignInExpired, SignInRefused } from "./Federating.ts";
import type { Provider } from "./provider.ts";

/** Sign-in with Commons. Its provider is Commons when running and in memory in tests. */
class CommonsFederating extends FederatingConcept<User> {}

export const commonsFederating = registerConcept({
  class: CommonsFederating,
  spec,
  refusals: {
    SIGN_IN_EXPIRED: SignInExpired,
    SIGN_IN_REFUSED: SignInRefused,
    NOT_CONFIRMED: NotConfirmed,
    ALREADY_LINKED: AlreadyLinked,
  },
  floors: {
    mongo: ({ database, commons }: { database: Db; commons: Provider }, name: string) =>
      new CommonsFederating(database, commons, name),
  },
});
