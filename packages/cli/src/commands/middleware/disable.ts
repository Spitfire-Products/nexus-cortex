/**
 * Middleware Disable Command
 * Disables a specific middleware system
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MiddlewareDisableOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Disable a middleware system
 */
export async function middlewareDisable(
  name?: string,
  options: MiddlewareDisableOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: Middleware name is required'));
      console.log(theme.colors.muted('\nUsage: cortex middleware disable <name>'));
      console.log(theme.colors.muted('Example: cortex middleware disable retry'));
      process.exit(1);
      return;
    }

    // Disable middleware
    const response = await client.post(`/middleware/${name}/disable`, {});

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Middleware disabled successfully\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(` Name: ${theme.colors.highlight(name)}`);
    console.log(` Status: ${theme.colors.muted('Disabled')}`);

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
