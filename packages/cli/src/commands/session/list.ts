/**
 * List Sessions Command
 * Lists all sessions with metadata
 */
import { OrchestratorClient } from '../../orchestrator/OrchestratorClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface ListSessionsOptions {
  serverUrl?: string;
  json?: boolean;
  limit?: number;
}

export async function listSessions(options: ListSessionsOptions): Promise<void> {
  const theme = ThemeManager.getTheme();

  // Determine mode from environment
  const envMode = (process.env.CORTEX_MODE);
  const mode = envMode === 'server' ? 'server' : 'direct';

  const client = new OrchestratorClient({
    mode,
    serverUrl: options.serverUrl || ConfigManager.get('serverUrl'),
    debug: process.env.DEBUG === 'true'
  });

  try {
    await client.initialize();

    const response = await client.listSessions();
    const sessions = response.sessions || [];

    // Apply limit if specified
    const sessionsToShow = options.limit
      ? sessions.slice(0, options.limit)
      : sessions;

    if (options.json) {
      console.log(JSON.stringify({ sessions: sessionsToShow }, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.secondary(`\n Sessions (${sessions.length} total)\n`));

    if (sessionsToShow.length === 0) {
      console.log(theme.colors.muted('No sessions found'));
      return;
    }

    for (const session of sessionsToShow) {
      console.log(theme.colors.highlight(session.sessionId.substring(0, 8)));
      console.log(theme.colors.muted(` Created: ${formatDate(session.metadata.startTime)}`));
      console.log(theme.colors.muted(` Messages: ${session.messageCount}`));
      console.log(theme.colors.muted(` Size: ${formatBytes(session.fileSize)}`));
      console.log();
    }

    if (options.limit && sessions.length > options.limit) {
      console.log(theme.colors.muted(`... and ${sessions.length - options.limit} more`));
    }
  } catch (error: any) {
    console.error(theme.colors.error('Error listing sessions:'), error.message);
    process.exit(1);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
