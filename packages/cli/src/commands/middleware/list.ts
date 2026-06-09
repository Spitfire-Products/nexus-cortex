/**
 * Middleware List Command
 * Lists all middleware systems with their status
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MiddlewareListOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List all middleware systems
 */
export async function middlewareList(options: MiddlewareListOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Fetch middleware config from server
    const response = await client.get('/middleware/config');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    const middlewareStatus = response.middleware || {};
    const middlewareNames = Object.keys(middlewareStatus);

    console.log(theme.colors.primary(`\n⚙  Middleware Systems (${response.enabledCount || 0}/${middlewareNames.length} enabled)\n`));

    if (middlewareNames.length === 0) {
      console.log(theme.colors.muted('No middleware systems found.'));
      console.log();
      return;
    }

    // Map internal names to friendly names
    const nameMap: Record<string, string> = {
      'errorClassifier': 'Error Classifier',
      'retry': 'Retry',
      'permissions': 'Permissions',
      'systemMessage': 'System Message',
      'mentorship': 'Mentorship',
      'helper': 'Helper Model'
    };

    for (const [key, enabled] of Object.entries(middlewareStatus)) {
      const statusIcon = enabled ? '✓' : '○';
      const statusColor = enabled ? theme.colors.success : theme.colors.muted;
      const statusText = enabled ? 'Enabled' : 'Disabled';
      const friendlyName = nameMap[key] || key;

      console.log(theme.colors.secondary(`${friendlyName}:`));
      console.log(` Status: ${statusColor(statusIcon + ' ' + statusText)}`);
      console.log(` Internal Name: ${theme.colors.muted(key)}`);
      console.log();
    }

    console.log(theme.colors.muted('Manage middleware:'));
    console.log(theme.colors.muted(' cortex middleware status <name>'));
    console.log(theme.colors.muted(' cortex middleware enable <name>'));
    console.log(theme.colors.muted(' cortex middleware disable <name>'));
    console.log(theme.colors.muted(' cortex middleware config <name>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
