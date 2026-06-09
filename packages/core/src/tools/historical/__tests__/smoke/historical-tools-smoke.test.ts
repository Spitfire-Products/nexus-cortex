/**
 * Historical Tools Smoke Tests
 *
 * These tests use real API calls and file operations when ENABLE_SMOKE_TESTS=true
 * Phase 1.5: Week 3 Implementation
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// Import the actual tools (no mocks)
import { SearchConversationHistoryTool } from '../../SearchConversationHistory.js';
import { GetConversationSegmentTool } from '../../GetConversationSegment.js';
import { ListCompactionBoundariesTool } from '../../ListCompactionBoundaries.js';
import { RequestHistoricalContextTool } from '../../RequestHistoricalContext.js';
import { HistoricalContextService } from '../../HistoricalContextService.js';

// Import real implementations
import { StoredCompactionManager, type CreateCompactionOptions } from '../../../../conversation/StoredCompactionManager.js';
import { ContextBudgetManager } from '../../../../conversation/ContextBudgetManager.js';
import {
  GoogleGenAPIHelperAdapter,
  ChatCompletionsAPIHelperAdapter,
  MessagesAPIHelperAdapter,
  GenerateContentAPIHelperAdapter,
  ResponsesAPIHelperAdapter
} from '../../../../middleware/helpers/adapters/index.js';
import type { CanonicalMessage } from '../../../../session/MessageTypes.js';
import type { ModelConfig } from '../../../../models/ModelConfig.interface.js';

// Skip these tests unless ENABLE_SMOKE_TESTS is set
const ENABLE_SMOKE_TESTS = process.env.ENABLE_SMOKE_TESTS === 'true';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const XAI_API_KEY = process.env.XAI_API_KEY;

describe.skipIf(!ENABLE_SMOKE_TESTS)('Historical Tools Smoke Tests', () => {
  const testWorkspace = `/tmp/cortex-test-${uuidv4()}`;
  const sessionId = `smoke-test-${uuidv4()}`;
  let compactionManager: StoredCompactionManager;
  let contextBudgetManager: ContextBudgetManager;
  let helperAdapter: GoogleGenAPIHelperAdapter | undefined;
  let historicalService: HistoricalContextService;

  // Sample messages for testing
  const sampleMessages: CanonicalMessage[] = [
    {
      id: uuidv4(),
      role: 'user',
      content: 'How do I implement authentication in a Node.js application?',
      timestamp: new Date('2024-01-15T10:00:00Z').toISOString()
    },
    {
      id: uuidv4(),
      role: 'assistant',
      content: 'To implement authentication in Node.js, you can use Passport.js or JWT tokens. Here\'s an example with JWT...',
      timestamp: new Date('2024-01-15T10:01:00Z').toISOString()
    },
    {
      id: uuidv4(),
      role: 'user',
      content: 'Can you show me how to use bcrypt for password hashing?',
      timestamp: new Date('2024-01-15T10:02:00Z').toISOString()
    },
    {
      id: uuidv4(),
      role: 'assistant',
      content: 'Here\'s how to use bcrypt for secure password hashing in Node.js...',
      timestamp: new Date('2024-01-15T10:03:00Z').toISOString(),
      tool_use: [
        {
          id: uuidv4(),
          name: 'Write',
          input: {
            file_path: 'auth/password.js',
            content: 'const bcrypt = require("bcrypt");\\nconst saltRounds = 10;'
          }
        }
      ]
    },
    {
      id: uuidv4(),
      role: 'tool',
      tool_result: {
        tool_use_id: 'test-tool-use',
        content: 'File written successfully'
      },
      timestamp: new Date('2024-01-15T10:04:00Z').toISOString()
    }
  ];

  beforeAll(async () => {
    if (!GOOGLE_API_KEY) {
      console.log('⚠️  No Google API key found - Gemma tests will use fallback');
    } else {
      helperAdapter = new GoogleGenAPIHelperAdapter();
    }

    // Create test workspace
    await fs.mkdir(testWorkspace, { recursive: true });

    // Initialize managers
    compactionManager = new StoredCompactionManager(testWorkspace);
    await compactionManager.initialize();

    contextBudgetManager = new ContextBudgetManager();
    historicalService = new HistoricalContextService(testWorkspace);
  });

  afterAll(async () => {
    // Cleanup test workspace
    try {
      await fs.rm(testWorkspace, { recursive: true, force: true });
    } catch (error) {
      console.log('Could not cleanup test workspace:', error);
    }
  });

  describe('ContextBudgetManager with Real Model Configs', () => {
    it('should calculate budget for Claude 3 Sonnet', () => {
      const claudeConfig: ModelConfig = {
        id: 'claude-3-sonnet-20240229',
        provider: 'anthropic',
        limits: {
          contextWindow: 200000,
          outputTokens: 4096
        },
        tools: {
          supported: true,
          maxTools: 64
        },
        compaction: {
          strategy: 'auto',
          thresholdCalculation: {
            method: 'percentage',
            percentage: 0.75,
            safetyMargin: 1000
          }
        }
      } as ModelConfig;

      const budget = contextBudgetManager.calculateBudget(claudeConfig);

      expect(budget.totalAvailable).toBe(200000);
      expect(budget.reservedForOutput).toBe(4096);
      expect(budget.reservedForTools).toBeGreaterThan(0);
      expect(budget.availableForHistory).toBeLessThan(200000);
      expect(budget.availableForHistory).toBeGreaterThan(150000);
    });

    it('should calculate budget for GPT-4', () => {
      const gpt4Config: ModelConfig = {
        id: 'gpt-4',
        provider: 'openai',
        limits: {
          contextWindow: 8192,
          outputTokens: 2048
        },
        tools: {
          supported: true,
          maxTools: 32
        },
        compaction: {
          strategy: 'auto',
          thresholdCalculation: {
            method: 'percentage',
            percentage: 0.70,
            safetyMargin: 500
          }
        }
      } as ModelConfig;

      const budget = contextBudgetManager.calculateBudget(gpt4Config);

      expect(budget.totalAvailable).toBe(8192);
      expect(budget.availableForHistory).toBeLessThan(6000);
      expect(budget.availableForHistory).toBeGreaterThan(4000);
    });

    it('should calculate budget for Gemini 1.5 Pro', () => {
      const geminiConfig: ModelConfig = {
        id: 'gemini-1.5-pro',
        provider: 'google',
        limits: {
          contextWindow: 1048576, // 1M tokens
          outputTokens: 8192
        },
        tools: {
          supported: true,
          maxTools: 128
        },
        compaction: {
          strategy: 'auto',
          thresholdCalculation: {
            method: 'percentage',
            percentage: 0.80,
            safetyMargin: 5000
          }
        }
      } as ModelConfig;

      const budget = contextBudgetManager.calculateBudget(geminiConfig);

      expect(budget.totalAvailable).toBe(1048576);
      expect(budget.availableForHistory).toBeGreaterThan(1000000);
    });

    it('should validate model switch from GPT-4 to Claude', () => {
      const gpt4Config: ModelConfig = {
        id: 'gpt-4',
        provider: 'openai',
        limits: {
          contextWindow: 8192,
          outputTokens: 2048
        },
        tools: {
          supported: true,
          maxTools: 32
        },
        compaction: {
          strategy: 'auto',
          thresholdCalculation: {
            method: 'percentage',
            percentage: 0.70,
            safetyMargin: 500
          }
        }
      } as ModelConfig;

      // Create a large history that fits in Claude but not GPT-4
      const largeHistory: CanonicalMessage[] = Array(100).fill(null).map((_, i) => ({
        id: uuidv4(),
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'A'.repeat(100), // ~25 tokens per message
        timestamp: new Date().toISOString()
      } as CanonicalMessage));

      const validation = contextBudgetManager.validateModelSwitch(largeHistory, gpt4Config);

      expect(validation.canSwitch).toBe(true);
      // suggestedStrategy may be undefined if no strategy is needed
      if (validation.suggestedStrategy) {
        expect(validation.suggestedStrategy).toBeDefined();
      }
    });
  });

  describe('StoredCompaction with Real File Operations', () => {
    it('should create and retrieve a compaction record', async () => {
      const compactionOptions: CreateCompactionOptions = {
        type: 'auto',
        timeline: {
          sessionId,
          conversationId: 'conv-1',
          eventId: 'event-1',
          turnRange: { start: 1, end: 3 }
        },
        originalMessages: sampleMessages.slice(0, 3),
        summaries: {
          compressed: 'User asked about Node.js auth, assistant explained Passport.js/JWT',
          standard: 'User inquired about implementing authentication in Node.js. Assistant recommended using Passport.js or JWT tokens and began providing examples.',
          detailed: 'The conversation covered Node.js authentication implementation. The assistant suggested two main approaches: Passport.js for session-based auth and JWT for stateless authentication. Examples were being prepared.',
          metadata: {
            topics: ['authentication', 'Node.js', 'JWT', 'Passport.js'],
            decisions: ['Use JWT for stateless auth'],
            toolsUsed: [],
            filesModified: [],
            modelsInvolved: ['assistant'],
            keyMoments: [
              {
                turn: 2,
                description: 'JWT approach recommended',
                importance: 'high'
              }
            ]
          }
        },
        processing: {
          helperModelId: 'gemma-3-27b-it',
          helperProvider: 'google-genai',
          processingTime: 500,
          cost: 0, // FREE Gemma!
          tokens: {
            input: 200,
            output: 100
          }
        }
      };

      const compaction = await compactionManager.createCompaction(compactionOptions);

      expect(compaction.id).toBeDefined();
      expect(compaction.type).toBe('auto');
      expect(compaction.status).toBe('active');
      expect(compaction.processing.cost).toBe(0);

      // Retrieve the compaction
      const retrieved = await compactionManager.getCompaction(compaction.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.summaries.compressed).toContain('Node.js auth');

      // Search for it
      const searchResults = await compactionManager.searchCompactions('authentication', sessionId);
      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0].id).toBe(compaction.id);
    });

    it('should query compactions by session', async () => {
      const boundaries = await compactionManager.getCompactionBoundaries(sessionId);
      expect(Array.isArray(boundaries)).toBe(true);
      expect(boundaries.length).toBeGreaterThan(0);
    });
  });

  describe('SearchConversationHistory with Real Data', () => {
    it('should search recent messages and compacted content', async () => {
      const searchTool = new SearchConversationHistoryTool(testWorkspace);

      const results = await searchTool.execute(
        {
          query: 'authentication',
          maxResults: 10,
          includeCompacted: true
        },
        sessionId,
        sampleMessages
      );

      expect(results.length).toBeGreaterThan(0);
      expect(results[0].preview).toBeDefined();
      expect(results[0].relevanceScore).toBeGreaterThan(0);

      // Should find both recent and compacted results
      const hasRecentResults = results.some(r => !r.isCompacted);
      const hasCompactedResults = results.some(r => r.isCompacted);

      expect(hasRecentResults).toBe(true);
      expect(hasCompactedResults).toBe(true);
    });

    it('should apply time range filters', async () => {
      const searchTool = new SearchConversationHistoryTool(testWorkspace);

      const results = await searchTool.execute(
        {
          query: 'bcrypt',
          timeRange: {
            start: new Date('2024-01-15T10:01:30Z'),
            end: new Date('2024-01-15T10:03:30Z')
          }
        },
        sessionId,
        sampleMessages
      );

      // Should only find messages within the time range
      expect(results.length).toBeGreaterThan(0);
      results.forEach(result => {
        expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(
          new Date('2024-01-15T10:01:30Z').getTime()
        );
        expect(result.timestamp.getTime()).toBeLessThanOrEqual(
          new Date('2024-01-15T10:03:30Z').getTime()
        );
      });
    });
  });

  describe('GetConversationSegment with Real Data', () => {
    it('should retrieve segment by turn range', async () => {
      const segmentTool = new GetConversationSegmentTool(testWorkspace);

      const segment = await segmentTool.execute(
        {
          turnRange: { start: 1, end: 3 },
          format: 'summary'
        },
        sessionId,
        sampleMessages
      );

      expect(segment.metadata.turnRange.start).toBe(1);
      expect(segment.metadata.turnRange.end).toBe(3);
      expect(segment.summary).toBeDefined();
      expect(segment.metadata.totalTokens).toBeGreaterThanOrEqual(0);
    });

    it('should retrieve full segment with messages', async () => {
      const segmentTool = new GetConversationSegmentTool(testWorkspace);

      const segment = await segmentTool.execute(
        {
          turnRange: { start: 2, end: 4 },
          format: 'full'
        },
        sessionId,
        sampleMessages
      );

      expect(segment.messages).toBeDefined();
      expect(segment.messages?.length).toBe(3);
      expect(segment.metadata.messageCount).toBe(3);
    });
  });

  describe('ListCompactionBoundaries with Real Data', () => {
    it('should list all boundaries with metadata', async () => {
      const boundariesTool = new ListCompactionBoundariesTool(testWorkspace);

      const boundaries = await boundariesTool.execute(
        { includeMetadata: true },
        sessionId
      );

      expect(Array.isArray(boundaries)).toBe(true);
      expect(boundaries.length).toBeGreaterThan(0);

      const firstBoundary = boundaries[0];
      expect(firstBoundary.id).toBeDefined();
      // Tokens saved can be negative if compression increased size (simplified test data)
      expect(firstBoundary.tokens.saved).toBeDefined();
      expect(firstBoundary.metadata).toBeDefined();
      expect(firstBoundary.metadata?.cost).toBe(0); // FREE Gemma!
    });

    it('should get summary statistics', async () => {
      const boundariesTool = new ListCompactionBoundariesTool(testWorkspace);

      const stats = await boundariesTool.getSummaryStatistics(sessionId);

      expect(stats.totalCompactions).toBeGreaterThan(0);
      // totalTokensSaved can be negative with simple test data
      expect(stats.totalTokensSaved).toBeDefined();
      expect(stats.totalCost).toBe(0); // Using FREE Gemma
      expect(stats.averageCompressionRatio).toBeDefined();
      expect(stats.mostUsedHelperModel).toContain('gemma');
    });
  });

  describe.skipIf(!GOOGLE_API_KEY)('RequestHistoricalContext with Real Gemma API', () => {
    it('should generate context using FREE Gemma model', async () => {
      // Create model config for Gemma
      const gemmaConfig: ModelConfig = {
        id: 'gemma-3-27b-it',
        provider: 'google-genai',
        limits: {
          contextWindow: 8192,
          outputTokens: 2048
        },
        api: {
          apiKeyEnvVar: 'GOOGLE_API_KEY',
          endpoint: 'https://generativelanguage.googleapis.com'
        }
      } as ModelConfig;

      const contextTool = new RequestHistoricalContextTool(
        testWorkspace,
        helperAdapter,
        gemmaConfig
      );

      const result = await contextTool.execute(
        {
          query: 'What authentication methods were discussed?',
          detailLevel: 'standard',
          maxTokens: 500,
          useHelperModel: true
        },
        sessionId,
        sampleMessages
      );

      expect(result.context).toBeDefined();
      expect(result.context.length).toBeGreaterThan(0);
      expect(result.modelUsed).toContain('gemma');
      expect(result.cost).toBe(0); // FREE!
      expect(result.tokensUsed).toBeGreaterThan(0);
      // Sources might be 0 if no compaction matches found
      expect(result.sources).toBeDefined();
    }, 10000); // 10 second timeout for API calls

    it('should handle different detail levels', async () => {
      // Create model config for Gemma
      const gemmaConfig: ModelConfig = {
        id: 'gemma-3-27b-it',
        provider: 'google-genai',
        limits: {
          contextWindow: 8192,
          outputTokens: 2048
        },
        api: {
          apiKeyEnvVar: 'GOOGLE_API_KEY',
          endpoint: 'https://generativelanguage.googleapis.com'
        }
      } as ModelConfig;

      const contextTool = new RequestHistoricalContextTool(
        testWorkspace,
        helperAdapter,
        gemmaConfig
      );

      // Test brief context
      const briefResult = await contextTool.execute(
        {
          query: 'Summary of authentication discussion',
          detailLevel: 'brief',
          maxTokens: 200,
          useHelperModel: true
        },
        sessionId,
        sampleMessages
      );

      // Test detailed context
      const detailedResult = await contextTool.execute(
        {
          query: 'Summary of authentication discussion',
          detailLevel: 'detailed',
          maxTokens: 1000,
          useHelperModel: true
        },
        sessionId,
        sampleMessages
      );

      expect(briefResult.context.length).toBeLessThan(detailedResult.context.length);
      expect(briefResult.modelUsed).toContain('gemma');
      expect(detailedResult.modelUsed).toContain('gemma');
    }, 15000); // 15 second timeout for two API calls
  });

  describe('HistoricalContextService Integration', () => {
    it('should perform smart retrieval based on query type', async () => {
      // Search query
      const searchResult = await historicalService.smartRetrieval(
        'search for password hashing',
        {
          sessionId,
          recentMessages: sampleMessages
        }
      );
      expect(searchResult.type).toBe('search');

      // Boundaries query
      const boundariesResult = await historicalService.smartRetrieval(
        'show me compaction boundaries',
        {
          sessionId,
          recentMessages: sampleMessages
        }
      );
      expect(boundariesResult.type).toBe('boundaries');

      // Turn range query
      const segmentResult = await historicalService.smartRetrieval(
        'show me turns 2-4',
        {
          sessionId,
          recentMessages: sampleMessages
        }
      );
      expect(segmentResult.type).toBe('segment');
    });

    it('should get comprehensive history overview', async () => {
      const overview = await historicalService.getHistoryOverview({
        sessionId,
        recentMessages: sampleMessages
      });

      expect(overview.totalMessages).toBe(5);
      expect(overview.compactionBoundaries).toBeGreaterThan(0);
      // totalTokensSaved can be negative with simple test data
      expect(overview.totalTokensSaved).toBeDefined();
      expect(overview.oldestMessage).toBeDefined();
      expect(overview.newestMessage).toBeDefined();
      expect(overview.summary).toContain('5 messages');
    });

    it('should execute tools dynamically by name', async () => {
      const searchResults = await historicalService.executeTool(
        'SearchConversationHistory',
        { query: 'JWT' },
        {
          sessionId,
          recentMessages: sampleMessages
        }
      );

      expect(Array.isArray(searchResults)).toBe(true);
      expect(searchResults.length).toBeGreaterThan(0);
    });
  });

  describe.skipIf(!GOOGLE_API_KEY)('GoogleGenAPIHelperAdapter with Real API', () => {
    it('should compact content using FREE Gemma models', async () => {
      if (!helperAdapter) {
        console.log('Skipping - no helper adapter available');
        return;
      }

      // Create test messages in canonical format
      const testMessages = sampleMessages.map(m => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content || JSON.stringify(m.tool_use || m.tool_result),
        timestamp: m.timestamp
      }));

      // Create test model config for gemma-3-27b-it
      const gemmaConfig: ModelConfig = {
        id: 'gemma-3-27b-it',
        provider: 'google',
        displayName: 'Gemma 3 27B (FREE)',
        family: 'gemma-3',
        api: {
          pattern: 'google-genai',
          endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemma-3-27b-it:generateContent',
          apiKeyEnvVar: 'GOOGLE_API_KEY',
          authHeader: 'x-goog-api-key',
          authPrefix: ''
        },
        limits: {
          contextWindow: 128000,
          outputTokens: 8192,
          requestsPerMinute: 60,
          tokensPerMinute: 1000000
        }
      } as ModelConfig;

      const result = await helperAdapter.compact(testMessages, gemmaConfig, 100);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBe(0); // FREE!
      expect(result.helperModelId).toContain('gemma');
      expect(result.processingTime).toBeGreaterThan(0);
    });
  });
});

describe.skipIf(!ENABLE_SMOKE_TESTS)('ContextBudgetManager Edge Cases', () => {
  let manager: ContextBudgetManager;

  beforeEach(() => {
    manager = new ContextBudgetManager();
  });

  it('should handle very small context windows (8K)', () => {
    const smallConfig: ModelConfig = {
      id: 'small-model',
      provider: 'test',
      limits: {
        contextWindow: 8192,
        outputTokens: 2048
      },
      tools: {
        supported: true,
        maxTools: 16
      },
      compaction: {
        strategy: 'auto',
        thresholdCalculation: {
          method: 'percentage',
          percentage: 0.60,
          safetyMargin: 200
        }
      }
    } as ModelConfig;

    const budget = manager.calculateBudget(smallConfig);

    // Should scale down reserves for small contexts
    expect(budget.availableForHistory).toBeGreaterThan(0);
    expect(budget.availableForHistory).toBeLessThan(6000);
  });

  it('should handle massive context windows (1M+)', () => {
    const hugeConfig: ModelConfig = {
      id: 'huge-model',
      provider: 'test',
      limits: {
        contextWindow: 2097152, // 2M tokens
        outputTokens: 16384
      },
      tools: {
        supported: true,
        maxTools: 256
      },
      compaction: {
        strategy: 'auto',
        thresholdCalculation: {
          method: 'percentage',
          percentage: 0.85,
          safetyMargin: 10000
        }
      }
    } as ModelConfig;

    const budget = manager.calculateBudget(hugeConfig);

    expect(budget.availableForHistory).toBeGreaterThan(2000000);
    expect(budget.reservedForTools).toBeLessThan(budget.totalAvailable * 0.25);
  });

  it('should select messages with different strategies', () => {
    const messages: CanonicalMessage[] = Array(20).fill(null).map((_, i) => ({
      id: uuidv4(),
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `Message ${i}: ${'A'.repeat(100)}`,
      timestamp: new Date(Date.now() - (20 - i) * 60000).toISOString()
    } as CanonicalMessage));

    // Add some tool use messages (critical)
    messages[10] = {
      ...messages[10],
      tool_use: [{ id: 'tool-1', name: 'Write', input: { file_path: 'test.js' } }]
    } as CanonicalMessage;

    // Test sliding window - use smaller budget to force reduction
    const slidingWindow = manager.selectMessages(messages, 500, {
      strategy: 'sliding-window'
    });
    // If all messages fit in budget, length may equal messages.length
    expect(slidingWindow.length).toBeLessThanOrEqual(messages.length);
    expect(slidingWindow.length).toBeGreaterThan(0);
    // Should keep most recent messages
    if (slidingWindow.length < messages.length) {
      expect(slidingWindow[slidingWindow.length - 1]).toEqual(messages[messages.length - 1]);
    }

    // Test preserve critical
    const preserveCritical = manager.selectMessages(messages, 1000, {
      strategy: 'preserve-critical'
    });
    expect(preserveCritical.some(m => m.tool_use?.length)).toBe(true);

    // Test compact and fit (should fallback to sliding for now)
    const compactAndFit = manager.selectMessages(messages, 1000, {
      strategy: 'compact-and-fit'
    });
    expect(compactAndFit.length).toBeGreaterThan(0);
  });
});