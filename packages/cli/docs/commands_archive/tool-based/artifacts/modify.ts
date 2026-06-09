/**
 * Artifact Modify Command
 * Modify artifact code with hot reload
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface ArtifactModifyOptions {
  serverUrl?: string;
  json?: boolean;
  file?: string;
  lineRange?: string;
  code?: string;
}

/**
 * Modify artifact code
 */
export async function artifactModify(
  id?: string,
  options: ArtifactModifyOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Validation
    if (!id) {
      console.error(theme.colors.error('Error: Artifact ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex artifact modify <id> [options]'));
      console.log(theme.colors.muted('\nOptions:'));
      console.log(theme.colors.muted('  --file <path>       File to modify'));
      console.log(theme.colors.muted('  --line-range <range> Line range (e.g., 10-20)'));
      console.log(theme.colors.muted('  --code <code>       New code content'));
      console.log(theme.colors.muted('\nExamples:'));
      console.log(theme.colors.muted('  cortex artifact modify dashboard-123 --file src/App.tsx --code "..."'));
      console.log(theme.colors.muted('  cortex artifact modify dashboard-123 --file src/App.tsx --line-range 10-20 --code "..."'));
      process.exit(1);
      return;
    }

    // Build request payload
    const payload: any = { id };
    if (options.file) payload.file = options.file;
    if (options.lineRange) payload.lineRange = options.lineRange;
    if (options.code) payload.code = options.code;

    // Modify artifact
    const response = await client.post('/artifact/modify', payload);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.success('\n✓ Artifact modified successfully\n'));
    console.log(theme.colors.secondary('Details:'));
    console.log(`  ID: ${theme.colors.highlight(id)}`);

    if (options.file) {
      console.log(`  File: ${theme.colors.highlight(options.file)}`);
    }

    if (response.hotReload) {
      console.log(`  Hot Reload: ${theme.colors.success('✓ Active')}`);
    }

    if (response.message) {
      console.log(`  Message: ${theme.colors.muted(response.message)}`);
    }

    console.log();
    console.log(theme.colors.muted('The artifact will automatically reload with your changes.'));
    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
