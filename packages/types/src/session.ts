/**
 * Session-Related Type Definitions
 *
 * @packageDocumentation
 * @module @nexus-cortex/types/session
 *
 * This module contains session, timeline, and conversation-related types
 * for the Nexus Cortex system.
 */

/**
 * Session Metadata
 *
 * Core metadata for a session including cache performance metrics.
 */
export interface SessionMetadata {
  sessionId: string;
  projectPath: string;
  startTime: string;
  lastModified: string;
  messageCount: number;
  compactionCount: number;
  currentModel?: string;

  /** Auto-generated session title (5-10 words, produced by helper model on first turn) */
  title?: string;

  /** Phase 2.7: Cache performance metrics (optional for backward compatibility) */
  cacheMetrics?: {
    requestCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
    totalUncachedInputTokens: number;
    overallCacheHitRate: number;
    overallCostSavingsRatio: number;
    requestsWithCacheHits: number;
    byProvider: Record<string, {
      provider: string;
      requestCount: number;
      cacheReadTokens: number;
      cacheCreationTokens: number;
      totalInputTokens: number;
      cacheHitRate: number;
    }>;
  };

  /**
   * XAI Responses API chain state (persisted so session resume can continue the chain
   * without re-uploading history). Only populated when the session uses Responses API
   * and has had at least one response. Null/absent for other provider paths.
   */
  responsesApiChain?: {
    /** Last response ID from XAI Responses API — used as previous_response_id on continuation */
    lastResponseId: string;
    /** Index in messageHistory (at the moment of last response) — used for input slicing */
    messageCountAtLastResponse: number;
    /** Model id the chain was established with — chain is invalid if model switches */
    modelId: string;
    /** Timestamp when the last response was produced (30-day TTL on XAI side) */
    timestamp: string;
  };
}

/**
 * Cache Metrics API Response
 *
 * Response format for GET /sessions/:id/cache/metrics endpoint
 */
export interface CacheMetricsResponse {
  sessionId: string;
  metrics: SessionMetadata['cacheMetrics'];
  report: string;
  timestamp: string;
}

/**
 * Timeline Event Types
 */
export type TimelineEventType =
  | 'message'
  | 'checkpoint'
  | 'compaction'
  | 'model_switch'
  | 'resume'
  | 'branch_create'
  | 'conversation_start';

/**
 * Base Timeline Event
 */
export interface TimelineEvent {
  id: string;
  type: TimelineEventType;
  timestamp: string;
  conversationId: string;
  turnNumber: number;
  metadata: Record<string, any>;
}

/**
 * Message Timeline Event
 */
export interface MessageEvent extends TimelineEvent {
  type: 'message';
  messageId: string;
  metadata: {
    role: string;
    hasToolCalls?: boolean;
    modelId?: string;
  };
}

/**
 * Checkpoint Timeline Event
 */
export interface CheckpointEvent extends TimelineEvent {
  type: 'checkpoint';
  metadata: {
    checkpointId: string;
    description?: string;
    messageCount: number;
    tokenCount: number;
    modelId: string;
  };
}

/**
 * Compaction Timeline Event
 */
export interface CompactionEvent extends TimelineEvent {
  type: 'compaction';
  metadata: {
    compactionId: string;
    trigger: 'auto' | 'manual' | 'helper-fallback';
    originalTokens: number;
    compressedTokens: number;
    tokensSaved: number;
    mainModel?: string;
    helperModel?: string;
  };
}

/**
 * Model Switch Timeline Event
 */
export interface ModelSwitchEvent extends TimelineEvent {
  type: 'model_switch';
  metadata: {
    fromModel: string;
    toModel: string;
    reason?: string;
  };
}

/**
 * Resume Timeline Event
 */
export interface ResumeEvent extends TimelineEvent {
  type: 'resume';
  metadata: {
    checkpointId: string;
    resumedModel: string;
    originalModel?: string;
  };
}

/**
 * Branch Create Timeline Event
 */
export interface BranchEvent extends TimelineEvent {
  type: 'branch_create';
  metadata: {
    branchId: string;
    parentConversationId: string;
    branchPoint: number;
    description?: string;
  };
}

/**
 * Conversation Start Timeline Event
 */
export interface ConversationStartEvent extends TimelineEvent {
  type: 'conversation_start';
  metadata: {
    modelId: string;
    isResume?: boolean;
    resumedFromCheckpoint?: string;
  };
}

/**
 * Union type for all timeline events
 */
export type AnyTimelineEvent =
  | MessageEvent
  | CheckpointEvent
  | CompactionEvent
  | ModelSwitchEvent
  | ResumeEvent
  | BranchEvent
  | ConversationStartEvent;

/**
 * Conversation represents a linear sequence of messages
 */
export interface Conversation {
  id: string;
  startTime: string;
  lastActiveTime: string;
  turnCount: number;
  messageIds: string[];

  // Branching info
  parentConversationId?: string;
  branchPoint?: number;

  // State
  modelId: string;
  tokenCount: number;
  isActive: boolean;
}

/**
 * Checkpoint represents a saved state in the timeline
 */
export interface Checkpoint {
  id: string;
  conversationId: string;
  turnNumber: number;
  timestamp: string;
  description?: string;

  // Snapshot data
  snapshot: {
    messageIds: string[];
    tokenCount: number;
    modelId: string;

    // Context window metadata
    contextMetadata: {
      totalTokens: number;
      criticalTokens: number;
      compactableTokens: number;

      // Pre-computed selections for common target models
      precomputedSelections?: Record<string, {
        selectedMessages: string[];
        estimatedTokens: number;
        strategy: 'sliding-window' | 'preserve-critical' | 'compact-and-fit';
      }>;
    };
  };

  resumable: boolean;
  resumeCount: number;
}

/**
 * Checkpoint Options for creating checkpoints
 */
export interface CheckpointOptions {
  description?: string;
  metadata?: Record<string, any>;
  includeTools?: boolean;
  includeSystemPrompt?: boolean;
}

/**
 * Checkpoint with associated files
 */
export interface CheckpointWithFiles extends Checkpoint {
  files: {
    messages: string;
    metadata: string;
  };
}

/**
 * Compaction Point represents a conversation compaction in the timeline
 */
export interface CompactionPoint {
  id: string;
  conversationId: string;
  timestamp: string;

  range: {
    startTurn: number;
    endTurn: number;
    messageCount: number;
  };

  tokens: {
    original: number;
    compressed: number;
    savings: number;
  };

  trigger: 'auto' | 'manual' | 'helper-fallback';
}

/**
 * Model Switch represents a model change in the timeline
 */
export interface ModelSwitch {
  id: string;
  conversationId: string;
  timestamp: string;
  turnNumber: number;

  from: {
    modelId: string;
    provider: string;
  };

  to: {
    modelId: string;
    provider: string;
  };

  reason?: string;
}

/**
 * Compaction Metadata for compact boundaries
 */
export interface CompactionMetadata {
  compactionId: string;
  originalMessages: number;
  originalTokens: number;
  compressedTokens: number;
  tokensSaved: number;
  startTurn: number;
  endTurn: number;
  trigger: 'auto' | 'manual' | 'helper-fallback';
  modelUsed?: string;
}