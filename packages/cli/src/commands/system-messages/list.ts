/**
 * System Messages List Command
 * List all system messages
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SystemMessagesListOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List all system messages
 */
export async function systemMessagesList(
  options: SystemMessagesListOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get system messages
    const response = await client.get('/system-messages');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n System Messages (${response.count || 0})\n`));

    if (response.messages && response.messages.length > 0) {
      for (const msg of response.messages) {
        console.log(theme.colors.secondary(`${msg.id || msg.name}:`));
        if (msg.description) {
          console.log(` ${theme.colors.muted(msg.description)}`);
        }
        if (msg.priority !== undefined) {
          console.log(` Priority: ${theme.colors.highlight(msg.priority.toString())}`);
        }
        if (msg.enabled !== undefined) {
          const status = msg.enabled ? theme.colors.success('Enabled') : theme.colors.muted('Disabled');
          console.log(` Status: ${status}`);
        }
        console.log();
      }
    } else {
      console.log(theme.colors.muted('No system messages found.\n'));
    }

    console.log(theme.colors.muted('View message content:'));
    console.log(theme.colors.muted(' cortex system-messages view <id>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
