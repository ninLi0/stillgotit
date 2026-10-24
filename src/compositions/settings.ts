import { endpoint, receive, respond } from "@mit-sdg/sync-engine/boundary";
import { compute, former, is, no, view, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import { homeViewInput, recordOutput, structuredOutput, tutorChoiceInput, validators } from "./reusable/inputs.ts";
const { Sessioning, TutorPreferring: Preferring, ViewPreferring } = concepts;
const options = { validators: { ...validators, output: structuredOutput } };

/** The design's sentences for the two ChooseTutor refusals. The HTTP adapter reports only a category, so the host adds them as `detail`. */
export const tutorRefusals = {
  UNKNOWN_TUTOR_MODEL: "That model isn't offered. Choose one of the models in the Tutor panel.",
  UNSUPPORTED_THINKING_LEVEL: "That model doesn't offer this thinking level. Choose one of the levels shown for it.",
} as const;

/** Exactly one case holds for each learner: SAVED, RETIRED, or DEFAULT. */
const TutorStatus = view("the tutor choice that applies to (owner)", ({ owner }, { choice, status }, { offered }) => [
  where(Preferring._choice({ user: owner }).is({ option: choice }), compute(C.choiceOffered, { choice }, offered),
    compute(C.tutorStatus, { saved: true, offered }, status)),
  where(no(Preferring._choice({ user: owner })), compute(C.defaultChoice, {}, choice),
    compute(C.tutorStatus, { saved: false, offered: true }, status)),
]).one();

/** The record every settings endpoint answers: the catalog in table order, the choice and its status, and the default. */
const TutorSettings = former("the tutor settings for (owner)", ({ owner }, { models, choice, status, fallback }) => where(
  compute(C.tutorCatalog, {}, models), TutorStatus({ owner }).is({ choice, status }), compute(C.defaultChoice, {}, fallback),
).form({ models, choice, status, defaultChoice: fallback }));

/** Admission for every command that asks the tutor: no saved choice, or a saved choice that is still offered. */
const TutorReady = former("admit a tutor request for (owner)", ({ owner }, { status }) => where(
  TutorStatus({ owner }).is({ status }), is.among(status, ["SAVED", "DEFAULT"]),
).form({ allowed: true })).optional();

/** The model and thinking level that a sent tutor request carried. A tutor response returns it as `tutor`; it is not stored. */
const SentTutor = former("the tutor choice that (request) carried", ({ request }, { model, level }) => where(
  compute(C.requestChoice, { request }, { model, level }),
).form({ model, level }));

const ReadTutor = endpoint("/settings/tutor", ({ session, owner }) => receive({ session })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(respond({ settings: TutorSettings({ owner }) })), options);

const ChooseTutor = endpoint("/settings/tutor/choose", ({ session, model, level, owner, known, listed, choice }) => receive({ session, model, level })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(compute(C.modelOffered, { model }, known), is.among(known, [true]), compute(C.levelSupported, { model, level }, listed), is.among(listed, [true]),
      compute(C.offeredChoice, { model, level }, choice))
      .then(Preferring.set({ user: owner, option: choice }).responds({}))
      .then(respond({ settings: TutorSettings({ owner }) })).named("offered"),
    where(compute(C.modelOffered, { model }, known), is.among(known, [false])).then(respond({ error: "UNKNOWN_TUTOR_MODEL" })).named("unknown"),
    where(compute(C.modelOffered, { model }, known), is.among(known, [true]), compute(C.levelSupported, { model, level }, listed), is.among(listed, [false]))
      .then(respond({ error: "UNSUPPORTED_THINKING_LEVEL" })).named("level"),
  ), { validators: { ...options.validators, input: tutorChoiceInput } });

const ClearTutor = endpoint("/settings/tutor/clear", ({ session, owner }) => receive({ session })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(Preferring.clear({ user: owner }).responds({}))
  .then(respond({ settings: TutorSettings({ owner }) })), options);

/** The design's sentence for the SetHomeView refusal. The HTTP adapter reports only a category, so the host adds it as `detail`. */
export const homeViewRefusals = {
  UNKNOWN_HOME_VIEW: "Choose the skill tree or the task list.",
} as const;

/** Exactly one case holds for each learner: a saved view that is still offered, a saved view that is not, or no saved view. */
const AppliedHomeView = view("the home view that applies to (owner)", ({ owner }, { view: shown }, { saved, offered }) => [
  where(ViewPreferring._choice({ user: owner }).is({ option: shown }), compute(C.homeViewOffered, { view: shown }, offered), is.among(offered, [true])),
  where(ViewPreferring._choice({ user: owner }).is({ option: saved }), compute(C.homeViewOffered, { view: saved }, offered), is.among(offered, [false]),
    compute(C.defaultHomeView, {}, shown)),
  where(no(ViewPreferring._choice({ user: owner })), compute(C.defaultHomeView, {}, shown)),
]).one();

const homeViewOptions = { validators: { ...validators, output: recordOutput(["view"]) } };

const ReadHomeView = endpoint("/settings/view", ({ session, owner, shown }) => receive({ session })
  .then(Sessioning.use({ session }).responds({ subject: owner }))
  .then(where(AppliedHomeView({ owner }).is({ view: shown })).then(respond({ view: shown }))), homeViewOptions);

const SetHomeView = endpoint("/settings/view/set", ({ session, view: requested, owner, offered, chosen }) => receive({ session, view: requested })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(compute(C.homeViewOffered, { view: requested }, offered), is.among(offered, [true]), compute(C.offeredHomeView, { view: requested }, chosen))
      .then(ViewPreferring.set({ user: owner, option: chosen }).responds({}))
      .then(respond({ view: chosen })).named("offered"),
    where(compute(C.homeViewOffered, { view: requested }, offered), is.among(offered, [false])).then(respond({ error: "UNKNOWN_HOME_VIEW" })).named("unknown"),
  ), { validators: { ...homeViewOptions.validators, input: homeViewInput } });

export const composition = { TutorStatus, TutorSettings, TutorReady, SentTutor, ReadTutor, ChooseTutor, ClearTutor, AppliedHomeView, ReadHomeView, SetHomeView };
