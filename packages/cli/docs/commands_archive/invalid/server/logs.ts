/**
 * Server Logs Command
 * View server logs
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ServerLogsOptions {
  serverUrl?: string;
  json?: boolean;
  level?: string;
  limit?: number;
}

/**
 * View server logs
 */
export async function serverLogs(
  options: ServerLogsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Build query parameters
    const params: any = {};
    if (options.level) params.level = options.level.toLowerCase();
    if (options.limit) params.limit = options.limit;

    const queryString = Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';

    // Get server logs
    const response = await client.get(`/server/logs${queryString}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📋 Server Logs\n'));

    if (response.logs && response.logs.length > 0) {
      response.logs.forEach((log: any) => {
        const levelColor = log.level === 'error' ? theme.colors.error :
                          log.level === 'warn' ? theme.colors.warning :
                          theme.colors.muted;

        console.log(`${theme.colors.muted(log.timestamp)} ${levelColor(log.level.toUpperCase())} ${log.message}`);
      });
    } else {
      console.log(theme.colors.muted('No logs available.'));
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
