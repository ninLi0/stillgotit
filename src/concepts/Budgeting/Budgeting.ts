import { type Collection, type Db, MongoServerError } from "mongodb";
import { isDeepStrictEqual } from "node:util";
import * as refusal from "./refusals.ts";

export type Owner = string;
export type Scope = string;
export type Subject = string;
export type Definition = string;
export type Preferences = string;
export type Plan = string;
export type Item = string;
export type Deadline = string;
export type SubjectSet = string[];
export type PlanStatus = "PROPOSED" | "ACTIVE" | "SUPERSEDED" | "DECLINED";
export type ItemStatus = "TODO" | "IN_PROGRESS" | "DONE" | "MISSED" | "STOPPED" | "REPLACED";
export interface Candidate {
  key: string; subject: Subject; definition: Definition; activity: string; minutes: number; priority: number;
  earliestDay: string; latestDay: string; reason: string; deadlineRefs: Deadline[];
}
export type CandidateList = Candidate[];
export interface CutValue { deadline: Deadline; candidateKey: string; omittedScope: string; minutes: number; reason: string; consequence: string }
interface DeadlineData { deadline: Deadline; date: string; covered: SubjectSet; active: boolean }
interface ItemData { item: Item; candidate: Candidate; day: string; status: ItemStatus; actualMinutes: number; spentOn?: string }
export interface PlanInputs { today: string; dailyMinutes: number; focusNote: string; deadlines: DeadlineData[]; work: ItemData[] }
/** What a plan stores. Its totals, cuts, and confirmation need are computed from these fields when read. */
interface PlanData {
  plan: Plan; status: PlanStatus; basis: string; inputs: PlanInputs; horizonEnd: string; explanation: string;
  workloadComplete: boolean; deferred: CandidateList; items: ItemData[];
}
/** A plan as the queries return it: its stored fields and the values computed from them. */
interface PlanView extends PlanData {
  focusDeadline?: Deadline; urgent: boolean; requiredMinutes: number; availableMinutes: number; cuts: CutValue[]; needsConfirmation: boolean;
}
interface PreferencesData { preferences: Preferences; scope: Scope; dailyMinutes: number; focusNote: string; deadlines: DeadlineData[]; plans: PlanData[] }
interface OwnerDocument { _id: Owner; revision: number; preferences: PreferencesData[] }
const blank = (value: unknown) => typeof value !== "string" || !value.trim();
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const nextDay = (value: string) => new Date(Date.parse(value) + 86_400_000).toISOString().slice(0, 10);
const priority = (a: Candidate, b: Candidate) => b.priority - a.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
const ordered = (a: ItemData, b: ItemData) => a.day.localeCompare(b.day) || priority(a.candidate, b.candidate);
const allItems = (record: OwnerDocument) => record.preferences.flatMap((prefs) => prefs.plans.flatMap((plan) => plan.items));
const inProgress = (record: OwnerDocument) => allItems(record).some((item) => item.status === "IN_PROGRESS");
/** The time that finished and stopped items among `items` recorded on `day`. */
const spentIn = (items: ItemData[], day: string) => items.reduce((sum, item) => sum + (item.spentOn === day ? item.actualMinutes : 0), 0);
const spent = (prefs: PreferencesData, day: string) => spentIn(prefs.plans.flatMap((plan) => plan.items), day);
/** The plan's focus deadline: the earliest deadline in its saved inputs dated on or after the inputs' planning date. */
const focusOf = (inputs: PlanInputs) => inputs.deadlines.filter((deadline) => deadline.date >= inputs.today).sort((a, b) => a.date.localeCompare(b.date))[0];

/**
 * The deadline totals of a plan, computed from its saved inputs and its candidates. The saved inputs, not the current
 * records, give the budget and the time already spent, so the totals stay as they were when the plan was proposed.
 */
function totals(inputs: PlanInputs, candidates: Candidate[]) {
  const focus = focusOf(inputs);
  if (!focus) return { focus, requiredMinutes: 0, availableMinutes: 0, urgent: false };
  const requiredMinutes = candidates.filter((c) => c.deadlineRefs.includes(focus.deadline)).reduce((sum, c) => sum + c.minutes, 0);
  let availableMinutes = 0;
  for (let day = inputs.today; day < focus.date; day = nextDay(day)) availableMinutes += Math.max(0, inputs.dailyMinutes - spentIn(inputs.work, day));
  return { focus, requiredMinutes, availableMinutes, urgent: requiredMinutes > availableMinutes };
}
/** The plan's cuts: its deferred candidates for its focus deadline, ordered by deadline and then candidate key. */
function cutsOf(plan: PlanData): CutValue[] {
  const focus = focusOf(plan.inputs);
  if (!focus) return [];
  return plan.deferred.filter((c) => c.deadlineRefs.includes(focus.deadline)).map((candidate) => ({
    deadline: focus.deadline, candidateKey: candidate.key, omittedScope: candidate.activity, minutes: candidate.minutes,
    reason: "This activity does not fit before the deadline within its dates and the available budget.",
    consequence: `No scheduled preparation for: ${candidate.activity}`,
  })).sort((a, b) => a.deadline.localeCompare(b.deadline) || a.candidateKey.localeCompare(b.candidateKey));
}
/**
 * True for a PROPOSED plan with a cut that the ACTIVE plan's cuts do not already approve. The ACTIVE plan cannot change
 * while a plan is PROPOSED, because only the PROPOSED plan can become ACTIVE.
 */
function needsConfirmation(prefs: PreferencesData, plan: PlanData) {
  if (plan.status !== "PROPOSED") return false;
  const active = prefs.plans.find((value) => value.status === "ACTIVE"), approved = active ? cutsOf(active) : [];
  return cutsOf(plan).some((cut) => !approved.some((earlier) => earlier.deadline === cut.deadline && earlier.candidateKey === cut.candidateKey &&
    earlier.omittedScope === cut.omittedScope && earlier.consequence === cut.consequence && earlier.minutes >= cut.minutes));
}
function view(prefs: PreferencesData, plan: PlanData): PlanView {
  const { focus, urgent, requiredMinutes, availableMinutes } = totals(plan.inputs, [...plan.items.map((item) => item.candidate), ...plan.deferred]);
  return { plan: plan.plan, status: plan.status, basis: plan.basis, inputs: plan.inputs, horizonEnd: plan.horizonEnd, explanation: plan.explanation,
    ...(focus ? { focusDeadline: focus.deadline } : {}), urgent, workloadComplete: plan.workloadComplete, requiredMinutes, availableMinutes,
    deferred: plan.deferred, cuts: cutsOf(plan), needsConfirmation: needsConfirmation(prefs, plan), items: plan.items };
}

/** One document per owner makes plan replacement and the single-current-activity rule atomic. */
export class Budgeting {
  private readonly owners: Collection<OwnerDocument>;
  constructor(database: Db, name = "Budgeting", private readonly today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" })) {
    // The collection keeps the name it had before this concept was renamed, so an instance's saved documents stay where they are.
    this.owners = database.collection(`${name.toLowerCase()}.learners`);
  }
  async configure({ owner, scope, dailyMinutes, focusNote }: { owner: Owner; scope: Scope; dailyMinutes: number; focusNote: string }): Promise<{ preferences: Preferences }> {
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes > 1440 || typeof focusNote !== "string") throw new refusal.InvalidDailyBudget();
    return this.#edit(owner, (record) => {
      let prefs = record.preferences.find((p) => p.scope === scope);
      if (!prefs) { prefs = { preferences: crypto.randomUUID(), scope, dailyMinutes, focusNote, deadlines: [], plans: [] }; record.preferences.push(prefs); }
      else { prefs.dailyMinutes = dailyMinutes; prefs.focusNote = focusNote; }
      return { preferences: prefs.preferences };
    });
  }
  async setDeadline({ owner, scope, date, covered }: { owner: Owner; scope: Scope; date: string; covered: SubjectSet }): Promise<{ deadline: Deadline }> {
    return this.#edit(owner, (record) => {
      const prefs = record.preferences.find((p) => p.scope === scope);
      if (!prefs) throw new refusal.DeadlinePreferencesUnavailable();
      if (!validDay(date) || date < this.today() || !Array.isArray(covered) || !covered.length || covered.some(blank) || new Set(covered).size !== covered.length) throw new refusal.InvalidDeadlineDetails();
      let deadline = prefs.deadlines.find((item) => item.date === date);
      if (!deadline) { deadline = { deadline: crypto.randomUUID(), date, covered: [...covered], active: true }; prefs.deadlines.push(deadline); }
      else { deadline.covered = [...covered]; deadline.active = true; }
      return { deadline: deadline.deadline };
    });
  }
  async removeDeadline({ owner, scope, date }: { owner: Owner; scope: Scope; date: string }): Promise<{ deadline: Deadline }> {
    return this.#edit(owner, (record) => {
      const deadline = record.preferences.find((p) => p.scope === scope)?.deadlines.find((item) => item.date === date);
      if (!deadline) throw new refusal.DeadlineRemoveUnavailable();
      deadline.active = false; return { deadline: deadline.deadline };
    });
  }
  async replan({ owner, scope, candidates, horizonEnd, explanation, basis, workloadComplete }: {
    owner: Owner; scope: Scope; candidates: CandidateList; horizonEnd: string; explanation: string; basis: string; workloadComplete: boolean;
  }): Promise<{ plan: Plan }> {
    const values = structuredClone(candidates);
    return this.#edit(owner, (record) => {
      const prefs = record.preferences.find((p) => p.scope === scope), today = this.today();
      if (!prefs) throw new refusal.PlanPreferencesUnavailable();
      if (inProgress(record)) throw new refusal.PlanSessionInProgress();
      const deadlines = prefs.deadlines.filter((deadline) => deadline.active && deadline.date >= today).sort((a, b) => a.date.localeCompare(b.date));
      const focus = deadlines[0], previous = prefs.plans.flatMap((plan) => [...plan.items.map((item) => item.candidate), ...plan.deferred]);
      const done = new Set(prefs.plans.flatMap((plan) => plan.items.filter((item) => item.status === "DONE").map((item) => item.candidate.key)));
      if (!validDay(horizonEnd) || horizonEnd < today || blank(explanation) || blank(basis) || typeof workloadComplete !== "boolean" ||
        !Array.isArray(values) || new Set(values.map((c) => c.key)).size !== values.length ||
        (focus && nextDay(horizonEnd) < focus.date) || values.some((c) => !validCandidate(c) || done.has(c.key) ||
          c.deadlineRefs.some((id) => !deadlines.some((deadline) => deadline.deadline === id)) || previous.some((p) => p.key === c.key && !isDeepStrictEqual(p, c))) ||
        (focus && previous.some((c) => c.deadlineRefs.includes(focus.deadline) && !done.has(c.key) && !values.some((item) => item.key === c.key)))) {
        throw new refusal.InvalidPlanInput();
      }
      // Allocation needs urgency before any item is placed. It is computed the same way the queries compute it later.
      const inputs = this.#inputs(prefs), { urgent } = totals(inputs, values), remaining = values.slice().sort(priority), items: ItemData[] = [];
      for (let day = today; day <= horizonEnd; day = nextDay(day)) {
        let capacity = Math.max(0, prefs.dailyMinutes - spent(prefs, day));
        for (const candidate of [...remaining]) {
          if (day < candidate.earliestDay || day > candidate.latestDay || candidate.minutes > capacity ||
            candidate.deadlineRefs.some((id) => day >= deadlines.find((deadline) => deadline.deadline === id)!.date) ||
            (urgent && day < focus!.date && !candidate.deadlineRefs.includes(focus!.deadline))) continue;
          items.push({ item: crypto.randomUUID(), candidate, day, status: "TODO", actualMinutes: 0 });
          remaining.splice(remaining.indexOf(candidate), 1); capacity -= candidate.minutes;
        }
      }
      for (const plan of prefs.plans) if (plan.status === "PROPOSED") plan.status = "SUPERSEDED";
      const plan = crypto.randomUUID();
      prefs.plans.push({ plan, status: "PROPOSED", basis, inputs, horizonEnd, explanation: explanation +
        (workloadComplete ? "" : " The workload estimate is incomplete; more preparation may be needed."), workloadComplete, deferred: remaining, items });
      return { plan };
    });
  }
  async activateRoutine(input: { owner: Owner; plan: Plan; currentBasis: string }): Promise<{ plan: Plan }> { return this.#activate(input, false); }
  async confirmTradeoffs(input: { owner: Owner; plan: Plan; currentBasis: string }): Promise<{ plan: Plan }> { return this.#activate(input, true); }
  async declineTradeoffs({ owner, plan }: { owner: Owner; plan: Plan }): Promise<{ plan: Plan }> {
    return this.#edit(owner, (record) => {
      const selected = record.preferences.flatMap((p) => p.plans).find((p) => p.plan === plan && p.status === "PROPOSED");
      if (!selected) throw new refusal.PlanDeclineUnavailable();
      selected.status = "DECLINED"; return { plan };
    });
  }
  async begin({ owner, item }: { owner: Owner; item: Item }): Promise<{ item: Item }> {
    return this.#edit(owner, (record) => {
      const found = findItem(record, item);
      if (!found || found.item.status !== "TODO" || found.plan.status !== "ACTIVE") throw new refusal.ActivityBeginUnavailable();
      if (inProgress(record)) throw new refusal.AnotherActivityInProgress();
      if (found.item.day !== this.today()) throw new refusal.ActivityNotScheduledToday();
      if (found.item.candidate.minutes > Math.max(0, found.prefs.dailyMinutes - spent(found.prefs, this.today()))) throw new refusal.ActivityExceedsRemainingBudget();
      found.item.status = "IN_PROGRESS"; return { item };
    });
  }
  async finish(input: { owner: Owner; item: Item; actualMinutes: number }): Promise<{ item: Item }> { return this.#end(input, true); }
  async stop(input: { owner: Owner; item: Item; actualMinutes: number }): Promise<{ item: Item }> { return this.#end(input, false); }
  async miss({ owner, item }: { owner: Owner; item: Item }): Promise<{ item: Item }> {
    return this.#edit(owner, (record) => {
      const found = findItem(record, item);
      if (!found || found.item.status !== "TODO" || found.plan.status !== "ACTIVE") throw new refusal.ActivityMissUnavailable();
      if (found.item.day > this.today()) throw new refusal.ActivityMissTooEarly();
      found.item.status = "MISSED"; return { item };
    });
  }
  async _preferences({ owner, scope }: { owner: Owner; scope: Scope }) {
    const p = (await this.owners.findOne({ _id: owner }))?.preferences.find((p) => p.scope === scope);
    return p ? [{ preferences: p.preferences, dailyMinutes: p.dailyMinutes, focusNote: p.focusNote }] : [];
  }
  async _schedule({ owner, scope }: { owner: Owner; scope: Scope }) {
    const prefs = (await this.owners.findOne({ _id: owner }))?.preferences.find((p) => p.scope === scope);
    return { schedule: { preferences: prefs ? { preferences: prefs.preferences, dailyMinutes: prefs.dailyMinutes, focusNote: prefs.focusNote } : null,
      budget: (await this._budget({ owner, scope, day: this.today() })).at(0) ?? null,
      next: (await this._next({ owner, scope })).at(0) ?? null, today: this.today(), plans: prefs ? prefs.plans.map((plan) => view(prefs, plan)) : [],
      // Active deadlines only, including ones whose date has passed; dates are unique within a scope.
      deadlines: (prefs?.deadlines ?? []).filter((deadline) => deadline.active).sort((a, b) => a.date.localeCompare(b.date))
        .map(({ deadline, date, covered }) => ({ deadline, date, covered })) } };
  }
  async _item({ item }: { item: Item }) {
    const record = await this.owners.findOne({ "preferences.plans.items.item": item });
    for (const prefs of record?.preferences ?? []) for (const plan of prefs.plans) {
      const found = plan.items.find((entry) => entry.item === item);
      if (found) return [{ owner: record!._id, scope: prefs.scope, ...found }];
    }
    return [];
  }
  async _deadlines({ owner, scope }: { owner: Owner; scope: Scope }): Promise<DeadlineData[]> {
    return (await this.owners.findOne({ _id: owner }))?.preferences.find((p) => p.scope === scope)?.deadlines
      .sort((a, b) => a.date.localeCompare(b.date) || a.deadline.localeCompare(b.deadline)) ?? [];
  }
  async _plans({ owner, scope }: { owner: Owner; scope: Scope }) {
    const prefs = (await this.owners.findOne({ _id: owner }))?.preferences.find((p) => p.scope === scope);
    if (!prefs) return [];
    return prefs.plans.sort((a, b) => a.plan.localeCompare(b.plan))
      .map((value) => ({ plan: value.plan, status: value.status, horizonEnd: value.horizonEnd, needsConfirmation: needsConfirmation(prefs, value) }));
  }
  async _plan({ plan }: { plan: Plan }) {
    const found = await this.#findPlan(plan);
    if (!found) return [];
    const { plan: _, items, deferred, cuts: __, ...fields } = view(found.prefs, found.plan);
    return [{ owner: found.record._id, scope: found.prefs.scope, ...fields,
      scheduledMinutes: items.reduce((s, i) => s + i.candidate.minutes, 0), deferredMinutes: deferred.reduce((s, c) => s + c.minutes, 0) }];
  }
  async _items({ plan }: { plan: Plan }): Promise<ItemData[]> { return (await this.#findPlan(plan))?.plan.items.sort(ordered) ?? []; }
  async _next({ owner, scope }: { owner: Owner; scope: Scope }) {
    const prefs = (await this.owners.findOne({ _id: owner }))?.preferences.find((p) => p.scope === scope);
    const all = prefs?.plans.flatMap((p) => p.items) ?? [];
    const item = all.find((i) => i.status === "IN_PROGRESS") ?? prefs?.plans.find((p) => p.status === "ACTIVE")?.items
      .filter((i) => i.status === "TODO" && i.day >= this.today()).sort(ordered)[0];
    return item ? [{ item: item.item, candidate: item.candidate, day: item.day, status: item.status }] : [];
  }
  async _budget({ owner, scope, day }: { owner: Owner; scope: Scope; day: string }) {
    const p = (await this.owners.findOne({ _id: owner }))?.preferences.find((p) => p.scope === scope);
    return p ? [{ dailyMinutes: p.dailyMinutes, spentMinutes: spent(p, day), remainingMinutes: Math.max(0, p.dailyMinutes - spent(p, day)) }] : [];
  }
  async _deferred({ plan }: { plan: Plan }): Promise<{ candidate: Candidate }[]> { return (await this.#findPlan(plan))?.plan.deferred.map((candidate) => ({ candidate })) ?? []; }
  async _cuts({ plan }: { plan: Plan }): Promise<{ cut: CutValue }[]> {
    const found = await this.#findPlan(plan);
    return found ? cutsOf(found.plan).map((cut) => ({ cut })) : [];
  }
  async _proposalCheck({ owner, plan, currentBasis }: { owner: Owner; plan: Plan; currentBasis: string }) {
    const found = await this.#findPlan(plan);
    if (!found || found.record._id !== owner || found.plan.status !== "PROPOSED") return [];
    const locallyCurrent = isDeepStrictEqual(found.plan.inputs, this.#inputs(found.prefs)), contextCurrent = found.plan.basis === currentBasis, sessionInProgress = inProgress(found.record);
    return [{ locallyCurrent, contextCurrent, sessionInProgress, needsConfirmation: needsConfirmation(found.prefs, found.plan), canActivate: locallyCurrent && contextCurrent && !sessionInProgress }];
  }
  #inputs(prefs: PreferencesData): PlanInputs {
    return structuredClone({ today: this.today(), dailyMinutes: prefs.dailyMinutes, focusNote: prefs.focusNote,
      deadlines: prefs.deadlines.filter((d) => d.active).sort((a, b) => a.deadline.localeCompare(b.deadline)),
      work: prefs.plans.flatMap((p) => p.items).filter((i) => ["DONE", "STOPPED", "MISSED"].includes(i.status)).sort((a, b) => a.item.localeCompare(b.item)) });
  }
  async #findPlan(plan: Plan) {
    const record = await this.owners.findOne({ "preferences.plans.plan": plan });
    const prefs = record?.preferences.find((p) => p.plans.some((value) => value.plan === plan));
    const selected = prefs?.plans.find((value) => value.plan === plan);
    return record && prefs && selected ? { record, prefs, plan: selected } : undefined;
  }
  async #activate({ owner, plan, currentBasis }: { owner: Owner; plan: Plan; currentBasis: string }, confirmation: boolean) {
    return this.#edit(owner, (record) => {
      const prefs = record.preferences.find((p) => p.plans.some((value) => value.plan === plan)), selected = prefs?.plans.find((value) => value.plan === plan);
      if (!selected || selected.status !== "PROPOSED") throw confirmation ? new refusal.TradeoffPlanUnavailable() : new refusal.RoutinePlanUnavailable();
      if (inProgress(record)) throw confirmation ? new refusal.TradeoffSessionInProgress() : new refusal.RoutineSessionInProgress();
      if (selected.basis !== currentBasis || !isDeepStrictEqual(selected.inputs, this.#inputs(prefs!))) throw confirmation ? new refusal.TradeoffPlanOutdated() : new refusal.RoutinePlanOutdated();
      // Compared with the ACTIVE plan's cuts before that plan is superseded. Once selected is ACTIVE, its own cuts are the approved ones.
      const needed = needsConfirmation(prefs!, selected);
      if (needed && !confirmation) throw new refusal.DeadlineTradeoffConfirmationRequired();
      if (!needed && confirmation) throw new refusal.TradeoffConfirmationNotNeeded();
      for (const old of prefs!.plans) if (old.status === "ACTIVE") {
        old.status = "SUPERSEDED";
        for (const item of old.items) if (item.status === "TODO") item.status = item.day < this.today() ? "MISSED" : "REPLACED";
      }
      selected.status = "ACTIVE"; return { plan };
    });
  }
  async #end({ owner, item, actualMinutes }: { owner: Owner; item: Item; actualMinutes: number }, finished: boolean) {
    return this.#edit(owner, (record) => {
      const found = findItem(record, item);
      if (!found || found.item.status !== "IN_PROGRESS") throw finished ? new refusal.ActivityFinishUnavailable() : new refusal.ActivityStopUnavailable();
      if (!Number.isFinite(actualMinutes) || actualMinutes < 0) throw finished ? new refusal.InvalidFinishTime() : new refusal.InvalidStopTime();
      found.item.status = finished ? "DONE" : "STOPPED"; found.item.actualMinutes = actualMinutes; found.item.spentOn = this.today(); return { item };
    });
  }
  async #edit<T>(owner: Owner, change: (record: OwnerDocument) => T): Promise<T> {
    for (let attempt = 0; attempt < 8; attempt++) {
      const saved = await this.owners.findOne({ _id: owner }), record = saved ?? { _id: owner, revision: 0, preferences: [] };
      const result = change(record), revision = record.revision; record.revision++;
      if (saved) { if ((await this.owners.replaceOne({ _id: owner, revision }, record)).matchedCount) return result; }
      else try { await this.owners.insertOne(record); return result; } catch (error) { if (!(error instanceof MongoServerError && error.code === 11000)) throw error; }
    }
    throw new Error("The plan changed. Read the current plan and try again.");
  }
}
function validCandidate(c: Candidate) {
  return c && ![c.key, c.subject, c.definition, c.activity, c.reason].some(blank) && Number.isFinite(c.minutes) && c.minutes > 0 &&
    Number.isFinite(c.priority) && validDay(c.earliestDay) && validDay(c.latestDay) && c.earliestDay <= c.latestDay &&
    Array.isArray(c.deadlineRefs) && !c.deadlineRefs.some(blank) && new Set(c.deadlineRefs).size === c.deadlineRefs.length;
}
function findItem(record: OwnerDocument, id: Item) {
  for (const prefs of record.preferences) for (const plan of prefs.plans) {
    const item = plan.items.find((value) => value.item === id);
    if (item) return { prefs, plan, item };
  }
}
