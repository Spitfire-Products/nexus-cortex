/**
 * History Enable Command
 * Enable historical context preservation
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface HistoryEnableOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Enable historical context preservation
 */
export async function historyEnable(options: HistoryEnableOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Enable history via server
    const response = await client.post('/history/enable', {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Historical context preservation enabled\n'));

    if (response.message) {
      console.log(theme.colors.muted(response.message));
    }

    console.log();
    console.log(theme.colors.muted('View configuration: cortex history status'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
