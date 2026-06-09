/**
 * Server Stop Command
 * Stop server
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ServerStopOptions {
  serverUrl?: string;
  json?: boolean;
  force?: boolean;
}

/**
 * Stop server
 */
export async function serverStop(
  options: ServerStopOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Stop server
    const response = await client.post('/server/stop', {
      force: options.force || false
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Server stopping\n'));

    if (response.message) {
      console.log(`  ${theme.colors.muted(response.message)}`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
