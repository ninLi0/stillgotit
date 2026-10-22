import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DiskStore, fileStore, S3Store, type FileStore } from "../src/host/file-store.ts";
import { fakeS3 } from "./fixtures/fake-s3.ts";

let directory: string, s3: ReturnType<typeof fakeS3>;
beforeAll(async () => { directory = await mkdtemp(resolve(tmpdir(), "stillgotit-store-")); s3 = fakeS3(); });
afterAll(async () => { s3?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

const bytes = Uint8Array.from([37, 80, 68, 70, 0, 255, 1]);
const stores: [string, () => FileStore][] = [
  ["disk store", () => new DiskStore(resolve(directory, "files"))],
  ["S3 store", () => new S3Store(s3.client)],
];

describe.each(stores)("%s", (_, make) => {
  test("put, get, exists, and delete round-trip exact bytes", async () => {
    const store = make(), key = `${"a".repeat(64)}/${crypto.randomUUID()}/${"b".repeat(64)}.pdf`;
    expect(await store.exists(key)).toBe(false);
    await store.put(key, bytes);
    expect(await store.exists(key)).toBe(true);
    expect(await store.get(key)).toEqual(bytes);
    await store.put(key, bytes.subarray(0, 3));
    expect(await store.get(key)).toEqual(bytes.subarray(0, 3));
    await store.delete(key);
    expect(await store.exists(key)).toBe(false);
    expect(await store.get(key)).toBeNull();
    await store.delete(key);
  });

  test.each(["../outside", "a/../../b", "/absolute", "a//b", "", "a/b/", "a\\b", "a/.."])("refuses the unsafe key %p", async (key) => {
    const store = make();
    await expect(store.put(key, bytes)).rejects.toThrow("Invalid retained file reference.");
    await expect(store.get(key)).rejects.toThrow("Invalid retained file reference.");
  });
});

describe("Disk store", () => {
  test("keeps files private under its directory", async () => {
    const store = new DiskStore(resolve(directory, "private"));
    await store.put("owner/import/file.pdf", bytes);
    expect((await stat(resolve(directory, "private/owner/import/file.pdf"))).mode & 0o777).toBe(0o600);
    expect((await stat(resolve(directory, "private/owner"))).mode & 0o777).toBe(0o700);
    expect(await readdir(directory)).not.toContain("outside");
  });
});

describe("S3 store", () => {
  test("sends signed path-style requests to the configured bucket", async () => {
    s3.requests.length = 0;
    const store = new S3Store(s3.client);
    await store.put("owner/import/file.pdf", bytes);
    expect(await store.get("owner/import/file.pdf")).toEqual(bytes);
    expect(s3.objects.get("owner/import/file.pdf")).toEqual(bytes);
    expect(s3.requests).toEqual(["PUT /stillgotit-test/owner/import/file.pdf", "GET /stillgotit-test/owner/import/file.pdf"]);
  });

  test("each call has a time limit", async () => {
    s3.state.delay = 1000;
    try {
      const store = new S3Store(s3.client, 100), started = performance.now();
      await expect(store.get("owner/import/slow.pdf")).rejects.toThrow("The file store did not respond in time. Try again.");
      await expect(store.put("owner/import/slow.pdf", bytes)).rejects.toThrow("The file store did not respond in time. Try again.");
      expect(performance.now() - started).toBeLessThan(900);
    } finally { s3.state.delay = 0; }
  });

  test("storage errors become one plain message without provider details", async () => {
    s3.state.status = 403;
    const logged = spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const store = new S3Store(s3.client);
      for (const call of [() => store.get("owner/import/file.pdf"), () => store.put("owner/import/file.pdf", bytes), () => store.exists("owner/import/file.pdf")]) {
        const error = await call().then(() => null, (reason: Error) => reason);
        expect(error?.message).toBe("Saved files are unavailable right now. Try again later.");
      }
      expect(logged.mock.calls.flat().join(" ")).not.toContain("Bucket policy detail");
    } finally { s3.state.status = 0; logged.mockRestore(); }
  });
});

describe("Store selection", () => {
  test("uses S3 when the S3 variables are set and the local disk otherwise", async () => {
    expect(fileStore({})).toBeInstanceOf(DiskStore);
    const store = fileStore(s3.env);
    expect(store).toBeInstanceOf(S3Store);
    await store.put("owner/import/selected.pdf", bytes);
    expect(s3.objects.get("owner/import/selected.pdf")).toEqual(bytes);
  });

  test("partial S3 settings stop startup with the missing names", () => {
    expect(() => fileStore({ S3_BUCKET: "files" })).toThrow("S3 file storage is partly configured. Set S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY.");
    expect(() => fileStore({ S3_ENDPOINT: "https://storage.example", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b" })).toThrow("Set S3_BUCKET.");
  });
});
