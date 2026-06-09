/**
 * Tool Execution Result
 *
 * Standardized result format for all tool executions
 * Ported from OmniCode3 with adaptations for V4
 */

import type { CanonicalContentBlock } from '@nexus-cortex/types';

/**
 * Result from tool execution
 */
export interface ToolResult {
  /**
   * Content to send back to LLM
   * Can be string or structured content blocks
   */
  llmContent: string | CanonicalContentBlock[];

  /**
   * Content to display to user (optional)
   * If not provided, llmContent is used
   */
  returnDisplay?: string;

  /**
   * Whether execution was successful
   */
  success: boolean;

  /**
   * Error message if failed
   */
  error?: string;

  /**
   * Metadata about execution
   */
  metadata?: {
    /** Execution time in milliseconds */
    executionTime?: number;

    /** Resources accessed during execution */
    resourcesUsed?: {
      /** Files read or written */
      files?: string[];

      /** Network endpoints accessed */
      network?: string[];

      /** Shell commands executed */
      commands?: string[];
    };

    /** Any additional tool-specific metadata */
    [key: string]: any;
  };
}

/**
 * Tool call confirmation details
 * Used for tools that require user confirmation before execution
 */
export interface ToolCallConfirmationDetails {
  /** Human-readable description of what the tool will do */
  description: string;

  /** Whether confirmation is required */
  requiresConfirmation: boolean;

  /** Severity level for UI display */
  severity?: 'info' | 'warning' | 'danger';

  /** Additional context for confirmation prompt */
  context?: string;
}
