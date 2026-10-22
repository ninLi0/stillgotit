import { resolve, sep } from "node:path";

export function serveSite({ api, directory }: {
  api: (request: Request) => Promise<Response>; directory: string;
}) {
  const root = resolve(directory);
  return async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/api/")) {
      const response = await api(request);
      response.headers.set("Referrer-Policy", "no-referrer");
      response.headers.set("Cache-Control", "no-store");
      return response;
    }
    const headers = { "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" };
    if (path === "/health" && (request.method === "GET" || request.method === "HEAD")) return new Response("ok", { headers });
    if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers });
    if (path.startsWith("/assets/")) {
      const assetPath = resolve(root, `.${path}`);
      if (!assetPath.startsWith(`${root}${sep}`)) return new Response("Not found", { status: 404, headers });
      const asset = Bun.file(assetPath);
      return await asset.exists() ? new Response(asset, { headers }) : new Response("Not found", { status: 404, headers });
    }
    if (path !== "/" && path !== "/auth/commons/callback") return new Response("Not found", { status: 404, headers });
    const page = Bun.file(resolve(root, "index.html"));
    return await page.exists()
      ? new Response(page, { headers })
      : new Response("Build the frontend with bun run build, then reload.", { status: 503, headers });
  };
}
