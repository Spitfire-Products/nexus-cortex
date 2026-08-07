#!/usr/bin/env node

/**
 * cortex-ui — Minimal Ink-based terminal UI for Nexus Cortex
 *
 * Loads .env, then launches the lightweight cortex.tsx UI in direct mode.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, realpathSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const ROOT_DIR = join(__dirname, '..', '..', '..');
const ENV_FILE = join(ROOT_DIR, '.env');
if (existsSync(ENV_FILE)) {
  config({ path: ENV_FILE, quiet: true });
}

// cortex.tsx only understands direct/server — force direct mode
// (CORTEX_MODE=stateless is a server-side concept)
process.env.CORTEX_MODE = 'direct';

await import('../dist/cortex.js');
