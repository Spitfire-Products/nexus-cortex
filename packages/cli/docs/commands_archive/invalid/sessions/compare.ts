/**
 * Session Compare Command
 * Compare two sessions
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SessionCompareOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Compare two sessions
 */
export async function sessionCompare(
  id1?: string,
  id2?: string,
  options: SessionCompareOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id1 || !id2) {
      console.error(theme.colors.error('Error: Two session IDs are required'));
      console.log(theme.colors.muted('\nUsage: cortex sessions compare <id1> <id2>'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex sessions compare abc-123 def-456'));
      console.log();
      process.exit(1);
      return;
    }

    // Compare sessions
    const response = await client.post('/sessions/compare', { id1, id2 });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📊 Session Comparison\n'));
    console.log(theme.colors.secondary('Sessions:'));
    console.log(`  Session 1: ${theme.colors.highlight(id1)}`);
    console.log(`  Session 2: ${theme.colors.highlight(id2)}`);
    console.log();

    if (response.metrics) {
      console.log(theme.colors.secondary('Metrics:'));
      console.log(`  Messages: ${theme.colors.highlight(response.metrics.messages1)} vs ${theme.colors.highlight(response.metrics.messages2)}`);
      console.log(`  Tokens: ${theme.colors.highlight(response.metrics.tokens1)} vs ${theme.colors.highlight(response.metrics.tokens2)}`);
      console.log(`  Duration: ${theme.colors.highlight(response.metrics.duration1)} vs ${theme.colors.highlight(response.metrics.duration2)}`);
      console.log();
    }

    if (response.similarity) {
      console.log(`  Similarity: ${theme.colors.highlight(response.similarity + '%')}`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
