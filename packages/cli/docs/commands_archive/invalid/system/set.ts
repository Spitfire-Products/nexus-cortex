/**
 * System Set Command
 * Set system message for session
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SystemSetOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Set system message for session
 */
export async function systemSet(
  name?: string,
  options: SystemSetOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: System message name is required'));
      console.log(theme.colors.muted('\nUsage: cortex system set <name>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex system set default'));
      console.log(theme.colors.muted('  cortex system set coding-assistant'));
      console.log();
      console.log(theme.colors.muted('List available messages: cortex system list'));
      console.log();
      process.exit(1);
      return;
    }

    // Set system message
    const response = await client.post('/system/set', { name });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ System message set\n'));
    console.log(`  Name: ${theme.colors.highlight(name)}`);

    if (response.description) {
      console.log(`  ${theme.colors.muted(response.description)}`);
    }

    console.log();
    console.log(theme.colors.muted('This message will be used for new chat sessions.'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
