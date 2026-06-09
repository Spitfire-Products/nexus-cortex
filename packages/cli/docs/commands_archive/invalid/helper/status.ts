/**
 * Helper Status Command
 * Show helper model system status
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface HelperStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Display helper model system status
 */
export async function helperStatus(options: HelperStatusOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Fetch helper model status from server
    const response = await client.get('/helper/status');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🤖 Helper Model System\n'));

    // Current helper model
    console.log(theme.colors.secondary('Configuration:'));
    console.log(`  Model: ${theme.colors.highlight(response.helperModel || 'Not configured')}`);

    if (response.helperModel) {
      console.log(`  Status: ${response.available ? theme.colors.success('✓ Available') : theme.colors.error('✗ Unavailable')}`);

      if (response.modelInfo) {
        console.log(`  Provider: ${theme.colors.highlight(response.modelInfo.owned_by || 'Unknown')}`);
        if (response.modelInfo.context_window) {
          console.log(`  Context Window: ${theme.colors.highlight(response.modelInfo.context_window.toLocaleString())} tokens`);
        }
      }
    }

    // Usage statistics
    if (response.stats) {
      console.log();
      console.log(theme.colors.secondary('Usage Statistics:'));
      console.log(`  Total Invocations: ${theme.colors.highlight(response.stats.totalInvocations.toString())}`);
      console.log(`  Successful: ${theme.colors.success(response.stats.successful.toString())}`);
      console.log(`  Failed: ${theme.colors.error(response.stats.failed.toString())}`);

      if (response.stats.totalInvocations > 0) {
        const successRate = ((response.stats.successful / response.stats.totalInvocations) * 100).toFixed(1);
        console.log(`  Success Rate: ${theme.colors.highlight(successRate + '%')}`);
      }

      if (response.stats.lastInvocation) {
        console.log(`  Last Used: ${response.stats.lastInvocation}`);
      }
    }

    // Active session
    if (response.activeSession) {
      console.log();
      console.log(theme.colors.secondary('Active Session:'));
      console.log(`  Session ID: ${theme.colors.highlight(response.activeSession)}`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
