import { type Collection, type Db } from "mongodb";
import { isMediaList, nonblank, type MediaList } from "./media.ts";

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

interface MaterialDocument<Learner extends string, Scope extends string> extends MaterialData<Learner, Scope> {
  _id: Material;
}

export class InvalidTutoringMaterial extends Error {
  readonly code = "INVALID_TUTORING_MATERIAL";

  constructor() {
    super("Provide a title, source location, and readable material.");
    this.name = "InvalidTutoringMaterial";
  }
}

/** Material storage from GroundedTutoring. Lesson and practice methods follow in later steps. */
export class GroundedTutoring<Learner extends string = string, Scope extends string = string> {
  private readonly materials: Collection<MaterialDocument<Learner, Scope>>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "GroundedTutoring") {
    this.materials = database.collection(`${name.toLowerCase()}.materials`);
  }

  #ready() {
    this.indexes ??= this.materials.createIndex({ owner: 1, scope: 1, _id: 1 }).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  async addMaterial(input: MaterialData<Learner, Scope>): Promise<{ material: Material }> {
    if (input === null || typeof input !== "object" || Array.isArray(input)) throw new InvalidTutoringMaterial();
    const { owner, scope, title, locator, content, originals, origin } = input;
    // The specification's refusal branch: invalid fields or no readable source.
    if (!nonblank(owner) || !nonblank(scope) || !nonblank(title) || !nonblank(locator) ||
      typeof content !== "string" || !isMediaList(originals) ||
      (origin !== "COURSE" && origin !== "REFERENCE") ||
      (!nonblank(content) && !originals.some((source) => source.renditions.length > 0))) {
      throw new InvalidTutoringMaterial();
    }

    // Snapshot before waiting, so caller edits cannot change an already validated record.
    const material = crypto.randomUUID() as Material;
    const document = structuredClone({ _id: material, owner, scope, title, locator, content, originals, origin });
    await this.#ready();
    await this.materials.insertOne(document);
    return { material };
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
}

function requireIdentity(value: unknown): asserts value is string {
  if (!nonblank(value)) throw new TypeError("Provide a nonblank identity.");
}
