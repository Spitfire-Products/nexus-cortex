/**
 * History Disable Command
 * Disable historical context preservation
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface HistoryDisableOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Disable historical context preservation
 */
export async function historyDisable(options: HistoryDisableOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Disable history via server
    const response = await client.post('/history/disable', {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.warning('\n⚠ Historical context preservation disabled\n'));

    if (response.message) {
      console.log(theme.colors.muted(response.message));
    }

    console.log();
    console.log(theme.colors.muted('Re-enable: cortex history enable'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
