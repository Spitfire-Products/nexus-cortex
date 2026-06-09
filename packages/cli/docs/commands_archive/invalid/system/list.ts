/**
 * System List Command
 * List available system messages
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SystemListOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List available system messages
 */
export async function systemList(
  options: SystemListOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get system messages
    const response = await client.get('/system/list');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📝 System Messages\n'));

    if (response.messages && response.messages.length > 0) {
      response.messages.forEach((message: any) => {
        console.log(theme.colors.secondary(`${message.name}:`));
        console.log(`  ${theme.colors.muted(message.description)}`);
        if (message.current) {
          console.log(`  ${theme.colors.success('✓ Currently active')}`);
        }
        console.log();
      });
    } else {
      console.log(theme.colors.muted('No system messages available.'));
      console.log();
    }

    console.log(theme.colors.muted('View message: cortex system view <name>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
