/**
 * Mentorship Model Command
 * Set the helper model for mentorship system
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MentorshipModelOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Set helper model for mentorship
 *
 * @param modelId - The model ID to use for mentorship
 */
export async function mentorshipModel(
  modelId: string,
  options: MentorshipModelOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    if (!modelId) {
      console.error(theme.colors.error('Error: Model ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex mentorship model <model-id>'));
      console.log(theme.colors.muted('Example: cortex mentorship model grok-beta'));
      process.exit(1);
    }

    // Validate model exists
    const models = await client.listModels();
    const modelExists = models.some((m: any) => m.id === modelId);

    if (!modelExists) {
      console.error(theme.colors.error(`Error: Model '${modelId}' not found`));
      console.log(theme.colors.muted('\nList available models: cortex models list'));
      process.exit(1);
    }

    // Set the helper model
    const response = await client.post('/mentorship/model', { modelId });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success(`\n✓ Helper model set to: ${theme.colors.highlight(modelId)}\n`));

    if (response.message) {
      console.log(theme.colors.muted(response.message));
      console.log();
    }

    console.log(theme.colors.muted('View configuration: cortex mentorship status'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
