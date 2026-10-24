import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { MongoError, MongoServerError } from "mongodb";
import {
  GroundedTutoring, InvalidTutoringMaterial, type Material, type MaterialData, type MaterialImport,
} from "../src/concepts/GroundedTutoring/GroundedTutoring.ts";
import type { MediaValue } from "../src/concepts/GroundedTutoring/media.ts";
import { connectMongo, localMongoUri } from "../src/storage/mongo.ts";

const database = `stillgotit_test_${randomUUID().replaceAll("-", "")}`;
const uri = process.env.MONGODB_TEST_URI ?? localMongoUri;
let connection: Awaited<ReturnType<typeof connectMongo>> | undefined;

beforeAll(async () => { connection = await connectMongo({ uri, database }); });
afterAll(async () => {
  if (!connection) return;
  try { await connection.db.dropDatabase(); }
  finally { await connection.client.close(); }
});

function setup() {
  const name = `GroundedTutoring_${randomUUID()}`;
  const collectionName = `${name.toLowerCase()}.materials`;
  return {
    name, collectionName,
    tutoring: new GroundedTutoring(connection!.db, name),
    records: connection!.db.collection<MaterialData & { _id: Material }>(collectionName),
  };
}

function request(overrides: Partial<MaterialImport> = {}): MaterialImport {
  return {
    importKey: randomUUID(),
    owner: "learner-sam", scope: "course-linear-algebra", title: "Matrix multiplication",
    locator: "source:matrix-lesson", content: "Each product entry combines a row with a column.",
    originals: [], origin: "COURSE", ...overrides,
  };
}

function materialData({ importKey: _, ...data }: MaterialImport): MaterialData { return data; }

// Metadata fixtures only. File extraction and byte access are outside this concept step.
function source(): MediaValue {
  return {
    file: "retained-lesson-pdf", name: "matrix-lesson.pdf", mediaType: "application/pdf",
    renditions: [
      { kind: "TEXT", location: "lesson/page/1", text: "Multiply a row by a column." },
      { kind: "IMAGE", location: "lesson/page/2", file: "retained-page-2", mediaType: "image/png" },
    ],
    limitations: ["Page 2 is available as an image; its text could not be extracted."],
  };
}

describe("GroundedTutoring material storage", () => {
  test("stores text with a new ID and returns exactly the specified query fields", async () => {
    const { tutoring, records } = setup();
    const input = request();
    const result = await tutoring.addMaterial(input);
    expect(Object.keys(result)).toEqual(["material"]);
    expect(result.material).toMatch(/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    expect(await records.findOne({ _id: result.material })).toEqual({ _id: result.material, ...input });
    expect(await tutoring._material(result)).toEqual([materialData(input)]);
    expect(await tutoring._materials(input)).toEqual([{
      material: result.material, title: input.title, locator: input.locator, origin: input.origin,
    }]);
  });

  test("stores readable renditions, original order, locations, and extraction gaps when content is blank", async () => {
    const { tutoring } = setup();
    const lecture: MediaValue = {
      file: "retained-lecture-audio", name: "lecture.mp3", mediaType: "audio/mpeg",
      renditions: [{ kind: "TEXT", location: "lecture/time/00:30-00:45", text: "Check the inner dimensions." }],
      limitations: ["Transcription has not been checked by the learner."],
    };
    const input = request({ content: "", originals: [source(), lecture], origin: "REFERENCE" });
    const saved = await tutoring.addMaterial(input);
    expect(await tutoring._material(saved)).toEqual([materialData(input)]);
  });

  test("accepts a retained image as readable material without requiring extracted text", async () => {
    const { tutoring } = setup();
    const image: MediaValue = {
      file: "retained-original-photo", name: "worked-example.jpg", mediaType: "image/jpeg",
      renditions: [{ kind: "IMAGE", location: "photo/whole", file: "retained-readable-photo", mediaType: "image/jpeg" }],
      limitations: [],
    };
    const input = request({ content: " \n", originals: [image] });
    expect(await tutoring._material(await tutoring.addMaterial(input))).toEqual([materialData(input)]);
  });

  test("preserves unreadable originals and their limits when another source provides readable content", async () => {
    const { tutoring } = setup();
    const unreadable: MediaValue = {
      file: "retained-appendix", name: "appendix.pdf", mediaType: "application/pdf",
      renditions: [], limitations: ["The appendix is encrypted and was not read."],
    };
    const input = request({ content: "", originals: [unreadable, source()] });
    expect(await tutoring._material(await tutoring.addMaterial(input))).toEqual([materialData(input)]);
    const textOnly = request({ originals: [unreadable] });
    expect(await tutoring._material(await tutoring.addMaterial(textOnly))).toEqual([materialData(textOnly)]);
  });

  test("refuses blank fields and unreadable material before creating a collection", async () => {
    const { tutoring, collectionName } = setup();
    const unreadable = { ...source(), renditions: [] };
    for (const input of [
      request({ title: "" }), request({ title: " \n\t" }), request({ locator: " " }),
      request({ content: "" }), request({ content: " \n", originals: [unreadable] }),
    ]) {
      const action = tutoring.addMaterial(input);
      await expect(action).rejects.toBeInstanceOf(InvalidTutoringMaterial);
      await expect(action).rejects.toMatchObject({
        code: "INVALID_TUTORING_MATERIAL", message: "Provide a title, source location, and readable material.",
      });
    }
    expect(await connection!.db.listCollections({ name: collectionName }).toArray()).toEqual([]);
  });

  test("rejects malformed fields and file metadata even when the content is readable", async () => {
    const { tutoring, records } = setup();
    const malformed = [
      null, [], undefined,
      { ...request(), owner: { $ne: "" } }, { ...request(), scope: "" },
      { ...request(), title: 3 }, { ...request(), locator: null },
      { ...request(), content: null }, { ...request(), origin: "UNKNOWN" },
      { ...request(), originals: null }, { ...request(), originals: new Array(1) },
      ...[
        { ...source(), file: " " }, { ...source(), name: "" },
        { ...source(), mediaType: "pdf" }, { ...source(), limitations: [null] },
        { ...source(), renditions: new Array(1) }, { ...source(), readable: true },
        { ...source(), renditions: [{ kind: "TEXT", location: "page/1", text: " " }] },
        { ...source(), renditions: [{ kind: "TEXT", location: "", text: "A row." }] },
        { ...source(), renditions: [{ kind: "IMAGE", location: "page/1", file: "", mediaType: "image/png" }] },
        { ...source(), renditions: [{ kind: "IMAGE", location: "page/1", file: "f", mediaType: "application/pdf" }] },
        { ...source(), renditions: [{ kind: "AUDIO", location: "part/1", file: "f" }] },
      ].map((item) => ({ ...request(), originals: [item] })),
    ];
    for (const input of malformed) {
      await expect(tutoring.addMaterial(input as MaterialImport)).rejects.toBeInstanceOf(InvalidTutoringMaterial);
    }
    expect(await records.countDocuments()).toBe(0);
  });

  test("accepts page renditions for pages without text and HEIC and HEIF images as readable material", async () => {
    const { tutoring } = setup();
    const scan: MediaValue = {
      file: "retained-scan-pdf", name: "scan.pdf", mediaType: "application/pdf",
      renditions: [{ kind: "PAGE", location: "scan/page/1", page: 1 }, { kind: "TEXT", location: "scan/page/2", text: "Typed notes." },
        { kind: "PAGE", location: "scan/page/3", page: 3 }],
      limitations: ["Pages 1 and 3 have no selectable text. The tutor reads those pages as images."],
    };
    const onlyPages = request({ content: "", originals: [{ ...scan, renditions: [{ kind: "PAGE", location: "scan/page/1", page: 1 }] }] });
    expect(await tutoring._material(await tutoring.addMaterial(onlyPages))).toEqual([materialData(onlyPages)]);
    const photos = (["image/heic", "image/heif"] as const).map((mediaType, index): MediaValue => ({
      file: `retained-photo-${index}`, name: `board-${index}.heic`, mediaType,
      renditions: [{ kind: "IMAGE", location: `photo-${index}/image`, file: `retained-photo-${index}`, mediaType }], limitations: [],
    }));
    const mixed = request({ content: "", originals: [scan, ...photos] });
    expect(await tutoring._material(await tutoring.addMaterial(mixed))).toEqual([materialData(mixed)]);
  });

  test("still rejects malformed page renditions and other image types", async () => {
    const { tutoring, records } = setup();
    const page = { kind: "PAGE", location: "scan/page/1", page: 1 };
    const malformed = [
      { ...page, page: 0 }, { ...page, page: -1 }, { ...page, page: 1.5 }, { ...page, page: "1" }, { ...page, page: Number.NaN },
      { ...page, page: Number.POSITIVE_INFINITY }, { ...page, page: 2 ** 53 }, { ...page, location: " " }, { kind: "PAGE", location: "scan/page/1" },
      { kind: "PAGE", page: 1 }, { ...page, text: "Extra text" }, { ...page, file: "retained-scan-pdf" }, { ...page, kind: "page" },
      { kind: "IMAGE", location: "photo/image", file: "f", mediaType: "image/gif" },
      { kind: "IMAGE", location: "photo/image", file: "f", mediaType: "image/avif" },
      { kind: "IMAGE", location: "photo/image", file: "f", mediaType: "image/HEIC" },
    ];
    for (const rendition of malformed) {
      const input = request({ content: "", originals: [{ ...source(), renditions: [rendition] } as unknown as MediaValue] });
      await expect(tutoring.addMaterial(input), JSON.stringify(rendition)).rejects.toBeInstanceOf(InvalidTutoringMaterial);
    }
    expect(await records.countDocuments()).toBe(0);
  });

  test("rejects page renditions outside a PDF, a repeated page, and a page that also has text", async () => {
    const { tutoring, records } = setup();
    const page = (number: number, location = `scan/page/${number}`) => ({ kind: "PAGE" as const, location, page: number });
    const text = (location: string) => ({ kind: "TEXT" as const, location, text: "Typed notes." });
    const pdf = (renditions: MediaValue["renditions"], mediaType = "application/pdf"): MediaValue =>
      ({ file: "retained-scan", name: "scan.pdf", mediaType, renditions, limitations: [] });
    const refused: [string, MediaValue][] = [
      ["an image original", pdf([page(1)], "image/png")],
      ["a text original", pdf([page(1)], "text/plain")],
      ["an unknown binary original", pdf([page(1)], "application/octet-stream")],
      ["the same page twice", pdf([page(2), page(2)])],
      ["the same page twice at different locations", pdf([page(2), page(3), page(2, "scan/page/2-again")])],
      ["text at the page's location", pdf([text("scan/page/2"), page(2)])],
      ["text at the page's location, after it", pdf([page(1), page(2), text("scan/page/2")])],
      ["text at the page's own location in another format", pdf([page(2, "scan/p2"), text("scan/p2")])],
      ["text for the same page number", pdf([page(2, "scan/p2"), text("scan/page/2")])],
    ];
    for (const [label, original] of refused) {
      await expect(tutoring.addMaterial(request({ content: "", originals: [original] })), label).rejects.toBeInstanceOf(InvalidTutoringMaterial);
      // Readable content elsewhere does not excuse an original that breaks the rule.
      await expect(tutoring.addMaterial(request({ originals: [source(), original] })), label).rejects.toBeInstanceOf(InvalidTutoringMaterial);
    }
    expect(await records.countDocuments()).toBe(0);

    // The rule holds within one original: two PDFs may each have a page 1, and text for other pages is fine.
    const accepted = request({ content: "", originals: [
      pdf([page(1), text("scan/page/2"), page(3)]), { ...pdf([page(1, "other/page/1")]), file: "retained-other", name: "other.pdf" },
    ] });
    expect(await tutoring._material(await tutoring.addMaterial(accepted))).toEqual([materialData(accepted)]);
  });

  test("snapshots validated input before database waits and leaves saved data unchanged after caller edits", async () => {
    const { tutoring } = setup();
    const original = {
      ...source(), limitations: ["Original limitation."],
      renditions: [{ kind: "TEXT" as const, location: "page/1", text: "Original text." }],
    };
    const input = { ...request(), content: "", originals: [original] };
    const expected = structuredClone(input);
    const pending = tutoring.addMaterial(input);
    input.title = "Changed while waiting";
    input.importKey = "changed-while-waiting";
    original.renditions[0]!.text = "Changed text";
    original.limitations.push("Changed limitation");
    input.originals.push(original);
    const saved = await pending;
    expect(await tutoring._material(saved)).toEqual([materialData(expected)]);
    expect(await tutoring.addMaterial(expected)).toEqual(saved);
    const [read] = await tutoring._material(saved);
    read!.title = "Changed query result";
    (read!.originals[0]!.limitations as string[]).push("Changed query result");
    expect(await tutoring._material(saved)).toEqual([materialData(expected)]);
  });

  test("lists only the requested owner and scope, in ID order, without content or originals", async () => {
    const { tutoring } = setup();
    const inputs = [request(), request({ title: "Order matters", origin: "REFERENCE" }), request({ title: "Dimensions" })];
    const saved = await Promise.all(inputs.map((input) => tutoring.addMaterial(input)));
    await tutoring.addMaterial(request({ owner: "learner-leo" }));
    await tutoring.addMaterial(request({ scope: "course-physics" }));
    const expected = saved.map(({ material }, index) => ({
      material, title: inputs[index]!.title, locator: inputs[index]!.locator, origin: inputs[index]!.origin,
    })).sort((a, b) => a.material.localeCompare(b.material));
    expect(await tutoring._materials(request())).toEqual(expected);
    expect(await tutoring._materials({ owner: "learner-missing", scope: request().scope })).toEqual([]);
    expect(await tutoring._materials({ owner: request().owner, scope: "course-missing" })).toEqual([]);
  });

  test("empty queries change no state and reject malformed identifiers instead of MongoDB operators", async () => {
    const { tutoring, collectionName } = setup();
    expect(await tutoring._materials(request())).toEqual([]);
    expect(await tutoring._material({ material: randomUUID() as Material })).toEqual([]);
    for (const value of [null, undefined, "", " ", { $ne: "" }, ["learner-sam"]]) {
      await expect(tutoring._materials({ owner: value as string, scope: request().scope })).rejects.toBeInstanceOf(TypeError);
      await expect(tutoring._materials({ owner: request().owner, scope: value as string })).rejects.toBeInstanceOf(TypeError);
      await expect(tutoring._material({ material: value as Material })).rejects.toBeInstanceOf(TypeError);
    }
    expect(await connection!.db.listCollections({ name: collectionName }).toArray()).toEqual([]);
  });

  test("new import keys get new IDs; a changed source keeps the earlier material readable", async () => {
    const { tutoring } = setup();
    const input = request({ originals: [source()] });
    const first = await tutoring.addMaterial(input);
    const duplicate = await tutoring.addMaterial({ ...input, importKey: randomUUID() });
    const revision = request({ ...input, importKey: randomUUID(), content: "A revised explanation." });
    const second = await tutoring.addMaterial(revision);
    expect(new Set([first.material, duplicate.material, second.material]).size).toBe(3);
    expect(await tutoring._material(first)).toEqual([materialData(input)]);
    expect(await tutoring._material(duplicate)).toEqual([materialData(input)]);
    expect(await tutoring._material(second)).toEqual([materialData(revision)]);
  });

  test("a rejected insert saves no partial material, stays a database error, and allows a later valid write", async () => {
    const { tutoring, collectionName, records } = setup();
    await connection!.db.createCollection(collectionName, { validator: { title: { $ne: "blocked" } } });
    const failed = tutoring.addMaterial(request({ title: "blocked" }));
    await expect(failed).rejects.toBeInstanceOf(MongoServerError);
    await expect(failed).rejects.toMatchObject({ code: 121 });
    expect(await records.countDocuments()).toBe(0);
    const input = request();
    expect(await tutoring._material(await tutoring.addMaterial(input))).toEqual([materialData(input)]);
  });

  test("query failures remain errors instead of being reported as empty lists", async () => {
    const { name } = setup();
    const reader = await connectMongo({ uri, database });
    const tutoring = new GroundedTutoring(reader.db, name);
    await reader.client.close();
    await expect(tutoring._materials(request())).rejects.toBeInstanceOf(MongoError);
    await expect(tutoring._material({ material: randomUUID() as Material })).rejects.toBeInstanceOf(MongoError);
  });

  test("a fresh process reads saved material after its writer closes; another namespace stays separate", async () => {
    const { name } = setup();
    const input = request({ originals: [source()] });
    const writer = await connectMongo({ uri, database });
    let saved: { material: Material };
    try { saved = await new GroundedTutoring(writer.db, name).addMaterial(input); }
    finally { await writer.client.close(); }

    const child = Bun.spawn([
      process.execPath, fileURLToPath(new URL("./fixtures/read-material.ts", import.meta.url)), database, name, saved.material,
    ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdout: "pipe", stderr: "pipe" });
    const [output, errors, exitCode] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect({ exitCode, errors }).toEqual({ exitCode: 0, errors: "" });
    expect(JSON.parse(output)).toEqual({ saved: materialData(input), materials: [{
      ...saved, title: input.title, locator: input.locator, origin: input.origin,
    }] });
    const separate = new GroundedTutoring(connection!.db, `${name}_other`);
    expect(await separate._material(saved)).toEqual([]);
    expect(await separate._materials(input)).toEqual([]);
  });
});
