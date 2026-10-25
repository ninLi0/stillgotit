import { createHash } from "node:crypto";
import type { SkillRows, SkillInfo, Sessions, StudySession, Cases, CaseInfo, Tracks, Schedule, TutorRequest } from "../learning-data.ts";
import { isMediaList } from "../media.ts";
import type { SourceContext } from "../tutor-types.ts";
import type { Candidate, CutValue } from "../concepts/StudyPlanning/StudyPlanning.ts";
import type { ResponseValue, Help } from "../concepts/AssessmentReviewing/AssessmentReviewing.ts";
import type { Channel } from "../concepts/GroundedTutoring/dialogue.ts";
import type { EstimateExplanation, ProgressRows, StartingBasis } from "../concepts/MasteryEstimating/MasteryEstimating.ts";
const studyDate = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
// Study dates are YYYY-MM-DD strings, so whole days can be added in UTC.
const addDays = (day: string, days: number) => new Date(Date.parse(day) + days * 86_400_000).toISOString().slice(0, 10);
export function selectSkill({ skills, skill }: { skills: SkillRows; skill: string }): SkillInfo {
  const result = skills.find((row) => row.skill === skill);
  if (!result) throw new Error("Unavailable skill");
  return result;
}
export function selectSources({ sources, materials }: { sources: SourceContext[]; materials: string[] }) {
  const selected = sources.filter((source) => materials.includes(source.material));
  return { selected, valid: materials.length > 0 && new Set(selected.map((source) => source.material)).size === new Set(materials).size };
}
export function studyDetail({ context, tracks, sessions, cases }: { context: SkillInfo; tracks: Tracks; sessions: Sessions; cases: Cases }) {
  const track = tracks.find((row) => row.subject === context.skill && row.definition === context.current) ?? null;
  return { skill: context, track, estimate: track?.estimate ?? null, sessions, cases };
}
/** One change to the estimate, as the skill page lists it. Values stay unrounded. */
export interface TimelineChange {
  at: Date; kind: "ATTEMPT" | "ADJUSTMENT" | "TIME"; source: string;
  before: number; after: number; decay: number; days: number; reason: string;
}
/** What the skill page shows of the concept's explanation, in the concept's order. */
export interface EstimateTimeline {
  start: { at: Date; confidence: number; startingBasis: StartingBasis };
  changes: TimelineChange[];
  ignored: { evidence: string; reason: string }[];
  provisional: boolean;
  basis: string;
}
const wholeDays = (later: Date, earlier: Date) => Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
/** Selects the explanation's rows for display. It recomputes no score, decay, or readiness. */
export function estimateTimeline({ explanation, tracks }: { explanation?: EstimateExplanation | null; tracks: ProgressRows }): EstimateTimeline | null {
  if (!explanation) return null;
  const attempts = new Set(explanation.evidence.map((row) => row.evidence));
  // Adjustment identities are unique, so every track's adjustments can be searched together.
  const adjustments = new Map(tracks.flatMap((track) => track.adjustments.map((row) => [row.adjustment, row] as const)));
  let previous = explanation.replayStart;
  const changes = explanation.changes.map((change): TimelineChange => {
    const days = wholeDays(change.at, previous);
    previous = change.at;
    if (attempts.has(change.source)) {
      return { at: change.at, kind: "ATTEMPT", source: change.source, before: change.decayed, after: change.after, decay: change.before - change.decayed, days, reason: "" };
    }
    const adjustment = adjustments.get(change.source);
    if (adjustment) {
      return { at: change.at, kind: "ADJUSTMENT", source: change.source, before: change.decayed, after: change.after, decay: change.before - change.decayed, days, reason: adjustment.reason };
    }
    if (change.source === "time") {
      return { at: change.at, kind: "TIME", source: "", before: change.before, after: change.after, decay: change.before - change.after, days, reason: "" };
    }
    throw new Error("The estimate explanation names a change source that is not an attempt, an adjustment, or time.");
  });
  return {
    start: { at: explanation.replayStart, confidence: explanation.initialConfidence, startingBasis: explanation.startingBasis },
    changes, ignored: explanation.ignored.map(({ evidence, reason }) => ({ evidence, reason })),
    provisional: !changes.some((change) => change.kind === "ATTEMPT"), basis: explanation.basis,
  };
}
export function progressRows({ skills, tracks }: { skills: SkillRows; tracks: Tracks }) {
  return skills.map((skill) => ({ skill: skill.skill, estimate: tracks.find((track) => track.subject === skill.skill && track.definition === skill.current)?.estimate ?? null }));
}
// The readiness rule shared by practice admission and its explanation. A prerequisite is ready when it is a
// confirmed skill whose current version has a ready estimate and whose own prerequisites are ready. A skill
// reached again while its own check is still running counts as ready, so a cycle cannot recurse forever.
function readinessRule(skills: SkillRows, tracks: Tracks) {
  const settled = new Map<string, boolean>();
  function prerequisitesReady(id: string): boolean {
    const saved = settled.get(id);
    if (saved !== undefined) return saved;
    settled.set(id, true);
    const current = skills.find((row) => row.skill === id);
    const result = Boolean(current && current.prerequisites.every(prerequisiteReady));
    settled.set(id, result);
    return result;
  }
  function prerequisiteReady(id: string): boolean {
    const prerequisite = skills.find((row) => row.skill === id);
    return prerequisite?.status === "CONFIRMED" &&
      tracks.some((track) => track.subject === id && track.definition === prerequisite.current && track.estimate?.ready) && prerequisitesReady(id);
  }
  return { prerequisitesReady, prerequisiteReady };
}
export function prerequisitesReady({ skills, tracks, skill }: { skills: SkillRows; tracks: Tracks; skill: string }): boolean {
  return readinessRule(skills, tracks).prerequisitesReady(skill);
}
/** Names the prerequisite to work on first, following not-ready prerequisites by lowest skill identity. */
export function prerequisiteToPractice({ skills, tracks, skill }: { skills: SkillRows; tracks: Tracks; skill: string }): { found: boolean; title?: string } {
  const rule = readinessRule(skills, tracks);
  // Only a prerequisite with a skill row can be named. The concept keeps every prerequisite a skill of the same course.
  const blocking = (id: string) => (skills.find((row) => row.skill === id)?.prerequisites ?? [])
    .filter((prerequisite) => skills.some((row) => row.skill === prerequisite) && !rule.prerequisiteReady(prerequisite)).sort();
  let next = blocking(skill)[0];
  if (next === undefined) return { found: false };
  const followed = new Set([skill]);
  for (;;) {
    followed.add(next);
    const deeper = blocking(next).find((id) => !followed.has(id));
    if (deeper === undefined) return { found: true, title: skills.find((row) => row.skill === next)!.title };
    next = deeper;
  }
}
/** The request's prerequisite list as a set: distinct identities, in a fixed order that carries no meaning. */
export function prerequisiteSet({ prerequisites }: { prerequisites: readonly string[] }): readonly string[] {
  return [...new Set(prerequisites)].sort();
}
/** The current estimate of the most recently started track for an earlier version of the skill. */
export function carriedEstimate({ tracks, skill, current }: { tracks: Tracks; skill: string; current: string }): { found: boolean; confidence?: number } {
  const earlier = tracks.filter((track) => track.subject === skill && track.definition !== current)
    .sort((a, b) => a.initializedAt.getTime() - b.initializedAt.getTime() || (a.track < b.track ? -1 : a.track > b.track ? 1 : 0));
  // _progress estimates at the live clock, which is never before a saved track starts. Without an estimate
  // there is no value to carry, so no track is started.
  const estimate = earlier.at(-1)?.estimate;
  return estimate ? { found: true, confidence: estimate.value } : { found: false };
}
export function lessonRequest({ selected, context, request }: { selected: SourceContext[]; context: SkillInfo; request: string }): TutorRequest {
  return { kind: "LESSON", definition: context.current, sources: selected, context: { title: context.title, outcome: context.outcome, request }, work: [] };
}
export function taskRequest({ selected, context, sessions }: { selected: SourceContext[]; context: SkillInfo; sessions: Sessions }): TutorRequest {
  return { kind: "TASK", definition: context.current, criteria: taskCriteria(context), sources: selected, context: { title: context.title, outcome: context.outcome, gate: context.gate,
    previousQuestions: sessions.flatMap((session) => session.task ? [session.task.question] : []) }, work: [] };
}
export function sessionRequest({ selected, data, kind }: { selected: SourceContext[]; data: StudySession; kind: "REPLY" | "HINT" }): TutorRequest {
  return { kind, sources: selected, context: data, work: kind === "REPLY" ? data.dialogue.flatMap(({ turn }) => turn.media) : [] };
}
export function gradeRequest({ selected, data }: { selected: SourceContext[]; data: CaseInfo }): TutorRequest {
  return { kind: "GRADE", sources: selected, context: { ...data, ...data.work }, work: isMediaList(data.work.response.attachments) ? data.work.response.attachments : [] };
}
export function suggestRequest({ selected }: { selected: SourceContext[] }): TutorRequest {
  return { kind: "SUGGEST", sources: selected, context: {}, work: [] };
}
export function taskCriteria({ outcome, gate }: { outcome: string; gate: string }): string { return `${outcome}\nFull demonstration gate: ${gate}`; }
/** The material identities a learner attaches to one response, in the order attached. It may be empty. */
export type AttachmentList = string[];
/** Every listed material must be one of the supplied sources and appear once; one failing entry invalidates the whole response. */
export function responseInput({ data, text, channel, attachments, sources }: { data: StudySession; text: string; channel: Channel; attachments: AttachmentList; sources: SourceContext[] }) {
  const listed = Array.isArray(attachments) ? attachments : [];
  const attached = listed.map((material) => sources.find((source) => source.material === material));
  const found = attached.filter((source): source is SourceContext => source !== undefined);
  const valid = Array.isArray(attachments) && found.length === listed.length && new Set(listed).size === listed.length &&
    (Boolean(text.trim()) || listed.length > 0);
  // Media follow the list order and keep each material's own file order.
  return { valid, text, channel, media: valid ? found.flatMap((source) => source.data.originals) : [] };
}
export function dialogueIsCurrent({ data, dialogueLength }: { data: StudySession; dialogueLength: number }): boolean { return data.dialogue.length === dialogueLength; }
export function hasLessonQuestion({ data }: { data: StudySession }): boolean { return Boolean(data.lesson && data.dialogue.at(-1)?.turn.speaker === "LEARNER"); }
export function submissionInput({ data, unseen, outsideHelp }: { data: StudySession; unseen: boolean; outsideHelp: boolean }) {
  const responses = data.dialogue.filter(({ turn }) => turn.speaker === "LEARNER" && turn.purpose === "RESPONSE");
  const text = responses.map(({ turn, turnIndex }) => data.voice.find((item) => item.turnIndex === turnIndex)?.text ?? turn.text).join("\n\n");
  const response: ResponseValue = JSON.parse(JSON.stringify({ text, attachments: responses.flatMap(({ turn }) => turn.media),
    conversation: data.dialogue, citations: data.citations, reviewedDialogueLength: data.dialogue.length }));
  const help: Help = outsideHelp || data.dialogue.some(({ turn }) => turn.purpose === "HINT") ? "HINT" : "NONE";
  return { sourceKey: `practice:${data.session}`, response, help, fresh: Boolean(data.task?.fresh && unseen) };
}
export function correctionNote({ reason }: { reason: string }) { return { text: reason, attachments: [], originalWorkOnly: true }; }
export function evidenceUpdate({ data, tracks }: { data: CaseInfo; tracks: Tracks }) {
  const track = tracks.find((track) => track.subject === data.subject && track.definition === data.definition);
  const previous = track?.inputs.find((input) => input.evidence === data.case);
  return { needed: Boolean(track && data.judgment && (!previous || previous.revision < data.judgment.revision)) };
}
/** The exam the planning concept plans for: the earliest active exam dated today or later. */
function focusExam(schedule: Schedule) {
  return schedule.exams.find((exam) => exam.date >= schedule.today) ?? null;
}
/** Covered skills and their prerequisites, followed through the course map. The visited set stops cycles. */
function examSkills(skills: SkillRows, covered: readonly string[]) {
  const visited = new Set<string>(), pending = [...covered];
  while (pending.length > 0) {
    const skill = pending.pop()!;
    if (visited.has(skill)) continue;
    visited.add(skill);
    pending.push(...(skills.find((row) => row.skill === skill)?.prerequisites ?? []));
  }
  return visited;
}
// Exam preparation runs before every unrelated review. Routine priorities stay from 0 to 100.
const EXAM_PRIORITY = 1000;
/** A reusable key is the prefix followed only by the occasion date, so an adjusted key never matches an unadjusted prefix. */
const occasionKey = (key: string, prefix: string) => key.startsWith(prefix) && /^\d{4}-\d{2}-\d{2}$/.test(key.slice(prefix.length));
export function planRequest({ skills, tracks, schedule }: { skills: SkillRows; tracks: Tracks; schedule: Schedule }) {
  const day = schedule.today, focus = focusExam(schedule), weekEnd = addDays(day, 6);
  // Exam work must end before the exam day, because no exam time is stored.
  const lastStudyDay = focus ? addDays(focus.date, -1) : null;
  const horizonEnd = lastStudyDay && lastStudyDay > weekEnd ? lastStudyDay : weekEnd;
  const rows = skills.filter((skill) => skill.status === "CONFIRMED").map((skill) => ({ ...skill,
    track: tracks.find((track) => track.subject === skill.skill && track.definition === skill.current) ?? null }));
  const prior = schedule.plans.flatMap((plan) => [...plan.items.map((item) => item.candidate), ...plan.deferred]);
  const done = new Set(schedule.plans.flatMap((plan) => plan.items.filter((item) => item.status === "DONE").map((item) => item.candidate.key)));
  // A key keeps the content it was first proposed with.
  const saved = (key: string) => prior.find((candidate) => candidate.key === key);
  const forFocus = (candidate: Candidate) => focus !== null && candidate.examRefs.includes(focus.exam);
  // Carried work: unfinished preparation for the focus exam from any saved plan, once per key, unchanged.
  const candidates: Candidate[] = [];
  for (const candidate of prior) {
    if (forFocus(candidate) && !done.has(candidate.key) && !candidates.some((other) => other.key === candidate.key)) candidates.push(candidate);
  }
  const preparing = focus ? examSkills(skills, focus.covered) : new Set<string>();
  for (const row of rows) {
    const informative = row.track?.inputs.filter((input) => input.signal === "SLIP" || input.signal === "GAP" || (input.fresh && ["INDEPENDENT", "SUPPORTED"].includes(input.signal))) ?? [];
    const latest = informative.at(-1), successfulDays = new Set<string>();
    for (const input of informative) { if (input.signal === "SLIP" || input.signal === "GAP") successfulDays.clear(); if (input.signal === "INDEPENDENT") successfulDays.add(studyDate(input.performedAt)); }
    const interval = latest?.signal === "INDEPENDENT" ? [1, 3, 7][Math.min(2, Math.max(0, successfulDays.size - 1))]! : 1;
    const earliestDay = latest ? studyDate(new Date(latest.performedAt.getTime() + interval * 86_400_000)) : day;
    const occasion = earliestDay < day ? day : earliestDay;
    // The key names the evidence and, once the track has one, its latest adjustment; a reused key keeps its saved candidate.
    const evidencePrefix = `${row.skill}:${row.current}:${latest?.evidence ?? "initial"}:${latest?.revision ?? 0}:`;
    const adjustment = row.track?.adjustments.at(-1)?.adjustment;
    const prefix = adjustment ? `${evidencePrefix}${adjustment}:` : evidencePrefix;
    // Routine key reuse skips earlier work that names an exam, so a routine key never takes on exam content.
    const routineKey = prior.find((candidate) => candidate.examRefs.length === 0 && occasionKey(candidate.key, prefix) && candidate.latestDay >= day)?.key ?? `${prefix}${occasion}`;
    const need = 100 - (row.track?.estimate?.value ?? 0);
    const activity = row.track ? `Fresh check: ${row.title}` : `Set confidence and try ${row.title}`;
    const reason = row.track?.estimate?.ready ? "A later fresh check will test retention." : "This skill needs fresh independent evidence.";
    if (focus && lastStudyDay && preparing.has(row.skill) && occasion < focus.date) {
      // The exam activity, carried or new, stands for this review. Earlier work for this exam covers the skill when
      // it is unfinished for the current version, or finished for the current version and latest evidence.
      const covered = prior.some((candidate) => forFocus(candidate) && candidate.subject === row.skill && candidate.definition === row.current &&
        (!done.has(candidate.key) || candidate.key.startsWith(evidencePrefix)));
      const key = `${routineKey}:exam:${focus.exam}`;
      if (covered || done.has(key)) continue;
      candidates.push(saved(key) ?? { key, subject: row.skill, definition: row.current, activity, minutes: 10, priority: EXAM_PRIORITY + need,
        earliestDay: occasion, latestDay: lastStudyDay, reason: `Preparation for the exam on ${focus.date}. ${reason}`, examRefs: [focus.exam] });
      continue;
    }
    // Routine review, including maintenance of an exam skill whose review falls on or after the exam date. An adjustment is not
    // practice, so routine work already finished for this evidence within its window is not offered again.
    if (earliestDay > horizonEnd || done.has(routineKey) ||
      prior.some((candidate) => candidate.examRefs.length === 0 && done.has(candidate.key) && candidate.key.startsWith(evidencePrefix) && candidate.latestDay >= day)) continue;
    const kept = saved(routineKey);
    if (kept) { candidates.push(kept); continue; }
    // A new adjusted candidate keeps the evidence's current window and changes only its key, priority, and reason.
    const evidenced = adjustment ? prior.find((candidate) => candidate.examRefs.length === 0 && occasionKey(candidate.key, evidencePrefix) && candidate.latestDay >= day) ??
      prior.find((candidate) => candidate.examRefs.length === 0 && candidate.key.startsWith(evidencePrefix) && candidate.latestDay >= day) : undefined;
    candidates.push(evidenced ? { ...evidenced, key: routineKey, priority: need, reason } : { key: routineKey, subject: row.skill, definition: row.current, activity,
      minutes: 10, priority: need, earliestDay: occasion, latestDay: horizonEnd, reason, examRefs: [] });
  }
  // Exam records stay out of the fingerprint; the concept's local check covers them. Prerequisites decide the exam skills.
  const basis = createHash("sha256").update(JSON.stringify({ day, skills: rows.map((row) => [row.skill, row.current, row.prerequisites, row.track && {
    track: row.track.track, inputs: row.track.inputs, initialConfidence: row.track.initialConfidence, startingBasis: row.track.startingBasis, initializedAt: row.track.initializedAt,
    // Tracks without adjustments keep the fingerprint they had before adjustments existed.
    ...(row.track.adjustments.length ? { adjustments: row.track.adjustments } : {}),
  }]) })).digest("hex");
  const explanation = "Ten-minute activities ordered by estimated need. Successful independent practice on later days extends the review interval from one to three to seven days. These are prototype settings." +
    (focus ? ` Preparation for the exam on ${focus.date} comes first.` : "");
  return { candidates, horizonEnd, basis, explanation };
}
/** True when every covered identity names a confirmed skill of the course map and none repeats. An empty set is left to the planning concept. */
export function coveredSkillsConfirmed({ covered, skills }: { covered: string[]; skills: SkillRows }): boolean {
  return new Set(covered).size === covered.length && covered.every((skill) => skills.some((row) => row.skill === skill && row.status === "CONFIRMED"));
}
/** True when the ACTIVE plan is exam-urgent, its focus exam is still active, and the candidate prepares for that exam. */
export function urgentExamItem({ schedule, candidate }: { schedule: Schedule; candidate: Candidate }): boolean {
  const active = schedule.plans.find((plan) => plan.status === "ACTIVE"), focus = active?.focusExam;
  return Boolean(active?.examUrgent && focus && schedule.exams.some((exam) => exam.exam === focus) && candidate.examRefs.includes(focus));
}
/** Urgent exam preparation may skip the prerequisite check; every other activity keeps it. */
export function beginAllowed({ skills, tracks, skill, urgent }: { skills: SkillRows; tracks: Tracks; skill: string; urgent: boolean }): boolean {
  return urgent === true || prerequisitesReady({ skills, tracks, skill });
}
// Sort keys built from fixed-width hexadecimal compare the same way under any string ordering.
/** A finite number as 16 hex digits whose string order is the number's decreasing order. -0 counts as 0, as in the concept. */
function decreasing(value: number) {
  const bits = new DataView(new ArrayBuffer(8));
  bits.setFloat64(0, value === 0 ? 0 : value);
  let high = bits.getUint32(0), low = bits.getUint32(4);
  // Raw IEEE 754 bits of a negative number already sort after every nonnegative number, with larger magnitudes later.
  // A nonnegative number keeps a clear sign bit and flips the rest, so larger values come first.
  if (high < 0x8000_0000) { high = ~high & 0x7fff_ffff; low = ~low >>> 0; }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}
/** Each UTF-16 code unit as four hex digits, so the result keeps JavaScript's < order of the original strings. */
function codeUnits(value: string) {
  let result = "";
  for (let index = 0; index < value.length; index++) result += value.charCodeAt(index).toString(16).padStart(4, "0");
  return result;
}
/** Day, then decreasing priority, then candidate key: the order of StudyPlanning._items. */
export function itemOrder({ day, candidate }: { day: string; candidate: Candidate }): string {
  return `${day}${decreasing(candidate.priority)}${codeUnits(candidate.key)}`;
}
/** Exam identity, then candidate key: the order of StudyPlanning._cuts. */
export function cutKey({ cut }: { cut: CutValue }): string {
  return `${codeUnits(cut.exam)}${codeUnits(cut.candidateKey)}`;
}
export function planDetail({ schedule }: { schedule: Schedule }) {
  const active = schedule.plans.find((plan) => plan.status === "ACTIVE");
  return { preferences: schedule.preferences, budget: schedule.budget, next: schedule.next, today: schedule.today,
    plan: active ? { ...active, deferred: active.deferred.map((candidate) => ({ candidate })), scheduledMinutes: active.items.reduce((sum, item) => sum + item.candidate.minutes, 0), deferredMinutes: active.deferred.reduce((sum, item) => sum + item.minutes, 0) } : null };
}
export function itemSubject({ candidate }: { candidate: Candidate }) { return { skill: candidate.subject, definition: candidate.definition }; }
export function generationFields({ answer }: { answer: import("../learning-data.ts").TutorAnswer }) { return answer; }
export function selectSkillMaterials({ context }: { context: SkillInfo }) { return context.materials; }
export function sessionMaterials({ data }: { data: StudySession }) { return data.materials; }
export function reviewApproved({ reviewed, unseen, outsideHelp }: { reviewed: boolean; unseen: boolean; outsideHelp: boolean }): boolean { return reviewed === true && typeof unseen === "boolean" && typeof outsideHelp === "boolean"; }
export function generationDefinition({ request }: { request: TutorRequest }) { return { definition: request.definition ?? "", criteria: request.criteria ?? "" }; }
export function attemptIsReady({ data, dialogueLength, reviewed, unseen, outsideHelp }: { data: StudySession; dialogueLength: number; reviewed: boolean; unseen: boolean; outsideHelp: boolean }): boolean {
  return Boolean(data.task && reviewApproved({ reviewed, unseen, outsideHelp }) && data.dialogue.length === dialogueLength &&
    data.dialogue.some(({ turn }) => turn.speaker === "LEARNER" && turn.purpose === "RESPONSE"));
}

export function sessionSubject({ identity }: { identity: { subject: string } }) { return { owner: identity.subject }; }
