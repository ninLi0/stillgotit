// Adapts ConceptBox's HTTP provider tests. See THIRD_PARTY_NOTICES.md.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { CommonsProvider } from "../src/concepts/Federating/provider.ts";

const APP = "http://localhost:5173"; // Test origin; no frontend is running here.
const REQUEST = { code: "test-sign-in-code", verifier: "test-private-verifier" };
const IDENTITY = { user: "u7f3", username: "sam" };
const servers: Bun.Server<undefined>[] = [];
let warn: ReturnType<typeof spyOn<typeof console, "warn">>;

interface RecordedRequest {
  method: string;
  path: string;
  search: string;
  contentType: string | null;
  body: unknown;
}

beforeEach(() => {
  warn = spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  try {
    await Promise.all(servers.splice(0).map((server) => server.stop(true)));
  } finally {
    warn.mockRestore();
  }
});

function commons(answer: (request: RecordedRequest) => Response | Promise<Response>) {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    // Only the provider's timeout should end a stalled request in these tests.
    idleTimeout: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const record: RecordedRequest = {
        method: request.method,
        path: url.pathname,
        search: url.search,
        contentType: request.headers.get("content-type"),
        body: undefined,
      };
      // Record even a bodyless GET if a broken client follows a 302 redirect.
      requests.push(record);
      const body = await request.text();
      record.body = body === "" ? null : JSON.parse(body);
      return answer(record);
    },
  });
  servers.push(server);
  return {
    server,
    requests,
    provider: (timeout?: number) => new CommonsProvider({
      // Paths and queries must not become part of either origin.
      origin: new URL("/ignored?source=test", server.url).href,
      app: `${APP}/ignored?source=test`,
      timeout,
    }),
  };
}

// A broken timeout must fail the test and release its held server response.
// This watchdog is longer than the provider timeout and is always cleared.
async function within<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("The provider did not finish within the test limit.")), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function expectWarning(detail?: string) {
  expect(warn).toHaveBeenCalledTimes(1);
  const message = String(warn.mock.calls[0]?.[0]);
  expect(message).toContain("didn't redeem a sign-in code");
  if (detail !== undefined) expect(message).toContain(detail);
  expect(message).not.toContain(REQUEST.code);
  expect(message).not.toContain(REQUEST.verifier);
}

describe("CommonsProvider.redeem", () => {
  test("posts the code, app origin, and verifier once, then returns only the stable subject and username", async () => {
    const { provider, requests } = commons(() => Response.json({
      ...IDENTITY, displayName: "Sam", email: "sam@example.edu",
    }));
    expect(await provider().redeem(REQUEST)).toEqual({ subject: IDENTITY.user, username: IDENTITY.username });
    expect(requests).toEqual([{
      method: "POST",
      path: "/api/connect/redeem",
      search: "",
      contentType: "application/json",
      body: { code: REQUEST.code, app: APP, code_verifier: REQUEST.verifier },
    }]);
    expect(warn).not.toHaveBeenCalled();
  });

  test("returns no identity for an invalid code (HTTP 400) without retrying or logging an expected refusal", async () => {
    const { provider, requests } = commons(() => Response.json({ error: "CONNECT_CODE_INVALID" }, { status: 400 }));
    expect(await provider().redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("treats HTTP 400 as refusal even when its body is not JSON", async () => {
    const { provider, requests } = commons(() => new Response("Invalid or expired code", { status: 400 }));
    expect(await provider().redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });

  test("returns no cached identity when Commons refuses a code that already redeemed once", async () => {
    let spent = false;
    const { provider, requests } = commons(() => {
      if (spent) return Response.json({ error: "CONNECT_CODE_INVALID" }, { status: 400 });
      spent = true;
      return Response.json(IDENTITY);
    });
    const client = provider();
    expect(await client.redeem(REQUEST)).toEqual({ subject: IDENTITY.user, username: IDENTITY.username });
    expect(await client.redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(warn).not.toHaveBeenCalled();
  });

  test.each([401, 429, 503])("returns no identity for HTTP %i and does not retry", async (status) => {
    // Identity-shaped data must not override an unsuccessful HTTP status.
    const { provider, requests } = commons(() => Response.json(IDENTITY, { status }));
    expect(await provider().redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expectWarning(`status ${status}`);
  });

  test.each([
    ["missing user", { username: "sam" }],
    ["missing username", { user: "u7f3" }],
    ["numeric user", { user: 7, username: "sam" }],
    ["numeric username", { user: "u7f3", username: 7 }],
    ["null", null],
    ["array", [IDENTITY]],
  ] as const)("rejects a successful HTTP reply with %s instead of a valid identity", async (_label, body) => {
    const { provider, requests } = commons(() => Response.json(body));
    expect(await provider().redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expectWarning();
  });

  test("returns no identity for malformed JSON without retrying", async () => {
    const { provider, requests } = commons(() => new Response('{"user":', {
      headers: { "Content-Type": "application/json" },
    }));
    expect(await provider().redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expectWarning();
  });

  test("returns no identity for an empty HTTP 204 reply", async () => {
    const { provider, requests } = commons(() => new Response(null, { status: 204 }));
    expect(await provider().redeem(REQUEST)).toBeUndefined();
    expect(requests).toHaveLength(1);
    expectWarning();
  });

  test.each([302, 307])("refuses an HTTP %i redirect without sending a request to its target", async (status) => {
    const target = commons(() => Response.json(IDENTITY));
    const source = commons(() => Response.redirect(new URL("/redirect-target", target.server.url), status));
    expect(await source.provider().redeem(REQUEST)).toBeUndefined();
    expect(source.requests).toHaveLength(1);
    expect(target.requests).toHaveLength(0);
    expectWarning();
  });

  test("returns no identity when the server cannot be reached", async () => {
    const { provider, server, requests } = commons(() => Response.json(IDENTITY));
    const client = provider(500);
    await server.stop(true);
    expect(await within(client.redeem(REQUEST), 2_000)).toBeUndefined();
    expect(requests).toHaveLength(0);
    expectWarning();
  });

  test("uses the configured timeout without retrying and permits a later request with a fresh code", async () => {
    const reply = Promise.withResolvers<Response>();
    const { provider, requests } = commons(() => requests.length === 1 ? reply.promise : Response.json(IDENTITY));
    const client = provider(100);
    try {
      const started = performance.now();
      expect(await within(client.redeem(REQUEST), 2_000)).toBeUndefined();
      expect(performance.now() - started).toBeGreaterThanOrEqual(80);
      expect(requests).toHaveLength(1);
      expectWarning("TimeoutError");
      // A late reply cannot turn the completed refusal into an identity.
      reply.resolve(Response.json(IDENTITY));
      expect(await client.redeem({ ...REQUEST, code: "fresh-sign-in-code" }))
        .toEqual({ subject: IDENTITY.user, username: IDENTITY.username });
      expect(requests).toHaveLength(2);
      expect(requests[1]!.body).toEqual({ code: "fresh-sign-in-code", app: APP, code_verifier: REQUEST.verifier });
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      reply.resolve(Response.json(IDENTITY));
    }
  });

  test("times out while reading a stalled JSON body after HTTP 200 headers", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    let cancelled = false;
    const { provider, requests } = commons(() => new Response(new ReadableStream<Uint8Array>({
      start(stream) {
        controller = stream;
        stream.enqueue(new TextEncoder().encode('{"user":"u7f3",'));
      },
      cancel() { cancelled = true; },
    }), { headers: { "Content-Type": "application/json" } }));
    try {
      const started = performance.now();
      expect(await within(provider(100).redeem(REQUEST), 2_000)).toBeUndefined();
      expect(performance.now() - started).toBeGreaterThanOrEqual(80);
      expect(controller).toBeDefined();
      expect(requests).toHaveLength(1);
      expectWarning("TimeoutError");
    } finally {
      if (!cancelled) controller?.close();
    }
  });

  test("uses the real ten-second default deadline when no timeout is supplied", async () => {
    const reply = Promise.withResolvers<Response>();
    const { provider, requests } = commons(() => reply.promise);
    try {
      const started = performance.now();
      expect(await within(provider().redeem(REQUEST), 14_000)).toBeUndefined();
      expect(performance.now() - started).toBeGreaterThanOrEqual(9_500);
      expect(requests).toHaveLength(1);
      expectWarning("TimeoutError");
    } finally {
      reply.resolve(Response.json(IDENTITY));
    }
  }, 15_000);
});
