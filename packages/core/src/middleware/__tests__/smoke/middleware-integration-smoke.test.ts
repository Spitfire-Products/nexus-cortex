/**
 * HelperModelMiddleware Real API Integration Smoke Tests
 * Phase 1.5 Week 2 - Validation of complete middleware flow with real APIs
 *
 * IMPORTANT: Set ENABLE_SMOKE_TESTS=true to run these tests
 * These tests make REAL API calls and will incur costs
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HelperModelMiddleware,
  ContextLimitError,
} from '../../HelperModelMiddleware.js';
import { ModelConfig } from '../../../models/ModelConfig.interface.js';

// Check if smoke tests are enabled
const SMOKE_TESTS_ENABLED = process.env.ENABLE_SMOKE_TESTS === 'true';
const describeOrSkip = SMOKE_TESTS_ENABLED ? describe : describe.skip;

// Mock ModelConfig for GPT-4 (main model)
const mockGPT4Config: ModelConfig = {
  id: 'gpt-4',
  provider: 'openai',
  family: 'gpt-4',
  displayName: 'GPT-4',
  api: {
    pattern: 'chat/completions',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    authHeader: 'Authorization',
    authPrefix: 'Bearer',
    apiKeyEnvVar: 'OPENAI_API_KEY',
  },
  limits: {
    contextWindow: 8192,
    outputTokens: 4096,
    requestsPerMinute: 10000,
    tokensPerMinute: 1000000,
  },
  parameters: {} as any,
  tools: {} as any,
  streaming: {} as any,
} as ModelConfig;

describeOrSkip('HelperModelMiddleware - Real API Integration Smoke Tests', () => {
  let middleware: HelperModelMiddleware;

  beforeEach(() => {
    middleware = new HelperModelMiddleware();
    middleware.resetCostTracking();
  });

  it('should handle history overflow with real GPT-3.5 API call', async () => {
    console.log('🧪 Testing middleware history overflow with real API...');

    // Create a request that exceeds context limit
    const largeContent = 'This is a test message about machine learning. '.repeat(200); // ~10K tokens
    const request = {
      messages: [
        { role: 'user', content: largeContent },
      ],
    };

    const error: ContextLimitError = {
      name: 'ContextLimitError',
      message: 'Context window exceeded: 10000 tokens',
      type: 'context_limit',
      provider: 'openai',
      modelId: 'gpt-4',
    };

    // Handle context rejection (will make real API call)
    const response = await middleware.handleContextRejection(
      request,
      error,
      mockGPT4Config
    );

    console.log('   ✅ Middleware response:');
    console.log(`      Used helper model: ${response.metadata?.usedHelperModel}`);
    console.log(`      Helper model ID: ${response.metadata?.helperModelId}`);
    console.log(`      Compacted messages: ${response.content?.length} messages`);
    console.log(`      Stop reason: ${response.stopReason}`);
    console.log(`      Metadata action: ${response.metadata?.action}`);

    // Validate response structure
    expect(response).toBeDefined();
    expect(response.metadata?.usedHelperModel).toBe(true);
    expect(response.metadata?.helperModelId).toBe('gpt-3.5-turbo');
    expect(response.stopReason).toBe('needs_retry');
    expect(response.metadata?.action).toBe('retry_with_compacted_history');
    expect(response.content).toBeDefined();
    expect(Array.isArray(response.content)).toBe(true);

    // Validate compaction result
    const compaction = response.metadata?.compaction;
    expect(compaction).toBeDefined();
    expect(compaction?.originalTokens).toBeGreaterThan(0);
    expect(compaction?.compressedTokens).toBeLessThan(compaction?.originalTokens);
    expect(compaction?.tokensSaved).toBeGreaterThan(0);
    expect(compaction?.cost).toBeGreaterThan(0);
    expect(compaction?.summary).toBeDefined();
    expect(typeof compaction?.summary).toBe('string');

    console.log('   💰 Cost tracking:');
    const stats = middleware.getCostTracking();
    console.log(`      Helper model cost: $${stats.helperCost.toFixed(6)}`);
    console.log(`      Main model cost: $${stats.mainCost.toFixed(6)}`);
    console.log(`      Estimated savings: ${stats.savingsPercentage.toFixed(2)}%`);

    expect(stats.helperCost).toBeGreaterThan(0);
  }, 30000); // 30 second timeout for real API call

  it('should handle requests with tool results (currently via history overflow)', async () => {
    console.log('🧪 Testing requests with tool results...');
    console.log('   ⚠️  Note: Tool result analysis is incomplete (TODO in analyzeRejection)');
    console.log('   Currently falls back to history overflow strategy');

    // Create request with large tool result
    const largeToolResult = JSON.stringify({
      files: Array.from({ length: 100 }, (_, i) => ({
        path: `/src/component-${i}.tsx`,
        lines: 500,
        issues: [`Warning in line ${i * 10}`],
      })),
      summary: 'Analysis complete',
    });

    const request = {
      messages: [
        { role: 'user', content: 'Analyze the codebase' },
        {
          role: 'tool',
          type: 'tool_result',
          content: largeToolResult,
          tool_use_id: 'test-tool-1',
        },
      ],
    };

    const error: ContextLimitError = {
      name: 'ContextLimitError',
      message: 'Context limit with tool results',
      type: 'context_limit',
      provider: 'openai',
      modelId: 'gpt-4',
    };

    const response = await middleware.handleContextRejection(
      request,
      error,
      mockGPT4Config
    );

    console.log('   ✅ Response received:');
    console.log(`      Strategy: ${response.metadata?.action || 'history overflow'}`);
    console.log(`      Helper model used: ${response.metadata?.helperModelId}`);

    // Verify response structure (currently uses history overflow)
    expect(response.metadata?.usedHelperModel).toBe(true);
    expect(response.metadata?.helperModelId).toBeDefined();
    expect(response.stopReason).toBe('needs_retry');
  }, 30000);

  it('should track costs across multiple operations', async () => {
    console.log('🧪 Testing cost tracking across operations...');

    // Create fresh middleware instance for isolated testing
    const freshMiddleware = new HelperModelMiddleware();

    const request = {
      messages: [{ role: 'user', content: 'test '.repeat(1000) }],
    };

    const error: ContextLimitError = {
      name: 'ContextLimitError',
      message: 'Context exceeded',
      type: 'context_limit',
      provider: 'openai',
      modelId: 'gpt-4',
    };

    // First operation
    await freshMiddleware.handleContextRejection(request, error, mockGPT4Config);
    const stats1 = freshMiddleware.getCostTracking();

    // Second operation
    await freshMiddleware.handleContextRejection(request, error, mockGPT4Config);
    const stats2 = freshMiddleware.getCostTracking();

    console.log('   📊 Cost accumulation:');
    console.log(`      After 1st op: $${stats1.helperCost.toFixed(6)}`);
    console.log(`      After 2nd op: $${stats2.helperCost.toFixed(6)}`);
    console.log(`      Total helper calls: ${stats2.helperModelCalls} requests`);

    // Verify costs accumulated (each call counts twice: one for analysis, one for actual)
    expect(stats2.helperCost).toBeGreaterThan(stats1.helperCost);
    expect(stats2.helperModelCalls).toBeGreaterThanOrEqual(2);

    // Test reset
    freshMiddleware.resetCostTracking();
    const stats3 = freshMiddleware.getCostTracking();
    console.log('   🔄 After reset: $0');
    expect(stats3.helperCost).toBe(0);
    expect(stats3.helperModelCalls).toBe(0);
  }, 60000);

  it('should demonstrate end-to-end workflow with real APIs', async () => {
    console.log('🧪 Testing complete middleware workflow...');

    // Simulate a realistic scenario: large conversation history
    const conversationHistory = [
      { role: 'user', content: 'Tell me about TypeScript' },
      { role: 'assistant', content: 'TypeScript is a typed superset of JavaScript...'.repeat(50) },
      { role: 'user', content: 'What about async/await?' },
      { role: 'assistant', content: 'Async/await is syntactic sugar for promises...'.repeat(50) },
      { role: 'user', content: 'Explain decorators' },
      { role: 'assistant', content: 'Decorators are a stage 3 proposal...'.repeat(50) },
    ];

    const request = {
      messages: conversationHistory,
    };

    const error: ContextLimitError = {
      name: 'ContextLimitError',
      message: 'Context window full',
      type: 'context_limit',
      provider: 'openai',
      modelId: 'gpt-4',
    };

    console.log(`   📝 Original conversation: ${conversationHistory.length} messages`);

    const response = await middleware.handleContextRejection(
      request,
      error,
      mockGPT4Config
    );

    console.log('   ✅ Workflow complete:');
    console.log(`      Compacted messages: ${response.content?.length} messages`);
    console.log(`      Original tokens: ${response.metadata?.compaction?.originalTokens}`);
    console.log(`      Compressed tokens: ${response.metadata?.compaction?.compressedTokens}`);
    console.log(`      Compression ratio: ${
      response.metadata?.compaction?.originalTokens && response.metadata?.compaction?.compressedTokens
        ? ((response.metadata.compaction.compressedTokens / response.metadata.compaction.originalTokens) * 100).toFixed(1)
        : 'N/A'
    }%`);

    // Verify compression happened
    expect(response.metadata?.compaction?.originalTokens).toBeGreaterThan(
      response.metadata?.compaction?.compressedTokens || 0
    );

    // Verify summary quality
    const summary = response.metadata?.compaction?.summary;
    expect(summary).toBeDefined();
    expect(summary?.length).toBeGreaterThan(50);
    expect(summary?.toLowerCase()).toMatch(/typescript|async|decorator/);

    console.log('   📜 Summary preview:');
    console.log(`      ${summary?.substring(0, 150)}...`);
  }, 30000);
});

// Summary message when skipped
if (!SMOKE_TESTS_ENABLED) {
  console.log('\n⚠️  Middleware smoke tests SKIPPED');
  console.log('   Set ENABLE_SMOKE_TESTS=true to run real API tests\n');
}
