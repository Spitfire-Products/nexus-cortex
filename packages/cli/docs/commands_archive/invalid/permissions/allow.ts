/**
 * Permissions Allow Command
 * Allow specific tool
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsAllowOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Allow specific tool (unblock)
 */
export async function permissionsAllow(
  tool?: string,
  options: PermissionsAllowOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!tool) {
      console.error(theme.colors.error('Error: Tool name is required'));
      console.log(theme.colors.muted('\nUsage: cortex permissions allow <tool>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex permissions allow Bash'));
      console.log(theme.colors.muted('  cortex permissions allow WebSearch'));
      console.log();
      process.exit(1);
      return;
    }

    // Allow tool
    const response = await client.post('/permissions/allow', { tool });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Tool allowed\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Tool: ${theme.colors.highlight(tool)}`);
    console.log(`  Status: ${theme.colors.success('Allowed')}`);

    console.log();
    console.log(theme.colors.muted('View policies: cortex permissions policies'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
