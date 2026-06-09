/**
 * Resume Session Command
 * Resume from a checkpoint
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ResumeSessionOptions {
  serverUrl?: string;
  checkpointId?: string;
}

export async function resumeSession(sessionId: string, options: ResumeSessionOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);

  try {
    if (!options.checkpointId) {
      console.error(theme.colors.error('Error: --checkpoint-id is required'));
      process.exit(1);
    }

    const result = await client.post(`/sessions/${sessionId}/resume`, {
      checkpointId: options.checkpointId
    });

    console.log(theme.colors.success('✓ Session resumed from checkpoint'));
    console.log(theme.colors.muted(` Checkpoint: ${result.checkpoint.id}`));
    console.log(theme.colors.muted(` Messages loaded: ${result.messageCount}`));
    console.log();
    console.log(theme.colors.secondary('Start interactive chat with this session:'));
    console.log(theme.colors.muted(` cortex chat --session ${sessionId}`));
  } catch (error: any) {
    console.error(theme.colors.error('Error resuming session:'), error.message);
    process.exit(1);
  }
}
