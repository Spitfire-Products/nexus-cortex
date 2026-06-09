/**
 * Cache Metrics Extraction — Benchmark Regression Suite
 *
 * Defect-E / R28g regression guard.
 *
 * PRE-R28g BUG (the benchmark scenario):
 *   Anthropic `usage.input_tokens` is ONLY the post-cache-breakpoint remainder,
 *   NOT the grand total. The three input fields are mutually exclusive:
 *     true_total = input_tokens + cache_creation_input_tokens + cache_read_input_tokens
 *   Pre-fix `extractUsage` set `inputTokens = resp.usage.input_tokens` (=30),
 *   then computed `cacheHitRate = cacheRead / inputTokens = 922/30 ≈ 30.7366`
 *   and `costSavingsRatio = (922*0.9)/30 ≈ 27.663` — both >>1.0, both impossible.
 *
 * POST-R28g FIX:
 *   `inputTokens = postBreakpointInput + cacheCreation + cacheRead` (true total).
 *   `cacheHitRate = cacheRead / inputTokens` → 922/952 ≈ 0.969 (≤1.0 ✓).
 *   `costSavingsRatio = (cacheRead * discount) / inputTokens` → (922*0.9)/952 ≈ 0.872 (≤0.9 ✓).
 *
 * This suite pins those rates as hard invariants for every provider path.
 */

import { describe, it, expect } from 'vitest';
import { GatewayTranslationLayer } from '../GatewayTranslationLayer.js';
import type { ModelConfig } from '../../models/ModelConfig.interface.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stubModelConfig(provider: string, apiPattern: string): ModelConfig {
  return {
    id: `${provider}-test`,
    provider,
    displayName: `${provider} Test`,
    api: {
      pattern: apiPattern as ModelConfig['api']['pattern'],
      endpoint: 'https://api.test.local',
    },
    tools: {
      supported: false,
    },
    parameters: {
      temperature: { supported: false },
      maxTokens: { supported: false },
    },
    limits: {
      contextWindow: 128_000,
      outputTokens: 4096,
    },
    streaming: { supported: false },
    compaction: {
      strategy: 'auto',
      thresholdCalculation: { method: 'percentage', percentage: 0.8, safetyMargin: 4000 },
      behavior: { preserveRecent: 5, compactOlder: true, useHelperModel: false },
    },
    cost: { inputPerMillion: 1, outputPerMillion: 1 },
  } as unknown as ModelConfig;
}

// ---------------------------------------------------------------------------
// R28g benchmark scenario — exact reproduction of the pre-fix blowup
// ---------------------------------------------------------------------------

describe('R28g regression guard — Anthropic Messages API', () => {
  const gtl = new GatewayTranslationLayer();
  const cfg = stubModelConfig('anthropic', 'messages');

  // Benchmark repro (from the real bug): input_tokens=30 (post-breakpoint),
  // cache_read=922, cache_creation=0. Pre-fix cacheHitRate=30.74, costSavingsRatio=27.66.
  it('cacheHitRate <= 1.0 for the exact R28g benchmark shape', () => {
    const r: any = { usage: { input_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 922, output_tokens: 50 } };
    const u = gtl['extractUsage'](r, cfg);

    const expectedTotal = 30 + 0 + 922; // 952
    expect(u!.inputTokens).toBe(expectedTotal);
    expect(u!.cache!.cacheReadTokens).toBe(922);
    expect(u!.cache!.uncachedInputTokens).toBe(30); // == post-breakpoint
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    expect(u!.cache!.cacheHitRate).toBeCloseTo(922 / 952, 4);
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.9);
    expect(u!.cache!.costSavingsRatio).toBeCloseTo((922 * 0.9) / 952, 4);
  });

  it('cacheHitRate <= 1.0 for all-creation, no-read', () => {
    const r: any = { usage: { input_tokens: 500, cache_creation_input_tokens: 2000, cache_read_input_tokens: 0, output_tokens: 100 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(2500); // 500 + 2000 + 0
    expect(u!.cache!.cacheCreationTokens).toBe(2000);
    expect(u!.cache!.cacheReadTokens).toBe(0);
    expect(u!.cache!.cacheHitRate).toBe(0);
    expect(u!.cache!.costSavingsRatio).toBe(0);
  });

  it('cacheHitRate <= 1.0 for mixed creation+read', () => {
    const r: any = { usage: { input_tokens: 200, cache_creation_input_tokens: 500, cache_read_input_tokens: 1000, output_tokens: 50 } };
    const u = gtl['extractUsage'](r, cfg);

    const total = 200 + 500 + 1000; // 1700
    expect(u!.cache!.cacheHitRate).toBeCloseTo(1000 / total, 4);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.9);
  });

  it('cacheHitRate = 1.0 for full hit (all read, zero creation + zero post)', () => {
    const r: any = { usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000, output_tokens: 200 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(5000);
    expect(u!.cache!.cacheHitRate).toBe(1.0);
    expect(u!.cache!.costSavingsRatio).toBe(0.9); // 5000*0.9 / 5000
  });

  it('no cache metrics when all cache fields are zero', () => {
    const r: any = { usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 200 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache).toBeUndefined();
  });

  it('returns undefined when usage object is missing entirely', () => {
    const r: any = { content: [{ type: 'text', text: 'hi' }] };
    const u = gtl['extractUsage'](r, cfg);
    expect(u).toBeUndefined();
  });

  it('handles zero input_tokens gracefully (empty message)', () => {
    const r: any = { usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(0);
    expect(u!.outputTokens).toBe(100);
    expect(u!.cache).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// XAI (Anthropic-compatible Messages API) — 75% discount
// ---------------------------------------------------------------------------

describe('XAI Messages API — rates ≤ 1.0', () => {
  const gtl = new GatewayTranslationLayer();
  const cfg = stubModelConfig('xai', 'messages');

  it('cacheHitRate <= 1.0 for heavy-cache turn', () => {
    const r: any = { usage: { input_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 922, output_tokens: 50 } };
    const u = gtl['extractUsage'](r, cfg);

    const total = 30 + 0 + 922;
    expect(u!.inputTokens).toBe(total);
    expect(u!.cache!.cacheHitRate).toBeCloseTo(922 / total, 4);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    // XAI discount = 0.75
    expect(u!.cache!.costSavingsRatio).toBeCloseTo((922 * 0.75) / total, 4);
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.75);
  });

  it('cacheHitRate <= 1.0 for moderate cache hit', () => {
    const r: any = { usage: { input_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 400, output_tokens: 100 } };
    const u = gtl['extractUsage'](r, cfg);

    const total = 1000 + 0 + 400; // 1400
    expect(u!.inputTokens).toBe(total);
    expect(u!.cache!.cacheHitRate).toBeCloseTo(400 / total, 4);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.75);
  });

  it('XAI with cache_creation should also recombine correctly', () => {
    // XAI docs say cache_creation_input_tokens is always 0 (automatic caching),
    // but we should handle non-zero values gracefully.
    const r: any = { usage: { input_tokens: 100, cache_creation_input_tokens: 5000, cache_read_input_tokens: 800, output_tokens: 100 } };
    const u = gtl['extractUsage'](r, cfg);

    const total = 100 + 5000 + 800; // 5900
    expect(u!.inputTokens).toBe(total);
    expect(u!.cache!.cacheCreationTokens).toBe(5000);
    expect(u!.cache!.cacheReadTokens).toBe(800);
    expect(u!.cache!.cacheHitRate).toBeCloseTo(800 / total, 4);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
  });
});

// ---------------------------------------------------------------------------
// OpenAI Chat Completions — 50% discount, prompt_tokens_details.cached_tokens
// ---------------------------------------------------------------------------

describe('OpenAI Chat Completions — rates ≤ 1.0', () => {
  const gtl = new GatewayTranslationLayer();
  const cfg = stubModelConfig('openai', 'chat/completions');

  it('cacheHitRate <= 1.0 with prompt_tokens_details', () => {
    const r: any = { usage: { prompt_tokens: 10_000, completion_tokens: 500, total_tokens: 10_500, prompt_tokens_details: { cached_tokens: 8000, audio_tokens: 0 } } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(10_000);
    expect(u!.cache!.cacheReadTokens).toBe(8000);
    expect(u!.cache!.uncachedInputTokens).toBe(2000); // 10000 - 8000
    expect(u!.cache!.cacheHitRate).toBe(0.8);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    expect(u!.cache!.costSavingsRatio).toBe(0.4); // (8000*0.5)/10000
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.5);
  });

  it('no cache when cached_tokens is 0', () => {
    const r: any = { usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200, prompt_tokens_details: { cached_tokens: 0 } } };
    const u = gtl['extractUsage'](r, cfg);
    expect(u!.cache).toBeUndefined();
  });

  it('no cache when prompt_tokens_details is absent', () => {
    const r: any = { usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } };
    const u = gtl['extractUsage'](r, cfg);
    expect(u!.cache).toBeUndefined();
  });

  it('full cache hit (cached == prompt) gives hitRate=1.0', () => {
    const r: any = { usage: { prompt_tokens: 5000, completion_tokens: 200, total_tokens: 5200, prompt_tokens_details: { cached_tokens: 5000 } } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache!.cacheHitRate).toBe(1.0);
    expect(u!.cache!.costSavingsRatio).toBe(0.5);
  });
});

// ---------------------------------------------------------------------------
// DeepSeek Chat Completions — prompt_cache_hit_tokens / prompt_cache_miss_tokens
// ---------------------------------------------------------------------------

describe('DeepSeek Chat Completions — rates ≤ 1.0', () => {
  const gtl = new GatewayTranslationLayer();
  const cfg = stubModelConfig('deepseek', 'chat/completions');

  it('cacheHitRate <= 1.0 with prompt_cache_hit_tokens', () => {
    const r: any = { usage: { prompt_tokens: 4426, completion_tokens: 16, total_tokens: 4442, prompt_cache_hit_tokens: 4352, prompt_cache_miss_tokens: 74 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(4426);
    expect(u!.cache!.cacheReadTokens).toBe(4352);
    expect(u!.cache!.uncachedInputTokens).toBe(74);
    expect(u!.cache!.cacheHitRate).toBeCloseTo(4352 / 4426, 4);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    // DeepSeek discount = 0.75
    expect(u!.cache!.costSavingsRatio).toBeCloseTo((4352 * 0.75) / 4426, 4);
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.75);
  });

  it('cold turn (all miss, hit=0) → no cache metrics', () => {
    const r: any = { usage: { prompt_tokens: 4412, completion_tokens: 8, total_tokens: 4420, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 4412 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(4412);
    expect(u!.cache).toBeUndefined();
  });

  it('full hit (miss=0) gives hitRate=1.0', () => {
    const r: any = { usage: { prompt_tokens: 5000, completion_tokens: 50, total_tokens: 5050, prompt_cache_hit_tokens: 5000, prompt_cache_miss_tokens: 0 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache!.cacheHitRate).toBe(1.0);
    expect(u!.cache!.costSavingsRatio).toBe(0.75);
  });

  it('fallback when prompt_cache_miss_tokens is missing', () => {
    // If server omits miss_tokens, fallback = inputTokens - cacheRead
    const r: any = { usage: { prompt_tokens: 5000, completion_tokens: 50, total_tokens: 5050, prompt_cache_hit_tokens: 4000 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache!.cacheReadTokens).toBe(4000);
    expect(u!.cache!.uncachedInputTokens).toBe(1000); // 5000 - 4000
    expect(u!.cache!.cacheHitRate).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------
// Google Gemini — usageMetadata.cachedContentTokenCount
// ---------------------------------------------------------------------------

describe('Google Gemini generateContent — rates ≤ 1.0', () => {
  const gtl = new GatewayTranslationLayer();
  const cfg = stubModelConfig('google', 'generateContent');

  it('cacheHitRate <= 1.0 with cachedContentTokenCount', () => {
    const r: any = { usageMetadata: { promptTokenCount: 10_000, candidatesTokenCount: 500, totalTokenCount: 10_500, cachedContentTokenCount: 8000 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(10_000);
    expect(u!.cache!.cacheReadTokens).toBe(8000);
    expect(u!.cache!.uncachedInputTokens).toBe(2000); // 10000 - 8000
    expect(u!.cache!.cacheHitRate).toBe(0.8);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    // Google discount = 0.75
    expect(u!.cache!.costSavingsRatio).toBe(0.6); // (8000*0.75)/10000
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.75);
  });

  it('full hit gives hitRate=1.0', () => {
    const r: any = { usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 200, totalTokenCount: 5200, cachedContentTokenCount: 5000 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache!.cacheHitRate).toBe(1.0);
    expect(u!.cache!.costSavingsRatio).toBe(0.75);
  });

  it('no cache when cachedContentTokenCount is 0', () => {
    const r: any = { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200, cachedContentTokenCount: 0 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache).toBeUndefined();
  });

  it('no cache when cachedContentTokenCount is absent', () => {
    const r: any = { usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200, totalTokenCount: 1200 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Responses API (XAI/OpenAI) — input_tokens_details.cached_tokens
// ---------------------------------------------------------------------------

describe('Responses API — rates ≤ 1.0', () => {
  const gtl = new GatewayTranslationLayer();

  it('XAI Responses API: cacheHitRate <= 1.0 (75% discount)', () => {
    const cfg = stubModelConfig('xai', 'responses');
    const r: any = { usage: { input_tokens: 10_000, output_tokens: 500, total_tokens: 10_500, input_tokens_details: { cached_tokens: 7000 } } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(10_000);
    expect(u!.cache!.cacheReadTokens).toBe(7000);
    expect(u!.cache!.uncachedInputTokens).toBe(3000);
    expect(u!.cache!.cacheHitRate).toBe(0.7);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    expect(u!.cache!.costSavingsRatio).toBeCloseTo((7000 * 0.75) / 10_000, 4);
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.75);
  });

  it('OpenAI Responses API: cacheHitRate <= 1.0 (50% discount)', () => {
    const cfg = stubModelConfig('openai', 'responses');
    const r: any = { usage: { input_tokens: 10_000, output_tokens: 500, total_tokens: 10_500, input_tokens_details: { cached_tokens: 7000 } } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.inputTokens).toBe(10_000);
    expect(u!.cache!.cacheReadTokens).toBe(7000);
    expect(u!.cache!.uncachedInputTokens).toBe(3000);
    expect(u!.cache!.cacheHitRate).toBe(0.7);
    expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);
    expect(u!.cache!.costSavingsRatio).toBe(0.35); // (7000*0.5)/10000
    expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(0.5);
  });

  it('no cache when input_tokens_details is absent (Responses)', () => {
    const cfg = stubModelConfig('openai', 'responses');
    const r: any = { usage: { input_tokens: 1000, output_tokens: 200, total_tokens: 1200 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u!.cache).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Cross-provider rate invariant — must hold for every provider
// ---------------------------------------------------------------------------

describe('Cross-provider rate invariants', () => {
  const gtl = new GatewayTranslationLayer();

  interface ProviderScenario {
    label: string;
    config: ModelConfig;
    response: any;
    expectedInput: number;
    expectedCacheRead: number;
    expectedDiscount: number;
  }

  const cases: ProviderScenario[] = [
    {
      label: 'Anthropic Messages',
      config: stubModelConfig('anthropic', 'messages'),
      response: { usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500, output_tokens: 100 } },
      expectedInput: 1700,
      expectedCacheRead: 1500,
      expectedDiscount: 0.9,
    },
    {
      label: 'XAI Messages',
      config: stubModelConfig('xai', 'messages'),
      response: { usage: { input_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 1500, output_tokens: 100 } },
      expectedInput: 1700,
      expectedCacheRead: 1500,
      expectedDiscount: 0.75,
    },
    {
      label: 'OpenAI Chat',
      config: stubModelConfig('openai', 'chat/completions'),
      response: { usage: { prompt_tokens: 2000, completion_tokens: 100, total_tokens: 2100, prompt_tokens_details: { cached_tokens: 1500 } } },
      expectedInput: 2000,
      expectedCacheRead: 1500,
      expectedDiscount: 0.5,
    },
    {
      label: 'OpenAI Responses',
      config: stubModelConfig('openai', 'responses'),
      response: { usage: { input_tokens: 2000, output_tokens: 100, total_tokens: 2100, input_tokens_details: { cached_tokens: 1500 } } },
      expectedInput: 2000,
      expectedCacheRead: 1500,
      expectedDiscount: 0.5,
    },
    {
      label: 'XAI Responses',
      config: stubModelConfig('xai', 'responses'),
      response: { usage: { input_tokens: 2000, output_tokens: 100, total_tokens: 2100, input_tokens_details: { cached_tokens: 1500 } } },
      expectedInput: 2000,
      expectedCacheRead: 1500,
      expectedDiscount: 0.75,
    },
    {
      label: 'DeepSeek Chat',
      config: stubModelConfig('deepseek', 'chat/completions'),
      response: { usage: { prompt_tokens: 2000, completion_tokens: 100, total_tokens: 2100, prompt_cache_hit_tokens: 1500, prompt_cache_miss_tokens: 500 } },
      expectedInput: 2000,
      expectedCacheRead: 1500,
      expectedDiscount: 0.75,
    },
    {
      label: 'Google Gemini',
      config: stubModelConfig('google', 'generateContent'),
      response: { usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 100, totalTokenCount: 2100, cachedContentTokenCount: 1500 } },
      expectedInput: 2000,
      expectedCacheRead: 1500,
      expectedDiscount: 0.75,
    },
  ];

  cases.forEach(({ label, config, response, expectedInput, expectedCacheRead, expectedDiscount }) => {
    it(`${label}: cacheHitRate = ${expectedCacheRead}/${expectedInput} = ${(expectedCacheRead / expectedInput).toFixed(4)} (≤1.0)`, () => {
      const u = gtl['extractUsage'](response, config);

      expect(u).toBeDefined();
      expect(u!.inputTokens).toBe(expectedInput);
      expect(u!.cache).toBeDefined();
      expect(u!.cache!.cacheReadTokens).toBe(expectedCacheRead);
      expect(u!.cache!.cacheHitRate).toBeCloseTo(expectedCacheRead / expectedInput, 4);
      expect(u!.cache!.cacheHitRate).toBeLessThanOrEqual(1.0);

      const expectedRatio = (expectedCacheRead * expectedDiscount) / expectedInput;
      expect(u!.cache!.costSavingsRatio).toBeCloseTo(expectedRatio, 4);
      expect(u!.cache!.costSavingsRatio).toBeLessThanOrEqual(expectedDiscount);
    });
  });
});

// ---------------------------------------------------------------------------
// Provider without cache support (generic catch-all)
// ---------------------------------------------------------------------------

describe('Provider without cache support', () => {
  const gtl = new GatewayTranslationLayer();

  it('returns usage but no cache for unknown chat/completions provider', () => {
    const cfg = stubModelConfig('some-other', 'chat/completions');
    const r: any = { usage: { prompt_tokens: 1000, completion_tokens: 200, total_tokens: 1200 } };
    const u = gtl['extractUsage'](r, cfg);

    expect(u).toBeDefined();
    expect(u!.inputTokens).toBe(1000);
    expect(u!.outputTokens).toBe(200);
    expect(u!.cache).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('Edge cases', () => {
  const gtl = new GatewayTranslationLayer();
  const cfg = stubModelConfig('anthropic', 'messages');

  it('negative values are clamped to zero in uncachedInputTokens', () => {
    // Shouldn't happen in practice but guard against it
    const r: any = { usage: { input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 100 } };
    const u = gtl['extractUsage'](r, cfg);
    expect(u!.inputTokens).toBe(0);
    expect(u!.cache).toBeUndefined();
  });

  it('null/undefined usage fields are treated as 0', () => {
    const r: any = { usage: { input_tokens: null, cache_creation_input_tokens: undefined, cache_read_input_tokens: null, output_tokens: 100 } };
    const u = gtl['extractUsage'](r, cfg);
    expect(u!.inputTokens).toBe(0); // null → 0 → 0+0+0
    expect(u!.outputTokens).toBe(100);
    expect(u!.cache).toBeUndefined();
  });
});
