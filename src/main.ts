import { CommonsProvider } from "./concepts/Federating/provider.ts";
import { createRuntime } from "./host/runtime.ts";
import { serveSite } from "./host/site.ts";
import { connectMongo } from "./storage/mongo.ts";
import { UPLOAD_BODY_LIMIT } from "./host/material-files.ts";

// The platform sets HOST and PORT; the app owner sets PUBLIC_ORIGIN to the app's https address.
const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "127.0.0.1";
const publicOrigin = new URL(process.env.PUBLIC_ORIGIN ?? `http://localhost:${port}`).origin;
const providerOrigin = new URL(process.env.COMMONS_ORIGIN ?? "https://class.mit-sdg.dev").origin;
const { client, db } = await connectMongo();

try {
  const runtime = await createRuntime({
    database: db, publicOrigin, providerOrigin,
    provider: new CommonsProvider({ origin: providerOrigin, app: publicOrigin }),
  });
  const server = Bun.serve({
    // 95 MB of files plus 1 MB for the other form fields. Every other route enforces a smaller limit while reading.
    port, hostname, maxRequestBodySize: UPLOAD_BODY_LIMIT,
    // Longer than the AI time limit, so a slow tutor reply isn't cut off by an idle connection.
    idleTimeout: 120,
    fetch: serveSite({ api: runtime.handle, directory: `${import.meta.dir}/../frontend/dist` }),
  });
  // Transcribes imported recordings outside requests, and resumes saved progress after a restart.
  runtime.worker.start();
  console.log(`StillGotIt is ready at ${publicOrigin}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.stop();
    // Stops starting new work. A claim held by a stopped transcription ends within five minutes.
    await runtime.worker.stop();
    await runtime.gateway.beginDrain();
    await client.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch (error) {
  await client.close();
  throw error;
}
