/**
 * GetConversationSegment Tool Executor
 *
 * Retrieves specific segments of conversation history at different detail levels.
 * Can retrieve by turn range or checkpoint ID.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import type { GetConversationSegmentInput, ConversationSegment } from '@nexus-cortex/types';
import {
  GetConversationSegmentTool as CoreGetSegmentTool,
  JSONLHistoryStore,
} from '@nexus-cortex/core';

/**
 * Parameters for the GetConversationSegment tool
 */
export interface GetConversationSegmentToolParams {
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
 * GetConversationSegment Tool Executor
 *
 * Features:
 * - Retrieve by turn range or checkpoint
 * - Multiple format options (full, summary, compressed)
 * - Handles compacted sections
 */
export class GetConversationSegmentToolExecutor extends BaseTool<
  GetConversationSegmentToolParams,
  ToolResult
> {
  private historyStore: JSONLHistoryStore;
  private workspaceRoot: string;

  constructor(private config: ExecutorConfig) {
    super(
      'GetConversationSegment',
      'GetConversationSegment',
      `Retrieve a specific segment of conversation history at different detail levels.

Can retrieve by turn range or checkpoint ID in full, summary, or compressed format.`,
      {
        type: 'object',
        properties: {
          turnRange: {
            type: 'object',
            properties: {
              start: {
                type: 'number',
                description: 'Starting turn number (1-based)',
              },
              end: {
                type: 'number',
                description: 'Ending turn number (inclusive)',
              },
            },
            description: 'Turn range to retrieve',
          },
          checkpointId: {
            type: 'string',
            description: 'Checkpoint ID to retrieve from',
          },
          format: {
            type: 'string',
            enum: ['full', 'summary', 'compressed'],
            description: 'Format of the returned segment',
            default: 'summary',
          },
        },
      },
    );

    this.workspaceRoot = (config as any).workspaceRoot || config.workingDirectory;
    this.historyStore = new JSONLHistoryStore({ baseDir: this.workspaceRoot });
  }

  validateToolParams(params: GetConversationSegmentToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Must provide either turnRange or checkpointId
    if (!params.turnRange && !params.checkpointId) {
      return 'Must provide either turnRange or checkpointId.';
    }

    // Validate turnRange if provided
    if (params.turnRange) {
      if (params.turnRange.start < 1) {
        return 'Turn range start must be at least 1.';
      }
      if (params.turnRange.end < params.turnRange.start) {
        return 'Turn range end must be >= start.';
      }
    }

    // Validate format
    if (params.format && !['full', 'summary', 'compressed'].includes(params.format)) {
      return `Invalid format: ${params.format}. Must be 'full', 'summary', or 'compressed'.`;
    }

    return null;
  }

  getDescription(params: GetConversationSegmentToolParams): string {
    const format = params.format || 'summary';
    if (params.turnRange) {
      return `Getting conversation segment turns ${params.turnRange.start}-${params.turnRange.end} (${format})`;
    }
    return `Getting conversation segment from checkpoint ${params.checkpointId} (${format})`;
  }

  async execute(
    params: GetConversationSegmentToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Segment retrieval was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Validate parameters
      const validationError = this.validateToolParams(params);
      if (validationError) {
        return {
          ...this.createErrorResult(validationError),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Get session ID from config
      const sessionId = (this.config as any).sessionId;
      if (!sessionId) {
        return {
          ...this.createErrorResult(
            'Session ID not provided in executor config. Historical tools require active session context.',
          ),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Load messages from session storage
      const messages = await this.historyStore.loadSession(
        sessionId,
        this.workspaceRoot,
      );

      if (messages.length === 0) {
        return {
          ...this.createSuccessResult('No messages found in session history.'),
          metadata: {
            executionTime: Date.now() - startTime,
            sessionId,
            messageCount: 0,
          },
        };
      }

      // Create core tool and execute
      const coreTool = new CoreGetSegmentTool(this.workspaceRoot);
      const input: GetConversationSegmentInput = {
        turnRange: params.turnRange,
        checkpointId: params.checkpointId,
        format: params.format,
      };

      const segment = await coreTool.execute(input, sessionId, messages);

      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Segment retrieval was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Format output
      const formattedOutput = this.formatSegment(segment, params.format || 'summary');

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionId,
          totalTokens: segment.metadata.totalTokens,
          turnRange: segment.metadata.turnRange,
          hasCompactions: segment.metadata.hasCompactions,
          messageCount: segment.metadata.messageCount,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Segment retrieval was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error retrieving conversation segment: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format conversation segment for display
   */
  private formatSegment(segment: ConversationSegment, format: string): string {
    const lines: string[] = [];

    lines.push('=== Conversation Segment ===\n\n');
    lines.push(`Turns: ${segment.metadata.turnRange.start} - ${segment.metadata.turnRange.end}\n`);
    lines.push(`Messages: ${segment.metadata.messageCount}\n`);
    lines.push(`Estimated tokens: ${segment.metadata.totalTokens}\n`);
    lines.push(`Has compactions: ${segment.metadata.hasCompactions ? 'Yes' : 'No'}\n\n`);

    if (format === 'full' && segment.messages) {
      lines.push('## Full Messages\n\n');
      segment.messages.forEach((msg: any, index: number) => {
        const msgAny = msg as any;
        lines.push(`Message ${index + 1}:\n`);
        if (msgAny.role) {
          lines.push(` Role: ${msgAny.role}\n`);
        }
        if (msgAny.content) {
          const content = typeof msgAny.content === 'string'
            ? msgAny.content
            : JSON.stringify(msgAny.content);
          lines.push(` Content: ${content.substring(0, 200)}${content.length > 200 ? '...' : ''}\n`);
        }
        lines.push('\n');
      });
    } else if (segment.summary) {
      lines.push('## Summary\n\n');
      lines.push(segment.summary);
      lines.push('\n');
    }

    return lines.join('');
  }
}
