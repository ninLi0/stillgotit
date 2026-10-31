import { isDeepStrictEqual } from "node:util";
import { type Collection, type Db, MongoServerError } from "mongodb";
import { isMediaList, nonblank, type MediaList } from "../../media.ts";
import * as refusal from "./refusals.ts";

export type Material = string & { readonly __brand: "Material" };
export type MaterialOrigin = "COURSE" | "REFERENCE";

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
}

interface KeptDocument<Owner extends string, Scope extends string> extends MaterialData<Owner, Scope> {
  _id: Material;
  // Materials written before retry support have no import key.
  importKey?: string;
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

/**
 * The MaterialKeeping concept: each owner's source materials, with their readable content, retained file
 * references, and the import key that makes adding the same material twice return the saved one. Deleting a
 * material removes everything it contained and keeps only its identity, owner, scope, and import key.
 */
export class MaterialKeeping<Owner extends string = string, Scope extends string = string> {
  private readonly materials: Collection<MaterialDocument<Owner, Scope>>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "MaterialKeeping") {
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
    const { owner, importKey, scope, title, locator, content, originals, origin } = input;
    // The specification's refusal branch: invalid fields or no readable source.
    if (!nonblank(owner) || !nonblank(scope) || !nonblank(title) || !nonblank(locator) ||
      typeof content !== "string" || !isMediaList(originals) ||
      (origin !== "COURSE" && origin !== "REFERENCE") ||
      (!nonblank(content) && !originals.some((source) => source.renditions.length > 0))) {
      throw new refusal.InvalidTutoringMaterial();
    }
    if (!nonblank(importKey)) throw new refusal.InvalidMaterialImportKey();

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

  #reuse(saved: MaterialDocument<Owner, Scope>, input: MaterialImport<Owner, Scope>): { material: Material } {
    // A deleted material's key stays taken, so a late retry of its import cannot bring the material back.
    if (saved.deleted === true) throw new refusal.MaterialDeleted();
    if (saved.scope !== input.scope || saved.title !== input.title || saved.locator !== input.locator ||
      saved.content !== input.content || saved.origin !== input.origin || !isDeepStrictEqual(saved.originals, input.originals)) {
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
      $unset: { title: "", locator: "", content: "", originals: "", origin: "" },
    });
    if (result.matchedCount === 0) throw new refusal.MaterialDeleteUnavailable();
    return {};
  }

  async _materials({ owner, scope }: { owner: Owner; scope: Scope }): Promise<{
    material: Material; title: string; locator: string; origin: MaterialOrigin;
  }[]> {
    requireIdentity(owner);
    requireIdentity(scope);
    const rows = await this.materials.find({ owner, scope, ...KEPT })
      .project<Pick<KeptDocument<Owner, Scope>, "_id" | "title" | "locator" | "origin">>({
        _id: 1, title: 1, locator: 1, origin: 1,
      })
      .sort({ _id: 1 }).toArray();
    return rows.map(({ _id, title, locator, origin }) => ({ material: _id, title, locator, origin }));
  }

  /** Internal lookup. The application must check ownership before returning this data to a browser. */
  async _material({ material }: { material: Material }): Promise<MaterialData<Owner, Scope>[]> {
    requireIdentity(material);
    const found = await this.materials.findOne({ _id: material, ...KEPT }) as KeptDocument<Owner, Scope> | null;
    if (found === null) return [];
    const { owner, scope, title, locator, content, originals, origin } = found;
    return [{ owner, scope, title, locator, content, originals, origin }];
  }

  async _sourceSet({ owner, scope }: { owner: Owner; scope: Scope }) {
    const kept = await this.materials.find({ owner, scope, ...KEPT }).sort({ _id: 1 }).toArray() as KeptDocument<Owner, Scope>[];
    return { sources: kept.map(({ _id, importKey: _, deleted: __, ...data }) => ({ material: _id, data })) };
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

function requireIdentity(value: unknown): asserts value is string {
  if (!nonblank(value)) throw new TypeError("Provide a nonblank identity.");
}
