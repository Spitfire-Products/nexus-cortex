/**
 * Retry Status Command
 * Show retry middleware status
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface RetryStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show retry middleware status
 */
export async function retryStatus(
  options: RetryStatusOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get retry status
    const response = await client.get('/retry/status');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🔄 Retry Status\n'));

    if (response.enabled) {
      console.log(`  Status: ${theme.colors.success('Enabled')}`);
    } else {
      console.log(`  Status: ${theme.colors.error('Disabled')}`);
    }

    console.log();

    if (response.config) {
      console.log(theme.colors.secondary('Configuration:'));
      console.log(`  Max attempts: ${theme.colors.highlight(response.config.maxAttempts.toString())}`);
      console.log(`  Base delay: ${theme.colors.highlight(response.config.baseDelay + 'ms')}`);
      console.log(`  Max delay: ${theme.colors.highlight(response.config.maxDelay + 'ms')}`);
      console.log(`  Backoff: ${theme.colors.highlight(response.config.backoff)}`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
