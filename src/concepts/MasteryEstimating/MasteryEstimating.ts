import { type Collection, type Db, MongoServerError } from "mongodb";
import * as refusal from "./refusals.ts";

export type Learner = string;
export type Subject = string;
export type Definition = string;
export type Evidence = string;
export type Track = string;
export type Input = string;
export type Adjustment = string;
export type Signal = "INDEPENDENT" | "SUPPORTED" | "SLIP" | "GAP" | "UNCERTAIN";
export type StartingBasis = "SELF_REPORTED" | "PREVIOUS_DEFINITION";
interface Identity { learner: Learner; subject: Subject; definition: Definition }
/** One manual adjustment as the queries report it. No query reports the adjustment key. */
export interface AdjustmentRow { adjustment: Adjustment; value: number; reason: string; at: Date }
interface AdjustmentDocument extends AdjustmentRow { adjustmentKey: string }
interface TrackDocument extends Identity {
  // The array keeps the adjustments' append order.
  _id: Track; initialConfidence: number; startingBasis: StartingBasis; initializedAt: Date; adjustments: AdjustmentDocument[];
}
interface InputDocument {
  _id: Input; track: Track; evidence: Evidence; revision: number; performedAt: Date;
  signal: Signal; fresh: boolean; gateMet: boolean; attribution: string;
}
export type InputRow = { input: Input } & Omit<InputDocument, "_id" | "track">;
export interface EstimateRow { value: number; basis: string; ready: boolean }
/** One of the learner's tracks in _progress. Inputs follow _inputs order and adjustments follow append order. */
export interface ProgressRow {
  track: Track; subject: Subject; definition: Definition; initialConfidence: number; startingBasis: StartingBasis; initializedAt: Date;
  inputs: InputRow[]; adjustments: AdjustmentRow[]; estimate: EstimateRow | null;
}
export type ProgressRows = ProgressRow[];
export interface EstimateExplanation {
  policy: string; initialConfidence: number; startingBasis: StartingBasis; replayStart: Date;
  evidence: { evidence: Evidence; revision: number }[];
  ignored: { evidence: Evidence; reason: string }[];
  changes: { at: Date; source: string; before: number; decayed: number; after: number }[];
  value: number; ready: boolean; basis: string;
}
const score = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
const informative = (input: InputDocument) => input.signal === "SLIP" || input.signal === "GAP" ||
  (input.fresh && (input.signal === "INDEPENDENT" || input.signal === "SUPPORTED"));
const duplicate = (error: unknown) => error instanceof MongoServerError && error.code === 11000;
const days = (later: Date, earlier: Date) => (later.getTime() - earlier.getTime()) / 86_400_000;
const adjustmentRow = ({ adjustment, value, reason, at }: AdjustmentDocument): AdjustmentRow => ({ adjustment, value, reason, at });
/** A saved key answers a retry only for the same track, value, and exact reason. */
function retried(saved: AdjustmentDocument & { track: Track }, record: TrackDocument | null, value: unknown, reason: unknown) {
  if (saved.track !== record?._id || saved.value !== value || saved.reason !== reason) throw new refusal.AdjustmentKeyConflict();
  return { adjustment: saved.adjustment };
}

export class MasteryEstimating {
  private readonly tracks: Collection<TrackDocument>;
  private readonly inputs: Collection<InputDocument>;
  private indexes: Promise<unknown> | undefined;
  constructor(database: Db, name = "MasteryEstimating", private readonly clock = () => new Date()) {
    this.tracks = database.collection(`${name.toLowerCase()}.tracks`);
    this.inputs = database.collection(`${name.toLowerCase()}.inputs`);
  }
  #ready() {
    return this.indexes ??= Promise.all([
      this.tracks.createIndex({ learner: 1, subject: 1, definition: 1 }, { unique: true }),
      // One learner's key names at most one adjustment across all of that learner's tracks.
      // Tracks without a keyed adjustment stay out of the index.
      this.tracks.createIndex({ learner: 1, "adjustments.adjustmentKey": 1 },
        { unique: true, partialFilterExpression: { "adjustments.adjustmentKey": { $type: "string" } } }),
      this.inputs.createIndex({ evidence: 1 }, { unique: true }),
    ]).catch((error: unknown) => { this.indexes = undefined; throw error; });
  }
  async initialize({ learner, subject, definition, confidence, basis }: Identity & { confidence: number; basis: StartingBasis }): Promise<{ track: Track }> {
    if (!score(confidence) || !["SELF_REPORTED", "PREVIOUS_DEFINITION"].includes(basis)) throw new refusal.InvalidInitialConfidence();
    await this.#ready();
    const track = crypto.randomUUID();
    try { await this.tracks.insertOne({ _id: track, learner, subject, definition, initialConfidence: confidence,
      startingBasis: basis, initializedAt: this.clock(), adjustments: [] }); }
    catch (error) { if (duplicate(error)) throw new refusal.MasteryTrackExists(); throw error; }
    return { track };
  }
  async acceptEvidence(input: Identity & Omit<InputDocument, "_id" | "track">): Promise<{ input: Input }> {
    const { learner, subject, definition, ...value } = structuredClone(input);
    const record = await this.tracks.findOne({ learner, subject, definition });
    if (!record) throw new refusal.EvidenceTrackUnavailable();
    if (!Number.isInteger(value.revision) || value.revision <= 0 || !(value.performedAt instanceof Date) ||
      !Number.isFinite(value.performedAt.getTime()) || value.performedAt > this.clock() || typeof value.attribution !== "string" || !value.attribution.trim() ||
      !["INDEPENDENT", "SUPPORTED", "SLIP", "GAP", "UNCERTAIN"].includes(value.signal) ||
      typeof value.fresh !== "boolean" || typeof value.gateMet !== "boolean" ||
      (value.gateMet && (value.signal !== "INDEPENDENT" || !value.fresh))) throw new refusal.InvalidMasteryEvidence();
    await this.#ready();
    for (let retry = 0; retry < 8; retry++) {
      const previous = await this.inputs.findOne({ evidence: value.evidence });
      if (previous) {
        if (previous.track !== record._id) throw new refusal.EvidenceTrackMismatch();
        if (previous.performedAt.getTime() !== value.performedAt.getTime()) throw new refusal.EvidenceDateMismatch();
        if (previous.revision >= value.revision) throw new refusal.EvidenceRevisionNotNew();
        const update = await this.inputs.updateOne({ _id: previous._id, revision: previous.revision },
          { $set: { revision: value.revision, signal: value.signal, fresh: value.fresh, gateMet: value.gateMet, attribution: value.attribution } });
        if (update.matchedCount) return { input: previous._id };
      } else {
        const id = crypto.randomUUID();
        try { await this.inputs.insertOne({ _id: id, track: record._id, ...value }); return { input: id }; }
        catch (error) { if (!duplicate(error)) throw error; }
      }
    }
    throw new Error("The evidence changed during this update. Try again.");
  }
  async adjust({ learner, subject, definition, adjustmentKey, value, reason }: Identity & { adjustmentKey: string; value: number; reason: string }): Promise<{ adjustment: Adjustment }> {
    if (typeof adjustmentKey !== "string" || !adjustmentKey.trim()) throw new refusal.InvalidAdjustmentKey();
    const record = await this.tracks.findOne({ learner, subject, definition });
    const saved = await this.#keyed(learner, adjustmentKey);
    if (saved) return retried(saved, record, value, reason);
    if (!record) throw new refusal.AdjustmentTrackUnavailable();
    if (!score(value) || typeof reason !== "string" || !reason.trim()) throw new refusal.InvalidMasteryAdjustment();
    await this.#ready();
    const adjustment = crypto.randomUUID();
    let failure: unknown;
    try {
      // One write checks the key and appends the adjustment. The filter settles a competing request on this track,
      // and the unique index settles one on another of the learner's tracks.
      const { matchedCount } = await this.tracks.updateOne({ _id: record._id, "adjustments.adjustmentKey": { $ne: adjustmentKey } },
        { $push: { adjustments: { adjustment, adjustmentKey, value, reason, at: this.clock() } } });
      if (matchedCount) return { adjustment };
    } catch (error) { if (!duplicate(error)) throw error; failure = error; }
    // A competing request saved this key first. Its adjustment decides the answer.
    const winner = await this.#keyed(learner, adjustmentKey);
    if (winner) return retried(winner, record, value, reason);
    // An unrelated constraint failed. Do not report a database fault as a key conflict.
    throw failure ?? new Error("The estimate changed during this adjustment. Try again.");
  }
  async #keyed(learner: Learner, adjustmentKey: string) {
    const record = await this.tracks.findOne({ learner, "adjustments.adjustmentKey": adjustmentKey });
    const saved = record?.adjustments.find((adjustment) => adjustment.adjustmentKey === adjustmentKey);
    return record && saved ? { ...saved, track: record._id } : undefined;
  }
  async _tracks({ learner, subject }: { learner: Learner; subject: Subject }) {
    return (await this.tracks.find({ learner, subject }).sort({ initializedAt: 1, _id: 1 }).toArray())
      .map(({ _id, definition, initialConfidence, startingBasis, initializedAt }) => ({ track: _id, definition, initialConfidence, startingBasis, initializedAt }));
  }
  async _progress({ learner }: { learner: Learner }): Promise<{ tracks: ProgressRows }> {
    const at = this.clock();
    // Each row's adjustments and estimate come from the same read of its track.
    return { tracks: await Promise.all((await this.tracks.find({ learner }).sort({ initializedAt: 1, _id: 1 }).toArray()).map(async (record) => {
      const explanation = await this.#explainTrack(record, at);
      return {
        track: record._id, subject: record.subject, definition: record.definition, initialConfidence: record.initialConfidence,
        startingBasis: record.startingBasis, initializedAt: record.initializedAt,
        inputs: await this._inputs({ track: record._id }), adjustments: record.adjustments.map(adjustmentRow),
        estimate: explanation ? { value: explanation.value, basis: explanation.basis, ready: explanation.ready } : null,
      };
    })) };
  }
  async _track({ learner, subject, definition }: Identity) {
    const record = await this.tracks.findOne({ learner, subject, definition });
    return record ? [{ track: record._id, initialConfidence: record.initialConfidence, startingBasis: record.startingBasis, initializedAt: record.initializedAt }] : [];
  }
  async _inputs({ track }: { track: Track }): Promise<InputRow[]> {
    return (await this.inputs.find({ track }).sort({ performedAt: 1, evidence: 1 }).toArray())
      .map(({ _id, track: _, ...rest }) => ({ input: _id, ...rest }));
  }
  async _adjustments({ track }: { track: Track }): Promise<AdjustmentRow[]> {
    return ((await this.tracks.findOne({ _id: track }))?.adjustments ?? []).map(adjustmentRow);
  }
  async _estimate(input: Identity & { at: Date }) {
    const explanation = await this.#explain(input);
    return explanation ? [{ value: explanation.value, basis: explanation.basis, ready: explanation.ready }] : [];
  }
  async _explanation(input: Identity & { at: Date }): Promise<{ explanation: EstimateExplanation }[]> {
    const explanation = await this.#explain(input);
    return explanation ? [{ explanation }] : [];
  }
  async #explain({ learner, subject, definition, at }: Identity & { at: Date }): Promise<EstimateExplanation | undefined> {
    const track = await this.tracks.findOne({ learner, subject, definition });
    return track ? this.#explainTrack(track, at) : undefined;
  }
  async #explainTrack(track: TrackDocument, at: Date): Promise<EstimateExplanation | undefined> {
    if (!(at instanceof Date) || !Number.isFinite(at.getTime()) || at < track.initializedAt) return;
    const inputs = await this.inputs.find({ track: track._id, performedAt: { $lte: at } }).sort({ performedAt: 1, evidence: 1 }).toArray();
    return replay(track, inputs, at);
  }
}

function replay(track: TrackDocument, inputs: InputDocument[], at: Date): EstimateExplanation {
  const included = inputs.filter(informative), first = included[0]?.performedAt;
  const adjustments = track.adjustments.filter((adjustment) => adjustment.at <= at);
  const replayStart = first && first < track.initializedAt ? first : track.initializedAt;
  let m = track.initialConfidence, r = m, cap: number | undefined, previous = replayStart;
  const events = [
    ...included.map((input) => ({ at: input.performedAt, kind: 0, tie: input.evidence, input, adjustment: undefined as AdjustmentDocument | undefined })),
    ...adjustments.map((adjustment, index) =>
      ({ at: adjustment.at, kind: 1, tie: index.toString().padStart(12, "0"), adjustment, input: undefined as InputDocument | undefined })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime() || a.kind - b.kind || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0));
  const changes: EstimateExplanation["changes"] = [];
  for (const event of events) {
    const before = m;
    m *= 2 ** (-days(event.at, previous) / 60);
    const decayed = m;
    if (event.adjustment) { m = r = event.adjustment.value; cap = undefined; }
    else if (event.input) {
      switch (event.input.signal) {
        case "INDEPENDENT": m = event.input.gateMet ? Math.max(m, 95) : Math.max(m, Math.min(Math.max(79, r), m + 10)); r = Math.max(r, m); cap = undefined; break;
        case "SUPPORTED": cap ??= m < r ? (m + r) / 2 : Math.max(m, Math.min(79, m + 5)); m = Math.max(m, cap); break;
        case "SLIP": m -= 5; break;
        case "GAP": m -= 20; break;
      }
    }
    m = Math.max(0, Math.min(100, m));
    changes.push({ at: event.at, source: event.input?.evidence ?? event.adjustment!.adjustment, before, decayed, after: m });
    previous = event.at;
  }
  const before = m;
  m *= 2 ** (-days(at, previous) / 60);
  if (at > previous) changes.push({ at, source: "time", before, decayed: m, after: m });
  const latest = included.at(-1), ready = m >= 70 && latest?.signal === "INDEPENDENT" && latest.fresh && days(at, latest.performedAt) <= 14;
  const start = track.startingBasis === "SELF_REPORTED" ? "Started from your reported confidence." : "Started from an earlier definition; these requirements need a new check.";
  const basis = `${start} ${included.length ? `${included.length} assessed attempt(s) affect this estimate.` : "No scored evidence yet; this estimate is provisional."} ` +
    `${adjustments.length ? "Your manual adjustments are included. " : ""}Time without practice lowers the estimate. ` +
    (ready ? "Recent independent work supports readiness." : "Fresh independent work is needed to establish readiness.");
  return { policy: "prototype-1", initialConfidence: track.initialConfidence, startingBasis: track.startingBasis, replayStart,
    evidence: inputs.map(({ evidence, revision }) => ({ evidence, revision })),
    ignored: inputs.filter((input) => !informative(input)).map((input) => ({ evidence: input.evidence,
      reason: input.signal === "UNCERTAIN" ? "Too little evidence to change the score." : "Reused successful work gives no new gain." })),
    changes, value: m, ready: Boolean(ready), basis };
}
