/**
 * Session Merge Command
 * Merge two sessions
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SessionMergeOptions {
  serverUrl?: string;
  json?: boolean;
  name?: string;
}

/**
 * Merge two sessions
 */
export async function sessionMerge(
  id1?: string,
  id2?: string,
  options: SessionMergeOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id1 || !id2) {
      console.error(theme.colors.error('Error: Two session IDs are required'));
      console.log(theme.colors.muted('\nUsage: cortex sessions merge <id1> <id2> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --name <name>    Name for merged session'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex sessions merge abc-123 def-456'));
      console.log(theme.colors.muted('  cortex sessions merge abc-123 def-456 --name "Combined Session"'));
      console.log();
      process.exit(1);
      return;
    }

    // Merge sessions
    const payload: any = { id1, id2 };
    if (options.name) payload.name = options.name;

    const response = await client.post('/sessions/merge', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Sessions merged\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Session 1: ${theme.colors.highlight(id1)}`);
    console.log(`  Session 2: ${theme.colors.highlight(id2)}`);
    console.log(`  New ID: ${theme.colors.highlight(response.id)}`);

    if (response.messages) {
      console.log(`  Total messages: ${theme.colors.highlight(response.messages.toString())}`);
    }

    console.log();
    console.log(theme.colors.muted('View merged session: cortex sessions view ' + response.id));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
