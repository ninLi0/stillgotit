import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Collection, type Document, type Filter } from "mongodb";
import { MaterialKeeping, type Material, type MaterialData, type MaterialImport } from "../src/concepts/MaterialKeeping/MaterialKeeping.ts";
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
  const name = `MaterialKeeping_${randomUUID()}`;
  return {
    name,
    library: new MaterialKeeping(connection!.db, name),
    records: connection!.db.collection<MaterialData & { _id: Material; importKey?: string }>(`${name.toLowerCase()}.materials`),
  };
}

function request(overrides: Partial<MaterialImport> = {}): MaterialImport {
  return {
    owner: "learner-sam", importKey: "import-matrix-lesson", scope: "course-linear-algebra",
    title: "Matrix multiplication", locator: "source:matrix-lesson", content: "Multiply a row by a column.",
    originals: [{
      file: "retained-lesson", name: "lesson.pdf", mediaType: "application/pdf",
      renditions: [
        { kind: "TEXT", location: "lesson/page/1", text: "Check the inner dimensions." },
        { kind: "IMAGE", location: "lesson/page/2", file: "retained-page-2", mediaType: "image/png" },
      ],
      limitations: ["Page 2 is available as an image."],
    }],
    origin: "COURSE", ...overrides,
  };
}

// Hold both real reads after they see an unused key. The database must settle the competing inserts.
async function race(fixture: ReturnType<typeof setup>, inputs: [MaterialImport, MaterialImport]) {
  const other = await connectMongo({ uri, database });
  const second = new MaterialKeeping(other.db, fixture.name);
  const original = Collection.prototype.findOne;
  const ready = Promise.withResolvers<void>();
  const timeout = setTimeout(() => ready.reject(new Error("Both import reads must arrive.")), 5_000);
  let reads = 0;
  const read = spyOn(Collection.prototype, "findOne").mockImplementation(
    async function<T>(this: Collection, filter: Filter<Document> = {}, options?: Parameters<typeof original>[1]): Promise<T | null> {
      const found = await original.call(this, filter, options);
      if (this.dbName === database && this.collectionName === fixture.records.collectionName &&
        filter.importKey !== undefined && reads < 2) {
        expect(found).toBeNull();
        reads += 1;
        if (reads === 2) ready.resolve();
        await ready.promise;
      }
      return found as T | null;
    },
  );
  try {
    const outcomes = await Promise.allSettled([
      fixture.library.add(inputs[0]), second.add(inputs[1]),
    ]);
    expect(reads).toBe(2);
    return outcomes;
  } finally {
    clearTimeout(timeout);
    read.mockRestore();
    await other.client.close();
  }
}

async function retryInNewProcess(name: string, input: MaterialImport) {
  const child = Bun.spawn([
    process.execPath, fileURLToPath(new URL("./fixtures/retry-material.ts", import.meta.url)), database, name,
  ], { env: { ...process.env, MONGODB_TEST_URI: uri }, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
  child.stdin.write(JSON.stringify(input));
  await child.stdin.end();
  const [output, errors, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  expect({ exitCode, errors }).toEqual({ exitCode: 0, errors: "" });
  return JSON.parse(output);
}

describe("MaterialKeeping import retries", () => {
  test("matching retries return the same material without changing its record", async () => {
    const { library, records } = setup();
    const input = request();
    const saved = await library.add(input);
    const before = await records.find().toArray();
    expect(await library.add(structuredClone(input))).toEqual(saved);
    expect(await library.add(input)).toEqual(saved);
    expect(await records.find().toArray()).toEqual(before);
    expect(before).toEqual([{ _id: saved.material, ...input }]);
    const { importKey: _, ...material } = input;
    expect(await library._material(saved)).toEqual([material]);
    expect(await library._materials(input)).toEqual([{
      ...saved, title: input.title, locator: input.locator, origin: input.origin,
    }]);
  });

  test("blank and malformed import keys are refused before storage work", async () => {
    const { library, records } = setup();
    for (const importKey of [undefined, null, "", " \n", "\u00a0", 17, { $ne: "" }, ["key"]]) {
      await expect(library.add(request({ importKey: importKey as string }))).rejects.toMatchObject({
        code: "INVALID_MATERIAL_IMPORT_KEY", message: "Provide a nonblank import key.",
      });
    }
    expect(await connection!.db.listCollections({ name: records.collectionName }).toArray()).toEqual([]);
    expect(await library.add(request())).toHaveProperty("material");
  });

  test("changed fields and nested media refuse the used key and preserve all saved data", async () => {
    const { library, records } = setup();
    const input = request();
    const saved = await library.add(input);
    const before = await records.find().toArray();
    const changes: Partial<MaterialImport>[] = [
      { scope: "course-physics" }, { title: "Different title" }, { locator: "source:other" },
      { content: "Different explanation." }, { origin: "REFERENCE" }, { originals: [] },
      { content: `${input.content} ` },
    ];
    const source = input.originals[0]!;
    for (const change of [
      { file: "another-file" }, { name: "another-name.pdf" }, { mediaType: "image/png" },
      { limitations: [] }, { renditions: [...source.renditions].reverse() },
      { renditions: [{ kind: "TEXT" as const, location: "changed/page/1", text: "Check the inner dimensions." }] },
      { renditions: [{ kind: "TEXT" as const, location: "lesson/page/1", text: "Changed text." }] },
      { renditions: [{ kind: "IMAGE" as const, location: "lesson/page/2", file: "other-page", mediaType: "image/png" as const }] },
    ]) changes.push({ originals: [{ ...source, ...change }] });
    for (const change of changes) {
      await expect(library.add({ ...input, ...change })).rejects.toMatchObject({
        code: "MATERIAL_IMPORT_CONFLICT", message: "Use the original material input for this import key.",
      });
      expect(await records.find().toArray()).toEqual(before);
    }
    expect(await library.add(input)).toEqual(saved);
  });

  test("equivalent records can change field order, but list order is significant", async () => {
    const { library } = setup();
    const first = request().originals[0]!;
    const second = { ...first, file: "other-original", limitations: ["First gap.", "Second gap."] };
    const input = request({ originals: [first, second] });
    const saved = await library.add(input);
    const reordered = input.originals.map(({ file, name, mediaType, renditions, limitations }) => ({
      limitations,
      renditions: renditions.map((item) => item.kind === "TEXT"
        ? { text: item.text, location: item.location, kind: item.kind }
        : item.kind === "PAGE" ? { page: item.page, location: item.location, kind: item.kind }
        : { mediaType: item.mediaType, file: item.file, location: item.location, kind: item.kind }),
      mediaType, name, file,
    }));
    expect(await library.add({ ...input, originals: reordered })).toEqual(saved);
    await expect(library.add({ ...input, originals: [second, first] })).rejects.toMatchObject({ code: "MATERIAL_IMPORT_CONFLICT" });
    await expect(library.add({ ...input, originals: [first, { ...second, limitations: [...second.limitations].reverse() }] }))
      .rejects.toMatchObject({ code: "MATERIAL_IMPORT_CONFLICT" });
  });

  test("keys are exact and scoped to the learner; new keys create independent materials", async () => {
    const { library, records } = setup();
    const input = request();
    const inputs = [input, { ...input, importKey: input.importKey.toUpperCase() },
      { ...input, importKey: ` ${input.importKey} ` }, { ...input, owner: "learner-leo" },
      { ...input, importKey: "revised-lesson", content: "A revised explanation." }];
    const results = await Promise.all(inputs.map((item) => library.add(item)));
    expect(new Set(results.map(({ material }) => material)).size).toBe(inputs.length);
    for (let index = 0; index < inputs.length; index++) {
      expect(await library.add(inputs[index]!)).toEqual(results[index]);
    }
    expect(await records.countDocuments()).toBe(inputs.length);
  });

  test("two clients with matching input race to one material and receive the same ID", async () => {
    const fixture = setup();
    const input = request();
    const outcomes = await race(fixture, [input, structuredClone(input)]);
    const saved = await fixture.records.find().toArray();
    expect(saved).toHaveLength(1);
    expect(outcomes).toEqual([
      { status: "fulfilled", value: { material: saved[0]!._id } },
      { status: "fulfilled", value: { material: saved[0]!._id } },
    ]);
    expect(saved[0]).toEqual({ _id: saved[0]!._id, ...input });
  });

  test("two clients with conflicting input save one complete record and refuse the loser", async () => {
    const fixture = setup();
    const inputs: [MaterialImport, MaterialImport] = [request(), request({ scope: "course-physics", title: "Physics" })];
    const outcomes = await race(fixture, inputs);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const losers = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]!.reason).toMatchObject({ code: "MATERIAL_IMPORT_CONFLICT" });
    const winnerIndex = outcomes.findIndex((outcome) => outcome.status === "fulfilled");
    const saved = winners[0]!.value;
    expect(await fixture.records.find().toArray()).toEqual([{ _id: saved.material, ...inputs[winnerIndex]! }]);
    expect(await fixture.library.add(inputs[winnerIndex]!)).toEqual(saved);
  });

  test("a committed save with a lost reply is recovered by a fresh process", async () => {
    const { name, records } = setup();
    const writer = await connectMongo({ uri, database });
    const input = request();
    const lostReply = new Error("Simulated lost material reply.");
    const original = Collection.prototype.insertOne;
    let intercepted = false;
    const insert = spyOn(Collection.prototype, "insertOne").mockImplementation(
      async function(this: Collection, document, options) {
        const result = await original.call(this, document, options);
        if (this.dbName === database && this.collectionName === records.collectionName && !intercepted) {
          intercepted = true;
          throw lostReply;
        }
        return result;
      },
    );
    try {
      await expect(new MaterialKeeping(writer.db, name).add(input)).rejects.toBe(lostReply);
      expect(intercepted).toBe(true);
    } finally {
      insert.mockRestore();
      await writer.client.close();
    }
    const before = await records.find().toArray();
    expect(before).toEqual([{ _id: expect.any(String), ...input }]);
    expect(await retryInNewProcess(name, input)).toEqual({ material: before[0]!._id });
    expect(await records.find().toArray()).toEqual(before);
  });

  test("a restarted process reuses a completed import after the writer closes", async () => {
    const { name, records } = setup();
    const writer = await connectMongo({ uri, database });
    const input = request();
    let saved: { material: Material };
    try { saved = await new MaterialKeeping(writer.db, name).add(input); }
    finally { await writer.client.close(); }
    expect(await retryInNewProcess(name, input)).toEqual(saved);
    expect(await records.find().toArray()).toEqual([{ _id: saved.material, ...input }]);
  });

  test("a rejected save reserves no key and the same request can succeed later", async () => {
    const { library, records } = setup();
    const input = request();
    await connection!.db.createCollection(records.collectionName, { validator: { title: { $ne: input.title } } });
    await expect(library.add(input)).rejects.toMatchObject({ code: 121 });
    expect(await records.countDocuments()).toBe(0);
    await connection!.db.command({ collMod: records.collectionName, validator: {} });
    const saved = await library.add(input);
    expect(await library.add(input)).toEqual(saved);
    expect(await records.find().toArray()).toEqual([{ _id: saved.material, ...input }]);
  });

  test("an unrelated unique-index failure remains a database error", async () => {
    const { library, records } = setup();
    await records.createIndex({ testConstraint: 1 }, { unique: true });
    const input = request();
    const saved = await library.add(input);
    await expect(library.add({ ...input, importKey: "another-import" })).rejects.toMatchObject({
      code: 11000, keyPattern: { testConstraint: 1 },
    });
    expect(await records.find().toArray()).toEqual([{ _id: saved.material, ...input }]);
  });

  test("older materials stay readable and cannot be claimed by matching their content", async () => {
    const { library, records } = setup();
    const { importKey: _, ...data } = request();
    const old = [{ _id: randomUUID() as Material, ...data }, { _id: randomUUID() as Material, ...data }];
    await records.insertMany(old);
    const input = request();
    const saved = await library.add(input);
    expect(old.some(({ _id }) => _id === saved.material)).toBe(false);
    for (const { _id } of old) expect(await library._material({ material: _id })).toEqual([data]);
    expect(await library.add(input)).toEqual(saved);
    expect(await records.countDocuments()).toBe(3);
    expect(await records.find({ importKey: { $exists: false } }).toArray()).toEqual(old);
  });
});
