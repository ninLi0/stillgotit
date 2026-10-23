import { registerConcept } from "@mit-sdg/sync-engine/assembly";
import spec from "@design/concepts/MasteryEstimating.md" with { type: "text" };
import { MasteryEstimating } from "./MasteryEstimating.ts";
import * as refusal from "./refusals.ts";

export const masteryEstimating = registerConcept({
  class: MasteryEstimating, spec, refusals: {
    INVALID_INITIAL_CONFIDENCE: refusal.InvalidInitialConfidence,
    MASTERY_TRACK_EXISTS: refusal.MasteryTrackExists,
    EVIDENCE_TRACK_UNAVAILABLE: refusal.EvidenceTrackUnavailable,
    INVALID_MASTERY_EVIDENCE: refusal.InvalidMasteryEvidence,
    EVIDENCE_TRACK_MISMATCH: refusal.EvidenceTrackMismatch,
    EVIDENCE_DATE_MISMATCH: refusal.EvidenceDateMismatch,
    EVIDENCE_REVISION_NOT_NEW: refusal.EvidenceRevisionNotNew,
    INVALID_ADJUSTMENT_KEY: refusal.InvalidAdjustmentKey,
    ADJUSTMENT_KEY_CONFLICT: refusal.AdjustmentKeyConflict,
    ADJUSTMENT_TRACK_UNAVAILABLE: refusal.AdjustmentTrackUnavailable,
    INVALID_MASTERY_ADJUSTMENT: refusal.InvalidMasteryAdjustment,
  },
});
