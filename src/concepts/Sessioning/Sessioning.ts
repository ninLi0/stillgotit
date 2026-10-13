import type { Collection, Db } from "mongodb";

export class NotSignedIn extends Error {}

const HOUR = 60 * 60 * 1000;
const IDLE = 7 * 24 * HOUR;
const LIFETIME = 90 * 24 * HOUR;

export type Session = string & { readonly __brand: "Session" };

interface SessionDocument<Subject> {
  _id: Session;
  subject: Subject;
  lastUsed: Date;
  expiresAt: Date;
}

/** Lets people stay signed in across requests without sending their password each time. */
export class SessioningConcept<Subject extends string> {
  private readonly sessions: Collection<SessionDocument<Subject>>;
  private indexes: Promise<unknown> | undefined;

  constructor(
    database: Db,
    name = "Sessioning",
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.sessions = database.collection(`${name.toLowerCase()}.sessions`);
  }

  /** Creates the index once. It makes MongoDB delete each session soon after it expires. If creating it fails, the next action tries again. */
  #ready() {
    this.indexes ??= this.sessions
      .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
      .catch((error: unknown) => {
        this.indexes = undefined;
        throw error;
      });
    return this.indexes;
  }

  async start({ subject }: { subject: Subject }) {
    const now = this.clock();
    const session = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url") as Session;
    const expiresAt = new Date(now.getTime() + LIFETIME);
    await this.#ready();
    await this.sessions.insertOne({ _id: session, subject, lastUsed: now, expiresAt });
    return { session, expiresAt };
  }

  async use({ session }: { session: Session }) {
    const now = this.clock();
    const used = await this.sessions.findOneAndUpdate(live(session, now), { $set: { lastUsed: now } });
    if (used === null) throw new NotSignedIn("Your session has ended. Sign in again.");
    return { subject: used.subject };
  }

  async end({ session }: { session: Session }) {
    const ended = await this.sessions.findOneAndDelete(live(session, this.clock()));
    if (ended === null) throw new NotSignedIn("Your session has ended. Sign in again.");
    return { session };
  }
}

function live(session: Session, now: Date) {
  return { _id: session, lastUsed: { $gt: new Date(now.getTime() - IDLE) }, expiresAt: { $gt: now } };
}
