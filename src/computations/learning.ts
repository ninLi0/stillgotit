import { createHash } from "node:crypto";
import type { SkillRows, SkillInfo, Sessions, StudySession, Cases, CaseInfo, Tracks, Schedule, TutorRequest } from "../learning-data.ts";
import { isMediaList } from "../concepts/GroundedTutoring/media.ts";
import type { SourceContext } from "../tutor-types.ts";
import type { Candidate } from "../concepts/StudyPlanning/StudyPlanning.ts";
import type { ResponseValue, Help } from "../concepts/AssessmentReviewing/AssessmentReviewing.ts";
import type { Channel } from "../concepts/GroundedTutoring/dialogue.ts";
const studyDate = (at: Date) => at.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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
export function progressRows({ skills, tracks }: { skills: SkillRows; tracks: Tracks }) {
  return skills.map((skill) => ({ skill: skill.skill, estimate: tracks.find((track) => track.subject === skill.skill && track.definition === skill.current)?.estimate ?? null }));
}
export function prerequisitesReady({ skills, tracks, skill }: { skills: SkillRows; tracks: Tracks; skill: string }): boolean {
  const visited = new Set<string>();
  function ready(id: string): boolean {
    if (visited.has(id)) return true;
    visited.add(id);
    const current = skills.find((row) => row.skill === id);
    return Boolean(current && current.prerequisites.every((id) => {
      const prerequisite = skills.find((row) => row.skill === id);
      return prerequisite?.status === "CONFIRMED" && tracks.some((track) => track.subject === id && track.definition === prerequisite.current && track.estimate?.ready) && ready(id);
    }));
  }
  return ready(skill);
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
export function responseInput({ data, text, channel, attachment, sources }: { data: StudySession; text: string; channel: Channel; attachment: string; sources: SourceContext[] }) {
  const attached = attachment ? sources.find((source) => source.material === attachment) : undefined;
  const valid = (!attachment || Boolean(attached)) && (Boolean(text.trim()) || Boolean(attached));
  return { valid, text, channel, media: attached?.data.originals ?? [] };
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
export function planRequest({ skills, tracks, schedule }: { skills: SkillRows; tracks: Tracks; schedule: Schedule }) {
  const day = schedule.today, horizonEnd = new Date(Date.parse(day) + 6 * 86_400_000).toISOString().slice(0, 10);
  const rows = skills.filter((skill) => skill.status === "CONFIRMED").map((skill) => ({ ...skill,
    track: tracks.find((track) => track.subject === skill.skill && track.definition === skill.current) ?? null }));
  const prior = schedule.plans.flatMap((plan) => [...plan.items.map((item) => item.candidate), ...plan.deferred]);
  const done = new Set(schedule.plans.flatMap((plan) => plan.items.filter((item) => item.status === "DONE").map((item) => item.candidate.key)));
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const informative = row.track?.inputs.filter((input) => input.signal === "SLIP" || input.signal === "GAP" || (input.fresh && ["INDEPENDENT", "SUPPORTED"].includes(input.signal))) ?? [];
    const latest = informative.at(-1), successfulDays = new Set<string>();
    for (const input of informative) { if (input.signal === "SLIP" || input.signal === "GAP") successfulDays.clear(); if (input.signal === "INDEPENDENT") successfulDays.add(studyDate(input.performedAt)); }
    const interval = latest?.signal === "INDEPENDENT" ? [1, 3, 7][Math.min(2, Math.max(0, successfulDays.size - 1))]! : 1;
    const earliestDay = latest ? studyDate(new Date(latest.performedAt.getTime() + interval * 86_400_000)) : day;
    if (earliestDay > horizonEnd) continue;
    const occasion = earliestDay < day ? day : earliestDay;
    const prefix = `${row.skill}:${row.current}:${latest?.evidence ?? "initial"}:${latest?.revision ?? 0}:`;
    const key = prior.find((candidate) => candidate.key.startsWith(prefix) && candidate.latestDay >= day)?.key ?? `${prefix}${occasion}`;
    if (done.has(key)) continue;
    candidates.push(prior.find((candidate) => candidate.key === key) ?? { key, subject: row.skill, definition: row.current,
      activity: row.track ? `Fresh check: ${row.title}` : `Set confidence and try ${row.title}`,
      minutes: 10, priority: 100 - (row.track?.estimate?.value ?? 0), earliestDay: earliestDay > day ? earliestDay : day,
      latestDay: horizonEnd, reason: row.track?.estimate?.ready ? "A later fresh check will test retention." : "This skill needs fresh independent evidence.", examRefs: [] });
  }
  const basis = createHash("sha256").update(JSON.stringify({ day, skills: rows.map((row) => [row.skill, row.current, row.track && {
    track: row.track.track, inputs: row.track.inputs, initialConfidence: row.track.initialConfidence, startingBasis: row.track.startingBasis, initializedAt: row.track.initializedAt,
  }]) })).digest("hex");
  return { candidates, horizonEnd, basis, explanation: "Ten-minute activities ordered by estimated need. Successful independent practice on later days extends the review interval from one to three to seven days. These are prototype settings." };
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
