import type { Collection, Db, Filter } from "mongodb";
import { isMediaList, nonblank, type MediaList } from "../../media.ts";
import { effectiveVoice, type Session, type Mode, type Channel, type PassageSet, type MaterialSet, type DialogueTurn, type SessionDocument } from "./dialogue.ts";
import * as refusal from "./refusals.ts";

/**
 * The GroundedTutoring concept: lessons and practice tasks that cite material identities, with their dialogue, hints,
 * and transcript review. The materials themselves are kept elsewhere; this concept stores only their identities.
 */
export class GroundedTutoring<Learner extends string = string, Material extends string = string, Topic extends string = string, Definition extends string = string> {
  private readonly sessions: Collection<SessionDocument<Learner, Material, Topic, Definition>>;

  constructor(database: Db, name = "GroundedTutoring", private readonly clock = () => new Date()) {
    this.sessions = database.collection(`${name.toLowerCase()}.sessions`);
  }

  async explain(input: { owner: Learner; topic: Topic; definition: Definition; request: string; explanation: string; materials: MaterialSet<Material>; citations: PassageSet<Material> }): Promise<{ lesson: Session }> {
    const value = structuredClone(input);
    if (!nonblank(value.request) || !nonblank(value.explanation) || !nonblank(value.topic) || !nonblank(value.definition)) throw new refusal.InvalidLessonContent();
    if (!this.#validSources(value.owner, value.materials, value.citations)) throw new refusal.InvalidLessonSources();
    const lesson = timeOrderedId(this.clock()) as Session;
    await this.sessions.insertOne({ _id: lesson, ...value, materials: [...value.materials], citations: [...value.citations],
      kind: "LESSON", status: "OPEN", dialogue: [], checkedVoiceTurns: [], revision: 0 });
    return { lesson };
  }

  async prepareTask(input: { owner: Learner; topic: Topic; definition: Definition; question: string; criteria: string; materials: MaterialSet<Material>; citations: PassageSet<Material>; mode: Mode; fresh: boolean }): Promise<{ task: Session }> {
    const value = structuredClone(input);
    if (!nonblank(value.question) || !nonblank(value.criteria) || !["GUIDED", "CHECK"].includes(value.mode) || typeof value.fresh !== "boolean") throw new refusal.InvalidTaskContent();
    if (!this.#validSources(value.owner, value.materials, value.citations)) throw new refusal.InvalidTaskSources();
    const task = timeOrderedId(this.clock()) as Session;
    await this.sessions.insertOne({ _id: task, ...value, materials: [...value.materials], citations: [...value.citations],
      kind: "PRACTICE", status: "OPEN", hintRequested: false, dialogue: [], checkedVoiceTurns: [], revision: 0 });
    return { task };
  }

  async respond(input: { owner: Learner; session: Session; text: string; media: MediaList; channel: Channel }): Promise<Record<string, never>> {
    const value = structuredClone(input);
    return this.#edit(value.owner, value.session, undefined, refusal.ResponseSessionUnavailable, (record) => {
      if (!isMediaList(value.media) || !["TEXT", "VOICE"].includes(value.channel) || typeof value.text !== "string" ||
        (!nonblank(value.text) && !value.media.length) || (value.channel === "VOICE" && !nonblank(value.text))) throw new refusal.InvalidLearnerResponse();
      record.dialogue.push({ speaker: "LEARNER", purpose: "RESPONSE", text: value.text, media: value.media, channel: value.channel, citations: [], at: this.clock() });
    });
  }

  async answerLesson(input: { owner: Learner; lesson: Session; text: string; citations: PassageSet<Material>; channel: Channel }): Promise<Record<string, never>> {
    const value = structuredClone(input);
    const record = await this.sessions.findOne({ _id: value.lesson, owner: value.owner, kind: "LESSON", status: "OPEN" });
    if (!record) throw new refusal.LessonAnswerUnavailable();
    if (!nonblank(value.text) || !["TEXT", "VOICE"].includes(value.channel) || !this.#validSources(value.owner, record.materials, value.citations)) throw new refusal.InvalidLessonAnswer();
    return this.#edit(value.owner, value.lesson, "LESSON", refusal.LessonAnswerUnavailable, (current) => {
      current.dialogue.push({ speaker: "TUTOR", purpose: "EXPLANATION", text: value.text, media: [], channel: value.channel, citations: value.citations, at: this.clock() });
    });
  }

  async requestHint({ owner, task }: { owner: Learner; task: Session }): Promise<Record<string, never>> {
    return this.#edit(owner, task, "PRACTICE", refusal.HintRequestUnavailable, (record) => { record.hintRequested = true; });
  }

  async giveHint({ owner, task, text, channel }: { owner: Learner; task: Session; text: string; channel: Channel }): Promise<Record<string, never>> {
    return this.#edit(owner, task, "PRACTICE", refusal.HintTaskUnavailable, (record) => {
      if (!nonblank(text) || !["TEXT", "VOICE"].includes(channel)) throw new refusal.InvalidHintText();
      if (record.mode === "CHECK" && !record.hintRequested) throw new refusal.HintNotRequested();
      record.dialogue.push({ speaker: "TUTOR", purpose: "HINT", text, media: [], channel, citations: [], at: this.clock() });
      record.hintRequested = false;
    });
  }

  async confirmTranscript({ owner, session, turnIndex, text }: { owner: Learner; session: Session; turnIndex: number; text: string }): Promise<Record<string, never>> {
    return this.#edit(owner, session, undefined, refusal.TranscriptSessionUnavailable, (record) => {
      const turn = record.dialogue[turnIndex];
      if (!Number.isInteger(turnIndex) || !turn || turn.speaker !== "LEARNER" || turn.purpose !== "RESPONSE" || turn.channel !== "VOICE") throw new refusal.TranscriptTurnUnavailable();
      if (!nonblank(text)) throw new refusal.InvalidConfirmedTranscript();
      const effective = effectiveVoice(record).find((item) => item.turnIndex === turnIndex)!;
      if (effective.text !== text) record.dialogue.push({ speaker: "LEARNER", purpose: "CORRECTION", text, media: [], channel: "TEXT", citations: [], at: this.clock(), correctionTarget: turnIndex });
      if (!record.checkedVoiceTurns.includes(turnIndex)) record.checkedVoiceTurns.push(turnIndex);
    });
  }

  async confirmAttempt({ owner, task, dialogueLength, unseen, outsideHelp }: { owner: Learner; task: Session; dialogueLength: number; unseen?: boolean; outsideHelp?: boolean }): Promise<Record<string, never>> {
    return this.#edit(owner, task, "PRACTICE", refusal.AttemptReviewUnavailable, (record) => {
      if (record.dialogue.length !== dialogueLength) throw new refusal.AttemptReviewChanged();
      record.checkedVoiceTurns = effectiveVoice(record).map((turn) => turn.turnIndex);
      if (typeof unseen === "boolean" && typeof outsideHelp === "boolean") record.attemptReview = { dialogueLength, unseen, outsideHelp };
    });
  }

  async close({ owner, session }: { owner: Learner; session: Session }): Promise<Record<string, never>> {
    return this.#edit(owner, session, undefined, refusal.SessionCloseUnavailable, (record) => { record.status = "CLOSED"; });
  }

  async _sessions({ owner, topic }: { owner: Learner; topic: Topic }) {
    requireIdentity(owner); requireIdentity(topic);
    return (await this.sessions.find({ owner, topic }).sort({ _id: 1 }).toArray())
      .map(({ _id, definition, status }) => ({ session: _id, definition, status }));
  }
  async _session({ session }: { session: Session }) {
    requireIdentity(session);
    const record = await this.sessions.findOne({ _id: session });
    return record ? [{ owner: record.owner, topic: record.topic, definition: record.definition, status: record.status }] : [];
  }
  async _lesson({ lesson }: { lesson: Session }) {
    requireIdentity(lesson);
    const record = await this.sessions.findOne({ _id: lesson, kind: "LESSON" });
    return record ? [{ request: record.request!, explanation: record.explanation! }] : [];
  }
  async _task({ task }: { task: Session }) {
    requireIdentity(task);
    const record = await this.sessions.findOne({ _id: task, kind: "PRACTICE" });
    return record ? [{ question: record.question!, criteria: record.criteria!, mode: record.mode!, fresh: record.fresh!, hintRequested: record.hintRequested! }] : [];
  }
  async _sources({ session }: { session: Session }) {
    requireIdentity(session);
    return (await this.sessions.findOne({ _id: session }))?.materials.slice().sort().map((material) => ({ material })) ?? [];
  }
  async _citations({ session }: { session: Session }) {
    requireIdentity(session);
    return (await this.sessions.findOne({ _id: session }))?.citations.slice().sort((a, b) => a.material.localeCompare(b.material) || a.location.localeCompare(b.location))
      .map((citation) => ({ citation })) ?? [];
  }
  async _dialogue({ session }: { session: Session }) {
    requireIdentity(session);
    return (await this.sessions.findOne({ _id: session }))?.dialogue.map((turn, turnIndex) => ({ turnIndex, turn })) ?? [];
  }
  async _voiceResponses({ session }: { session: Session }) {
    requireIdentity(session);
    const record = await this.sessions.findOne({ _id: session });
    return record ? effectiveVoice(record) : [];
  }
  async _review({ task }: { task: Session }) {
    requireIdentity(task);
    const record = await this.sessions.findOne({ _id: task, kind: "PRACTICE" });
    if (!record) return [];
    const uncheckedVoiceCount = effectiveVoice(record).filter((turn) => !turn.confirmed).length;
    return [{ dialogueLength: record.dialogue.length, uncheckedVoiceCount, ready: record.status === "OPEN" && uncheckedVoiceCount === 0 &&
      record.dialogue.some((turn) => turn.speaker === "LEARNER" && turn.purpose === "RESPONSE") }];
  }

  async _study({ owner, topic }: { owner: Learner; topic: Topic }) {
    const records = await this.sessions.find({ owner, topic }).sort({ _id: 1 }).toArray();
    // Session identities are time-ordered, so identity order is the order sessions were started. Sessions saved before
    // that change have random identities. They stay first, in identity order, so a new session never moves them.
    records.sort((a, b) => Number(isTimeOrdered(a._id)) - Number(isTimeOrdered(b._id)));
    return { sessions: records.map((record) => this.#sessionData(record)) };
  }

  async _sessionData({ session }: { session: Session }) {
    const record = await this.sessions.findOne({ _id: session });
    return record ? [{ data: this.#sessionData(record) }] : [];
  }

  /**
   * At most `limit` of the owner's sessions in the given topics, most recently active first. A session's activity is its
   * latest turn's time, or, before its first turn, the time it started, which its identity records. Sessions whose
   * identity records no time and that have no turn come last; ties keep the newest start first.
   */
  async _recent({ owner, topics, limit }: { owner: Learner; topics: readonly Topic[]; limit: number }) {
    requireIdentity(owner);
    if (!Array.isArray(topics) || !topics.every((topic) => nonblank(topic)) || !Number.isInteger(limit) || limit < 0) throw new TypeError("Provide a list of topic identities and a whole limit.");
    if (!topics.length || !limit) return [];
    // The filter is cast because the driver's types cannot match $in against a generic identity type.
    const filter = { owner, topic: { $in: [...topics] } } as Filter<SessionDocument<Learner, Material, Topic, Definition>>;
    // Only the latest turn is read, since its time is all the order needs.
    const records = await this.sessions.find(filter, { projection: { topic: 1, status: 1, dialogue: { $slice: -1 } } }).toArray();
    const activity = (record: (typeof records)[number]) => record.dialogue.at(-1)?.at.getTime() ?? startedAt(record._id) ?? -Infinity;
    return records.map((record) => ({ record, at: activity(record) }))
      .sort((a, b) => b.at - a.at || (a.record._id < b.record._id ? 1 : a.record._id > b.record._id ? -1 : 0))
      .slice(0, limit)
      .map(({ record }) => ({ session: record._id, topic: record.topic, status: record.status }));
  }

  #sessionData(record: SessionDocument<Learner, Material, Topic, Definition>) {
    const voice = effectiveVoice(record);
    return { session: record._id, owner: record.owner, topic: record.topic, definition: record.definition, status: record.status,
      materials: record.materials, citations: record.citations,
      lesson: record.kind === "LESSON" ? { request: record.request!, explanation: record.explanation! } : null,
      task: record.kind === "PRACTICE" ? { question: record.question!, criteria: record.criteria!, mode: record.mode!, fresh: record.fresh!, hintRequested: record.hintRequested! } : null,
      dialogue: record.dialogue.map((turn, turnIndex) => ({ turnIndex, turn })), voice,
      review: record.kind === "PRACTICE" ? { dialogueLength: record.dialogue.length, uncheckedVoiceCount: voice.filter((turn) => !turn.confirmed).length,
        ready: record.status === "OPEN" && voice.every((turn) => turn.confirmed) && record.dialogue.some((turn) => turn.speaker === "LEARNER" && turn.purpose === "RESPONSE") } : null };
  }

  /**
   * The source rule that this concept can check alone. Ownership of the materials, their belonging to one scope,
   * and whether each citation's location exists in its material are checked before the values reach this concept.
   */
  #validSources(owner: Learner, materials: MaterialSet<Material>, citations: PassageSet<Material>): boolean {
    return nonblank(owner) && Array.isArray(materials) && materials.length > 0 && materials.every(nonblank) && new Set(materials).size === materials.length &&
      Array.isArray(citations) && citations.length > 0 &&
      citations.every((item) => item && nonblank(item.material) && nonblank(item.location) && materials.includes(item.material)) &&
      new Set(citations.map((item) => JSON.stringify(item))).size === citations.length;
  }

  async #edit(owner: Learner, session: Session, kind: "LESSON" | "PRACTICE" | undefined, Unavailable: new () => Error,
    change: (record: SessionDocument<Learner, Material, Topic, Definition>) => void): Promise<Record<string, never>> {
    requireIdentity(owner); requireIdentity(session);
    for (let attempt = 0; attempt < 8; attempt++) {
      const record = await this.sessions.findOne({ _id: session, owner, status: "OPEN", ...(kind ? { kind } : {}) });
      if (!record) throw new Unavailable();
      const revision = record.revision;
      change(record); record.revision += 1;
      if ((await this.sessions.replaceOne({ _id: session, owner, revision, status: "OPEN" }, record)).matchedCount === 1) return {};
    }
    throw new Error("The conversation changed repeatedly. Read it again before continuing.");
  }
}

/** A UUID version 7: the creation time comes first, so identities sort in the order they were made. */
function timeOrderedId(at: Date): string {
  const time = Math.max(0, at.getTime()).toString(16).padStart(12, "0").slice(-12), random = crypto.randomUUID();
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(15, 18)}-${random.slice(19)}`;
}

function isTimeOrdered(id: string): boolean { return id[14] === "7"; }

/** When a session started, in milliseconds, read from its time-ordered identity; null for an identity that records no time. */
function startedAt(id: string): number | null { return isTimeOrdered(id) ? parseInt(id.replace(/-/g, "").slice(0, 12), 16) : null; }

function requireIdentity(value: unknown): asserts value is string {
  if (!nonblank(value)) throw new TypeError("Provide a nonblank identity.");
}
