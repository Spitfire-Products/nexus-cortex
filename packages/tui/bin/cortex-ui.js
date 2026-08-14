#!/usr/bin/env node

/**
 * cortex-cli — Minimal Ink-based terminal UI for Nexus Cortex
 *
 * Parses args FIRST (before any heavy import), guards against non-TTY stdin
 * (Ink raw mode requires a real terminal), then loads .env and launches the
 * lightweight cortex.tsx UI in direct mode.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { realpathSync, readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const PKG_DIR = join(__dirname, '..');
const ROOT_DIR = join(PKG_DIR, '..', '..');

const USAGE = `cortex-cli — minimal Ink terminal UI for Nexus Cortex

Usage: cortex-cli [options]

Options:
  -h, --help     Show this help and exit
  -V, --version  Print version and exit

Environment:
  DEFAULT_MODEL_ID   Model ID to use
  DEBUG=true         Enable debug logging

Keyboard (in the UI):
  Tab          Toggle thinking display
  Shift+Tab    Toggle auto-approve
  Ctrl+C       Exit
  /help /exit  Chat commands

cortex-cli is fully interactive and requires a real terminal (TTY).`;

const args = process.argv.slice(2);

// --help / -h: print usage and exit BEFORE any session/UI bootstrap
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE);
  process.exit(0);
}

// --version / -V
if (args.includes('--version') || args.includes('-V')) {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'));
    console.log(`cortex-cli ${pkg.version}`);
  } catch {
    console.log('cortex-cli (version unknown)');
  }
  process.exit(0);
}

// Any other argument (flag or positional) is unsupported → usage + exit 2
if (args.length > 0) {
  console.error(`cortex-cli: unknown option '${args[0]}'`);
  console.error('');
  console.error(USAGE);
  process.exit(2);
}

// Raw-mode guard: Ink needs a TTY stdin. Fail with one human line, not a
// React reconciler stack dump (docs/TUI_UX_FINDINGS.md P0-3).
if (!process.stdin.isTTY) {
  console.error(
    'cortex-cli requires an interactive terminal (TTY) — stdin is not a TTY.\n' +
    'For non-interactive use, run: fuzzycortex-cli message "your prompt"'
  );
  process.exit(1);
}

// Canonical .env bootstrap (one implementation in @nexus-cortex/core).
// Imported dynamically so --help/--version stay instant and side-effect free.
const { bootstrapEnv } = await import('@nexus-cortex/core');
bootstrapEnv(ROOT_DIR);

// cortex.tsx only understands direct/server — force direct mode
// (CORTEX_MODE=stateless is a server-side concept)
process.env.CORTEX_MODE = 'direct';

await import('../dist/cortex.js');
