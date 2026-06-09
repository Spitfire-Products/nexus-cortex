/**
 * Context Status Command
 * Show context budget status
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ContextStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show context budget status
 */
export async function contextStatus(
  sessionId: string,
  options: ContextStatusOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Get context status
    const response = await client.get(`/sessions/${sessionId}/context`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n Context Budget Status - ${response.model.name}\n`));

    // Model Info
    console.log(theme.colors.secondary('Model:'));
    console.log(` ${theme.colors.highlight(response.model.id)}`);
    console.log(` Context Window: ${theme.colors.muted(response.model.contextWindow.toLocaleString() + ' tokens')}`);
    console.log();

    // Budget
    console.log(theme.colors.secondary('Budget Allocation:'));
    console.log(` Max Tokens: ${theme.colors.highlight(response.budget.maxTokens.toLocaleString())}`);
    console.log(` Reserved for Output: ${theme.colors.muted(response.budget.reservedForOutput.toLocaleString())}`);
    console.log(` Available for Input: ${theme.colors.muted(response.budget.availableForInput.toLocaleString())}`);
    console.log(` System Messages: ${theme.colors.muted(response.budget.systemMessageAllocation.toLocaleString())}`);
    console.log();

    // Usage
    console.log(theme.colors.secondary('Current Usage:'));
    console.log(` Estimated Tokens: ${theme.colors.highlight(response.usage.estimatedTokens.toLocaleString())}`);

    const utilization = response.usage.utilization;
    const color = utilization > 90 ? theme.colors.error : utilization > 70 ? theme.colors.warning : theme.colors.success;
    console.log(` Utilization: ${color(utilization.toFixed(1) + '%')}`);
    console.log(` Remaining: ${theme.colors.muted(response.usage.remaining.toLocaleString() + ' tokens')}`);
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
