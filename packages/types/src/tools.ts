/**
 * Tool-Related Type Definitions
 *
 * @packageDocumentation
 * @module @nexus-cortex/types/tools
 *
 * This module contains all tool-related types for the Nexus Cortex system.
 * These types provide a canonical, provider-agnostic representation of tools,
 * tool uses, and tool results.
 *
 * Phase 1.5: Multi-Provider Architecture
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md
 */

/**
 * Canonical Tool Format
 *
 * Provider-agnostic internal representation of a tool/function.
 * Stored in JSONL session files for cross-provider continuity.
 */
export interface CanonicalTool {
  /** Tool name (stored in original casing) */
  name: string;

  /** Human-readable description of what the tool does */
  description: string;

  /** JSON Schema defining the tool's parameters */
  schema: ToolSchema;

  /** Metadata for conversion and tracking */
  metadata?: {
    /** Original naming convention */
    originalNaming?: 'snake_case' | 'PascalCase';

    /** Source provider (if converted from provider format) */
    sourceProvider?: string;

    /** Additional provider-specific metadata */
    [key: string]: unknown;
  };

  /** Discovery tier for progressive tool loading: 'essential' always loaded, 'standard' can be deferred */
  discoveryTier?: ToolDiscoveryTier;

  /** PTC: Defer tool loading — tool schema sent to server but not loaded until needed */
  defer_loading?: boolean;

  /** PTC: Restrict which callers can invoke this tool (e.g., ['code_execution']) */
  allowed_callers?: string[];
}

/**
 * Discovery tier for progressive tool loading.
 * 'essential' tools are always loaded; 'standard' tools can be deferred.
 */
export type ToolDiscoveryTier = 'essential' | 'standard';

/**
 * Anthropic PTC System Tool Types
 * These are special server-side tools managed by Anthropic's PTC infrastructure.
 */
export interface PTCCodeExecutionTool {
  type: 'code_execution_20260120';
}

export interface PTCToolSearchTool {
  type: 'tool_search_tool_bm25_20251119';
}

export type PTCSystemTool = PTCCodeExecutionTool | PTCToolSearchTool;

/**
 * Tool Parameter Schema
 *
 * Standard JSON Schema representation of tool parameters.
 */
export interface ToolSchema {
  /** Must be 'object' for tool parameters */
  type: 'object';

  /** Property definitions */
  properties: Record<string, PropertySchema>;

  /** Required property names */
  required?: string[];

  /** Additional JSON Schema properties */
  [key: string]: unknown;
}

/**
 * Property Schema
 *
 * JSON Schema definition for a single property.
 */
export interface PropertySchema {
  /** Property type */
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

  /** Human-readable description */
  description?: string;

  /** Enum values (for restricted choices) */
  enum?: string[];

  /** Default value */
  default?: unknown;

  /** For array types */
  items?: PropertySchema;

  /** For object types */
  properties?: Record<string, PropertySchema>;

  /** Additional JSON Schema properties */
  [key: string]: unknown;
}

/**
 * Canonical Tool Use (from AI model)
 *
 * Represents a tool invocation request from the model.
 */
export interface CanonicalToolUse {
  /** Unique ID for this tool use */
  id: string;

  /** Name of the tool being called */
  name: string;

  /** Arguments provided by the model */
  input: Record<string, unknown>;

  /** Metadata */
  metadata?: {
    /** Model that made this tool call */
    modelId?: string;

    /** Provider that generated this tool call */
    sourceProvider?: string;

    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * Canonical Tool Result
 *
 * Represents the result of executing a tool.
 */
export interface CanonicalToolResult {
  /** ID of the tool use this is responding to */
  tool_use_id: string;

  /** Tool execution result */
  content: string | object;

  /** Whether execution was successful */
  is_error?: boolean;

  /** Metadata */
  metadata?: {
    /** Execution time in milliseconds */
    executionTime?: number;

    /** Whether result was summarized (for large outputs) */
    summarized?: boolean;

    /** Original size before summarization */
    originalSize?: number;

    /** Additional metadata */
    [key: string]: unknown;
  };
}

/**
 * Canonical Content Block
 *
 * Represents different types of content in a message.
 */
export interface CanonicalContentBlock {
  /** Content type */
  type: 'text' | 'tool_use' | 'tool_result' | 'thinking' | 'redacted_thinking' | 'server_tool_use' | 'code_execution_tool_result';

  /** Text content (for type: text) */
  text?: string;

  /** Encrypted reasoning blob (for type: redacted_thinking) — XAI grok-4/4.1 opaque reasoning */
  data?: string;

  /** Tool use details (for type: tool_use) */
  toolUse?: CanonicalToolUse;

  /** Tool result details (for type: tool_result) */
  toolResult?: CanonicalToolResult;

  /** Thinking/reasoning content (for type: thinking) */
  thinking?: string;

  /** Cryptographic signature for Claude extended thinking (for type: thinking) */
  signature?: string;

  /** Metadata for thinking blocks to distinguish source/type */
  thinkingMetadata?: {
    /** Source of thinking block */
    source: 'native' | 'extended' | 'mentorship';
    /** Model that generated this thinking (for mentorship) */
    modelId?: string;
  };

  /** PTC: Server-side tool use (for type: server_tool_use) — tool called by PTC code execution */
  serverToolUse?: {
    id: string;
    name: string;
    input: Record<string, unknown>;
  };

  /** PTC: Code execution tool result (for type: code_execution_tool_result) */
  codeExecutionResult?: {
    tool_use_id: string;
    content: string;
    output?: { stdout: string; stderr: string };
  };

  /**
   * Anthropic prompt-caching breakpoint (#29).
   *
   * When present, marks this block as a cache boundary — everything up to and
   * including this block becomes a cacheable prefix. The adapter is responsible
   * for forwarding this field to provider payloads where it applies (Anthropic
   * Messages API; XAI Messages API is Anthropic-compatible). Other providers
   * (OpenAI, Google) strip it during conversion since they either reject
   * unknown fields or handle caching automatically.
   */
  cache_control?: { type: 'ephemeral' };
}

/**
 * Token Usage Information
 */
export interface TokenUsage {
  /** Input tokens consumed */
  inputTokens: number;

  /** Output tokens generated */
  outputTokens: number;

  /** Total tokens */
  totalTokens: number;

  /** Additional provider-specific usage data */
  [key: string]: unknown;
}