/**
 * Message-Related Type Definitions
 *
 * @packageDocumentation
 * @module @nexus-cortex/types/messages
 *
 * This module contains message-related types for the Nexus Cortex system.
 * These types provide a canonical, provider-agnostic representation of messages
 * with timeline tracking and model context.
 *
 * Phase 1.5: Multi-Provider Architecture
 */

import type { CanonicalContentBlock, TokenUsage } from './tools';

/**
 * Canonical Message Format
 *
 * Provider-agnostic internal storage format for messages.
 * Extends the existing JSONL session format with timeline tracking.
 *
 * Phase 1.5: Multi-Provider Architecture
 */
export interface CanonicalMessage {
  // Identity (existing identity fields)
  /** Unique message identifier */
  uuid: string;

  /** Parent message UUID (for message graphs) */
  parentUuid?: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  // Timeline position (Phase 1.5 addition)
  timeline: {
    /** Session ID */
    sessionId: string;

    /** Conversation ID (for branching) */
    conversationId: string;

    /** Turn number in conversation */
    turnNumber: number;

    /** Checkpoint ID if this is a checkpoint */
    checkpointId?: string;

    /** Whether this is a branch point */
    branchPoint?: boolean;

    /** Whether this is a resume point */
    resumePoint?: boolean;
  };

  // Content
  /** Message role */
  role: 'user' | 'assistant' | 'system';

  /** Message type */
  type: 'text' | 'tool_request' | 'tool_response' | 'thinking' |
        'compact_boundary' | 'model_switch' | 'checkpoint' | 'resume';

  /** Message content blocks */
  content: CanonicalContentBlock[];

  // Model context (Phase 1.5 addition)
  model: {
    /** Model ID */
    id: string;

    /** Provider name */
    provider: string;

    /** API pattern used */
    apiPattern: string;
  };

  // Metadata
  metadata?: {
    /** Original provider (if converted) */
    originalProvider?: string;

    /** Original format (if converted) */
    originalFormat?: string;

    /** Token usage */
    usage?: TokenUsage;

    /** Stop reason */
    stopReason?: string;

    /** File snapshots associated with this message */
    fileSnapshots?: string[];

    /** Compaction ID (if this message was compacted) */
    compactionId?: string;

    /** Whether tool result was summarized */
    toolResultSummarized?: boolean;

    /** Additional metadata */
    [key: string]: unknown;
  };

  /**
   * J-space state channel (JSPACE_STATE_CHANNEL_PLAN.md S1) — the agent's
   * per-turn "state of mind" in canonical cluster space, tied to the
   * canonical history. Optional and non-breaking by construction. Assistant
   * turns only. Inline `summary` keeps the store light; full per-token
   * trajectories ride the blob tier via `trajectoryRef` (R2 / git-LFS,
   * encrypted-at-rest for repo-backed canon). State trails are partial model
   * internals — P5-style gate before ANY public exposure.
   */
  jspaceState?: JSpaceState;
}

/** Per-turn j-space state annotation (see CanonicalMessage.jspaceState). */
export interface JSpaceState {
  /** Model + lens-fit version (fit-once-cache identity). */
  lensId: string;
  /** Cluster-taxonomy version — a new basis is a new league table (D20). */
  basisVersion: string;
  /** Per-turn cluster activation vector — small, inline. */
  summary: number[];
  /** Blob ref (R2 / git-LFS) for the full per-token trajectory. */
  trajectoryRef?: string;
  /** Chaperone cross-checks, when present. */
  agreement?: Record<string, unknown>;
}