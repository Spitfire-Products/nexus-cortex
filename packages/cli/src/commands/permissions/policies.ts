/**
 * Permissions Policies Command
 * List active policies
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface PermissionsPoliciesOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List active permission policies
 */
export async function permissionsPolicies(
  options: PermissionsPoliciesOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Create client (will use direct mode by default)
  const client = new OrchestratorClient({
    serverUrl: options.serverUrl || config.serverUrl,
    projectPath: process.env.PROJECT_PATH || process.cwd()
  });

  try {
    // Get policies
    const policies = await client.getPolicies();

    // JSON output
    if (options.json) {
      console.log(JSON.stringify({ policies }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n  Permission Policies\n'));

    if (policies && policies.length > 0) {
      policies.forEach((policy: any) => {
        console.log(theme.colors.secondary(`${policy.name}:`));
        console.log(` Priority: ${theme.colors.highlight(policy.priority)}`);
        console.log(` Status: ${policy.enabled ? theme.colors.success('Enabled') : theme.colors.error('Disabled')}`);
        console.log();
      });
    } else {
      console.log(theme.colors.muted('No active policies.'));
      console.log();
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  }
}
