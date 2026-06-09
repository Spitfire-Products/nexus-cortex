/**
 * Mentorship Status Command
 * Displays current mentorship system configuration
 */

import { CortexClient } from '../../client/CortexClient.js';
import { ConfigManager } from '../../config/ConfigManager.js';
import { ThemeManager } from '../../themes/ThemeManager.js';

export interface MentorshipStatusOptions {
  serverUrl?: string;
  json?: boolean;
}

/**
 * Display mentorship system configuration
 */
export async function mentorshipStatus(options: MentorshipStatusOptions = {}): Promise<void> {
  const config = await ConfigManager.load();
  const serverUrl = options.serverUrl || config.serverUrl || 'http://localhost:4000';
  const theme = ThemeManager.getTheme();
  const client = new CortexClient(serverUrl);

  try {
    // Fetch mentorship configuration from server
    const response = await client.get('/mentorship/status');

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(response, null, 2));
      return;
    }

    // Formatted output
    console.log(theme.colors.primary('\n📚 Mentorship System Configuration\n'));

    // Status
    const statusIcon = response.enabled ? '✓' : '✗';
    const statusColor = response.enabled ? theme.colors.success : theme.colors.muted;
    console.log(`Status: ${statusColor(statusIcon + ' ' + (response.enabled ? 'Enabled' : 'Disabled'))}`);

    if (response.enabled) {
      console.log();

      // Trigger Configuration
      console.log(theme.colors.secondary('Trigger Configuration:'));
      console.log(`  Error Trigger: ${response.triggerOnError ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);
      if (response.triggerOnError) {
        console.log(`  Error Threshold: ${theme.colors.highlight(response.errorThreshold || 'medium')}`);
      }

      console.log(`  Keywords: ${response.keywordsEnabled ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);
      if (response.keywordsEnabled && response.customKeywords) {
        console.log(`  Custom Keywords: ${theme.colors.highlight(response.customKeywords.join(', '))}`);
      }

      console.log(`  Turn-Based Review: ${response.turnBasedEnabled ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);
      if (response.turnBasedEnabled) {
        console.log(`  Turn Interval: ${theme.colors.highlight(response.turnInterval.toString())} turns`);
      }

      console.log(`  Interleaved Thinking: ${response.interleavedThinking ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);
      console.log(`  Pattern Detection: ${response.patternDetection ? theme.colors.success('✓ On') : theme.colors.muted('✗ Off')}`);
      if (response.patternDetection) {
        console.log(`  Pattern Threshold: ${theme.colors.highlight(response.patternThreshold.toString())} failures`);
      }

      console.log();

      // Helper Model
      console.log(theme.colors.secondary('Helper Model:'));
      console.log(`  Model: ${theme.colors.highlight(response.helperModel || 'Not configured')}`);

      // Statistics (if available)
      if (response.stats) {
        console.log();
        console.log(theme.colors.secondary('Usage Statistics:'));
        console.log(`  Activations: ${theme.colors.highlight(response.stats.activations.toString())}`);
        console.log(`  Error Triggers: ${theme.colors.highlight(response.stats.errorTriggers.toString())}`);
        console.log(`  Keyword Triggers: ${theme.colors.highlight(response.stats.keywordTriggers.toString())}`);
        console.log(`  Turn Triggers: ${theme.colors.highlight(response.stats.turnTriggers.toString())}`);
      }
    }

    console.log();

  } catch (error: any) {
    console.error(theme.colors.error(`Error: ${error.message}`));
    process.exit(1);
  }
}
