/**
 * Models Alias Command
 * Create model alias
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsAliasOptions {
  serverUrl?: string;
  json?: boolean;
  remove?: boolean;
}

/**
 * Create or remove model alias
 */
export async function modelsAlias(
  name?: string,
  id?: string,
  options: ModelsAliasOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Handle listing aliases
    if (!name) {
      const response = await client.get('/models/aliases');

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log(theme.colors.primary('\n🏷️  Model Aliases\n'));
      if (response.aliases && Object.keys(response.aliases).length > 0) {
        Object.entries(response.aliases).forEach(([alias, modelId]) => {
          console.log(`  ${theme.colors.highlight(alias)} → ${theme.colors.muted(modelId as string)}`);
        });
      } else {
        console.log(theme.colors.muted('No aliases defined yet.'));
      }
      console.log();
      return;
    }

    // Validation for create/remove
    if (!options.remove && !id) {
      console.error(theme.colors.error('Error: Model ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex models alias <name> <id> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --remove    Remove alias'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex models alias fast claude-sonnet-4-5'));
      console.log(theme.colors.muted('  cortex models alias fast --remove'));
      console.log();
      process.exit(1);
      return;
    }

    // Create or remove alias
    const response = await client.post('/models/alias', {
      name,
      id: id || undefined,
      remove: options.remove || false
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    if (options.remove) {
      console.log(theme.colors.success('\n✓ Alias removed\n'));
      console.log(`  Alias: ${theme.colors.highlight(name)}`);
    } else {
      console.log(theme.colors.success('\n✓ Alias created\n'));
      console.log(`  Alias: ${theme.colors.highlight(name)} → ${theme.colors.muted(id!)}`);
      console.log();
      console.log(theme.colors.muted('Use alias: cortex chat --model ' + name));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
