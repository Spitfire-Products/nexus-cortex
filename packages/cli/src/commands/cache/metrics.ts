/**
 * Cache Metrics Command
 * Display prompt caching statistics
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface CacheMetricsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Display cache metrics
 */
export async function cacheMetrics(
  _sessionId: string,
  options: CacheMetricsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Determine mode from environment
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';

  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || config.serverUrl || 'http://localhost:4000',
    debug: process.env.DEBUG === 'true'
  });

  try {
    await client.initialize();

    // Get cache metrics (sessionId not needed in direct mode)
    const response = await client.getCacheMetrics();

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n Prompt Caching Metrics\n'));

    if (response.metrics) {
      const m = response.metrics;

      console.log(theme.colors.secondary('Cache Activity:'));
      console.log(` Total Requests: ${theme.colors.highlight(m.requestCount?.toString() || '0')}`);
      console.log(` Requests with Cache Hits: ${theme.colors.highlight(m.requestsWithCacheHits?.toString() || '0')}`);

      if (m.overallCacheHitRate) {
        const hitRate = (m.overallCacheHitRate * 100).toFixed(1);
        console.log(` Hit Rate: ${theme.colors.success(hitRate + '%')}`);
      }
      console.log();

      console.log(theme.colors.secondary('Token Usage:'));
      console.log(` Total Input Tokens: ${theme.colors.highlight(m.totalInputTokens?.toLocaleString() || '0')}`);
      console.log(` Cache Creation: ${theme.colors.highlight(m.totalCacheCreationTokens?.toLocaleString() || '0')}`);
      console.log(` Cache Reads: ${theme.colors.success(m.totalCacheReadTokens?.toLocaleString() || '0')}`);
      console.log(` Uncached: ${theme.colors.muted(m.totalUncachedInputTokens?.toLocaleString() || '0')}`);
      if (m.overallCostSavingsRatio) {
        const costSavings = (m.overallCostSavingsRatio * 100).toFixed(1);
        console.log(` Est. Cost Savings: ${theme.colors.success(costSavings + '%')}`);
      }
      console.log();

      // Show provider breakdown
      if (m.byProvider && Object.keys(m.byProvider).length > 0) {
        console.log(theme.colors.secondary('By Provider:'));
        for (const [provider, pm] of Object.entries(m.byProvider) as [string, any][]) {
          const providerHitRate = pm.cacheHitRate ? `${(pm.cacheHitRate * 100).toFixed(1)}%` : '0%';
          console.log(` ${provider}: ${theme.colors.highlight(pm.cacheReadTokens.toLocaleString())} cached (${providerHitRate})`);
        }
        console.log();
      }
    }

    if (response.report) {
      console.log(theme.colors.secondary('Report:'));
      console.log(theme.colors.muted(response.report));
      console.log();
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
