import { expect, spyOn, test } from "bun:test";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGPTConnection } from "../src/host/chatgpt.ts";

test("ChatGPT OAuth binds owner, state, nonce and PKCE; restart and refresh retain protected credentials", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stillgotit-oauth-")), clientId = "oaiapp_test_application";
  const { privateKey, publicKey } = await generateKeyPair("ES256"), jwk = { ...await exportJWK(publicKey), kid: "test", alg: "ES256", use: "sig" };
  let authorize: URL, refreshes = 0, mode: "complete" | "parts" | "open" | "failed" | "truncated" = "complete", badNonce = false;
  let streamCancelled = false, openStream: ReadableStreamDefaultController<Uint8Array> | undefined;
  const scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
  const fetchStub = async (input: Parameters<typeof fetch>[0], options?: Parameters<typeof fetch>[1]) => {
    const url = String(input);
    if (url.endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
    if (url.endsWith("/oauth/token")) {
      const body = options?.body as URLSearchParams;
      expect(body.get("client_id")).toBe(clientId);
      if (body.get("grant_type") === "authorization_code") {
        expect(createHash("sha256").update(body.get("code_verifier")!).digest("base64url")).toBe(authorize.searchParams.get("code_challenge")!);
        expect(body.get("redirect_uri")).toBe("http://127.0.0.1:5173/auth/chatgpt/return");
      } else refreshes++;
      const idToken = await new SignJWT({ nonce: badNonce ? "wrong" : authorize.searchParams.get("nonce"), email: "test@example.com" })
        .setProtectedHeader({ alg: "ES256", kid: "test" }).setIssuer("https://auth.openai.com").setSubject("test-subject").setAudience(clientId).setIssuedAt().setExpirationTime("1h").sign(privateKey);
      return Response.json({ access_token: `test-access-${refreshes}`, refresh_token: `test-refresh-${refreshes}`, token_type: "Bearer", expires_in: 3600, id_token: idToken, scope: scopes });
    }
    if (url.endsWith("/v1/models")) return Response.json({ models: [{ slug: "account-model", display_name: "Account model", visibility: "list" }, { slug: "hidden", display_name: "Hidden", visibility: "hide" }] });
    if (url.endsWith("/v1/responses")) {
      const body = JSON.parse(String(options?.body)); expect(body).toMatchObject({ model: "account-model", store: false, stream: true });
      expect(Array.isArray(body.input)).toBe(true); expect(body).not.toHaveProperty("max_output_tokens");
      const completed = { type: "response.completed", response: { output: [{ content: [{ type: "output_text", text: '{"answer":"grounded"}' }] }] } };
      const payload = mode === "complete" || mode === "open" ? completed : mode === "failed" ? { type: "response.failed", response: { error: { message: "provider internal detail" } } } : { type: "response.output_text.delta", delta: "unfinished" };
      // Split CRLF across chunks; the parser must retain a complete terminal event.
      const frames = mode === "parts" ? [
        { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '{"answer":' },
        { type: "response.output_text.delta", output_index: 0, content_index: 0, delta: '"grounded"}' },
        { type: "response.output_text.done", output_index: 0, content_index: 0, text: '{"answer":"grounded"}' },
        { type: "response.content_part.done", output_index: 0, content_index: 0, part: { type: "output_text", text: '{"answer":"grounded"}' } },
        { type: "response.output_item.done", output_index: 0, item: completed.response.output[0] },
        { type: "response.completed", response: { output: [] } },
      ] : [payload];
      const encoded = new TextEncoder().encode(frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join(""));
      return new Response(new ReadableStream({ start(controller) {
        for (let i = 0; i < encoded.length; i += 3) controller.enqueue(encoded.slice(i, i + 3));
        if (mode === "open") openStream = controller; else controller.close();
      }, cancel() { streamCancelled = true; openStream = undefined; } }));
    }
    if (url.endsWith("/.well-known/openid-configuration")) return Response.json({ revocation_endpoint: "https://auth.openai.com/oauth/revoke" });
    if (url.endsWith("/oauth/revoke")) return new Response(null, { status: 200 });
    throw new Error(`Unexpected test request: ${url}`);
  };
  const spy = spyOn(globalThis, "fetch").mockImplementation(fetchStub as typeof fetch);
  try {
    const connection = new ChatGPTConnection("http://localhost:5173", directory), first = await connection.start("sam"); authorize = new URL(first.address);
    expect(authorize.searchParams.get("client_id")).toBe("dynamic_agent_client");
    expect(authorize.searchParams.get("agent_name_hint")).toBe("StillGotIt");
    expect(authorize.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:/);
    await expect(connection.callback(new URLSearchParams({ state: "wrong", code: "test", client_id: clientId }))).rejects.toThrow("not started here");
    const callback = new URLSearchParams({ state: authorize.searchParams.get("state")!, code: "test-code", client_id: clientId });
    badNonce = true; await expect(connection.callback(callback)).rejects.toThrow("did not match"); badNonce = false;
    await connection.callback(callback);
    expect((await connection.status("sam")).connected).toBe(false);
    await expect(connection.finish("other", first.attempt)).rejects.toThrow("account that started");
    await connection.finish("sam", first.attempt);
    const status = await connection.status("sam"); expect(status.connected).toBe(true); expect(JSON.stringify(status)).not.toContain("test-access");
    expect((await connection.status("other")).connected).toBe(false);
    const filename = (await readdir(directory)).find((name) => name.endsWith(".json"))!, path = join(directory, filename);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const restarted = new ChatGPTConnection("http://localhost:5173", directory);
    expect(await restarted.status("sam")).toEqual(status);
    expect(await restarted.models("sam")).toEqual([{ slug: "account-model", display_name: "Account model", default_reasoning_level: "", supported_reasoning_levels: [] }]);
    const saved = JSON.parse(await readFile(path, "utf8")); saved.accounts[0].expiresAt = Date.now() - 1000; await writeFile(path, JSON.stringify(saved));
    await Promise.all([restarted.models("sam"), restarted.models("sam")]); expect(refreshes).toBe(1);
    expect(JSON.parse(await readFile(path, "utf8")).accounts[0].refresh_token).toBe("test-refresh-1");
    expect(await restarted.respond("sam", "Ground the answer.", [{ type: "input_text", text: "Question" }], { type: "object" })).toEqual({ answer: "grounded" });
    mode = "parts"; expect(await restarted.respond("sam", "Test", [], {})).toEqual({ answer: "grounded" });
    mode = "open"; streamCancelled = false;
    let deadline: ReturnType<typeof setTimeout>;
    try {
      expect(await Promise.race([restarted.respond("sam", "Test", [], {}),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error("Completed stream did not settle")), 1000); })])).toEqual({ answer: "grounded" });
      expect(streamCancelled).toBe(true);
    } finally { clearTimeout(deadline!); openStream?.close(); }
    mode = "failed"; await expect(restarted.respond("sam", "Test", [], {})).rejects.toThrow("did not finish");
    mode = "truncated"; await expect(restarted.respond("sam", "Test", [], {})).rejects.toThrow("before completion");
    const reconnect = await restarted.start("sam", clientId), next = new URL(reconnect.address);
    expect(next.searchParams.get("ext_agent_host_id")).toBe(authorize.searchParams.get("ext_agent_host_id"));
    expect(next.searchParams.get("client_id")).toBe(clientId); expect(next.searchParams.has("agent_name_hint")).toBe(false);
    expect(await restarted.disconnect("sam")).toEqual({ revoked: true }); expect((await restarted.status("sam")).connected).toBe(false);
    expect(await readFile(path, "utf8")).not.toContain("test-refresh-1");
  } finally { spy.mockRestore(); await rm(directory, { recursive: true, force: true }); }
}, 20_000);

test("reasoning effort is supported, saved per account, and sent with the selected model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stillgotit-effort-"));
  const filename = (owner: string) => join(directory, `${createHash("sha256").update(owner).digest("hex")}.json`);
  const account = (client_id: string) => ({ client_id, subject: client_id, email: "test@example.com", issuer: "https://auth.openai.com",
    access_token: `test-access-${client_id}`, refresh_token: "test-refresh", id_token: "", expiresAt: Date.now() + 3_600_000,
    scopes: ["resource.invoke", "chatgpt.tokens.use.direct"] });
  await writeFile(filename("sam"), JSON.stringify({ active: "first", accounts: [account("first"), account("second")] }));
  await writeFile(filename("other"), JSON.stringify({ active: "other", accounts: [account("other")] }));
  const catalog = [
    { slug: "reasoning", display_name: "Reasoning", visibility: "list", default_reasoning_level: "medium",
      supported_reasoning_levels: ["low", "medium", "high", "ultra", "high"].map((effort) => ({ effort, description: `${effort} effort` })) },
    { slug: "fast", display_name: "Fast", visibility: "list", default_reasoning_level: "low", supported_reasoning_levels: [{ effort: "low", description: "Fast" }] },
    { slug: "legacy", display_name: "Legacy", visibility: "list" },
  ];
  const sent: { body: Record<string, unknown>; authorization: string | null }[] = [];
  let beforeCatalog: (() => Promise<void>) | undefined;
  const spy = spyOn(globalThis, "fetch").mockImplementation((async (input, options) => {
    if (String(input).endsWith("/v1/models")) {
      if (beforeCatalog) { const run = beforeCatalog; beforeCatalog = undefined; await run(); }
      return Response.json({ models: catalog });
    }
    if (String(input).endsWith("/v1/responses")) {
      sent.push({ body: JSON.parse(String(options?.body)), authorization: new Headers(options?.headers).get("Authorization") });
      return new Response(`data: ${JSON.stringify({ type: "response.completed", response: { output: [{ content: [{ type: "output_text", text: '{"ok":true}' }] }] } })}\n\n`);
    }
    throw new Error("Unexpected provider request");
  }) as typeof fetch);
  try {
    const connection = new ChatGPTConnection("http://localhost:5173", directory);
    const choices = await connection.models("sam");
    expect(choices[0]!.supported_reasoning_levels.map((level) => level.effort)).toEqual(["low", "medium", "high"]);
    await connection.selectModel("sam", "reasoning", "high");
    const restarted = new ChatGPTConnection("http://localhost:5173", directory);
    expect(await restarted.status("sam")).toMatchObject({ model: "reasoning", effort: "high" });
    expect(await restarted.status("other")).toMatchObject({ model: "", effort: "" });
    await restarted.respond("sam", "Test", [], {});
    expect(sent.at(-1)).toMatchObject({ body: { model: "reasoning", reasoning: { effort: "high" } }, authorization: "Bearer test-access-first" });
    await expect(restarted.selectModel("sam", "missing", "high")).rejects.toThrow("available to your account");
    await expect(restarted.selectModel("sam", "fast", "high")).rejects.toThrow("supported by this model");
    await expect(restarted.selectModel("sam", "reasoning", "ultra")).rejects.toThrow("supported by this model");
    expect(await restarted.status("sam")).toMatchObject({ model: "reasoning", effort: "high" });
    await restarted.select("sam", "second");
    expect(await restarted.status("sam")).toMatchObject({ model: "", effort: "" });
    await restarted.respond("sam", "Test", [], {});
    expect(sent.at(-1)).toMatchObject({ body: { reasoning: { effort: "medium" } }, authorization: "Bearer test-access-second" });
    await restarted.select("sam", "first");
    expect(await restarted.status("sam")).toMatchObject({ effort: "high" });
    await restarted.selectModel("sam", "fast");
    expect(await restarted.status("sam")).toMatchObject({ model: "fast", effort: "low" });
    await restarted.respond("sam", "Test", [], {});
    expect(sent.at(-1)!.body).toMatchObject({ model: "fast", reasoning: { effort: "low" } });
    await restarted.selectModel("sam", "legacy");
    await restarted.respond("sam", "Test", [], {});
    expect(sent.at(-1)!.body).not.toHaveProperty("reasoning");
    beforeCatalog = () => restarted.select("sam", "second");
    await expect(restarted.selectModel("sam", "reasoning", "high")).rejects.toThrow("account changed");
    expect(await restarted.status("sam")).toMatchObject({ model: "", effort: "" });
    await restarted.selectModel("sam", "fast", "low");
    catalog.splice(1, 1);
    const count = sent.length;
    await expect(restarted.respond("sam", "Test", [], {})).rejects.toThrow("no longer available");
    expect(sent).toHaveLength(count);
  } finally { spy.mockRestore(); await rm(directory, { recursive: true, force: true }); }
});
