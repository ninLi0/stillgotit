import type { Collection, Db } from "mongodb";

/** One remembered choice. The user is the key, so each user has at most one option. */
interface ChoiceDocument<User, Option> {
  _id: User;
  option: Option;
}

/**
 * Remembers which offered option each person chose for one setting, so the choice follows them to every device.
 * Options are opaque: Preferring stores what it is given and returns it unchanged. The application validates them.
 */
export class Preferring<User extends string = string, Option = unknown> {
  readonly #choices: Collection<ChoiceDocument<User, Option>>;

  constructor(database: Db, name = "Preferring") {
    this.#choices = database.collection(`${name.toLowerCase()}.choices`);
  }

  /** Makes option the user's choice. One write keyed by the user, so the later of two concurrent writes wins. */
  async set({ user, option }: { user: User; option: Option }): Promise<Record<string, never>> {
    await this.#choices.replaceOne({ _id: user }, { option }, { upsert: true });
    return {};
  }

  /** Forgets the user's choice. Clearing when nothing is saved succeeds and changes nothing. */
  async clear({ user }: { user: User }): Promise<Record<string, never>> {
    await this.#choices.deleteOne({ _id: user });
    return {};
  }

  /** The user's remembered option, or no row when they have none. */
  async _choice({ user }: { user: User }): Promise<Array<{ option: Option }>> {
    const saved = await this.#choices.findOne({ _id: user });
    return saved ? [{ option: saved.option }] : [];
  }
}
