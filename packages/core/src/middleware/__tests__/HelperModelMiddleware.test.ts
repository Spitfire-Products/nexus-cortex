/**
 * HelperModelMiddleware Tests
 * Week 2 Phase 1.5
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  HelperModelMiddleware,
  ContextLimitError,
  HELPER_MODEL_REGISTRY,
} from '../HelperModelMiddleware.js';
import { ModelConfig } from '../../models/ModelConfig.interface.js';

// Mock ModelConfig for testing
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
  parameters: {} as any, // Simplified for testing
  tools: {} as any,
  streaming: {} as any,
} as ModelConfig;

describe('HelperModelMiddleware', () => {
  let middleware: HelperModelMiddleware;

  beforeEach(() => {
    middleware = new HelperModelMiddleware();
    middleware.resetCostTracking();
  });

  describe('Helper Model Selection', () => {
    it('should select correct helper for Anthropic', () => {
      const helper = middleware.selectHelperModel('anthropic');
      expect(helper).toBe('claude-haiku-4-5');
    });

    it('should select correct helper for OpenAI', () => {
      const helper = middleware.selectHelperModel('openai');
      expect(helper).toBe('gpt-4.1-mini'); // modernized: gpt-3.5-turbo deprecated
    });

    it('should select correct helper for Google', () => {
      const helper = middleware.selectHelperModel('google');
      expect(helper).toBe('gemini-2.5-flash-lite'); // modernized: 1.5-flash deprecated
    });

    it('should fallback to Gemma 4 (Cloudflare) for unknown provider', () => {
      const helper = middleware.selectHelperModel('unknown-provider');
      expect(helper).toBe('@cf/google/gemma-4-26b-a4b-it'); // default helper
    });

    it('should be case-insensitive', () => {
      const helper = middleware.selectHelperModel('ANTHROPIC');
      expect(helper).toBe('claude-haiku-4-5');
    });
  });

  describe('Context Limit Error Detection', () => {
    it('should detect context limit error by message', () => {
      const error = new Error('context window exceeded');
      expect(middleware.isContextLimitError(error)).toBe(true);
    });

    it('should detect various context error patterns', () => {
      const patterns = [
        'token limit exceeded',
        'maximum context length',
        'too many tokens in request',
        'context length exceeded',
        'request too large for context window',
      ];

      patterns.forEach(pattern => {
        const error = new Error(pattern);
        expect(middleware.isContextLimitError(error)).toBe(true);
      });
    });

    it('should not detect non-context errors', () => {
      const errors = [
        new Error('authentication failed'),
        new Error('rate limit exceeded'),
        new Error('invalid request'),
        null,
        undefined,
      ];

      errors.forEach(error => {
        expect(middleware.isContextLimitError(error)).toBe(false);
      });
    });
  });

  describe('Rejection Analysis', () => {
    it('should analyze history overflow', () => {
      // Create large enough messages to exceed 8K context window
      const largeContent = 'Message '.repeat(5000); // ~35K tokens
      const request = {
        messages: [
          { role: 'user', content: largeContent },
          { role: 'assistant', content: largeContent },
          { role: 'user', content: largeContent },
        ],
      };

      const error: ContextLimitError = {
        name: 'ContextLimitError',
        message: 'Context window exceeded',
        type: 'context_limit',
        provider: 'openai',
        modelId: 'gpt-4',
      };

      const analysis = middleware.analyzeRejection(request, error, mockGPT4Config);

      expect(analysis.reason).toBe('history_too_large');
      expect(analysis.maxTokens).toBe(8192);
      expect(analysis.totalTokens).toBeGreaterThan(8192);
      expect(analysis.excessTokens).toBeGreaterThan(0);
    });

    it('should provide token breakdown', () => {
      const request = {
        messages: [{ role: 'user', content: 'test'.repeat(100) }],
      };

      const error: ContextLimitError = {
        name: 'ContextLimitError',
        message: 'Context limit',
        type: 'context_limit',
        provider: 'openai',
        modelId: 'gpt-4',
      };

      const analysis = middleware.analyzeRejection(request, error, mockGPT4Config);

      expect(analysis.historyTokens).toBeGreaterThan(0);
      expect(analysis.totalTokens).toBe(
        analysis.historyTokens + analysis.toolResultTokens
      );
    });

    it('should calculate tool result tokens correctly', () => {
      const largeToolResult = JSON.stringify({
        files: Array.from({ length: 50 }, (_, i) => ({
          path: `/src/file-${i}.ts`,
          content: 'x'.repeat(100),
        })),
      });

      const request = {
        messages: [
          { role: 'user', content: 'Analyze the files' },
          { role: 'tool', content: largeToolResult },
          { role: 'assistant', content: 'Analysis complete' },
        ],
      };

      const error: ContextLimitError = {
        name: 'ContextLimitError',
        message: 'Context limit with tools',
        type: 'context_limit',
        provider: 'openai',
        modelId: 'gpt-4',
      };

      const analysis = middleware.analyzeRejection(request, error, mockGPT4Config);

      // Tool result tokens should now be calculated, not hardcoded to 0
      expect(analysis.toolResultTokens).toBeGreaterThan(0);
      expect(analysis.toolResultTokens).toBeLessThan(analysis.totalTokens);

      // Verify the tool result contributes significantly to total
      const toolPercentage = (analysis.toolResultTokens / analysis.totalTokens) * 100;
      expect(toolPercentage).toBeGreaterThan(10); // At least 10% of total
    });
  });

  describe('Cost Tracking', () => {
    it('should initialize with zero costs', () => {
      const costs = middleware.getCostTracking();

      expect(costs.helperModelCalls).toBe(0);
      expect(costs.helperTokensProcessed).toBe(0);
      expect(costs.helperCost).toBe(0);
      expect(costs.mainModelCalls).toBe(0);
      expect(costs.totalCost).toBe(0);
    });

    it('should track main model usage', () => {
      middleware.trackMainModelUsage(10000, 0.05);

      const costs = middleware.getCostTracking();

      expect(costs.mainModelCalls).toBe(1);
      expect(costs.mainTokensProcessed).toBe(10000);
      expect(costs.mainCost).toBe(0.05);
      expect(costs.totalCost).toBe(0.05);
    });

    it('should calculate savings percentage', () => {
      // Simulate helper model compaction (cheap)
      middleware['trackHelperModelUsage'](100000, 0.10); // $0.10 for helper

      const costs = middleware.getCostTracking();

      expect(costs.helperCost).toBe(0.10);
      expect(costs.savings).toBeGreaterThan(0); // Should save compared to main model
      expect(costs.savingsPercentage).toBeGreaterThan(0);
    });

    it('should reset cost tracking', () => {
      middleware.trackMainModelUsage(10000, 0.05);
      middleware.resetCostTracking();

      const costs = middleware.getCostTracking();

      expect(costs.mainModelCalls).toBe(0);
      expect(costs.totalCost).toBe(0);
    });
  });

  describe('Helper Model Registry', () => {
    it('should have entries for all major providers', () => {
      expect(HELPER_MODEL_REGISTRY).toHaveProperty('anthropic');
      expect(HELPER_MODEL_REGISTRY).toHaveProperty('openai');
      expect(HELPER_MODEL_REGISTRY).toHaveProperty('google');
      expect(HELPER_MODEL_REGISTRY).toHaveProperty('xai');
      expect(HELPER_MODEL_REGISTRY).toHaveProperty('deepseek');
    });

    it('should map to appropriate cheap models', () => {
      expect(HELPER_MODEL_REGISTRY.anthropic).toContain('haiku');
      expect(HELPER_MODEL_REGISTRY.openai).toContain('4.1'); // modernized: gpt-4.1-mini
      expect(HELPER_MODEL_REGISTRY.google).toContain('flash');
    });
  });

  describe.skipIf(process.env.ENABLE_SMOKE_TESTS !== 'true')('Compaction Flow', () => {
    it('should handle context rejection', async () => {
      const request = {
        messages: [{ role: 'user', content: 'test'.repeat(10000) }],
      };

      const error: ContextLimitError = {
        name: 'ContextLimitError',
        message: 'Context window exceeded',
        type: 'context_limit',
        provider: 'openai',
        modelId: 'gpt-4',
      };

      const response = await middleware.handleContextRejection(
        request,
        error,
        mockGPT4Config
      );

      expect(response).toBeDefined();
      expect(response.metadata?.usedHelperModel).toBe(true);
      expect(response.metadata?.helperModelId).toBeDefined();
    });

    it('should route to correct handler based on analysis', async () => {
      const request = {
        messages: [{ role: 'user', content: 'x'.repeat(100000) }],
      };

      const error: ContextLimitError = {
        name: 'ContextLimitError',
        message: 'Context limit',
        type: 'context_limit',
        provider: 'openai',
        modelId: 'gpt-4',
      };

      const response = await middleware.handleContextRejection(
        request,
        error,
        mockGPT4Config
      );

      expect(response.metadata?.usedHelperModel).toBe(true);
    }, 10000);
  });
});
