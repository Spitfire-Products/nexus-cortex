#!/usr/bin/env node

/**
 * cortex — Natural language interface to the Nexus Cortex library
 *
 * Usage:
 *   cortex "Read package.json and tell me the version"
 *   cortex --model deepseek-v4-flash "Explain generics"
 *   cortex --resume abc123 "Continue from where we left off"
 *   cortex --new "Start a fresh conversation"
 *   cortex --json "Give me raw response"
 *   cortex --stats
 *   cortex --sessions
 *
 * Connects to a running Nexus Cortex server (default: localhost:4000).
 * If no server is running, prints instructions to start one.
 *
 * Designed for:
 *   - Quick natural language queries from the shell
 *   - Agent-to-agent communication (invoke as a task tool)
 *   - Scripting and pipeline integration (--json mode)
 *   - Multi-turn conversations via session resume
 */

import { spawn, spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync, readFileSync, realpathSync, mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { createRequire } from 'module';

const __cortex_require = createRequire(import.meta.url);
const __cortex_filename = fileURLToPath(import.meta.url);
const __cortex_dirname = dirname(realpathSync(__cortex_filename));
const MONOREPO_ROOT = resolve(__cortex_dirname, '..', '..', '..');

// Locate the server entry. From a git clone it's the monorepo's built server;
// from an npm install (`@nexus-cortex/cli` alongside `@nexus-cortex/server`) it's
// resolved through node_modules. Falls back to the monorepo path so the
// "not found" guidance in startServer() still fires when neither exists.
function resolveServerEntry() {
  const monorepoServer = join(MONOREPO_ROOT, 'packages', 'server', 'dist', 'index.js');
  if (existsSync(monorepoServer)) return monorepoServer;
  try {
    return __cortex_require.resolve('@nexus-cortex/server');
  } catch {
    return monorepoServer;
  }
}
const SERVER_ENTRY = resolveServerEntry();

// Resolve CORTEX_ROOT (the install root holding the shipped .cortex scaffold —
// builtin agents/skills) when the user hasn't set it. Git clone → the monorepo
// root; npm install → this package's root, where prepack vendored the scaffold.
// Inherited by the spawned server, so AgentStore/SkillTool builtin tiers resolve.
const CLI_PKG_ROOT = resolve(__cortex_dirname, '..');
if (!process.env.CORTEX_ROOT) {
  if (existsSync(join(MONOREPO_ROOT, '.cortex'))) process.env.CORTEX_ROOT = MONOREPO_ROOT;
  else if (existsSync(join(CLI_PKG_ROOT, '.cortex'))) process.env.CORTEX_ROOT = CLI_PKG_ROOT;
}

const BASE_PORT = process.env.PORT || '4000';
const BASE_URL = process.env.CORTEX_URL || `http://localhost:${BASE_PORT}`;

// ── Self-update (transparent) ─────────────────────────────────────
// No silent background install (the old approach failed invisibly and locked itself).
// Instead: a one-line "update available" notice when a newer release exists (read from
// a tiny cached version check), and `cortex --update` to update on the spot with visible
// npm output. Silence the notice with CORTEX_NO_UPDATE_NOTICE=true.
const UPDATE_CACHE = join(homedir(), '.cortex', '.update-check');
const PKG_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(__cortex_dirname, '..', 'package.json'), 'utf8')).version; }
  catch { return null; }
})();

function semverGt(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return false;
}

async function fetchLatestVersion() {
  try {
    const https = await import('node:https');
    return await new Promise((resolve) => {
      const req = https.get('https://registry.npmjs.org/nexus-cortex/latest', { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => { try { resolve(JSON.parse(body).version); } catch { resolve(null); } });
      });
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    });
  } catch { return null; }
}

// Show the notice from cache (instant, no network); refresh the cache in the background
// when stale — a tiny registry GET, NEVER an install. Best-effort; never blocks/throws.
function notifyUpdateAvailable() {
  try {
    if (String(process.env.CORTEX_NO_UPDATE_NOTICE).toLowerCase() === 'true') return;
    if (!PKG_VERSION || !__cortex_dirname.includes('node_modules')) return;
    let cache = {};
    try { cache = JSON.parse(readFileSync(UPDATE_CACHE, 'utf8')); } catch { /* none/legacy — refresh below */ }
    if (cache.latest && semverGt(cache.latest, PKG_VERSION)) {
      process.stderr.write(`\n  ↑ Update available: ${PKG_VERSION} → ${cache.latest} · run \`cortex --update\`\n\n`);
    }
    const THROTTLE = 12 * 60 * 60 * 1000;
    if (!cache.lastCheck || Date.now() - cache.lastCheck > THROTTLE) {
      fetchLatestVersion().then((latest) => {
        try {
          mkdirSync(dirname(UPDATE_CACHE), { recursive: true });
          writeFileSync(UPDATE_CACHE, JSON.stringify({ lastCheck: Date.now(), latest: latest || cache.latest || null }));
        } catch { /* ignore */ }
      }).catch(() => {});
    }
  } catch { /* never let the notice affect the CLI */ }
}

let serverProcess = null;

// ── Argument parsing ──────────────────────────────────────────────

const args = process.argv.slice(2);

// ── Version ───────────────────────────────────────────────────────
// Standalone — no server needed. Reads this package's own package.json.
if (args.includes('--version') || args.includes('-v')) {
  let version = 'unknown';
  try {
    version = JSON.parse(
      readFileSync(join(__cortex_dirname, '..', 'package.json'), 'utf8'),
    ).version;
  } catch { /* leave 'unknown' */ }
  console.log(`cortex ${version}`);
  process.exit(0);
}

// ── Self-update command ───────────────────────────────────────────
// `cortex --update` — update the global install on the spot, with visible npm output.
if (args.includes('--update')) {
  process.stdout.write(`Updating nexus-cortex (current: ${PKG_VERSION || 'unknown'})…\n\n`);
  const res = spawnSync('npm', ['install', '-g', 'nexus-cortex@latest'], { stdio: 'inherit' });
  if (res.status === 0) {
    try { mkdirSync(dirname(UPDATE_CACHE), { recursive: true }); writeFileSync(UPDATE_CACHE, JSON.stringify({ lastCheck: Date.now(), latest: null })); } catch { /* ignore */ }
    process.stdout.write('\n✓ Updated. Run `cortex --version` to confirm.\n');
    process.exit(0);
  }
  process.stderr.write('\nUpdate failed — see the npm output above. If it is a permissions error, try:\n  sudo npm install -g nexus-cortex@latest\n');
  process.exit(res.status || 1);
}

// `cortex --uninstall` — remove the global install. Config/keys at ~/.cortex are LEFT
// in place (so you don't lose your API key by accident); the message says how to remove them.
if (args.includes('--uninstall')) {
  process.stdout.write('Uninstalling nexus-cortex…\n\n');
  const res = spawnSync('npm', ['uninstall', '-g', 'nexus-cortex'], { stdio: 'inherit' });
  if (res.status === 0) {
    process.stdout.write('\n✓ Uninstalled. Your config and API key remain at ~/.cortex — to remove those too:\n  rm -rf ~/.cortex\n');
    process.exit(0);
  }
  process.stderr.write('\nUninstall failed — see the npm output above. If it is a permissions error, try:\n  sudo npm uninstall -g nexus-cortex\n');
  process.exit(res.status || 1);
}

// Update-available notice (skip for machine-readable / quiet output).
if (!args.includes('--json') && !args.includes('--quiet') && !args.includes('-q')) {
  notifyUpdateAvailable();
}

// ── Setup wizard (interactive API-key onboarding) ─────────────────
// Global config lives at ~/.cortex/.env so a global npm install works from ANY
// folder (the server loads it). Runs on `cortex config init` and on first run
// when no key is configured anywhere.
const PROVIDERS = [
  { name: 'Anthropic (Claude)', keyVar: 'ANTHROPIC_API_KEY', model: 'claude-sonnet-4-6', hint: 'sk-ant-…' },
  { name: 'OpenAI (GPT)',       keyVar: 'OPENAI_API_KEY',    model: 'gpt-5-mini',        hint: 'sk-…' },
  { name: 'Google (Gemini)',    keyVar: 'GEMINI_API_KEY',    model: 'gemini-2.5-flash',  hint: 'AIza…' },
  { name: 'DeepSeek',           keyVar: 'DEEPSEEK_API_KEY',  model: 'deepseek-v4-pro',   hint: 'sk-…' },
  { name: 'xAI (Grok)',         keyVar: 'XAI_API_KEY',       model: 'grok-4.3',          hint: 'xai-…' },
];
const KEY_VARS = [...PROVIDERS.map((p) => p.keyVar), 'GOOGLE_API_KEY'];
const GLOBAL_ENV = join(homedir(), '.cortex', '.env');

function hasApiKey() {
  if (KEY_VARS.some((k) => (process.env[k] || '').trim())) return true;
  for (const f of [GLOBAL_ENV, join(process.cwd(), '.env')]) {
    try {
      const txt = readFileSync(f, 'utf8');
      if (KEY_VARS.some((k) => new RegExp('^' + k + '=\\S', 'm').test(txt))) return true;
    } catch { /* file absent */ }
  }
  return false;
}

function writeGlobalEnv(kv) {
  mkdirSync(dirname(GLOBAL_ENV), { recursive: true });
  let lines = [];
  try { lines = readFileSync(GLOBAL_ENV, 'utf8').split('\n').filter((l) => l.length); } catch { /* new file */ }
  for (const [k, v] of Object.entries(kv)) {
    const i = lines.findIndex((l) => l.startsWith(k + '='));
    if (i >= 0) lines[i] = `${k}=${v}`; else lines.push(`${k}=${v}`);
  }
  writeFileSync(GLOBAL_ENV, lines.join('\n') + '\n', { mode: 0o600 }); // user-only — holds a secret
}

async function runSetupWizard() {
  if (!process.stdin.isTTY) {
    process.stderr.write(
      '\n  No API key configured. Run `cortex config init` for interactive setup, or set one:\n' +
      '    export ANTHROPIC_API_KEY=sk-ant-…\n' +
      '    export DEFAULT_MODEL_ID=claude-sonnet-4-6\n\n',
    );
    process.exit(1);
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    process.stdout.write('\n  Welcome to Nexus Cortex — quick setup (~30s).\n\n  Which AI provider?\n');
    PROVIDERS.forEach((p, i) => process.stdout.write(`    ${i + 1}) ${p.name}\n`));
    let choice;
    for (;;) {
      const n = parseInt((await rl.question(`\n  Choose 1-${PROVIDERS.length}: `)).trim(), 10);
      if (n >= 1 && n <= PROVIDERS.length) { choice = PROVIDERS[n - 1]; break; }
      process.stdout.write(`  Please enter a number 1-${PROVIDERS.length}.\n`);
    }
    let key = '';
    while (!key) {
      key = (await rl.question(`\n  Paste your ${choice.name} API key (${choice.hint}): `)).trim();
      if (!key) process.stdout.write('  An API key is required.\n');
    }
    const model = (await rl.question(`\n  Default model [${choice.model}]: `)).trim() || choice.model;
    writeGlobalEnv({ [choice.keyVar]: key, DEFAULT_MODEL_ID: model });
    process.stdout.write(`\n  ✓ Saved to ${GLOBAL_ENV}\n  You're set — try:  cortex "what is 2 + 2?"\n\n`);
  } catch {
    // Ctrl-C / Ctrl-D / closed input — exit cleanly instead of dumping a stack trace.
    process.stdout.write('\n  Setup cancelled. Run `cortex config init` any time to finish.\n');
    rl.close();
    process.exit(1);
  } finally {
    rl.close();
  }
}

// `cortex config init` — interactive setup (intercept before the Commander handoff).
if (args[0] === 'config' && args[1] === 'init') {
  await runSetupWizard();
  process.exit(0);
}

// ── Headless Commander delegation ─────────────────────────────────
// `cortex` is primarily the HTTP chat/PR client; the headless Commander program
// (autoresearch, models, message, mcp, config, …) lives in dist/index.js. If the
// first positional arg is one of those subcommands, hand the whole invocation off
// to it — this is what makes `cortex autoresearch experiment … --json` work on PATH
// (the auto-research container contract).
const COMMANDER_SUBCOMMANDS = new Set([
  'autoresearch', 'models', 'message', 'mcp', 'config', 'permissions', 'context',
  'tools', 'middleware', 'artifact', 'cache', 'system-messages', 'tmux',
]);
const __firstPositional = args.find((a) => !a.startsWith('-'));
if (__firstPositional && COMMANDER_SUBCOMMANDS.has(__firstPositional)) {
  const CLI_ENTRY = join(__cortex_dirname, '..', 'dist', 'index.js');
  const res = spawnSync(process.execPath, [CLI_ENTRY, ...args], { stdio: 'inherit' });
  process.exit(res.status ?? 0);
}

// `cortex agent "<task>"` (alias: `cortex run`) — an autonomous one-shot agent run.
// Same as the chat one-shot, but bundles the unattended defaults: auto-approve tools
// (YOLO), a fresh session, server self-stop on idle, and an optional --cwd to target a
// directory without `cd`. Defaults are applied after flag parsing (below).
let __agentMode = false;
{
  const i = args.findIndex((a) => !a.startsWith('-'));
  if (i !== -1 && (args[i] === 'agent' || args[i] === 'run')) {
    __agentMode = true;
    args.splice(i, 1); // drop the subcommand word; the rest is flags + the task
  }
}

function hasFlag(name) {
  const idx = args.indexOf(name);
  if (idx !== -1) { args.splice(idx, 1); return true; }
  return false;
}

function getFlagValue(name) {
  const idx = args.indexOf(name);
  if (idx !== -1 && idx + 1 < args.length) {
    const val = args[idx + 1];
    args.splice(idx, 2);
    return val;
  }
  return null;
}

// Extract flags before consuming remaining args as prompt
const showHelp = hasFlag('--help') || hasFlag('-h');
const jsonOutput = hasFlag('--json');
let newSession = hasFlag('--new');
const showStats = hasFlag('--stats');
const showSessions = hasFlag('--sessions');
const doShutdown = hasFlag('--shutdown');
const showTmux = hasFlag('--tmux');
const quiet = hasFlag('--quiet') || hasFlag('-q');
const modelId = getFlagValue('--model') || getFlagValue('-m');
const resumeId = getFlagValue('--resume');
const prMode = getFlagValue('--pr');
const timeoutFlag = getFlagValue('--timeout');
let idleTimeoutFlag = getFlagValue('--idle-timeout');
const cwdFlag = getFlagValue('--cwd');     // `cortex agent` target directory
hasFlag('--yolo');                         // accepted but redundant — agent auto-approves by default
const messageTimeoutMs = timeoutFlag ? parseInt(timeoutFlag, 10) : 600000; // 10 min default for messages
let prompt = args.join(' ').trim();

// Apply `cortex agent` autonomous defaults. Set BEFORE the server is auto-started so the
// spawned server inherits the cwd (project path) + YOLO env.
if (__agentMode) {
  if (cwdFlag) {
    try {
      process.chdir(resolve(cwdFlag));
    } catch (e) {
      process.stderr.write(`[agent] --cwd: cannot enter ${cwdFlag}: ${e.message}\n`);
      process.exit(1);
    }
  }
  newSession = true;                                    // each task is independent
  if (idleTimeoutFlag === null) idleTimeoutFlag = '60'; // server self-stops; no orphan
  // Headless autonomous runs have NO interactive approver — there is no human in the loop
  // to say yes/no to a tool. So the agent auto-approves all tools (the practical reality of
  // unattended operation). Disclosed up front; scope `cortex agent` to a throwaway / worktree
  // / sandbox directory on a real repo. (A future opt-in "agent-safe" profile would hard-deny
  // destructive ops instead of auto-approving — see research/future_ideas.)
  process.env.YOLO = 'true';
  process.stderr.write(
    '[agent] autonomous: auto-approving all tools (headless has no interactive approver). ' +
    'Point it at a throwaway/worktree/sandbox dir if the files matter.\n',
  );
}

// ── Help ──────────────────────────────────────────────────────────

if (showHelp) {
  console.log(`
cortex — Natural language interface to the Nexus Cortex library

USAGE:
  cortex "your prompt here"              Send a message (continues current session)
  cortex agent "<task>"                  Autonomous one-shot agent run (see below)
  cortex --new "start fresh"             Start new session, then send message
  cortex --model MODEL_ID "prompt"       Use a specific model
  cortex --resume SESSION_ID "prompt"    Resume a specific session
  cortex --json "prompt"                 Output raw JSON response
  cortex --stats                         Show current session stats
  cortex --sessions                      List all sessions
  cortex --quiet "prompt"                Suppress session info, print only response
  cortex --shutdown                      Stop the running server
  cortex --idle-timeout 300 "prompt"     Auto-shutdown server after 300s idle

AGENT (autonomous one-shot):
  cortex agent "<task>"                  Run one autonomous agent task to completion, then exit.
  cortex agent --cwd <dir> "<task>"      Target a directory (no need to cd into it first).
                                         Autonomous & unattended: auto-approves all tools
                                         (headless has no interactive approver), starts a fresh
                                         session, and self-stops the server on idle. On a real
                                         repo, point it at a throwaway/worktree/sandbox dir.
                                         Combine with --json for scripting/agent pipelines.
                                         (alias: cortex run "<task>")

FLAGS:
  --help, -h          Show this help
  --version, -v       Print the cortex version and exit
  --model, -m ID      Model to use (overrides server default)
  --new               Start a fresh session before sending
  --resume ID         Resume a specific session by UUID
  --json              Output full JSON response (for scripting/agents)
  --quiet, -q         Response text only, no session info
  --timeout MS        Request timeout in ms (default: 600000 = 10 min)
  --idle-timeout SECS Auto-shutdown server after N seconds of inactivity
  --cwd DIR           (agent) Run in DIR — the agent's file tools operate there
  --update            Update nexus-cortex to the latest version (npm i -g)
                      (a notice appears when you're behind; CORTEX_NO_UPDATE_NOTICE=true to silence)
  --uninstall         Remove the global nexus-cortex install (keeps ~/.cortex config)
  --shutdown          Stop the running server and exit
  --tmux              List active tmux sessions with dashboard URLs
  --stats             Show current session statistics
  --sessions          List all saved sessions
  --pr MODE           PR management (review, list, create)

ENVIRONMENT:
  CORTEX_URL          Server URL (default: http://localhost:4000)
  PORT                Server port (default: 4000)
  SERVER_IDLE_TIMEOUT Server auto-shutdown after N seconds idle (default: 0 = off)

EXAMPLES:
  cortex "What is this project?"
  cortex --model deepseek-v4-flash "Explain TypeScript generics"
  cortex "Read package.json" && cortex "What was the version?"
  cortex --json "list files" | jq '.toolUses[].name'
  cortex --new "Let's start over"

PR MANAGEMENT:
  cortex --pr review owner/repo 123      Review a PR with parallel agents
  cortex --pr list owner/repo            List open PRs
  cortex --pr create owner/repo --branch feature-x  Create PR from changes

AGENT TEAM USAGE:
  The session ID printed after each response enables multi-turn workflows:

    SESSION=$(cortex --quiet --json "Analyze test gaps" | jq -r '.sessionId')
    cortex --resume $SESSION "Now fix the top priority gap"
    cortex --resume $SESSION "Run the tests to verify"

SERVER:
  Auto-starts a server if none is running. The server persists in the
  background after cortex exits. Use --shutdown to stop it.
  Use --idle-timeout to auto-stop the server after a period of inactivity.
`);
  process.exit(0);
}

// ── HTTP helpers ──────────────────────────────────────────────────

async function isServerUp() {
  try {
    const resp = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(2000) });
    return resp.ok;
  } catch { return false; }
}

async function shutdownServer() {
  if (!(await isServerUp())) {
    process.stderr.write(`[cortex] No server running on ${BASE_URL}\n`);
    process.exit(0);
  }
  try {
    await fetch(`${BASE_URL}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(5000) });
    process.stderr.write(`[cortex] Server shutdown requested\n`);
  } catch {
    process.stderr.write(`[cortex] Failed to reach server for shutdown\n`);
    process.exit(1);
  }
}

async function startServer() {
  if (!existsSync(SERVER_ENTRY)) {
    console.error('[cortex] Nexus Cortex server not found.');
    console.error('  npm install:  npm install @nexus-cortex/server');
    console.error('  from source:  npm run build  (from the monorepo root)');
    process.exit(1);
  }
  process.stderr.write(`[cortex] No server on ${BASE_URL} -- starting one...\n`);
  const serverArgs = [SERVER_ENTRY];
  if (idleTimeoutFlag) {
    serverArgs.push('--idle-timeout', idleTimeoutFlag);
  }
  serverProcess = spawn('node', serverArgs, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: BASE_PORT },
    detached: true,
  });
  serverProcess.unref();

  serverProcess.stderr.on('data', (chunk) => {
    const line = chunk.toString();
    if (line.includes('[ERROR]') || line.includes('Failed to start')) {
      process.stderr.write(line);
    }
  });

  // Wait for healthy (up to 15s)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isServerUp()) {
      process.stderr.write(`[cortex] Server ready on ${BASE_URL}\n`);
      // The server is detached + unref'd so it persists on its own. Its piped
      // stdio handles, however, keep THIS short-lived client's event loop alive
      // — so after a one-shot the client would hang until killed. Unref the
      // pipes so the client can exit cleanly once its request completes while
      // the background server keeps running.
      serverProcess.stdout?.unref?.();
      serverProcess.stderr?.unref?.();
      return;
    }
  }
  console.error('[cortex] Server failed to start within 15s');
  process.exit(1);
}

async function ensureServer() {
  if (!(await isServerUp())) {
    await startServer();
  }
}

async function fetchJSON(path, options = {}, timeoutMs = 30000) {
  try {
    const resp = await fetch(`${BASE_URL}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
      ...options,
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    return await resp.json();
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      console.error(`Request timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
      process.exit(1);
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      console.error('[cortex] Lost connection to server at ' + BASE_URL);
      process.exit(1);
    }
    throw err;
  }
}

// ── Commands ──────────────────────────────────────────────────────

// Interactive chat REPL — `cortex` with no message drops you here so you can talk
// line-by-line without the shell mangling ?/*/quotes. The server keeps the session,
// so it's multi-turn. Reuses the same /v1/messages send as the one-shot path.
async function runInteractiveChat() {
  if (newSession) {
    try { await fetchJSON('/sessions/new', { method: 'POST' }); } catch { /* fresh session is best-effort */ }
  }
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  process.stdout.write(
    '\n  Nexus Cortex — interactive chat. Type a message and press Enter.\n' +
    '  The session persists across messages. Type "exit" (or press Ctrl-D) to quit.\n\n',
  );
  try {
    for (;;) {
      let line;
      try { line = (await rl.question('cortex> ')).trim(); }
      catch { break; } // Ctrl-D / closed input
      if (!line) continue;
      if (line === 'exit' || line === 'quit' || line === ':q') break;
      const payload = { messages: [{ role: 'user', content: line }] };
      if (modelId) payload.model = modelId;
      try {
        const data = await fetchJSON('/v1/messages', { method: 'POST', body: JSON.stringify(payload) }, messageTimeoutMs);
        const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
        process.stdout.write('\n' + (text || '(no text response)') + '\n\n');
      } catch (err) {
        process.stderr.write(`\n  [error] ${err.message}\n\n`);
      }
    }
  } finally {
    rl.close();
  }
  process.stdout.write('  Bye.\n');
}

async function run() {
  // --shutdown: stop the server and exit
  if (doShutdown) {
    await shutdownServer();
    return;
  }

  // First-run onboarding: no API key anywhere → walk the user through setup before
  // starting the server. Skipped for pure server-management invocations.
  const SKIP_SETUP = ['--help', '-h', '--stats', '--sessions', '--tmux'].some((f) => args.includes(f));
  if (!SKIP_SETUP && !hasApiKey()) {
    await runSetupWizard();
  }

  await ensureServer();

  // --tmux: list active tmux sessions (served by SandboxViewServer on port+1)
  if (showTmux) {
    try {
      const viewPort = parseInt(BASE_PORT, 10) + 1;
      const viewUrl = `http://localhost:${viewPort}`;
      const tmuxResp = await fetch(`${viewUrl}/api/tmux/sessions`, {
        signal: AbortSignal.timeout(10000),
      });
      if (!tmuxResp.ok) throw new Error(`HTTP ${tmuxResp.status}: ${await tmuxResp.text()}`);
      const resp = await tmuxResp.json();
      const sessions = resp.sessions || [];
      if (jsonOutput) {
        console.log(JSON.stringify(resp, null, 2));
        return;
      }
      if (sessions.length === 0) {
        console.log('[OK] No active tmux sessions');
        return;
      }
      const dashboardBase = resp.dashboardUrl || `http://localhost:${viewPort}/tmux`;
      console.log(`Tmux Sessions (${sessions.length}):\n`);
      for (const s of sessions) {
        const created = s.created ? new Date(s.created).toLocaleString() : '?';
        const lastUsed = s.lastUsed ? new Date(s.lastUsed).toLocaleString() : '?';
        const tag = s.recovered ? '[RECOVERED]' : '[ACTIVE]';
        console.log(`  ${tag} ${s.sessionId}`);
        console.log(`    Directory:  ${s.workingDirectory || '?'}`);
        console.log(`    Created:    ${created}`);
        console.log(`    Last Used:  ${lastUsed}`);
        if (s.recovered && s.recoveredAt) {
          console.log(`    Recovered:  ${new Date(s.recoveredAt).toLocaleString()}`);
        }
        console.log(`    Dashboard:  ${dashboardBase}/${s.sessionId}`);
        console.log('');
      }
    } catch (err) {
      console.error(`[WARN] Failed to list tmux sessions: ${err.message}`);
      process.exit(1);
    }
    return;
  }

  // --sessions: list all sessions
  if (showSessions) {
    const raw = await fetchJSON('/sessions');
    const sessions = raw.sessions || raw; // handle {sessions:[...]} or bare array
    if (jsonOutput) {
      console.log(JSON.stringify(sessions, null, 2));
    } else {
      if (!Array.isArray(sessions) || sessions.length === 0) {
        console.log('No sessions found.');
        return;
      }
      console.log(`Sessions (${sessions.length}):\n`);
      for (const s of sessions) {
        const modified = s.lastModified || s.metadata?.lastModified;
        const age = modified ? timeSince(new Date(modified)) : '?';
        const msgs = s.messageCount || s.metadata?.messageCount || '?';
        console.log(`  ${s.sessionId.substring(0, 8)}...  ${msgs} msgs  ${age} ago`);
      }
    }
    return;
  }

  // --stats: show current session stats
  if (showStats) {
    // Get sessions list to find the current one
    const raw = await fetchJSON('/sessions');
    const sessions = raw.sessions || raw;
    if (!Array.isArray(sessions) || sessions.length === 0) {
      console.log('No active session.');
      return;
    }
    const current = sessions[0]; // most recent
    try {
      const stats = await fetchJSON(`/sessions/${current.sessionId}/stats`);
      if (jsonOutput) {
        console.log(JSON.stringify(stats, null, 2));
      } else {
        console.log(`Session: ${current.sessionId.substring(0, 8)}...`);
        console.log(`Messages: ${stats.messageCount || '?'}`);
        console.log(`Turns: ${stats.turnCount || '?'}`);
        if (stats.tokenUsage) {
          console.log(`Tokens: ${stats.tokenUsage.totalInput || 0} in / ${stats.tokenUsage.totalOutput || 0} out`);
        }
        if (stats.toolUsage) {
          console.log(`Tool calls: ${stats.toolUsage.totalCalls || 0}`);
        }
      }
    } catch (e) {
      console.log(`Session: ${current.sessionId.substring(0, 8)}... (${current.messageCount || '?'} messages)`);
    }
    return;
  }

  // --pr: PR management shorthand
  if (prMode) {
    // Parse: --pr review owner/repo 123, --pr list owner/repo, --pr create owner/repo --branch feature-x
    const mode = prMode; // review, list, create
    const remaining = prompt.split(/\s+/);
    const repo = remaining[0] || '';
    const prNumber = remaining[1] || '';

    if (mode === 'review' && repo && prNumber) {
      prompt = `Use the PRAgent tool in review mode for repo "${repo}" PR #${prNumber}. Extract the diff and metadata, then dispatch parallel audit agents (security, quality, architecture) to review it. Synthesize their findings into a final review.`;
    } else if (mode === 'list' && repo) {
      prompt = `Use the PRAgent tool in list mode for repo "${repo}". Show all open PRs with their number, title, author, and review status.`;
    } else if (mode === 'create' && repo) {
      const branch = getFlagValue('--branch') || 'main';
      prompt = `Use the WorkspaceManager tool to create a worktree for repo "${repo}" on branch "${branch}", then use the PRAgent tool in create mode to set up a PR workflow.`;
    } else {
      console.error('Usage: cortex --pr review owner/repo 123');
      console.error('       cortex --pr list owner/repo');
      console.error('       cortex --pr create owner/repo --branch feature-x');
      process.exit(1);
    }
  }

  // No message provided. In an interactive terminal (and NOT agent/run mode), drop
  // into the chat REPL so the shell never mangles ?/*/quotes. agent/run with no task,
  // or any non-TTY (scripted) use, still gets the usage error — unchanged.
  if (!prompt) {
    if (!__agentMode && process.stdin.isTTY) {
      await runInteractiveChat();
      return;
    }
    console.error(__agentMode
      ? 'Usage: cortex agent "<task>"   (or cortex run "<task>")'
      : 'Usage: cortex "your prompt here"');
    console.error('       cortex --help for more options');
    process.exit(1);
  }

  // --new: create fresh session first
  if (newSession) {
    await fetchJSON('/sessions/new', { method: 'POST' });
    if (!quiet) {
      process.stderr.write('New session created.\n');
    }
  }

  // --resume: switch to a specific session
  if (resumeId) {
    try {
      const result = await fetchJSON(`/sessions/${resumeId}/load`, { method: 'POST' });
      if (!quiet) {
        process.stderr.write(`Resumed session ${resumeId.substring(0, 8)}... (${result.messageCount} messages)\n`);
      }
    } catch (err) {
      process.stderr.write(`Failed to resume session ${resumeId}: ${err.message}\n`);
      process.exit(1);
    }
  }

  // Build the model ID - only set when user passed -m explicitly. When omitted,
  // leave it out of the payload so the server can pick the session's current model
  // (important on --resume: forcing a local fallback like "grok-4-1-fast-reasoning"
  // would silently override the session's persisted model and break the
  // previous_response_id chain on XAI Responses API sessions).
  const health = await fetchJSON('/health');

  const payload = {
    messages: [{ role: 'user', content: prompt }],
  };
  if (modelId) {
    payload.model = modelId;
  }

  const data = await fetchJSON('/v1/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, messageTimeoutMs);

  // --json: raw output
  if (jsonOutput) {
    // Inject sessionId for agent workflows
    const raw = await fetchJSON('/sessions');
    const sessions = raw.sessions || raw;
    if (Array.isArray(sessions) && sessions.length > 0) {
      data.sessionId = sessions[0].sessionId;
    }
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  // Extract text content
  const text = (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n');

  // Print response
  console.log(text);

  // Print session info to stderr (unless --quiet)
  if (!quiet) {
    const usage = data.usage || {};
    const tools = (data.toolUses || []).length;
    const iterations = data.metadata?.toolCallIterations || 0;
    const parts = [];
    if (usage.inputTokens) parts.push(`${usage.inputTokens} in`);
    if (usage.outputTokens) parts.push(`${usage.outputTokens} out`);
    if (tools > 0) parts.push(`${tools} tool${tools > 1 ? 's' : ''}`);
    if (iterations > 0) parts.push(`${iterations} iteration${iterations > 1 ? 's' : ''}`);
    if (parts.length > 0) {
      process.stderr.write(`\n[${parts.join(' | ')}]\n`);
    }
  }
}

// ── Utilities ─────────────────────────────────────────────────────

function timeSince(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

// ── Entry point ───────────────────────────────────────────────────

run().catch(err => {
  console.error(err.message || err);
  process.exit(1);
});
