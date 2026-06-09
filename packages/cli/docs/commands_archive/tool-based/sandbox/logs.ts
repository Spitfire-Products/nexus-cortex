/**
 * Sandbox Logs Command
 * View sandbox console logs
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface SandboxLogsOptions {
  serverUrl?: string;
  json?: boolean;
  follow?: boolean;
  level?: string;
}

/**
 * View sandbox console logs
 */
export async function sandboxLogs(
  id?: string,
  options: SandboxLogsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Sandbox ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex sandbox logs <id> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --follow           Follow log output (tail -f style)'));
      console.log(theme.colors.muted('  --level <level>    Filter by level (error, warn, info, debug)'));
      console.log(theme.colors.muted('\nExample:'));
      console.log(theme.colors.muted('  cortex sandbox logs dashboard-123 --follow'));
      console.log(theme.colors.muted('  cortex sandbox logs dashboard-123 --level error'));
      process.exit(1);
      return;
    }

    // Build query parameters
    const params: any = {};
    if (options.follow) params.follow = true;
    if (options.level) params.level = options.level.toLowerCase();

    const queryString = Object.keys(params).length > 0
      ? '?' + new URLSearchParams(params).toString()
      : '';

    // Get logs
    const response = await client.get(`/sandbox/logs/${id}${queryString}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n📜 Sandbox Logs: ${id}\n`));

    if (!response.logs || response.logs.length === 0) {
      console.log(theme.colors.muted('No logs found.'));
      console.log();
      return;
    }

    // Display logs
    for (const log of response.logs) {
      const timestamp = log.timestamp ? theme.colors.muted(`[${log.timestamp}]`) : '';
      const levelColor = log.level === 'error' ? theme.colors.error :
                        log.level === 'warn' ? theme.colors.warning :
                        log.level === 'info' ? theme.colors.success :
                        theme.colors.muted;
      const level = levelColor(`[${log.level}]`);

      console.log(`${timestamp} ${level} ${log.message}`);
    }

    console.log();
    console.log(theme.colors.muted(`Total logs: ${response.logs.length}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
