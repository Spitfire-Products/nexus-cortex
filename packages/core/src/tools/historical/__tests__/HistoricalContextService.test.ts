/**
 * HistoricalContextService Tests
 * Phase 1.5: Week 3 Implementation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoricalContextService } from '../HistoricalContextService.js';
import type { CanonicalMessage } from '../../../session/MessageTypes.js';
import { StoredCompactionManager } from '../../../conversation/StoredCompactionManager.js';

// No mocks - tests use real implementations or skip when data unavailable
// Real API integration tests are in smoke/ directory

describe('HistoricalContextService', () => {
  let service: HistoricalContextService;
  let mockMessages: CanonicalMessage[];
  const sessionId = 'test-session-123';

  beforeEach(() => {
    vi.clearAllMocks();
    service = new HistoricalContextService();

    mockMessages = [
      {
        id: 'msg-1',
        role: 'user',
        content: 'What is React?',
        timestamp: new Date('2024-01-01T10:00:00Z').toISOString()
      },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'React is a JavaScript library for building user interfaces.',
        timestamp: new Date('2024-01-01T10:01:00Z').toISOString()
      }
    ] as CanonicalMessage[];

    vi.clearAllMocks();
  });

  describe('Tool Definitions', () => {
    it('should provide all 4 tool definitions', () => {
      const definitions = HistoricalContextService.getToolDefinitions();

      expect(definitions).toHaveLength(4);
      expect(definitions[0].name).toBe('SearchConversationHistory');
      expect(definitions[1].name).toBe('GetConversationSegment');
      expect(definitions[2].name).toBe('ListCompactionBoundaries');
      expect(definitions[3].name).toBe('RequestHistoricalContext');
    });
  });

  describe('Search History', () => {
    it('should search history and return formatted context', async () => {

      const result = await service.searchHistory('React', {
        sessionId,
        recentMessages: mockMessages
      });

      expect(result.type).toBe('search');
      expect(result.metadata.sourceCount).toBeGreaterThan(0);
      // Modern hardware can complete the search in <1ms (reports 0 via Date.now diff).
      // Assert non-negative rather than strictly positive.
      expect(result.metadata.processingTime).toBeGreaterThanOrEqual(0);
    });

    it('should pass search options correctly', async () => {

      const result = await service.searchHistory(
        'React',
        {
          sessionId,
          recentMessages: mockMessages
        },
        {
          maxResults: 5,
          includeCompacted: false
        }
      );

      expect(result.type).toBe('search');
    });
  });

  describe('Get Segment', () => {
    it('should retrieve conversation segment', async () => {
      const result = await service.getSegment(
        {
          sessionId,
          recentMessages: mockMessages
        },
        {
          turnRange: { start: 1, end: 2 },
          format: 'summary'
        }
      );

      expect(result.type).toBe('segment');
      expect(result.metadata.sourceCount).toBe(2);
    });

    it('should handle checkpoint-based retrieval', async () => {
      const result = await service.getSegment(
        {
          sessionId,
          recentMessages: mockMessages
        },
        {
          checkpointId: 'checkpoint-123',
          format: 'full'
        }
      );

      expect(result.type).toBe('segment');
    });
  });

  describe('List Boundaries', () => {
    it('should list compaction boundaries', async () => {
      // Test works with real compaction data or returns empty boundaries
      // No mock - real StoredCompactionManager is used
      const result = await service.listBoundaries({
        sessionId,
        recentMessages: mockMessages
      });

      expect(result.type).toBe('boundaries');
      expect(result.metadata.sourceCount).toBeGreaterThanOrEqual(0);
      // If real compaction data exists, sourceCount > 0
      // Otherwise, sourceCount === 0 (no boundaries found)
    });
  });

  describe('Request Context', () => {
    it('should request historical context', async () => {

      const result = await service.requestContext(
        'What did we discuss about React?',
        {
          sessionId,
          recentMessages: mockMessages
        },
        {
          detailLevel: 'standard',
          maxTokens: 500
        }
      );

      expect(result.type).toBe('context');
      expect(result.metadata).toHaveProperty('tokensUsed');
      expect(result.metadata).toHaveProperty('modelUsed');
    });
  });

  describe('Smart Retrieval', () => {
    it('should choose search for search queries', async () => {

      const result = await service.smartRetrieval(
        'search for React components',
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(result.type).toBe('search');
    });

    it('should choose boundaries for compaction queries', async () => {

      const result = await service.smartRetrieval(
        'show me the compaction boundaries',
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(result.type).toBe('boundaries');
    });

    it('should choose segment for turn-based queries', async () => {
      const result = await service.smartRetrieval(
        'show me turns 5-10',
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(result.type).toBe('segment');
    });

    it('should default to context for general queries', async () => {

      const result = await service.smartRetrieval(
        'what have we been discussing?',
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(result.type).toBe('context');
    });
  });

  describe('History Overview', () => {
    it('should provide comprehensive history overview', async () => {
      // Test works with real compaction data or returns minimal overview
      // No mock - real StoredCompactionManager is used
      const overview = await service.getHistoryOverview({
        sessionId,
        recentMessages: mockMessages
      });

      expect(overview.totalMessages).toBe(2);
      expect(overview.compactionBoundaries).toBeGreaterThanOrEqual(0);
      expect(overview.totalTokensSaved).toBeGreaterThanOrEqual(0);
      expect(overview.oldestMessage).toBeDefined();
      expect(overview.newestMessage).toBeDefined();
      expect(overview.summary).toContain('2 messages');
    });
  });

  describe('Execute Tool', () => {
    it('should execute SearchConversationHistory by name', async () => {

      const result = await service.executeTool(
        'SearchConversationHistory',
        { query: 'React' },
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(Array.isArray(result)).toBe(true);
    });

    it('should execute GetConversationSegment by name', async () => {
      const result = await service.executeTool(
        'GetConversationSegment',
        { turnRange: { start: 1, end: 2 } },
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(result).toHaveProperty('metadata');
    });

    it('should execute ListCompactionBoundaries by name', async () => {

      const result = await service.executeTool(
        'ListCompactionBoundaries',
        { includeMetadata: true },
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(Array.isArray(result)).toBe(true);
    });

    it('should execute RequestHistoricalContext by name', async () => {

      const result = await service.executeTool(
        'RequestHistoricalContext',
        { query: 'What about React?' },
        {
          sessionId,
          recentMessages: mockMessages
        }
      );

      expect(result).toHaveProperty('context');
    });

    it('should throw error for unknown tool', async () => {
      await expect(
        service.executeTool(
          'UnknownTool',
          {},
          {
            sessionId,
            recentMessages: mockMessages
          }
        )
      ).rejects.toThrow('Unknown historical tool: UnknownTool');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty message array', async () => {

      const overview = await service.getHistoryOverview({
        sessionId,
        recentMessages: []
      });

      expect(overview.totalMessages).toBe(0);
      expect(overview.oldestMessage).toBeNull();
      expect(overview.newestMessage).toBeNull();
    });

    it('should handle workspace root configuration', () => {
      const serviceWithRoot = new HistoricalContextService('/custom/workspace');
      expect(serviceWithRoot).toBeDefined();
    });
  });
});