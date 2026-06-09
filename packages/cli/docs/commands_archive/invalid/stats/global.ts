/**
 * Show global statistics
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface StatsGlobalOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show global statistics
 */
export async function statsGlobal(options: StatsGlobalOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Get sessions to calculate stats
    const sessionsResponse = await client.get('/sessions');
    const sessions = sessionsResponse.sessions || [];

    // Get models for context
    const models = await client.listModels();

    // Calculate statistics
    const totalSessions = sessions.length;
    const totalMessages = sessions.reduce((sum: number, s: any) => sum + (s.messages?.length || 0), 0);

    // Token statistics
    let totalTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;

    sessions.forEach((s: any) => {
      if (s.metadata) {
        totalTokens += s.metadata.totalTokens || 0;
        inputTokens += s.metadata.inputTokens || 0;
        outputTokens += s.metadata.outputTokens || 0;
      }
    });

    // Count by model
    const byModel: Record<string, number> = {};
    sessions.forEach((s: any) => {
      if (s.model) {
        byModel[s.model] = (byModel[s.model] || 0) + 1;
      }
    });

    // Get most used model
    const mostUsedModel = Object.entries(byModel)
      .sort(([, a], [, b]) => (b as number) - (a as number))[0];

    if (options.json) {
      console.log(JSON.stringify({
        totalSessions,
        totalMessages,
        totalTokens,
        inputTokens,
        outputTokens,
        availableModels: models.length,
        byModel,
        mostUsedModel: mostUsedModel ? { model: mostUsedModel[0], count: mostUsedModel[1] } : null
      }, null, 2));
      return;
    }

    console.log(theme.colors.primary('\n📊 Global Statistics\n'));
    console.log(theme.colors.secondary('─'.repeat(50)));
    console.log();

    // Sessions
    console.log(theme.colors.primary('Sessions:'));
    console.log(theme.colors.muted(`  Total: ${totalSessions}`));
    console.log();

    // Messages
    console.log(theme.colors.primary('Messages:'));
    console.log(theme.colors.muted(`  Total: ${totalMessages}`));
    if (totalSessions > 0) {
      const avgMessages = (totalMessages / totalSessions).toFixed(1);
      console.log(theme.colors.muted(`  Average per session: ${avgMessages}`));
    }
    console.log();

    // Tokens
    if (totalTokens > 0) {
      console.log(theme.colors.primary('Tokens:'));
      console.log(theme.colors.muted(`  Total: ${totalTokens.toLocaleString()}`));
      console.log(theme.colors.muted(`  Input: ${inputTokens.toLocaleString()}`));
      console.log(theme.colors.muted(`  Output: ${outputTokens.toLocaleString()}`));
      console.log();
    }

    // Models
    console.log(theme.colors.primary('Models:'));
    console.log(theme.colors.muted(`  Available: ${models.length}`));
    console.log(theme.colors.muted(`  Used in sessions: ${Object.keys(byModel).length}`));
    console.log();

    // Most used model
    if (mostUsedModel) {
      console.log(theme.colors.primary('Most Used Model:'));
      console.log(theme.colors.muted(`  ${mostUsedModel[0]} (${mostUsedModel[1]} sessions)`));
      console.log();
    }

    // Usage by model
    if (Object.keys(byModel).length > 0) {
      console.log(theme.colors.primary('Usage by Model:'));
      const sorted = Object.entries(byModel)
        .sort(([, a], [, b]) => (b as number) - (a as number))
        .slice(0, 5); // Top 5

      sorted.forEach(([model, count]) => {
        const percentage = ((count as number / totalSessions) * 100).toFixed(1);
        console.log(theme.colors.muted(`  ${model}: ${count} (${percentage}%)`));
      });
      console.log();
    }

    console.log(theme.colors.secondary('─'.repeat(50)));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
