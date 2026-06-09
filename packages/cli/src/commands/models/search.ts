/**
 * Search models by keyword
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsSearchOptions {
  serverUrl?: string;
  provider?: string;
  json?: boolean;
}

/**
 * Search models by keyword
 */
export async function modelsSearch(
  query: string,
  options: ModelsSearchOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    let models = await client.listModels();

    // Filter by query (search in id, displayName, owned_by)
    const lowerQuery = query.toLowerCase();
    models = models.filter((model) => {
      const matchId = model.id?.toLowerCase().includes(lowerQuery);
      const matchName = model.displayName?.toLowerCase().includes(lowerQuery);
      const matchProvider = model.owned_by?.toLowerCase().includes(lowerQuery);
      return matchId || matchName || matchProvider;
    });

    // Filter by provider if specified
    if (options.provider) {
      models = models.filter((model) =>
        model.owned_by?.toLowerCase() === options.provider?.toLowerCase()
      );
    }

    if (options.json) {
      console.log(JSON.stringify({ models, count: models.length }, null, 2));
      return;
    }

    console.log(theme.colors.primary(`\nSearch Results for "${query}"\n`));

    if (models.length === 0) {
      console.log(theme.colors.warning('No models found'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Found ${models.length} model(s):\n`));

    models.forEach((model) => {
      console.log(theme.colors.primary(` ${model.id}`));
      if (model.displayName) {
        console.log(theme.colors.muted(` Name: ${model.displayName}`));
      }
      if (model.owned_by) {
        console.log(theme.colors.muted(` Provider: ${model.owned_by}`));
      }
      console.log();
    });

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
