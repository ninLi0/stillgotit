import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../../concepts.ts";
import { recordOutput, validators } from "./inputs.ts";

const { Registering, CommonsFederating, Sessioning } = concepts;

const StartCommons = endpoint("/auth/commons/start", ({ attempt, expiresAt, address }) =>
  receive({})
    .then(CommonsFederating.start({}).responds({ attempt, expiresAt, address }))
    .then(respond({ attempt, expiresAt, address })),
  { validators: { ...validators, output: recordOutput(["attempt", "address"], ["expiresAt"]) } },
);

// Confirmation is separate so the host can persist a recovery key before registration.
const FinishCommons = endpoint("/auth/commons/finish", ({ attempt, state, code, username }) =>
  receive({ attempt, state, code })
    .then(CommonsFederating.finish({ attempt, nonce: state, code }).responds({ username }))
    .then(respond({ username })),
  { validators: { ...validators, output: recordOutput(["username"]) } },
);

/** The host replaces recoveryKey and supplies a verified suggestion or the chosen username. */
function continuation(path: string) {
  return endpoint(path, ({ attempt, username, recoveryKey, user, session, expiresAt }) =>
    receive({ attempt, username, recoveryKey }).then(
      where(
        CommonsFederating._identity({ attempt }),
        CommonsFederating._user({ attempt }).is({ user }),
      )
        .then(Sessioning.start({ subject: user }).responds({ session, expiresAt }))
        .then(respond({ user, session, expiresAt }))
        .named("returning"),
      where(
        CommonsFederating._identity({ attempt }),
        no(CommonsFederating._user({ attempt })),
        Registering._byRecoveryKey({ recoveryKey }).is({ user }),
      )
        .then(CommonsFederating.link({ attempt, user }).responds({ user }))
        .then(Sessioning.start({ subject: user }).responds({ session, expiresAt }))
        .then(respond({ user, session, expiresAt }))
        .named("recovered"),
      where(
        CommonsFederating._identity({ attempt }),
        no(CommonsFederating._user({ attempt })),
        no(Registering._byRecoveryKey({ recoveryKey })),
      )
        .then(Registering.register({ username, recoveryKey }).responds({ user }))
        .then(CommonsFederating.link({ attempt, user }).responds({ user }))
        .then(Sessioning.start({ subject: user }).responds({ session, expiresAt }))
        .then(respond({ user, session, expiresAt }))
        .named("new"),
      where(no(CommonsFederating._identity({ attempt })))
        .then(respond({ error: "SIGN_IN_EXPIRED" }))
        .named("expired"),
    ),
    { input: { required: ["attempt"], defaults: { username: "", recoveryKey: "" } },
      validators: { ...validators, output: recordOutput(["user", "session"], ["expiresAt"]) } },
  );
}

const ResumeCommons = continuation("/auth/commons/resume");
const ChooseUsername = continuation("/auth/commons/choose");

export const composition = {
  starting: { StartCommons },
  finishing: { FinishCommons, ResumeCommons, ChooseUsername },
};
