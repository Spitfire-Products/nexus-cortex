/**
 * Permissions Actions Command
 * View allowed auto-approve actions
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsActionsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * View allowed auto-approve actions
 */
export async function permissionsActions(
  options: PermissionsActionsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get auto-approve actions
    const response = await client.get('/permissions/actions');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n⚡ Auto-Approve Actions\n'));

    if (response.enabled) {
      console.log(`  Status: ${theme.colors.success('Enabled')}`);
    } else {
      console.log(`  Status: ${theme.colors.error('Disabled')}`);
    }

    console.log();

    if (response.actions && response.actions.length > 0) {
      console.log(theme.colors.secondary('Allowed actions:'));
      response.actions.forEach((action: string) => {
        console.log(`  ${theme.colors.success('✓')} ${action}`);
      });
    } else {
      console.log(theme.colors.muted('No auto-approve actions configured.'));
    }

    console.log();
    console.log(theme.colors.muted('Configure auto-approve: cortex permissions auto-approve'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
