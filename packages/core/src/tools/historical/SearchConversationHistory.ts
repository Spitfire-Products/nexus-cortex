/**
 * SearchConversationHistory Tool
 *
 * Searches conversation history including both recent messages and compacted boundaries.
 * Provides semantic search across the full conversation timeline.
 *
 * Phase 1.5: Week 3 Implementation
 * Based on: CORTEX_V4_PHASE_1.5_ARCHITECTURE.md, Part 4
 */

import type { Message } from '../../session/MessageTypes.js';
import { isSystemMessage } from '../../session/MessageTypes.js';
import { StoredCompactionManager } from '../../conversation/StoredCompactionManager.js';

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
 * Tool for searching conversation history
 */
export class SearchConversationHistoryTool {
  private compactionManager: StoredCompactionManager;

  constructor(workspaceRoot?: string) {
    this.compactionManager = new StoredCompactionManager(workspaceRoot);
  }

  /**
   * Tool definition for registration
   */
  static get definition() {
    return {
      name: 'SearchConversationHistory',
      description: 'Search through conversation history including compacted boundaries',
      input_schema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query string'
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of results to return',
            default: 10
          },
          timeRange: {
            type: 'object',
            properties: {
              start: { type: 'string', format: 'date-time' },
              end: { type: 'string', format: 'date-time' }
            },
            description: 'Optional time range filter'
          },
          includeCompacted: {
            type: 'boolean',
            description: 'Include compacted messages in search',
            default: true
          }
        },
        required: ['query']
      }
    };
  }

  /**
   * Execute the search
   */
  async execute(
    input: SearchConversationHistoryInput,
    sessionId: string,
    recentMessages: Message[]
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const queryLower = input.query.toLowerCase();
    const maxResults = input.maxResults || 10;

    // Search recent uncompacted messages
    const recentResults = this.searchRecentMessages(
      recentMessages,
      queryLower,
      input.timeRange,
      sessionId
    );
    results.push(...recentResults);

    // Search compacted boundaries if requested
    if (input.includeCompacted !== false) {
      const compactedResults = await this.searchCompactedMessages(
        sessionId,
        queryLower,
        input.timeRange
      );
      results.push(...compactedResults);
    }

    // Sort by relevance score and timestamp
    results.sort((a, b) => {
      if (Math.abs(a.relevanceScore - b.relevanceScore) > 10) {
        return b.relevanceScore - a.relevanceScore;
      }
      return b.timestamp.getTime() - a.timestamp.getTime();
    });

    // Return top N results
    return results.slice(0, maxResults);
  }

  /**
   * Search recent uncompacted messages
   */
  private searchRecentMessages(
    messages: Message[],
    queryLower: string,
    timeRange?: { start: Date; end: Date },
    sessionId?: string
  ): SearchResult[] {
    const results: SearchResult[] = [];

    messages.forEach((message, index) => {
      // Apply time range filter
      if (timeRange) {
        const messageTime = new Date(message.timestamp);
        if (messageTime < timeRange.start || messageTime > timeRange.end) {
          return;
        }
      }

      // Calculate relevance score
      let score = 0;
      let matchedContent = '';

      // Search in message content
      const content = this.extractMessageContent(message);
      if (content && content.toLowerCase().includes(queryLower)) {
        score += 50;
        matchedContent = this.extractPreview(content, queryLower);
      }

      if (score > 0) {
        // Extract source session ID from tagged message (for cross-session search)
        // or fall back to timeline.sessionId or provided sessionId
        const sourceSessionId = (message as any)._sourceSessionId
          || (message as any).timeline?.sessionId
          || sessionId
          || 'unknown';

        results.push({
          sessionId: sourceSessionId,
          turnNumber: index + 1,
          timestamp: new Date(message.timestamp),
          preview: matchedContent,
          relevanceScore: Math.min(100, score),
          isCompacted: false,
          messageId: (message as any).uuid || (message as any).id
        });
      }
    });

    return results;
  }

  /**
   * Search compacted messages
   */
  private async searchCompactedMessages(
    sessionId: string,
    queryLower: string,
    timeRange?: { start: Date; end: Date }
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Query compactions for this session
    const compactions = await this.compactionManager.searchCompactions(
      queryLower,
      sessionId
    );

    for (const compaction of compactions) {
      // Apply time range filter
      if (timeRange) {
        const compactionTime = new Date(compaction.timestamp);
        if (compactionTime < timeRange.start || compactionTime > timeRange.end) {
          continue;
        }
      }

      // Calculate relevance based on where match was found
      let score = 0;
      let preview = '';

      // Check compressed summary
      if (compaction.summaries.compressed.toLowerCase().includes(queryLower)) {
        score += 30;
        preview = this.extractPreview(compaction.summaries.compressed, queryLower);
      }

      // Check standard summary
      if (compaction.summaries.standard.toLowerCase().includes(queryLower)) {
        score += 40;
        if (!preview) {
          preview = this.extractPreview(compaction.summaries.standard, queryLower);
        }
      }

      // Check detailed summary
      if (compaction.summaries.detailed.toLowerCase().includes(queryLower)) {
        score += 20;
        if (!preview) {
          preview = this.extractPreview(compaction.summaries.detailed, queryLower);
        }
      }

      // Check metadata
      const metadata = compaction.summaries.metadata;
      if (metadata.topics.some(t => t.toLowerCase().includes(queryLower))) {
        score += 50;
        if (!preview) {
          preview = `Topic: ${metadata.topics.find(t =>
            t.toLowerCase().includes(queryLower)
          )}`;
        }
      }

      if (score > 0) {
        // Add result for the compaction boundary
        results.push({
          sessionId: sessionId,
          turnNumber: compaction.timeline.turnRange.start,
          timestamp: new Date(compaction.timestamp),
          preview: preview || compaction.summaries.compressed.substring(0, 150),
          relevanceScore: Math.min(100, score),
          isCompacted: true,
          compactionId: compaction.id
        });
      }
    }

    return results;
  }

  /**
   * Extract content from any message type
   * Combines all searchable content (content + tool_use + tool_result)
   */
  private extractMessageContent(msg: Message): string {
    const msgAny = msg as any;
    const parts: string[] = [];

    // Handle flat content (CanonicalMessage, test fixtures)
    if (msgAny.content && typeof msgAny.content === 'string') {
      parts.push(msgAny.content);
    }

    // Handle SystemMessage
    if (isSystemMessage(msg) && msg.content) {
      parts.push(msg.content);
    }

    // Handle nested message.content (real Message types)
    if ('message' in msg && msg.message.content) {
      if (typeof msg.message.content === 'string') {
        parts.push(msg.message.content);
      } else {
        parts.push(JSON.stringify(msg.message.content));
      }
    }

    // Handle tool_use - ALWAYS include if present
    if (msgAny.tool_use) {
      parts.push(JSON.stringify(msgAny.tool_use));
    }

    // Handle tool_result - ALWAYS include if present
    if (msgAny.tool_result) {
      parts.push(JSON.stringify(msgAny.tool_result));
    }

    // Combine all parts with space separator
    return parts.join(' ');
  }

  /**
   * Extract a preview around the matched query
   */
  private extractPreview(content: string, query: string, maxLength: number = 150): string {
    const index = content.toLowerCase().indexOf(query);
    if (index === -1) {
      return content.substring(0, maxLength);
    }

    // Get context around the match
    const start = Math.max(0, index - 50);
    const end = Math.min(content.length, index + query.length + 50);

    let preview = content.substring(start, end);

    // Add ellipsis if truncated
    if (start > 0) preview = '...' + preview;
    if (end < content.length) preview = preview + '...';

    return preview;
  }
}