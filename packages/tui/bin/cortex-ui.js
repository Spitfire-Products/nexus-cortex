#!/usr/bin/env node

/**
 * cortex-ui — Minimal Ink-based terminal UI for Nexus Cortex
 *
 * Loads .env, then launches the lightweight cortex.tsx UI in direct mode.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { realpathSync } from 'fs';
import { bootstrapEnv } from '@nexus-cortex/core';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(realpathSync(__filename));
const ROOT_DIR = join(__dirname, '..', '..', '..');
// Canonical .env bootstrap (one implementation in @nexus-cortex/core).
bootstrapEnv(ROOT_DIR);

// cortex.tsx only understands direct/server — force direct mode
// (CORTEX_MODE=stateless is a server-side concept)
process.env.CORTEX_MODE = 'direct';

await import('../dist/cortex.js');
