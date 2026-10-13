import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { no, where } from "@mit-sdg/sync-engine/language";
import { concepts } from "../../concepts.ts";
import { recordOutput, validators } from "./inputs.ts";

const { Registering, Sessioning } = concepts;

const Me = endpoint("/auth/me", ({ session, user, username }) =>
  receive({ session })
    .then(Sessioning.use({ session }).responds({ subject: user }))
    .then(
      where(Registering._username({ user }).is({ username }))
        .then(respond({ username })).named("known"),
      where(no(Registering._username({ user })))
        .then(respond({ error: "NOT_SIGNED_IN" })).named("missing"),
    ),
  { validators: { ...validators, output: recordOutput(["username"]) } },
);

const SignOut = endpoint("/auth/logout", ({ session }) =>
  receive({ session })
    .then(Sessioning.end({ session }).responds({}))
    .then(respond({})),
  { validators },
);

export const composition = { identifying: { Me }, leaving: { SignOut } };
