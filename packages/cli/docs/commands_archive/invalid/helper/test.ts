/**
 * Helper Test Command
 * Test the helper model with a prompt
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface HelperTestOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Test helper model with a prompt
 *
 * @param prompt - Optional test prompt (defaults to simple test)
 */
export async function helperTest(
  prompt?: string,
  options: HelperTestOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Use default prompt if none provided
    const testPrompt = prompt || 'Hello! Please respond with a brief greeting to confirm you are working.';

    // Test the helper model
    const response = await client.post('/helper/test', { prompt: testPrompt });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🧪 Helper Model Test\n'));

    console.log(theme.colors.secondary('Model:'));
    console.log(`  ${theme.colors.highlight(response.model || 'Unknown')}`);

    console.log();
    console.log(theme.colors.secondary('Prompt:'));
    console.log(`  ${theme.colors.muted(testPrompt)}`);

    console.log();
    console.log(theme.colors.secondary('Response:'));
    console.log(`  ${response.response || theme.colors.error('No response received')}`);

    // Performance metrics
    if (response.metrics) {
      console.log();
      console.log(theme.colors.secondary('Metrics:'));
      console.log(`  Duration: ${theme.colors.highlight(response.metrics.duration + 'ms')}`);

      if (response.metrics.tokens) {
        console.log(`  Input Tokens: ${theme.colors.highlight(response.metrics.tokens.input.toString())}`);
        console.log(`  Output Tokens: ${theme.colors.highlight(response.metrics.tokens.output.toString())}`);
        console.log(`  Total Tokens: ${theme.colors.highlight(response.metrics.tokens.total.toString())}`);
      }
    }

    // Status
    if (response.success !== undefined) {
      console.log();
      const statusColor = response.success ? theme.colors.success : theme.colors.error;
      const statusText = response.success ? '✓ Test successful' : '✗ Test failed';
      console.log(statusColor(statusText));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
