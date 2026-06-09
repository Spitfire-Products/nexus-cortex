/**
 * Permissions Block Command
 * Block specific tool
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsBlockOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Block specific tool
 */
export async function permissionsBlock(
  tool?: string,
  options: PermissionsBlockOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!tool) {
      console.error(theme.colors.error('Error: Tool name is required'));
      console.log(theme.colors.muted('\nUsage: cortex permissions block <tool>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex permissions block Bash'));
      console.log(theme.colors.muted('  cortex permissions block WebSearch'));
      console.log();
      process.exit(1);
      return;
    }

    // Block tool
    const response = await client.post('/permissions/block', { tool });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Tool blocked\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Tool: ${theme.colors.highlight(tool)}`);
    console.log(`  Status: ${theme.colors.error('Blocked')}`);

    console.log();
    console.log(theme.colors.muted('View blocked tools: cortex permissions policies'));
    console.log(theme.colors.muted('Unblock tool: cortex permissions allow ' + tool));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
