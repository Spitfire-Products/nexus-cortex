/**
 * Helper History Command
 * View helper model invocation history
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate, formatDuration } from '../../utils/formatters.js';

export interface HelperHistoryOptions {
  serverUrl?: string;
  json?: boolean;
  limit?: number;
  sessionId?: string;
}

/**
 * View helper model invocation history
 */
export async function helperHistory(options: HelperHistoryOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Build query parameters
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.sessionId) params.append('sessionId', options.sessionId);

    const queryString = params.toString();
    const endpoint = `/helper/history${queryString ? '?' + queryString : ''}`;

    // Fetch helper history
    const response = await client.get(endpoint);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📜 Helper Model History\n'));

    if (!response.invocations || response.invocations.length === 0) {
      console.log(theme.colors.muted('No helper invocations found.'));
      console.log();
      return;
    }

    console.log(theme.colors.muted(`${response.invocations.length} invocation(s)\n`));

    // Display each invocation
    response.invocations.forEach((invocation: any, index: number) => {
      console.log(theme.colors.secondary(`#${index + 1}`));
      console.log(`  ${theme.colors.muted('Time:')} ${formatDate(invocation.timestamp)}`);
      console.log(`  ${theme.colors.muted('Model:')} ${theme.colors.highlight(invocation.model || 'Unknown')}`);

      if (invocation.sessionId) {
        console.log(`  ${theme.colors.muted('Session:')} ${invocation.sessionId}`);
      }

      if (invocation.trigger) {
        console.log(`  ${theme.colors.muted('Trigger:')} ${invocation.trigger}`);
      }

      // Prompt preview
      if (invocation.prompt) {
        const promptPreview = invocation.prompt.length > 80
          ? invocation.prompt.substring(0, 80) + '...'
          : invocation.prompt;
        console.log(`  ${theme.colors.muted('Prompt:')} ${promptPreview}`);
      }

      // Response preview
      if (invocation.response) {
        const responsePreview = invocation.response.length > 100
          ? invocation.response.substring(0, 100) + '...'
          : invocation.response;
        console.log(`  ${theme.colors.muted('Response:')} ${responsePreview}`);
      }

      // Status
      if (invocation.success !== undefined) {
        const statusColor = invocation.success ? theme.colors.success : theme.colors.error;
        const statusText = invocation.success ? '✓ Success' : '✗ Failed';
        console.log(`  ${theme.colors.muted('Status:')} ${statusColor(statusText)}`);
      }

      // Duration
      if (invocation.duration) {
        console.log(`  ${theme.colors.muted('Duration:')} ${formatDuration(invocation.duration)}`);
      }

      // Token usage
      if (invocation.tokens) {
        console.log(`  ${theme.colors.muted('Tokens:')} ${invocation.tokens.total} (in: ${invocation.tokens.input}, out: ${invocation.tokens.output})`);
      }

      console.log();
    });

    console.log(theme.colors.muted(`Total invocations: ${response.invocations.length}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
