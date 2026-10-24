/**
 * Browser-side checks for importing materials: the place labels of every location kind, and the host transport in
 * frontend/src/host-api.ts (each upload answer and refusal, the request-ID rule, answers that are not the app's own,
 * no answer, timeout and cancellation, and the listing, retry, remove and file routes). `fetch` is replaced per test.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { pageOf, placeLabel, timeRangeOf } from "../frontend/src/locations.ts";
import { sourceLabel } from "../frontend/src/labels.ts";
import {
  HostError, hostRequest, importMaterial, listImports, materialFile, refusalStartsNewImport, removeImport, retryImport, uploadMaterial,
} from "../frontend/src/host-api.ts";

/** Material IDs are branded strings in the browser's types. */
const material = (id: string) => id as Parameters<typeof materialFile>[0];

describe("place labels", () => {
  test("every kind of location", () => {
    expect(placeLabel("9c1f0e2ab34d5e6f/page/3")).toBe("Page 3");
    expect(placeLabel("4be0c1d29a7f3e65/time/12:30-12:45")).toBe("12:30–12:45");
    expect(placeLabel("a3c58e7f20d1b694/time/59:48-1:00:21")).toBe("59:48–1:00:21");
    expect(placeLabel("d04e7a5c19b2f368/image")).toBe("Image");
    expect(placeLabel("0f9d2b6e4a8c1735/slide/4")).toBe("Slide 4");
    expect(placeLabel("51e8a0d3c7f2b964/lines/1-100")).toBe("Lines 1–100");
    expect(placeLabel("7a2c4e9f0b1d3865/cell/2")).toBe("Cell 2");
    expect(placeLabel("e3b7c1a09d4f2658/document")).toBe("Document");
    expect(placeLabel("6c4a8e1f3d0b2975/sheet/Grades/rows/1-40")).toBe("Sheet Grades");
    expect(placeLabel("6c4a8e1f3d0b2975/sheet/Grades/rows/5-40")).toBe("Sheet Grades, rows 5–40");
    expect(placeLabel("content")).toBe("Material text");
    expect(placeLabel("6c4a8e1f3d0b2975/figure/2")).toBe("Figure 2");
  });
  test("pages and time ranges", () => {
    expect(pageOf("9c1f0e2ab34d5e6f/page/12")).toBe(12);
    expect(pageOf("9c1f0e2ab34d5e6f/slide/12")).toBeNull();
    expect(pageOf("content")).toBeNull();
    expect(timeRangeOf("4be0c1d29a7f3e65/time/00:21-00:50")).toEqual({ start: 21, end: 50 });
    expect(timeRangeOf("a3c58e7f20d1b694/time/59:48-1:00:21")).toEqual({ start: 3588, end: 3621 });
    expect(timeRangeOf("a3c58e7f20d1b694/time/1:02:05-1:02:40")).toEqual({ start: 3725, end: 3760 });
    expect(timeRangeOf("a3c58e7f20d1b694/page/2")).toBeNull();
  });
  test("citation text", () => {
    expect(sourceLabel("9c1f0e2ab34d5e6f/page/3", "Lecture 4")).toBe("Lecture 4 · Page 3");
    expect(sourceLabel("content", " ")).toBe("Course material · Material text");
  });
});

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;
function answer(respond: (call: Call) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => { const call = { url, init }; calls.push(call); return respond(call); }) as typeof fetch;
}
const json = (value: unknown, status = 200) => Response.json(value, { status });
afterEach(() => { globalThis.fetch = realFetch; });
async function failure(work: Promise<unknown>) {
  try { await work; } catch (problem) { return problem as HostError; }
  throw new Error("expected a failure");
}
const form = () => { const data = new FormData(); data.set("requestId", "r1"); return data; };

describe("upload route", () => {
  test("a material, and imports that finish later", async () => {
    answer(() => json({ material: "m1" }));
    expect(await importMaterial(form())).toEqual({ material: material("m1") });
    expect(calls[0]!.url).toBe("/api/courses/materials/add");
    expect(calls[0]!.init.method).toBe("POST");
    expect(calls[0]!.init.body).toBeInstanceOf(FormData);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    answer(() => json({ requestId: "r1", state: "TRANSCRIBING" }));
    expect(await importMaterial(form())).toEqual({ requestId: "r1", state: "TRANSCRIBING" });
    answer(() => json({ requestId: "r1", state: "SAVING" }));
    expect(await importMaterial(form())).toEqual({ requestId: "r1", state: "SAVING" });
  });
  test("each declared refusal keeps its code and sentence; only two start a new import", async () => {
    const cases: [string, number, string, boolean][] = [
      ["UPLOAD_BUSY", 429, "Another upload is being saved. Try again in a minute.", false],
      ["UPLOAD_TIMEOUT", 400, "Saving this upload took too long. Try again in a minute, or upload fewer files at a time. The app continues from what it already saved.", false],
      ["IMPORT_REMOVED", 409, "This import was removed. Choose the files again.", true],
      ["IMPORT_REQUEST_CONFLICT", 409, "This upload doesn't match the import started with these details. Choose the files again to start a new import.", true],
      ["OPERATION_FAILED", 400, "Choose files with a combined size of 95 MB or less.", false],
    ];
    for (const [code, status, detail, fresh] of cases) {
      answer(() => json({ error: code, detail }, status));
      const problem = await failure(importMaterial(form()));
      expect(problem).toBeInstanceOf(HostError);
      expect([problem.code, problem.message, problem.answered]).toEqual([code, detail, true]);
      expect(refusalStartsNewImport(problem)).toBe(fresh);
    }
    answer(() => json({ error: "UNAUTHORIZED" }, 401));
    const signedOut = await failure(importMaterial(form()));
    expect([signedOut.code, signedOut.message, refusalStartsNewImport(signedOut)]).toEqual(["UNAUTHORIZED", "Your session ended. Sign in again.", false]);
    answer(() => json({ error: "FORBIDDEN" }, 403));
    expect((await failure(importMaterial(form()))).message).toBe("The request could not finish. Your saved work is still available.");
  });
  test("no answer, or an answer that is not the app's own, keeps the request ID", async () => {
    answer(() => new Response("<html>A timeout occurred</html>", { status: 524, headers: { "Content-Type": "text/html" } }));
    const page = await failure(importMaterial(form()));
    expect([page.code, page.answered, refusalStartsNewImport(page)]).toEqual(["NOT_APP_ANSWER", false, false]);
    answer(() => { throw new TypeError("Failed to fetch"); });
    const offline = await failure(importMaterial(form()));
    expect([offline.code, offline.answered]).toEqual(["NETWORK_ERROR", false]);
    expect(offline.message).toBe("The server did not answer. Check your connection and try again. Your saved work is still there.");
    answer(() => json({ ok: true }));
    expect((await failure(importMaterial(form()))).code).toBe("NOT_APP_ANSWER");
    // A proxy that answers 200 with a page.
    answer(() => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }));
    expect((await failure(importMaterial(form()))).answered).toBe(false);
  });
  test("timeout and cancellation are told apart", async () => {
    answer(({ init }) => new Promise((_, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason))));
    const timedOut = await failure(hostRequest("/x", {}, AbortSignal.timeout(5)));
    expect([timedOut.code, timedOut.answered]).toEqual(["TIMEOUT", false]);
    const controller = new AbortController();
    const cancelled = failure(hostRequest("/x", {}, controller.signal));
    controller.abort();
    expect([(await cancelled).code, (await cancelled).answered]).toEqual(["CANCELLED", false]);
  });
  test("an attachment needs the material at once", async () => {
    answer(() => json({ material: "m2" }));
    expect(await uploadMaterial(form())).toEqual({ material: material("m2") });
    answer(() => json({ requestId: "r1", state: "SAVING" }));
    expect((await failure(uploadMaterial(form()))).code).toBe("SAVING");
    answer(() => json({ requestId: "r1", state: "TRANSCRIBING" }));
    expect((await failure(uploadMaterial(form()))).code).toBe("TRANSCRIBING");
  });
});

const entry = { requestId: "r1", title: "Lecture 5", state: "TRANSCRIBING", files: [{ name: "notes.pdf", state: "DONE" }, { name: "lecture.mp4", state: "WAITING" }], canRetry: false, canRemove: true };
describe("import routes", () => {
  test("listing", async () => {
    answer(() => json({ imports: [entry, { ...entry, requestId: "r2", state: "FAILED", detail: "The AI service is busy. Try again in a few minutes.", canRetry: true }], saved: ["m9"] }));
    const listing = await listImports("c1");
    expect(listing.imports).toHaveLength(2);
    expect(listing.saved).toEqual([material("m9")]);
    expect(calls[0]!.url).toBe("/api/courses/materials/imports");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ course: "c1" });
    expect((calls[0]!.init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    answer(() => json({ imports: [{ ...entry, state: "DONE" }], saved: [] }));
    expect((await failure(listImports("c1"))).code).toBe("NOT_APP_ANSWER");
    answer(() => json({ imports: [entry] }));
    expect((await failure(listImports("c1"))).code).toBe("NOT_APP_ANSWER");
    answer(() => json({ error: "FORBIDDEN" }, 403));
    expect((await failure(listImports("c1"))).code).toBe("FORBIDDEN");
  });
  test("retry and remove", async () => {
    answer(() => json({ ...entry, state: "TRANSCRIBING" }));
    expect((await retryImport("r1")).state).toBe("TRANSCRIBING");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ requestId: "r1" });
    expect(calls[0]!.url).toBe("/api/courses/materials/imports/retry");
    answer(() => json({ error: "IMPORT_NOT_RETRYABLE", detail: "This import can't be retried. Remove it and upload the files again." }, 409));
    expect((await failure(retryImport("r1"))).message).toBe("This import can't be retried. Remove it and upload the files again.");
    answer(() => json({}));
    await removeImport("r1");
    expect(calls[0]!.url).toBe("/api/courses/materials/imports/remove");
    answer(() => json({ error: "IMPORT_ALREADY_SAVED", detail: "This import is already in your library. Reload the page to see it." }, 409));
    expect((await failure(removeImport("r1"))).code).toBe("IMPORT_ALREADY_SAVED");
    answer(() => json({ error: "OPERATION_FAILED", detail: "This import could not be removed. Ask the app owner for help." }, 400));
    expect((await failure(removeImport("r1"))).message).toBe("This import could not be removed. Ask the app owner for help.");
  });
  test("file route", async () => {
    answer(() => new Response(new Uint8Array([37, 80, 68, 70]), { headers: { "Content-Type": "application/octet-stream" } }));
    const bytes = await materialFile(material("m1"), "f1", "application/pdf");
    expect(bytes.type).toBe("application/pdf");
    expect(bytes.size).toBe(4);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ material: "m1", file: "f1" });
    answer(() => json({ error: "OPERATION_FAILED", detail: "This saved file is no longer available." }, 400));
    expect((await failure(materialFile(material("m1"), "f1", "application/pdf"))).message).toBe("This saved file is no longer available.");
    answer(() => json({ error: "FORBIDDEN" }, 403));
    expect((await failure(materialFile(material("m1"), "f1", "application/pdf"))).message).toBe("That file could not be opened. Try again.");
    answer(() => new Response("<html>", { status: 502 }));
    expect((await failure(materialFile(material("m1"), "f1", "application/pdf"))).code).toBe("NOT_APP_ANSWER");
  });
});
