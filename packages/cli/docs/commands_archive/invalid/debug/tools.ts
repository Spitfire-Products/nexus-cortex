/**
 * View tool execution history
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface DebugToolsOptions {
  serverUrl?: string;
  limit?: number;
  sessionId?: string;
  json?: boolean;
}

/**
 * View tool execution history
 */
export async function debugTools(options: DebugToolsOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Build query string
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.sessionId) params.append('sessionId', options.sessionId);
    const query = params.toString();

    const response = await client.get(`/debug/tools${query ? '?' + query : ''}`);

    const tools = response.tools || [];

    if (options.json) {
      console.log(JSON.stringify({ tools, count: tools.length }, null, 2));
      return;
    }

    console.log(theme.colors.primary('\n🔧 Tool Execution History\n'));

    if (tools.length === 0) {
      console.log(theme.colors.warning('No tool executions found'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Showing ${tools.length} tool execution(s):\n`));

    tools.forEach((tool: any, index: number) => {
      const timestamp = tool.timestamp ? formatDate(new Date(tool.timestamp)) : 'Unknown';
      const status = tool.status || 'unknown';

      // Color by status
      let statusColor = theme.colors.muted;
      if (status === 'success') statusColor = theme.colors.success;
      else if (status === 'error') statusColor = theme.colors.error;
      else if (status === 'pending') statusColor = theme.colors.warning;

      console.log(theme.colors.primary(`#${index + 1} ${tool.name || 'Unknown tool'}`));
      console.log(theme.colors.muted(`  Time: ${timestamp}`));
      console.log(theme.colors.muted(`  Status: `) + statusColor(status));

      if (tool.sessionId) {
        console.log(theme.colors.muted(`  Session: ${tool.sessionId}`));
      }

      if (tool.input) {
        const inputStr = typeof tool.input === 'string'
          ? tool.input
          : JSON.stringify(tool.input);
        const preview = inputStr.substring(0, 100);
        console.log(theme.colors.muted(`  Input: ${preview}${inputStr.length > 100 ? '...' : ''}`));
      }

      if (tool.output) {
        const outputStr = typeof tool.output === 'string'
          ? tool.output
          : JSON.stringify(tool.output);
        const preview = outputStr.substring(0, 100);
        console.log(theme.colors.muted(`  Output: ${preview}${outputStr.length > 100 ? '...' : ''}`));
      }

      if (tool.duration) {
        console.log(theme.colors.muted(`  Duration: ${tool.duration}ms`));
      }

      console.log();
    });

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
