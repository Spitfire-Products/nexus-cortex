/**
 * ListSessions Tool Executor
 *
 * Lists all available sessions with metadata for discovery and navigation.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import type { ListSessionsInput, SessionSummary } from '@nexus-cortex/types';
import { ListSessionsTool as CoreListSessionsTool } from '@nexus-cortex/core';

/**
 * Parameters for the ListSessions tool
 */
export interface ListSessionsToolParams {
  /** Maximum number of sessions to return */
  limit?: number;

  /** Filter by minimum age in days */
  minAgeDays?: number;

  /** Filter by maximum age in days */
  maxAgeDays?: number;

  /** Sort order: 'newest' or 'oldest' */
  sortBy?: 'newest' | 'oldest';
}

/**
 * ListSessions Tool Executor
 */
export class ListSessionsToolExecutor extends BaseTool<
  ListSessionsToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'ListSessions',
      'ListSessions',
      `List all available conversation sessions to discover and browse past conversations.

Use this tool to:
- Browse all previous conversation sessions
- Find sessions by age (recent or old)
- See session metadata (message count, creation date, last activity)
- Get session IDs for use with LoadSession tool

Returns sessions sorted by most recent activity by default.`,
      {
        type: 'object',
        properties: {
          limit: {
            type: 'number',
            description: 'Maximum number of sessions to return',
            default: 50,
          },
          minAgeDays: {
            type: 'number',
            description: 'Filter sessions older than N days',
          },
          maxAgeDays: {
            type: 'number',
            description: 'Filter sessions newer than N days',
          },
          sortBy: {
            type: 'string',
            enum: ['newest', 'oldest'],
            description: 'Sort order by last activity',
            default: 'newest',
          },
        },
      }
    );
  }

  validateToolParams(params: ListSessionsToolParams): string | null {
    // All parameters are optional, nothing to validate
    return null;
  }

  async execute(
    params: ListSessionsToolParams,
    signal: AbortSignal
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      const storageDir = this.config.storageDir || '.cortex/sessions';
      const coreTool = new CoreListSessionsTool(storageDir);

      const input: ListSessionsInput = {
        limit: params.limit,
        minAgeDays: params.minAgeDays,
        maxAgeDays: params.maxAgeDays,
        sortBy: params.sortBy,
      };

      const sessions = await coreTool.execute(input);

      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('List sessions was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Format output
      const formattedOutput = this.formatSessions(sessions);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionCount: sessions.length,
          storageDir,
        },
      };
    } catch (error: any) {
      if (signal.aborted) {
        return {
          ...this.createErrorResult('List sessions was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      return {
        ...this.createErrorResult(`Failed to list sessions: ${error.message}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: error.message,
        },
      };
    }
  }

  /**
   * Format sessions for display
   */
  private formatSessions(sessions: SessionSummary[]): string {
    if (sessions.length === 0) {
      return 'No sessions found.';
    }

    const lines: string[] = [];
    lines.push(`=== Available Sessions ===\n\n`);
    lines.push(`Found ${sessions.length} session${sessions.length > 1 ? 's' : ''}:\n\n`);

    sessions.forEach((session, index) => {
      const createdDate = new Date(session.createdAt).toLocaleDateString();
      const lastModDate = new Date(session.lastModified).toLocaleDateString();
      const size = this.formatFileSize(session.fileSize);

      lines.push(`${index + 1}. Session: ${session.sessionId}\n`);
      if (session.title) {
        lines.push(` Title: ${session.title}\n`);
      }
      lines.push(` Created: ${createdDate}\n`);
      lines.push(` Last Activity: ${lastModDate} (${session.ageDays} days ago)\n`);
      lines.push(` Messages: ${session.messageCount}\n`);
      lines.push(` Size: ${size}\n`);
      lines.push(` Compactions: ${session.compactionCount}\n\n`);
    });

    lines.push(`\nUse LoadSession with a sessionId to load full conversation history.`);

    return lines.join('');
  }

  /**
   * Format file size
   */
  private formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
