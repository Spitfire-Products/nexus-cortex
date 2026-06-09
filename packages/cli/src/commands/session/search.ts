/**
 * Search sessions by keyword
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface SessionsSearchOptions {
  serverUrl?: string;
  limit?: number;
  json?: boolean;
}

/**
 * Search sessions by keyword
 */
export async function sessionsSearch(
  query: string,
  options: SessionsSearchOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    const response = await client.get('/sessions');
    let sessions = response.sessions || [];

    // Filter by query (search in messages, model, sessionId)
    const lowerQuery = query.toLowerCase();
    sessions = sessions.filter((session: any) => {
      const matchId = session.sessionId?.toLowerCase().includes(lowerQuery);
      const matchModel = session.model?.toLowerCase().includes(lowerQuery);

      // Search in message content
      const matchMessages = session.messages?.some((msg: any) =>
        msg.content?.toLowerCase().includes(lowerQuery)
      );

      return matchId || matchModel || matchMessages;
    });

    // Apply limit
    if (options.limit) {
      sessions = sessions.slice(0, options.limit);
    }

    if (options.json) {
      console.log(JSON.stringify({ sessions, count: sessions.length }, null, 2));
      return;
    }

    console.log(theme.colors.primary(`\nSearch Results for "${query}"\n`));

    if (sessions.length === 0) {
      console.log(theme.colors.warning('No sessions found'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Found ${sessions.length} session(s):\n`));

    sessions.forEach((session: any) => {
      const date = session.createdAt ? formatDate(new Date(session.createdAt)) : 'Unknown';
      const messageCount = session.messages?.length || 0;

      console.log(theme.colors.primary(` ${session.sessionId}`));
      console.log(theme.colors.muted(` Model: ${session.model || 'Unknown'}`));
      console.log(theme.colors.muted(` Messages: ${messageCount}`));
      console.log(theme.colors.muted(` Created: ${date}`));

      // Show first user message as preview
      const firstUserMsg = session.messages?.find((m: any) => m.role === 'user');
      if (firstUserMsg && firstUserMsg.content) {
        const preview = firstUserMsg.content.substring(0, 100);
        const truncated = firstUserMsg.content.length > 100 ? '...' : '';
        console.log(theme.colors.muted(` Preview: ${preview}${truncated}`));
      }
      console.log();
    });

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
