/**
 * Quick test of a model with a prompt
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ModelsTestOptions {
  serverUrl?: string;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Test a model with a quick prompt
 */
export async function modelsTest(
  modelId: string,
  prompt: string = 'Hello! Please respond with a brief greeting.',
  options: ModelsTestOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    console.log(theme.colors.primary(`\nTesting model: ${modelId}\n`));
    console.log(theme.colors.secondary('Prompt:'));
    console.log(theme.colors.muted(`  ${prompt}`));
    console.log();
    console.log(theme.colors.secondary('Response:'));
    console.log();

    // Send message and stream response
    let responseText = '';

    for await (const event of client.streamMessage(
      [{ role: 'user', content: prompt }],
      {
        model: modelId,
        max_tokens: options.maxTokens || 150,
        temperature: options.temperature
      }
    )) {
      if (event.type === 'content_block_delta' && event.delta?.text) {
        process.stdout.write(event.delta.text);
        responseText += event.delta.text;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }
    }

    console.log('\n');
    console.log(theme.colors.success('✓ Test complete'));
    console.log(theme.colors.muted(`  Response length: ${responseText.length} characters`));
    console.log();

  } catch (error: any) {
    console.log('\n');

    if (error.message.includes('404') || error.message.includes('not found')) {
      console.error(theme.colors.error(`✗ Model not found: ${modelId}`));
      console.log();
      console.log(theme.colors.muted('Available models:'));
      console.log(theme.colors.muted('  cortex models list'));
    } else if (error.message.includes('401') || error.message.includes('403')) {
      console.error(theme.colors.error('✗ Authentication error'));
      console.log();
      console.log(theme.colors.muted('Check your API keys:'));
      console.log(theme.colors.muted('  cortex config get'));
    } else {
      console.error(theme.colors.error(`✗ Error: ${error.message}`));
    }
    console.log();
    process.exit(1);
  }
}
