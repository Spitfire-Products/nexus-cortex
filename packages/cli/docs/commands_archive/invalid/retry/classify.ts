/**
 * Retry Classify Command
 * Classify error message
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface RetryClassifyOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Classify error message
 */
export async function retryClassify(
  error?: string,
  options: RetryClassifyOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!error) {
      console.error(theme.colors.error('Error: Error message is required'));
      console.log(theme.colors.muted('\nUsage: cortex errors classify <error>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex errors classify "Connection timeout"'));
      console.log(theme.colors.muted('  cortex errors classify "Rate limit exceeded"'));
      console.log();
      process.exit(1);
      return;
    }

    // Classify error
    const response = await client.post('/errors/classify', { error });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🔍 Error Classification\n'));
    console.log(theme.colors.secondary('Error:'));
    console.log(`  ${theme.colors.muted(error)}`);
    console.log();

    if (response.classification) {
      console.log(theme.colors.secondary('Classification:'));
      console.log(`  Type: ${theme.colors.highlight(response.classification.type)}`);
      console.log(`  Severity: ${theme.colors.highlight(response.classification.severity)}`);
      console.log(`  Retryable: ${response.classification.retryable ? theme.colors.success('Yes') : theme.colors.error('No')}`);

      if (response.classification.suggestion) {
        console.log();
        console.log(theme.colors.secondary('Suggestion:'));
        console.log(`  ${theme.colors.muted(response.classification.suggestion)}`);
      }
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
