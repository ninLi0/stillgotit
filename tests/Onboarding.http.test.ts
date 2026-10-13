import { afterAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { Collection } from "mongodb";
import { MemoryProvider, type Identity } from "../src/concepts/Federating/provider.ts";
import { createRuntime } from "../src/host/runtime.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const ORIGIN = "http://localhost:5173";
const SAM = { subject: "commons-sam", username: "sam" };
const cleanups: (() => Promise<void>)[] = [];
afterAll(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); });

async function setup() {
  const connection = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri,
    database: `stillgotit_test_${randomUUID().replaceAll("-", "")}` });
  let now = new Date();
  const provider = new MemoryProvider();
  const runtimes: Awaited<ReturnType<typeof createRuntime>>[] = [];
  const open = async () => {
    const runtime = await createRuntime({ database: connection.db, provider,
      providerOrigin: "https://commons.example", publicOrigin: ORIGIN, clock: () => now });
    runtimes.push(runtime);
    return runtime;
  };
  let runtime = await open();
  cleanups.push(async () => {
    for (const item of runtimes) await item.gateway.beginDrain();
    await connection.db.dropDatabase();
    await connection.client.close();
  });
  function browser() {
    const jar = new Map<string, string>();
    async function post(path: string, input: Record<string, unknown> = {}, origin: string | null = ORIGIN) {
      const headers: Record<string, string> = { "Content-Type": "application/json",
        Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") };
      if (origin !== null) headers.Origin = origin;
      const response = await runtime.handle(new Request(`${ORIGIN}/api${path}`,
        { method: "POST", headers, body: JSON.stringify(input) }));
      for (const line of response.headers.getSetCookie()) {
        const pair = line.split(";")[0]!;
        const index = pair.indexOf("=");
        const name = pair.slice(0, index), value = pair.slice(index + 1);
        if (value === "" || /Max-Age=0/i.test(line)) jar.delete(name);
        else jar.set(name, value);
      }
      return { response, status: response.status, body: await response.json() };
    }
    async function confirm(identity: Identity = SAM) {
      const start = await post("/auth/commons/start");
      expect(start.status).toBe(200);
      expect(Object.keys(start.body)).toEqual(["address"]);
      expect(start.response.headers.get("Set-Cookie")).toContain("HttpOnly");
      const result = await post("/auth/commons/finish", provider.approve(start.body.address, identity));
      expect(result.status).toBe(200);
      return result;
    }
    async function signIn(identity: Identity = SAM) {
      await confirm(identity);
      const result = await post("/auth/commons/resume");
      expect(result.status).toBe(200);
      expect(Object.keys(result.body)).toEqual(["user"]);
      return result;
    }
    return { jar, post, confirm, signIn };
  }
  return { browser, db: connection.db, provider, get runtime() { return runtime; },
    advance: (ms: number) => { now = new Date(now.getTime() + ms); },
    restart: async () => { await runtime.gateway.beginDrain(); runtime = await open(); },
  };
}

describe("Commons and courses through HTTP reactions", () => {
  test("starts empty, signs in, creates a course, and reads it after a new runtime starts", async () => {
    const app = await setup(), browser = app.browser();
    expect((await browser.post("/courses")).status).toBe(401);
    await browser.confirm();
    expect(await app.db.collection("registering.users").countDocuments()).toBe(0);
    expect((await browser.post("/auth/commons/resume")).status).toBe(200);
    expect((await browser.post("/auth/me")).body).toEqual({ username: "sam" });
    expect((await browser.post("/courses")).body).toEqual({ courses: [] });
    const created = await browser.post("/courses/create", { title: "MIT 18.06SC Linear Algebra" });
    expect(created.status).toBe(200);
    const saved = { courses: [{ course: created.body.course, title: "MIT 18.06SC Linear Algebra" }] };
    expect((await browser.post("/courses")).body).toEqual(saved);
    await app.restart();
    expect((await browser.post("/courses")).body).toEqual(saved);
  });
  test("returning identity keeps its local user and name after a Commons username change", async () => {
    const app = await setup(), a = app.browser(), b = app.browser();
    const original = await a.signIn();
    expect((await b.signIn({ ...SAM, username: "renamed_sam" })).body).toEqual(original.body);
    expect((await b.post("/auth/me")).body).toEqual({ username: "sam" });
    expect(await app.db.collection("registering.users").countDocuments()).toBe(1);
  });
  test("username conflict keeps the confirmation and recovery key across a restart", async () => {
    const app = await setup(), a = app.browser(), b = app.browser();
    await a.signIn(); await b.confirm({ subject: "another-account", username: "sam" });
    expect((await b.post("/auth/commons/resume")).status).toBe(409);
    const before = await app.db.collection("registrationrecovery.keys").findOne({ subject: "another-account" });
    await app.restart();
    expect((await b.post("/auth/commons/choose", { username: "sam_other" })).status).toBe(200);
    expect((await b.post("/auth/me")).body).toEqual({ username: "sam_other" });
    expect(await app.db.collection("registrationrecovery.keys").findOne({ subject: "another-account" })).toEqual(before);
  });
  test("browser fields cannot choose another learner's user, key, session, or course owner", async () => {
    const app = await setup(), sam = app.browser(), leo = app.browser();
    const samIdentity = await sam.signIn();
    const key = await app.db.collection("registrationrecovery.keys").findOne({ subject: SAM.subject });
    await leo.confirm({ subject: "commons-leo", username: "leo" });
    const forged = await leo.post("/auth/commons/resume", { recoveryKey: key!.recoveryKey, user: samIdentity.body.user, username: "sam" });
    expect(forged.status).toBe(200);
    expect(forged.body.user).not.toBe(samIdentity.body.user);
    expect((await leo.post("/auth/me")).body).toEqual({ username: "leo" });
    await sam.post("/courses/create", { title: "Sam's course" });
    const attack = { session: sam.jar.get("__Host-stillgotit-session"), owner: samIdentity.body.user };
    expect((await leo.post("/courses", attack)).body).toEqual({ courses: [] });
    expect((await leo.post("/courses/create", { ...attack, title: "Leo's course" })).status).toBe(200);
    expect((await sam.post("/courses")).body.courses[0].title).toBe("Sam's course");
    expect((await leo.post("/courses")).body.courses[0].title).toBe("Leo's course");
  });
  test("concurrent requests from separate sessions create only one course", async () => {
    const app = await setup(), a = app.browser(), b = app.browser();
    await a.signIn(); await b.signIn();
    const results = await Promise.all([a.post("/courses/create", { title: "Linear algebra" }), b.post("/courses/create", { title: "Physics" })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await app.db.collection("SkillMapping.courses").countDocuments()).toBe(1);
  });
  test("recovers a saved registration after linking fails and the server restarts", async () => {
    const app = await setup(), browser = app.browser();
    await browser.confirm();
    await app.db.command({ collMod: "commonsfederating.links", validator: { impossible: { $exists: true } } });
    expect((await browser.post("/auth/commons/resume")).status).toBe(500);
    const registered = await app.db.collection("registering.users").findOne({ username: "sam" });
    expect(registered).not.toBeNull();
    expect(await app.db.collection("sessioning.sessions").countDocuments()).toBe(0);
    await app.db.command({ collMod: "commonsfederating.links", validator: {} });
    await app.restart();
    const resumed = await browser.post("/auth/commons/resume");
    expect(resumed.status).toBe(200);
    expect(resumed.body.user).toBe(registered!._id);
    expect(await app.db.collection("registering.users").countDocuments()).toBe(1);
  });
  test("expiry during key storage stops registration", async () => {
    const app = await setup(), browser = app.browser();
    await browser.confirm();
    const original = app.runtime.recovery.getOrCreate.bind(app.runtime.recovery);
    const spy = spyOn(app.runtime.recovery, "getOrCreate").mockImplementation(async (input) => {
      const result = await original(input); app.advance(10 * 60_000); return result;
    });
    try { expect((await browser.post("/auth/commons/resume")).status).toBe(403); }
    finally { spy.mockRestore(); }
    expect(await app.db.collection("registering.users").countDocuments()).toBe(0);
    expect(browser.jar.has("__Host-stillgotit-session")).toBe(false);
  });
  test("expiry during session insertion withholds the cookie and cleans up the session", async () => {
    const app = await setup(), browser = app.browser();
    await browser.confirm();
    const original = Collection.prototype.insertOne;
    const spy = spyOn(Collection.prototype, "insertOne").mockImplementation(async function (this: Collection, ...args: Parameters<typeof original>) {
      const result = await original.apply(this, args);
      if (this.dbName === app.db.databaseName && this.collectionName === "sessioning.sessions") app.advance(10 * 60_000);
      return result;
    });
    try { expect((await browser.post("/auth/commons/resume")).status).toBe(403); }
    finally { spy.mockRestore(); }
    expect(browser.jar.has("__Host-stillgotit-session")).toBe(false);
    expect(await app.db.collection("sessioning.sessions").countDocuments()).toBe(0);
  });
  test("wrong origins and unconfirmed attempts fail before a recovery key is written", async () => {
    const app = await setup(), browser = app.browser();
    expect((await browser.post("/auth/commons/start", {}, "https://elsewhere.example")).status).toBe(403);
    expect((await browser.post("/auth/commons/start", {}, null)).status).toBe(403);
    await browser.post("/auth/commons/start");
    expect((await browser.post("/auth/commons/resume")).status).toBe(403);
    expect(await app.db.collection("registrationrecovery.keys").countDocuments()).toBe(0);
  });
  test("validates titles and logout prevents reuse of the old session", async () => {
    const app = await setup(), browser = app.browser();
    await browser.signIn();
    for (const title of ["", "   ", "x".repeat(161), { $ne: "" }]) expect((await browser.post("/courses/create", { title })).status).toBe(400);
    const oldSession = browser.jar.get("__Host-stillgotit-session")!;
    expect((await browser.post("/auth/logout")).status).toBe(200);
    expect(browser.jar.has("__Host-stillgotit-session")).toBe(false);
    browser.jar.set("__Host-stillgotit-session", oldSession);
    expect((await browser.post("/courses")).status).toBe(401);
  });
  test("a session whose local account is missing gets a refusal instead of an unanswered request", async () => {
    const app = await setup(), browser = app.browser();
    const signedIn = await browser.signIn();
    await app.db.collection("registering.users").deleteOne({ _id: signedIn.body.user });
    expect((await browser.post("/auth/me")).status).toBe(401);
    expect(browser.jar.has("__Host-stillgotit-session")).toBe(false);
  });
});
