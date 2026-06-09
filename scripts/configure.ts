#!/usr/bin/env tsx
/**
 * Nexus Cortex Configuration CLI
 *
 * Interactive configuration tool for setting up Nexus Cortex
 *
 * Usage:
 *   npm run configure              # Full interactive configuration
 *   npm run configure:api-keys     # Quick API key setup
 *   npm run configure:mentorship   # Quick mentorship setup
 *   npm run configure:view         # View current configuration
 */

import { InteractiveConfigurator, SettingsLoader } from '../packages/core/src/config/index.js';
import * as path from 'path';
import { fileURLToPath } from 'url';

// Project root is the parent of scripts directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.join(__dirname, '..');

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'full';

  const configurator = new InteractiveConfigurator(PROJECT_ROOT);

  switch (command) {
    case 'full':
    case 'all':
      await configurator.configure();
      break;

    case 'api-keys':
    case 'keys':
      await configurator.quickSetupApiKeys();
      break;

    case 'mentorship':
    case 'mentor':
      await configurator.quickSetupMentorship();
      break;

    case 'view':
    case 'show':
    case 'display': {
      const loader = new SettingsLoader(PROJECT_ROOT);
      const summary = loader.getSummary();

      console.log('\n' + '='.repeat(60));
      console.log('  Current Configuration');
      console.log('='.repeat(60));
      console.log(`\n  Default Model: ${summary.defaultModel}`);
      console.log(`  Helper Model: ${summary.helperModel}`);
      console.log(`  Configured Providers: ${summary.providers.length > 0 ? summary.providers.join(', ') : 'None'}`);
      console.log(`  Debug: ${summary.debugEnabled ? 'Enabled' : 'Disabled'}`);
      console.log('\n  Reactive Mentorship:');
      console.log(`    Status: ${summary.mentorshipEnabled ? 'Enabled' : 'Disabled'}`);

      if (summary.mentorship) {
        console.log(`    Trigger on Error: ${summary.mentorship.triggerOnError ? 'Yes' : 'No'}`);
        console.log(`    Error Threshold: ${summary.mentorship.errorThreshold}`);
        console.log(`    Keywords Enabled: ${summary.mentorship.keywordsEnabled ? 'Yes' : 'No'}`);
        console.log(`    Helper Model: ${summary.mentorship.helperModel}`);
        console.log('\n  Phase 2 Features:');
        console.log(`    Turn-Based Review: ${summary.mentorship.turnBasedEnabled ? 'Enabled (every ' + summary.mentorship.turnInterval + ' turns)' : 'Disabled'}`);
        console.log(`    Interleaved Thinking: ${summary.mentorship.interleavedThinking ? 'Enabled' : 'Disabled'}`);
        console.log(`    Pattern Detection: ${summary.mentorship.patternDetection ? 'Enabled (threshold: ' + summary.mentorship.patternThreshold + ')' : 'Disabled'}`);
      }
      console.log('');
      break;
    }

    case 'help':
    case '--help':
    case '-h':
      console.log(`
Nexus Cortex Configuration CLI

Usage:
  npm run configure              - Full interactive configuration
  npm run configure api-keys     - Quick API key setup
  npm run configure mentorship   - Quick mentorship setup
  npm run configure view         - View current configuration
  npm run configure help         - Show this help

Commands:
  full, all          Run full interactive configuration
  api-keys, keys     Set up API keys only
  mentorship, mentor Configure mentorship settings
  view, show         Display current configuration
  help               Show this help message

Examples:
  npm run configure
  npm run configure api-keys
  npm run configure view
`);
      break;

    default:
      console.error(`Unknown command: ${command}`);
      console.log('Run "npm run configure help" for usage information.');
      process.exit(1);
  }
}

main().catch(error => {
  console.error('Configuration failed:', error.message);
  process.exit(1);
});
