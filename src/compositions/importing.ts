import { endpoint, receive, respond, type EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { compute, each, former, is, no, now, view, where } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import type { GradedStatus } from "../computations/importing.ts";
import { composition as Courses } from "./courses.ts";
import { structuredInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, SkillMapping: Mapping, GroundedTutoring: Tutoring, AssessmentReviewing: Assessment, TutorGenerating: AI } = concepts;

/** A nonblank material identity; the session comes from the cookie. */
const gradedMaterialInput: EndpointValidator = (value) => {
  if (!structuredInput(value).ok) return { ok: false };
  const record = value as Record<string, unknown>;
  return (record.session === null || typeof record.session === "string") && typeof record.material === "string" &&
    record.material.trim().length > 0 && record.material.length <= 300 ? { ok: true } : { ok: false, detail: "Choose graded work from one of your courses." };
};
const options = { validators: { ...validators, input: gradedMaterialInput, output: structuredOutput } };
/** The four Confirm fields. The date and the row's content are the endpoint's own checks, so only their presence and kind are checked here. */
const confirmInput: EndpointValidator = (value) => {
  const material = gradedMaterialInput(value);
  if (!material.ok) return material;
  const record = value as Record<string, unknown>, row = record.row;
  return "performedOn" in record && typeof record.outsideHelp === "boolean" && typeof row === "object" && row !== null && !Array.isArray(row)
    ? { ok: true } : { ok: false, detail: "Send the performance date, the help declaration, and one question as it was extracted." };
};

// The owner's own material, in a course the owner owns, with a graded title. Every endpoint here requires it first.
const GradedMaterial = view("(owner) imported graded work (material)", ({ owner, material }, { course, originals }, { title, graded }) => where(
  Tutoring._material({ material }).is({ owner, scope: course, title, originals }), Courses.OwnedCourse({ owner, course }),
  compute(C.gradedTitle, { title }, graded), is.among(graded, [true]),
)).optional();

// The owner's imported cases from this material, read skill by skill in its course, ordered by case identity.
const ImportedRows = former("the imports from (material) for (owner) in (course)", ({ owner, material, course }, { unit, skill, assessment, performedAt, sourceKey, fromMaterial, label, mark, feedback, result }) =>
  each(Mapping._units({ course }).is({ unit }))
    .where(Mapping._skills({ unit }).is({ skill }), Assessment._cases({ author: owner, subject: skill }).is({ case: assessment, performedAt, imported: true }),
      Assessment._case({ case: assessment }).is({ sourceKey }), compute(C.gradedSource, { sourceKey, material }, fromMaterial), is.among(fromMaterial, [true]),
      Assessment._work({ case: assessment }).is({ question: label, originalMark: mark, originalFeedback: feedback }),
      Assessment._effectiveJudgment({ case: assessment }).is({ result }))
    .arranged(assessment)
    .form({ case: assessment, skill, label, mark, feedback, performedAt, result }),
);

// Asks the tutor to read the marked questions; nothing is saved. Every branch shares the stages that follow, so the tutor
// request lives there and repeats the ready condition: the refusal branches have already answered, and the ready branch only
// rechecks the session.
const Extract = endpoint("/courses/graded/extract", ({ session, material, owner, course, skills, confirmed, sources, materials, selected, prepared, answer, found, rows }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(no(GradedMaterial({ owner, material }))).then(respond({ error: "GRADED_MATERIAL_UNAVAILABLE" })).named("missing"),
    where(GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), compute(C.hasConfirmedSkill, { skills }, confirmed), is.among(confirmed, [false]))
      .then(respond({ error: "GRADED_SKILLS_UNAVAILABLE" })).named("unmapped"),
    where(GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), compute(C.hasConfirmedSkill, { skills }, confirmed), is.among(confirmed, [true]))
      .then(Sessioning.use({ session }).responds({ subject: owner })).named("ready"),
  )
  .then(where(GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), compute(C.hasConfirmedSkill, { skills }, confirmed), is.among(confirmed, [true]),
    Tutoring._sourceSet({ owner, scope: course }).is({ sources }), compute(C.singleMaterial, { material }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.extractRequest, { selected, skills }, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(compute(C.hasGradedRows, { answer }, found), is.among(found, [false])).then(respond({ error: "GRADED_MARKS_MISSING" })).named("total"),
    where(compute(C.hasGradedRows, { answer }, found), is.among(found, [true]), compute(C.generationFields, { answer }, { rows })).then(respond({ rows })).named("rows"),
  ), options);

// Holds when the owner already has a case for this skill with this source key.
const AlreadyImported = view("(owner) already imported (sourceKey) for (skill)", ({ owner, skill, sourceKey }, {}, { assessment }) => where(
  Assessment._cases({ author: owner, subject: skill }).is({ case: assessment }), Assessment._case({ case: assessment }).is({ sourceKey }),
)).holds();

// Imports one question. Each failing check answers in the stated order. The ready branch only rechecks the session, and the import
// stage repeats the ready conditions because it follows every branch. Every stage reads the same instant: the flow's clock is read once.
// The import stage does not read AlreadyImported again: that state can change between the stages when two confirms race, and the stage
// would then drop and leave the request unanswered. The concept's unique source key rule refuses such a race instead. After AlreadyImported
// has answered, the stage's import is refused the same way, changes nothing, and its second answer is discarded.
const Confirm = endpoint("/courses/graded/confirm", ({ session, material, performedOn, outsideHelp, row, owner, at, course, originals, skills, performedAt, skill, sourceKey,
  subject, definition, question, criteria, response, help, fresh, importedAt, mark, feedback, result, gateMet, rationale, assessment }) => {
  const reviewed = (status: GradedStatus) => [GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), now(at),
    compute(C.gradedReview, { row, outsideHelp, performedOn, at, skills }, { status })] as const;
  const ready = [GradedMaterial({ owner, material }).is({ course, originals }), Mapping._map({ course }).is({ skills }), now(at),
    compute(C.gradedReview, { row, outsideHelp, performedOn, at, skills }, { status: "READY", performedAt }), compute(C.gradedKey, { material, row }, { skill, sourceKey })] as const;
  return receive({ session, material, performedOn, outsideHelp, row })
    .then(Sessioning.use({ session }).responds({ subject: owner })).then(
      where(no(GradedMaterial({ owner, material }))).then(respond({ error: "GRADED_MATERIAL_UNAVAILABLE" })).named("missing"),
      where(...reviewed("DATE_INVALID")).then(respond({ error: "GRADED_DATE_INVALID" })).named("dateInvalid"),
      where(...reviewed("DATE_FUTURE")).then(respond({ error: "GRADED_DATE_FUTURE" })).named("dateFuture"),
      where(...reviewed("ROW_INVALID")).then(respond({ error: "GRADED_ROW_INVALID" })).named("rowInvalid"),
      where(...reviewed("UNMAPPED")).then(respond({ error: "GRADED_ROW_UNMAPPED" })).named("unmapped"),
      where(...reviewed("HELP_CONFLICT")).then(respond({ error: "GRADED_HELP_CONFLICT" })).named("helpConflict"),
      where(...reviewed("SKILL_UNAVAILABLE")).then(respond({ error: "GRADED_SKILL_UNAVAILABLE" })).named("skillUnavailable"),
      where(...ready, AlreadyImported({ owner, skill, sourceKey })).then(respond({ error: "GRADED_SOURCE_USED" })).named("used"),
      where(...ready, no(AlreadyImported({ owner, skill, sourceKey }))).then(Sessioning.use({ session }).responds({ subject: owner })).named("ready"),
    )
    .then(where(...ready,
      compute(C.gradedImport, { material, originals, row, outsideHelp, performedAt, skills },
        { subject, definition, sourceKey, question, criteria, response, help, fresh, performedAt: importedAt, mark, feedback, result, gateMet, rationale }))
      .then(Assessment.importGraded({ author: owner, subject, definition, sourceKey, question, criteria, response, help, fresh, performedAt: importedAt,
        mark, feedback, result, gateMet, rationale }).responds({ case: assessment })))
    .afterFlowSettles().then(respond({ case: assessment }));
}, { validators: { ...validators, input: confirmInput, output: structuredOutput } });

// Lists earlier imports from this material and the server's date.
const ReadImports = endpoint("/courses/graded/read", ({ session, material, owner, course, at, today }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(GradedMaterial({ owner, material }).is({ course }), now(at), compute(C.gradedToday, { at }, today))
      .then(respond({ imported: ImportedRows({ owner, material, course }), today })).named("graded"),
    where(no(GradedMaterial({ owner, material }))).then(respond({ error: "GRADED_MATERIAL_UNAVAILABLE" })).named("missing"),
  ), options);

export const composition = { GradedMaterial, ImportedRows, AlreadyImported, Extract, Confirm, ReadImports };
