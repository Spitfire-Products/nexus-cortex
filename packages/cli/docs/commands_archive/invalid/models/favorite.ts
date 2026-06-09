/**
 * Models Favorite Command
 * Add model to favorites
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsFavoriteOptions {
  serverUrl?: string;
  json?: boolean;
  remove?: boolean;
}

/**
 * Add or remove model from favorites
 */
export async function modelsFavorite(
  id?: string,
  options: ModelsFavoriteOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Model ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex models favorite <id> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --remove    Remove from favorites'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex models favorite claude-sonnet-4-5'));
      console.log(theme.colors.muted('  cortex models favorite gpt-4o --remove'));
      console.log();
      process.exit(1);
      return;
    }

    // Add or remove favorite
    const response = await client.post('/models/favorite', {
      id,
      remove: options.remove || false
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    if (options.remove) {
      console.log(theme.colors.success('\n✓ Model removed from favorites\n'));
    } else {
      console.log(theme.colors.success('\n✓ Model added to favorites\n'));
    }

    console.log(theme.colors.secondary('Details:'));
    console.log(`  Model ID: ${theme.colors.highlight(id)}`);

    console.log();
    console.log(theme.colors.muted('View favorites: cortex models favorites'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
