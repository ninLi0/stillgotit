import { type Collection, type Db, MongoServerError } from "mongodb";

interface RecoveryKeyDocument {
  provider: string;
  subject: string;
  recoveryKey: string;
}

const MAX_KEY_ATTEMPTS = 3;

/** Keeps one registration key per provider identity. The caller verifies sign-in and expiry. */
export class RegistrationRecoveryStore {
  private readonly provider: string;
  private readonly keys: Collection<RecoveryKeyDocument>;
  private indexes: Promise<unknown> | undefined;

  constructor(
    database: Db,
    provider: string,
    name = "RegistrationRecovery",
    private readonly createKey: () => string = () => crypto.randomUUID(),
  ) {
    if (typeof provider !== "string") throw new TypeError("Provide an HTTP or HTTPS provider origin.");
    const address = new URL(provider);
    if (address.protocol !== "http:" && address.protocol !== "https:") {
      throw new TypeError("Provide an HTTP or HTTPS provider origin.");
    }
    // Match CommonsProvider's treatment of its configured origin.
    this.provider = address.origin;
    this.keys = database.collection(`${name.toLowerCase()}.keys`, {
      readPreference: "primary",
      readConcern: { level: "majority" },
      writeConcern: { w: "majority", j: true },
    });
  }

  #ready() {
    this.indexes ??= this.keys.createIndexes([
      { key: { provider: 1, subject: 1 }, unique: true },
      { key: { recoveryKey: 1 }, unique: true },
    ]).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  async getOrCreate({ subject }: { subject: string }): Promise<{ recoveryKey: string }> {
    if (typeof subject !== "string" || subject.trim().length === 0) {
      throw new TypeError("Provide a nonblank provider subject.");
    }
    await this.#ready();
    const identity = { provider: this.provider, subject };
    const existing = await this.keys.findOne(identity);
    if (existing !== null) return savedKey(existing);

    for (let attempt = 0; attempt < MAX_KEY_ATTEMPTS; attempt += 1) {
      const recoveryKey = this.createKey();
      if (typeof recoveryKey !== "string" || recoveryKey.trim().length === 0) {
        throw new Error("The recovery key generator returned an invalid key.");
      }
      try {
        await this.keys.findOneAndUpdate(
          identity,
          { $setOnInsert: { recoveryKey } },
          { upsert: true, returnDocument: "after", includeResultMetadata: false },
        );
        // Read committed state even if the upsert matched another client's insert.
        return savedKey(await this.keys.findOne(identity));
      } catch (error) {
        if (!(error instanceof MongoServerError) || error.code !== 11000) throw error;

        // A competing request may already have saved this identity's key.
        const winner = await this.keys.findOne(identity);
        if (winner !== null) return savedKey(winner);

        // Retry only a candidate-key collision. An unrelated index failure is an error.
        if (error.keyPattern?.recoveryKey !== 1 || Object.keys(error.keyPattern).length !== 1) throw error;
      }
    }
    throw new Error("Could not allocate a unique recovery key.");
  }
}

function savedKey(record: RecoveryKeyDocument | null): { recoveryKey: string } {
  if (record === null || typeof record.recoveryKey !== "string" || record.recoveryKey.trim().length === 0) {
    throw new Error("The saved recovery key is missing or invalid.");
  }
  return { recoveryKey: record.recoveryKey };
}
