/**
 * View permission audit log
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatRelativeTime } from '../../utils/formatters.js';

export interface PermissionsLogsOptions {
  serverUrl?: string;
  session?: string;
  action?: string;
  approved?: boolean;
  denied?: boolean;
  limit?: number;
  format?: 'table' | 'json';
}

interface PermissionLogEntry {
  timestamp: string;
  action: string;
  decision: 'approved' | 'denied';
  reason: string;
  sessionId?: string;
  details?: any;
}

/**
 * View permission audit log
 */
export async function permissionsLogs(
  options: PermissionsLogsOptions = {}
): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Note: This endpoint may not exist yet on the server
    // For now, we'll try to fetch from /v1/permissions/logs
    // If it doesn't exist, we'll show a placeholder message

    let logs: PermissionLogEntry[] = [];

    try {
      const response = await client.get('/v1/permissions/logs');
      logs = response.logs || [];
    } catch (error: any) {
      // If endpoint doesn't exist, show helpful message
      if (error.message.includes('404') || error.message.includes('Not Found')) {
        console.log(theme.colors.warning('⚠ Permission audit log endpoint not yet available'));
        console.log(theme.colors.muted('\nThe permission audit log feature requires server-side implementation.'));
        console.log(theme.colors.muted('Expected endpoint: GET /v1/permissions/logs'));
        console.log(theme.colors.muted('\nThis will be available in a future update.'));
        return;
      }
      throw error;
    }

    // Apply filters
    if (options.session) {
      logs = logs.filter(log => log.sessionId === options.session);
    }
    if (options.action) {
      logs = logs.filter(log => log.action.includes(options.action!));
    }
    if (options.approved) {
      logs = logs.filter(log => log.decision === 'approved');
    }
    if (options.denied) {
      logs = logs.filter(log => log.decision === 'denied');
    }

    // Limit results
    const limit = options.limit || 50;
    logs = logs.slice(0, limit);

    // Output format
    if (options.format === 'json') {
      console.log(JSON.stringify(logs, null, 2));
      return;
    }

    // Table format
    if (logs.length === 0) {
      console.log(theme.colors.muted('\nNo permission log entries found.'));
      return;
    }

    console.log(theme.colors.primary(`\nPermission Audit Log (${logs.length} entries)`));
    console.log();

    for (const log of logs) {
      const timestamp = log.timestamp ? formatRelativeTime(log.timestamp) : 'Unknown';
      const decision = log.decision === 'approved'
        ? theme.colors.success('APPROVED')
        : theme.colors.error('DENIED');

      console.log(`${theme.colors.muted(timestamp)} | ${theme.colors.highlight(log.action)} | ${decision}`);

      if (log.sessionId) {
        console.log(theme.colors.muted(`  Session: ${log.sessionId.substring(0, 8)}...`));
      }

      console.log(theme.colors.muted(`  Reason: ${log.reason}`));

      if (log.details) {
        console.log(theme.colors.muted(`  Details: ${JSON.stringify(log.details)}`));
      }

      console.log();
    }

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
