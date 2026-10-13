import { type Collection, type Db, MongoServerError } from "mongodb";

export class InvalidUsername extends Error {}
export class InvalidRecoveryKey extends Error {}
export class RecoveryKeyConflict extends Error {}
export class UsernameTaken extends Error {}

const USERNAME = /^[A-Za-z0-9_-]{3,32}$/;

export type User = string & { readonly __brand: "User" };

interface UserDocument {
  _id: User;
  username: string;
  // Accounts written by the earlier version may not have a key.
  recoveryKey?: string;
}

/** Lets people choose a username that others can find them by. */
export class RegisteringConcept {
  private readonly users: Collection<UserDocument>;
  private indexes: Promise<unknown> | undefined;

  constructor(database: Db, name = "Registering") {
    this.users = database.collection(`${name.toLowerCase()}.users`);
  }

  /** Enforces uniqueness across clients. A partial index preserves older accounts without keys. */
  #ready() {
    this.indexes ??= this.users
      .createIndexes([
        { key: { username: 1 }, unique: true },
        { key: { recoveryKey: 1 }, unique: true, partialFilterExpression: { recoveryKey: { $type: "string" } } },
      ])
      .catch((error: unknown) => {
        this.indexes = undefined;
        throw error;
      });
    return this.indexes;
  }

  async register({ username, recoveryKey }: { username: string; recoveryKey: string }) {
    if (typeof username !== "string" || !USERNAME.test(username)) {
      throw new InvalidUsername("A username must have 3 to 32 letters, digits, underscores, or hyphens.");
    }
    if (typeof recoveryKey !== "string" || recoveryKey.trim().length === 0) {
      throw new InvalidRecoveryKey("Provide a nonblank recovery key.");
    }
    await this.#ready();
    const existing = await this.users.findOne({ recoveryKey });
    if (existing !== null) return this.#reuse(existing, username);

    const user = crypto.randomUUID() as User;
    try {
      // One write saves both the account and the reference needed to recover it.
      await this.users.insertOne({ _id: user, username, recoveryKey });
    } catch (error) {
      if (!isDuplicate(error)) throw error;
      // Another client may have registered this key after the first read.
      const saved = await this.users.findOne({ recoveryKey });
      if (saved !== null) return this.#reuse(saved, username);
      if (await this.users.findOne({ username })) throw new UsernameTaken("That username is taken.");
      // A different database constraint failed. Do not label it a username conflict.
      throw error;
    }
    return { user };
  }

  async _byUsername({ username }: { username: string }) {
    const found = await this.users.findOne({ username });
    return found === null ? [] : [{ user: found._id }];
  }

  async _username({ user }: { user: User }) {
    const found = await this.users.findOne({ _id: user });
    return found === null ? [] : [{ username: found.username }];
  }

  async _byRecoveryKey({ recoveryKey }: { recoveryKey: string }) {
    // Missing keys must not match older accounts that have no recoveryKey field.
    if (typeof recoveryKey !== "string" || recoveryKey.trim().length === 0) return [];
    const found = await this.users.findOne({ recoveryKey });
    return found === null ? [] : [{ user: found._id }];
  }

  #reuse(found: UserDocument, username: string) {
    if (found.username !== username) {
      throw new RecoveryKeyConflict("This recovery key already belongs to a different username.");
    }
    return { user: found._id };
  }
}

/** 11000 is the code MongoDB gives a write that breaks a unique index. */
const isDuplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
