/**
 * Context Strategy Command
 * Set context strategy
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ContextStrategyOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Set context strategy
 */
export async function contextStrategy(
  strategy?: string,
  options: ContextStrategyOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Handle get vs set
    if (!strategy) {
      const response = await client.get('/context/strategy');

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log(theme.colors.primary('\n Context Strategy\n'));
      console.log(` Current: ${theme.colors.highlight(response.strategy)}`);
      if (response.description) {
        console.log(` ${theme.colors.muted(response.description)}`);
      }
      console.log();
      return;
    }

    // Validation
    const validStrategies = ['aggressive', 'balanced', 'conservative', 'manual'];
    if (!validStrategies.includes(strategy.toLowerCase())) {
      console.error(theme.colors.error(`Error: Invalid strategy '${strategy}'`));
      console.log(theme.colors.muted('\nValid strategies: ' + validStrategies.join(', ')));
      console.log(theme.colors.muted('\nUsage: cortex context strategy <strategy>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted(' cortex context strategy balanced'));
      console.log();
      process.exit(1);
      return;
    }

    // Set strategy
    const response = await client.post('/context/strategy', {
      strategy: strategy.toLowerCase()
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Strategy updated\n'));
    console.log(` Strategy: ${theme.colors.highlight(strategy)}`);
    if (response.description) {
      console.log(` ${theme.colors.muted(response.description)}`);
    }
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
