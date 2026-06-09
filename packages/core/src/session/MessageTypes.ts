/**
 * Message types for Claude CLI JSONL session format
 * Based on research: 02-claude-cli-analysis/CLAUDE_CODE_CLI_ARCHITECTURE.md
 */

import type { SessionMetadata as ImportedSessionMetadata } from '@nexus-cortex/types';

/**
 * Base message interface - all messages have these fields
 */
export interface BaseMessage {
  uuid: string;                    // Message UUID
  timestamp: string;                // ISO 8601 timestamp
  parentUuid?: string;              // Parent message UUID (for threading)
  logicalParentUuid?: string;       // Logical parent (for compaction boundaries)

  //  Phase 1.5: Timeline tracking (optional for backward compatibility)
  timeline?: {
    sessionId: string;              // Session this message belongs to
    conversationId: string;         // Conversation within session
    eventId?: string;               // Timeline event ID for this message
    turnNumber: number;             // Turn number in conversation
    checkpointId?: string;          // Associated checkpoint (if any)
    branchPoint?: boolean;          // True if this message is a branch point
    resumePoint?: boolean;          // True if conversation resumed here
  };

  //  Phase 1.5: Model context tracking
  model?: {
    id: string;                     // Model ID (e.g., "claude-3-5-sonnet-20241022")
    provider: string;               // Provider (e.g., "anthropic")
    apiPattern: string;             // API pattern (e.g., "messages")
  };

  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens?: number;
    cache?: {
      cacheCreationTokens?: number;
      cacheReadTokens?: number;
      uncachedInputTokens?: number;
      cacheHitRate?: number;
      costSavingsRatio?: number;
    };
    costUsdTicks?: number;
    costUsd?: number;
  };
}

/**
 * User message
 */
export interface UserMessage extends BaseMessage {
  type: 'user';
  message: {
    role: 'user';
    content: string | ContentBlock[];
  };
  isCompactSummary?: boolean;       // True for compaction summaries
  isVisibleInTranscriptOnly?: boolean;  // True for UI-only messages
}

/**
 * Assistant message
 */
export interface AssistantMessage extends BaseMessage {
  type: 'assistant';
  message: {
    role: 'assistant';
    content: string | ContentBlock[];
  };
}

/**
 * System message
 */
export interface SystemMessage extends BaseMessage {
  type: 'system';
  subtype?: 'compact_boundary' | string;
  content: string;
  level?: 'info' | 'warning' | 'error';
  isMeta?: boolean;
  isSidechain?: boolean;
  compactMetadata?: CompactionMetadata;
}

/**
 * Tool use message (assistant requests tool execution)
 */
export interface ToolUseMessage extends BaseMessage {
  type: 'tool_use';
  message: {
    role: 'assistant';
    content: Array<{
      type: 'tool_use';
      id: string;
      name: string;
      input: Record<string, any>;
    }>;
  };
}

/**
 * Tool result message (tool execution result)
 */
export interface ToolResultMessage extends BaseMessage {
  type: 'tool_result';
  message: {
    role: 'user';
    content: Array<{
      type: 'tool_result';
      tool_use_id: string;
      tool_name?: string;
      content: string | any;
      is_error?: boolean;
      metadata?: ToolResultMetadata;
    }>;
  };
}

/**
 * File history snapshot message
 */
export interface FileHistorySnapshotMessage extends BaseMessage {
  type: 'file-history-snapshot';
  messageId: string;
  snapshot: {
    messageId: string;
    trackedFileBackups: Record<string, FileBackupInfo>;
    timestamp: string;
  };
  isSnapshotUpdate: boolean;        // True if files were modified
}

/**
 * Content block types (for structured content)
 */
export type ContentBlock =
  | { type: 'text'; text: string; cache_control?: CacheControl }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, any> }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean; tool_name?: string; metadata?: ToolResultMetadata }
  | { type: 'thinking'; thinking: string; signature?: string }
  | { type: 'redacted_thinking'; data: string };

/**
 * Write tool preview metadata for file creation
 */
export interface WritePreviewMetadata {
  /** Full path to the created file */
  filePath: string;
  /** Full file content for preview */
  content: string;
  /** Number of lines in the file */
  lineCount: number;
  /** File size in bytes */
  byteSize: number;
  /** Programming language detected from extension */
  language?: string;
}

/**
 * Document preview metadata for markdown/text files (minimal, lazy-loaded)
 */
export interface DocumentPreviewMetadata {
  /** Full path to the document file */
  filePath: string;
  /** Number of lines in the document */
  lineCount: number;
  /** Number of words in the document */
  wordCount: number;
  /** Whether this is a markdown file */
  isMarkdown: boolean;
  /** NOTE: content NOT stored - lazy loaded on expand */
}

/**
 * Tool result metadata (for Edit tool diffs, file stats, etc.)
 */
export interface ToolResultMetadata {
  /** Unified diff string from Edit tool */
  diff?: string;
  /** Write tool preview data (for code files) */
  writePreview?: WritePreviewMetadata;
  /** Document preview data (for markdown/text files, lazy-loaded) */
  documentPreview?: DocumentPreviewMetadata;
  /** File statistics */
  fileStats?: {
    path?: string;
    occurrences?: number;
    operation?: string;
    size?: number;
    lines?: number;
    action?: string;
    existed?: boolean;
  };
  /** Any other tool-specific metadata */
  [key: string]: any;
}

/**
 * Cache control directive (stripped before sending to API)
 */
export interface CacheControl {
  type: 'ephemeral';
}

/**
 * Compaction metadata
 */
export interface CompactionMetadata {
  trigger: 'auto' | 'manual';
  preTokens: number;                // Token count before compaction
  timestamp?: string;
  summaryUuid?: string;             // UUID of generated summary
}

/**
 * File backup information
 */
export interface FileBackupInfo {
  backupFileName: string | null;    // null = not yet backed up
  version: number;
  backupTime: string;               // ISO 8601 timestamp
}

/**
 * Union type of all message types
 */
export type Message =
  | UserMessage
  | AssistantMessage
  | SystemMessage
  | ToolUseMessage
  | ToolResultMessage
  | FileHistorySnapshotMessage;

/**
 * Session metadata
 */
// Alias for imported SessionMetadata type
export type SessionMetadata = ImportedSessionMetadata;

/**
 * Compact boundary marker (special system message)
 */
export interface CompactBoundary extends SystemMessage {
  subtype: 'compact_boundary';
  content: 'Conversation compacted';
  compactMetadata: CompactionMetadata;
}

/**
 * Simplified canonical message format for testing and historical tools
 * Compatible with both real Message types and simplified test fixtures
 * Note: This is different from the full CanonicalMessage in @nexus-cortex/types/messages
 */
export interface SimplifiedCanonicalMessage {
  id?: string;                      // For test compatibility
  uuid?: string;                    // For real Message compatibility
  role: 'user' | 'assistant' | 'system' | 'tool';
  content?: string;
  tool_use?: Array<{
    name: string;
    input: Record<string, any>;
  }>;
  tool_result?: {
    output: any;
  };
  timestamp: string;
}

/**
 * Type guards
 */
export function isUserMessage(msg: Message): msg is UserMessage {
  return msg.type === 'user';
}

export function isAssistantMessage(msg: Message): msg is AssistantMessage {
  return msg.type === 'assistant';
}

export function isSystemMessage(msg: Message): msg is SystemMessage {
  return msg.type === 'system';
}

export function isToolUseMessage(msg: Message): msg is ToolUseMessage {
  if (msg.type !== 'assistant') return false;
  const content = (msg as AssistantMessage).message.content;
  return Array.isArray(content) && content.some((block: any) => block.type === 'tool_use');
}

export function isToolResultMessage(msg: Message): msg is ToolResultMessage {
  if (msg.type !== 'user') return false;
  const content = (msg as UserMessage).message.content;
  return Array.isArray(content) && content.some((block: any) => block.type === 'tool_result');
}

export function isFileHistorySnapshot(msg: Message): msg is FileHistorySnapshotMessage {
  return msg.type === 'file-history-snapshot';
}

export function isCompactBoundary(msg: Message): msg is CompactBoundary {
  return msg.type === 'system' && (msg as SystemMessage).subtype === 'compact_boundary';
}

export function isCompactSummary(msg: Message): boolean {
  return isUserMessage(msg) && msg.isCompactSummary === true;
}
