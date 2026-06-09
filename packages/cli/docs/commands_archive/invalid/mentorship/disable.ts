/**
 * Mentorship Disable Command
 * Disables the mentorship system
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MentorshipDisableOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Disable mentorship system
 */
export async function mentorshipDisable(options: MentorshipDisableOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Disable mentorship via server
    const response = await client.post('/mentorship/disable', {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.warning('\n⚠ Mentorship system disabled\n'));

    if (response.message) {
      console.log(theme.colors.muted(response.message));
    }

    console.log();
    console.log(theme.colors.muted('Re-enable: cortex mentorship enable'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
