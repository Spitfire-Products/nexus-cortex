/**
 * Show detailed information about a specific model
 */
import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatContextWindow, formatPrice } from '../../utils/formatters.js';

export interface ModelInfoOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Display detailed information about a specific model
 */
export async function modelInfo(
  modelId: string,
  options: ModelInfoOptions = {}
): Promise<void> {
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

    // Get all models and find the requested one
    const models = await client.listModels();
    const model = models.find(m => m.id === modelId);

    if (!model) {
      console.error(theme.colors.error(`Model not found: ${modelId}`));
      console.log(theme.colors.muted('\nUse "cortex models list" to see available models'));
      process.exit(1);
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(model, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n${model.displayName || model.id}`));
    console.log();

    console.log(theme.colors.highlight('ID:'), theme.colors.secondary(model.id));
    console.log(theme.colors.highlight('Provider:'), theme.colors.secondary(model.owned_by));
    console.log(theme.colors.highlight('API Pattern:'), theme.colors.secondary(model.apiPattern));
    console.log();

    console.log(theme.colors.highlight('Capabilities:'));
    console.log(theme.colors.muted(` Context Window: ${formatContextWindow(model.contextWindow)}`));
    console.log(theme.colors.muted(` Max Output: ${model.maxOutputTokens.toLocaleString()} tokens`));
    console.log();

    console.log(theme.colors.highlight('Pricing:'));
    console.log(theme.colors.muted(` Input:  ${formatPrice(model.inputCostPer1M)}/1M tokens`));
    console.log(theme.colors.muted(` Output: ${formatPrice(model.outputCostPer1M)}/1M tokens`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
