/**
 * Historical Tool Types
 *
 * Type definitions for historical context and conversation tools.
 * Extracted from @nexus-cortex/core to eliminate circular dependencies.
 *
 * These types are COPIED from the core implementations to maintain compatibility.
 */

/**
 * Input schema for GetConversationSegment tool
 */
export interface GetConversationSegmentInput {
  /** Turn range to retrieve */
  turnRange?: {
    start: number;
    end: number;
  };

  /** Checkpoint ID to retrieve from */
  checkpointId?: string;

  /** Format of the returned segment */
  format?: 'full' | 'summary' | 'compressed';
}

/**
 * Conversation segment result
 * NOTE: Uses 'any' for messages to avoid circular dependency with Message types
 */
export interface ConversationSegment {
  /** Messages in the segment (if full format) */
  messages?: any[];

  /** Summary of the segment (if summary/compressed format) */
  summary?: string;

  /** Metadata about the segment */
  metadata: {
    /** Total estimated tokens in segment */
    totalTokens: number;

    /** Turn range of the segment */
    turnRange: {
      start: number;
      end: number;
    };

    /** Whether segment includes compacted messages */
    hasCompactions: boolean;

    /** Number of messages in segment */
    messageCount: number;
  };
}

/**
 * Input schema for ListCompactionBoundaries tool
 */
export interface ListCompactionBoundariesInput {
  /** Include detailed metadata in response */
  includeMetadata?: boolean;
}

/**
 * Compaction boundary information
 */
export interface CompactionBoundary {
  /** Unique identifier for the compaction */
  id: string;

  /** Timestamp when compaction occurred */
  timestamp: Date;

  /** Turn range that was compacted */
  turnRange: {
    start: number;
    end: number;
  };

  /** Token counts */
  tokens: {
    /** Original token count before compaction */
    original: number;

    /** Compressed token count after compaction */
    compressed: number;

    /** Tokens saved by compaction */
    saved: number;
  };

  /** Type of compaction */
  type: 'auto' | 'manual' | 'helper-fallback';

  /** Optional metadata if requested */
  metadata?: {
    /** Topics covered in this segment */
    topics: string[];

    /** Main decisions or outcomes */
    decisions: string[];

    /** Tools used in this segment */
    toolsUsed: string[];

    /** Model used for compaction */
    helperModel: string;

    /** Cost of compaction operation */
    cost: number;

    /** Summary of the compacted section */
    summary: string;
  };
}

/**
 * Input schema for RequestHistoricalContext tool
 */
export interface RequestHistoricalContextInput {
  /** Query describing what historical context is needed */
  query: string;

  /** Detail level for the response */
  detailLevel?: 'brief' | 'standard' | 'detailed';

  /** Maximum tokens for the response */
  maxTokens?: number;

  /** Whether to use helper model (vs main model) */
  useHelperModel?: boolean;
}

/**
 * Historical context result
 */
export interface HistoricalContextResult {
  /** Generated context based on the query */
  context: string;

  /** Sources used to generate the context */
  sources: Array<{
    /** Turn number in conversation */
    turnNumber: number;

    /** Timestamp of the source */
    timestamp: Date;

    /** Whether source is from compacted section */
    isCompacted: boolean;

    /** Compaction ID if applicable */
    compactionId?: string;
  }>;

  /** Estimated tokens used */
  tokensUsed: number;

  /** Model used to generate context */
  modelUsed: string;

  /** Processing cost (usually $0 for Gemma) */
  cost: number;

  /** Processing time in milliseconds */
  processingTime: number;
}

/**
 * Input schema for SearchConversationHistory tool
 */
export interface SearchConversationHistoryInput {
  /** Search query string */
  query: string;

  /** Maximum number of results to return */
  maxResults?: number;

  /** Time range filter */
  timeRange?: {
    start: Date;
    end: Date;
  };

  /** Include compacted messages in search */
  includeCompacted?: boolean;
}

/**
 * Search result from conversation history
 */
export interface SearchResult {
  /** Session ID this result came from */
  sessionId: string;

  /** Turn number in conversation */
  turnNumber: number;

  /** Timestamp of the message */
  timestamp: Date;

  /** Preview of the content */
  preview: string;

  /** Relevance score (0-100) */
  relevanceScore: number;

  /** Whether this result is from a compacted section */
  isCompacted: boolean;

  /** Compaction ID if applicable */
  compactionId?: string;

  /** Message ID */
  messageId?: string;
}

/**
 * Input schema for ListSessions tool
 */
export interface ListSessionsInput {
  /** Maximum number of sessions to return (default: 50) */
  limit?: number;

  /** Filter by minimum age in days */
  minAgeDays?: number;

  /** Filter by maximum age in days */
  maxAgeDays?: number;

  /** Sort order: 'newest' or 'oldest' */
  sortBy?: 'newest' | 'oldest';
}

/**
 * Session summary information
 */
export interface SessionSummary {
  /** Unique session identifier */
  sessionId: string;

  /** When session was created */
  createdAt: string;

  /** Last activity timestamp */
  lastModified: string;

  /** Number of messages in session */
  messageCount: number;

  /** File size in bytes */
  fileSize: number;

  /** Number of compactions in this session */
  compactionCount: number;

  /** Age in days */
  ageDays: number;

  /** Auto-generated session title (from helper model) */
  title?: string;
}

/**
 * Input schema for LoadSession tool
 */
export interface LoadSessionInput {
  /** Session ID to load */
  sessionId: string;

  /** Maximum number of messages to return (default: 100) */
  limit?: number;

  /** Start from message offset (for pagination) */
  offset?: number;

  /** Include system messages */
  includeSystemMessages?: boolean;
}

/**
 * Session load result
 */
export interface SessionLoadResult {
  /** Session ID */
  sessionId: string;

  /** Messages from the session */
  messages: any[]; // Using 'any' to avoid circular dependency

  /** Total message count in session */
  totalMessageCount: number;

  /** Number of messages returned */
  returnedMessageCount: number;

  /** Whether there are more messages */
  hasMore: boolean;

  /** Session metadata */
  metadata: {
    createdAt: string;
    lastModified: string;
    compactionCount: number;
  };
}
