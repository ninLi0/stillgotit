import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
/** Isolated UI checks only. This entrypoint is never used by the production server. */
import { createRuntime } from "../../src/host/runtime.ts";
import { serveSite } from "../../src/host/site.ts";
import { MemoryProvider } from "../../src/concepts/Federating/provider.ts";
import { connectMongo, localMongoUri } from "../../src/storage/mongo.ts";
import { CourseTutor } from "../../src/host/tutor.ts";
import { ChatGPTConnection } from "../../src/host/chatgpt.ts";
import { MaterialFiles } from "../../src/host/material-files.ts";
if (process.env.ALLOW_UI_FIXTURES !== "1") throw new Error("This server requires ALLOW_UI_FIXTURES=1.");
const origin = "http://127.0.0.1:5174";
class UIProvider extends MemoryProvider {
  override address(input: { nonce: string; verifier: string }) { return super.address(input).replace("memory://connect", `${origin}/fixture/connect`); }
}
const provider = new UIProvider();
const { client, db } = await connectMongo({ uri: process.env.MONGODB_TEST_URI ?? localMongoUri, database: `stillgotit_test_ui_${crypto.randomUUID().replaceAll("-", "")}` });
const fixtureTutor: Pick<CourseTutor, "suggest" | "generate"> = {
  suggest: async () => ({ unitTitle: "Matrix multiplication", skills: [
    { title: "Multiply matrices", outcome: "Compute a matrix product and explain how its entries are formed.", gate: "Solve two fresh products with correct reasoning and results. Explain why multiplication order matters." },
    { title: "Check matrix dimensions", outcome: "Decide whether two matrices can be multiplied and state the output dimensions.", gate: "Check three unfamiliar pairs and explain each decision." },
  ] }),
  generate: async (_owner, sources, _instruction, context, schema) => {
    const properties = schema.properties as Record<string, unknown>, source = sources[0]!;
    const citations = [{ material: source.material, location: source.data.originals[0]?.renditions[0]?.location ?? "content" }];
    if (properties.explanation) return { explanation: "A matrix product combines rows from the first matrix with columns from the second.\n\nFor example, the row [1, 2] and column [3, 4] produce 1 × 3 + 2 × 4 = 11. Each output entry uses one row and one column.\n\nThe inner dimensions must match. A 2 × 3 matrix times a 3 × 4 matrix produces a 2 × 4 matrix.\n\nWhy would changing the order change the result?", citations };
    if (properties.question) return { question: "1. Multiply A = [[1, 2], [3, 4]] by B = [[2, 0], [1, 2]].\n\n2. Multiply C = [[2, 1], [0, 3]] by D = [[1, 2], [4, 0]].\n\nShow how you form each entry. Explain why changing the order can change the answer.", citations };
    if (properties.rationale) return { result: (context as { help: string }).help === "NONE" ? "INDEPENDENT" : "SUPPORTED", gateMet: (context as { help: string }).help === "NONE",
      rationale: "Fixture assessment: both products and the explanation meet the stated requirements. This canned result tests the interface and persistence; it does not test AI grading." };
    return { text: "The order selects different rows and columns. The resulting sums can change, and one order might not be defined.", citations };
  },
};
const liveUsername = process.env.STILLGOTIT_LIVE_TEST_USER;
let tutor: Pick<CourseTutor, "suggest" | "generate"> = fixtureTutor;
let model = "fixture";
if (liveUsername) {
  const production = await connectMongo();
  try {
    const account = await production.db.collection("registering.users").findOne({ username: liveUsername });
    if (!account) throw new Error("Choose a connected app account for the live test.");
    const owner = String(account._id), connection = new ChatGPTConnection("http://localhost:5173");
    const status = await connection.status(owner);
    if (!status.connected) throw new Error("Connect ChatGPT in the main app first.");
    model = status.model || (await connection.models(owner))[0]!.slug;
    // Reuse only the approved provider connection. All learning state belongs to the test database.
    tutor = new CourseTutor({ respond: async (_learner, instructions, content, schema) => {
      const started = performance.now();
      console.log("Live provider request started.");
      try { const result = await connection.respond(owner, instructions, content, schema);
        console.log(`Live provider request completed in ${Math.round(performance.now() - started)} ms.`); return result; }
      catch (error) { console.log(`Live provider request failed after ${Math.round(performance.now() - started)} ms (${error instanceof Error ? error.name : "unknown error"}).`); throw error; }
    } }, new MaterialFiles());
  } finally { await production.client.close(); }
}
const runtime = await createRuntime({ database: db, provider, providerOrigin: origin, publicOrigin: origin, tutor });
const site = serveSite({ api: runtime.handle, directory: `${import.meta.dir}/../../frontend/dist` });
let dropDraftReply = process.env.STILLGOTIT_TEST_DROP_DRAFT_REPLY === "1";
const server = Bun.serve({ hostname: "127.0.0.1", port: 5174, maxRequestBodySize: 26 * 1024 * 1024, async fetch(request) {
  const url = new URL(request.url);
  if (url.pathname === "/fixture/connect") {
    const reply = provider.approve(request.url, { subject: "ui-test-learner", username: "ui_tester" });
    return Response.redirect(`${origin}/auth/commons/callback?${new URLSearchParams(reply)}`, 303);
  }
  if (url.pathname === "/api/ai/status") return Response.json({ connected: true, active: "fixture", model, effort: "", accounts: [{ id: "fixture", label: liveUsername ? "Approved ChatGPT connection — test learner" : "Local test fixtures", connected: true }] });
  if (url.pathname === "/api/ai/models") return Response.json({ models: [{ slug: model, display_name: liveUsername ? model : "Canned responses for UI checks", supported_reasoning_levels: [], default_reasoning_level: "" }] });
  const result = await site(request);
  if (dropDraftReply && url.pathname === "/api/courses/skills/propose" && result.ok) {
    dropDraftReply = false;
    return Response.json({ error: "TEST_REPLY_LOST", detail: "Test interruption: the draft was saved but its reply was lost. Retry the pending save." }, { status: 503 });
  }
  if (result.headers.get("Content-Type")?.includes("text/html")) {
    const label = liveUsername ? "LIVE AI TEST — scripted learner, separate database" : "UI TEST ONLY — canned AI responses, separate database";
    const html = (await result.text()).replace("<body>", `<body><div role="note" style="position:sticky;top:0;z-index:100;padding:8px;text-align:center;background:#222;color:#fff;font:12px sans-serif">${label}</div>`);
    return new Response(html, { status: result.status, headers: result.headers });
  }
  return result;
} });
console.log(`Isolated UI fixture server: ${origin}`);
let closing = false;
const close = async () => { if (closing) return; closing = true; server.stop(true); await runtime.gateway.beginDrain();
  for (const user of await db.collection("registering.users").find({}, { projection: { _id: 1 } }).toArray()) {
    await rm(resolve(".data/files", createHash("sha256").update(String(user._id)).digest("hex")), { recursive: true, force: true });
  }
  await db.dropDatabase(); await client.close(); process.exit(0); };
process.once("SIGTERM", close); process.once("SIGINT", close);
