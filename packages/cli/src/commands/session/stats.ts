/**
 * Session Statistics Command
 * Display detailed session statistics
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate, formatNumber } from '../../utils/formatters.js';

export interface SessionStatsOptions {
  serverUrl?: string;
  json?: boolean;
}

export async function sessionStats(sessionId: string, options: SessionStatsOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);

  try {
    const stats = await client.get(`/sessions/${sessionId}/stats`);

    if (options.json) {
      console.log(JSON.stringify(stats, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.secondary(`\n Session Statistics: ${sessionId}\n`));

    // Basic info
    console.log(theme.colors.highlight('Session Info:'));
    console.log(theme.colors.muted(` Created: ${formatDate(stats.created)}`));
    console.log(theme.colors.muted(` Last Modified: ${formatDate(stats.lastModified)}`));
    console.log(theme.colors.muted(` File Size: ${formatBytes(stats.fileSize)}\n`));

    // Message stats
    console.log(theme.colors.highlight('Messages:'));
    console.log(theme.colors.muted(` Total: ${stats.messageCount}`));
    console.log(theme.colors.muted(` User: ${stats.userMessages}`));
    console.log(theme.colors.muted(` Assistant: ${stats.assistantMessages}`));
    console.log(theme.colors.muted(` Turns: ${stats.turnCount}`));
    console.log(theme.colors.muted(` Tool Uses: ${stats.toolUses}\n`));

    // Token stats
    console.log(theme.colors.highlight('Tokens:'));
    console.log(theme.colors.muted(` Input: ${formatNumber(stats.tokens.input)}`));
    console.log(theme.colors.muted(` Output: ${formatNumber(stats.tokens.output)}`));
    console.log(theme.colors.muted(` Cache Read: ${formatNumber(stats.tokens.cacheRead)}`));
    console.log(theme.colors.muted(` Cache Write: ${formatNumber(stats.tokens.cacheWrite)}`));
    console.log(theme.colors.muted(` Total: ${formatNumber(stats.tokens.total)}\n`));

    // Cache efficiency
    if (stats.tokens.cacheRead > 0) {
      const efficiency = Math.round((stats.tokens.cacheRead / stats.tokens.total) * 100);
      console.log(theme.colors.highlight(`Cache Efficiency: ${efficiency}%`));
    }
  } catch (error: any) {
    console.error(theme.colors.error('Error getting session stats:'), error.message);
    process.exit(1);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
