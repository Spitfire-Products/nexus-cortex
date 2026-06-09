/**
 * Cortex-channel training/review records.
 *
 * Schema-mirrors the nexus DBAI corpus tables (leaf-verified:
 * tables/training_streams.rs `RouterTrainingSample` / `ReasonerTrainingSample`,
 * training_fanout.rs `sample_id_for_decision` / `derive_channel_source`).
 * nexus-cortex has no SpacetimeDB, so these are emitted as local JSONL
 * rows for later ingestion by the nexus pipeline. They populate the slot
 * the schema explicitly reserves but nexus leaves unimplemented:
 * outcome_score "from the alignment scorer or CHALLENGE-graded review"
 * (training_streams.rs:71-72).
 *
 * Gotchas honored: channel_source is exactly "cortex" (lowercase — the
 * 30% per-channel cap clamps anything else to "external"); outcome_score
 * clamped to [0,1]; sample_id deterministic over (kind, decision_id,
 * agent_id) for idempotent re-scoring. The 16-hex agent hash is a JS
 * FNV-1a, NOT byte-identical to nexus's Rust DefaultHasher — the nexus
 * ingest reducer recomputes sample_id from (kind, decision_id, agent_id)
 * anyway; ours is for local dedup only. agent_kind left null: nexus
 * downstream packers clamp unknown agent_kind values, so we do not invent
 * one (it defaults at ingest).
 */

export interface RouterSampleRecord {
  sample_id: string;
  decision_id: string | null;
  agent_id: string;
  agent_kind: string | null;
  archetype_id: string | null;
  channel_source: string;
  input_context: string;
  selected_tool: string | null;
  selected_args_json: string | null;
  outcome_score: number | null;
  training_weight: number | null;
  timestamp_ms: number;
  exported: boolean;
}

export interface ReasonerTurn {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  thinking?: string;
  tool_calls?: unknown[];
  tool_results?: unknown[];
}

export interface ReasonerSampleRecord {
  sample_id: string;
  conversation_id: string | null;
  agent_id: string;
  agent_kind: string | null;
  archetype_id: string | null;
  channel_source: string;
  turn_sequence_json: string;
  final_outcome_score: number | null;
  training_weight: number | null;
  timestamp_ms: number;
  exported: boolean;
}

import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs';
import { dirname } from 'path';

const CHANNEL_CORTEX = 'cortex';

/** Default cap before cortex-samples.jsonl rotates (5 MB). Write-only,
 *  low-volume (≈1/finalized-turn), no read-back hot path — so a larger
 *  cap than DecisionStore is fine. */
export const DEFAULT_SAMPLES_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Append one JSONL line, bounding the file with single-generation rotation
 * (main → `.1`, replacing any prior `.1`). Rotate-before-append so the
 * newest record is never dropped and main always exists afterward. Sync
 * (called from the orchestrator's fail-safe emit block). The `.1` plus the
 * record schema's `exported` flag make ingested rows prune-safe.
 */
export function appendJsonlRotating(
  filePath: string,
  line: string,
  maxBytes: number = DEFAULT_SAMPLES_MAX_BYTES,
): void {
  mkdirSync(dirname(filePath), { recursive: true });
  try {
    if (statSync(filePath).size > maxBytes) {
      renameSync(filePath, filePath + '.1'); // replaces any prior .1
    }
  } catch {
    /* ENOENT (no file yet) or rename race — non-fatal */
  }
  appendFileSync(filePath, line + '\n');
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/** FNV-1a 64-bit → 16 lowercase hex. Deterministic; local-dedup only. */
function hash16(s: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < s.length; i++) {
    h = (h ^ BigInt(s.charCodeAt(i) & 0xff)) & mask;
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

function sampleId(kind: 'router' | 'reasoner', decisionId: string, agentId: string): string {
  return `${kind}-${decisionId}-${hash16(agentId)}`;
}

export function buildRouterSample(params: {
  decisionId: string;
  sessionId: string;
  inputContext: string;
  selectedTool?: string | null;
  selectedArgsJson?: string | null;
  outcomeScore: number;
  trainingWeight?: number | null;
  timestampMs: number;
}): RouterSampleRecord {
  const agentId = `cortex-${params.sessionId}`;
  return {
    sample_id: sampleId('router', params.decisionId, agentId),
    decision_id: params.decisionId,
    agent_id: agentId,
    agent_kind: null,
    archetype_id: null,
    channel_source: CHANNEL_CORTEX,
    input_context: params.inputContext,
    selected_tool: params.selectedTool ?? null,
    selected_args_json: params.selectedArgsJson ?? null,
    outcome_score: clamp01(params.outcomeScore),
    training_weight: params.trainingWeight ?? null,
    timestamp_ms: params.timestampMs,
    exported: false,
  };
}

export function buildReasonerSample(params: {
  decisionId: string;
  sessionId: string;
  turns: ReasonerTurn[];
  finalOutcomeScore: number;
  trainingWeight?: number | null;
  timestampMs: number;
}): ReasonerSampleRecord {
  const agentId = `cortex-${params.sessionId}`;
  return {
    sample_id: sampleId('reasoner', params.decisionId, agentId),
    conversation_id: params.sessionId,
    agent_id: agentId,
    agent_kind: null,
    archetype_id: null,
    channel_source: CHANNEL_CORTEX,
    turn_sequence_json: JSON.stringify(params.turns),
    final_outcome_score: clamp01(params.finalOutcomeScore),
    training_weight: params.trainingWeight ?? null,
    timestamp_ms: params.timestampMs,
    exported: false,
  };
}
