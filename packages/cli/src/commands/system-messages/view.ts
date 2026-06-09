/**
 * System Messages View Command
 * View a specific system message
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SystemMessagesViewOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * View a specific system message
 */
export async function systemMessagesView(
  messageId: string,
  options: SystemMessagesViewOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!messageId) {
      console.error(theme.colors.error('Error: Message ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex system-messages view <id>'));
      process.exit(1);
      return;
    }

    // Get system message
    const response = await client.get(`/system-messages/${messageId}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n System Message: ${response.id}\n`));

    if (response.message) {
      console.log(theme.colors.secondary('Content:'));
      console.log(theme.colors.muted('─'.repeat(60)));
      console.log(response.message);
      console.log(theme.colors.muted('─'.repeat(60)));
      console.log();
    }

  } catch (error: any) {
    if (error.message.includes('404') || error.message.includes('not found')) {
      console.error(theme.colors.error(`Error: System message '${messageId}' not found`));
      console.log(theme.colors.muted('\nUse: cortex system-messages list to see available messages'));
    } else {
      console.error(theme.colors.error(`Error: ${error.message}`));
    }
    process.exit(1);
  }
}
