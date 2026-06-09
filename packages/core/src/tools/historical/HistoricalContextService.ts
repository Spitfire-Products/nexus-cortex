/**
 * Historical Context Service
 *
 * Coordinates the 4 historical retrieval tools to provide unified access
 * to conversation history across compaction boundaries.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 4.3
 */

import type { Message } from '../../session/MessageTypes.js';
import { SearchConversationHistoryTool, type SearchResult } from './SearchConversationHistory.js';
import { GetConversationSegmentTool } from './GetConversationSegment.js';
import { ListCompactionBoundariesTool } from './ListCompactionBoundaries.js';
import { RequestHistoricalContextTool } from './RequestHistoricalContext.js';

/**
 * Options for historical context operations
 */
export interface HistoricalContextOptions {
  /** Session ID for the conversation */
  sessionId: string;

  /** Recent messages in current context */
  recentMessages: Message[];

  /** Workspace root for storage */
  workspaceRoot?: string;
}

/**
 * Unified historical context response
 */
export interface HistoricalContext {
  /** Type of context retrieved */
  type: 'search' | 'segment' | 'boundaries' | 'context';

  /** Content of the response */
  content: any;

  /** Metadata about the retrieval */
  metadata: {
    /** Number of sources used */
    sourceCount: number;

    /** Time range covered */
    timeRange?: {
      start: Date;
      end: Date;
    };

    /** Tokens used for retrieval */
    tokensUsed?: number;

    /** Model used (if applicable) */
    modelUsed?: string;

    /** Processing time in milliseconds */
    processingTime: number;
  };
}

/**
 * Service for coordinating historical context retrieval
 */
export class HistoricalContextService {
  private searchTool: SearchConversationHistoryTool;
  private segmentTool: GetConversationSegmentTool;
  private boundariesTool: ListCompactionBoundariesTool;
  private contextTool: RequestHistoricalContextTool;

  constructor(workspaceRoot?: string) {
    this.searchTool = new SearchConversationHistoryTool(workspaceRoot);
    this.segmentTool = new GetConversationSegmentTool(workspaceRoot);
    this.boundariesTool = new ListCompactionBoundariesTool(workspaceRoot);
    this.contextTool = new RequestHistoricalContextTool(workspaceRoot);
  }

  /**
   * Get all tool definitions for registration
   */
  static getToolDefinitions() {
    return [
      SearchConversationHistoryTool.definition,
      GetConversationSegmentTool.definition,
      ListCompactionBoundariesTool.definition,
      RequestHistoricalContextTool.definition
    ];
  }

  /**
   * Search conversation history
   */
  async searchHistory(
    query: string,
    options: HistoricalContextOptions,
    searchOptions?: {
      maxResults?: number;
      timeRange?: { start: Date; end: Date };
      includeCompacted?: boolean;
    }
  ): Promise<HistoricalContext> {
    const startTime = Date.now();

    const results = await this.searchTool.execute(
      {
        query,
        maxResults: searchOptions?.maxResults,
        timeRange: searchOptions?.timeRange,
        includeCompacted: searchOptions?.includeCompacted
      },
      options.sessionId,
      options.recentMessages
    );

    const processingTime = Date.now() - startTime;

    return {
      type: 'search',
      content: results,
      metadata: {
        sourceCount: results.length,
        timeRange: this.extractTimeRange(results),
        processingTime
      }
    };
  }

  /**
   * Get a specific conversation segment
   */
  async getSegment(
    options: HistoricalContextOptions,
    segmentOptions: {
      turnRange?: { start: number; end: number };
      checkpointId?: string;
      format?: 'full' | 'summary' | 'compressed';
    }
  ): Promise<HistoricalContext> {
    const startTime = Date.now();

    const segment = await this.segmentTool.execute(
      segmentOptions,
      options.sessionId,
      options.recentMessages
    );

    const processingTime = Date.now() - startTime;

    return {
      type: 'segment',
      content: segment,
      metadata: {
        sourceCount: segment.metadata.messageCount,
        tokensUsed: segment.metadata.totalTokens,
        processingTime
      }
    };
  }

  /**
   * List all compaction boundaries
   */
  async listBoundaries(
    options: HistoricalContextOptions,
    includeMetadata: boolean = true
  ): Promise<HistoricalContext> {
    const startTime = Date.now();

    const boundaries = await this.boundariesTool.execute(
      { includeMetadata },
      options.sessionId
    );

    const processingTime = Date.now() - startTime;

    // Calculate total tokens saved
    const totalTokensSaved = boundaries.reduce(
      (sum, b) => sum + b.tokens.saved,
      0
    );

    return {
      type: 'boundaries',
      content: boundaries,
      metadata: {
        sourceCount: boundaries.length,
        tokensUsed: totalTokensSaved,
        processingTime
      }
    };
  }

  /**
   * Request historical context via helper model
   */
  async requestContext(
    query: string,
    options: HistoricalContextOptions,
    contextOptions?: {
      detailLevel?: 'brief' | 'standard' | 'detailed';
      maxTokens?: number;
      useHelperModel?: boolean;
    }
  ): Promise<HistoricalContext> {
    const startTime = Date.now();

    const result = await this.contextTool.execute(
      {
        query,
        detailLevel: contextOptions?.detailLevel,
        maxTokens: contextOptions?.maxTokens,
        useHelperModel: contextOptions?.useHelperModel
      },
      options.sessionId,
      options.recentMessages
    );

    const processingTime = Date.now() - startTime;

    return {
      type: 'context',
      content: result,
      metadata: {
        sourceCount: result.sources.length,
        tokensUsed: result.tokensUsed,
        modelUsed: result.modelUsed,
        processingTime
      }
    };
  }

  /**
   * Smart retrieval - automatically choose best tool based on query
   */
  async smartRetrieval(
    query: string,
    options: HistoricalContextOptions
  ): Promise<HistoricalContext> {
    const queryLower = query.toLowerCase();

    // Determine best tool based on query patterns
    if (queryLower.includes('boundary') || queryLower.includes('compaction') || queryLower.includes('summaries')) {
      return this.listBoundaries(options);
    }

    if (queryLower.includes('turn') || queryLower.includes('checkpoint') || queryLower.includes('segment')) {
      // Extract turn range if mentioned
      const turnMatch = query.match(/turns?\s+(\d+)(?:\s*-\s*(\d+))?/i);
      if (turnMatch && turnMatch[1]) {
        const start = parseInt(turnMatch[1]);
        const end = turnMatch[2] ? parseInt(turnMatch[2]) : start + 10;
        return this.getSegment(options, {
          turnRange: { start, end },
          format: 'summary'
        });
      }
    }

    if (queryLower.includes('search') || queryLower.includes('find') || queryLower.includes('when')) {
      return this.searchHistory(query, options);
    }

    // Default to requesting context via helper model
    return this.requestContext(query, options);
  }

  /**
   * Get comprehensive overview of conversation history
   */
  async getHistoryOverview(
    options: HistoricalContextOptions
  ): Promise<{
    totalMessages: number;
    compactionBoundaries: number;
    totalTokensSaved: number;
    oldestMessage: Date | null;
    newestMessage: Date | null;
    summary: string;
  }> {
    // Get boundaries
    const boundaries = await this.boundariesTool.execute(
      { includeMetadata: false },
      options.sessionId
    );

    // Calculate statistics
    const totalTokensSaved = boundaries.reduce(
      (sum, b) => sum + b.tokens.saved,
      0
    );

    // Get message timestamps
    const timestamps = options.recentMessages.map(m => new Date(m.timestamp));
    const oldestMessage = timestamps.length > 0 ? new Date(Math.min(...timestamps.map(d => d.getTime()))) : null;
    const newestMessage = timestamps.length > 0 ? new Date(Math.max(...timestamps.map(d => d.getTime()))) : null;

    // Generate summary
    const summary = `Conversation with ${options.recentMessages.length} messages` +
      ` and ${boundaries.length} compaction boundaries. ` +
      `${totalTokensSaved} tokens saved through compaction.`;

    return {
      totalMessages: options.recentMessages.length,
      compactionBoundaries: boundaries.length,
      totalTokensSaved,
      oldestMessage,
      newestMessage,
      summary
    };
  }

  /**
   * Execute a tool by name (for dynamic tool calling)
   */
  async executeTool(
    toolName: string,
    input: any,
    options: HistoricalContextOptions
  ): Promise<any> {
    switch (toolName) {
      case 'SearchConversationHistory':
        return this.searchTool.execute(input, options.sessionId, options.recentMessages);

      case 'GetConversationSegment':
        return this.segmentTool.execute(input, options.sessionId, options.recentMessages);

      case 'ListCompactionBoundaries':
        return this.boundariesTool.execute(input, options.sessionId);

      case 'RequestHistoricalContext':
        return this.contextTool.execute(input, options.sessionId, options.recentMessages);

      default:
        throw new Error(`Unknown historical tool: ${toolName}`);
    }
  }

  // ============================================
  // PRIVATE HELPER METHODS
  // ============================================

  /**
   * Extract time range from search results
   */
  private extractTimeRange(results: SearchResult[]): { start: Date; end: Date } | undefined {
    if (results.length === 0) {
      return undefined;
    }

    const timestamps = results.map(r => r.timestamp.getTime());
    return {
      start: new Date(Math.min(...timestamps)),
      end: new Date(Math.max(...timestamps))
    };
  }
}