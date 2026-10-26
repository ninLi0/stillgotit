import { describe, expect, test } from "bun:test";
import { choiceOffered, configuredModelName, defaultChoice, levelSupported, modelOffered, offeredChoice, requestChoice, TUTOR_MODELS, tutorCatalog,
  tutorStatus, withChoice } from "../src/computations/tutor.ts";
import type { TutorRequest } from "../src/learning-data.ts";
import type { TutorModelOffer } from "../src/tutor-types.ts";

// The catalog table from design/compositions/Settings.md, "The model catalog".
const table: Omit<TutorModelOffer, "appDefault">[] = [
  { model: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", description: "The fastest and lowest-cost model offered.",
    levels: ["MINIMAL", "LOW", "MEDIUM", "HIGH"], defaultLevel: "MINIMAL", slowLevels: [],
    tradeoff: "It answers quickly but can miss detail in long or difficult material." },
  { model: "gemini-3.8-flash", name: "Gemini 3.8 Flash", description: "A fast general model for lessons, practice, and feedback.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "MEDIUM", slowLevels: [],
    tradeoff: "It balances speed, cost, and care; raise the level for harder problems." },
  { model: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro (preview)", description: "A careful model for difficult material and grading.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "HIGH", slowLevels: ["HIGH"],
    tradeoff: "It is slower and costs more, and as a preview Google may change or withdraw it." },
  { model: "gemini-4-argon", name: "Gemini 4 Argon", description: "Google's flagship reasoning model, for the hardest material and grading.",
    levels: ["LOW", "MEDIUM", "HIGH"], defaultLevel: "MEDIUM", slowLevels: ["HIGH"],
    tradeoff: "It is the most capable model offered and the most expensive, and at High a long request may not finish in time." },
];
const configured = configuredModelName(process.env.GEMINI_MODEL);

describe("tutor catalog", () => {
  test("lists the four offered models in table order, with each entry's fields and a mark on the default", () => {
    expect(tutorCatalog({})).toEqual(table.map((entry) => ({ ...entry, appDefault: entry.model === configured })));
    expect(tutorCatalog({}).filter((entry) => entry.appDefault)).toHaveLength(1);
    // Every entry lists its levels in the order Minimal, Low, Medium, High.
    const order = ["MINIMAL", "LOW", "MEDIUM", "HIGH"];
    for (const entry of tutorCatalog({})) expect([...entry.levels].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(entry.levels);
    // A caller cannot change the fixed table through a returned record.
    const copy = tutorCatalog({});
    copy[0]!.levels.pop(); copy.pop();
    expect(tutorCatalog({})).toHaveLength(4);
    expect(TUTOR_MODELS[0]!.levels).toHaveLength(4);
  });

  test("GEMINI_MODEL names the default after trimming and removing models/, and gemini-3.8-flash is the default when it is unset", () => {
    expect(configuredModelName(undefined)).toBe("gemini-3.8-flash");
    expect(configuredModelName("")).toBe("gemini-3.8-flash");
    expect(configuredModelName("  models/gemini-3.1-pro-preview ")).toBe("gemini-3.1-pro-preview");
    // The default choice is the default model at that model's own default level.
    const entry = table.find((row) => row.model === configured)!;
    expect(defaultChoice({})).toEqual({ model: configured, level: entry.defaultLevel });
    if (process.env.GEMINI_MODEL === undefined) expect(defaultChoice({})).toEqual({ model: "gemini-3.8-flash", level: "MEDIUM" });
  });

  test("validation matches model names and levels exactly, including case", () => {
    expect(modelOffered({ model: "gemini-3.8-flash" })).toBe(true);
    for (const model of ["GEMINI-3.8-FLASH", "gemini-3.8-flash ", "models/gemini-3.8-flash", "gemini-3.8", "gemini-9.9-nonexistent", ""]) {
      expect(modelOffered({ model }), model).toBe(false);
    }
    expect(levelSupported({ model: "gemini-3.5-flash-lite", level: "MINIMAL" })).toBe(true);
    expect(levelSupported({ model: "gemini-3.8-flash", level: "MINIMAL" })).toBe(false);
    expect(levelSupported({ model: "gemini-3.1-pro-preview", level: "MINIMAL" })).toBe(false);
    expect(levelSupported({ model: "gemini-3.8-flash", level: "low" })).toBe(false);
    expect(levelSupported({ model: "gemini-9.9-nonexistent", level: "LOW" })).toBe(false);
    for (const entry of table) for (const level of entry.levels) expect(levelSupported({ model: entry.model, level }), `${entry.model} ${level}`).toBe(true);
    expect(offeredChoice({ model: "gemini-3.1-pro-preview", level: "LOW" })).toEqual({ model: "gemini-3.1-pro-preview", level: "LOW" });
    expect(() => offeredChoice({ model: "gemini-3.8-flash", level: "MINIMAL" })).toThrow();
  });

  test("a saved choice is offered only while its model is offered and still lists its level", () => {
    expect(choiceOffered({ choice: { model: "gemini-3.8-flash", level: "HIGH" } })).toBe(true);
    expect(choiceOffered({ choice: { model: "gemini-3.0-flash-retired", level: "LOW" } })).toBe(false);
    expect(choiceOffered({ choice: { model: "gemini-3.8-flash", level: "MINIMAL" } })).toBe(false);
    // Preferring returns options unchanged, so a malformed saved value is also not offered.
    for (const choice of [null, "gemini-3.8-flash", { model: "gemini-3.8-flash" }, {}]) expect(choiceOffered({ choice: choice as never })).toBe(false);
    expect(tutorStatus({ saved: true, offered: true })).toBe("SAVED");
    expect(tutorStatus({ saved: true, offered: false })).toBe("RETIRED");
    expect(tutorStatus({ saved: false, offered: true })).toBe("DEFAULT");
  });

  test("withChoice adds exactly the validated pair and changes nothing else; requestChoice reads it back", () => {
    const request: TutorRequest = { kind: "LESSON", definition: "v1", sources: [], context: { title: "Matrices", request: "Teach me" }, work: [] };
    const sent = withChoice({ request, choice: { model: "gemini-3.5-flash-lite", level: "HIGH" } });
    expect(sent).toEqual({ ...request, tutor: { model: "gemini-3.5-flash-lite", level: "HIGH" } });
    expect(request).not.toHaveProperty("tutor");
    expect(requestChoice({ request: sent })).toEqual({ model: "gemini-3.5-flash-lite", level: "HIGH" });
    // A pair that is not offered never reaches a request, and a request without a pair has nothing to report.
    expect(() => withChoice({ request, choice: { model: "gemini-3.8-flash", level: "MINIMAL" } })).toThrow();
    expect(() => requestChoice({ request })).toThrow();
  });
});
