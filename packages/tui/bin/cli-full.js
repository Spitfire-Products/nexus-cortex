#!/usr/bin/env node
/**
 * Binary entry point for fuzzycortex-cli — the full interactive Commander CLI.
 * Loads .env, then forwards to the compiled dist/index.js (default `chat` = the
 * CHALK interactiveChat REPL; `ui` browsers; other subcommands delegate to the
 * headless @nexus-cortex/cli). Same behavior as the pre-split omniclaude.js.
 */
import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, realpathSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const PKG_ROOT = join(__dirname, '..', '..', '..');

const cwdEnv = join(process.cwd(), '.env');
const pkgEnv = join(PKG_ROOT, '.env');

if (existsSync(cwdEnv)) config({ path: cwdEnv, quiet: true });
if (existsSync(pkgEnv)) config({ path: pkgEnv, quiet: true });

await import('../dist/index.js');
