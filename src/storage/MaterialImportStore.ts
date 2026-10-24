import { isDeepStrictEqual } from "node:util";
import { type Collection, type Db, type Filter, MongoServerError, type UpdateFilter } from "mongodb";
import type { MaterialImport } from "../concepts/GroundedTutoring/GroundedTutoring.ts";
import { isMediaList, type MediaList } from "../concepts/GroundedTutoring/media.ts";

/** Declared sources only. The importer must verify uploaded bytes before retaining them. */
export type ImportSource = {
  kind: "UPLOAD";
  name: string;
  size: number;
  sha256: string;
} | {
  kind: "REFERENCE";
  locator: string;
};

export interface ImportRequest {
  scope: string;
  title: string;
  origin: "COURSE" | "REFERENCE";
  sources: readonly ImportSource[];
}

export interface ImportIdentity {
  owner: string;
  requestId: string;
}

export type ImportStage = "CREATED" | "SOURCES_SAVED" | "TRANSCRIBING" | "READY" | "COMPLETE" | "DISCARDED";

/** A transcription or preparation failure. `retryable` says whether the learner may retry it. */
export interface ImportFailure { reason: string; sentence: string; retryable: boolean }
/** Whole seconds from the start of the recording, and nonblank text. */
export interface TranscriptSegment { start: number; end: number; text: string }
export type RecordingStatus = "WAITING" | "DONE" | "FAILED";
export interface RecordingProgress {
  file: string;
  status: RecordingStatus;
  /** Automatic attempts made since the import started or the learner last retried it. */
  attempts: number;
  retryAt?: Date;
  claim?: { token: string; until: Date };
  segments?: TranscriptSegment[];
  failure?: ImportFailure;
}

export interface ImportOperation extends ImportIdentity {
  kind: "MATERIAL_IMPORT";
  importKey: string;
  request: ImportRequest;
  /** Operations saved before this field existed lack it. */
  createdAt?: Date;
  stage: ImportStage;
  revision: number;
  sources?: MediaList;
  partial?: MediaList;
  recordings?: RecordingProgress[];
  failure?: ImportFailure;
  prepared?: MaterialImport;
  material?: string;
  filesDeleted?: boolean;
}

export interface ClaimedRecording extends ImportIdentity { file: string }

export class InvalidImportRequest extends Error {
  readonly code = "INVALID_IMPORT_REQUEST";

  constructor() {
    super("Provide a learner, request ID, course, title, origin, and source list.");
    this.name = "InvalidImportRequest";
  }
}

export class ImportRequestConflict extends Error {
  readonly code = "IMPORT_REQUEST_CONFLICT";

  constructor() {
    super("Use the original request details for this request ID.");
    this.name = "ImportRequestConflict";
  }
}

export class ImportProgressConflict extends Error {
  readonly code = "IMPORT_PROGRESS_CONFLICT";
  constructor() { super("The import has changed. Read its saved progress before continuing."); this.name = "ImportProgressConflict"; }
}

export class ImportNotRetryable extends Error {
  readonly code = "IMPORT_NOT_RETRYABLE";
  constructor() { super("This import has a failure that cannot be retried."); this.name = "ImportNotRetryable"; }
}

export class ImportAlreadySaved extends Error {
  readonly code = "IMPORT_ALREADY_SAVED";
  constructor() { super("This import is ready or saved as a material."); this.name = "ImportAlreadySaved"; }
}

const stages: readonly ImportStage[] = ["CREATED", "SOURCES_SAVED", "TRANSCRIBING", "READY", "COMPLETE", "DISCARDED"];
/** Forward order for replay checks. A discarded operation is never past another stage. */
const rank = (stage: ImportStage) => stage === "DISCARDED" ? -1 : stages.indexOf(stage);
const order = { createdAt: 1, requestId: 1 } as const;
const allDone = { "recordings.0": { $exists: true }, recordings: { $not: { $elemMatch: { status: { $ne: "DONE" } } } } };
const noFinalFailure = {
  "failure.retryable": { $ne: false },
  $nor: [{ recordings: { $elemMatch: { status: "FAILED", "failure.retryable": false } } }],
};

/** Saves import intent, recovery identity, and transcription progress. The host verifies the learner and course. */
export class MaterialImportStore {
  private readonly operations: Collection<ImportOperation>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "MaterialImport", private readonly clock = () => new Date()) {
    this.operations = database.collection(`${name.toLowerCase()}.operations`, {
      readPreference: "primary", readConcern: { level: "majority" }, writeConcern: { w: "majority", j: true },
    });
  }

  #ready() {
    this.indexes ??= this.operations.createIndexes([
      { key: { owner: 1, requestId: 1 }, unique: true },
      { key: { owner: 1, importKey: 1 }, unique: true },
      // The worker's claims: waiting recordings in learner order, oldest import first.
      { key: { stage: 1, owner: 1, createdAt: 1, requestId: 1 } },
      // The worker's imports to finish and removed imports with files left.
      { key: { stage: 1, filesDeleted: 1, createdAt: 1, requestId: 1 } },
      // The library's unfinished imports for one learner and course.
      { key: { owner: 1, "request.scope": 1, stage: 1, createdAt: 1, requestId: 1 } },
    ]).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  async getOrCreate(input: ImportIdentity & { request: ImportRequest }): Promise<ImportOperation> {
    if (!fields(input, ["owner", "requestId", "request"]) || !nonblank(input.owner) ||
      !nonblank(input.requestId) || !validRequest(input.request)) throw new InvalidImportRequest();
    // Save the exact validated request, even if the caller edits its object during a database wait.
    const { owner, requestId, request } = structuredClone(input);
    await this.#ready();
    const existing = await this.get({ owner, requestId });
    if (existing !== null) return reuse(existing, request);

    const operation: ImportOperation = {
      owner, requestId, kind: "MATERIAL_IMPORT", importKey: crypto.randomUUID(), request, createdAt: this.clock(), stage: "CREATED", revision: 0,
    };
    try {
      // The request, generated key, and initial progress are committed in one document.
      await this.operations.insertOne({ ...operation });
    } catch (error) {
      if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;
      const winner = await this.get({ owner, requestId });
      if (winner !== null) return reuse(winner, request);
      // A different constraint failed. Never return an unsaved key or another operation's key.
      throw error;
    }
    return operation;
  }

  async get(input: ImportIdentity): Promise<ImportOperation | null> {
    if (!fields(input, ["owner", "requestId"]) || !nonblank(input.owner) || !nonblank(input.requestId)) {
      throw new InvalidImportRequest();
    }
    const found = await this.operations.findOne({ owner: input.owner, requestId: input.requestId });
    return found === null ? null : checked(found);
  }

  /** The learner's TRANSCRIBING and READY imports in one course, oldest first. */
  async pending(input: { owner: string; course: string }): Promise<ImportOperation[]> {
    if (!fields(input, ["owner", "course"]) || !nonblank(input.owner) || !nonblank(input.course)) throw new InvalidImportRequest();
    const rows = await this.operations.find({ owner: input.owner, "request.scope": input.course, stage: { $in: ["TRANSCRIBING", "READY"] } }).sort(order).toArray();
    return rows.map(checked);
  }

  async saveSources(input: ImportIdentity & { revision: number; sources: MediaList }): Promise<ImportOperation> {
    if (!isMediaList(input.sources) || input.sources.length === 0) throw new InvalidImportRequest();
    return this.#advance(input, "CREATED", "SOURCES_SAVED", { sources: structuredClone(input.sources) });
  }

  /** Saves the documents as read at upload and one waiting entry for each distinct recording file. */
  async startTranscription(input: ImportIdentity & { revision: number; partial: MediaList; recordings: readonly string[] }): Promise<ImportOperation> {
    const { owner, requestId, revision } = input;
    const partial = structuredClone(input.partial), recordings = structuredClone(input.recordings);
    if (!isMediaList(partial) || !partial.length || !Array.isArray(recordings) || !recordings.length || !recordings.every(nonblank) ||
      new Set(recordings).size !== recordings.length || !Number.isSafeInteger(revision) || revision < 0) throw new InvalidImportRequest();
    const current = await this.get({ owner, requestId });
    if (!current) throw new ImportProgressConflict();
    const files = partial.map((file) => file.file);
    // One entry for each distinct recording file, in original order. Identical uploads share one retained reference.
    const entries: RecordingProgress[] = [...new Set(files)].filter((file) => recordings.includes(file)).map((file) => ({ file, status: "WAITING", attempts: 0 }));
    if (rank(current.stage) >= rank("TRANSCRIBING") && isDeepStrictEqual(current.partial, partial) &&
      isDeepStrictEqual(current.recordings?.map((item) => item.file), entries.map((item) => item.file))) return current;
    if (current.stage !== "SOURCES_SAVED" || current.revision !== revision || entries.length !== recordings.length ||
      !isDeepStrictEqual(current.sources?.map((file) => file.file), files) ||
      partial.some((file) => recordings.includes(file.file) && (file.renditions.length || file.limitations.length))) throw new ImportProgressConflict();
    const result = await this.operations.updateOne({ owner, requestId, stage: "SOURCES_SAVED", revision },
      { $set: { partial, recordings: entries, stage: "TRANSCRIBING" }, $inc: { revision: 1 } });
    if (result.matchedCount !== 1) throw new ImportProgressConflict();
    return this.#reread({ owner, requestId });
  }

  /**
   * Claims one waiting recording for a worker, without changing the revision. Learners take turns: the
   * first learner after `previous` in identity order who has a recording ready, wrapping around.
   */
  async claim(input: { now: Date; token: string; until: Date; previous?: string }): Promise<ClaimedRecording | null> {
    const { now, token, until, previous } = input;
    if (!(now instanceof Date) || !(until instanceof Date) || !nonblank(token) || (previous !== undefined && !nonblank(previous))) throw new InvalidImportRequest();
    await this.#ready();
    const ready = {
      status: "WAITING",
      $and: [{ $or: [{ retryAt: { $exists: false } }, { retryAt: { $lte: now } }] }, { $or: [{ claim: { $exists: false } }, { "claim.until": { $lt: now } }] }],
    };
    const claimable: Filter<ImportOperation> = { stage: "TRANSCRIBING", ...noFinalFailure, recordings: { $elemMatch: ready } } as Filter<ImportOperation>;
    const sorted = { owner: 1, ...order } as const;
    for (let attempt = 0; attempt < 5; attempt++) {
      const next = previous === undefined ? null : await this.operations.findOne({ ...claimable, owner: { $gt: previous } }, { sort: sorted });
      const found = next ?? await this.operations.findOne(claimable, { sort: sorted });
      if (!found) return null;
      const operation = checked(found);
      const recording = operation.recordings!.find((item) => item.status === "WAITING" && (!item.retryAt || item.retryAt <= now) && (!item.claim || item.claim.until < now));
      if (!recording) continue;
      const result = await this.operations.updateOne(
        { owner: operation.owner, requestId: operation.requestId, stage: "TRANSCRIBING", ...noFinalFailure, recordings: { $elemMatch: { file: recording.file, ...ready } } } as Filter<ImportOperation>,
        { $set: { "recordings.$[r].claim": { token, until } } } as UpdateFilter<ImportOperation>, { arrayFilters: [{ "r.file": recording.file }] });
      if (result.matchedCount === 1) return { owner: operation.owner, requestId: operation.requestId, file: recording.file };
    }
    return null;
  }

  /** Extends a live claim. Returns false when the claim was lost or the import changed. */
  async renew(input: ClaimedRecording & { token: string; until: Date }): Promise<boolean> {
    const { owner, requestId, file, token, until } = input;
    if (!nonblank(owner) || !nonblank(requestId) || !nonblank(file) || !nonblank(token) || !(until instanceof Date)) throw new InvalidImportRequest();
    const result = await this.operations.updateOne(this.#held(input), { $set: { "recordings.$[r].claim.until": until } } as UpdateFilter<ImportOperation>,
      { arrayFilters: [{ "r.file": file }] });
    return result.matchedCount === 1;
  }

  async saveTranscript(input: ClaimedRecording & { token: string; segments: TranscriptSegment[] }): Promise<ImportOperation> {
    const { owner, requestId, file, token } = input, segments = structuredClone(input.segments);
    if (!nonblank(owner) || !nonblank(requestId) || !nonblank(file) || !nonblank(token) || !validSegments(segments)) throw new InvalidImportRequest();
    const result = await this.operations.updateOne(this.#held(input), {
      $set: { "recordings.$[r].status": "DONE", "recordings.$[r].segments": segments },
      $unset: { "recordings.$[r].claim": "", "recordings.$[r].retryAt": "" }, $inc: { revision: 1 },
    } as UpdateFilter<ImportOperation>, { arrayFilters: [{ "r.file": file }] });
    const current = await this.get({ owner, requestId });
    const saved = current?.recordings?.find((item) => item.file === file);
    if (current && saved?.status === "DONE" && isDeepStrictEqual(saved.segments, segments)) return current;
    if (result.matchedCount === 1) throw new Error("The saved import operation changed unexpectedly.");
    throw new ImportProgressConflict();
  }

  /** With `retryAt`, the recording waits for an automatic retry; without it, the recording fails. */
  async failTranscript(input: ClaimedRecording & { token: string; failure: ImportFailure; retryAt?: Date }): Promise<ImportOperation> {
    const { owner, requestId, file, token, retryAt } = input, failure = structuredClone(input.failure);
    if (!nonblank(owner) || !nonblank(requestId) || !nonblank(file) || !nonblank(token) || !validFailure(failure) ||
      (retryAt !== undefined && !(retryAt instanceof Date))) throw new InvalidImportRequest();
    const update = retryAt
      ? { $set: { "recordings.$[r].retryAt": retryAt }, $unset: { "recordings.$[r].claim": "" }, $inc: { "recordings.$[r].attempts": 1, revision: 1 } }
      : { $set: { "recordings.$[r].status": "FAILED", "recordings.$[r].failure": failure }, $unset: { "recordings.$[r].claim": "", "recordings.$[r].retryAt": "" }, $inc: { revision: 1 } };
    const result = await this.operations.updateOne(this.#held(input), update as UpdateFilter<ImportOperation>, { arrayFilters: [{ "r.file": file }] });
    if (result.matchedCount !== 1) throw new ImportProgressConflict();
    return this.#reread({ owner, requestId });
  }

  /** TRANSCRIBING operations whose recordings are all DONE and that have no failure, oldest first. */
  async preparable(): Promise<ImportOperation[]> {
    const rows = await this.operations.find({ stage: "TRANSCRIBING", failure: { $exists: false }, ...allDone } as Filter<ImportOperation>).sort(order).toArray();
    return rows.map(checked);
  }

  /** Records a failure of the final preparation, such as the text limit. It cannot be retried. */
  async failPreparation(input: ImportIdentity & { revision: number; failure: ImportFailure }): Promise<ImportOperation> {
    const { owner, requestId, revision } = input, failure = structuredClone(input.failure);
    if (!nonblank(owner) || !nonblank(requestId) || !Number.isSafeInteger(revision) || revision < 0 || !validFailure(failure)) throw new InvalidImportRequest();
    const result = await this.operations.updateOne({ owner, requestId, stage: "TRANSCRIBING", revision, failure: { $exists: false }, ...allDone } as Filter<ImportOperation>,
      { $set: { failure }, $inc: { revision: 1 } });
    const current = await this.get({ owner, requestId });
    if (current?.stage === "TRANSCRIBING" && isDeepStrictEqual(current.failure, failure)) return current;
    if (result.matchedCount === 1) throw new Error("The saved import operation changed unexpectedly.");
    throw new ImportProgressConflict();
  }

  /** The learner's retry: every failed recording waits again with no attempts counted. */
  async retry(input: ImportIdentity): Promise<ImportOperation | null> {
    const { owner, requestId } = input;
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.get({ owner, requestId });
      if (!current) return null;
      if (current.stage !== "TRANSCRIBING") return current;
      const failures = [current.failure, ...current.recordings!.map((item) => item.status === "FAILED" ? item.failure : undefined)]
        .filter((failure): failure is ImportFailure => failure !== undefined);
      if (failures.some((failure) => !failure.retryable)) throw new ImportNotRetryable();
      if (!failures.length) return current;
      const result = await this.operations.updateOne(
        { owner, requestId, stage: "TRANSCRIBING", revision: current.revision, ...noFinalFailure } as Filter<ImportOperation>,
        {
          $set: { "recordings.$[f].status": "WAITING", "recordings.$[f].attempts": 0 },
          $unset: { "recordings.$[f].failure": "", "recordings.$[f].retryAt": "", "recordings.$[f].claim": "", failure: "" }, $inc: { revision: 1 },
        } as UpdateFilter<ImportOperation>, { arrayFilters: [{ "f.status": "FAILED" }] });
      if (result.matchedCount === 1) return this.#reread({ owner, requestId });
    }
    throw new ImportProgressConflict();
  }

  async savePrepared(input: ImportIdentity & { revision: number; prepared: MaterialImport }): Promise<ImportOperation> {
    const prepared = structuredClone(input.prepared);
    if (!prepared || !nonblank(prepared.title) || !nonblank(prepared.locator) || typeof prepared.content !== "string" ||
      !isMediaList(prepared.originals) || (!nonblank(prepared.content) && !prepared.originals.some((file) => file.renditions.length))) {
      throw new InvalidImportRequest();
    }
    const identity = { owner: input.owner, requestId: input.requestId }, { revision } = input;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new InvalidImportRequest();
    const operation = await this.get(identity);
    if (!operation || prepared.owner !== operation.owner || prepared.importKey !== operation.importKey ||
      prepared.scope !== operation.request.scope || prepared.title !== operation.request.title || prepared.origin !== operation.request.origin) {
      throw new ImportProgressConflict();
    }
    if (rank(operation.stage) >= rank("READY") && isDeepStrictEqual(operation.prepared, prepared)) return operation;
    // An import with recordings is prepared only once every recording is DONE and it has no failure.
    const from = operation.recordings?.length ? "TRANSCRIBING" : "SOURCES_SAVED";
    const result = await this.operations.updateOne(
      { ...identity, stage: from, revision, ...(from === "TRANSCRIBING" ? { failure: { $exists: false }, ...allDone } : {}) } as Filter<ImportOperation>,
      { $set: { prepared, stage: "READY" }, $inc: { revision: 1 } });
    if (result.matchedCount !== 1) throw new ImportProgressConflict();
    return this.#reread(identity);
  }

  async complete(input: ImportIdentity & { revision: number; material: string }): Promise<ImportOperation> {
    if (!nonblank(input.material)) throw new InvalidImportRequest();
    return this.#advance(input, "READY", "COMPLETE", { material: input.material });
  }

  /**
   * Removes an unfinished import. A READY import is removed only with the host's report that AddMaterial
   * refused its prepared input as invalid, so no material can hold its key.
   */
  async discard(input: ImportIdentity & { invalidInput?: boolean }): Promise<ImportOperation | null> {
    const { owner, requestId, invalidInput = false } = input;
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.get({ owner, requestId });
      if (!current) return null;
      if (current.stage === "DISCARDED") return current;
      if (current.stage === "COMPLETE" || (current.stage === "READY" && !invalidInput)) throw new ImportAlreadySaved();
      const update: UpdateFilter<ImportOperation> = { $set: { stage: "DISCARDED", filesDeleted: false }, $inc: { revision: 1 } };
      // A claim does not change the revision, so the update removes any claim made since the read.
      if (current.recordings?.length) update.$unset = { "recordings.$[].claim": "" } as UpdateFilter<ImportOperation>["$unset"];
      const result = await this.operations.updateOne({ owner, requestId, stage: current.stage, revision: current.revision }, update);
      if (result.matchedCount === 1) return this.#reread({ owner, requestId });
    }
    throw new ImportProgressConflict();
  }

  /** Removed imports whose retained files are not yet recorded as deleted, oldest first. */
  async deletable(): Promise<ImportOperation[]> {
    const rows = await this.operations.find({ stage: "DISCARDED", filesDeleted: false }).sort(order).toArray();
    return rows.map(checked);
  }

  async markFilesDeleted(input: ImportIdentity): Promise<ImportOperation> {
    const { owner, requestId } = input;
    if (!nonblank(owner) || !nonblank(requestId)) throw new InvalidImportRequest();
    await this.operations.updateOne({ owner, requestId, stage: "DISCARDED", filesDeleted: false }, { $set: { filesDeleted: true }, $inc: { revision: 1 } });
    const current = await this.get({ owner, requestId });
    if (current?.stage !== "DISCARDED" || current.filesDeleted !== true) throw new ImportProgressConflict();
    return current;
  }

  /** The recording is still WAITING under this worker's claim and its import is still TRANSCRIBING. */
  #held({ owner, requestId, file, token }: ClaimedRecording & { token: string }): Filter<ImportOperation> {
    return { owner, requestId, stage: "TRANSCRIBING", recordings: { $elemMatch: { file, status: "WAITING", "claim.token": token } } } as Filter<ImportOperation>;
  }

  async #reread(identity: ImportIdentity): Promise<ImportOperation> {
    const saved = await this.get(identity);
    if (!saved) throw new Error("The saved import operation is missing.");
    return saved;
  }

  async #advance(identity: ImportIdentity & { revision: number }, from: ImportStage, to: ImportStage,
    update: Pick<ImportOperation, "sources" | "material">): Promise<ImportOperation> {
    const { owner, requestId, revision } = identity;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new InvalidImportRequest();
    const current = await this.get({ owner, requestId });
    if (!current) throw new ImportProgressConflict();
    if (rank(current.stage) >= rank(to) &&
      Object.entries(update).every(([key, value]) => isDeepStrictEqual(current[key as keyof ImportOperation], value))) return current;
    if (current.stage !== from || current.revision !== revision) throw new ImportProgressConflict();
    const result = await this.operations.updateOne({ owner, requestId, stage: from, revision }, {
      $set: { ...update, stage: to }, $inc: { revision: 1 },
    });
    if (result.matchedCount !== 1) throw new ImportProgressConflict();
    return this.#reread({ owner, requestId });
  }
}

function reuse(operation: ImportOperation, request: ImportRequest): ImportOperation {
  if (!isDeepStrictEqual(operation.request, request)) throw new ImportRequestConflict();
  return operation;
}

/** An invalid saved record is a storage error. The store never replaces it or allocates a new key. */
function checked(found: ImportOperation & { _id?: unknown }): ImportOperation {
  const { stage } = found;
  const after = (first: ImportStage) => rank(stage) >= rank(first);
  if (found.kind !== "MATERIAL_IMPORT" || !nonblank(found.importKey) || !validRequest(found.request) ||
    !stages.includes(stage) || !Number.isSafeInteger(found.revision) || found.revision < 0 ||
    (found.createdAt !== undefined && !(found.createdAt instanceof Date)) ||
    ((after("SOURCES_SAVED") || found.sources !== undefined) && !isMediaList(found.sources)) ||
    ((stage === "TRANSCRIBING" || found.partial !== undefined) && (!isMediaList(found.partial) || !found.partial.length)) ||
    ((stage === "TRANSCRIBING" || found.recordings !== undefined) && !validRecordings(found.recordings)) ||
    (found.failure !== undefined && !validFailure(found.failure)) ||
    (after("READY") && !found.prepared) ||
    (stage === "COMPLETE" && !nonblank(found.material)) ||
    (stage === "DISCARDED" && typeof found.filesDeleted !== "boolean")) throw new Error("The saved import operation is invalid.");
  const { _id: _, ...operation } = found;
  return operation;
}

function nonblank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
}

function denseArray(value: unknown): value is unknown[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
}

function validFailure(value: unknown): value is ImportFailure {
  return fields(value, ["reason", "sentence", "retryable"]) && nonblank(value.reason) && nonblank(value.sentence) && typeof value.retryable === "boolean";
}

/** Ordered, non-overlapping segments with whole-second times, each with its own time and nonblank text. */
function validSegments(value: unknown): value is TranscriptSegment[] {
  if (!denseArray(value) || !value.length) return false;
  let previous = 0;
  return value.every((segment) => {
    if (!fields(segment, ["start", "end", "text"]) || !nonblank(segment.text)) return false;
    const { start, end } = segment;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < previous || end <= start) return false;
    previous = end;
    return true;
  });
}

function validRecordings(value: unknown): value is RecordingProgress[] {
  if (!denseArray(value) || !value.length) return false;
  return value.every((item) => {
    if (item === null || typeof item !== "object" || Array.isArray(item)) return false;
    const recording = item as Record<string, unknown>;
    const claim = recording.claim as Record<string, unknown> | undefined;
    return nonblank(recording.file) && ["WAITING", "DONE", "FAILED"].includes(recording.status as string) &&
      Number.isSafeInteger(recording.attempts) && (recording.attempts as number) >= 0 &&
      (recording.retryAt === undefined || recording.retryAt instanceof Date) &&
      (claim === undefined || (fields(claim, ["token", "until"]) && nonblank(claim.token) && claim.until instanceof Date)) &&
      (recording.status !== "DONE" || validSegments(recording.segments)) &&
      (recording.status !== "FAILED" || validFailure(recording.failure));
  });
}

function validSource(value: unknown): value is ImportSource {
  if (fields(value, ["kind", "name", "size", "sha256"]) && value.kind === "UPLOAD") {
    return nonblank(value.name) && typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0 &&
      typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256);
  }
  return fields(value, ["kind", "locator"]) && value.kind === "REFERENCE" && nonblank(value.locator);
}

function validRequest(value: unknown): value is ImportRequest {
  if (!fields(value, ["scope", "title", "origin", "sources"]) || !nonblank(value.scope) || !nonblank(value.title) ||
    (value.origin !== "COURSE" && value.origin !== "REFERENCE") || !Array.isArray(value.sources) || value.sources.length === 0) return false;
  for (let index = 0; index < value.sources.length; index++) {
    if (!Object.hasOwn(value.sources, index) || !validSource(value.sources[index])) return false;
  }
  return true;
}
