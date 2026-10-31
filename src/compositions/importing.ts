import { endpoint, receive, respond, type EndpointValidator } from "@mit-sdg/sync-engine/boundary";
import { compute, each, former, is, no, now, view, where, whether } from "@mit-sdg/sync-engine/language";
import { concepts, computations as C } from "../concepts.ts";
import type { GradedStatus } from "../computations/importing.ts";
import { composition as Courses } from "./courses.ts";
import { usingTutorChoice } from "./settings.ts";
import { structuredInput, structuredOutput, validators } from "./reusable/inputs.ts";
const { Sessioning, SkillMapping: Mapping, Library, AssessmentReviewing: Assessment, TutorGenerating: AI } = concepts;

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
  Library._material({ material }).is({ owner, scope: course, title, originals }), Courses.OwnedCourse({ owner, course }),
  compute(C.gradedTitle, { title }, graded), is.among(graded, [true]),
)).optional();

// The owner's imported cases from this material's paper, read skill by skill in its course, ordered by case identity. A source
// key names the paper, or the material for a question imported before keys named the paper.
const ImportedRows = former("the imports from (material) with (originals) for (owner) in (course)", ({ owner, material, originals, course }, { unit, skill, assessment, performedAt, sourceKey, fromMaterial, label, mark, feedback, result }) =>
  each(Mapping._units({ course }).is({ unit }))
    .where(Mapping._skills({ unit }).is({ skill }), Assessment._cases({ author: owner, subject: skill }).is({ case: assessment, performedAt, imported: true }),
      Assessment._case({ case: assessment }).is({ sourceKey }), compute(C.gradedSource, { sourceKey, material, originals }, fromMaterial), is.among(fromMaterial, [true]),
      Assessment._work({ case: assessment }).is({ question: label, originalMark: mark, originalFeedback: feedback }),
      Assessment._effectiveJudgment({ case: assessment }).is({ result }))
    .arranged(assessment)
    .form({ case: assessment, skill, label, mark, feedback, performedAt, result }),
);

// The questions of this material's paper that the owner imported from another upload in its course, with that upload's
// material and the time each question was imported, which is when its first judgment was recorded. A case's work keeps the
// originals of the upload it was imported from, so this also finds questions imported before source keys named the paper.
const ImportedElsewhere = view("(owner) imported the paper of graded work (material) from (earlier) at (importedAt)", ({ owner, material }, { earlier, importedAt },
  { course, originals, unit, skill, assessment, response }) => where(
  GradedMaterial({ owner, material }).is({ course, originals }),
  Mapping._units({ course }).is({ unit }), Mapping._skills({ unit }).is({ skill }),
  Assessment._cases({ author: owner, subject: skill }).is({ case: assessment, imported: true }),
  Assessment._work({ case: assessment }).is({ response }),
  compute(C.gradedElsewhere, { material, originals, response }, { found: true, from: earlier }),
  Assessment._judgments({ case: assessment }).is({ revision: 1, recordedAt: importedAt }),
));

// Holds when the owner already imported this paper's marks from another upload. Request admission declines Extract and Confirm then.
const PaperImported = view("(owner) imported the paper of graded work (material) from another upload", ({ owner, material }) => where(
  ImportedElsewhere({ owner, material }),
)).holds();

// Those imports, oldest first, each with the other upload's title while it is kept; a deleted upload has no title.
const EarlierImports = former("the imports of the paper of (material) for (owner) from other uploads", ({ owner, material }, { earlier, importedAt, title }) =>
  each(ImportedElsewhere({ owner, material }).is({ earlier, importedAt }))
    .where(whether(Library._material({ material: earlier }).is({ owner, title })))
    .arranged(importedAt)
    .form({ material: earlier, title, importedAt }),
);

// Asks the tutor to read the marked questions; nothing is saved. Every branch shares the stages that follow, so the tutor
// request lives there and repeats the ready condition: the refusal branches have already answered, and the ready branch only
// rechecks the session.
const Extract = endpoint("/courses/graded/extract", ({ session, material, owner, course, skills, confirmed, sources, materials, selected, draft, choice, status, prepared, answer, found, rows }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(no(GradedMaterial({ owner, material }))).then(respond({ error: "GRADED_MATERIAL_UNAVAILABLE" })).named("missing"),
    where(GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), compute(C.hasConfirmedSkill, { skills }, confirmed), is.among(confirmed, [false]))
      .then(respond({ error: "GRADED_SKILLS_UNAVAILABLE" })).named("unmapped"),
    where(GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), compute(C.hasConfirmedSkill, { skills }, confirmed), is.among(confirmed, [true]))
      .then(Sessioning.use({ session }).responds({ subject: owner })).named("ready"),
  )
  .then(where(GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), compute(C.hasConfirmedSkill, { skills }, confirmed), is.among(confirmed, [true]),
    Library._sourceSet({ owner, scope: course }).is({ sources }), compute(C.singleMaterial, { material }, materials),
    compute(C.selectSources, { sources, materials }, { selected, valid: true }), compute(C.extractRequest, { selected, skills }, draft),
    ...usingTutorChoice(owner, draft, choice, status, prepared))
    .then(AI.generate({ owner, request: prepared }).responds({ answer })))
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(compute(C.hasGradedRows, { answer }, found), is.among(found, [false])).then(respond({ error: "GRADED_MARKS_MISSING" })).named("total"),
    where(compute(C.hasGradedRows, { answer }, found), is.among(found, [true]), compute(C.generationFields, { answer }, { rows })).then(respond({ rows })).named("rows"),
  ), options);

// Holds when the owner already has a case for this skill under one of the question's keys: its source key, or the key that named
// the material before keys named the paper.
const AlreadyImported = view("(owner) already imported a question under one of (keys) for (skill)", ({ owner, skill, keys }, {}, { assessment, sourceKey, used }) => where(
  Assessment._cases({ author: owner, subject: skill }).is({ case: assessment }), Assessment._case({ case: assessment }).is({ sourceKey }),
  compute(C.gradedKeyUsed, { sourceKey, keys }, used), is.among(used, [true]),
)).holds();

// Imports one question. Each failing check answers in the stated order. The ready branch only rechecks the session, and the import
// stage repeats the ready conditions because it follows every branch. Every stage reads the same instant: the flow's clock is read once.
// The import stage does not read AlreadyImported for the source key again: that state can change between the stages when two confirms
// race, and the stage would then drop and leave the request unanswered. The concept's unique source key rule refuses such a race instead.
// After AlreadyImported has answered, the stage's import is refused the same way, changes nothing, and its second answer is discarded.
// The concept cannot refuse a question saved under the key that named the material, before keys named the paper, so the import stage
// reads AlreadyImported for that key alone. No import writes that key any more, so this read cannot change between the stages.
// Request admission declines a paper already imported from another upload (PaperImported) before this endpoint runs. The endpoint
// does not read that view, which every branch and the import stage would each read again; the source key names the paper, so the
// concept refuses the same question from the same files whichever upload sends it.
const Confirm = endpoint("/courses/graded/confirm", ({ session, material, performedOn, outsideHelp, row, owner, at, course, originals, skills, performedAt, skill, keys,
  materialKeys, subject, definition, sourceKey, question, criteria, response, help, fresh, importedAt, mark, feedback, result, gateMet, rationale, assessment }) => {
  const reviewed = (status: GradedStatus) => [GradedMaterial({ owner, material }).is({ course }), Mapping._map({ course }).is({ skills }), now(at),
    compute(C.gradedReview, { row, outsideHelp, performedOn, at, skills }, { status })] as const;
  const ready = [GradedMaterial({ owner, material }).is({ course, originals }), Mapping._map({ course }).is({ skills }), now(at),
    compute(C.gradedReview, { row, outsideHelp, performedOn, at, skills }, { status: "READY", performedAt }), compute(C.gradedKey, { material, originals, row }, { skill, keys, materialKeys })] as const;
  return receive({ session, material, performedOn, outsideHelp, row })
    .then(Sessioning.use({ session }).responds({ subject: owner })).then(
      where(no(GradedMaterial({ owner, material }))).then(respond({ error: "GRADED_MATERIAL_UNAVAILABLE" })).named("missing"),
      where(...reviewed("DATE_INVALID")).then(respond({ error: "GRADED_DATE_INVALID" })).named("dateInvalid"),
      where(...reviewed("DATE_FUTURE")).then(respond({ error: "GRADED_DATE_FUTURE" })).named("dateFuture"),
      where(...reviewed("ROW_INVALID")).then(respond({ error: "GRADED_ROW_INVALID" })).named("rowInvalid"),
      where(...reviewed("UNMAPPED")).then(respond({ error: "GRADED_ROW_UNMAPPED" })).named("unmapped"),
      where(...reviewed("HELP_CONFLICT")).then(respond({ error: "GRADED_HELP_CONFLICT" })).named("helpConflict"),
      where(...reviewed("SKILL_UNAVAILABLE")).then(respond({ error: "GRADED_SKILL_UNAVAILABLE" })).named("skillUnavailable"),
      where(...ready, AlreadyImported({ owner, skill, keys })).then(respond({ error: "GRADED_SOURCE_USED" })).named("used"),
      where(...ready, no(AlreadyImported({ owner, skill, keys }))).then(Sessioning.use({ session }).responds({ subject: owner })).named("ready"),
    )
    .then(where(...ready, no(AlreadyImported({ owner, skill, keys: materialKeys })),
      compute(C.gradedImport, { material, originals, row, outsideHelp, performedAt, skills },
        { subject, definition, sourceKey, question, criteria, response, help, fresh, performedAt: importedAt, mark, feedback, result, gateMet, rationale }))
      .then(Assessment.importGraded({ author: owner, subject, definition, sourceKey, question, criteria, response, help, fresh, performedAt: importedAt,
        mark, feedback, result, gateMet, rationale }).responds({ case: assessment })))
    .afterFlowSettles().then(respond({ case: assessment }));
}, { validators: { ...validators, input: confirmInput, output: structuredOutput } });

// Lists earlier imports from this material's paper, the server's date, and the imports of the same paper from other uploads.
const ReadImports = endpoint("/courses/graded/read", ({ session, material, owner, course, originals, at, today }) => receive({ session, material })
  .then(Sessioning.use({ session }).responds({ subject: owner })).then(
    where(GradedMaterial({ owner, material }).is({ course, originals }), now(at), compute(C.gradedToday, { at }, today))
      .then(respond({ imported: ImportedRows({ owner, material, originals, course }), today, earlier: EarlierImports({ owner, material }) })).named("graded"),
    where(no(GradedMaterial({ owner, material }))).then(respond({ error: "GRADED_MATERIAL_UNAVAILABLE" })).named("missing"),
  ), options);

export const composition = { GradedMaterial, ImportedRows, ImportedElsewhere, PaperImported, EarlierImports, AlreadyImported, Extract, Confirm, ReadImports };
