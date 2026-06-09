/**
 * List Checkpoints Command
 * List all checkpoints for a session
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface ListCheckpointsOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function listCheckpoints(sessionId: string, options: ListCheckpointsOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);

  try {
    const response = await client.get(`/sessions/${sessionId}/checkpoints`);
    const checkpoints = response.checkpoints || [];

    if (options.json) {
      console.log(JSON.stringify({ checkpoints }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.secondary(`\n Checkpoints for session ${sessionId}\n`));

    if (checkpoints.length === 0) {
      console.log(theme.colors.muted('No checkpoints found'));
      return;
    }

    for (const checkpoint of checkpoints) {
      console.log(theme.colors.highlight(checkpoint.id));
      console.log(theme.colors.muted(` Description: ${checkpoint.description || '(no description)'}`));
      console.log(theme.colors.muted(` Created: ${formatDate(checkpoint.timestamp)}`));
      console.log(theme.colors.muted(` Messages: ${checkpoint.messageIds.length}`));
      console.log();
    }

    console.log(theme.colors.secondary('Resume from a checkpoint:'));
    console.log(theme.colors.muted(` cortex sessions resume ${sessionId} --checkpoint-id <id>`));
  } catch (error: any) {
    console.error(theme.colors.error('Error listing checkpoints:'), error.message);
    process.exit(1);
  }
}
