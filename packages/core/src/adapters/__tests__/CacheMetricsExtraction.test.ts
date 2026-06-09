/**
 * Cache Metrics Extraction Tests
 * Tests for extracting cache token metrics from provider responses
 */

import { describe, it, expect } from 'vitest';
import { GatewayTranslationLayer } from '../GatewayTranslationLayer.js';
import { ModelConfig } from '../../models/ModelConfig.interface.js';

describe('GatewayTranslationLayer - Cache Metrics Extraction', () => {
  const gtl = new GatewayTranslationLayer();

  /**
   * Helper to create mock model configs
   */
  function createModelConfig(provider: string, apiPattern: string): ModelConfig {
    return {
      id: `${provider}-test-model`,
      name: 'Test Model',
      provider,
      api: {
        pattern: apiPattern as any,
        endpoint: 'https://api.test.com',
        supportsStreaming: false
      },
      capabilities: {
        functionCalling: false,
        vision: false,
        maxOutputTokens: 4096
      },
      context: {
        maxInputTokens: 128000,
        maxOutputTokens: 4096
      }
    } as ModelConfig;
  }

  describe('Anthropic Messages API', () => {
    const anthropicConfig = createModelConfig('anthropic', 'messages');

    // R28g regression (benchmark repro): Anthropic `input_tokens` is ONLY the
    // post-cache-breakpoint remainder — NOT the grand total. The three input
    // fields are mutually exclusive; true total =
    // input_tokens + cache_creation_input_tokens + cache_read_input_tokens.
    // Pre-fix this produced cacheHitRate=30.73 / costSavingsRatio=27.66 (>1).
    it('treats input_tokens as post-breakpoint remainder (rates must be <= 1)', () => {
      const response = {
        usage: {
          input_tokens: 30,                 // only the new post-breakpoint message
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 922,     // large cached prefix
          output_tokens: 50
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      expect(result?.inputTokens).toBe(952);        // 30 + 0 + 922 (true total)
      expect(result?.totalTokens).toBe(1002);       // 952 + 50
      expect(result?.cache?.uncachedInputTokens).toBe(30);   // == post-breakpoint input
      expect(result?.cache?.cacheHitRate).toBeCloseTo(922 / 952, 4); // ~0.969
      expect(result?.cache?.cacheHitRate).toBeLessThanOrEqual(1.0);
      expect(result?.cache?.costSavingsRatio).toBeCloseTo((922 * 0.9) / 952, 4);
      expect(result?.cache?.costSavingsRatio).toBeLessThanOrEqual(0.9);
    });

    it('should extract cache creation and read tokens', () => {
      const response = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        usage: {
          input_tokens: 1500,
          cache_creation_input_tokens: 800,
          cache_read_input_tokens: 700,
          output_tokens: 250
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      expect(result).toBeDefined();
      // total = 1500 + 800 + 700 = 3000 (input_tokens is post-breakpoint only)
      expect(result?.inputTokens).toBe(3000);
      expect(result?.outputTokens).toBe(250);
      expect(result?.totalTokens).toBe(3250);
      expect(result?.cache).toBeDefined();
      expect(result?.cache?.cacheCreationTokens).toBe(800);
      expect(result?.cache?.cacheReadTokens).toBe(700);
      expect(result?.cache?.uncachedInputTokens).toBe(1500); // == post-breakpoint input
      expect(result?.cache?.cacheHitRate).toBeCloseTo(0.233, 2); // 700/3000
      expect(result?.cache?.costSavingsRatio).toBeCloseTo(0.21, 2); // (700 * 0.9) / 3000
    });

    it('should handle cache reads only (no creation)', () => {
      const response = {
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 800,
          output_tokens: 200
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      expect(result?.cache).toBeDefined();
      expect(result?.cache?.cacheCreationTokens).toBe(0);
      expect(result?.cache?.cacheReadTokens).toBe(800);
      // total = 1000 + 0 + 800 = 1800
      expect(result?.cache?.uncachedInputTokens).toBe(1000); // == post-breakpoint input
      expect(result?.cache?.cacheHitRate).toBeCloseTo(0.444, 3); // 800/1800
      expect(result?.cache?.costSavingsRatio).toBeCloseTo(0.4, 3); // (800 * 0.9) / 1800
    });

    it('should handle no caching (all fields zero)', () => {
      const response = {
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 200
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      expect(result?.cache).toBeUndefined(); // No cache metrics when all zeros
    });

    it('should calculate 90% discount for Anthropic', () => {
      const response = {
        usage: {
          input_tokens: 10000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 9000,
          output_tokens: 500
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      // total = 10000 + 0 + 9000 = 19000; savings = (9000 * 0.9) / 19000
      expect(result?.cache?.costSavingsRatio).toBeCloseTo(0.4263, 3);
    });
  });

  describe('XAI Messages API (Anthropic-compatible)', () => {
    const xaiConfig = createModelConfig('xai', 'messages');

    it('should extract cache tokens using Anthropic format', () => {
      const response = {
        id: 'msg_xai_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello' }],
        usage: {
          input_tokens: 1500,
          cache_creation_input_tokens: 0, // XAI always reports 0 (automatic)
          cache_read_input_tokens: 1200,
          output_tokens: 250
        }
      };

      const result = gtl['extractUsage'](response, xaiConfig);

      expect(result).toBeDefined();
      expect(result?.cache).toBeDefined();
      expect(result?.cache?.cacheCreationTokens).toBe(0); // Always 0 for XAI
      expect(result?.cache?.cacheReadTokens).toBe(1200);
      // total = 1500 + 0 + 1200 = 2700
      expect(result?.cache?.uncachedInputTokens).toBe(1500); // == post-breakpoint input
      expect(result?.cache?.cacheHitRate).toBeCloseTo(0.444, 3); // 1200/2700
    });

    it('should calculate 75% discount for XAI (not 90%)', () => {
      const response = {
        usage: {
          input_tokens: 10000,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 8000,
          output_tokens: 500
        }
      };

      const result = gtl['extractUsage'](response, xaiConfig);

      // total = 10000 + 0 + 8000 = 18000; savings = (8000 * 0.75) / 18000
      expect(result?.cache?.costSavingsRatio).toBeCloseTo(0.3333, 3);
    });

    it('should handle typical XAI response from docs', () => {
      // From xai_docs_docs_api-reference.md lines 853-858
      const response = {
        id: '4f224bfb-9d53-4c82-b40a-b7cd80831ec2',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello there!' }],
        model: 'grok-4-0709',
        stop_reason: 'max_tokens',
        usage: {
          input_tokens: 9,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 32
        }
      };

      const result = gtl['extractUsage'](response, xaiConfig);

      expect(result?.inputTokens).toBe(9);
      expect(result?.outputTokens).toBe(32);
      expect(result?.cache).toBeUndefined(); // No caching in this example
    });
  });

  describe('OpenAI Chat Completions API', () => {
    const openaiConfig = createModelConfig('openai', 'chat/completions');

    it('should extract cache tokens from prompt_tokens_details', () => {
      const response = {
        usage: {
          prompt_tokens: 1500,
          completion_tokens: 250,
          total_tokens: 1750,
          prompt_tokens_details: {
            cached_tokens: 700,
            audio_tokens: 0
          }
        }
      };

      const result = gtl['extractUsage'](response, openaiConfig);

      expect(result).toBeDefined();
      expect(result?.cache).toBeDefined();
      expect(result?.cache?.cacheCreationTokens).toBe(0); // OpenAI doesn't report
      expect(result?.cache?.cacheReadTokens).toBe(700);
      expect(result?.cache?.uncachedInputTokens).toBe(800); // 1500 - 700
      expect(result?.cache?.cacheHitRate).toBeCloseTo(0.467, 2); // 700/1500
    });

    it('should calculate 50% discount for OpenAI', () => {
      const response = {
        usage: {
          prompt_tokens: 10000,
          completion_tokens: 500,
          total_tokens: 10500,
          prompt_tokens_details: {
            cached_tokens: 8000
          }
        }
      };

      const result = gtl['extractUsage'](response, openaiConfig);

      // Cost savings: (8000 * 0.5) / 10000 = 0.4 (40% savings)
      expect(result?.cache?.costSavingsRatio).toBe(0.4);
    });

    it('should handle no cached tokens', () => {
      const response = {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200,
          prompt_tokens_details: {
            cached_tokens: 0
          }
        }
      };

      const result = gtl['extractUsage'](response, openaiConfig);

      expect(result?.cache).toBeUndefined(); // No cache metrics when 0
    });
  });

  describe('Google Gemini generateContent API', () => {
    const googleConfig = createModelConfig('google', 'generateContent');

    it('should extract cache tokens from usageMetadata', () => {
      const response = {
        usageMetadata: {
          promptTokenCount: 1500,
          candidatesTokenCount: 250,
          totalTokenCount: 1750,
          cachedContentTokenCount: 700
        }
      };

      const result = gtl['extractUsage'](response, googleConfig);

      expect(result).toBeDefined();
      expect(result?.cache).toBeDefined();
      expect(result?.cache?.cacheCreationTokens).toBe(0); // Google doesn't report
      expect(result?.cache?.cacheReadTokens).toBe(700);
      expect(result?.cache?.uncachedInputTokens).toBe(800); // 1500 - 700
      expect(result?.cache?.cacheHitRate).toBeCloseTo(0.467, 2); // 700/1500
    });

    it('should calculate 75% discount for Google', () => {
      const response = {
        usageMetadata: {
          promptTokenCount: 10000,
          candidatesTokenCount: 500,
          totalTokenCount: 10500,
          cachedContentTokenCount: 8000
        }
      };

      const result = gtl['extractUsage'](response, googleConfig);

      // Cost savings: (8000 * 0.75) / 10000 = 0.6 (60% savings)
      expect(result?.cache?.costSavingsRatio).toBe(0.6);
    });
  });

  describe('DeepSeek Chat Completions API', () => {
    // DeepSeek reports caching via prompt_cache_hit_tokens /
    // prompt_cache_miss_tokens at usage top-level — NOT OpenAI's
    // prompt_tokens_details.cached_tokens. Without a deepseek branch the
    // generic catch-all reads 0 and DeepSeek's real server-side caching is
    // invisible in usage.cache (cost savings silently understated).
    const deepseekConfig = createModelConfig('deepseek', 'chat/completions');

    it('extracts cache read from prompt_cache_hit_tokens', () => {
      const response = {
        usage: {
          prompt_tokens: 4426,
          completion_tokens: 16,
          total_tokens: 4442,
          prompt_cache_hit_tokens: 4352,
          prompt_cache_miss_tokens: 74
        }
      };

      const result = gtl['extractUsage'](response, deepseekConfig);

      expect(result?.inputTokens).toBe(4426);
      expect(result?.cache?.cacheReadTokens).toBe(4352);
      expect(result?.cache?.cacheCreationTokens).toBe(0);
      expect(result?.cache?.uncachedInputTokens).toBe(74);
      expect(result?.cache?.cacheHitRate).toBeCloseTo(4352 / 4426, 4);
      expect(result?.cache?.costSavingsRatio).toBeGreaterThan(0);
    });

    it('cold turn (all miss, hit=0) → no cache metrics', () => {
      const response = {
        usage: {
          prompt_tokens: 4412,
          completion_tokens: 8,
          total_tokens: 4420,
          prompt_cache_hit_tokens: 0,
          prompt_cache_miss_tokens: 4412
        }
      };

      const result = gtl['extractUsage'](response, deepseekConfig);

      expect(result?.inputTokens).toBe(4412);
      expect(result?.cache).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    const anthropicConfig = createModelConfig('anthropic', 'messages');

    it('should handle missing usage object', () => {
      const response = {
        id: 'msg_123',
        content: [{ type: 'text', text: 'Hello' }]
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      expect(result).toBeUndefined();
    });

    it('should handle partial cache hit (uncached > 0)', () => {
      const response = {
        usage: {
          input_tokens: 2000,
          cache_creation_input_tokens: 500,
          cache_read_input_tokens: 1000,
          output_tokens: 300
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      // total = 2000 + 500 + 1000 = 3500
      expect(result?.cache?.uncachedInputTokens).toBe(2000); // == post-breakpoint input
      expect(result?.cache?.cacheHitRate).toBeCloseTo(0.286, 3); // 1000/3500
    });

    it('should handle zero input tokens gracefully', () => {
      const response = {
        usage: {
          input_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 100
        }
      };

      const result = gtl['extractUsage'](response, anthropicConfig);

      expect(result?.inputTokens).toBe(0);
      expect(result?.cache).toBeUndefined();
    });

    it('should handle provider without cache support', () => {
      const deepseekConfig = createModelConfig('deepseek', 'chat/completions');

      const response = {
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 200,
          total_tokens: 1200
        }
      };

      const result = gtl['extractUsage'](response, deepseekConfig);

      expect(result).toBeDefined();
      expect(result?.inputTokens).toBe(1000);
      expect(result?.outputTokens).toBe(200);
      expect(result?.cache).toBeUndefined(); // No cache support
    });
  });

  describe('Provider Comparison', () => {
    it('should apply different discount rates by provider', () => {
      const cacheReadTokens = 8000;
      const inputTokens = 10000;

      // Anthropic: 90% discount
      const anthropicResponse = {
        usage: {
          input_tokens: inputTokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: cacheReadTokens,
          output_tokens: 500
        }
      };
      const anthropicResult = gtl['extractUsage'](
        anthropicResponse,
        createModelConfig('anthropic', 'messages')
      );
      // total = 10000 + 0 + 8000 = 18000; savings = 8000*0.9/18000
      expect(anthropicResult?.cache?.costSavingsRatio).toBeCloseTo(0.4, 3);

      // XAI: 75% discount
      const xaiResponse = {
        usage: {
          input_tokens: inputTokens,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: cacheReadTokens,
          output_tokens: 500
        }
      };
      const xaiResult = gtl['extractUsage'](
        xaiResponse,
        createModelConfig('xai', 'messages')
      );
      // total = 10000 + 0 + 8000 = 18000; savings = 8000*0.75/18000
      expect(xaiResult?.cache?.costSavingsRatio).toBeCloseTo(0.3333, 3);

      // OpenAI: 50% discount
      const openaiResponse = {
        usage: {
          prompt_tokens: inputTokens,
          completion_tokens: 500,
          total_tokens: 10500,
          prompt_tokens_details: {
            cached_tokens: cacheReadTokens
          }
        }
      };
      const openaiResult = gtl['extractUsage'](
        openaiResponse,
        createModelConfig('openai', 'chat/completions')
      );
      expect(openaiResult?.cache?.costSavingsRatio).toBe(0.4); // 8000*0.5/10000

      // Google: 75% discount
      const googleResponse = {
        usageMetadata: {
          promptTokenCount: inputTokens,
          candidatesTokenCount: 500,
          totalTokenCount: 10500,
          cachedContentTokenCount: cacheReadTokens
        }
      };
      const googleResult = gtl['extractUsage'](
        googleResponse,
        createModelConfig('google', 'generateContent')
      );
      expect(googleResult?.cache?.costSavingsRatio).toBe(0.6); // 8000*0.75/10000
    });
  });
});
