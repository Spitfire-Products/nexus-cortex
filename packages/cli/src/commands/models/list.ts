/**
 * List all available models
 */
import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatContextWindow, formatPrice } from '../../utils/formatters.js';

export async function listModels(options: {
  serverUrl?: string;
  provider?: string;
  json?: boolean;
}): Promise<void> {
  const theme = ThemeManager.getTheme();

  // Determine mode from environment
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';

  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || ConfigManager.get('serverUrl'),
    debug: process.env.DEBUG === 'true'
  });

  try {
    await client.initialize();
    const models = await client.listModels();

    // Filter by provider if specified
    let filtered = models;
    if (options.provider) {
      const providerLower = options.provider.toLowerCase();
      filtered = models.filter(m =>
        m.owned_by.toLowerCase() === providerLower
      );
    }

    if (options.json) {
      console.log(JSON.stringify(filtered, null, 2));
      return;
    }

    // Group by provider
    const byProvider: Record<string, typeof filtered> = {};
    for (const model of filtered) {
      if (!byProvider[model.owned_by]) {
        byProvider[model.owned_by] = [];
      }
      byProvider[model.owned_by]!.push(model);
    }

    console.log(theme.colors.secondary(`\n Available Models (${filtered.length} total)\n`));

    for (const [provider, providerModels] of Object.entries(byProvider)) {
      console.log(theme.colors.primary(`${provider} (${providerModels.length} models):`));

      for (const model of providerModels) {
        const contextFormatted = formatContextWindow(model.contextWindow);
        const inputCost = formatPrice(model.inputCostPer1M);
        const outputCost = formatPrice(model.outputCostPer1M);

        console.log(
          ` ${theme.colors.success('✓')} ${theme.colors.highlight(model.id.padEnd(40))} ` +
          `${theme.colors.muted(`${contextFormatted} ctx`)} ` +
          `${theme.colors.secondary(`${inputCost}/${outputCost} per 1M`)}`
        );
      }
      console.log();
    }
  } catch (error: any) {
    console.error(theme.colors.error('Error:'), error.message);
    process.exit(1);
  }
}
