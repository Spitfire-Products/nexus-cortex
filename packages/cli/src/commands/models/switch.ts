/**
 * Model Switch Command
 * Switch to a different model mid-session
 */

import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelSwitchOptions {
  serverUrl?: string;
  json?: boolean;
  reason?: string;
}

/**
 * Switch to a different model
 */
export async function modelSwitch(
  _sessionId: string,
  modelId: string,
  options: ModelSwitchOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const theme = ThemeManager.getTheme();

  // Determine mode from environment
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';

  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || config.serverUrl || 'http://localhost:4000',
    debug: process.env.DEBUG === 'true'
  });

  try {
    // Validation
    if (!modelId) {
      console.error(theme.colors.error('Error: Model ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex models switch <session-id> <model-id>'));
      console.log(theme.colors.muted('Example: cortex models switch current claude-sonnet-4'));
      process.exitCode = 1;
      return;
    }

    await client.initialize();

    // Switch model (sessionId not needed in direct mode)
    await client.switchModel(modelId, options.reason);

    // Get the new model info
    const currentModel = client.getCurrentModel();

    // JSON output
    if (options.json) {
      const output = {
        modelId: currentModel.id,
        modelName: currentModel.displayName,
        provider: currentModel.provider,
        contextWindow: currentModel.limits.contextWindow,
        reason: options.reason
      };
      console.log(JSON.stringify(output, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Model switched successfully\n'));

    console.log(theme.colors.secondary('New Model:'));
    console.log(` ${theme.colors.highlight(currentModel.displayName)} (${currentModel.id})`);
    console.log(` Provider: ${theme.colors.muted(currentModel.provider)}`);
    console.log(` Context Window: ${theme.colors.muted(currentModel.limits.contextWindow.toLocaleString() + ' tokens')}`);

    if (options.reason) {
      console.log(` Reason: ${theme.colors.muted(options.reason)}`);
    }
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exitCode = 1;
  } finally {
    await client.disconnect();
  }
}
