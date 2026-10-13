import { CommonsProvider } from "./concepts/Federating/provider.ts";
import { createRuntime } from "./host/runtime.ts";
import { serveSite } from "./host/site.ts";
import { connectMongo } from "./storage/mongo.ts";

const port = Number(process.env.PORT ?? 5173);
const publicOrigin = new URL(process.env.APP_ORIGIN ?? `http://localhost:${port}`).origin;
const providerOrigin = new URL(process.env.COMMONS_ORIGIN ?? "https://class.mit-sdg.dev").origin;
const { client, db } = await connectMongo();

try {
  const runtime = await createRuntime({
    database: db, publicOrigin, providerOrigin,
    provider: new CommonsProvider({ origin: providerOrigin, app: publicOrigin }),
  });
  const server = Bun.serve({
    port, hostname: "127.0.0.1", maxRequestBodySize: 16_384,
    fetch: serveSite({ api: runtime.handle, directory: `${import.meta.dir}/../frontend/dist` }),
  });
  console.log(`StillGotIt is ready at ${publicOrigin}`);
  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    server.stop();
    await runtime.gateway.beginDrain();
    await client.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
} catch (error) {
  await client.close();
  throw error;
}
