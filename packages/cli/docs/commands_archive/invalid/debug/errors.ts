/**
 * View error log
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface DebugErrorsOptions {
  serverUrl?: string;
  limit?: number;
  json?: boolean;
}

/**
 * View error log
 */
export async function debugErrors(options: DebugErrorsOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Build query string
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    const query = params.toString();

    const response = await client.get(`/debug/errors${query ? '?' + query : ''}`);

    const errors = response.errors || [];

    if (options.json) {
      console.log(JSON.stringify({ errors, count: errors.length }, null, 2));
      return;
    }

    console.log(theme.colors.primary('\n❌ Error Log\n'));

    if (errors.length === 0) {
      console.log(theme.colors.success('✓ No errors found'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Showing ${errors.length} error(s):\n`));

    errors.forEach((error: any, index: number) => {
      const timestamp = error.timestamp ? formatDate(new Date(error.timestamp)) : 'Unknown';

      console.log(theme.colors.error(`Error #${index + 1}`));
      console.log(theme.colors.muted(`  Time: ${timestamp}`));
      console.log(theme.colors.muted(`  Message: ${error.message || 'Unknown error'}`));

      if (error.code) {
        console.log(theme.colors.muted(`  Code: ${error.code}`));
      }

      if (error.stack) {
        console.log(theme.colors.muted(`  Stack: ${error.stack.split('\n')[0]}`));
      }

      if (error.context) {
        console.log(theme.colors.muted(`  Context: ${JSON.stringify(error.context)}`));
      }

      console.log();
    });

    console.log(theme.colors.secondary(`Total errors: ${errors.length}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
