/**
 * SearchConversationHistory Tool Executor
 *
 * Searches conversation history including both recent messages and compacted boundaries.
 * Provides semantic search across the full conversation timeline.
 */

import { BaseTool, type ToolResult } from '../../base/index.js';
import { SchemaValidator } from '../../utils/SchemaValidator.js';
import type { ExecutorConfig } from '../../base/ToolRegistry.js';
import type { SearchConversationHistoryInput, SearchResult } from '@nexus-cortex/types';
import {
  SearchConversationHistoryTool as CoreSearchTool,
  JSONLHistoryStore,
} from '@nexus-cortex/core';

/**
 * Parameters for the SearchConversationHistory tool
 */
export interface SearchConversationHistoryToolParams {
  /** Search query string */
  query: string;

  /** Maximum number of results to return */
  maxResults?: number;

  /** Time range filter */
  timeRange?: {
    start: string; // ISO 8601 date string
    end: string; // ISO 8601 date string
  };

  /** Include compacted messages in search */
  includeCompacted?: boolean;

  /** Search scope: 'current' (current session), 'all' (all sessions), or specific session IDs */
  searchScope?: 'current' | 'all' | string[];
}

/**
 * SearchConversationHistory Tool Executor
 *
 * Features:
 * - Searches both recent and compacted messages
 * - Semantic search with relevance scoring
 * - Time range filtering
 * - Configurable result limit
 */
export class SearchConversationHistoryToolExecutor extends BaseTool<
  SearchConversationHistoryToolParams,
  ToolResult
> {
  constructor(private config: ExecutorConfig) {
    super(
      'SearchConversationHistory',
      'SearchConversationHistory',
      `Search conversation history across ALL previous sessions and current session.

Use this tool to:
- Find messages from previous conversations/sessions
- Search across all historical session data (default behavior)
- Locate specific topics or information from past interactions

By default searches ALL sessions. Use searchScope parameter to limit to current session only.`,
      {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 10,
          },
          timeRange: {
            type: 'object',
            properties: {
              start: { type: 'string', format: 'date-time' },
              end: { type: 'string', format: 'date-time' },
            },
            description: 'Optional time range filter',
          },
          includeCompacted: {
            type: 'boolean',
            description: 'Include compacted messages in search',
            default: true,
          },
          searchScope: {
            type: 'string',
            oneOf: [
              { type: 'string', enum: ['current', 'all'] },
              { type: 'array', items: { type: 'string' } }
            ],
            description: 'Search scope: "current" (current session only), "all" (all sessions), or array of specific session IDs. Defaults to "all" to search across all sessions.',
            default: 'all',
          },
        },
        required: ['query'],
      },
    );
  }

  /**
   * Get storage directory from config (dynamically resolved)
   */
  private getStorageDir(): string {
    return (this.config as any).storageDir || '.cortex/sessions';
  }

  validateToolParams(params: SearchConversationHistoryToolParams): string | null {
    // Schema validation
    const schemaError = SchemaValidator.validate(this.parameterSchema, params);
    if (schemaError) {
      return schemaError;
    }

    // Validate query
    if (!params.query || params.query.trim().length === 0) {
      return 'Query cannot be empty.';
    }

    if (params.query.length > 1000) {
      return 'Query too long (max 1000 characters).';
    }

    // Validate maxResults
    if (params.maxResults !== undefined) {
      if (params.maxResults < 1) {
        return 'maxResults must be at least 1.';
      }
      if (params.maxResults > 100) {
        return 'maxResults cannot exceed 100.';
      }
    }

    // Validate time range if provided
    if (params.timeRange) {
      try {
        const start = new Date(params.timeRange.start);
        const end = new Date(params.timeRange.end);

        if (isNaN(start.getTime())) {
          return 'Invalid start date in timeRange.';
        }
        if (isNaN(end.getTime())) {
          return 'Invalid end date in timeRange.';
        }
        if (start > end) {
          return 'Time range start must be before end.';
        }
      } catch (error: any) {
        return `Invalid time range: ${error.message}`;
      }
    }

    return null;
  }

  getDescription(params: SearchConversationHistoryToolParams): string {
    const maxResults = params.maxResults || 10;
    return `Searching conversation history for "${params.query}" (max ${maxResults} results)`;
  }

  async execute(
    params: SearchConversationHistoryToolParams,
    signal: AbortSignal,
    updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const startTime = Date.now();

    try {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Search was cancelled'),
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

      // Get storage directory and create history store
      const storageDir = this.getStorageDir();
      const workspaceRoot = (this.config as any).workspaceRoot || storageDir;
      const historyStore = new JSONLHistoryStore({ baseDir: storageDir });

      // Determine which sessions to search
      const searchScope = params.searchScope || 'all';
      let sessionIdsToSearch: string[] = [];

      if (searchScope === 'current') {
        // Search only current session
        sessionIdsToSearch = [sessionId];
      } else if (searchScope === 'all') {
        // Search all sessions
        const allSessions = await historyStore.listSessions();
        sessionIdsToSearch = allSessions.map((s: any) => s.sessionId);
      } else if (Array.isArray(searchScope)) {
        // Search specific session IDs
        sessionIdsToSearch = searchScope;
      }

      // Load messages from all sessions in scope
      const allMessages: any[] = [];
      const sessionMessageCounts: Record<string, number> = {};

      for (const sid of sessionIdsToSearch) {
        try {
          const messages = await historyStore.loadSession(sid);
          // Tag each message with its source session ID for cross-session search
          const taggedMessages = messages.map(msg => ({
            ...msg,
            _sourceSessionId: sid
          }));
          allMessages.push(...taggedMessages);
          sessionMessageCounts[sid] = messages.length;
        } catch (error) {
          // Skip sessions that can't be loaded
          console.warn(`Failed to load session ${sid}: ${error}`);
        }
      }

      if (allMessages.length === 0) {
        return {
          ...this.createSuccessResult('No messages found in session history.'),
          metadata: {
            executionTime: Date.now() - startTime,
            sessionId,
            sessionsSearched: sessionIdsToSearch.length,
            messageCount: 0,
            resultCount: 0,
          },
        };
      }

      // Convert time range to Date objects if provided
      const timeRange = params.timeRange
        ? {
            start: new Date(params.timeRange.start),
            end: new Date(params.timeRange.end),
          }
        : undefined;

      // Create core tool and execute search across all messages
      const coreTool = new CoreSearchTool(workspaceRoot);
      const input: SearchConversationHistoryInput = {
        query: params.query,
        maxResults: params.maxResults,
        timeRange,
        includeCompacted: params.includeCompacted,
      };

      const results = await coreTool.execute(input, sessionId, allMessages);

      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Search was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      // Format results
      const formattedOutput = this.formatResults(results, params.query);

      return {
        ...this.createSuccessResult(formattedOutput),
        metadata: {
          executionTime: Date.now() - startTime,
          sessionId,
          sessionsSearched: sessionIdsToSearch.length,
          messageCount: allMessages.length,
          resultCount: results.length,
          query: params.query,
          searchScope: searchScope,
        },
      };
    } catch (error: any) {
      // Check for abort
      if (signal.aborted) {
        return {
          ...this.createErrorResult('Search was cancelled'),
          metadata: {
            executionTime: Date.now() - startTime,
          },
        };
      }

      const errorMessage = error.message || String(error);
      return {
        ...this.createErrorResult(`Error searching conversation history: ${errorMessage}`),
        metadata: {
          executionTime: Date.now() - startTime,
          error: errorMessage,
        },
      };
    }
  }

  /**
   * Format search results for display
   */
  private formatResults(results: SearchResult[], query: string): string {
    if (results.length === 0) {
      return `No results found for "${query}".`;
    }

    const lines: string[] = [];
    lines.push(`=== Search Results for "${query}" ===\n\n`);
    lines.push(`Found ${results.length} result${results.length > 1 ? 's' : ''}:\n\n`);

    // Group results by session for clarity
    const resultsBySession = new Map<string, SearchResult[]>();
    results.forEach(result => {
      const sessionResults = resultsBySession.get(result.sessionId) || [];
      sessionResults.push(result);
      resultsBySession.set(result.sessionId, sessionResults);
    });

    let globalIndex = 0;
    resultsBySession.forEach((sessionResults, sessionId) => {
      if (resultsBySession.size > 1) {
        // Show session header if results span multiple sessions
        lines.push(`--- Session: ${sessionId} (${sessionResults.length} result${sessionResults.length > 1 ? 's' : ''}) ---\n\n`);
      }

      sessionResults.forEach((result) => {
        globalIndex++;
        lines.push(`${globalIndex}. Turn ${result.turnNumber} (${result.timestamp.toLocaleString()})\n`);
        if (resultsBySession.size === 1) {
          lines.push(` Session: ${result.sessionId}\n`);
        }
        lines.push(` Relevance: ${result.relevanceScore}%\n`);

        if (result.isCompacted) {
          lines.push(` Source: Compacted section (ID: ${result.compactionId})\n`);
        } else {
          lines.push(` Source: Message ${result.messageId}\n`);
        }

        lines.push(` Preview: ${result.preview}\n\n`);
      });
    });

    return lines.join('');
  }
}
