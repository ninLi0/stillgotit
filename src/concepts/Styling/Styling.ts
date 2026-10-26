import { MongoServerError, type Collection, type Db, type Filter } from "mongodb";

/** One remembered style. The owner and the item together are the key, so an item has at most one style for each owner. */
interface StyleDocument<User, Item, Style> {
  owner: User;
  item: Item;
  style: Style;
}

const duplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;

/**
 * Remembers the look each person chose for each of their items, so the choice follows them to every device.
 * Styles are opaque: Styling stores what it is given and returns it unchanged. The application validates them, and
 * checks that an item is the owner's, before it calls choose or clear.
 */
export class Styling<User extends string = string, Item extends string = string, Style = unknown> {
  readonly #styles: Collection<StyleDocument<User, Item, Style>>;
  #indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "Styling") {
    this.#styles = database.collection(`${name.toLowerCase()}.styles`);
  }

  /** The unique index on owner and item, which also serves the owner's list. It is created once, before the first write. */
  #ready(): Promise<unknown> {
    this.#indexes ??= this.#styles.createIndex({ owner: 1, item: 1 }, { unique: true }).catch((error: unknown) => {
      this.#indexes = undefined;
      throw error;
    });
    return this.#indexes;
  }

  #key(owner: User, item: Item): Filter<StyleDocument<User, Item, Style>> {
    return { owner, item } as Filter<StyleDocument<User, Item, Style>>;
  }

  /** Makes style the owner's style for the item. One write keyed by the owner and the item, so the later of two concurrent writes wins. */
  async choose({ owner, item, style }: { owner: User; item: Item; style: Style }): Promise<Record<string, never>> {
    await this.#ready();
    const document = { owner, item, style } as StyleDocument<User, Item, Style>;
    try {
      await this.#styles.replaceOne(this.#key(owner, item), document, { upsert: true });
    } catch (error) {
      // Two first choices for the same item can both try to insert. The unique index refuses the later insert, and
      // that write then finds the saved style and replaces it.
      if (!duplicate(error)) throw error;
      await this.#styles.replaceOne(this.#key(owner, item), document, { upsert: true });
    }
    return {};
  }

  /** Forgets the owner's style for the item. Clearing when nothing is saved succeeds and changes nothing. */
  async clear({ owner, item }: { owner: User; item: Item }): Promise<Record<string, never>> {
    await this.#styles.deleteOne(this.#key(owner, item));
    return {};
  }

  /** The owner's remembered style for the item, or no row when there is none. */
  async _style({ owner, item }: { owner: User; item: Item }): Promise<Array<{ style: Style }>> {
    const saved = await this.#styles.findOne(this.#key(owner, item));
    return saved ? [{ style: saved.style }] : [];
  }

  /** One row for each item the owner has a remembered style for, ordered by item. */
  async _styles({ owner }: { owner: User }): Promise<Array<{ item: Item; style: Style }>> {
    const saved = await this.#styles.find({ owner } as Filter<StyleDocument<User, Item, Style>>).sort({ item: 1 }).toArray();
    return saved.map(({ item, style }) => ({ item: item as Item, style: style as Style }));
  }
}
