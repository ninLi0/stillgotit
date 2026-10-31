import { MongoServerError, type Collection, type Db, type Filter } from "mongodb";

/** One archived item. The owner and the item together are the key, so an item is archived at most once for each owner. */
interface ArchivedDocument<User, Item> {
  owner: User;
  item: Item;
  archivedAt: Date;
}

const duplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;

/**
 * Remembers which of a person's items they set aside, and when, so an application can leave those items out of its
 * everyday lists and show them apart. Items are opaque keys: Archiving never reads or changes them. The application
 * checks that an item is the owner's before it calls archive or restore.
 */
export class Archiving<User extends string = string, Item extends string = string> {
  readonly #archived: Collection<ArchivedDocument<User, Item>>;
  #indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "Archiving", private readonly clock = () => new Date()) {
    this.#archived = database.collection(`${name.toLowerCase()}.items`);
  }

  /** The unique index on owner and item, which also serves the owner's lists. It is created once, before the first write. */
  #ready(): Promise<unknown> {
    this.#indexes ??= this.#archived.createIndex({ owner: 1, item: 1 }, { unique: true }).catch((error: unknown) => {
      this.#indexes = undefined;
      throw error;
    });
    return this.#indexes;
  }

  #key(owner: User, item: Item): Filter<ArchivedDocument<User, Item>> {
    return { owner, item } as Filter<ArchivedDocument<User, Item>>;
  }

  /**
   * Archives the item for the owner. An item that is already archived keeps the time it was first archived, so a
   * repeated request changes nothing. One insert keyed by the owner and the item: of two concurrent archives, the
   * unique index refuses the later insert, and that archive finds the saved item and changes nothing.
   */
  async archive({ owner, item }: { owner: User; item: Item }): Promise<Record<string, never>> {
    requireIdentity(owner); requireIdentity(item);
    await this.#ready();
    try {
      // An upsert copies the owner and the item from the key, so only the time is set, and only on insert.
      await this.#archived.updateOne(this.#key(owner, item), { $setOnInsert: { archivedAt: this.clock() } }, { upsert: true });
    } catch (error) {
      if (!duplicate(error)) throw error;
    }
    return {};
  }

  /** Forgets that the owner archived the item. Restoring an item that is not archived succeeds and changes nothing. */
  async restore({ owner, item }: { owner: User; item: Item }): Promise<Record<string, never>> {
    requireIdentity(owner); requireIdentity(item);
    await this.#archived.deleteOne(this.#key(owner, item));
    return {};
  }

  /** When the owner archived the item, or no row when it is not archived. */
  async _archived({ owner, item }: { owner: User; item: Item }): Promise<Array<{ archivedAt: Date }>> {
    requireIdentity(owner); requireIdentity(item);
    const saved = await this.#archived.findOne(this.#key(owner, item));
    return saved ? [{ archivedAt: saved.archivedAt }] : [];
  }

  /** Each item the owner archived, most recently archived first; items archived at the same time are ordered by item. */
  async _items({ owner }: { owner: User }): Promise<Array<{ item: Item; archivedAt: Date }>> {
    requireIdentity(owner);
    const saved = await this.#archived.find({ owner } as Filter<ArchivedDocument<User, Item>>).sort({ archivedAt: -1, item: 1 }).toArray();
    return saved.map(({ item, archivedAt }) => ({ item: item as Item, archivedAt }));
  }

  /** Every item the owner archived, as one set ordered by item. */
  async _itemSet({ owner }: { owner: User }): Promise<{ items: Item[] }> {
    requireIdentity(owner);
    const saved = await this.#archived.find({ owner } as Filter<ArchivedDocument<User, Item>>, { projection: { item: 1 } }).sort({ item: 1 }).toArray();
    return { items: saved.map(({ item }) => item as Item) };
  }
}

function requireIdentity(value: unknown): asserts value is string {
  if (typeof value !== "string" || !value.trim()) throw new TypeError("Provide a nonblank identity.");
}
