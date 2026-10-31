import { isDeepStrictEqual } from "node:util";
import { type Collection, type Db, MongoServerError } from "mongodb";
import { isMediaList, nonblank, type MediaList } from "../../media.ts";
import * as refusal from "./refusals.ts";

export type Material = string & { readonly __brand: "Material" };
export type MaterialOrigin = "COURSE" | "REFERENCE";
/** What a material is for: a source the owner learns from, or the owner's own work, kept as evidence and never a source. */
export type MaterialPurpose = "SOURCE" | "WORK";

export interface MaterialData<Owner extends string = string, Scope extends string = string> {
  owner: Owner;
  scope: Scope;
  title: string;
  locator: string;
  content: string;
  originals: MediaList;
  origin: MaterialOrigin;
}

export interface MaterialImport<Owner extends string = string, Scope extends string = string> extends MaterialData<Owner, Scope> {
  importKey: string;
  purpose: MaterialPurpose;
}

interface KeptDocument<Owner extends string, Scope extends string> extends MaterialData<Owner, Scope> {
  _id: Material;
  // Materials written before retry support have no import key.
  importKey?: string;
  // Materials written before purposes were recorded have none, and are sources.
  purpose?: MaterialPurpose;
  deleted?: never;
}

/** What remains of a deleted material: its identity, owner, scope, and import key, and nothing it contained. */
interface DeletedDocument<Owner extends string, Scope extends string> {
  _id: Material;
  owner: Owner;
  scope: Scope;
  importKey?: string;
  deleted: true;
}

type MaterialDocument<Owner extends string, Scope extends string> = KeptDocument<Owner, Scope> | DeletedDocument<Owner, Scope>;

// Kept materials are the documents without the deletion mark.
const KEPT = { deleted: { $ne: true } } as const;
// A kept material without a stored purpose was saved before purposes were recorded, and is a source.
const SOURCES = { ...KEPT, purpose: { $ne: "WORK" } } as const;
const WORK = { ...KEPT, purpose: "WORK" } as const;
const purposeOf = (document: { purpose?: MaterialPurpose }): MaterialPurpose => document.purpose ?? "SOURCE";

/**
 * The MaterialKeeping concept: each owner's materials, with their readable content, retained file references, what
 * each is for (a source, or the owner's own work), and the import key that makes adding the same material twice return
 * the saved one. Deleting a material removes everything it contained and keeps only its identity, owner, scope, and
 * import key.
 */
export class MaterialKeeping<Owner extends string = string, Scope extends string = string> {
  private readonly materials: Collection<MaterialDocument<Owner, Scope>>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "MaterialKeeping", private readonly clock = () => new Date()) {
    this.materials = database.collection(`${name.toLowerCase()}.materials`, {
      readPreference: "primary", readConcern: { level: "majority" }, writeConcern: { w: "majority", j: true },
    });
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

  async add(input: MaterialImport<Owner, Scope>): Promise<{ material: Material }> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new refusal.InvalidTutoringMaterial();
    const { owner, importKey, scope, title, locator, content, originals, origin, purpose } = input;
    // The specification's refusal branch: invalid fields or no readable source.
    if (!nonblank(owner) || !nonblank(scope) || !nonblank(title) || !nonblank(locator) ||
      typeof content !== "string" || !isMediaList(originals) ||
      (origin !== "COURSE" && origin !== "REFERENCE") || (purpose !== "SOURCE" && purpose !== "WORK") ||
      (!nonblank(content) && !originals.some((source) => source.renditions.length > 0))) {
      throw new refusal.InvalidTutoringMaterial();
    }
    if (!nonblank(importKey)) throw new refusal.InvalidMaterialImportKey();

    // Snapshot before waiting, so caller edits cannot change an already validated record.
    const data = structuredClone({ owner, importKey, scope, title, locator, content, originals, origin, purpose });
    await this.#ready();
    const existing = await this.materials.findOne({ owner, importKey });
    if (existing !== null) return this.#reuse(existing, data);

    const material = timeOrderedId(this.clock()) as Material;
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

  #reuse(saved: MaterialDocument<Owner, Scope>, input: MaterialImport<Owner, Scope>): { material: Material } {
    // A deleted material's key stays taken, so a late retry of its import cannot bring the material back.
    if (saved.deleted === true) throw new refusal.MaterialDeleted();
    if (saved.scope !== input.scope || saved.title !== input.title || saved.locator !== input.locator ||
      saved.content !== input.content || saved.origin !== input.origin || purposeOf(saved) !== input.purpose ||
      !isDeepStrictEqual(saved.originals, input.originals)) {
      throw new refusal.MaterialImportConflict();
    }
    return { material: saved._id };
  }

  async delete({ owner, material }: { owner: Owner; material: Material }): Promise<Record<string, never>> {
    // The specification's refusal branch: an unknown, another owner's, or an already deleted material.
    if (!nonblank(owner) || !nonblank(material)) throw new refusal.MaterialDeleteUnavailable();
    await this.#ready();
    // One write removes every kept field, so no reader sees a half-deleted material.
    const result = await this.materials.updateOne({ _id: material, owner, ...KEPT }, {
      $set: { deleted: true },
      $unset: { title: "", locator: "", content: "", originals: "", origin: "", purpose: "" },
    });
    if (result.matchedCount === 0) throw new refusal.MaterialDeleteUnavailable();
    return {};
  }

  async _materials({ owner, scope }: { owner: Owner; scope: Scope }): Promise<{
    material: Material; title: string; locator: string; origin: MaterialOrigin; purpose: MaterialPurpose;
  }[]> {
    requireIdentity(owner);
    requireIdentity(scope);
    const rows = await this.materials.find({ owner, scope, ...KEPT })
      .project<Pick<KeptDocument<Owner, Scope>, "_id" | "title" | "locator" | "origin" | "purpose">>({
        _id: 1, title: 1, locator: 1, origin: 1, purpose: 1,
      })
      .sort({ _id: 1 }).toArray();
    return rows.map(({ _id, title, locator, origin, purpose }) => ({ material: _id, title, locator, origin, purpose: purpose ?? "SOURCE" }));
  }

  /** Internal lookup. The application must check ownership before returning this data to a browser. */
  async _material({ material }: { material: Material }): Promise<(MaterialData<Owner, Scope> & { purpose: MaterialPurpose })[]> {
    requireIdentity(material);
    const found = await this.materials.findOne({ _id: material, ...KEPT }) as KeptDocument<Owner, Scope> | null;
    if (found === null) return [];
    const { owner, scope, title, locator, content, originals, origin } = found;
    return [{ owner, scope, title, locator, content, originals, origin, purpose: purposeOf(found) }];
  }

  /** The owner's sources in the scope, which the application selects tutor sources from. The owner's work is never among them. */
  async _sourceSet({ owner, scope }: { owner: Owner; scope: Scope }) {
    return { sources: await this.#records(owner, scope, SOURCES) };
  }

  /** The owner's own work in the scope, kept as evidence of their attempts. */
  async _workSet({ owner, scope }: { owner: Owner; scope: Scope }) {
    return { work: await this.#records(owner, scope, WORK) };
  }

  async #records(owner: Owner, scope: Scope, filter: typeof SOURCES | typeof WORK) {
    const kept = await this.materials.find({ owner, scope, ...filter }).sort({ _id: 1 }).toArray() as KeptDocument<Owner, Scope>[];
    return kept.map(({ _id, owner, scope, title, locator, content, originals, origin }) =>
      ({ material: _id, data: { owner, scope, title, locator, content, originals, origin } as MaterialData<Owner, Scope> }));
  }

  /** Internal lookup. The application tells only the owner that the material was deleted. */
  async _deleted({ material }: { material: Material }): Promise<{ owner: Owner; scope: Scope }[]> {
    requireIdentity(material);
    const found = await this.materials.findOne({ _id: material, deleted: true });
    return found === null ? [] : [{ owner: found.owner, scope: found.scope }];
  }

  async _deletions({ owner, scope }: { owner: Owner; scope: Scope }): Promise<{ material: Material }[]> {
    requireIdentity(owner);
    requireIdentity(scope);
    const rows = await this.materials.find({ owner, scope, deleted: true }).project<{ _id: Material }>({ _id: 1 })
      .sort({ _id: 1 }).toArray();
    return rows.map(({ _id }) => ({ material: _id }));
  }
}

/** A UUID version 7: the time it was made comes first, so identities made this way sort in the order they were made. */
function timeOrderedId(at: Date): string {
  const time = Math.max(0, at.getTime()).toString(16).padStart(12, "0").slice(-12), random = crypto.randomUUID();
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(15, 18)}-${random.slice(19)}`;
}

function requireIdentity(value: unknown): asserts value is string {
  if (!nonblank(value)) throw new TypeError("Provide a nonblank identity.");
}
