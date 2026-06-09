/**
 * Cache Metrics Accumulator Tests
 * Verifies cache metrics tracking and reporting
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { CacheMetricsAccumulator } from '../CacheMetricsAccumulator.js';
import type { TokenUsageMetrics } from '../../adapters/GatewayTranslationLayer.js';

describe('CacheMetricsAccumulator', () => {
  let accumulator: CacheMetricsAccumulator;

  beforeEach(() => {
    accumulator = new CacheMetricsAccumulator();
  });

  describe('addUsage', () => {
    it('should track basic request without cache', () => {
      const usage: TokenUsageMetrics = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500
      };

      accumulator.addUsage(usage, 'anthropic');

      const metrics = accumulator.getMetrics();
      expect(metrics.requestCount).toBe(1);
      expect(metrics.totalInputTokens).toBe(1000);
      expect(metrics.totalOutputTokens).toBe(500);
      expect(metrics.totalUncachedInputTokens).toBe(1000);
      expect(metrics.requestsWithCacheHits).toBe(0);
    });

    it('should track cache creation tokens', () => {
      const usage: TokenUsageMetrics = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cache: {
          cacheCreationTokens: 800,
          cacheReadTokens: 0,
          uncachedInputTokens: 200,
          cacheHitRate: 0,
          costSavingsRatio: 0
        }
      };

      accumulator.addUsage(usage, 'anthropic');

      const metrics = accumulator.getMetrics();
      expect(metrics.totalCacheCreationTokens).toBe(800);
      expect(metrics.totalCacheReadTokens).toBe(0);
      expect(metrics.totalUncachedInputTokens).toBe(200);
      expect(metrics.requestsWithCacheHits).toBe(0);
    });

    it('should track cache read tokens (cache hit)', () => {
      const usage: TokenUsageMetrics = {
        inputTokens: 1000,
        outputTokens: 500,
        totalTokens: 1500,
        cache: {
          cacheCreationTokens: 0,
          cacheReadTokens: 800,
          uncachedInputTokens: 200,
          cacheHitRate: 0.8,
          costSavingsRatio: 0.6
        }
      };

      accumulator.addUsage(usage, 'anthropic');

      const metrics = accumulator.getMetrics();
      expect(metrics.totalCacheReadTokens).toBe(800);
      expect(metrics.requestsWithCacheHits).toBe(1);
      expect(metrics.overallCacheHitRate).toBe(0.8); // 800/1000
    });

    it('should accumulate across multiple requests', () => {
      // First request - cache creation
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 800,
          cacheReadTokens: 0,
          uncachedInputTokens: 200,
          cacheHitRate: 0,
          costSavingsRatio: 0
        }
      }, 'anthropic');

      // Second request - cache hit
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 0,
          cacheReadTokens: 800,
          uncachedInputTokens: 200,
          cacheHitRate: 0.8,
          costSavingsRatio: 0.6
        }
      }, 'anthropic');

      const metrics = accumulator.getMetrics();
      expect(metrics.requestCount).toBe(2);
      expect(metrics.totalInputTokens).toBe(2000);
      expect(metrics.totalCacheCreationTokens).toBe(800);
      expect(metrics.totalCacheReadTokens).toBe(800);
      expect(metrics.requestsWithCacheHits).toBe(1);
      expect(metrics.overallCacheHitRate).toBe(0.4); // 800/2000
    });

    it('should track metrics by provider', () => {
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 0,
          cacheReadTokens: 500,
          uncachedInputTokens: 500,
          cacheHitRate: 0.5,
          costSavingsRatio: 0.375
        }
      }, 'anthropic');

      accumulator.addUsage({
        inputTokens: 500,
        outputTokens: 50,
        totalTokens: 550,
        cache: {
          cacheCreationTokens: 0,
          cacheReadTokens: 400,
          uncachedInputTokens: 100,
          cacheHitRate: 0.8,
          costSavingsRatio: 0.6
        }
      }, 'xai');

      const metrics = accumulator.getMetrics();
      expect(Object.keys(metrics.byProvider)).toHaveLength(2);
      expect(metrics.byProvider['anthropic'].requestCount).toBe(1);
      expect(metrics.byProvider['anthropic'].cacheReadTokens).toBe(500);
      expect(metrics.byProvider['xai'].requestCount).toBe(1);
      expect(metrics.byProvider['xai'].cacheReadTokens).toBe(400);
    });
  });

  // Cache-rate regression guard: the accumulator recomputes
  // overallCacheHitRate = totalCacheReadTokens / totalInputTokens. Before
  // the fix, extractUsage fed an UNDERSTATED inputTokens (post-breakpoint only)
  // for Anthropic/xAI, so this division blew past 1.0. The fix makes
  // usage.inputTokens the true total; this pins the invariant so a future
  // regression of extractUsage is caught here, loudly, instead of silently
  // shipping impossible session-level rates.
  describe('rates stay <= 1.0 with regression-shaped usage', () => {
    it('heavy-cache steady state never yields an impossible rate', () => {
      // Post-fix shape for the exact regression scenario: tiny post-breakpoint
      // input + huge cache_read, recombined into the true total.
      const heavyCacheTurn = (): TokenUsageMetrics => ({
        inputTokens: 30 + 922,        // postBreakpoint + cacheRead (true total)
        outputTokens: 50,
        totalTokens: 30 + 922 + 50,
        cache: {
          cacheCreationTokens: 0,
          cacheReadTokens: 922,
          uncachedInputTokens: 30,
          cacheHitRate: 922 / 952,
          costSavingsRatio: (922 * 0.9) / 952
        }
      });

      for (let i = 0; i < 8; i++) accumulator.addUsage(heavyCacheTurn(), 'anthropic');
      accumulator.addUsage(heavyCacheTurn(), 'xai');

      const m = accumulator.getMetrics();
      expect(m.overallCacheHitRate).toBeGreaterThan(0);
      expect(m.overallCacheHitRate).toBeLessThanOrEqual(1.0);
      expect(m.byProvider['anthropic'].cacheHitRate).toBeLessThanOrEqual(1.0);
      expect(m.byProvider['xai'].cacheHitRate).toBeLessThanOrEqual(1.0);
      // overall savings ratio (the *0.75 derived field) must also stay sane
      expect(m.overallCacheHitRate).toBeCloseTo(922 / 952, 4);
    });
  });

  describe('formatReport', () => {
    it('should generate empty report for no requests', () => {
      const report = accumulator.formatReport();
      expect(report).toContain('Total Requests: 0');
      expect(report).toContain('No caching detected');
    });

    it('should generate report with cache metrics', () => {
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 200,
          cacheReadTokens: 600,
          uncachedInputTokens: 200,
          cacheHitRate: 0.6,
          costSavingsRatio: 0.45
        }
      }, 'anthropic');

      const report = accumulator.formatReport();
      expect(report).toContain('Total Requests: 1');
      expect(report).toContain('Cache Creation: 200');
      expect(report).toContain('Cache Reads: 600');
      expect(report).toContain('Overall Cache Hit Rate: 60.0%');
    });

    it('should include provider breakdown', () => {
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 0,
          cacheReadTokens: 800,
          uncachedInputTokens: 200,
          cacheHitRate: 0.8,
          costSavingsRatio: 0.6
        }
      }, 'anthropic');

      const report = accumulator.formatReport();
      expect(report).toContain('By Provider');
      expect(report).toContain('anthropic:');
      expect(report).toContain('Hit Rate: 80.0%');
    });
  });

  describe('reset', () => {
    it('should reset all metrics to initial state', () => {
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 200,
          cacheReadTokens: 600,
          uncachedInputTokens: 200,
          cacheHitRate: 0.6,
          costSavingsRatio: 0.45
        }
      }, 'anthropic');

      accumulator.reset();

      const metrics = accumulator.getMetrics();
      expect(metrics.requestCount).toBe(0);
      expect(metrics.totalInputTokens).toBe(0);
      expect(metrics.totalCacheReadTokens).toBe(0);
      expect(Object.keys(metrics.byProvider)).toHaveLength(0);
    });
  });

  describe('JSON serialization', () => {
    it('should export and import metrics via JSON', () => {
      accumulator.addUsage({
        inputTokens: 1000,
        outputTokens: 100,
        totalTokens: 1100,
        cache: {
          cacheCreationTokens: 200,
          cacheReadTokens: 600,
          uncachedInputTokens: 200,
          cacheHitRate: 0.6,
          costSavingsRatio: 0.45
        }
      }, 'anthropic');

      const exported = accumulator.toJSON();

      const newAccumulator = new CacheMetricsAccumulator();
      newAccumulator.fromJSON(exported);

      const metrics = newAccumulator.getMetrics();
      expect(metrics.requestCount).toBe(1);
      expect(metrics.totalCacheReadTokens).toBe(600);
    });
  });
});
