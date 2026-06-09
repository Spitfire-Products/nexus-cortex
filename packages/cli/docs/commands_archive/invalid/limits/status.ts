/**
 * Limits Status Command
 * Shows current loop control limits and configuration
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface LimitsStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Show loop control limits
 */
export async function limitsStatus(options: LimitsStatusOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Fetch limits configuration from server
    const response = await client.get('/limits/status');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n🔁 Loop Control Limits\n'));

    // Status
    const statusIcon = response.enabled ? '✓' : '○';
    const statusColor = response.enabled ? theme.colors.success : theme.colors.muted;
    console.log(`Status: ${statusColor(statusIcon + ' ' + (response.enabled ? 'Enabled' : 'Disabled'))}`);
    console.log();

    // Limits
    console.log(theme.colors.secondary('Configuration:'));

    if (response.maxToolIterations !== undefined) {
      console.log(`  Max Tool Iterations: ${theme.colors.highlight(response.maxToolIterations.toString())}`);
    }

    if (response.maxConsecutiveErrors !== undefined) {
      console.log(`  Max Consecutive Errors: ${theme.colors.highlight(response.maxConsecutiveErrors.toString())}`);
    }

    if (response.toolTimeoutMs !== undefined) {
      const timeoutSec = (response.toolTimeoutMs / 1000).toFixed(1);
      console.log(`  Tool Timeout: ${theme.colors.highlight(timeoutSec + 's')} ${theme.colors.muted(`(${response.toolTimeoutMs}ms)`)}`);
    }

    if (response.maxLoopRepetitions !== undefined) {
      console.log(`  Max Loop Repetitions: ${theme.colors.highlight(response.maxLoopRepetitions.toString())}`);
    }

    console.log();

    // Statistics (if available)
    if (response.stats) {
      console.log(theme.colors.secondary('Statistics:'));

      if (response.stats.iterationsTriggered !== undefined) {
        console.log(`  Iterations Limit Triggered: ${theme.colors.highlight(response.stats.iterationsTriggered.toString())} times`);
      }

      if (response.stats.errorsTriggered !== undefined) {
        console.log(`  Errors Limit Triggered: ${theme.colors.highlight(response.stats.errorsTriggered.toString())} times`);
      }

      if (response.stats.timeoutsTriggered !== undefined) {
        console.log(`  Timeouts Triggered: ${theme.colors.highlight(response.stats.timeoutsTriggered.toString())} times`);
      }

      if (response.stats.repetitionsTriggered !== undefined) {
        console.log(`  Repetitions Limit Triggered: ${theme.colors.highlight(response.stats.repetitionsTriggered.toString())} times`);
      }

      console.log();
    }

    console.log(theme.colors.muted('Modify limits with:'));
    console.log(theme.colors.muted('  cortex limits set iterations <value>'));
    console.log(theme.colors.muted('  cortex limits set errors <value>'));
    console.log(theme.colors.muted('  cortex limits set timeout <milliseconds>'));
    console.log(theme.colors.muted('  cortex limits set repetitions <value>'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
