/**
 * Limits Set Command
 * Sets loop control limits
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface LimitsSetOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Set loop control limits
 */
export async function limitsSet(
  type?: string,
  value?: string,
  options: LimitsSetOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!type) {
      console.error(theme.colors.error('Error: Limit type is required'));
      console.log(theme.colors.muted('\nUsage: cortex limits set <type> <value>'));
      console.log(theme.colors.muted('\nValid types:'));
      console.log(theme.colors.muted('  iterations   - Maximum tool iterations'));
      console.log(theme.colors.muted('  errors       - Maximum consecutive errors'));
      console.log(theme.colors.muted('  timeout      - Tool timeout in milliseconds'));
      console.log(theme.colors.muted('  repetitions  - Maximum loop repetitions'));
      console.log(theme.colors.muted('\nExample: cortex limits set iterations 50'));
      process.exit(1);
      return;
    }

    if (!value) {
      console.error(theme.colors.error('Error: Limit value is required'));
      console.log(theme.colors.muted('\nUsage: cortex limits set <type> <value>'));
      console.log(theme.colors.muted('Example: cortex limits set iterations 50'));
      process.exit(1);
      return;
    }

    // Validate type
    const validTypes = ['iterations', 'errors', 'timeout', 'repetitions'];
    if (!validTypes.includes(type.toLowerCase())) {
      console.error(theme.colors.error(`Error: Invalid limit type '${type}'`));
      console.log(theme.colors.muted('\nValid types: iterations, errors, timeout, repetitions'));
      process.exit(1);
      return;
    }

    // Parse and validate value
    const numericValue = parseInt(value, 10);
    if (isNaN(numericValue) || numericValue <= 0) {
      console.error(theme.colors.error('Error: Limit value must be a positive number'));
      console.log(theme.colors.muted(`\nExample: cortex limits set ${type} 50`));
      process.exit(1);
      return;
    }

    // Set limit
    const response = await client.post('/limits/set', {
      type: type.toLowerCase(),
      value: numericValue
    });

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Limit updated successfully\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  Type: ${theme.colors.highlight(type.toLowerCase())}`);
    console.log(`  Value: ${theme.colors.highlight(numericValue.toString())}`);

    if (response.message) {
      console.log(`  Message: ${theme.colors.muted(response.message)}`);
    }

    // Display appropriate unit
    let displayValue = numericValue.toString();
    if (type.toLowerCase() === 'timeout') {
      const timeoutSec = (numericValue / 1000).toFixed(1);
      displayValue = `${timeoutSec}s (${numericValue}ms)`;
    }

    console.log();
    console.log(theme.colors.muted(`New limit: ${displayValue}`));

    console.log();
    console.log(theme.colors.muted('View all limits with:'));
    console.log(theme.colors.muted('  cortex limits status'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
