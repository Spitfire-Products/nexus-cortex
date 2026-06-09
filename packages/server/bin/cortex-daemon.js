#!/usr/bin/env node

/**
 * Nexus Cortex - Daemon mode startup script
 * Runs server in background with logging
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Log files
const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const stdoutLog = path.join(logsDir, `nexus-cortex-${timestamp}.log`);
const stderrLog = path.join(logsDir, `nexus-cortex-${timestamp}.error.log`);

console.log(`Starting Nexus Cortex daemon...`);
console.log(`Logs: ${stdoutLog}`);
console.log(`Errors: ${stderrLog}`);

const out = fs.openSync(stdoutLog, 'a');
const err = fs.openSync(stderrLog, 'a');

const serverPath = path.join(__dirname, '../dist/index.js');

const child = spawn('node', [serverPath], {
  detached: true,
  stdio: ['ignore', out, err],
  env: { ...process.env }
});

child.unref();

console.log(`Nexus Cortex daemon started with PID: ${child.pid}`);
console.log(`To stop: kill ${child.pid}`);

process.exit(0);
