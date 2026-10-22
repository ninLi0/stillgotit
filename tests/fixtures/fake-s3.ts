/** A local path-style S3 endpoint for tests. It records requests and keeps objects in memory. */
import { S3Client } from "bun";

export function fakeS3(bucket = "stillgotit-test") {
  const objects = new Map<string, Uint8Array<ArrayBuffer>>(), requests: string[] = [];
  const state = { delay: 0, status: 0 };
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
    const path = decodeURIComponent(new URL(request.url).pathname), signed = request.headers.get("Authorization")?.startsWith("AWS4-HMAC-SHA256 ");
    requests.push(`${request.method} ${path}${signed ? "" : " (unsigned)"}`);
    if (state.delay) await Bun.sleep(state.delay);
    if (state.status) return new Response("<Error><Code>AccessDenied</Code><Message>Bucket policy detail</Message></Error>", { status: state.status });
    if (!path.startsWith(`/${bucket}/`)) return new Response(null, { status: 404 });
    const key = path.slice(bucket.length + 2), value = objects.get(key);
    if (request.method === "PUT") { objects.set(key, new Uint8Array(await request.arrayBuffer())); return new Response(null, { headers: { ETag: "\"saved\"" } }); }
    if (request.method === "DELETE") { objects.delete(key); return new Response(null, { status: 204 }); }
    if (!value) {
      return new Response(request.method === "HEAD" ? null : "<Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message></Error>",
        { status: 404, headers: { "Content-Type": "application/xml" } });
    }
    return new Response(request.method === "HEAD" ? null : value, { headers: { "Content-Length": String(value.byteLength), ETag: "\"saved\"" } });
  } });
  const env = { S3_BUCKET: bucket, S3_ACCESS_KEY_ID: "test-key", S3_SECRET_ACCESS_KEY: "test-secret", S3_ENDPOINT: `http://127.0.0.1:${server.port}`, S3_REGION: "us-east-1" };
  const client = new S3Client({ bucket, accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY, endpoint: env.S3_ENDPOINT, region: env.S3_REGION });
  return { server, objects, requests, state, env, client, stop: () => server.stop(true) };
}
