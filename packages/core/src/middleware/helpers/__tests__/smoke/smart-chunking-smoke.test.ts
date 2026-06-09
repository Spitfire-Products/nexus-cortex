/**
 * Smart Chunking Smoke Tests
 *
 * Tests smart chunking with REAL API calls to verify:
 * - Dynamic chunking based on model context limits
 * - Cross-provider helper model support
 * - Large content handling
 *
 * Run with: ENABLE_SMOKE_TESTS=true npm test -- smart-chunking-smoke
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  GoogleGenAPIHelperAdapter,
  ChatCompletionsAPIHelperAdapter,
  MessagesAPIHelperAdapter
} from '../../adapters/index.js';
import type { ModelConfig } from '../../../../models/ModelConfig.interface.js';
import type { HelperCanonicalMessage } from '../../HelperMiddlewareAdapter.interface.js';

// Skip these tests unless ENABLE_SMOKE_TESTS is set
const ENABLE_SMOKE_TESTS = process.env.ENABLE_SMOKE_TESTS === 'true';
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

describe.skipIf(!ENABLE_SMOKE_TESTS)('Smart Chunking Smoke Tests', () => {
  // Generate large conversation history (50K+ tokens)
  const createLargeConversation = (targetTokens: number): HelperCanonicalMessage[] => {
    const messages: HelperCanonicalMessage[] = [];
    const charsPerToken = 4;
    const charsNeeded = targetTokens * charsPerToken;

    // Create realistic conversation exchanges
    const topics = [
      'implementing authentication in Node.js applications',
      'database optimization and indexing strategies',
      'RESTful API design best practices',
      'microservices architecture patterns',
      'frontend state management with Redux',
      'Docker containerization workflows',
      'CI/CD pipeline configuration',
      'security best practices for web applications',
      'performance optimization techniques',
      'testing strategies and test-driven development'
    ];

    let currentChars = 0;
    let topicIndex = 0;

    while (currentChars < charsNeeded) {
      const topic = topics[topicIndex % topics.length];

      // User question
      const userMessage = `Can you explain ${topic} in detail? I'm working on a project that requires this knowledge. Please provide examples, best practices, and common pitfalls to avoid.`;
      messages.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date(Date.now() - (topics.length - topicIndex) * 60000).toISOString()
      });
      currentChars += userMessage.length;

      // Assistant response
      const assistantMessage = `Let me explain ${topic} comprehensively. This is a critical aspect of modern software development. ${' Here are the key points you need to understand about this topic.'.repeat(20)} ${' This is important for building robust and scalable applications.'.repeat(15)}`;
      messages.push({
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(Date.now() - (topics.length - topicIndex) * 60000 + 30000).toISOString()
      });
      currentChars += assistantMessage.length;

      topicIndex++;
    }

    return messages;
  };

  describe.skipIf(!GOOGLE_API_KEY)('GoogleGenAPI Adapter - Smart Chunking', () => {
    let adapter: GoogleGenAPIHelperAdapter;
    let gemmaConfig: ModelConfig;

    beforeAll(() => {
      adapter = new GoogleGenAPIHelperAdapter();

      // Gemma 3 27B config (128K context)
      gemmaConfig = {
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
    });

    it('should handle small content without chunking', async () => {
      // 5K tokens - should fit easily in 128K context
      const smallConversation = createLargeConversation(5000);

      const result = await adapter.compact(smallConversation, gemmaConfig, 500);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBe(0); // FREE!
      expect(result.helperModelId).toContain('gemma');
      expect(result.compressedTokens).toBeLessThan(1000);

      console.log(`   ✅ Small content (5K tokens): ${result.originalTokens} → ${result.compressedTokens} tokens`);
    }, 30000);

    it('should use smart chunking for large content (150K tokens)', async () => {
      // 150K tokens - exceeds Gemma's 128K context, should trigger chunking
      const largeConversation = createLargeConversation(150000);

      const result = await adapter.compact(largeConversation, gemmaConfig, 1000);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBe(0); // FREE!
      expect(result.helperModelId).toContain('gemma');
      expect(result.originalTokens).toBeGreaterThan(100000);

      console.log(`   ✅ Large content (150K tokens): ${result.originalTokens} → ${result.compressedTokens} tokens (chunked)`);
    }, 120000); // 2 minute timeout for large content
  });

  describe.skipIf(!OPENAI_API_KEY)('ChatCompletions Adapter - Smart Chunking', () => {
    let adapter: ChatCompletionsAPIHelperAdapter;
    let gptConfig: ModelConfig;

    beforeAll(() => {
      adapter = new ChatCompletionsAPIHelperAdapter();

      // GPT-3.5-turbo config (16K context - SMALLEST!)
      gptConfig = {
        id: 'gpt-3.5-turbo',
        provider: 'openai',
        displayName: 'GPT-3.5 Turbo',
        family: 'gpt-3.5',
        api: {
          pattern: 'chat/completions',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKeyEnvVar: 'OPENAI_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        limits: {
          contextWindow: 16385,
          outputTokens: 4096,
          requestsPerMinute: 10000,
          tokensPerMinute: 2000000
        },
        cost: {
          inputPerMillion: 0.50,
          outputPerMillion: 1.50
        }
      } as ModelConfig;
    });

    it('should handle small content without chunking (GPT-3.5)', async () => {
      // 5K tokens - should fit in 16K context
      const smallConversation = createLargeConversation(5000);

      const result = await adapter.compact(smallConversation, gptConfig, 300);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.helperModelId).toBe('gpt-3.5-turbo');
      expect(result.compressedTokens).toBeLessThan(500);

      console.log(`   ✅ GPT-3.5 small (5K tokens): ${result.originalTokens} → ${result.compressedTokens} tokens, cost: $${result.cost.toFixed(4)}`);
    }, 30000);

    it('should use smart chunking for content exceeding 16K context (GPT-3.5)', async () => {
      // 25K tokens - exceeds GPT-3.5's 16K context, MUST trigger chunking
      const largeConversation = createLargeConversation(25000);

      const result = await adapter.compact(largeConversation, gptConfig, 500);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.helperModelId).toBe('gpt-3.5-turbo');
      expect(result.originalTokens).toBeGreaterThan(20000);
      expect(result.compressedTokens).toBeLessThan(1000);

      console.log(`   ✅ GPT-3.5 large (25K tokens): ${result.originalTokens} → ${result.compressedTokens} tokens (CHUNKED), cost: $${result.cost.toFixed(4)}`);
    }, 90000); // 1.5 minute timeout
  });

  describe.skipIf(!ANTHROPIC_API_KEY)('MessagesAPI Adapter - Smart Chunking', () => {
    let adapter: MessagesAPIHelperAdapter;
    let claudeConfig: ModelConfig;

    beforeAll(() => {
      adapter = new MessagesAPIHelperAdapter();

      // Claude Haiku config (200K context)
      claudeConfig = {
        id: 'claude-haiku-4-5',
        provider: 'anthropic',
        displayName: 'Claude 3.5 Haiku',
        family: 'claude-3.5',
        api: {
          pattern: 'messages',
          endpoint: 'https://api.anthropic.com/v1/messages',
          apiKeyEnvVar: 'ANTHROPIC_API_KEY',
          authHeader: 'x-api-key',
          authPrefix: '',
          versionHeader: { name: 'anthropic-version', value: '2023-06-01' }
        },
        limits: {
          contextWindow: 200000,
          outputTokens: 8192,
          requestsPerMinute: 4000,
          tokensPerMinute: 400000
        },
        cost: {
          inputPerMillion: 1.0,
          outputPerMillion: 5.0
        }
      } as ModelConfig;
    });

    it('should handle large content without chunking (Claude Haiku 200K)', async () => {
      // 50K tokens - should fit easily in 200K context
      const largeConversation = createLargeConversation(50000);

      const result = await adapter.compact(largeConversation, claudeConfig, 800);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.helperModelId).toBe('claude-haiku-4-5');
      expect(result.originalTokens).toBeGreaterThan(40000);

      console.log(`   ✅ Claude Haiku (50K tokens): ${result.originalTokens} → ${result.compressedTokens} tokens, cost: $${result.cost.toFixed(4)}`);
    }, 60000);

    it('should use smart chunking for content exceeding 200K context (Claude Haiku)', async () => {
      // 250K tokens - exceeds Claude's 200K context, should trigger chunking
      const massiveConversation = createLargeConversation(250000);

      const result = await adapter.compact(massiveConversation, claudeConfig, 1000);

      expect(result.summary).toBeDefined();
      expect(result.summary.length).toBeGreaterThan(0);
      expect(result.cost).toBeGreaterThan(0);
      expect(result.helperModelId).toBe('claude-haiku-4-5');
      expect(result.originalTokens).toBeGreaterThan(200000);

      console.log(`   ✅ Claude Haiku (250K tokens): ${result.originalTokens} → ${result.compressedTokens} tokens (CHUNKED), cost: $${result.cost.toFixed(4)}`);
    }, 180000); // 3 minute timeout for massive content
  });

  describe.skipIf(!GOOGLE_API_KEY || !OPENAI_API_KEY)('Cross-Provider Helpers', () => {
    it('should demonstrate smart chunking adapts to model limits', async () => {
      const conversation = createLargeConversation(20000); // 20K tokens

      // GPT-3.5 (16K context) - SHOULD CHUNK
      const gptAdapter = new ChatCompletionsAPIHelperAdapter();
      const gptConfig: ModelConfig = {
        id: 'gpt-3.5-turbo',
        provider: 'openai',
        displayName: 'GPT-3.5 Turbo',
        family: 'gpt-3.5',
        api: {
          pattern: 'chat/completions',
          endpoint: 'https://api.openai.com/v1/chat/completions',
          apiKeyEnvVar: 'OPENAI_API_KEY',
          authHeader: 'Authorization',
          authPrefix: 'Bearer'
        },
        limits: {
          contextWindow: 16385, // SMALL!
          outputTokens: 4096,
          requestsPerMinute: 10000,
          tokensPerMinute: 2000000
        }
      } as ModelConfig;

      // Gemma (128K context) - SHOULD NOT CHUNK
      const gemmaAdapter = new GoogleGenAPIHelperAdapter();
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
          contextWindow: 128000, // LARGE!
          outputTokens: 8192,
          requestsPerMinute: 60,
          tokensPerMinute: 1000000
        }
      } as ModelConfig;

      // Run both
      const [gptResult, gemmaResult] = await Promise.all([
        gptAdapter.compact(conversation, gptConfig, 400),
        gemmaAdapter.compact(conversation, gemmaConfig, 400)
      ]);

      // Both should succeed
      expect(gptResult.summary).toBeDefined();
      expect(gemmaResult.summary).toBeDefined();

      console.log('\n   📊 Smart Chunking Comparison (same 20K tokens):');
      console.log(`   GPT-3.5 (16K context): ${gptResult.originalTokens} → ${gptResult.compressedTokens} tokens`);
      console.log(`   Gemma (128K context): ${gemmaResult.originalTokens} → ${gemmaResult.compressedTokens} tokens`);
      console.log(`   Cost difference: GPT-3.5 $${gptResult.cost.toFixed(4)} vs Gemma $${gemmaResult.cost.toFixed(4)} (FREE!)`);
    }, 90000);
  });
});
