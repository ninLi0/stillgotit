import { type Collection, type Db, MongoServerError } from "mongodb";
import * as refusal from "./refusals.ts";

export type Author = string;
export type Subject = string;
export type Definition = string;
export type Task = string;
export type Case = string;
export type Judgment = string;
export type Result = "INDEPENDENT" | "SUPPORTED" | "SLIP" | "GAP" | "UNCERTAIN";
export type Help = "NONE" | "HINT" | "UNKNOWN";
export type Origin = "AI" | "MANUAL";
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface ResponseValue { text: string; attachments: JsonValue[]; conversation: JsonValue[]; citations: JsonValue[]; reviewedDialogueLength: number }
export interface ClarificationValue { text: string; attachments: JsonValue[]; originalWorkOnly: boolean }
interface Work {
  author: Author; subject: Subject; definition: Definition; sourceKey: string; question: string; criteria: string;
  response: ResponseValue; help: Help; fresh: boolean; performedAt: Date;
}
interface JudgmentData { judgment: Judgment; revision: number; result: Result; gateMet: boolean; rationale: string; origin: Origin; recordedAt: Date }
interface CaseDocument extends Work {
  _id: Case; task?: Task; imported: boolean; originalMark: string; originalFeedback: string;
  clarifications: ClarificationValue[]; judgments: JudgmentData[]; revision: number;
}
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const results: Result[] = ["INDEPENDENT", "SUPPORTED", "SLIP", "GAP", "UNCERTAIN"];
const duplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;

/** Cases and their append-only judgments share a document so each action is atomic. */
export class AssessmentReviewing {
  private readonly cases: Collection<CaseDocument>;
  private indexes: Promise<unknown> | undefined;
  constructor(database: Db, name = "AssessmentReviewing", private readonly clock = () => new Date()) {
    this.cases = database.collection(`${name.toLowerCase()}.cases`);
  }
  #ready() {
    return this.indexes ??= this.cases.createIndexes([
      { key: { author: 1, subject: 1, sourceKey: 1 }, unique: true },
      { key: { task: 1 }, unique: true, partialFilterExpression: { task: { $type: "string" } } },
    ]).catch((error: unknown) => { this.indexes = undefined; throw error; });
  }

  async submit(input: Work & { task: Task }): Promise<{ case: Case }> {
    const value = structuredClone(input);
    if (!this.#validWork(value) || !nonblank(value.task)) throw new refusal.InvalidAssessmentWork();
    await this.#ready();
    if (await this.cases.findOne({ author: value.author, subject: value.subject, sourceKey: value.sourceKey })) throw new refusal.AssessmentSourceUsed();
    if (await this.cases.findOne({ task: value.task })) throw new refusal.AssessmentTaskUsed();
    const id = crypto.randomUUID();
    try {
      await this.cases.insertOne({ _id: id, ...value, imported: false, originalMark: "", originalFeedback: "", clarifications: [], judgments: [], revision: 0 });
    } catch (error) {
      if (!duplicate(error)) throw error;
      if (await this.cases.findOne({ author: value.author, subject: value.subject, sourceKey: value.sourceKey })) throw new refusal.AssessmentSourceUsed();
      if (await this.cases.findOne({ task: value.task })) throw new refusal.AssessmentTaskUsed();
      throw error;
    }
    return { case: id };
  }

  async assess({ case: id, result, gateMet, rationale }: { case: Case; result: Result; gateMet: boolean; rationale: string }): Promise<{ judgment: Judgment }> {
    const record = await this.cases.findOne({ _id: id });
    if (!record) throw new refusal.AssessmentCaseUnavailable();
    if (record.judgments.length) throw new refusal.AssessmentAlreadyJudged();
    if (!validJudgment(record, result, gateMet, rationale)) throw new refusal.InvalidInitialJudgment();
    const judgment: JudgmentData = { judgment: crypto.randomUUID(), revision: 1, result, gateMet, rationale, origin: "AI", recordedAt: this.clock() };
    const update = await this.cases.updateOne({ _id: id, revision: record.revision, "judgments.0": { $exists: false } },
      { $push: { judgments: judgment }, $inc: { revision: 1 } });
    if (!update.matchedCount) {
      if ((await this.cases.findOne({ _id: id }))?.judgments.length) throw new refusal.AssessmentAlreadyJudged();
      // A clarification changed the case. The caller must grade the current record.
      throw new Error("The assessment context changed. Read it again before grading.");
    }
    return { judgment: judgment.judgment };
  }

  async importGraded(input: Work & { mark: string; feedback: string; result: Result; gateMet: boolean; rationale: string }): Promise<{ case: Case; judgment: Judgment }> {
    const value = structuredClone(input);
    if (!this.#validWork(value) || !nonblank(value.mark) || !nonblank(value.rationale) || typeof value.feedback !== "string") throw new refusal.InvalidGradedWork();
    await this.#ready();
    if (await this.cases.findOne({ author: value.author, subject: value.subject, sourceKey: value.sourceKey })) throw new refusal.GradedSourceUsed();
    if (!validJudgment(value, value.result, value.gateMet, value.rationale)) throw new refusal.InvalidImportedJudgment();
    const { mark, feedback, result, gateMet, rationale, ...work } = value;
    const id = crypto.randomUUID(), judgment: JudgmentData = { judgment: crypto.randomUUID(), revision: 1, result, gateMet, rationale, origin: "AI", recordedAt: this.clock() };
    try { await this.cases.insertOne({ _id: id, ...work, imported: true, originalMark: mark, originalFeedback: feedback, clarifications: [], judgments: [judgment], revision: 0 }); }
    catch (error) {
      if (duplicate(error) && await this.cases.findOne({ author: work.author, subject: work.subject, sourceKey: work.sourceKey })) throw new refusal.GradedSourceUsed();
      throw error;
    }
    return { case: id, judgment: judgment.judgment };
  }

  async clarify({ author, case: id, clarification }: { author: Author; case: Case; clarification: ClarificationValue }): Promise<Record<string, never>> {
    if (!await this.cases.findOne({ _id: id, author })) throw new refusal.ClarificationCaseUnavailable();
    if (!clarification || !Array.isArray(clarification.attachments) || (!nonblank(clarification.text) && !clarification.attachments.length) || clarification.originalWorkOnly !== true) {
      throw new refusal.InvalidWorkClarification();
    }
    await this.cases.updateOne({ _id: id, author }, { $push: { clarifications: structuredClone(clarification) }, $inc: { revision: 1 } });
    return {};
  }

  async revise({ author, case: id, basedOn, result, gateMet, rationale, origin }: {
    author: Author; case: Case; basedOn: Judgment; result: Result; gateMet: boolean; rationale: string; origin: Origin;
  }): Promise<{ judgment: Judgment }> {
    const record = await this.cases.findOne({ _id: id, author });
    if (!record) throw new refusal.RevisionCaseUnavailable();
    const previous = record.judgments.at(-1);
    if (!previous || previous.judgment !== basedOn) throw new refusal.JudgmentRevisionOutdated();
    if (!validJudgment(record, result, gateMet, rationale) || !["AI", "MANUAL"].includes(origin)) throw new refusal.InvalidRevisedJudgment();
    const judgment: JudgmentData = { judgment: crypto.randomUUID(), revision: previous.revision + 1, result, gateMet, rationale, origin, recordedAt: this.clock() };
    const update = await this.cases.updateOne({ _id: id, author, revision: record.revision }, { $push: { judgments: judgment }, $inc: { revision: 1 } });
    if (!update.matchedCount) throw new refusal.JudgmentRevisionOutdated();
    return { judgment: judgment.judgment };
  }

  async _cases({ author, subject }: { author: Author; subject: Subject }) {
    return (await this.cases.find({ author, subject }).sort({ performedAt: 1, _id: 1 }).toArray())
      .map(({ _id, definition, performedAt, imported }) => ({ case: _id, definition, performedAt, imported }));
  }
  async _case({ case: id }: { case: Case }) {
    const record = await this.cases.findOne({ _id: id });
    if (!record) return [];
    const { author, subject, definition, sourceKey, task, help, fresh, performedAt, imported } = record;
    return [{ author, subject, definition, sourceKey, ...(task === undefined ? {} : { task }), help, fresh, performedAt, imported }];
  }
  async _work({ case: id }: { case: Case }) {
    const record = await this.cases.findOne({ _id: id });
    return record ? [{ question: record.question, criteria: record.criteria, response: record.response, originalMark: record.originalMark, originalFeedback: record.originalFeedback }] : [];
  }
  async _clarifications({ case: id }: { case: Case }) {
    return (await this.cases.findOne({ _id: id }))?.clarifications.map((clarification, index) => ({ index, clarification })) ?? [];
  }
  async _judgments({ case: id }: { case: Case }): Promise<JudgmentData[]> { return (await this.cases.findOne({ _id: id }))?.judgments ?? []; }
  async _judgment({ judgment }: { judgment: Judgment }) {
    const record = await this.cases.findOne({ "judgments.judgment": judgment });
    const found = record?.judgments.find((item) => item.judgment === judgment);
    if (!record || !found) return [];
    const { judgment: _, ...data } = found;
    return [{ case: record._id, ...data }];
  }
  async _effectiveJudgment({ case: id }: { case: Case }): Promise<JudgmentData[]> {
    const judgment = (await this.cases.findOne({ _id: id }))?.judgments.at(-1);
    return judgment ? [judgment] : [];
  }
  async _byTask({ author, task }: { author: Author; task: Task }): Promise<{ case: Case }[]> {
    const record = await this.cases.findOne({ author, task });
    return record ? [{ case: record._id }] : [];
  }

  async _history({ author, subject }: { author: Author; subject: Subject }) {
    return { cases: (await this.cases.find({ author, subject }).sort({ performedAt: 1, _id: 1 }).toArray()).map((record) => this.#caseData(record)) };
  }

  async _caseData({ case: id }: { case: Case }) {
    const record = await this.cases.findOne({ _id: id });
    return record ? [{ data: this.#caseData(record) }] : [];
  }

  #caseData(record: CaseDocument) {
    return { case: record._id, author: record.author, subject: record.subject, definition: record.definition,
      task: record.task ?? null, help: record.help, fresh: record.fresh, performedAt: record.performedAt,
      judgment: record.judgments.at(-1) ?? null, history: record.judgments, clarifications: record.clarifications,
      work: { question: record.question, criteria: record.criteria, response: record.response, originalMark: record.originalMark, originalFeedback: record.originalFeedback } };
  }

  #validWork(work: Work): boolean {
    return [work.author, work.subject, work.definition, work.sourceKey, work.question, work.criteria].every(nonblank) &&
      work.performedAt instanceof Date && Number.isFinite(work.performedAt.getTime()) && work.performedAt <= this.clock() &&
      ["NONE", "HINT", "UNKNOWN"].includes(work.help) && typeof work.fresh === "boolean" && Boolean(work.response) &&
      typeof work.response.text === "string" && Array.isArray(work.response.attachments) &&
      (nonblank(work.response.text) || work.response.attachments.length > 0) && Array.isArray(work.response.conversation) && Array.isArray(work.response.citations) &&
      Number.isInteger(work.response.reviewedDialogueLength) && work.response.reviewedDialogueLength >= 0;
  }
}

function validJudgment(work: { help: Help; fresh: boolean }, result: Result, gateMet: boolean, rationale: string) {
  return results.includes(result) && typeof gateMet === "boolean" && nonblank(rationale) &&
    (result !== "INDEPENDENT" || work.help === "NONE") && (!gateMet || (result === "INDEPENDENT" && work.fresh));
}
