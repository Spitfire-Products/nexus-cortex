/**
 * History View Command
 * View preserved historical context for a session
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';
import { formatDate, formatTokens } from '../../utils/formatters.js';

export interface HistoryViewOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * View preserved historical context
 *
 * @param sessionId - The session ID to view context for
 */
export async function historyView(
  sessionId: string,
  options: HistoryViewOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    if (!sessionId) {
      console.error(theme.colors.error('Error: Session ID is required'));
      console.log(theme.colors.muted('\nUsage: cortex history view <session-id>'));
      process.exit(1);
      return;
    }

    // Fetch preserved context
    const response = await client.get(`/history/view/${sessionId}`);

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Check if context exists
    if (!response.context) {
      console.log(theme.colors.warning(`\n⚠ No preserved context found for session: ${sessionId}\n`));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary(`\n📜 Historical Context - ${sessionId}\n`));

    // Metadata
    console.log(theme.colors.secondary('Metadata:'));
    console.log(`  Created: ${formatDate(response.metadata.createdAt)}`);
    console.log(`  Last Updated: ${formatDate(response.metadata.updatedAt)}`);
    console.log(`  Context Size: ${formatTokens(response.metadata.tokenCount)}`);

    if (response.metadata.compressed) {
      console.log(`  Compression: ${theme.colors.success('✓ Applied')}`);
      console.log(`  Original Size: ${formatTokens(response.metadata.originalSize)}`);
      const ratio = ((1 - response.metadata.tokenCount / response.metadata.originalSize) * 100).toFixed(1);
      console.log(`  Savings: ${theme.colors.success(ratio + '%')}`);
    }

    // Context sections
    if (response.context.sections && response.context.sections.length > 0) {
      console.log();
      console.log(theme.colors.secondary('Context Sections:'));

      response.context.sections.forEach((section: any, index: number) => {
        console.log();
        console.log(theme.colors.highlight(`  Section ${index + 1}: ${section.type || 'General'}`));
        console.log(`    Tokens: ${formatTokens(section.tokenCount)}`);

        if (section.summary) {
          console.log(`    Summary: ${section.summary}`);
        }

        if (section.messages) {
          console.log(`    Messages: ${section.messages.length}`);
        }
      });
    }

    // Summary
    if (response.context.summary) {
      console.log();
      console.log(theme.colors.secondary('Summary:'));
      console.log(`  ${response.context.summary}`);
    }

    // Tool context
    if (response.context.toolContext && response.context.toolContext.length > 0) {
      console.log();
      console.log(theme.colors.secondary('Tool Context:'));
      console.log(`  ${response.context.toolContext.length} tool interaction(s) preserved`);
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
