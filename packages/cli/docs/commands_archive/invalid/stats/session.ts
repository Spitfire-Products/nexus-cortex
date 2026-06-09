/**
 * Show session-specific statistics
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate, formatDuration } from '../../utils/formatters.js';

export interface StatsSessionOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show detailed statistics for a session
 */
export async function statsSession(
  sessionId: string,
  options: StatsSessionOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    const response = await client.get(`/sessions/${sessionId}`);

    if (!response.session) {
      console.error(theme.colors.error(`✗ Session not found: ${sessionId}`));
      console.log();
      process.exit(1);
    }

    const session = response.session;
    const messages = session.messages || [];

    // Calculate statistics
    const userMessages = messages.filter((m: any) => m.role === 'user');
    const assistantMessages = messages.filter((m: any) => m.role === 'assistant');
    const systemMessages = messages.filter((m: any) => m.role === 'system');

    // Calculate token counts
    const totalTokens = session.metadata?.totalTokens || 0;
    const inputTokens = session.metadata?.inputTokens || 0;
    const outputTokens = session.metadata?.outputTokens || 0;

    // Calculate duration
    const startTime = session.metadata?.startTime ? new Date(session.metadata.startTime) : null;
    const endTime = session.metadata?.endTime ? new Date(session.metadata.endTime) : new Date();
    const duration = startTime ? endTime.getTime() - startTime.getTime() : 0;

    if (options.json) {
      console.log(JSON.stringify({
        sessionId,
        model: session.model,
        totalMessages: messages.length,
        userMessages: userMessages.length,
        assistantMessages: assistantMessages.length,
        systemMessages: systemMessages.length,
        totalTokens,
        inputTokens,
        outputTokens,
        duration,
        startTime: startTime?.toISOString(),
        endTime: endTime.toISOString()
      }, null, 2));
      return;
    }

    console.log(theme.colors.primary(`\n📊 Session Statistics: ${sessionId}\n`));
    console.log(theme.colors.secondary('─'.repeat(60)));
    console.log();

    // Basic info
    console.log(theme.colors.primary('Model:'));
    console.log(theme.colors.muted(`  ${session.model || 'Unknown'}`));
    console.log();

    // Message counts
    console.log(theme.colors.primary('Messages:'));
    console.log(theme.colors.muted(`  Total: ${messages.length}`));
    console.log(theme.colors.muted(`  User: ${userMessages.length}`));
    console.log(theme.colors.muted(`  Assistant: ${assistantMessages.length}`));
    if (systemMessages.length > 0) {
      console.log(theme.colors.muted(`  System: ${systemMessages.length}`));
    }
    console.log();

    // Token usage
    if (totalTokens > 0) {
      console.log(theme.colors.primary('Token Usage:'));
      console.log(theme.colors.muted(`  Total: ${totalTokens.toLocaleString()}`));
      console.log(theme.colors.muted(`  Input: ${inputTokens.toLocaleString()}`));
      console.log(theme.colors.muted(`  Output: ${outputTokens.toLocaleString()}`));

      if (messages.length > 0) {
        const avgPerMessage = (totalTokens / messages.length).toFixed(0);
        console.log(theme.colors.muted(`  Average per message: ${avgPerMessage}`));
      }
      console.log();
    }

    // Duration
    if (startTime) {
      console.log(theme.colors.primary('Duration:'));
      console.log(theme.colors.muted(`  Start: ${formatDate(startTime)}`));
      console.log(theme.colors.muted(`  End: ${formatDate(endTime)}`));
      console.log(theme.colors.muted(`  Total: ${formatDuration(duration)}`));
      console.log();
    }

    // Content analysis
    if (messages.length > 0) {
      const totalChars = messages.reduce((sum: number, m: any) => {
        return sum + (typeof m.content === 'string' ? m.content.length : 0);
      }, 0);

      console.log(theme.colors.primary('Content:'));
      console.log(theme.colors.muted(`  Total characters: ${totalChars.toLocaleString()}`));
      const avgChars = (totalChars / messages.length).toFixed(0);
      console.log(theme.colors.muted(`  Average per message: ${avgChars}`));
      console.log();
    }

    console.log(theme.colors.secondary('─'.repeat(60)));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
