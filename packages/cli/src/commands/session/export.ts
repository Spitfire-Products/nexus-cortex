/**
 * Export Session Command
 * Export session to JSON format
 */
import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ExportSessionOptions {
  serverUrl?: string;
  output?: string;
}

export async function exportSession(sessionId: string, options: ExportSessionOptions): Promise<void> {
  const theme = ThemeManager.getTheme();
  const serverUrl = options.serverUrl || ConfigManager.get('serverUrl');
  const client = new CortexClient(serverUrl);

  try {
    const exported = await client.get(`/sessions/${sessionId}/export`);

    const json = JSON.stringify(exported, null, 2);

    if (options.output) {
      // Write to file
      const fs = await import('fs/promises');
      await fs.writeFile(options.output, json, 'utf-8');
      console.log(theme.colors.success(`✓ Session exported to ${options.output}`));
    } else {
      // Output to stdout
      console.log(json);
    }
  } catch (error: any) {
    console.error(theme.colors.error('Error exporting session:'), error.message);
    process.exit(1);
  }
}
