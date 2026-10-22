import { isDeepStrictEqual } from "node:util";
import { type Collection, type Db, MongoServerError } from "mongodb";
import { isMediaList, nonblank, type MediaList } from "./media.ts";
import { effectiveVoice, type Session, type Mode, type Channel, type PassageSet, type MaterialSet, type DialogueTurn, type SessionDocument } from "./dialogue.ts";
import * as refusal from "./refusals.ts";

export type Material = string & { readonly __brand: "Material" };
export type MaterialOrigin = "COURSE" | "REFERENCE";

export interface MaterialData<Learner extends string = string, Scope extends string = string> {
  owner: Learner;
  scope: Scope;
  title: string;
  locator: string;
  content: string;
  originals: MediaList;
  origin: MaterialOrigin;
}

export interface MaterialImport<Learner extends string = string, Scope extends string = string> extends MaterialData<Learner, Scope> {
  importKey: string;
}

interface MaterialDocument<Learner extends string, Scope extends string> extends MaterialData<Learner, Scope> {
  _id: Material;
  // Materials written before retry support have no import key.
  importKey?: string;
}

export class InvalidTutoringMaterial extends Error {
  readonly code = "INVALID_TUTORING_MATERIAL";

  constructor() {
    super("Provide a title, source location, and readable material.");
    this.name = "InvalidTutoringMaterial";
  }
}

export class InvalidMaterialImportKey extends Error {
  readonly code = "INVALID_MATERIAL_IMPORT_KEY";

  constructor() {
    super("Provide a nonblank import key.");
    this.name = "InvalidMaterialImportKey";
  }
}

export class MaterialImportConflict extends Error {
  readonly code = "MATERIAL_IMPORT_CONFLICT";

  constructor() {
    super("Use the original material input for this import key.");
    this.name = "MaterialImportConflict";
  }
}

/** Material storage from GroundedTutoring. Lesson and practice methods follow in later steps. */
export class GroundedTutoring<Learner extends string = string, Scope extends string = string, Topic extends string = string, Definition extends string = string> {
  private readonly materials: Collection<MaterialDocument<Learner, Scope>>;
  private readonly sessions: Collection<SessionDocument<Learner, Topic, Definition>>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "GroundedTutoring", private readonly clock = () => new Date()) {
    this.materials = database.collection(`${name.toLowerCase()}.materials`, {
      readPreference: "primary", readConcern: { level: "majority" }, writeConcern: { w: "majority", j: true },
    });
    this.sessions = database.collection(`${name.toLowerCase()}.sessions`);
  }

  #ready() {
    this.indexes ??= this.materials.createIndexes([
      { key: { owner: 1, scope: 1, _id: 1 } },
      { key: { owner: 1, importKey: 1 }, unique: true, partialFilterExpression: { importKey: { $type: "string" } } },
    ]).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  async addMaterial(input: MaterialImport<Learner, Scope>): Promise<{ material: Material }> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new InvalidTutoringMaterial();
    const { owner, importKey, scope, title, locator, content, originals, origin } = input;
    // The specification's refusal branch: invalid fields or no readable source.
    if (!nonblank(owner) || !nonblank(scope) || !nonblank(title) || !nonblank(locator) ||
      typeof content !== "string" || !isMediaList(originals) ||
      (origin !== "COURSE" && origin !== "REFERENCE") ||
      (!nonblank(content) && !originals.some((source) => source.renditions.length > 0))) {
      throw new InvalidTutoringMaterial();
    }
    if (!nonblank(importKey)) throw new InvalidMaterialImportKey();

    // Snapshot before waiting, so caller edits cannot change an already validated record.
    const data = structuredClone({ owner, importKey, scope, title, locator, content, originals, origin });
    await this.#ready();
    const existing = await this.materials.findOne({ owner, importKey });
    if (existing !== null) return this.#reuse(existing, data);

    const material = crypto.randomUUID() as Material;
    try {
      // One write saves the material and its retry mapping. The unique index settles competing creates.
      await this.materials.insertOne({ _id: material, ...data });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      const saved = await this.materials.findOne({ owner, importKey });
      if (saved !== null) return this.#reuse(saved, data);
      // An unrelated constraint failed. Do not turn a database fault into an import conflict.
      throw error;
    }
    return { material };
  }

  #reuse(saved: MaterialDocument<Learner, Scope>, input: MaterialImport<Learner, Scope>): { material: Material } {
    if (saved.scope !== input.scope || saved.title !== input.title || saved.locator !== input.locator ||
      saved.content !== input.content || saved.origin !== input.origin || !isDeepStrictEqual(saved.originals, input.originals)) {
      throw new MaterialImportConflict();
    }
    return { material: saved._id };
  }

  async _materials({ owner, scope }: { owner: Learner; scope: Scope }): Promise<{
    material: Material; title: string; locator: string; origin: MaterialOrigin;
  }[]> {
    requireIdentity(owner);
    requireIdentity(scope);
    const rows = await this.materials.find({ owner, scope })
      .project<Pick<MaterialDocument<Learner, Scope>, "_id" | "title" | "locator" | "origin">>({
        _id: 1, title: 1, locator: 1, origin: 1,
      })
      .sort({ _id: 1 }).toArray();
    return rows.map(({ _id, title, locator, origin }) => ({ material: _id, title, locator, origin }));
  }

  /** Internal lookup. The application must check ownership before returning this data to a browser. */
  async _material({ material }: { material: Material }): Promise<MaterialData<Learner, Scope>[]> {
    requireIdentity(material);
    const found = await this.materials.findOne({ _id: material });
    if (found === null) return [];
    const { owner, scope, title, locator, content, originals, origin } = found;
    return [{ owner, scope, title, locator, content, originals, origin }];
  }

  async explain(input: { owner: Learner; topic: Topic; definition: Definition; request: string; explanation: string; materials: MaterialSet; citations: PassageSet }): Promise<{ lesson: Session }> {
    const value = structuredClone(input);
    if (!nonblank(value.request) || !nonblank(value.explanation) || !nonblank(value.topic) || !nonblank(value.definition)) throw new refusal.InvalidLessonContent();
    if (!await this.#validSources(value.owner, value.materials, value.citations)) throw new refusal.InvalidLessonSources();
    const lesson = crypto.randomUUID() as Session;
    await this.sessions.insertOne({ _id: lesson, ...value, materials: [...value.materials], citations: [...value.citations],
      kind: "LESSON", status: "OPEN", dialogue: [], checkedVoiceTurns: [], revision: 0 });
    return { lesson };
  }

  async prepareTask(input: { owner: Learner; topic: Topic; definition: Definition; question: string; criteria: string; materials: MaterialSet; citations: PassageSet; mode: Mode; fresh: boolean }): Promise<{ task: Session }> {
    const value = structuredClone(input);
    if (!nonblank(value.question) || !nonblank(value.criteria) || !["GUIDED", "CHECK"].includes(value.mode) || typeof value.fresh !== "boolean") throw new refusal.InvalidTaskContent();
    if (!await this.#validSources(value.owner, value.materials, value.citations)) throw new refusal.InvalidTaskSources();
    const task = crypto.randomUUID() as Session;
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

  async answerLesson(input: { owner: Learner; lesson: Session; text: string; citations: PassageSet; channel: Channel }): Promise<Record<string, never>> {
    const value = structuredClone(input);
    const record = await this.sessions.findOne({ _id: value.lesson, owner: value.owner, kind: "LESSON", status: "OPEN" });
    if (!record) throw new refusal.LessonAnswerUnavailable();
    if (!nonblank(value.text) || !["TEXT", "VOICE"].includes(value.channel) || !await this.#validSources(value.owner, record.materials, value.citations)) throw new refusal.InvalidLessonAnswer();
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

  async _sourceSet({ owner, scope }: { owner: Learner; scope: Scope }) {
    return { sources: (await this.materials.find({ owner, scope }).sort({ _id: 1 }).toArray())
      .map(({ _id, importKey: _, ...data }) => ({ material: _id, data })) };
  }

  async _study({ owner, topic }: { owner: Learner; topic: Topic }) {
    return { sessions: (await this.sessions.find({ owner, topic }).sort({ _id: 1 }).toArray()).map((record) => this.#sessionData(record)) };
  }

  async _sessionData({ session }: { session: Session }) {
    const record = await this.sessions.findOne({ _id: session });
    return record ? [{ data: this.#sessionData(record) }] : [];
  }

  #sessionData(record: SessionDocument<Learner, Topic, Definition>) {
    const voice = effectiveVoice(record);
    return { session: record._id, owner: record.owner, topic: record.topic, definition: record.definition, status: record.status,
      materials: record.materials, citations: record.citations,
      lesson: record.kind === "LESSON" ? { request: record.request!, explanation: record.explanation! } : null,
      task: record.kind === "PRACTICE" ? { question: record.question!, criteria: record.criteria!, mode: record.mode!, fresh: record.fresh!, hintRequested: record.hintRequested! } : null,
      dialogue: record.dialogue.map((turn, turnIndex) => ({ turnIndex, turn })), voice,
      review: record.kind === "PRACTICE" ? { dialogueLength: record.dialogue.length, uncheckedVoiceCount: voice.filter((turn) => !turn.confirmed).length,
        ready: record.status === "OPEN" && voice.every((turn) => turn.confirmed) && record.dialogue.some((turn) => turn.speaker === "LEARNER" && turn.purpose === "RESPONSE") } : null };
  }

  async #validSources(owner: Learner, materials: MaterialSet, citations: PassageSet): Promise<boolean> {
    if (!nonblank(owner) || !Array.isArray(materials) || !materials.length || !materials.every(nonblank) || new Set(materials).size !== materials.length ||
      !Array.isArray(citations) || !citations.length || !citations.every((item) => item && nonblank(item.material) && nonblank(item.location)) ||
      new Set(citations.map((item) => JSON.stringify(item))).size !== citations.length) return false;
    const sources = await this.materials.find({ _id: { $in: [...materials] as Material[] }, owner }).toArray();
    if (sources.length !== materials.length || new Set(sources.map((source) => source.scope)).size !== 1) return false;
    return citations.every((citation) => {
      const source = sources.find((item) => item._id === citation.material);
      return source && ((citation.location === "content" && nonblank(source.content)) || source.originals.some((file) => file.renditions.some((part) => part.location === citation.location)));
    });
  }

  async #edit(owner: Learner, session: Session, kind: "LESSON" | "PRACTICE" | undefined, Unavailable: new () => Error,
    change: (record: SessionDocument<Learner, Topic, Definition>) => void): Promise<Record<string, never>> {
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

function requireIdentity(value: unknown): asserts value is string {
  if (!nonblank(value)) throw new TypeError("Provide a nonblank identity.");
}
