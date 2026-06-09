#!/usr/bin/env node
/**
 * Nexus Cortex Unified Launcher
 *
 * Starts server as child process and launches CLI
 * Server shuts down when CLI exits (Ctrl+C)
 *
 * Usage:
 *   cortex           # Normal mode
 *   cortex --dev     # Dev mode with hot reload
 *   cortex [command] # Forward to CLI
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, realpathSync } from 'fs';
import http from 'http';
import { config } from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
// Resolve symlinks to get actual path (important for npm link)
const __dirname = dirname(realpathSync(__filename));

// Paths - resolved from actual location, not symlink
const CLI_DIR = join(__dirname, '..');
const SERVER_DIR = join(CLI_DIR, '..', 'server');
const PKG_ROOT = join(CLI_DIR, '..', '..');

// Load .env: cwd first (user's project), then package root (dev/monorepo).
// dotenv's default is "first wins" — cwd values take priority.
const cwdEnv = join(process.cwd(), '.env');
const pkgEnv = join(PKG_ROOT, '.env');
const cwdEnvLocal = join(process.cwd(), '.env.local');
const pkgEnvLocal = join(PKG_ROOT, '.env.local');

if (existsSync(cwdEnv)) config({ path: cwdEnv, quiet: true });
if (existsSync(pkgEnv)) config({ path: pkgEnv, quiet: true });
if (existsSync(cwdEnvLocal)) config({ path: cwdEnvLocal, override: true, quiet: true });
if (existsSync(pkgEnvLocal)) config({ path: pkgEnvLocal, override: true, quiet: true });

// Parse arguments
const args = process.argv.slice(2);
const isDevMode = args.includes('--dev');

// Parse --server and --prompt flags
let serverMode = false;
let serverUrl = null;
let promptArg = null;
let cliArgs = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--server') {
    serverMode = true;
    // Check if next arg is a URL
    if (i + 1 < args.length && args[i + 1].startsWith('http')) {
      serverUrl = args[i + 1];
      i++; // Skip the URL arg
    }
  } else if (arg === '--prompt' || arg === '-P') {
    if (i + 1 < args.length) {
      promptArg = args[i + 1];
      i++; // Skip the prompt value
    }
  } else if (arg !== '--dev') {
    cliArgs.push(arg);
  }
}

// Configuration
const PORT = process.env.PORT || 4000;
const DEFAULT_SERVER_URL = `http://localhost:${PORT}`;

// Determine mode
const mode = serverMode ? 'server' : 'direct';
const finalServerUrl = serverUrl || DEFAULT_SERVER_URL;

// Colors and ANSI codes
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

// Track child processes
let serverProcess = null;
let cliProcess = null;

/**
 * Graceful shutdown handler
 */
function setupShutdownHandler() {
  let shuttingDown = false;

  const shutdown = (signal) => {
    // Prevent multiple shutdown attempts
    if (shuttingDown) return;
    shuttingDown = true;

    // Don't print anything here - let the CLI clean up its own terminal state
    // The 'exit' handler on cliProcess will print the exit message

    // Kill CLI (it will clean up its own terminal)
    if (cliProcess && !cliProcess.killed) {
      cliProcess.kill('SIGTERM');
    }

    // Kill server
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGTERM');

      // Force kill after 3 seconds if still running
      setTimeout(() => {
        if (serverProcess && !serverProcess.killed) {
          serverProcess.kill('SIGKILL');
        }
      }, 3000);
    }

    // Exit after brief delay to let processes clean up
    setTimeout(() => {
      process.exit(0);
    }, 500);
  };

  // Handle Ctrl+C and termination signals
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Handle CLI exit
  process.on('exit', () => {
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill('SIGKILL');
    }
  });
}

/**
 * Check if server is running
 */
async function isServerRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${finalServerUrl}/health`, (res) => {
      resolve(res.statusCode === 200);
    });

    req.on('error', () => resolve(false));
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
 * Start server in production mode
 */
async function startServerProduction() {
  log('[INIT] Starting server...', 'cyan');

  const serverEntry = join(SERVER_DIR, 'dist', 'index.js');
  if (!existsSync(serverEntry)) {
    log('[ERROR]Server not built. Run: cd packages/server && npm run build', 'red');
    process.exit(1);
  }

  // Start server as CHILD process (not detached)
  serverProcess = spawn('node', [serverEntry], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'], // Capture output
  });

  // Log server output with prefix
  serverProcess.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) log(`   [server] ${line}`, 'dim');
    });
  });

  serverProcess.stderr?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) log(`   [server] ${line}`, 'red');
    });
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`[ERROR]Server exited with code ${code}`, 'red');
      process.exit(code);
    }
  });

  // Wait for server to be ready
  const ready = await waitForServer();
  if (!ready) {
    log('[ERROR]Server failed to start', 'red');
    process.exit(1);
  }

  log('[OK]Server ready', 'green');
}

/**
 * Start server in dev mode with hot reload
 */
async function startServerDev() {
  log('[INIT] Starting server in DEV MODE (hot reload enabled)...', 'magenta');

  // Check if tsx is available
  const serverSrc = join(SERVER_DIR, 'src', 'index.ts');
  if (!existsSync(serverSrc)) {
    log('[ERROR]Server source not found', 'red');
    process.exit(1);
  }

  // Start server with tsx watch
  serverProcess = spawn('npx', ['tsx', 'watch', serverSrc], {
    cwd: SERVER_DIR,
    env: {
      ...process.env,
      PORT: String(PORT),
      DEBUG: 'true',
      NODE_ENV: 'development',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Log server output
  serverProcess.stdout?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) log(`   ${colors.magenta}[SERVER]${colors.reset} ${line}`, 'dim');
    });
  });

  serverProcess.stderr?.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line) log(`   ${colors.magenta}[SERVER]${colors.reset} ${line}`, 'red');
    });
  });

  serverProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      log(`[ERROR]Server exited with code ${code}`, 'red');
      process.exit(code);
    }
  });

  // Wait for server
  const ready = await waitForServer();
  if (!ready) {
    log('[ERROR]Server failed to start', 'red');
    process.exit(1);
  }

  log('[OK]Server ready (watching for changes)', 'green');
}

/**
 * Create a new session on the server
 */
async function createNewSession() {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      modelId: process.env.DEFAULT_MODEL_ID,
      projectPath: process.cwd()
    });

    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/sessions/new',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 5000
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.success) {
            log(`[OK]New session created: ${response.sessionId}`, 'green');
            log(`  Model: ${response.model.name} (${response.model.contextWindow} tokens)`, 'dim');
            resolve(response);
          } else {
            reject(new Error(response.error?.message || 'Failed to create session'));
          }
        } catch (e) {
          reject(new Error(`Invalid response from server: ${data}`));
        }
      });
    });

    req.on('error', (err) => {
      reject(new Error(`Failed to create session: ${err.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Session creation timed out'));
    });

    req.write(postData);
    req.end();
  });
}

/**
 * Launch CLI
 */
async function launchCLI() {
  if (isDevMode) {
    const modeLabel = mode === 'direct' ? 'DIRECT MODE' : 'SERVER MODE';
    log(`\n[LAUNCH] CLI (${modeLabel} DEV)`, 'cyan');
    if (mode === 'direct') {
      log('   Using core library directly', 'dim');
    } else {
      log(`   Connecting to: ${finalServerUrl}`, 'dim');
    }
  }

  const cliEntry = isDevMode
    ? join(CLI_DIR, 'src', 'index.ts')
    : join(CLI_DIR, 'dist', 'index.js');

  if (!existsSync(cliEntry)) {
    const hint = isDevMode
      ? 'Source files missing'
      : 'CLI not built. Run: cd packages/cli && npm run build';
    log(`[ERROR]${hint}`, 'red');
    process.exit(1);
  }

  // Build command args
  const command = isDevMode ? 'npx' : 'node';
  const baseArgs = isDevMode ? ['tsx', cliEntry] : [cliEntry];

  // Add command (default to chat, or 'message' if --prompt was provided)
  let cliCommand;
  if (promptArg && cliArgs.length === 0) {
    cliCommand = ['message', promptArg];
  } else {
    cliCommand = cliArgs.length > 0 ? cliArgs : ['chat'];
  }
  const cmdArgs = [...baseArgs, ...cliCommand];

  // Add --server flag if in server mode
  if (mode === 'server') {
    cmdArgs.push('--server', finalServerUrl);
  }

  // Add --debug in dev mode
  if (isDevMode && !cmdArgs.includes('--debug')) {
    cmdArgs.push('--debug');
  }

  // Start CLI
  // Set CORTEX_* env for the spawned CLI process
  cliProcess = spawn(command, cmdArgs, {
    stdio: 'inherit',
    env: {
      ...process.env,
      CORTEX_MODE: mode,
      CORTEX_SERVER_URL: mode === 'server' ? finalServerUrl : '',
      CORTEX_ROOT: PKG_ROOT,
      NODE_ENV: isDevMode ? 'development' : 'production',
    },
  });

  cliProcess.on('exit', (code) => {
    // Brief delay to let CLI finish any final terminal cleanup
    setTimeout(() => {
      // Reset terminal state before writing exit messages
      resetTerminal();

      // CLI exited, shut down server
      log('[OK] Session ended', 'dim');
      if (serverProcess && !serverProcess.killed) {
        serverProcess.kill('SIGTERM');
      }
      setTimeout(() => process.exit(code || 0), 300);
    }, 100);
  });
}

/**
 * Main launcher
 */
async function main() {
  // Setup shutdown handlers
  setupShutdownHandler();

  // Banner (verbose in dev mode only)
  if (isDevMode) {
    const modeStr = mode === 'direct' ? 'Direct Core' : 'Server';
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'cyan');
    log(`  Nexus Cortex - ${modeStr} DEV`, mode === 'direct' ? 'cyan' : 'magenta');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n', 'cyan');

    if (existsSync(cwdEnv)) {
      log(`[OK] Configuration loaded from: ${cwdEnv}`, 'dim');
    } else if (existsSync(pkgEnv)) {
      log(`[OK] Configuration loaded from: ${pkgEnv}`, 'dim');
    } else {
      log(`[WARN] No .env file found`, 'yellow');
    }
  } else if (!existsSync(cwdEnv) && !existsSync(pkgEnv)) {
    log(`[WARN] No .env file found`, 'yellow');
  }

  // Server mode: Start server or connect to remote
  if (mode === 'server') {
    // Check if connecting to remote server
    if (serverUrl) {
      log(`\n[INIT] Connecting to remote server: ${serverUrl}`, 'cyan');
      // No need to start local server
    } else {
      // Check for existing local server
      const alreadyRunning = await isServerRunning();
      if (alreadyRunning) {
        log('[WARN]Server already running (external instance)', 'yellow');
        log('   This launcher will NOT manage that server.', 'dim');
        log('   Stop it with: pkill -f "server/dist/index.js"\n', 'dim');
      } else {
        // Start our managed local server
        if (isDevMode) {
          await startServerDev();
        } else {
          await startServerProduction();
        }

        // Create a new session
        try {
          log('\n[INIT] Creating new session...', 'cyan');
          await createNewSession();
        } catch (error) {
          log(`[WARN]Warning: ${error.message}`, 'yellow');
          log('  Continuing with existing session...', 'dim');
        }
      }
    }
  } else if (isDevMode) {
    log('\n[INIT] Direct mode: core library loaded on CLI startup', 'cyan');
  }

  // Launch CLI
  await launchCLI();
}

// Run
main().catch((err) => {
  log(`\n[ERROR]Error: ${err.message}`, 'red');
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill('SIGKILL');
  }
  process.exit(1);
});
