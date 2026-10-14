import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { KeyedLocks } from "./locks.ts";

const ISSUER = "https://auth.openai.com";
const RESOURCE = "https://api.openai.com/v1";
const TOKEN = `${ISSUER}/api/accounts/oauth/token`;
const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const opaque = () => randomBytes(32).toString("base64url");
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
interface Credential {
  client_id: string; subject: string; email: string; issuer: string;
  access_token: string; refresh_token: string; id_token: string; scopes: string[]; expiresAt: number; model?: string; effort?: string;
}
interface AccountFile { active: string | null; accounts: Credential[] }
interface Pending {
  owner: string; state: string; nonce: string; verifier: string; redirectUri: string;
  clientId: string; subject?: string; expiresAt: number; verified?: Credential;
}
interface TokenReply { access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string; token_type: string }
export interface ModelChoice {
  slug: string; display_name: string;
  default_reasoning_level: string;
  supported_reasoning_levels: { effort: string; description: string }[];
}
// The catalog also contains execution modes. Expose only published Responses API effort values.
const responseEfforts = new Set(["none", "minimal", "low", "medium", "high", "xhigh", "max"]);

/** Provider credentials only. Commons remains the authority for the app's learner identity. */
export class ChatGPTConnection {
  private readonly pending = new Map<string, Pending>();
  private readonly locks = new KeyedLocks();
  private readonly jwks = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks.json`));
  private host: Promise<string> | undefined;
  constructor(private readonly publicOrigin: string, private readonly directory = resolve(".data/chatgpt")) {}

  async start(owner: string, clientId?: string): Promise<{ attempt: string; address: string }> {
    const saved = await this.accounts(owner);
    const selected = clientId ? saved.accounts.find((account) => account.client_id === clientId) : undefined;
    if (clientId && !selected) throw new Error("Choose one of your saved ChatGPT connections.");
    const origin = new URL(this.publicOrigin);
    const redirectUri = `http://127.0.0.1:${origin.port || "80"}/auth/chatgpt/return`;
    const attempt = crypto.randomUUID();
    const pending: Pending = {
      owner, state: opaque(), nonce: opaque(), verifier: opaque(), redirectUri,
      clientId: selected?.client_id ?? "dynamic_agent_client", subject: selected?.subject, expiresAt: Date.now() + 10 * 60_000,
    };
    const parameters = new URLSearchParams({
      client_id: pending.clientId, ext_agent_host_id: await this.hostId(), response_type: "code",
      redirect_uri: redirectUri, scope: scopes, resource: RESOURCE, state: pending.state, nonce: pending.nonce,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(pending.verifier).digest("base64url"),
    });
    if (!selected) parameters.set("agent_name_hint", "StillGotIt");
    this.pending.set(attempt, pending);
    for (const [key, value] of this.pending) if (value.expiresAt <= Date.now()) this.pending.delete(key);
    return { attempt, address: `${ISSUER}/api/accounts/authorize?${parameters}` };
  }

  async callback(parameters: URLSearchParams): Promise<void> {
    const state = parameters.get("state");
    const entry = [...this.pending.entries()].find(([, pending]) => pending.state === state);
    if (!entry) throw new Error("This ChatGPT sign-in was not started here. Start again.");
    const [attempt] = entry;
    await this.locks.run(`attempt:${attempt}`, async () => {
      const pending = this.pending.get(attempt);
      if (!pending || pending.expiresAt <= Date.now()) throw new Error("ChatGPT sign-in expired. Start again.");
      if (pending.verified) return;
      if (parameters.has("error")) { this.pending.delete(attempt); throw new Error("ChatGPT access was not approved. You can try again."); }
      const suppliedClient = parameters.get("client_id"), code = parameters.get("code");
      const clientId = pending.clientId === "dynamic_agent_client" ? suppliedClient : pending.clientId;
      if (!clientId || clientId === "dynamic_agent_client" || clientId.length > 1024 || /\s/.test(clientId) || !code ||
        (pending.clientId !== "dynamic_agent_client" && suppliedClient && suppliedClient !== pending.clientId)) {
        throw new Error("ChatGPT returned an incomplete registration. Start again.");
      }
      const tokens = await this.exchange({ grant_type: "authorization_code", client_id: clientId, code,
        code_verifier: pending.verifier, redirect_uri: pending.redirectUri, resource: RESOURCE });
      if (!tokens.id_token) throw new Error("ChatGPT did not return a verified identity.");
      const { payload } = await jwtVerify(tokens.id_token, this.jwks, {
        issuer: ISSUER, audience: clientId, requiredClaims: ["sub", "exp", "iat"], clockTolerance: 5,
      });
      if (payload.nonce !== pending.nonce || (pending.subject && pending.subject !== payload.sub) || pending.expiresAt <= Date.now()) {
        throw new Error("ChatGPT identity did not match this sign-in attempt.");
      }
      const granted = (tokens.scope ?? "").split(" ");
      if (!granted.includes("chatgpt.tokens.use.direct") || !granted.includes("resource.invoke")) {
        throw new Error("Allow ChatGPT plan usage to use the AI tutor.");
      }
      pending.verified = {
        client_id: clientId, subject: payload.sub!, issuer: ISSUER,
        email: typeof payload.email === "string" ? payload.email : "ChatGPT account",
        access_token: tokens.access_token, refresh_token: tokens.refresh_token ?? "", id_token: tokens.id_token,
        scopes: granted, expiresAt: Date.now() + tokens.expires_in * 1000,
      };
    });
  }

  async finish(owner: string, attempt: string): Promise<void> {
    const pending = this.pending.get(attempt);
    if (!pending || pending.owner !== owner || pending.expiresAt <= Date.now() || !pending.verified) {
      throw new Error("Return to the account that started ChatGPT sign-in, or start again.");
    }
    await this.locks.run(`owner:${owner}`, async () => {
      const saved = await this.accounts(owner), credential = pending.verified!;
      const existing = saved.accounts.find((account) => account.client_id === credential.client_id);
      if (existing && existing.subject !== credential.subject) throw new Error("This registration belongs to a different ChatGPT account.");
      credential.model = existing?.model;
      credential.effort = existing?.effort;
      saved.accounts = [...saved.accounts.filter((account) => account.client_id !== credential.client_id), credential];
      saved.active = credential.client_id;
      await this.save(owner, saved);
      this.pending.delete(attempt);
    });
  }

  async status(owner: string) {
    const saved = await this.accounts(owner);
    const active = saved.accounts.find((account) => account.client_id === saved.active);
    return { connected: Boolean(active?.access_token), active: saved.active,
      model: active?.model ?? "", effort: active?.effort ?? "", accounts: saved.accounts.map((account) => ({
        id: account.client_id, label: `${account.email} (${account.client_id.slice(-6)})`, connected: Boolean(account.access_token),
      })) };
  }

  async select(owner: string, clientId: string): Promise<void> {
    await this.locks.run(`owner:${owner}`, async () => {
      const saved = await this.accounts(owner);
      if (!saved.accounts.some((account) => account.client_id === clientId && account.access_token)) throw new Error("Reconnect that ChatGPT account first.");
      saved.active = clientId;
      await this.save(owner, saved);
    });
  }

  async models(owner: string): Promise<ModelChoice[]> {
    return this.modelChoices(await this.credential(owner));
  }

  private async modelChoices(credential: Credential): Promise<ModelChoice[]> {
    const response = await fetch(`${RESOURCE}/models`, {
      headers: { Authorization: `Bearer ${credential.access_token}` }, redirect: "error", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Could not load the models for your ChatGPT account. Reconnect and try again.");
    const result = await response.json() as { models?: {
      slug: string; display_name: string; visibility: string; default_reasoning_level?: string;
      supported_reasoning_levels?: { effort: string; description?: string }[];
    }[] };
    const models = result.models?.filter((model) => model.visibility === "list" && typeof model.slug === "string" && typeof model.display_name === "string")
      .map(({ slug, display_name, default_reasoning_level, supported_reasoning_levels }) => {
        const levels = Array.isArray(supported_reasoning_levels) ? supported_reasoning_levels
          .filter((level) => level && responseEfforts.has(level.effort))
          .filter((level, index, all) => all.findIndex((other) => other.effort === level.effort) === index)
          .map(({ effort, description }) => ({ effort, description: typeof description === "string" ? description : "" })) : [];
        return { slug, display_name, supported_reasoning_levels: levels,
          default_reasoning_level: levels.find((level) => level.effort === default_reasoning_level)?.effort ?? levels[0]?.effort ?? "" };
      });
    if (!models?.length) throw new Error("No eligible models were returned for this ChatGPT account.");
    return models;
  }

  async selectModel(owner: string, model: string, effort?: string): Promise<void> {
    const credential = await this.credential(owner);
    const choice = (await this.modelChoices(credential)).find((item) => item.slug === model);
    if (!choice) throw new Error("Choose a model available to your account.");
    if (effort && !choice.supported_reasoning_levels.some((level) => level.effort === effort)) {
      throw new Error("Choose an effort level supported by this model.");
    }
    await this.locks.run(`owner:${owner}`, async () => {
      const saved = await this.accounts(owner), active = saved.accounts.find((account) => account.client_id === saved.active);
      if (!active?.access_token || active.client_id !== credential.client_id) throw new Error("Your ChatGPT account changed. Refresh and choose the model again.");
      active.model = model;
      const preferred = effort ?? active.effort;
      active.effort = choice.supported_reasoning_levels.find((level) => level.effort === preferred)?.effort ?? choice.default_reasoning_level;
      await this.save(owner, saved);
    });
  }

  async respond(owner: string, instructions: string, content: unknown[], schema: Record<string, unknown>): Promise<unknown> {
    const credential = await this.credential(owner), choices = await this.modelChoices(credential);
    const choice = credential.model ? choices.find((item) => item.slug === credential.model) : choices[0];
    if (!choice) throw new Error("Your selected model is no longer available. Choose another model.");
    const effort = choice.supported_reasoning_levels.find((level) => level.effort === credential.effort)?.effort ?? choice.default_reasoning_level;
    const response = await fetch(`${RESOURCE}/responses`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(180_000),
      headers: { Authorization: `Bearer ${credential.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: choice.slug, instructions, input: [{ role: "user", content }], store: false, stream: true,
        ...(effort ? { reasoning: { effort } } : {}),
        text: { format: { type: "json_schema", name: "stillgotit_result", strict: true, schema } } }),
    });
    if (!response.ok || !response.body) throw new Error(response.status === 429
      ? "Your ChatGPT plan limit was reached. Check ChatGPT Settings → Usage and try later."
      : "ChatGPT could not start this response. Check the connection and selected model.");
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = "", completed: unknown;
    const parts = new Map<string, { outputIndex: number; contentIndex: number; text: string }>();
    const savePart = (outputIndex: number, contentIndex: number, text: unknown, append = false) => {
      if (typeof text !== "string") return;
      const key = `${outputIndex}:${contentIndex}`;
      parts.set(key, { outputIndex, contentIndex, text: (append ? parts.get(key)?.text ?? "" : "") + text });
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        buffer = buffer.replaceAll("\r\n", "\n");
        if (buffer.length > 4 * 1024 * 1024) throw new Error("The ChatGPT response was too large. Use a smaller request.");
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
          if (!data || data === "[DONE]") continue;
          const event = JSON.parse(data);
          if (["error", "response.failed", "response.incomplete"].includes(event.type)) throw new Error("ChatGPT did not finish the response. Your saved work is available to retry.");
          if (event.type === "response.output_text.delta") savePart(event.output_index ?? 0, event.content_index ?? 0, event.delta, true);
          if (event.type === "response.output_text.done") savePart(event.output_index ?? 0, event.content_index ?? 0, event.text);
          if (event.type === "response.content_part.done" && event.part?.type === "output_text") savePart(event.output_index ?? 0, event.content_index ?? 0, event.part.text);
          if (event.type === "response.output_item.done") {
            event.item?.content?.forEach((part: { type: string; text?: string }, index: number) => {
              if (part.type === "output_text") savePart(event.output_index ?? 0, index, part.text);
            });
          }
          if (event.type === "response.completed") {
            if (event.response?.status && event.response.status !== "completed") throw new Error("ChatGPT did not finish the response. Try again.");
            event.response?.output?.forEach((item: { content?: { type: string; text?: string }[] }, outputIndex: number) => {
              item.content?.forEach((part, contentIndex) => { if (part.type === "output_text") savePart(outputIndex, contentIndex, part.text); });
            });
            const output = [...parts.values()].sort((a, b) => a.outputIndex - b.outputIndex || a.contentIndex - b.contentIndex).map((part) => part.text).join("");
            if (!output) throw new Error("ChatGPT returned no usable answer.");
            completed = JSON.parse(output);
            // Completion ends the response even when the event stream stays open.
            return completed;
          }
        }
        if (done) break;
      }
    } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    if (completed === undefined) throw new Error("The ChatGPT stream stopped before completion. Try again.");
    return completed;
  }

  async disconnect(owner: string): Promise<{ revoked: boolean }> {
    return this.locks.run(`owner:${owner}`, async () => {
      const saved = await this.accounts(owner), active = saved.accounts.find((account) => account.client_id === saved.active);
      let revoked = true;
      if (active?.refresh_token) {
        try {
          const discovery = await fetch(`${ISSUER}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(10_000), redirect: "error" });
          const metadata = await discovery.json() as { revocation_endpoint?: string };
          const endpoint = new URL(metadata.revocation_endpoint ?? "");
          if (endpoint.origin !== ISSUER) throw new Error("Invalid endpoint");
          const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
            body: new URLSearchParams({ token: active.refresh_token, token_type_hint: "refresh_token", client_id: active.client_id }) });
          revoked = response.status === 200;
        } catch { revoked = false; }
      }
      if (active) { active.access_token = ""; active.refresh_token = ""; active.id_token = ""; }
      saved.active = null;
      await this.save(owner, saved);
      return { revoked };
    });
  }

  private async credential(owner: string): Promise<Credential> {
    return this.locks.run(`owner:${owner}`, async () => {
      const saved = await this.accounts(owner), active = saved.accounts.find((account) => account.client_id === saved.active);
      if (!active?.access_token) throw new Error("Connect your ChatGPT account to use the tutor.");
      if (active.expiresAt > Date.now() + 60_000) return active;
      if (!active.refresh_token) throw new Error("Reconnect ChatGPT to continue.");
      const reply = await this.exchange({ grant_type: "refresh_token", client_id: active.client_id,
        refresh_token: active.refresh_token, resource: RESOURCE });
      if (reply.id_token) {
        const { payload } = await jwtVerify(reply.id_token, this.jwks, { issuer: ISSUER, audience: active.client_id, requiredClaims: ["sub", "exp", "iat"] });
        if (payload.sub !== active.subject) throw new Error("The refreshed ChatGPT identity changed. Reconnect.");
      }
      Object.assign(active, { access_token: reply.access_token, refresh_token: reply.refresh_token ?? active.refresh_token,
        id_token: reply.id_token ?? active.id_token, scopes: reply.scope?.split(" ") ?? active.scopes,
        expiresAt: Date.now() + reply.expires_in * 1000 });
      if (!active.scopes.includes("chatgpt.tokens.use.direct") || !active.scopes.includes("resource.invoke")) throw new Error("ChatGPT plan access was removed. Reconnect to continue.");
      await this.save(owner, saved);
      return active;
    });
  }

  private async exchange(parameters: Record<string, string>): Promise<TokenReply> {
    const response = await fetch(TOKEN, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), body: new URLSearchParams(parameters) });
    if (!response.ok) throw new Error("ChatGPT authorization could not finish. Start a fresh connection.");
    const reply = await response.json() as TokenReply;
    if (typeof reply.access_token !== "string" || !reply.access_token || reply.token_type?.toLowerCase() !== "bearer" ||
      !Number.isFinite(reply.expires_in) || reply.expires_in <= 0) throw new Error("ChatGPT returned incomplete credentials.");
    return reply;
  }
  private hostId(): Promise<string> {
    return this.host ??= (async () => {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const path = resolve(this.directory, "host-id");
      try { await writeFile(path, `urn:uuid:${crypto.randomUUID()}`, { flag: "wx", mode: 0o600 }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      const value = (await readFile(path, "utf8")).trim();
      if (!/^urn:uuid:[a-f0-9-]{36}$/.test(value)) throw new Error("The saved ChatGPT host identity is invalid.");
      return value;
    })();
  }
  private async accounts(owner: string): Promise<AccountFile> {
    try { return JSON.parse(await readFile(resolve(this.directory, `${hash(owner)}.json`), "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { active: null, accounts: [] }; throw error; }
  }
  private async save(owner: string, contents: AccountFile): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const path = resolve(this.directory, `${hash(owner)}.json`), temporary = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(contents), { mode: 0o600 });
    await rename(temporary, path);
  }
}
