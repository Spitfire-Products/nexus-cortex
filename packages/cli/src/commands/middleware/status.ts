/**
 * Middleware Status Command
 * Shows detailed status and configuration for a specific middleware
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MiddlewareStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show middleware status and configuration
 */
export async function middlewareStatus(
  name?: string,
  options: MiddlewareStatusOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!name) {
      console.error(theme.colors.error('Error: Middleware name is required'));
      console.log(theme.colors.muted('\nUsage: cortex middleware status <name>'));
      console.log(theme.colors.muted('Example: cortex middleware status mentorship'));
      process.exit(1);
      return;
    }

    // Fetch middleware status
    const response = await client.get(`/middleware/${name}/status`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n⚙  Middleware: ${response.name}\n`));

    // Status
    const statusIcon = response.enabled ? '✓' : '○';
    const statusColor = response.enabled ? theme.colors.success : theme.colors.muted;
    console.log(`Status: ${statusColor(statusIcon + ' ' + (response.enabled ? 'Enabled' : 'Disabled'))}`);

    if (response.description) {
      console.log(`Description: ${theme.colors.muted(response.description)}`);
    }

    if (response.order !== undefined) {
      console.log(`Execution Order: ${theme.colors.highlight(response.order.toString())}`);
    }

    console.log();

    // Configuration
    if (response.config && Object.keys(response.config).length > 0) {
      console.log(theme.colors.secondary('Configuration:'));
      for (const [key, value] of Object.entries(response.config)) {
        console.log(` ${key}: ${theme.colors.highlight(String(value))}`);
      }
      console.log();
    }

    // Statistics
    if (response.stats) {
      console.log(theme.colors.secondary('Statistics:'));
      if (response.stats.invocations !== undefined) {
        console.log(` Invocations: ${theme.colors.highlight(response.stats.invocations.toString())}`);
      }
      if (response.stats.successes !== undefined) {
        console.log(` Successes: ${theme.colors.highlight(response.stats.successes.toString())}`);
      }
      if (response.stats.failures !== undefined) {
        console.log(` Failures: ${theme.colors.highlight(response.stats.failures.toString())}`);
      }
      if (response.stats.avgDuration !== undefined) {
        console.log(` Avg Duration: ${theme.colors.highlight(response.stats.avgDuration.toString() + 'ms')}`);
      }
      console.log();
    }

    console.log(theme.colors.muted('Manage this middleware:'));
    console.log(theme.colors.muted(` cortex middleware ${response.enabled ? 'disable' : 'enable'} ${name}`));
    console.log(theme.colors.muted(` cortex middleware config ${name}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
