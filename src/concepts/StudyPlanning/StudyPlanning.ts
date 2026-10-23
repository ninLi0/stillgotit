import { type Collection, type Db, MongoServerError } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import * as refusal from "./refusals.ts";

export type Learner = string;
export type Scope = string;
export type Subject = string;
export type Definition = string;
export type Preferences = string;
export type Plan = string;
export type Item = string;
export type Exam = string;
export type SubjectSet = string[];
export type PlanStatus = "PROPOSED" | "ACTIVE" | "SUPERSEDED" | "DECLINED";
export type ItemStatus = "TODO" | "IN_PROGRESS" | "DONE" | "MISSED" | "STOPPED" | "REPLACED";
export interface Candidate {
  key: string; subject: Subject; definition: Definition; activity: string; minutes: number; priority: number;
  earliestDay: string; latestDay: string; reason: string; examRefs: Exam[];
}
export type CandidateList = Candidate[];
export interface CutValue { exam: Exam; candidateKey: string; omittedScope: string; minutes: number; reason: string; consequence: string }
interface ExamData { exam: Exam; date: string; covered: SubjectSet; active: boolean }
interface ItemData { item: Item; candidate: Candidate; day: string; status: ItemStatus; actualMinutes: number; spentOn?: string }
export interface PlanInputs { today: string; dailyMinutes: number; focusNote: string; exams: ExamData[]; work: ItemData[] }
interface PlanData {
  plan: Plan; status: PlanStatus; basis: string; inputs: PlanInputs; horizonEnd: string; explanation: string;
  focusExam?: Exam; examUrgent: boolean; workloadComplete: boolean; estimatedExamMinutes: number; availableExamMinutes: number;
  deferred: CandidateList; examCuts: CutValue[]; needsConfirmation: boolean; items: ItemData[];
}
interface PreferencesData { preferences: Preferences; scope: Scope; dailyMinutes: number; focusNote: string; approvedExamCuts: CutValue[]; exams: ExamData[]; plans: PlanData[] }
interface LearnerDocument { _id: Learner; revision: number; preferences: PreferencesData[] }
const blank = (value: unknown) => typeof value !== "string" || !value.trim();
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nextDay = (value: string) => new Date(Date.parse(value) + 86_400_000).toISOString().slice(0, 10);
const priority = (a: Candidate, b: Candidate) => b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const ordered = (a: ItemData, b: ItemData) => a.day.localeCompare(b.day) || priority(a.candidate, b.candidate);
const allItems = (record: LearnerDocument) => record.preferences.flatMap((prefs) => prefs.plans.flatMap((plan) => plan.items));
const inProgress = (record: LearnerDocument) => allItems(record).some((item) => item.status === "IN_PROGRESS");
const spent = (prefs: PreferencesData, day: string) => prefs.plans.flatMap((plan) => plan.items)
  .reduce((sum, item) => sum + (item.spentOn === day ? item.actualMinutes : 0), 0);

/** A learner document makes plan replacement and the single-current-activity rule atomic. */
export class StudyPlanning {
  private readonly learners: Collection<LearnerDocument>;
  constructor(database: Db, name = "StudyPlanning", private readonly today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })) {
    this.learners = database.collection(`${name.toLowerCase()}.learners`);
  }
  async configure({ learner, scope, dailyMinutes, focusNote }: { learner: Learner; scope: Scope; dailyMinutes: number; focusNote: string }): Promise<{ preferences: Preferences }> {
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes > 1440 || typeof focusNote !== "string") throw new refusal.InvalidDailyBudget();
    return this.#edit(learner, (record) => {
      let prefs = record.preferences.find((p) => p.scope === scope);
      if (!prefs) { prefs = { preferences: crypto.randomUUID(), scope, dailyMinutes, focusNote, approvedExamCuts: [], exams: [], plans: [] }; record.preferences.push(prefs); }
      else { prefs.dailyMinutes = dailyMinutes; prefs.focusNote = focusNote; }
      return { preferences: prefs.preferences };
    });
  }
  async setExam({ learner, scope, date, covered }: { learner: Learner; scope: Scope; date: string; covered: SubjectSet }): Promise<{ exam: Exam }> {
    return this.#edit(learner, (record) => {
      const prefs = record.preferences.find((p) => p.scope === scope);
      if (!prefs) throw new refusal.ExamPreferencesUnavailable();
      if (!validDay(date) || date < this.today() || !Array.isArray(covered) || !covered.length || covered.some(blank) || new Set(covered).size !== covered.length) throw new refusal.InvalidExamDetails();
      let exam = prefs.exams.find((item) => item.date === date);
      if (!exam) { exam = { exam: crypto.randomUUID(), date, covered: [...covered], active: true }; prefs.exams.push(exam); }
      else { exam.covered = [...covered]; exam.active = true; }
      return { exam: exam.exam };
    });
  }
  async removeExam({ learner, scope, date }: { learner: Learner; scope: Scope; date: string }): Promise<{ exam: Exam }> {
    return this.#edit(learner, (record) => {
      const exam = record.preferences.find((p) => p.scope === scope)?.exams.find((item) => item.date === date);
      if (!exam) throw new refusal.ExamRemoveUnavailable();
      exam.active = false; return { exam: exam.exam };
    });
  }
  async replan({ learner, scope, candidates, horizonEnd, explanation, basis, workloadComplete }: {
    learner: Learner; scope: Scope; candidates: CandidateList; horizonEnd: string; explanation: string; basis: string; workloadComplete: boolean;
  }): Promise<{ plan: Plan }> {
    const values = structuredClone(candidates);
    return this.#edit(learner, (record) => {
      const prefs = record.preferences.find((p) => p.scope === scope), today = this.today();
      if (!prefs) throw new refusal.PlanPreferencesUnavailable();
      if (inProgress(record)) throw new refusal.PlanSessionInProgress();
      const exams = prefs.exams.filter((exam) => exam.active && exam.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const focus = exams[0], previous = prefs.plans.flatMap((plan) => [...plan.items.map((item) => item.candidate), ...plan.deferred]);
      const done = new Set(prefs.plans.flatMap((plan) => plan.items.filter((item) => item.status === "DONE").map((item) => item.candidate.key)));
      if (!validDay(horizonEnd) || horizonEnd < today || blank(explanation) || blank(basis) || typeof workloadComplete !== "boolean" ||
        !Array.isArray(values) || new Set(values.map((c) => c.key)).size !== values.length ||
        (focus && nextDay(horizonEnd) < focus.date) || values.some((c) => !validCandidate(c) || done.has(c.key) ||
          c.examRefs.some((id) => !exams.some((exam) => exam.exam === id)) || previous.some((p) => p.key === c.key && !isDeepStrictEqual(p, c))) ||
        (focus && previous.some((c) => c.examRefs.includes(focus.exam) && !done.has(c.key) && !values.some((item) => item.key === c.key)))) {
        throw new refusal.InvalidPlanInput();
      }
      const inputs = this.#inputs(prefs), focusWork = values.filter((c) => focus && c.examRefs.includes(focus.exam));
      const estimatedExamMinutes = focusWork.reduce((sum, c) => sum + c.minutes, 0);
      let availableExamMinutes = 0;
      if (focus) for (let day = today; day < focus.date; day = nextDay(day)) availableExamMinutes += Math.max(0, prefs.dailyMinutes - spent(prefs, day));
      const examUrgent = Boolean(focus && estimatedExamMinutes > availableExamMinutes), remaining = values.slice().sort(priority), items: ItemData[] = [];
      for (let day = today; day <= horizonEnd; day = nextDay(day)) {
        let capacity = Math.max(0, prefs.dailyMinutes - spent(prefs, day));
        for (const candidate of [...remaining]) {
          if (day < candidate.earliestDay || day > candidate.latestDay || candidate.minutes > capacity ||
            candidate.examRefs.some((id) => day >= exams.find((exam) => exam.exam === id)!.date) ||
            (examUrgent && day < focus!.date && !candidate.examRefs.includes(focus!.exam))) continue;
          items.push({ item: crypto.randomUUID(), candidate, day, status: "TODO", actualMinutes: 0 });
          remaining.splice(remaining.indexOf(candidate), 1); capacity -= candidate.minutes;
        }
      }
      const examCuts: CutValue[] = remaining.filter((c) => focus && c.examRefs.includes(focus.exam)).map((candidate) => ({
        exam: focus!.exam, candidateKey: candidate.key, omittedScope: candidate.activity, minutes: candidate.minutes,
        reason: "This activity does not fit before the exam within its dates and the available budget.",
        consequence: `No scheduled preparation for: ${candidate.activity}`,
      })).sort((a, b) => a.exam.localeCompare(b.exam) || a.candidateKey.localeCompare(b.candidateKey));
      const needsConfirmation = examCuts.some((cut) => !prefs.approvedExamCuts.some((approved) => approved.exam === cut.exam &&
        approved.candidateKey === cut.candidateKey && approved.omittedScope === cut.omittedScope && approved.consequence === cut.consequence && approved.minutes >= cut.minutes));
      for (const plan of prefs.plans) if (plan.status === "PROPOSED") plan.status = "SUPERSEDED";
      const plan = crypto.randomUUID();
      prefs.plans.push({ plan, status: "PROPOSED", basis, inputs, horizonEnd, explanation: explanation +
        (workloadComplete ? "" : " The workload estimate is incomplete; more preparation may be needed."),
        ...(focus ? { focusExam: focus.exam } : {}), examUrgent, workloadComplete, estimatedExamMinutes, availableExamMinutes,
        deferred: remaining, examCuts, needsConfirmation, items });
      return { plan };
    });
  }
  async activateRoutine(input: { learner: Learner; plan: Plan; currentBasis: string }): Promise<{ plan: Plan }> { return this.#activate(input, false); }
  async confirmTradeoffs(input: { learner: Learner; plan: Plan; currentBasis: string }): Promise<{ plan: Plan }> { return this.#activate(input, true); }
  async declineTradeoffs({ learner, plan }: { learner: Learner; plan: Plan }): Promise<{ plan: Plan }> {
    return this.#edit(learner, (record) => {
      const selected = record.preferences.flatMap((p) => p.plans).find((p) => p.plan === plan && p.status === "PROPOSED");
      if (!selected) throw new refusal.PlanDeclineUnavailable();
      selected.status = "DECLINED"; return { plan };
    });
  }
  async begin({ learner, item }: { learner: Learner; item: Item }): Promise<{ item: Item }> {
    return this.#edit(learner, (record) => {
      const found = findItem(record, item);
      if (!found || found.item.status !== "TODO" || found.plan.status !== "ACTIVE") throw new refusal.ActivityBeginUnavailable();
      if (inProgress(record)) throw new refusal.AnotherActivityInProgress();
      if (found.item.day !== this.today()) throw new refusal.ActivityNotScheduledToday();
      if (found.item.candidate.minutes > Math.max(0, found.prefs.dailyMinutes - spent(found.prefs, this.today()))) throw new refusal.ActivityExceedsRemainingBudget();
      found.item.status = "IN_PROGRESS"; return { item };
    });
  }
  async finish(input: { learner: Learner; item: Item; actualMinutes: number }): Promise<{ item: Item }> { return this.#end(input, true); }
  async stop(input: { learner: Learner; item: Item; actualMinutes: number }): Promise<{ item: Item }> { return this.#end(input, false); }
  async miss({ learner, item }: { learner: Learner; item: Item }): Promise<{ item: Item }> {
    return this.#edit(learner, (record) => {
      const found = findItem(record, item);
      if (!found || found.item.status !== "TODO" || found.plan.status !== "ACTIVE") throw new refusal.ActivityMissUnavailable();
      if (found.item.day > this.today()) throw new refusal.ActivityMissTooEarly();
      found.item.status = "MISSED"; return { item };
    });
  }
  async _preferences({ learner, scope }: { learner: Learner; scope: Scope }) {
    const p = (await this.learners.findOne({ _id: learner }))?.preferences.find((p) => p.scope === scope);
    return p ? [{ preferences: p.preferences, dailyMinutes: p.dailyMinutes, focusNote: p.focusNote }] : [];
  }
  async _schedule({ learner, scope }: { learner: Learner; scope: Scope }) {
    const prefs = (await this.learners.findOne({ _id: learner }))?.preferences.find((p) => p.scope === scope);
    return { schedule: { preferences: prefs ? { preferences: prefs.preferences, dailyMinutes: prefs.dailyMinutes, focusNote: prefs.focusNote } : null,
      budget: (await this._budget({ learner, scope, day: this.today() })).at(0) ?? null,
      next: (await this._next({ learner, scope })).at(0) ?? null, today: this.today(), plans: prefs?.plans ?? [],
      // Active exams only, including ones whose date has passed; dates are unique within a scope.
      exams: (prefs?.exams ?? []).filter((exam) => exam.active).sort((a, b) => a.date.localeCompare(b.date))
        .map(({ exam, date, covered }) => ({ exam, date, covered })) } };
  }
  async _item({ item }: { item: Item }) {
    const record = await this.learners.findOne({ "preferences.plans.items.item": item });
    for (const prefs of record?.preferences ?? []) for (const plan of prefs.plans) {
      const found = plan.items.find((entry) => entry.item === item);
      if (found) return [{ learner: record!._id, scope: prefs.scope, ...found }];
    }
    return [];
  }
  async _exams({ learner, scope }: { learner: Learner; scope: Scope }): Promise<ExamData[]> {
    return (await this.learners.findOne({ _id: learner }))?.preferences.find((p) => p.scope === scope)?.exams.sort((a, b) => a.date.localeCompare(b.date) || a.exam.localeCompare(b.exam)) ?? [];
  }
  async _plans({ learner, scope }: { learner: Learner; scope: Scope }) {
    return (await this.learners.findOne({ _id: learner }))?.preferences.find((p) => p.scope === scope)?.plans.sort((a, b) => a.plan.localeCompare(b.plan))
      .map(({ plan, status, horizonEnd, needsConfirmation }) => ({ plan, status, horizonEnd, needsConfirmation })) ?? [];
  }
  async _plan({ plan }: { plan: Plan }) {
    const found = await this.#findPlan(plan);
    if (!found) return [];
    const { items, deferred, examCuts: _, ...fields } = found.plan;
    const { plan: __, ...rest } = fields;
    return [{ learner: found.record._id, scope: found.prefs.scope, ...rest,
      scheduledMinutes: items.reduce((s, i) => s + i.candidate.minutes, 0), deferredMinutes: deferred.reduce((s, c) => s + c.minutes, 0) }];
  }
  async _items({ plan }: { plan: Plan }): Promise<ItemData[]> { return (await this.#findPlan(plan))?.plan.items.sort(ordered) ?? []; }
  async _next({ learner, scope }: { learner: Learner; scope: Scope }) {
    const prefs = (await this.learners.findOne({ _id: learner }))?.preferences.find((p) => p.scope === scope);
    const all = prefs?.plans.flatMap((p) => p.items) ?? [];
    const item = all.find((i) => i.status === "IN_PROGRESS") ?? prefs?.plans.find((p) => p.status === "ACTIVE")?.items
      .filter((i) => i.status === "TODO" && i.day >= this.today()).sort(ordered)[0];
    return item ? [{ item: item.item, candidate: item.candidate, day: item.day, status: item.status }] : [];
  }
  async _budget({ learner, scope, day }: { learner: Learner; scope: Scope; day: string }) {
    const p = (await this.learners.findOne({ _id: learner }))?.preferences.find((p) => p.scope === scope);
    return p ? [{ dailyMinutes: p.dailyMinutes, spentMinutes: spent(p, day), remainingMinutes: Math.max(0, p.dailyMinutes - spent(p, day)) }] : [];
  }
  async _deferred({ plan }: { plan: Plan }): Promise<{ candidate: Candidate }[]> { return (await this.#findPlan(plan))?.plan.deferred.map((candidate) => ({ candidate })) ?? []; }
  async _cuts({ plan }: { plan: Plan }): Promise<{ cut: CutValue }[]> { return (await this.#findPlan(plan))?.plan.examCuts.map((cut) => ({ cut })) ?? []; }
  async _proposalCheck({ learner, plan, currentBasis }: { learner: Learner; plan: Plan; currentBasis: string }) {
    const found = await this.#findPlan(plan);
    if (!found || found.record._id !== learner || found.plan.status !== "PROPOSED") return [];
    const locallyCurrent = isDeepStrictEqual(found.plan.inputs, this.#inputs(found.prefs)), contextCurrent = found.plan.basis === currentBasis, sessionInProgress = inProgress(found.record);
    return [{ locallyCurrent, contextCurrent, sessionInProgress, needsConfirmation: found.plan.needsConfirmation, canActivate: locallyCurrent && contextCurrent && !sessionInProgress }];
  }
  #inputs(prefs: PreferencesData): PlanInputs {
    return structuredClone({ today: this.today(), dailyMinutes: prefs.dailyMinutes, focusNote: prefs.focusNote,
      exams: prefs.exams.filter((e) => e.active).sort((a, b) => a.exam.localeCompare(b.exam)),
      work: prefs.plans.flatMap((p) => p.items).filter((i) => ["DONE", "STOPPED", "MISSED"].includes(i.status)).sort((a, b) => a.item.localeCompare(b.item)) });
  }
  async #findPlan(plan: Plan) {
    const record = await this.learners.findOne({ "preferences.plans.plan": plan });
    const prefs = record?.preferences.find((p) => p.plans.some((value) => value.plan === plan));
    const selected = prefs?.plans.find((value) => value.plan === plan);
    return record && prefs && selected ? { record, prefs, plan: selected } : undefined;
  }
  async #activate({ learner, plan, currentBasis }: { learner: Learner; plan: Plan; currentBasis: string }, confirmation: boolean) {
    return this.#edit(learner, (record) => {
      const prefs = record.preferences.find((p) => p.plans.some((value) => value.plan === plan)), selected = prefs?.plans.find((value) => value.plan === plan);
      if (!selected || selected.status !== "PROPOSED") throw confirmation ? new refusal.TradeoffPlanUnavailable() : new refusal.RoutinePlanUnavailable();
      if (inProgress(record)) throw confirmation ? new refusal.TradeoffSessionInProgress() : new refusal.RoutineSessionInProgress();
      if (selected.basis !== currentBasis || !isDeepStrictEqual(selected.inputs, this.#inputs(prefs!))) throw confirmation ? new refusal.TradeoffPlanOutdated() : new refusal.RoutinePlanOutdated();
      if (selected.needsConfirmation && !confirmation) throw new refusal.ExamTradeoffConfirmationRequired();
      if (!selected.needsConfirmation && confirmation) throw new refusal.TradeoffConfirmationNotNeeded();
      for (const old of prefs!.plans) if (old.status === "ACTIVE") {
        old.status = "SUPERSEDED";
        for (const item of old.items) if (item.status === "TODO") item.status = item.day < this.today() ? "MISSED" : "REPLACED";
      }
      selected.status = "ACTIVE"; prefs!.approvedExamCuts = structuredClone(selected.examCuts); return { plan };
    });
  }
  async #end({ learner, item, actualMinutes }: { learner: Learner; item: Item; actualMinutes: number }, finished: boolean) {
    return this.#edit(learner, (record) => {
      const found = findItem(record, item);
      if (!found || found.item.status !== "IN_PROGRESS") throw finished ? new refusal.ActivityFinishUnavailable() : new refusal.ActivityStopUnavailable();
      if (!Number.isFinite(actualMinutes) || actualMinutes < 0) throw finished ? new refusal.InvalidFinishTime() : new refusal.InvalidStopTime();
      found.item.status = finished ? "DONE" : "STOPPED"; found.item.actualMinutes = actualMinutes; found.item.spentOn = this.today(); return { item };
    });
  }
  async #edit<T>(learner: Learner, change: (record: LearnerDocument) => T): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const saved = await this.learners.findOne({ _id: learner }), record = saved ?? { _id: learner, revision: 0, preferences: [] };
      const result = change(record), revision = record.revision; record.revision++;
      if (saved) { if ((await this.learners.replaceOne({ _id: learner, revision }, record)).matchedCount) return result; }
      else try { await this.learners.insertOne(record); return result; } catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw error; }
    }
    throw new Error("The study plan changed. Read the current plan and try again.");
  }
}
function validCandidate(c: Candidate) {
  return c && ![c.key, c.subject, c.definition, c.activity, c.reason].some(blank) && Number.isFinite(c.minutes) && c.minutes > 0 &&
    Number.isFinite(c.priority) && validDay(c.earliestDay) && validDay(c.latestDay) && c.earliestDay <= c.latestDay &&
    Array.isArray(c.examRefs) && !c.examRefs.some(blank) && new Set(c.examRefs).size === c.examRefs.length;
}
function findItem(record: LearnerDocument, id: Item) {
  for (const prefs of record.preferences) for (const plan of prefs.plans) {
    const item = plan.items.find((value) => value.item === id);
    if (item) return { prefs, plan, item };
  }
}
