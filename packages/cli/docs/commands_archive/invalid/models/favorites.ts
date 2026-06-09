/**
 * Models Favorites Command
 * List favorite models
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsFavoritesOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * List favorite models
 */
export async function modelsFavorites(
  options: ModelsFavoritesOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get favorites
    const response = await client.get('/models/favorites');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n⭐ Favorite Models\n'));

    if (response.favorites && response.favorites.length > 0) {
      response.favorites.forEach((model: any) => {
        console.log(`  ${theme.colors.highlight(model.id)}`);
        console.log(`    ${theme.colors.muted(model.name)}`);
        if (model.provider) {
          console.log(`    Provider: ${model.provider}`);
        }
        console.log();
      });
    } else {
      console.log(theme.colors.muted('No favorite models yet.'));
      console.log();
      console.log(theme.colors.muted('Add favorites with: cortex models favorite <id>'));
      console.log();
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
