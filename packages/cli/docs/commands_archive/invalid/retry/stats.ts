/**
 * Retry Stats Command
 * Retry statistics
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface RetryStatsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show retry statistics
 */
export async function retryStats(
  options: RetryStatsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get retry stats
    const response = await client.get('/retry/stats');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📊 Retry Statistics\n'));

    if (response.totalRetries !== undefined) {
      console.log(theme.colors.secondary('Summary:'));
      console.log(`  Total retries: ${theme.colors.highlight(response.totalRetries.toString())}`);

      if (response.successfulRetries !== undefined) {
        console.log(`  Successful: ${theme.colors.success(response.successfulRetries.toString())}`);
      }

      if (response.failedRetries !== undefined) {
        console.log(`  Failed: ${theme.colors.error(response.failedRetries.toString())}`);
      }

      if (response.successRate !== undefined) {
        console.log(`  Success rate: ${theme.colors.highlight(response.successRate + '%')}`);
      }
    } else {
      console.log(theme.colors.muted('No retry statistics available yet.'));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
