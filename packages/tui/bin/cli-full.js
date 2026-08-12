#!/usr/bin/env node
/**
 * Binary entry point for fuzzycortex-cli — the full interactive Commander CLI.
 * Loads .env, then forwards to the compiled dist/index.js (default `chat` = the
 * CHALK interactiveChat REPL; `ui` browsers; other subcommands delegate to the
 * headless @nexus-cortex/cli).
 */
import { bootstrapEnv } from '@nexus-cortex/core';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { realpathSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const PKG_ROOT = join(__dirname, '..', '..', '..');

// Canonical .env bootstrap (one implementation in @nexus-cortex/core).
bootstrapEnv(PKG_ROOT);

await import('../dist/index.js');
