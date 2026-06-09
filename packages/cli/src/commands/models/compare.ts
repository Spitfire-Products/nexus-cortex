/**
 * Compare two models side-by-side
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsCompareOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Compare two models
 */
export async function modelsCompare(
  modelId1: string,
  modelId2: string,
  options: ModelsCompareOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    const models = await client.listModels();

    const model1 = models.find((m) => m.id === modelId1);
    const model2 = models.find((m) => m.id === modelId2);

    if (!model1) {
      console.error(theme.colors.error(`✗ Model not found: ${modelId1}`));
      process.exit(1);
    }

    if (!model2) {
      console.error(theme.colors.error(`✗ Model not found: ${modelId2}`));
      process.exit(1);
    }

    if (options.json) {
      console.log(JSON.stringify({ model1, model2 }, null, 2));
      return;
    }

    console.log(theme.colors.primary('\nModel Comparison\n'));
    console.log(theme.colors.secondary('─'.repeat(60)));
    console.log();

    // ID
    console.log(theme.colors.primary('ID:'));
    console.log(theme.colors.muted(` ${model1.id}`));
    console.log(theme.colors.muted(` ${model2.id}`));
    console.log();

    // Name
    console.log(theme.colors.primary('Name:'));
    console.log(theme.colors.muted(` ${model1.displayName || 'N/A'}`));
    console.log(theme.colors.muted(` ${model2.displayName || 'N/A'}`));
    console.log();

    // Provider
    console.log(theme.colors.primary('Provider:'));
    console.log(theme.colors.muted(` ${model1.owned_by || 'N/A'}`));
    console.log(theme.colors.muted(` ${model2.owned_by || 'N/A'}`));
    console.log();

    // Context Window
    if (model1.contextWindow || model2.contextWindow) {
      console.log(theme.colors.primary('Context Window:'));
      console.log(theme.colors.muted(` ${model1.contextWindow?.toLocaleString() || 'N/A'}`));
      console.log(theme.colors.muted(` ${model2.contextWindow?.toLocaleString() || 'N/A'}`));
      console.log();
    }

    // Max Tokens
    if (model1.maxOutputTokens || model2.maxOutputTokens) {
      console.log(theme.colors.primary('Max Output Tokens:'));
      console.log(theme.colors.muted(` ${model1.maxOutputTokens?.toLocaleString() || 'N/A'}`));
      console.log(theme.colors.muted(` ${model2.maxOutputTokens?.toLocaleString() || 'N/A'}`));
      console.log();
    }

    // Pricing
    console.log(theme.colors.primary('Pricing (per 1M tokens):'));
    console.log(theme.colors.muted(` Input: $${model1.inputCostPer1M || 0} / $${model2.inputCostPer1M || 0}`));
    console.log(theme.colors.muted(` Output: $${model1.outputCostPer1M || 0} / $${model2.outputCostPer1M || 0}`));
    console.log();

    console.log(theme.colors.secondary('─'.repeat(60)));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
