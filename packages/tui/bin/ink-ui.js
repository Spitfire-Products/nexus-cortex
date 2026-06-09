#!/usr/bin/env node

/**
 * Nexus Cortex - Ink UI Entry Point
 *
 * This launches the React/Ink-based terminal UI.
 * The UI is adapted from Gemini CLI but wired to our core orchestrator.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, realpathSync } from 'fs';
import React from 'react';
import { render } from 'ink';
import { CortexApp } from '../dist/ink-ui/CortexApp.js';

// Load .env: cwd first (user's project), then package root (dev/monorepo).
// dotenv's default is "first wins" — cwd values take priority.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const PKG_ROOT = join(__dirname, '..', '..', '..');

const cwdEnv = join(process.cwd(), '.env');
const pkgEnv = join(PKG_ROOT, '.env');
const cwdEnvLocal = join(process.cwd(), '.env.local');
const pkgEnvLocal = join(PKG_ROOT, '.env.local');

if (existsSync(cwdEnv)) config({ path: cwdEnv, quiet: true });
if (existsSync(pkgEnv)) config({ path: pkgEnv, quiet: true });
if (existsSync(cwdEnvLocal)) config({ path: cwdEnvLocal, override: true, quiet: true });
if (existsSync(pkgEnvLocal)) config({ path: pkgEnvLocal, override: true, quiet: true });

// Parse CLI arguments
const args = process.argv.slice(2);

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index !== -1 && args[index + 1]) {
    return args[index + 1];
  }
  return undefined;
}

const modelId = getArgValue('--model') || getArgValue('-m');
const projectPath = getArgValue('--project') || getArgValue('-p');
const initialPrompt = getArgValue('--prompt') || getArgValue('-P');
const debug = args.includes('--debug') || args.includes('-d');
const autoApprove = args.includes('--yolo') || args.includes('-y');

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
CORTEX - Nexus Cortex CLI

Usage: cortex [options]

Options:
  -m, --model <id>     Model ID to use (default: from env or grok-code-fast-1)
  -p, --project <path> Project path (default: current directory)
  -P, --prompt <text>  Send an initial prompt on startup
  -d, --debug          Enable debug logging
  -y, --yolo           Start with auto-approve enabled
  -h, --help           Show this help

Keyboard Shortcuts:
  Tab          Toggle thinking display
  Shift+Tab    Toggle auto-approve (YOLO mode)
  ESC          Cancel streaming / Close dialogs
  Ctrl+C       Exit

Commands (type in chat):
  /help        Show help
  /clear       Clear history
  /model       Show current model
  /yolo        Toggle auto-approve
  /exit        Exit
`);
  process.exit(0);
}

// Clear screen for clean startup
console.clear();

// Render the app
const { waitUntilExit } = render(
  React.createElement(CortexApp, {
    modelId,
    debug,
    projectPath,
    autoApprove,
    initialPrompt: initialPrompt || undefined,
  })
);

// Wait for exit
waitUntilExit().then(() => {
  console.log('');
  console.log('Goodbye!');
  process.exit(0);
}).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
