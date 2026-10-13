import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/Registering.md" with { type: "text" };
import type { Db } from "mongodb";
import {
  InvalidRecoveryKey,
  InvalidUsername,
  RecoveryKeyConflict,
  RegisteringConcept,
  UsernameTaken,
} from "./Registering.ts";

export const registering = registerConcept({
  class: RegisteringConcept,
  spec,
  refusals: {
    INVALID_USERNAME: InvalidUsername,
    INVALID_RECOVERY_KEY: InvalidRecoveryKey,
    RECOVERY_KEY_CONFLICT: RecoveryKeyConflict,
    USERNAME_TAKEN: UsernameTaken,
  },
  floors: { mongo: ({ database }: { database: Db }, name: string) => new RegisteringConcept(database, name) },
});
