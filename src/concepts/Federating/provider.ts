import { createHash } from "node:crypto";

/** The site people sign in with: Commons when running, memory in tests. */
export interface Provider {
  /**
   * The address that sends a browser to the site to sign in. It carries `nonce` back to the app's callback,
   * and a hash of `verifier`, so the site issues a code that redeems only with that verifier.
   */
  address(request: { nonce: string; verifier: string }): string;
  /** The site's user for `code`, or undefined when the site refuses the code or `verifier`, or doesn't answer. */
  redeem(request: { code: string; verifier: string }): Promise<Identity | undefined>;
}

export interface Identity {
  /** The site's stable id for its user, which stays the same when their username or email changes. */
  subject: string;
  username: string;
}

export interface CommonsProviderOptions {
  /** Commons' origin, such as `https://class.mit-sdg.dev`. */
  origin: string;
  /** This app's origin, the one browsers use. Commons sends each code to `/auth/commons/callback` on it. */
  app: string;
  /** How long to wait for Commons to redeem a code, in milliseconds. */
  timeout?: number;
}

/** Commons at `origin`. Commons spends a code the first time anyone presents it, so `redeem` sends one request and never retries. */
export class CommonsProvider implements Provider {
  private readonly origin: string;
  private readonly app: string;
  private readonly timeout: number;

  constructor({ origin, app, timeout = 10_000 }: CommonsProviderOptions) {
    this.origin = new URL(origin).origin;
    this.app = new URL(app).origin;
    this.timeout = timeout;
  }

  address({ nonce, verifier }: { nonce: string; verifier: string }): string {
    const address = new URL("/connect", this.origin);
    address.searchParams.set("app", this.app);
    address.searchParams.set("state", nonce);
    address.searchParams.set("code_challenge", challenge(verifier));
    address.searchParams.set("code_challenge_method", "S256");
    return address.href;
  }

  async redeem({ code, verifier }: { code: string; verifier: string }): Promise<Identity | undefined> {
    try {
      const response = await fetch(new URL("/api/connect/redeem", this.origin), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, app: this.app, code_verifier: verifier }),
        redirect: "error",
        signal: AbortSignal.timeout(this.timeout),
      });
      if (response.status === 400) return undefined;
      if (!response.ok) throw new Error(`status ${response.status}`);
      const { user, username } = (await response.json()) as { user?: unknown; username?: unknown };
      if (typeof user !== "string" || typeof username !== "string") throw new Error("no user in the answer");
      return { subject: user, username };
    } catch (error) {
      console.warn(`Commons at ${this.origin} didn't redeem a sign-in code: ${error}`);
      return undefined;
    }
  }
}

/** Commons in memory, for tests. Each code redeems once, and only with the verifier its address was made for. */
export class MemoryProvider implements Provider {
  private readonly codes = new Map<string, { identity: Identity; challenge: string }>();

  /** Stands in for a person approving the app on the site: returns the code and state their browser carries to the callback. */
  approve(address: string, identity: Identity): { code: string; state: string } {
    const { searchParams } = new URL(address);
    const code = crypto.randomUUID();
    this.codes.set(code, { identity, challenge: searchParams.get("code_challenge") ?? "" });
    return { code, state: searchParams.get("state") ?? "" };
  }

  address({ nonce, verifier }: { nonce: string; verifier: string }): string {
    const search = new URLSearchParams({ state: nonce, code_challenge: challenge(verifier) });
    return `memory://connect?${search}`;
  }

  async redeem({ code, verifier }: { code: string; verifier: string }): Promise<Identity | undefined> {
    const issued = this.codes.get(code);
    this.codes.delete(code);
    return issued?.challenge === challenge(verifier) ? issued.identity : undefined;
  }
}

/** PKCE's S256 challenge: the SHA-256 hash of the verifier, in base64url without padding. */
function challenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
