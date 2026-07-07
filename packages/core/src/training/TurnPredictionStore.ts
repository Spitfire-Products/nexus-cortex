/**
 * Turn-prediction records — the graduation signal (Decision Capture Layer §5).
 *
 * TURN_SUMMARY_PREDICTION has the helper model predict the user's next message
 * post-turn; historically that prediction was attached to the response and then
 * THROWN AWAY. This store completes the loop: when the next user message arrives,
 * the pending prediction is scored against it (cheap deterministic token-F1) and
 * the `(predicted, actual, match_score)` pair is appended to
 * `.cortex/training/turn-predictions.jsonl`.
 *
 * Why it matters: the apprentice-model graduation gate is "predict the next
 * turn; graduate when accuracy clears the stage bar." These records are that
 * metric's raw material — today's predictor is the helper model (the baseline);
 * the apprentice fills the same slot later and is scored the same way.
 *
 * OSS boundary: local JSONL only (no STDB). The nexus-side capture layer mirrors
 * this stream up (`ingest_turn_prediction`), same as the other `.cortex` stores.
 */
import { join } from 'path';
import { appendJsonlRotating } from '../orchestrator/cortexTrainingRecord.js';

/**
 * How the ACTUAL next message relates to the displayed prediction (the TUI
 * ghost-text prefill). Spec §5.1 tri-state — splits the exam stream from
 * suggestion telemetry:
 * - 'none'     — the prediction was never rendered to the user (late helper,
 *                display-holdout, or a non-TUI surface). Cleanest exam grade.
 * - 'shown'    — the ghost was rendered but the user typed independently.
 *                Exam-eligible; the shown-vs-none score gap measures semantic
 *                anchoring at the population level.
 * - 'inserted' — the user Tab/→-accepted the ghost (edited or not). Excluded
 *                from the graduation exam; match_score re-reads as suggestion
 *                retention/usefulness (1.0 = accepted verbatim).
 */
export type PrefillProvenance = 'none' | 'shown' | 'inserted';

export interface TurnPredictionRecord {
  /** deterministic id: <sessionId>:<turnNumber> */
  record_id: string;
  session_id: string;
  turn_number: number;
  /** model that produced the prediction (helper today; the apprentice later). */
  predictor_model: string;
  /** the one-line turn summary generated alongside the prediction. */
  summary: string | null;
  predicted_next: string;
  /** the user's ACTUAL next message (flattened to text). */
  actual_next: string;
  /** deterministic token-F1 in [0,1] — see predictionMatchScore. */
  match_score: number;
  predicted_at_ms: number;
  scored_at_ms: number;
  /** §5.1 provenance of actual_next relative to the displayed prediction. */
  prefill_provenance: PrefillProvenance;
}

/** Pending prediction held between turns (in-memory on the orchestrator). */
export interface PendingTurnPrediction {
  sessionId: string;
  turnNumber: number;
  predictorModel: string;
  summary: string | null;
  prediction: string;
  predictedAtMs: number;
}

const STORE_RELATIVE_PATH = join('.cortex', 'training', 'turn-predictions.jsonl');

/** Lowercased alphanumeric tokens — the comparison alphabet for the match score. */
function tokens(s: string): string[] {
  return (s.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 0);
}

/**
 * Deterministic prediction↔actual similarity: token-level F1 (harmonic mean of
 * precision and recall over unique tokens). 0 = no overlap, 1 = identical token
 * sets. Chosen over embeddings/LLM-judge for reproducibility and zero cost — the
 * spec upgrades the metric only if this under-separates.
 */
export function predictionMatchScore(predicted: string, actual: string): number {
  const p = new Set(tokens(predicted));
  const a = new Set(tokens(actual));
  if (p.size === 0 || a.size === 0) return 0;
  let overlap = 0;
  for (const t of p) if (a.has(t)) overlap++;
  if (overlap === 0) return 0;
  const precision = overlap / p.size;
  const recall = overlap / a.size;
  return Math.round(((2 * precision * recall) / (precision + recall)) * 1000) / 1000;
}

/** Flatten a user message (string or content-block array) to comparable text. */
export function flattenUserContent(content: string | unknown[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content
    .map((b: any) => (typeof b === 'string' ? b : typeof b?.text === 'string' ? b.text : ''))
    .filter(Boolean)
    .join('\n');
}

/**
 * Score a pending prediction against the actual next user message and append
 * the completed record. Truncates stored texts (the raw payload belongs in R2,
 * not the hot store). Never throws — recording must not affect the turn.
 */
export function scoreAndRecordTurnPrediction(
  projectRoot: string,
  pending: PendingTurnPrediction,
  actualNext: string,
  nowMs: number,
  prefillProvenance: PrefillProvenance = 'none',
): TurnPredictionRecord | null {
  try {
    const record: TurnPredictionRecord = {
      record_id: `${pending.sessionId}:${pending.turnNumber}`,
      session_id: pending.sessionId,
      turn_number: pending.turnNumber,
      predictor_model: pending.predictorModel,
      summary: pending.summary ? pending.summary.slice(0, 300) : null,
      predicted_next: pending.prediction.slice(0, 500),
      actual_next: actualNext.slice(0, 500),
      match_score: predictionMatchScore(pending.prediction, actualNext),
      predicted_at_ms: pending.predictedAtMs,
      scored_at_ms: nowMs,
      prefill_provenance: prefillProvenance,
    };
    appendJsonlRotating(join(projectRoot, STORE_RELATIVE_PATH), JSON.stringify(record));
    return record;
  } catch {
    return null;
  }
}
