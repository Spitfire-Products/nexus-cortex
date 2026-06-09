/**
 * LoadSession Tool Executor
 *
 * Loads messages from a specific session to bring past conversation context
 * into the current conversation.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import type { LoadSessionInput, SessionLoadResult } from '@nexus-cortex/types';
import { LoadSessionTool as CoreLoadSessionTool } from '@nexus-cortex/core';

/**
 * Parameters for the LoadSession tool
 */
export interface LoadSessionToolParams {
  /** Session ID to load */
  sessionId: string;

  /** Maximum number of messages to return */
  limit?: number;

  /** Start from message offset (for pagination) */
  offset?: number;

  /** Include system messages */
  includeSystemMessages?: boolean;
}

/**
 * LoadSession Tool Executor
 */
export class LoadSessionToolExecutor extends BaseTool<
  LoadSessionToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'LoadSession',
      'LoadSession',
      `Load full message history from a specific previous session.

Use this tool to:
- Load complete conversation context from a past session
- Access detailed message history beyond search results
- Continue analysis from a previous conversation
- Bring full context from identified sessions (via ListSessions or SearchConversationHistory)

Returns actual messages with full content. Use pagination (limit/offset) for large sessions.`,
      {
        type: 'object',
        properties: {
          sessionId: {
            type: 'string',
            description: 'Session ID to load (from ListSessions or SearchConversationHistory results)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of messages to return',
            default: 100,
          },
          offset: {
            type: 'number',
            description: 'Start from message offset (for pagination)',
            default: 0,
          },
          includeSystemMessages: {
            type: 'boolean',
            description: 'Include system messages in results',
            default: false,
          },
        },
        required: ['sessionId'],
      }
    );
  }

  validateToolParams(params: LoadSessionToolParams): string | null {
    if (!params.sessionId || typeof params.sessionId !== 'string') {
      return 'sessionId is required and must be a string';
    }
    return null;
  }

  async execute(
    params: LoadSessionToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const storageDir = this.config.storageDir || '.cortex/sessions';
      const coreTool = new CoreLoadSessionTool(storageDir);

      const input: LoadSessionInput = {
        sessionId: params.sessionId,
        limit: params.limit,
        offset: params.offset,
        includeSystemMessages: params.includeSystemMessages,
      };

      const result = await coreTool.execute(input);

      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Load session was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Format output
      const formattedOutput = this.formatSession(result);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionId: result.sessionId,
          totalMessages: result.totalMessageCount,
          returnedMessages: result.returnedMessageCount,
          hasMore: result.hasMore,
        },
      };
    } catch (error: any) {
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Load session was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      return {
        ...this.createErrorResult(`Failed to load session: ${error.message}`),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionId: params.sessionId,
          error: error.message,
        },
      };
    }
  }

  /**
   * Format session messages for display
   */
  private formatSession(result: SessionLoadResult): string {
    const lines: string[] = [];

    lines.push(`=== Session: ${result.sessionId} ===\n\n`);
    lines.push(`Created: ${new Date(result.metadata.createdAt).toLocaleString()}\n`);
    lines.push(`Last Modified: ${new Date(result.metadata.lastModified).toLocaleString()}\n`);
    lines.push(`Total Messages: ${result.totalMessageCount}\n`);
    lines.push(`Compactions: ${result.metadata.compactionCount}\n`);
    lines.push(`Showing: ${result.returnedMessageCount} messages\n`);
    if (result.hasMore) {
      lines.push(`(More messages available - use offset parameter for pagination)\n`);
    }
    lines.push(`\n--- Messages ---\n\n`);

    result.messages.forEach((msg: any, index: number) => {
      const msgNum = (result.metadata as any).offset ? (result.metadata as any).offset + index + 1 : index + 1;
      const timestamp = new Date(msg.timestamp).toLocaleString();
      const role = msg.type || msg.role || 'unknown';

      lines.push(`Message ${msgNum} [${role}] - ${timestamp}\n`);

      // Extract content
      const content = this.extractMessageContent(msg);
      if (content) {
        const preview = content.length > 200 ? content.substring(0, 200) + '...' : content;
        lines.push(`${preview}\n\n`);
      } else {
        lines.push(`(No text content)\n\n`);
      }
    });

    return lines.join('');
  }

  /**
   * Extract readable content from message
   */
  private extractMessageContent(msg: any): string {
    // Handle different message formats
    if (typeof msg.content === 'string') {
      return msg.content;
    }

    if (Array.isArray(msg.content)) {
      return msg.content
        .map((block: any) => {
          if (block.type === 'text') return block.text;
          if (block.type === 'tool_use') {
            const toolName = block.toolUse?.name || block.name || 'Unknown';
            return `[Tool: ${toolName}]`;
          }
          if (block.type === 'tool_result') return `[Tool Result]`;
          return '';
        })
        .filter(Boolean)
        .join(' ');
    }

    if (msg.message?.content) {
      return this.extractMessageContent(msg.message);
    }

    return '';
  }
}
