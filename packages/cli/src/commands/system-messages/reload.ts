/**
 * System Messages Reload Command
 * Reload system messages from disk
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SystemMessagesReloadOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Reload system messages from disk
 */
export async function systemMessagesReload(
  options: SystemMessagesReloadOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Trigger reload
    const response = await client.post('/system-messages/reload', {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ System messages reloaded successfully\n'));

    if (response.message) {
      console.log(` ${theme.colors.muted(response.message)}`);
      console.log();
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
