import { isDeepStrictEqual } from "node:util";
import { type Collection, type Db, MongoServerError } from "mongodb";
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

export type ImportStage = "CREATED" | "SOURCES_SAVED" | "READY" | "COMPLETE";
export interface ImportOperation extends ImportIdentity {
  kind: "MATERIAL_IMPORT";
  importKey: string;
  request: ImportRequest;
  stage: ImportStage;
  revision: number;
  sources?: MediaList;
  prepared?: MaterialImport;
  material?: string;
}

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
  constructor() { super("The import has changed. Read its saved progress before continuing."); }
}

/** Saves import intent and recovery identity. The host verifies the learner and course. */
export class MaterialImportStore {
  private readonly operations: Collection<ImportOperation>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "MaterialImport") {
    this.operations = database.collection(`${name.toLowerCase()}.operations`, {
      readPreference: "primary", readConcern: { level: "majority" }, writeConcern: { w: "majority", j: true },
    });
  }

  #ready() {
    this.indexes ??= this.operations.createIndexes([
      { key: { owner: 1, requestId: 1 }, unique: true },
      { key: { owner: 1, importKey: 1 }, unique: true },
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
      owner, requestId, kind: "MATERIAL_IMPORT", importKey: crypto.randomUUID(), request, stage: "CREATED", revision: 0,
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
    if (found === null) return null;
    if (found.kind !== "MATERIAL_IMPORT" || !nonblank(found.importKey) || !validRequest(found.request) ||
      !stages.includes(found.stage) || !Number.isSafeInteger(found.revision) || found.revision < 0 ||
      (found.stage !== "CREATED" && !isMediaList(found.sources)) ||
      (stages.indexOf(found.stage) >= 2 && !found.prepared) ||
      (found.stage === "COMPLETE" && !nonblank(found.material))) throw new Error("The saved import operation is invalid.");
    const { _id: _, ...operation } = found;
    return operation;
  }

  async saveSources(input: ImportIdentity & { revision: number; sources: MediaList }): Promise<ImportOperation> {
    if (!isMediaList(input.sources) || input.sources.length === 0) throw new InvalidImportRequest();
    return this.#advance(input, "CREATED", "SOURCES_SAVED", { sources: structuredClone(input.sources) });
  }

  async savePrepared(input: ImportIdentity & { revision: number; prepared: MaterialImport }): Promise<ImportOperation> {
    const prepared = structuredClone(input.prepared);
    if (!prepared || !nonblank(prepared.title) || !nonblank(prepared.locator) || typeof prepared.content !== "string" ||
      !isMediaList(prepared.originals) || (!nonblank(prepared.content) && !prepared.originals.some((file) => file.renditions.length))) {
      throw new InvalidImportRequest();
    }
    const identity = { owner: input.owner, requestId: input.requestId };
    const operation = await this.get(identity);
    if (!operation || prepared.owner !== operation.owner || prepared.importKey !== operation.importKey ||
      prepared.scope !== operation.request.scope || prepared.title !== operation.request.title || prepared.origin !== operation.request.origin) {
      throw new ImportProgressConflict();
    }
    return this.#advance({ ...identity, revision: input.revision }, "SOURCES_SAVED", "READY", { prepared });
  }

  async complete(input: ImportIdentity & { revision: number; material: string }): Promise<ImportOperation> {
    if (!nonblank(input.material)) throw new InvalidImportRequest();
    return this.#advance(input, "READY", "COMPLETE", { material: input.material });
  }

  async #advance(identity: ImportIdentity & { revision: number }, from: ImportStage, to: ImportStage,
    update: Pick<ImportOperation, "sources" | "prepared" | "material">): Promise<ImportOperation> {
    const { owner, requestId, revision } = identity;
    if (!Number.isSafeInteger(revision) || revision < 0) throw new InvalidImportRequest();
    const current = await this.get({ owner, requestId });
    if (!current) throw new ImportProgressConflict();
    if (stages.indexOf(current.stage) >= stages.indexOf(to) &&
      Object.entries(update).every(([key, value]) => isDeepStrictEqual(current[key as keyof ImportOperation], value))) return current;
    if (current.stage !== from || current.revision !== revision) throw new ImportProgressConflict();
    const result = await this.operations.updateOne({ owner, requestId, stage: from, revision }, {
      $set: { ...update, stage: to }, $inc: { revision: 1 },
    });
    if (result.matchedCount !== 1) throw new ImportProgressConflict();
    const saved = await this.get({ owner, requestId });
    if (!saved) throw new Error("The saved import operation is missing.");
    return saved;
  }
}

const stages: ImportStage[] = ["CREATED", "SOURCES_SAVED", "READY", "COMPLETE"];

function reuse(operation: ImportOperation, request: ImportRequest): ImportOperation {
  if (!isDeepStrictEqual(operation.request, request)) throw new ImportRequestConflict();
  return operation;
}

function nonblank(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }

function fields(value: unknown, names: readonly string[]): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name));
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
