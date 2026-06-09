/**
 * System View Command
 * Preview system message
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SystemViewOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Preview system message
 */
export async function systemView(
  name?: string,
  options: SystemViewOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: System message name is required'));
      console.log(theme.colors.muted('\nUsage: cortex system view <name>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex system view default'));
      console.log(theme.colors.muted('  cortex system view coding-assistant'));
      console.log();
      console.log(theme.colors.muted('List available messages: cortex system list'));
      console.log();
      process.exit(1);
      return;
    }

    // Get system message
    const response = await client.get(`/system/view/${name}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n📝 System Message: ${name}\n`));

    if (response.description) {
      console.log(theme.colors.secondary('Description:'));
      console.log(`  ${theme.colors.muted(response.description)}`);
      console.log();
    }

    if (response.content) {
      console.log(theme.colors.secondary('Content:'));
      console.log(`  ${theme.colors.muted(response.content)}`);
      console.log();
    }

    console.log(theme.colors.muted('Use this message: cortex system set ' + name));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
