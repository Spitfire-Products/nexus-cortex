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
import { existsSync, readFileSync, realpathSync, mkdirSync, openSync, writeFileSync, copyFileSync } from 'fs';
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

// ── Headless Commander delegation ─────────────────────────────────
// `cortex` is primarily the HTTP chat/PR client; the headless Commander program
// (autoresearch, models, message, mcp, config, …) lives in dist/index.js. If the
// first positional arg is one of those subcommands, hand the whole invocation off
// to it — this is what makes `cortex autoresearch experiment … --json` work on PATH
// (the auto-research container contract).
// Parsed during flag-handling further down, but the delegation below may auto-start
// the server before that runs — declare it here (undefined => server uses its default
// idle behavior) so startServer() can read it without hitting the temporal dead zone.
let idleTimeoutFlag;

const COMMANDER_SUBCOMMANDS = new Set([
  'autoresearch', 'models', 'message', 'mcp', 'config', 'permissions', 'context',
  'tools', 'middleware', 'artifact', 'cache', 'system-messages', 'tmux',
  'update', 'uninstall',
]);
const __firstPositional = args.find((a) => !a.startsWith('-'));
if (__firstPositional && COMMANDER_SUBCOMMANDS.has(__firstPositional)) {
  // A few delegated subcommands talk to the cortex server over HTTP (they connect via
  // CortexClient to localhost:PORT). Auto-start the server first so e.g.
  // `cortex mcp enable <name>` works without a running server instead of failing with a
  // bare "fetch failed". File-only subcommands (mcp init/edit/list/validate) don't need it.
  const __sub = args.find((a) => !a.startsWith('-') && a !== __firstPositional);
  const __needsServer =
    __firstPositional === 'mcp' && ['enable', 'disable', 'tools', 'status', 'server'].includes(__sub);
  if (__needsServer) {
    await ensureServer();
  }
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
idleTimeoutFlag = getFlagValue('--idle-timeout');
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
  // Send the detached server's stdout+stderr to a LOG FILE, not a pipe.
  //
  // Previously stdio was ['ignore','pipe','pipe']. The client read-ends of those
  // pipes close when this short-lived one-shot client EXITS after its command —
  // so the NEXT command makes the still-running detached server write to a broken
  // pipe (EPIPE), which disrupts it and the client's fetch dies with a bare
  // "fetch failed". `browse` writes the most server output (its sub-agent), so it
  // was the reliable trigger; a quiet command like 2+2 often slipped through,
  // which made the failure look intermittent.
  //
  // A file sink has no reader to disappear, so the server never hits EPIPE — and
  // it gives users/containers a real server log to inspect. Readiness is detected
  // via /health polling below, so we never needed to parse the server's stdout.
  // 'w' truncates per fresh server spawn, bounding growth to one server lifetime.
  const logPath = getServerLogPath();
  let logFd;
  try {
    mkdirSync(dirname(logPath), { recursive: true });
    logFd = openSync(logPath, 'w');
  } catch {
    logFd = 'ignore'; // last resort: never fall back to an undrained pipe
  }
  serverProcess = spawn('node', serverArgs, {
    stdio: ['ignore', logFd, logFd],
    // Run the server in — and treat as project root — the directory cortex was invoked
    // from, so `cd foo && cortex "..."` operates on `foo` (not the home dir or a stale
    // PROJECT_PATH from the global ~/.cortex/.env). An explicitly-exported PROJECT_PATH /
    // PROJECT_ROOT still wins (e.g. the autoresearch container sets one deliberately).
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: BASE_PORT,
      PROJECT_PATH: process.env.PROJECT_PATH || process.cwd(),
      PROJECT_ROOT: process.env.PROJECT_ROOT || process.cwd(),
    },
    detached: true,
  });
  serverProcess.unref();

  // Wait for healthy (up to 15s)
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (await isServerUp()) {
      process.stderr.write(`[cortex] Server ready on ${BASE_URL}\n`);
      return;
    }
  }
  console.error(`[cortex] Server failed to start within 15s (see ${logPath})`);
  process.exit(1);
}

// Where the auto-started background server logs to. Honors CORTEX_HOME/HOME so
// it lands beside the rest of the global config (~/.cortex/server.log).
function getServerLogPath() {
  return join(getGlobalCortexDir(), 'server.log');
}

function getGlobalCortexDir() {
  const base = process.env.CORTEX_HOME || homedir() || process.cwd();
  return join(base, '.cortex');
}

// Is at least one provider API key resolvable — from the environment/secrets store
// OR from a .env file (cwd or global)? A BLANK value in a .env (e.g. `DEEPSEEK_API_KEY=`)
// does NOT count: the loader treats it as falsy and falls through to process.env, which is
// exactly how the secrets-store model works (blank .env + key injected via env). So we only
// count a non-empty, non-commented assignment, or a non-empty process.env var.
function hasAnyApiKey() {
  const isKeyName = (k) => /(_API_KEY|_API_TOKEN|_OAUTH_TOKEN)$/.test(k);
  for (const [k, v] of Object.entries(process.env)) {
    if (isKeyName(k) && String(v || '').trim()) return true;
  }
  for (const p of [join(process.cwd(), '.env'), join(getGlobalCortexDir(), '.env')]) {
    try {
      if (!existsSync(p)) continue;
      for (const line of readFileSync(p, 'utf8').split('\n')) {
        if (/^\s*#/.test(line)) continue;
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S.*?)\s*$/);
        if (m && isKeyName(m[1]) && m[2].trim()) return true;
      }
    } catch { /* unreadable .env — ignore */ }
  }
  return false;
}

// A blank-value config template — mirrors the project's own .env: every key declared but
// EMPTY, so the loader falls through to the environment/secrets store. NEVER put a non-empty
// placeholder here — it would override a real secret in process.env.
const BLANK_ENV_TEMPLATE = `# Nexus Cortex configuration.
# Blank values are read from your environment / secrets store (a value set in the
# environment wins when the line below is left blank). Fill a key here for local use,
# or leave blank and inject it via your secrets store. Run "cortex config init --force"
# for the full, commented template.

DEFAULT_MODEL_ID=deepseek-v4-pro

ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
DEEPSEEK_API_KEY=
XAI_API_KEY=
`;

// Preflight for the prompt path: a model run needs a key. If none is resolvable, seed a
// blank ~/.cortex/.env so there's a findable file to edit (it didn't exist before the first
// run), print clear guidance, and EXIT WITHOUT starting a server — so we never leave a
// keyless server running that would force a --shutdown + re-invoke. When a key IS present
// (a filled .env, or secrets in the environment), this is a no-op and the run proceeds —
// one-shot. The container case (secrets in env) hits the no-op path and writes nothing.
async function ensureKeysOrExit() {
  if (hasAnyApiKey()) return;
  // No key resolvable. If a server is already running, it was started with no key and has
  // cached that empty config — so even after you add a key it would keep failing until a
  // restart. Drain it now (graceful) so the NEXT run (with your key) starts a fresh server
  // that picks the key up — no manual --shutdown dance.
  try {
    if (await isServerUp()) {
      try { await fetch(`${BASE_URL}/shutdown`, { method: 'POST', signal: AbortSignal.timeout(5000) }); } catch { /* best-effort */ }
      process.stderr.write('[cortex] Stopped the running server so it will pick up your key on the next run.\n');
    }
  } catch { /* never block on the drain */ }
  const dir = getGlobalCortexDir();
  const envPath = join(dir, '.env');
  let seeded = false;
  if (!existsSync(envPath)) {
    try {
      mkdirSync(dir, { recursive: true });
      // Prefer the shipped .env.example (the full, canonical blank-value template) and
      // copy it to ~/.cortex/.env — i.e. .env.example becomes .env, no codegen. Fall back
      // to the minimal inline template only if the example isn't found in the install.
      const example = [join(CLI_PKG_ROOT, '.env.example'), join(MONOREPO_ROOT, '.env.example')]
        .find((p) => existsSync(p));
      if (example) copyFileSync(example, envPath);
      else writeFileSync(envPath, BLANK_ENV_TEMPLATE);
      seeded = true;
    } catch { /* read-only home — still print guidance below */ }
  }
  process.stderr.write('\n[cortex] No API key found — a model run needs one.\n');
  if (seeded) process.stderr.write(`[cortex] Created ${envPath}\n`);
  process.stderr.write('[cortex] Add a provider key, then run again:\n');
  process.stderr.write(`[cortex]   - edit ${envPath}  (e.g. DEEPSEEK_API_KEY=sk-...)\n`);
  process.stderr.write('[cortex]   - or inject it via your environment / secrets store (read from there too)\n');
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

async function run() {
  // --shutdown: stop the server and exit
  if (doShutdown) {
    await shutdownServer();
    return;
  }

  // Update check for the direct path (`cortex "<prompt>"`, `cortex agent`). Commander
  // subcommands are delegated earlier and run this same check via the CLI's preAction
  // hook; this covers the non-delegated chat/agent path. Canonical service, best-effort.
  try {
    const { checkForUpdate } = await import('../dist/lifecycle/updateCheck.js');
    await checkForUpdate();
  } catch { /* dist absent in a source checkout, or check failed — never block */ }

  // A prompt/agent run needs a model key. Check BEFORE starting the server so we never
  // leave a keyless server running (which forced the old --shutdown + re-invoke dance).
  // Read-only ops (--stats/--sessions/--tmux/--pr, no prompt) don't need a key and are
  // fine against a keyless server, so only gate the actual prompt path.
  if (prompt) {
    await ensureKeysOrExit();
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

  // Need a prompt for message commands
  if (!prompt) {
    console.error('Usage: cortex "your prompt here"');
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
