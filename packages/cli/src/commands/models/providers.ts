/**
 * Models Providers Command
 * List all providers
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsProvidersOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List all providers
 */
export async function modelsProviders(
  options: ModelsProvidersOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get providers
    const response = await client.get('/models/providers');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n Model Providers\n'));

    if (response.providers && response.providers.length > 0) {
      response.providers.forEach((provider: any) => {
        console.log(theme.colors.secondary(`${provider.name}:`));
        console.log(` Models: ${theme.colors.highlight(provider.modelCount.toString())}`);
        console.log(` Status: ${provider.available ? theme.colors.success('Available') : theme.colors.error('Unavailable')}`);
        if (provider.description) {
          console.log(` ${theme.colors.muted(provider.description)}`);
        }
        console.log();
      });
    }

    console.log(theme.colors.muted('List models by provider: cortex models list --provider <name>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
