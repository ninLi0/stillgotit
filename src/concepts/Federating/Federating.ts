import { type Collection, type Db, MongoServerError } from "mongodb";
import type { Provider } from "./provider.ts";

export class SignInExpired extends Error {}
export class SignInRefused extends Error {}
export class NotConfirmed extends Error {}
export class AlreadyLinked extends Error {}

const LIFETIME = 10 * 60 * 1000;

export type Attempt = string & { readonly __brand: "Attempt" };

interface AttemptDocument {
  _id: Attempt;
  nonce: string;
  verifier: string;
  expiresAt: Date;
  subject?: string;
  username?: string;
}

/** An attempt is in Confirmed Attempts once it has a subject. */
type ConfirmedAttempt = AttemptDocument & { subject: string };

const CONFIRMED = { subject: { $exists: true } };
const UNCONFIRMED = { subject: { $exists: false } };

interface LinkDocument<User> {
  subject: string;
  user: User;
}

/** Lets people sign in with an account they already have on another site, and come back to the same account each time. */
export class FederatingConcept<User extends string> {
  private readonly attempts: Collection<AttemptDocument>;
  private readonly links: Collection<LinkDocument<User>>;
  private indexes: Promise<unknown> | undefined;

  constructor(
    private readonly database: Db,
    private readonly provider: Provider,
    name = "Federating",
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.attempts = database.collection(`${name.toLowerCase()}.attempts`);
    this.links = database.collection(`${name.toLowerCase()}.links`);
  }

  /** Creates the indexes once. One makes MongoDB delete expired attempts, and the other makes MongoDB refuse a second link for the same subject, even when two requests arrive at once. If creating them fails, the next action tries again. */
  #ready() {
    this.indexes ??= Promise.all([
      // A minute's grace, so an attempt that expires while finish or link is running is still there.
      this.attempts.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 60 }),
      this.links.createIndex({ subject: 1 }, { unique: true }),
    ]).catch((error: unknown) => {
      this.indexes = undefined;
      throw error;
    });
    return this.indexes;
  }

  // The engine requires an input object even when an action has no input fields.
  async start(_input: Record<string, never>) {
    const attempt = unguessable() as Attempt;
    const nonce = unguessable();
    const verifier = unguessable();
    const expiresAt = new Date(this.clock().getTime() + LIFETIME);
    await this.#ready();
    await this.attempts.insertOne({ _id: attempt, nonce, verifier, expiresAt });
    return { attempt, expiresAt, address: this.provider.address({ nonce, verifier }) };
  }

  async finish({ attempt, nonce, code }: { attempt: Attempt; nonce: string; code: string }) {
    const found = await this.attempts.findOne({ _id: attempt, expiresAt: { $gt: this.clock() }, ...UNCONFIRMED });
    if (found === null || found.nonce !== nonce) throw new SignInExpired("This sign-in has expired. Start again.");

    const identity = await this.provider.redeem({ code, verifier: found.verifier });
    if (identity === undefined) {
      throw new SignInRefused("The other site didn't confirm this sign-in. Start again.");
    }

    // Commons may answer after expiry. Recheck as part of the confirmation write.
    const { matchedCount } = await this.attempts.updateOne(
      { _id: attempt, expiresAt: { $gt: this.clock() }, ...UNCONFIRMED },
      { $set: { subject: identity.subject, username: identity.username } },
    );
    if (matchedCount === 0) throw new SignInExpired("This sign-in has expired. Start again.");
    return { username: identity.username };
  }

  async link({ attempt, user }: { attempt: Attempt; user: User }) {
    await this.#ready();
    const confirmed = await this.#confirmed(attempt);
    if (confirmed === null) throw new NotConfirmed("This sign-in hasn't been confirmed.");
    if (confirmed.expiresAt <= this.clock()) throw new SignInExpired("This sign-in has expired. Start again.");
    // The unique subject index refuses a second link, even when two requests arrive at once.
    // MongoDB on the platform has no transactions, so a link that lands after expiry is removed again.
    try {
      await this.links.insertOne({ subject: confirmed.subject, user });
    } catch (error) {
      if (isDuplicate(error)) throw new AlreadyLinked("This account on the other site is already linked.");
      throw error;
    }
    if (confirmed.expiresAt <= this.clock()) {
      await this.links.deleteOne({ subject: confirmed.subject, user });
      throw new SignInExpired("This sign-in has expired. Start again.");
    }
    return { user };
  }

  async _identity({ attempt }: { attempt: Attempt }) {
    const confirmed = await this.#confirmed(attempt);
    // Read the clock after MongoDB replies. Older confirmations without a
    // saved username require a fresh sign-in and are not repaired by a query.
    if (confirmed === null || typeof confirmed.username !== "string" || confirmed.expiresAt <= this.clock()) return [];
    return [{ subject: confirmed.subject, username: confirmed.username, expiresAt: confirmed.expiresAt }];
  }

  async _user({ attempt }: { attempt: Attempt }) {
    const confirmed = await this.#confirmed(attempt);
    if (confirmed === null) return [];
    const link = await this.links.findOne({ subject: confirmed.subject });
    return link === null ? [] : [{ user: link.user }];
  }

  async _linkable({ attempt }: { attempt: Attempt }) {
    const confirmed = await this.#confirmed(attempt);
    if (confirmed === null || confirmed.expiresAt <= this.clock()) return { linkable: false };
    const link = await this.links.findOne({ subject: confirmed.subject });
    return { linkable: link === null };
  }

  #confirmed(attempt: Attempt) {
    return this.attempts.findOne<ConfirmedAttempt>({ _id: attempt, ...CONFIRMED });
  }
}

function unguessable(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** 11000 is the code MongoDB gives a write that breaks a unique index. */
const isDuplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
