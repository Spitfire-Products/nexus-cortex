/**
 * Mentorship Keywords Command
 * Manage mentorship keyword triggers
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MentorshipKeywordsOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Manage mentorship keywords
 *
 * @param action - 'list', 'add', or 'remove'
 * @param keyword - The keyword to add or remove (optional for 'list')
 */
export async function mentorshipKeywords(
  action?: string,
  keyword?: string,
  options: MentorshipKeywordsOptions = {}
): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Default to 'list' if no action specified
    const actualAction = action || 'list';

    // Handle list action
    if (actualAction === 'list' || !actualAction) {
      const response = await client.get('/mentorship/keywords');

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      // Formatted output
      console.log(theme.colors.primary('\n📝 Mentorship Keywords\n'));

      if (!response.keywords || response.keywords.length === 0) {
        console.log(theme.colors.muted('No custom keywords configured.'));
        console.log();
        console.log(theme.colors.muted('Default keywords: @ultrathink, @analyze, @rethink'));
      } else {
        console.log(theme.colors.secondary('Active Keywords:'));
        response.keywords.forEach((kw: string) => {
          console.log(`  ${theme.colors.highlight('•')} ${theme.colors.highlight(kw)}`);
        });
      }

      console.log();
      console.log(theme.colors.muted('Add keyword: cortex mentorship keywords add <keyword>'));
      console.log(theme.colors.muted('Remove keyword: cortex mentorship keywords remove <keyword>'));
      console.log();

      return;
    }

    // Handle add action
    if (actualAction === 'add') {
      if (!keyword) {
        console.error(theme.colors.error('Error: Keyword required for add action'));
        console.log(theme.colors.muted('\nUsage: cortex mentorship keywords add <keyword>'));
        process.exit(1);
      }

      const response = await client.post('/mentorship/keywords/add', { keyword });

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log(theme.colors.success(`\n✓ Added keyword: ${theme.colors.highlight(keyword)}\n`));
      return;
    }

    // Handle remove action
    if (actualAction === 'remove') {
      if (!keyword) {
        console.error(theme.colors.error('Error: Keyword required for remove action'));
        console.log(theme.colors.muted('\nUsage: cortex mentorship keywords remove <keyword>'));
        process.exit(1);
      }

      const response = await client.post('/mentorship/keywords/remove', { keyword });

      // JSON output
      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      console.log(theme.colors.warning(`\n⚠ Removed keyword: ${theme.colors.highlight(keyword)}\n`));
      return;
    }

    // Invalid action
    console.error(theme.colors.error(`Error: Invalid action '${actualAction}'`));
    console.log(theme.colors.muted('\nValid actions: list, add, remove'));
    process.exit(1);

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
