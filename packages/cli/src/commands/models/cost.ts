/**
 * Show model pricing details
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsCostOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show pricing details for a model
 */
export async function modelsCost(
  modelId: string,
  options: ModelsCostOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    const models = await client.listModels();

    const model = models.find((m) => m.id === modelId);

    if (!model) {
      console.error(theme.colors.error(`✗ Model not found: ${modelId}`));
      console.log();
      console.log(theme.colors.muted('Available models:'));
      console.log(theme.colors.muted(' cortex models list'));
      console.log();
      process.exit(1);
    }

    if (options.json) {
      const costInfo = {
        id: model.id,
        name: model.displayName,
        inputCostPer1M: model.inputCostPer1M,
        outputCostPer1M: model.outputCostPer1M
      };
      console.log(JSON.stringify(costInfo, null, 2));
      return;
    }

    console.log(theme.colors.primary(`\nPricing for ${model.displayName || model.id}\n`));

    // Input pricing (per 1M tokens)
    console.log(theme.colors.secondary('Input Tokens:'));
    console.log(theme.colors.muted(` $${model.inputCostPer1M} per 1M tokens`));
    console.log(theme.colors.muted(` $${(model.inputCostPer1M / 1000).toFixed(4)} per 1K tokens`));
    console.log();

    // Output pricing (per 1M tokens)
    console.log(theme.colors.secondary('Output Tokens:'));
    console.log(theme.colors.muted(` $${model.outputCostPer1M} per 1M tokens`));
    console.log(theme.colors.muted(` $${(model.outputCostPer1M / 1000).toFixed(4)} per 1K tokens`));
    console.log();

    // Cost examples
    console.log(theme.colors.secondary('Example Costs:'));

    const input10k = ((model.inputCostPer1M / 1000) * 10).toFixed(4);
    const output10k = ((model.outputCostPer1M / 1000) * 10).toFixed(4);
    const input100k = ((model.inputCostPer1M / 1000) * 100).toFixed(4);
    const output100k = ((model.outputCostPer1M / 1000) * 100).toFixed(4);

    console.log(theme.colors.muted(` 10K input tokens: $${input10k}`));
    console.log(theme.colors.muted(` 10K output tokens: $${output10k}`));
    console.log(theme.colors.muted(` 100K input tokens: $${input100k}`));
    console.log(theme.colors.muted(` 100K output tokens: $${output100k}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
