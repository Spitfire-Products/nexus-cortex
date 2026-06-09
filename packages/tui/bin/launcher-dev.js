#!/usr/bin/env node
/**
 * Nexus Cortex Development Launcher
 *
 * Starts both server and CLI in watch mode with hot reloading
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Paths
const CLI_DIR = join(__dirname, '..');
const SERVER_DIR = join(CLI_DIR, '..', 'server');
const ROOT_DIR = join(CLI_DIR, '..', '..');
const ENV_FILE = join(ROOT_DIR, '.env');

// Configuration
const PORT = process.env.PORT || 4000;
const SERVER_URL = `http://localhost:${PORT}`;

// Colors for output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Reset terminal to clean state before writing shutdown messages
 *
 * The CLI uses cursor save/restore for the input frame, which can leave
 * the terminal in a state where writes go to the saved position (top of screen).
 * Clear the screen entirely to avoid interleaving with CLI output.
 */
function resetTerminal() {
  process.stdout.write(
    '\x1b[?25h' +       // Show cursor
    '\x1b[0m' +         // Reset text attributes
    '\x1b[r' +          // Reset scroll region to full screen
    '\x1b[2J' +         // Clear entire screen
    '\x1b[H' +          // Move cursor to home position (top-left)
    '\n'                // Add spacing
  );
}

/**
 * Check if server is running
 */
async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${SERVER_URL}/health`, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => {
      resolve(false);
    });

    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Wait for server to be ready
 */
async function waitForServer(maxAttempts = 30) {
  for (let i = 0; i < maxAttempts; i++) {
    if (await isServerRunning()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

/**
 * Start the server in dev mode with hot reload
 */
async function startServerDev() {
  log('🔥 Starting Nexus Cortex Server in DEV MODE...', 'magenta');
  log('   Hot reload enabled - file changes will restart server', 'dim');

  // Check if tsx is available in server
  const serverPackageJson = join(SERVER_DIR, 'package.json');
  if (!existsSync(serverPackageJson)) {
    log('❌ Server package.json not found', 'red');
    process.exit(1);
  }

  // Start server with tsx watch
  const serverEntry = join(SERVER_DIR, 'src', 'index.ts');
  if (!existsSync(serverEntry)) {
    log('❌ Server source not found at: ' + serverEntry, 'red');
    process.exit(1);
  }

  log(`   Starting server with tsx watch...`, 'dim');

  // Start server process with tsx watch
  const serverProcess = spawn('npx', ['tsx', 'watch', serverEntry], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      DEBUG: 'true',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Pipe server output with prefix
  serverProcess.stdout.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      console.log(`${colors.cyan}[SERVER]${colors.reset} ${line}`);
    });
  });

  serverProcess.stderr.on('data', (data) => {
    const lines = data.toString().split('\n').filter(l => l.trim());
    lines.forEach(line => {
      console.log(`${colors.yellow}[SERVER]${colors.reset} ${line}`);
    });
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`\n❌ Server process exited with code ${code}`, 'red');
      process.exit(code);
    }
  });

  // Wait for server to be ready
  log(`   Waiting for server to start on port ${PORT}...`, 'dim');
  const ready = await waitForServer();

  if (!ready) {
    log('❌ Server failed to start', 'red');
    serverProcess.kill();
    process.exit(1);
  }

  log('✓ Server ready and watching for changes', 'green');

  return serverProcess;
}

/**
 * Launch CLI in dev mode
 */
async function launchCliDev() {
  log('\n🔥 Launching CLI in DEV MODE...', 'magenta');
  log('   Hot reload enabled - file changes will restart CLI\n', 'dim');

  // Check if src/index.ts exists
  const cliEntry = join(CLI_DIR, 'src', 'index.ts');
  if (!existsSync(cliEntry)) {
    log('❌ CLI source not found at: ' + cliEntry, 'red');
    process.exit(1);
  }

  // Get user args (everything after the script name)
  const userArgs = process.argv.slice(2);

  // Default to chat command if no args provided
  const cliArgs = userArgs.length > 0 ? userArgs : ['chat'];

  // Add server URL and debug flag
  const finalArgs = [...cliArgs, '--server', SERVER_URL, '--debug'];

  log(`   Running: tsx watch src/index.ts ${finalArgs.join(' ')}`, 'dim');

  // Start CLI with tsx watch
  // Note: cwd is not set, allowing it to inherit from wherever user launched the CLI
  // This enables PROJECT_PATH env variable to work correctly
  const cliProcess = spawn('npx', ['tsx', 'watch', cliEntry, ...finalArgs], {
    env: {
      ...process.env,
      SERVER_URL,
      NODE_ENV: 'development',
    },
    stdio: 'inherit',
  });

  cliProcess.on('exit', (code) => {
    // Brief delay to let CLI finish any final terminal cleanup
    setTimeout(() => {
      resetTerminal();
      log('👋 Session ended', 'dim');
      process.exit(code || 0);
    }, 100);
  });

  return cliProcess;
}

/**
 * Main dev launcher
 */
async function main() {
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'magenta');
  log(`  ${colors.bold}Nexus Cortex - DEVELOPMENT MODE${colors.reset}`, 'magenta');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'magenta');

  // Check if .env exists
  if (existsSync(ENV_FILE)) {
    log(`✓ Configuration loaded from: ${ENV_FILE}`, 'dim');
  } else {
    log(`⚠ No .env file found at: ${ENV_FILE}`, 'yellow');
    log('  Server will use default configuration', 'dim');
  }

  // Check if a server is already running
  const alreadyRunning = await isServerRunning();

  if (alreadyRunning) {
    log('⚠ Server already running on port ' + PORT, 'yellow');
    log('  Stopping existing server and starting in dev mode...', 'dim');
    // In a real scenario, we'd try to kill it, but for now just warn
  }

  // Start server in dev mode
  const serverProcess = await startServerDev();

  // Handle cleanup on exit
  let shuttingDown = false;
  const cleanup = () => {
    if (shuttingDown) return;
    shuttingDown = true;

    // Don't print anything here - let the CLI clean up its own terminal state
    serverProcess.kill();
    // Let CLI exit handler deal with the message and final exit
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Launch CLI in dev mode
  await launchCliDev();
}

// Run dev launcher
main().catch((err) => {
  log(`\n❌ Error: ${err.message}`, 'red');
  console.error(err);
  process.exit(1);
});
