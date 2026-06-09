/**
 * Mentorship Log Command
 * View mentorship system event log
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate } from '../../utils/formatters.js';

export interface MentorshipLogOptions {
  serverUrl?: string;
  json?: boolean;
  limit?: number;
  sessionId?: string;
}

/**
 * View mentorship event log
 */
export async function mentorshipLog(options: MentorshipLogOptions = {}): Promise<void> {
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
    const endpoint = `/mentorship/log${queryString ? '?' + queryString : ''}`;

    // Fetch mentorship log
    const response = await client.get(endpoint);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📜 Mentorship Event Log\n'));

    if (!response.events || response.events.length === 0) {
      console.log(theme.colors.muted('No mentorship events found.'));
      console.log();
      return;
    }

    console.log(theme.colors.muted(`${response.events.length} event(s)\n`));

    // Display each event
    response.events.forEach((event: any, index: number) => {
      console.log(theme.colors.secondary(`Event #${index + 1}`));
      console.log(`  ${theme.colors.muted('Time:')} ${formatDate(event.timestamp)}`);
      console.log(`  ${theme.colors.muted('Trigger:')} ${theme.colors.highlight(event.trigger || 'Unknown')}`);

      if (event.sessionId) {
        console.log(`  ${theme.colors.muted('Session:')} ${event.sessionId}`);
      }

      if (event.reason) {
        console.log(`  ${theme.colors.muted('Reason:')} ${event.reason}`);
      }

      if (event.helperModel) {
        console.log(`  ${theme.colors.muted('Helper Model:')} ${theme.colors.highlight(event.helperModel)}`);
      }

      if (event.guidance) {
        const preview = event.guidance.length > 100
          ? event.guidance.substring(0, 100) + '...'
          : event.guidance;
        console.log(`  ${theme.colors.muted('Guidance:')} ${preview}`);
      }

      if (event.duration) {
        console.log(`  ${theme.colors.muted('Duration:')} ${event.duration}ms`);
      }

      console.log();
    });

    console.log(theme.colors.muted(`Total events: ${response.events.length}`));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
