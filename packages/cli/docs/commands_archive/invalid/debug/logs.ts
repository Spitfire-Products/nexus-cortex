/**
 * View debug logs
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface DebugLogsOptions {
  serverUrl?: string;
  limit?: number;
  level?: string;
  json?: boolean;
}

/**
 * View debug logs
 */
export async function debugLogs(options: DebugLogsOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Build query string
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.level) params.append('level', options.level);
    const query = params.toString();

    const response = await client.get(`/debug/logs${query ? '?' + query : ''}`);

    const logs = response.logs || [];

    if (options.json) {
      console.log(JSON.stringify({ logs, count: logs.length }, null, 2));
      return;
    }

    console.log(theme.colors.primary('\n🔍 Debug Logs\n'));

    if (logs.length === 0) {
      console.log(theme.colors.warning('No logs found'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Showing ${logs.length} log entries:\n`));

    logs.forEach((log: any) => {
      const timestamp = log.timestamp ? formatDate(new Date(log.timestamp)) : 'Unknown';
      const level = log.level || 'INFO';

      // Color by level
      let levelColor = theme.colors.muted;
      if (level === 'ERROR') levelColor = theme.colors.error;
      else if (level === 'WARN') levelColor = theme.colors.warning;
      else if (level === 'DEBUG') levelColor = theme.colors.secondary;

      console.log(theme.colors.muted(`[${timestamp}] `) + levelColor(`${level}`));
      console.log(theme.colors.muted(`  ${log.message || 'No message'}`));

      if (log.data) {
        console.log(theme.colors.muted(`  Data: ${JSON.stringify(log.data)}`));
      }
      console.log();
    });

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
