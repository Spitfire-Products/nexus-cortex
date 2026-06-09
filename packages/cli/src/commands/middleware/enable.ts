/**
 * Middleware Enable Command
 * Enables a specific middleware system
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MiddlewareEnableOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Enable a middleware system
 */
export async function middlewareEnable(
  name?: string,
  options: MiddlewareEnableOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: Middleware name is required'));
      console.log(theme.colors.muted('\nUsage: cortex middleware enable <name>'));
      console.log(theme.colors.muted('Example: cortex middleware enable mentorship'));
      process.exit(1);
      return;
    }

    // Enable middleware
    const response = await client.post(`/middleware/${name}/enable`, {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Middleware enabled successfully\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(` Name: ${theme.colors.highlight(name)}`);
    console.log(` Status: ${theme.colors.success('Enabled')}`);

    if (response.message) {
      console.log(` Message: ${theme.colors.muted(response.message)}`);
    }

    console.log();
    console.log(theme.colors.muted('View status with:'));
    console.log(theme.colors.muted(` cortex middleware status ${name}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
