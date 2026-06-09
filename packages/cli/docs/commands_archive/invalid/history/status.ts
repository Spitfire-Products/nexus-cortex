/**
 * History Status Command
 * Show historical context preservation configuration
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface HistoryStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Display historical context preservation status
 */
export async function historyStatus(options: HistoryStatusOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Fetch history configuration from server
    const response = await client.get('/history/status');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📚 Historical Context Preservation\n'));

    // Status
    const statusIcon = response.enabled ? '✓' : '✗';
    const statusColor = response.enabled ? theme.colors.success : theme.colors.muted;
    console.log(`Status: ${statusColor(statusIcon + ' ' + (response.enabled ? 'Enabled' : 'Disabled'))}`);

    if (response.enabled) {
      console.log();

      // Configuration
      console.log(theme.colors.secondary('Configuration:'));
      console.log(`  Max Context Size: ${theme.colors.highlight(response.maxContextSize?.toLocaleString() || 'Unlimited')} tokens`);
      console.log(`  Compression: ${response.compressionEnabled ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);

      if (response.compressionEnabled) {
        console.log(`  Compression Ratio: ${theme.colors.highlight(response.compressionRatio || 'auto')}`);
      }

      console.log(`  Auto-summarize: ${response.autoSummarize ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);

      if (response.autoSummarize) {
        console.log(`  Summary Threshold: ${theme.colors.highlight(response.summaryThreshold?.toLocaleString() || '10,000')} tokens`);
      }

      console.log(`  Preserve Tool Context: ${response.preserveToolContext ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);

      // Statistics
      if (response.stats) {
        console.log();
        console.log(theme.colors.secondary('Usage Statistics:'));
        console.log(`  Sessions with History: ${theme.colors.highlight(response.stats.sessionsWithHistory.toString())}`);
        console.log(`  Total Context Preserved: ${theme.colors.highlight(response.stats.totalContextSize?.toLocaleString() || '0')} tokens`);
        console.log(`  Average Context Size: ${theme.colors.highlight(response.stats.averageContextSize?.toLocaleString() || '0')} tokens`);

        if (response.stats.compressionSavings) {
          const savings = (response.stats.compressionSavings * 100).toFixed(1);
          console.log(`  Compression Savings: ${theme.colors.success(savings + '%')}`);
        }
      }
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
