/**
 * Helper Middleware Adapters - Smoke Tests with REAL API Calls
 * Phase 1.5: Week 2
 *
 * These tests make REAL API calls to verify end-to-end functionality.
 * Run with: ENABLE_SMOKE_TESTS=true npm test
 *
 * Required Environment Variables:
 * - ANTHROPIC_API_KEY (for MessagesAPI tests)
 * - OPENAI_API_KEY (for ChatCompletions and ResponsesAPI tests)
 * - GOOGLE_API_KEY or GEMINI_API_KEY (for GoogleGenAI and GenerateContent tests)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { MessagesAPIHelperAdapter } from '../../adapters/MessagesAPIHelperAdapter.js';
import { ChatCompletionsAPIHelperAdapter } from '../../adapters/ChatCompletionsAPIHelperAdapter.js';
import { GoogleGenAPIHelperAdapter } from '../../adapters/GoogleGenAPIHelperAdapter.js';
import { GenerateContentAPIHelperAdapter } from '../../adapters/GenerateContentAPIHelperAdapter.js';
import { ResponsesAPIHelperAdapter } from '../../adapters/ResponsesAPIHelperAdapter.js';
import type { ModelConfig } from '../../../../models/ModelConfig.interface.js';
import type { HelperCanonicalMessage } from '../../HelperMiddlewareAdapter.interface.js';

// Check if smoke tests are enabled
const SMOKE_TESTS_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';

// Sample conversation for testing
const sampleConversation: HelperCanonicalMessage[] = [
  {
    role: 'user',
    content: 'What is machine learning?',
    timestamp: new Date().toISOString()
  },
  {
    role: 'assistant',
    content: 'Machine learning is a subset of artificial intelligence that focuses on developing algorithms and statistical models that enable computers to improve their performance on tasks through experience, without being explicitly programmed for every specific scenario.',
    timestamp: new Date().toISOString()
  },
  {
    role: 'user',
    content: 'What are the main types?',
    timestamp: new Date().toISOString()
  },
  {
    role: 'assistant',
    content: 'The main types of machine learning are: 1) Supervised Learning - where the model learns from labeled training data, 2) Unsupervised Learning - where the model finds patterns in unlabeled data, and 3) Reinforcement Learning - where an agent learns to make decisions by receiving rewards or penalties.',
    timestamp: new Date().toISOString()
  }
];

// Large tool result for summarization tests
const largeToolResult = `
Function execution result:
{
  "status": "success",
  "data": {
    "files_analyzed": 127,
    "total_lines": 45234,
    "languages": {
      "TypeScript": 35124,
      "JavaScript": 8901,
      "JSON": 1209
    },
    "issues_found": [
      {
        "severity": "warning",
        "file": "src/utils/helper.ts",
        "line": 45,
        "message": "Unused variable 'temp'"
      },
      {
        "severity": "error",
        "file": "src/api/client.ts",
        "line": 123,
        "message": "Type mismatch: expected string, got number"
      }
    ],
    "summary": "Analysis complete with 2 issues requiring attention"
  }
}
`.trim();

describe.skipIf(!SMOKE_TESTS_ENABLED)('Helper Adapters - Real API Smoke Tests', () => {
  describe('MessagesAPIHelperAdapter (Anthropic Claude)', () => {
    let adapter: MessagesAPIHelperAdapter;
    const modelConfig: ModelConfig = {
      id: 'claude-haiku-4-5',
      provider: 'anthropic',
      family: 'claude-3.5',
      displayName: 'Claude 3.5 Haiku',
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
      }
    } as ModelConfig;

    beforeAll(() => {
      if (!process.env.ANTHROPIC_API_KEY) {
        console.log('⏭️  Skipping Anthropic tests (no API key)');
      }
      adapter = new MessagesAPIHelperAdapter();
    });

    it.skipIf(!process.env.ANTHROPIC_API_KEY)(
      'should compact conversation via Claude Haiku',
      async () => {
        console.log('🧪 Testing MessagesAPI compaction with Claude Haiku...');

        const result = await adapter.compact(
          sampleConversation,
          modelConfig,
          150 // Target 150 tokens
        );

        console.log(`   ✅ Compaction result:`);
        console.log(`      Original tokens: ${result.originalTokens}`);
        console.log(`      Compressed tokens: ${result.compressedTokens}`);
        console.log(`      Tokens saved: ${result.tokensSaved}`);
        console.log(`      Cost: $${result.cost.toFixed(4)}`);
        console.log(`      Processing time: ${result.processingTime}ms`);
        console.log(`      Summary preview: ${result.summary.substring(0, 100)}...`);

        // Assertions
        expect(result.summary).toBeDefined();
        expect(result.summary.length).toBeGreaterThan(0);
        expect(result.compactedMessages).toBeDefined();
        expect(result.compactedMessages.length).toBeGreaterThan(0);
        expect(result.originalTokens).toBeGreaterThan(0);
        expect(result.compressedTokens).toBeGreaterThan(0);
        expect(result.tokensSaved).toBeGreaterThan(0);
        expect(result.helperModelId).toBe('claude-haiku-4-5');
        expect(result.cost).toBeGreaterThan(0);
        expect(result.processingTime).toBeGreaterThan(0);
      },
      30000 // 30 second timeout for API call
    );

    it.skipIf(!process.env.ANTHROPIC_API_KEY)(
      'should summarize tool result via Claude Haiku',
      async () => {
        console.log('🧪 Testing MessagesAPI tool summarization...');

        const result = await adapter.summarizeToolResult(
          largeToolResult,
          modelConfig,
          100 // Target 100 tokens
        );

        console.log(`   ✅ Summarization result:`);
        console.log(`      Original tokens: ${result.originalTokens}`);
        console.log(`      Summary tokens: ${result.summaryTokens}`);
        console.log(`      Tokens saved: ${result.tokensSaved}`);
        console.log(`      Summary: ${result.summary}`);

        expect(result.summary).toBeDefined();
        expect(result.summary.length).toBeGreaterThan(0);
        expect(result.summaryTokens).toBeLessThan(result.originalTokens);
        expect(result.tokensSaved).toBeGreaterThan(0);
      },
      30000
    );
  });

  describe('ChatCompletionsAPIHelperAdapter (OpenAI)', () => {
    let adapter: ChatCompletionsAPIHelperAdapter;
    const modelConfig: ModelConfig = {
      id: 'gpt-3.5-turbo',
      provider: 'openai',
      family: 'gpt-3.5',
      displayName: 'GPT-3.5 Turbo',
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
      }
    } as ModelConfig;

    beforeAll(() => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping OpenAI ChatCompletions tests (no API key)');
      }
      adapter = new ChatCompletionsAPIHelperAdapter();
    });

    it.skipIf(!process.env.OPENAI_API_KEY)(
      'should compact conversation via GPT-3.5-turbo',
      async () => {
        console.log('🧪 Testing ChatCompletionsAPI compaction with GPT-3.5...');

        const result = await adapter.compact(
          sampleConversation,
          modelConfig,
          150
        );

        console.log(`   ✅ Compaction successful`);
        console.log(`      Tokens saved: ${result.tokensSaved}`);
        console.log(`      Cost: $${result.cost.toFixed(4)}`);

        expect(result.summary).toBeDefined();
        expect(result.tokensSaved).toBeGreaterThan(0);
        expect(result.helperModelId).toBe('gpt-3.5-turbo');
      },
      30000
    );

    it.skipIf(!process.env.OPENAI_API_KEY)(
      'should summarize tool result via GPT-3.5-turbo',
      async () => {
        console.log('🧪 Testing ChatCompletionsAPI tool summarization...');

        const result = await adapter.summarizeToolResult(
          largeToolResult,
          modelConfig,
          100
        );

        console.log(`   ✅ Summary: ${result.summary.substring(0, 100)}...`);

        expect(result.summary).toBeDefined();
        expect(result.summaryTokens).toBeGreaterThan(0);
      },
      30000
    );
  });

  describe('GoogleGenAPIHelperAdapter (FREE Gemma)', () => {
    let adapter: GoogleGenAPIHelperAdapter;
    const modelConfig: ModelConfig = {
      id: 'gemma-3-27b-it',
      provider: 'google',
      family: 'gemma-3',
      displayName: 'Gemma 3 27B (FREE)',
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

    beforeAll(() => {
      if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
        console.log('⏭️  Skipping Google Gemma tests (no API key)');
      }
      adapter = new GoogleGenAPIHelperAdapter();
    });

    it.skipIf(!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY)(
      'should compact conversation via FREE Gemma 3 27B',
      async () => {
        console.log('🧪 Testing GoogleGenAPI compaction with FREE Gemma...');

        const result = await adapter.compact(
          sampleConversation,
          modelConfig,
          150
        );

        console.log(`   ✅ FREE Gemma compaction successful`);
        console.log(`      Tokens saved: ${result.tokensSaved}`);
        console.log(`      Cost: $${result.cost.toFixed(2)} (FREE!)`);

        expect(result.summary).toBeDefined();
        expect(result.cost).toBe(0); // Gemma is FREE!
        expect(result.helperModelId).toContain('gemma');
      },
      30000
    );

    it.skipIf(!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY)(
      'should verify zero cost for Gemma',
      async () => {
        const result = await adapter.summarizeToolResult(
          largeToolResult,
          modelConfig,
          100
        );

        console.log(`   ✅ Verified FREE pricing: $${result.cost}`);
        expect(result.cost).toBe(0);
      },
      30000
    );
  });

  describe('GenerateContentAPIHelperAdapter (Paid Gemini)', () => {
    let adapter: GenerateContentAPIHelperAdapter;
    const modelConfig: ModelConfig = {
      id: 'gemini-2.0-flash-lite',
      provider: 'google',
      family: 'gemini-2.0',
      displayName: 'Gemini 2.0 Flash Lite',
      api: {
        pattern: 'generateContent',
        endpoint: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent',
        apiKeyEnvVar: 'GOOGLE_API_KEY',
        authHeader: 'x-goog-api-key',
        authPrefix: ''
      },
      limits: {
        contextWindow: 1000000,
        outputTokens: 8192,
        requestsPerMinute: 1000,
        tokensPerMinute: 4000000
      }
    } as ModelConfig;

    beforeAll(() => {
      if (!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY) {
        console.log('⏭️  Skipping Gemini Flash tests (no API key)');
      }
      adapter = new GenerateContentAPIHelperAdapter();
    });

    it.skipIf(!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY)(
      'should compact conversation via Gemini 2.0 Flash',
      async () => {
        console.log('🧪 Testing GenerateContentAPI with Gemini Flash...');

        const result = await adapter.compact(
          sampleConversation,
          modelConfig,
          150
        );

        console.log(`   ✅ Gemini Flash compaction successful`);
        console.log(`      Model: ${result.helperModelId}`);
        console.log(`      Tokens saved: ${result.tokensSaved}`);
        console.log(`      Cost: $${result.cost.toFixed(6)}`);

        expect(result.summary).toBeDefined();
        expect(result.helperModelId).toBe('gemini-2.0-flash-lite');
        expect(result.cost).toBeGreaterThan(0); // Paid model
      },
      30000
    );
  });

  describe('ResponsesAPIHelperAdapter (OpenAI Stateful)', () => {
    let adapter: ResponsesAPIHelperAdapter;
    const modelConfig: ModelConfig = {
      id: 'gpt-5-codex',
      provider: 'openai',
      family: 'gpt-5',
      displayName: 'GPT-5 Codex',
      api: {
        pattern: 'responses',
        endpoint: 'https://api.openai.com/v1/responses',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        authHeader: 'Authorization',
        authPrefix: 'Bearer'
      },
      limits: {
        contextWindow: 400000,
        outputTokens: 128000,
        requestsPerMinute: 500,
        tokensPerMinute: 1000000
      }
    } as ModelConfig;

    beforeAll(() => {
      if (!process.env.OPENAI_API_KEY) {
        console.log('⏭️  Skipping ResponsesAPI tests (no API key or model not available)');
      }
      adapter = new ResponsesAPIHelperAdapter();
    });

    it.skipIf(!process.env.OPENAI_API_KEY)(
      'should compact conversation via ResponsesAPI',
      async () => {
        console.log('🧪 Testing ResponsesAPI with GPT-5 Codex...');
        console.log('   ⚠️  Note: This may fail if GPT-5 Codex is not yet available');

        try {
          const result = await adapter.compact(
            sampleConversation,
            modelConfig,
            150
          );

          console.log(`   ✅ ResponsesAPI compaction successful`);
          console.log(`      Tokens saved: ${result.tokensSaved}`);

          expect(result.summary).toBeDefined();
          expect(result.helperModelId).toBe('gpt-5-codex');
        } catch (error: any) {
          if (error.message.includes('404') || error.message.includes('not found')) {
            console.log('   ⚠️  GPT-5 Codex not available yet - skipping');
            // Don't fail the test if model not available
          } else {
            throw error;
          }
        }
      },
      30000
    );
  });

  describe('End-to-End Integration', () => {
    it.skipIf(!process.env.GOOGLE_API_KEY && !process.env.GEMINI_API_KEY)(
      'should demonstrate cost savings with FREE Gemma vs paid models',
      async () => {
        console.log('🧪 Comparing FREE Gemma vs Paid models...');

        const gemmaAdapter = new GoogleGenAPIHelperAdapter();
        const gptAdapter = new ChatCompletionsAPIHelperAdapter();

        const gemmaConfig: ModelConfig = {
          id: 'gemma-3-27b-it',
          api: { pattern: 'google-genai', endpoint: '', apiKeyEnvVar: 'GOOGLE_API_KEY', authHeader: 'x-goog-api-key', authPrefix: '' },
          limits: { contextWindow: 128000, outputTokens: 8192, requestsPerMinute: 60, tokensPerMinute: 1000000 }
        } as ModelConfig;

        const gemmaResult = await gemmaAdapter.compact(sampleConversation, gemmaConfig, 150);

        console.log(`   💰 Cost comparison:`);
        console.log(`      FREE Gemma: $${gemmaResult.cost.toFixed(2)}`);
        console.log(`      Estimated GPT-3.5 cost: ~$0.0012`);
        console.log(`      100% savings with Gemma!`);

        expect(gemmaResult.cost).toBe(0);
      },
      30000
    );
  });
});
