#!/usr/bin/env node

/**
 * Nexus Cortex - Ink UI Entry Point
 *
 * This launches the React/Ink-based terminal UI.
 * The UI is adapted from Gemini CLI but wired to our core orchestrator.
 *
 * L-11 (TUI_UX_BACKLOG_2026-08-16): every heavy import here is DYNAMIC and
 * happens AFTER the first paint. Measured: the @nexus-cortex/core barrel +
 * react + ink cost ~1s before anything hit the screen (the "2s blank");
 * static imports hoist, so the banner could never beat them. Only node
 * builtins may be imported statically in this file.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { realpathSync } from 'fs';

// Parse CLI arguments (pure — no imports needed)
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

// Show help (no heavy imports on this path)
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

// FIRST PAINT — before any heavy import (L-11: chrome <150ms, then fill).
console.clear();
process.stdout.write('\x1b[2m CORTEX — starting…\x1b[0m\n');

// Load .env: cwd first (user's project), then package root (dev/monorepo).
// dotenv's default is "first wins" — cwd values take priority.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const PKG_ROOT = join(__dirname, '..', '..', '..');

// Anchor the install root so .cortex/ config (agents, MCP, etc.) is discoverable
// regardless of the cwd the user launches from. Honors a pre-set CORTEX_ROOT.
process.env.CORTEX_ROOT = process.env.CORTEX_ROOT || PKG_ROOT;

// Heavy imports — sequential top-level await keeps the original init order
// (env bootstrap before anything reads process.env-derived config).
const { bootstrapEnv, onboardingLines, shouldShowOnboarding, markOnboardingShown } =
  await import('@nexus-cortex/core');

// Canonical .env bootstrap (one implementation in @nexus-cortex/core).
bootstrapEnv(PKG_ROOT);

const React = (await import('react')).default;
const { render } = await import('ink');
const { CortexApp } = await import('../dist/ink-ui/CortexApp.js');

// L-05 first-run onboarding: one-time orientation block, printed above the
// Ink root (content + key hints are core-owned — TUI_KEYMAP truth table).
if (shouldShowOnboarding()) {
  console.log('');
  for (const line of onboardingLines('ink-app')) {
    console.log(line ? `  \x1b[2m${line}\x1b[0m` : '');
  }
  console.log('');
  markOnboardingShown();
}

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
