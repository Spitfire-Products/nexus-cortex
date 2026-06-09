/**
 * View middleware events
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface DebugMiddlewareOptions {
  serverUrl?: string;
  limit?: number;
  type?: string;
  json?: boolean;
}

/**
 * View middleware events
 */
export async function debugMiddleware(options: DebugMiddlewareOptions = {}): Promise<void> {
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);
  const theme = ThemeManager.getTheme();

  try {
    // Build query string
    const params = new URLSearchParams();
    if (options.limit) params.append('limit', options.limit.toString());
    if (options.type) params.append('type', options.type);
    const query = params.toString();

    const response = await client.get(`/debug/middleware${query ? '?' + query : ''}`);

    const events = response.events || [];

    if (options.json) {
      console.log(JSON.stringify({ events, count: events.length }, null, 2));
      return;
    }

    console.log(theme.colors.primary('\n⚙️  Middleware Events\n'));

    if (events.length === 0) {
      console.log(theme.colors.warning('No middleware events found'));
      console.log();
      return;
    }

    console.log(theme.colors.secondary(`Showing ${events.length} event(s):\n`));

    events.forEach((event: any, index: number) => {
      const timestamp = event.timestamp ? formatDate(new Date(event.timestamp)) : 'Unknown';
      const type = event.type || 'unknown';

      console.log(theme.colors.primary(`#${index + 1} ${type}`));
      console.log(theme.colors.muted(`  Time: ${timestamp}`));

      if (event.middleware) {
        console.log(theme.colors.muted(`  Middleware: ${event.middleware}`));
      }

      if (event.phase) {
        console.log(theme.colors.muted(`  Phase: ${event.phase}`));
      }

      if (event.duration) {
        console.log(theme.colors.muted(`  Duration: ${event.duration}ms`));
      }

      if (event.data) {
        const dataStr = JSON.stringify(event.data);
        const preview = dataStr.substring(0, 100);
        console.log(theme.colors.muted(`  Data: ${preview}${dataStr.length > 100 ? '...' : ''}`));
      }

      if (event.error) {
        console.log(theme.colors.error(`  Error: ${event.error}`));
      }

      console.log();
    });

    console.log(theme.colors.secondary(`Total events: ${events.length}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    console.log();
    process.exit(1);
  }
}
