/**
 * Middleware Config Command
 * Shows configuration details for a specific middleware
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MiddlewareConfigOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show middleware configuration
 */
export async function middlewareConfig(
  name?: string,
  options: MiddlewareConfigOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: Middleware name is required'));
      console.log(theme.colors.muted('\nUsage: cortex middleware config <name>'));
      console.log(theme.colors.muted('Example: cortex middleware config retry'));
      process.exit(1);
      return;
    }

    // Fetch middleware configuration
    const allConfig = await client.get('/middleware/config');
    const response = {
      name,
      config: allConfig.config?.[name] || {},
      enabled: allConfig.middleware?.[name] || false,
      envVars: allConfig.envVars?.[name] || [],
      defaults: allConfig.defaults?.[name] || {}
    };

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n⚙  Middleware Configuration: ${response.name}\n`));

    // Configuration
    if (response.config && Object.keys(response.config).length > 0) {
      console.log(theme.colors.secondary('Current Configuration:'));
      for (const [key, value] of Object.entries(response.config)) {
        console.log(` ${key}: ${theme.colors.highlight(String(value))}`);
      }
      console.log();
    } else {
      console.log(theme.colors.muted('No configuration settings available.\n'));
    }

    // Environment Variables
    if (response.envVars && response.envVars.length > 0) {
      console.log(theme.colors.secondary('Environment Variables:'));
      for (const envVar of response.envVars) {
        const isSet = envVar.value !== undefined && envVar.value !== null;
        const status = isSet ? theme.colors.success('✓ Set') : theme.colors.muted('○ Not set');

        console.log(` ${envVar.name}: ${status}`);

        if (envVar.description) {
          console.log(` ${theme.colors.muted(envVar.description)}`);
        }

        if (envVar.default !== undefined) {
          console.log(` Default: ${theme.colors.muted(String(envVar.default))}`);
        }

        console.log();
      }
    }

    // Defaults
    if (response.defaults && Object.keys(response.defaults).length > 0) {
      console.log(theme.colors.secondary('Default Values:'));
      for (const [key, value] of Object.entries(response.defaults)) {
        console.log(` ${key}: ${theme.colors.muted(String(value))}`);
      }
      console.log();
    }

    console.log(theme.colors.muted('Manage this middleware:'));
    console.log(theme.colors.muted(` cortex middleware status ${name}`));
    console.log(theme.colors.muted(` cortex middleware enable ${name}`));
    console.log(theme.colors.muted(` cortex middleware disable ${name}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
