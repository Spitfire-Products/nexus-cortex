/**
 * Cache Metrics Accumulator
 * Accumulates cache performance metrics across a session
 */

import { TokenUsageMetrics } from '../adapters/GatewayTranslationLayer.js';

/**
 * Cumulative cache metrics across session
 */
export interface SessionCacheMetrics {
  /** Total requests made */
  requestCount: number;

  /** Total input tokens */
  totalInputTokens: number;

  /** Total output tokens */
  totalOutputTokens: number;

  /** Total cache creation tokens (new writes) */
  totalCacheCreationTokens: number;

  /** Total cache read tokens (hits) */
  totalCacheReadTokens: number;

  /** Total uncached input tokens */
  totalUncachedInputTokens: number;

  /** Overall cache hit rate */
  overallCacheHitRate: number;

  /** Overall cost savings ratio */
  overallCostSavingsRatio: number;

  /** Requests with cache hits */
  requestsWithCacheHits: number;

  /** Breakdown by provider */
  byProvider: Record<string, ProviderCacheMetrics>;
}

/**
 * Provider-specific cache metrics
 */
export interface ProviderCacheMetrics {
  provider: string;
  requestCount: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalInputTokens: number;
  cacheHitRate: number;
}

/**
 * Accumulates cache metrics across a session
 */
export class CacheMetricsAccumulator {
  private metrics: SessionCacheMetrics = {
    requestCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalUncachedInputTokens: 0,
    overallCacheHitRate: 0,
    overallCostSavingsRatio: 0,
    requestsWithCacheHits: 0,
    byProvider: {}
  };

  /**
   * Add usage from a request
   */
  addUsage(usage: TokenUsageMetrics, provider: string): void {
    this.metrics.requestCount++;
    this.metrics.totalInputTokens += usage.inputTokens;
    this.metrics.totalOutputTokens += usage.outputTokens;

    if (usage.cache) {
      this.metrics.totalCacheCreationTokens += usage.cache.cacheCreationTokens;
      this.metrics.totalCacheReadTokens += usage.cache.cacheReadTokens;
      this.metrics.totalUncachedInputTokens += usage.cache.uncachedInputTokens;

      if (usage.cache.cacheReadTokens > 0) {
        this.metrics.requestsWithCacheHits++;
      }

      // Track by provider
      if (!this.metrics.byProvider[provider]) {
        this.metrics.byProvider[provider] = {
          provider,
          requestCount: 0,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          totalInputTokens: 0,
          cacheHitRate: 0
        };
      }

      const providerMetrics = this.metrics.byProvider[provider];
      providerMetrics.requestCount++;
      providerMetrics.cacheReadTokens += usage.cache.cacheReadTokens;
      providerMetrics.cacheCreationTokens += usage.cache.cacheCreationTokens;
      providerMetrics.totalInputTokens += usage.inputTokens;
      providerMetrics.cacheHitRate =
        providerMetrics.totalInputTokens > 0
          ? providerMetrics.cacheReadTokens / providerMetrics.totalInputTokens
          : 0;
    } else {
      // No cache metrics - count uncached tokens
      this.metrics.totalUncachedInputTokens += usage.inputTokens;
    }

    // Recalculate overall rates
    this.metrics.overallCacheHitRate =
      this.metrics.totalInputTokens > 0
        ? this.metrics.totalCacheReadTokens / this.metrics.totalInputTokens
        : 0;

    // Weighted average cost savings (simplified - assumes 75% discount)
    this.metrics.overallCostSavingsRatio =
      this.metrics.totalInputTokens > 0
        ? (this.metrics.totalCacheReadTokens * 0.75) / this.metrics.totalInputTokens
        : 0;
  }

  /**
   * Get current metrics
   */
  getMetrics(): SessionCacheMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics (for new session)
   */
  reset(): void {
    this.metrics = {
      requestCount: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalUncachedInputTokens: 0,
      overallCacheHitRate: 0,
      overallCostSavingsRatio: 0,
      requestsWithCacheHits: 0,
      byProvider: {}
    };
  }

  /**
   * Format metrics for display
   */
  formatReport(): string {
    const m = this.metrics;
    const lines: string[] = [];

    lines.push('=== Cache Performance Report ===\n');
    lines.push(`Total Requests: ${m.requestCount}`);
    lines.push(`Requests with Cache Hits: ${m.requestsWithCacheHits}\n`);

    lines.push(`Total Input Tokens: ${m.totalInputTokens.toLocaleString()}`);
    if (m.totalCacheCreationTokens > 0 || m.totalCacheReadTokens > 0) {
      lines.push(` - Cache Creation: ${m.totalCacheCreationTokens.toLocaleString()}`);
      lines.push(
        ` - Cache Reads: ${m.totalCacheReadTokens.toLocaleString()} (${(m.overallCacheHitRate * 100).toFixed(1)}%)`
      );
      lines.push(` - Uncached: ${m.totalUncachedInputTokens.toLocaleString()}\n`);
    } else {
      lines.push(' - No caching detected\n');
    }

    lines.push(`Total Output Tokens: ${m.totalOutputTokens.toLocaleString()}\n`);

    if (m.overallCacheHitRate > 0) {
      lines.push(`Overall Cache Hit Rate: ${(m.overallCacheHitRate * 100).toFixed(1)}%`);
      lines.push(`Estimated Cost Savings: ${(m.overallCostSavingsRatio * 100).toFixed(1)}%\n`);
    }

    if (Object.keys(m.byProvider).length > 0) {
      lines.push('=== By Provider ===');
      for (const [provider, pm] of Object.entries(m.byProvider)) {
        lines.push(`\n${provider}:`);
        lines.push(` Requests: ${pm.requestCount}`);
        lines.push(` Cache Reads: ${pm.cacheReadTokens.toLocaleString()}`);
        if (pm.cacheCreationTokens > 0) {
          lines.push(` Cache Creation: ${pm.cacheCreationTokens.toLocaleString()}`);
        }
        lines.push(` Hit Rate: ${(pm.cacheHitRate * 100).toFixed(1)}%`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Export metrics as JSON
   */
  toJSON(): SessionCacheMetrics {
    return this.getMetrics();
  }

  /**
   * Load metrics from JSON (for session resume)
   */
  fromJSON(data: SessionCacheMetrics): void {
    this.metrics = { ...data };
  }
}
