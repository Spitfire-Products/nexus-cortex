/**
 * Nexus Cortex HTTP Server
 * Thin Express wrapper around @nexus-cortex/core library
 *
 * This server is intentionally minimal (~250 lines total across all files).
 * All orchestration logic lives in @nexus-cortex/core.
 */
import express from 'express';
import { config } from 'dotenv';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import path from 'path';

// Resolve paths for .env loading
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageRoot = path.join(__dirname, '..', '..', '..');

// PROJECT_ROOT = where the user launched from (the launch-cwd model)
if (!process.env.PROJECT_ROOT) {
  process.env.PROJECT_ROOT = process.cwd();
}

// Load .env from cwd first (user's project), then package root (dev/monorepo).
// dotenv's default is "first wins" — cwd values take priority.
const cwdEnv = path.join(process.cwd(), '.env');
const cwdEnvLocal = path.join(process.cwd(), '.env.local');
const pkgEnv = path.join(packageRoot, '.env');
const pkgEnvLocal = path.join(packageRoot, '.env.local');

config({ path: cwdEnv, quiet: true });
config({ path: pkgEnv, quiet: true });
config({ path: cwdEnvLocal, override: true, quiet: true });
config({ path: pkgEnvLocal, override: true, quiet: true });

// Import middleware and routes
import { corsMiddleware } from './middleware/cors.js';
import { errorHandler } from './middleware/errorHandler.js';
import { messagesRouter, setServerOrchestrator } from './routes/messages.js';
import { modelsRouter } from './routes/models.js';
import { healthRouter } from './routes/health.js';
import { approvalRouter } from './routes/approval.js';
import { sessionsRouter } from './routes/sessions.js';
import { mcpRouter } from './routes/mcp.js';
import { toolsRouter } from './routes/tools.js';
import { permissionsRouter } from './routes/permissions.js';
import { middlewareRouter } from './routes/middleware.js';
import { systemMessagesRouter } from './routes/system-messages.js';
import { prRouter } from './routes/pr.js';
import { configRouter } from './routes/config.js';

// Import core library components
import { createOrchestrator, type CortexOrchestrator } from '@nexus-cortex/core';
import { SandboxViewServer, TmuxViewServer, SessionPersistence, TmuxManager } from '@nexus-cortex/executors';

export interface ServerConfig {
  port?: number;
  debug?: boolean;
  stateless?: boolean;  // If true, create new orchestrator per request
  yolo?: boolean;  // If true, auto-approve all permissions (headless mode)
  idleTimeoutMs?: number;  // If set, auto-shutdown after this many ms of inactivity
}

export class CortexV4Server {
  private app: express.Application;
  private port: number;
  private debug: boolean;
  private stateless: boolean;
  private yolo: boolean;
  private server: any = null;
  private orchestrator: CortexOrchestrator | null = null;
  private viewServer: SandboxViewServer | null = null;
  private idleTimeoutMs: number;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: ServerConfig = {}) {
    this.port = config.port || parseInt(process.env.PORT || '4000', 10);
    this.debug = config.debug || process.env.DEBUG === 'true';
    this.stateless = config.stateless || (process.env.CORTEX_MODE) === 'stateless';
    this.yolo = config.yolo || false;
    this.idleTimeoutMs = config.idleTimeoutMs || parseInt(process.env.SERVER_IDLE_TIMEOUT || '0', 10);

    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
    this.setupErrorHandling();
  }

  private setupMiddleware(): void {
    // Body parsing
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));

    // CORS
    this.app.use(corsMiddleware);

    // Request logging
    if (this.debug) {
      this.app.use((req, res, next) => {
        console.log(chalk.cyan(`[${new Date().toISOString()}] ${req.method} ${req.path}`));
        if (req.body?.model) {
          console.log(chalk.gray(` Model: ${req.body.model}`));
        }
        if (req.body?.stream !== undefined) {
          console.log(chalk.gray(` Stream: ${req.body.stream}`));
        }
        next();
      });
    }

    // Idle timeout: reset timer on every request
    if (this.idleTimeoutMs > 0) {
      this.app.use((_req, _res, next) => {
        this.resetIdleTimer();
        next();
      });
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(async () => {
      console.log(chalk.yellow(`[IDLE] No requests for ${Math.round(this.idleTimeoutMs / 1000)}s -- shutting down`));
      await this.stop();
      process.exit(0);
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private setupRoutes(): void {
    // Main endpoints
    this.app.use(messagesRouter);
    this.app.use(modelsRouter);
    this.app.use(healthRouter);
    this.app.use(approvalRouter);
    this.app.use(sessionsRouter);
    this.app.use(mcpRouter);
    this.app.use(toolsRouter);
    this.app.use(permissionsRouter);
    this.app.use(middlewareRouter);
    this.app.use(systemMessagesRouter);
    this.app.use(prRouter);
    this.app.use(configRouter);

    // Shutdown endpoint
    this.app.post('/shutdown', async (_req, res) => {
      res.json({ status: 'shutting_down' });
      console.log(chalk.yellow('\n[SHUTDOWN] Shutdown requested via /shutdown'));
      await this.stop();
      process.exit(0);
    });

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.redirect('/health');
    });

    // 404 handler
    this.app.use((req, res) => {
      res.status(404).json({
        error: {
          message: `Endpoint not found: ${req.method} ${req.path}`,
          type: 'not_found'
        }
      });
    });
  }

  private setupErrorHandling(): void {
    this.app.use(errorHandler);
  }

  async start(): Promise<void> {
    // Step 1: Initialize persistent orchestrator (if not stateless)
    if (!this.stateless) {
      console.log(chalk.cyan('[INIT] Initializing persistent orchestrator...'));
      const defaultModel = process.env.DEFAULT_MODEL_ID || 'gemini-2.5-flash';

      // PROJECT_PATH controls the file access boundary for tool execution.
      // Defaults to monorepo root; set to a parent directory (e.g., /home/runner/workspace)
      // to allow tools to access files outside the monorepo in headless mode.
      const projectPath = process.env.PROJECT_PATH || process.cwd();

      this.orchestrator = await createOrchestrator({
        defaultModelId: defaultModel,
        projectPath,
        workingDirectory: projectPath,
        enableTimeline: true,
        debug: this.debug
      }, {
        // Use auto-approve if --yolo or YOLO=true, otherwise use interactive mode
        permissionMode: this.yolo ? 'auto' : 'interactive'
      });

      // Auto-resume: check for most recent session on disk
      const resumeSessionId = process.env.RESUME_SESSION_ID;
      const autoResume = process.env.AUTO_RESUME === 'true'; // off by default — use --resume or /continue to load sessions
      let resumed = false;

      if (resumeSessionId) {
        // Explicit session ID provided
        try {
          const session = await this.orchestrator.resumeSession(resumeSessionId, projectPath);
          console.log(chalk.green(`[OK] Resumed session ${resumeSessionId} (${session.messageCount} messages, turn ${Math.floor(session.messageCount / 2)})`));
          resumed = true;
        } catch (err: any) {
          console.log(chalk.yellow(`[WARN] Could not resume session ${resumeSessionId}: ${err.message}`));
          console.log(chalk.yellow(' Starting fresh session instead'));
        }
      } else if (autoResume) {
        // Auto-detect most recent session
        try {
          const historyStore = (this.orchestrator as any).historyStore;
          if (historyStore) {
            const sessions = await historyStore.listSessions();
            if (sessions.length > 0) {
              // sessions are sorted newest-first by listSessions()
              const latest = sessions[0];
              const session = await this.orchestrator.resumeSession(latest.sessionId, projectPath);
              console.log(chalk.green(`[OK] Auto-resumed latest session ${latest.sessionId.substring(0, 8)}... (${session.messageCount} messages)`));
              resumed = true;
            }
          }
        } catch (err: any) {
          if (this.debug) {
            console.log(chalk.gray(`[auto-resume] No session to resume: ${err.message}`));
          }
        }
      }

      if (!resumed) {
        await this.orchestrator.createSession(projectPath, defaultModel);
        console.log(chalk.green('[OK] New session created'));
      }

      // Make orchestrator available to routes
      setServerOrchestrator(this.orchestrator);

      console.log(chalk.green('[OK] Persistent orchestrator ready'));
    } else {
      console.log(chalk.yellow('[STATELESS] Stateless mode - orchestrator created per request'));
    }

    // Step 2: Initialize SandboxViewServer (unified dashboard) — opt-in, default off.
    // Binds an extra port (DASHBOARD_PORT, default 4001); enable with ENABLE_DASHBOARD=true.
    if (process.env.ENABLE_DASHBOARD === 'true') {
    console.log(chalk.cyan('[INIT] Starting unified dashboard (sandbox + tmux viewer)...'));
    this.viewServer = SandboxViewServer.getInstance();
    await this.viewServer.start(4001);

    // Initialize TmuxViewServer routes (piggybacks on SandboxViewServer)
    const tmuxViewer = TmuxViewServer.getInstance();
    await tmuxViewer.initialize();

    // Recover persisted tmux sessions
    try {
      const projectRoot = process.env.PROJECT_ROOT || process.cwd();
      const tmuxPersistence = new SessionPersistence(projectRoot);
      const tmuxManager = TmuxManager.getInstance();

      if (await tmuxManager.isAvailable()) {
        const activeSessions = await tmuxManager.listSessions();
        const recovery = await tmuxPersistence.recoverSessions(activeSessions);
        if (recovery.recovered > 0) {
          console.log(chalk.green(`[OK] Tmux: ${recovery.recovered} session(s) recovered, ${recovery.cleaned} cleaned`));
          const recoveredMeta = await tmuxPersistence.listSessions();
          tmuxViewer.markRecovered(recoveredMeta.map(m => m.sessionId));
        } else if (recovery.total > 0) {
          console.log(chalk.gray(`[OK] Tmux: ${recovery.cleaned} stale session(s) cleaned`));
        }

        const cleanup = await tmuxPersistence.autoCleanup(activeSessions, 24);
        if (cleanup.total > 0) {
          console.log(chalk.yellow(`[WARN] Tmux cleanup: ${cleanup.orphaned} orphaned, ${cleanup.stale} stale`));
        }

        // Periodic cleanup every hour
        this.cleanupInterval = setInterval(async () => {
          try {
            const currentSessions = await tmuxManager.listSessions();
            await tmuxPersistence.autoCleanup(currentSessions, 24);
          } catch {}
        }, 60 * 60 * 1000);
        this.cleanupInterval.unref();
      }
    } catch (err: any) {
      console.log(chalk.yellow(`[WARN] Tmux recovery failed: ${err.message}`));
    }

    const viewPort = this.viewServer.getPort();
    console.log(chalk.green(`[OK] Dashboard running on http://localhost:${viewPort}`));
    }

    // Step 3: Start HTTP server
    return new Promise((resolve, reject) => {
      const attemptPort = (port: number, maxAttempts: number = 10) => {
        if (maxAttempts <= 0) {
          reject(new Error('Could not find an available port after 10 attempts'));
          return;
        }

        const server = this.app.listen(port, '0.0.0.0', () => {
          this.server = server;
          this.port = port;

          console.log(chalk.green(`\n[OK] Nexus Cortex server running on port ${port}`));
          console.log(chalk.blue(`[ARCH] Core Library Architecture`));
          console.log(chalk.yellow(`[API] API Server: http://localhost:${port}/health`));
          if (this.viewServer) console.log(chalk.yellow(`[VIEW] Dashboard: http://localhost:${this.viewServer.getPort()}`));
          console.log(chalk.gray(`\nAPI Endpoints:`));
          console.log(chalk.gray(` POST   /v1/messages  - Main LLM endpoint`));
          console.log(chalk.gray(` GET    /models       - List available models`));
          console.log(chalk.gray(` GET    /health       - Server status`));
          if (this.viewServer) {
            const vp = this.viewServer.getPort();
            console.log(chalk.gray(`\nDashboard:`));
            console.log(chalk.gray(` http://localhost:${vp}/           - Sandbox list`));
            console.log(chalk.gray(` http://localhost:${vp}/tmux       - Tmux sessions`));
            console.log(chalk.gray(` http://localhost:${vp}/sandbox/ID - View sandbox`));
            console.log(chalk.gray(` http://localhost:${vp}/tmux/ID    - View tmux\n`));
          }

          if (this.idleTimeoutMs > 0) {
            console.log(chalk.gray(` Idle timeout: ${Math.round(this.idleTimeoutMs / 1000)}s`));
            this.resetIdleTimer();
          }

          resolve();
        });

        server.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.log(chalk.yellow(`Port ${port} in use, trying ${port + 1}...`));
            attemptPort(port + 1, maxAttempts - 1);
          } else {
            reject(err);
          }
        });
      };

      attemptPort(this.port);
    });
  }

  async stop(): Promise<void> {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }

    // Gracefully close the dashboard view server if it was started (eager or lazy).
    if (this.viewServer) {
      try { await this.viewServer.stop(); } catch { /* viewer is optional */ }
      this.viewServer = null;
    }

    // Print session summary on shutdown
    if (this.orchestrator) {
      try {
        const historyStore = (this.orchestrator as any).historyStore;
        if (historyStore) {
          const sessions = await historyStore.listSessions();
          const recent = sessions.slice(0, 10);
          if (recent.length > 0) {
            console.log(chalk.cyan('\nRecent sessions:'));
            for (const s of recent) {
              const age = Math.floor((Date.now() - s.lastModified.getTime()) / 60000);
              const ageStr = age < 60 ? `${age}m ago` : `${Math.floor(age / 60)}h ago`;
              console.log(chalk.gray(` ${s.sessionId}  ${s.messageCount} msgs  ${ageStr}`));
            }
            console.log(chalk.gray(`\nResume with: cortex --resume <session-id>`));
          }
        }
      } catch {}
    }

    // Close the HTTP server, but cap the wait with a grace period so a hung
    // keep-alive connection can't block shutdown forever (default 10s; 0 = wait forever).
    const graceMs = parseInt(process.env.SHUTDOWN_GRACE_MS || '10000', 10);
    return new Promise((resolve) => {
      if (this.server) {
        let graceTimer: ReturnType<typeof setTimeout> | null = null;
        if (graceMs > 0) {
          graceTimer = setTimeout(() => {
            console.log(chalk.yellow(`Server stopped (forced after ${Math.round(graceMs / 1000)}s grace)`));
            resolve();
          }, graceMs);
          if (typeof graceTimer.unref === 'function') graceTimer.unref();
        }
        this.server.close(() => {
          if (graceTimer) clearTimeout(graceTimer);
          console.log(chalk.yellow('Server stopped'));
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  getPort(): number {
    return this.port;
  }
}

// Start server if run directly
if (import.meta.url === `file://${process.argv[1]}`) {

  // --help flag
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(`
${chalk.bold('Nexus Cortex Server')} — Multi-provider AI orchestration library

${chalk.bold.underline('Usage:')}
  node dist/index.js [options]
  npm run dev                          ${chalk.gray('# tsx watch with auto-restart')}

${chalk.bold.underline('Options:')}
  --help, -h              Show this help
  --debug                 Enable debug logging (system messages, routes, injection)
  --yolo                  Auto-approve all tool executions (headless mode)
  --port <number>         Override port (default: 4000)
  --idle-timeout <secs>   Auto-shutdown after N seconds of inactivity (0 = disabled)

${chalk.bold.underline('Environment Variables:')}
  DEFAULT_MODEL_ID   Model to use (must be a registry ID, e.g. grok-4-1-fast-reasoning)
  PORT               Server port (default: 4000)
  DEBUG              Enable debug logging (true/false)
  YOLO               Auto-approve all permissions (true/false)
  AUTO_RESUME        Auto-resume last session on startup (default: false)
  RESUME_SESSION_ID  Resume a specific session by UUID
  CORTEX_MODE    "stateless" for per-request sessions (default: persistent)
  SERVER_IDLE_TIMEOUT  Auto-shutdown after N seconds of inactivity (default: 0 = off)

${chalk.bold.underline('Headless Mode (curl):')}
  The server is a stateful agent. Sequential requests share the same session
  with full conversation history, context management, and tool execution.

  ${chalk.cyan('# Start server')}
  DEFAULT_MODEL_ID=grok-4-1-fast-reasoning node dist/index.js &

  ${chalk.cyan('# Send a message (adds to conversation)')}
  curl -s 'http://localhost:4000/v1/messages' \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"Read package.json"}]}'

  ${chalk.cyan('# Multi-turn: next request continues the conversation')}
  curl -s 'http://localhost:4000/v1/messages' \\
    -H 'Content-Type: application/json' \\
    -d '{"model":"grok-4-1-fast-reasoning","messages":[{"role":"user","content":"What was the version?"}]}'

${chalk.bold.underline('Session Management:')}
  GET    /sessions                     List all sessions
  POST   /sessions/new                 Start fresh session (old one saved)
  GET    /sessions/:id/stats           Token usage, turns, tool calls
  GET    /sessions/:id/messages        Full message history
  POST   /sessions/:id/model           Switch model mid-session
  POST   /sessions/:id/compaction      Trigger context compaction
  GET    /sessions/:id/cache/metrics   Cache hit rate and savings

${chalk.bold.underline('Dev Workflow:')}
  System message edits (CLAUDE.md, MEMORY.md, SYSTEM_PROMPT.md) take effect on
  the next request — no restart needed. Code changes with tsx watch auto-restart
  the server and resume the last session from JSONL.

  ${chalk.cyan('# Dev mode with HMR-like iteration')}
  cd packages/server && npm run dev

  ${chalk.cyan('# Fresh start (no session resume)')}
  AUTO_RESUME=false npm run dev

${chalk.bold.underline('Response Fields:')}
  content[]             Model text response
  toolUses[]            Tools called (name, input)
  usage.inputTokens     Total input tokens (reveals system message overhead)
  usage.outputTokens    Response size
  metadata.toolCallIterations  Tool round-trips
`);
    process.exit(0);
  }

  // Parse flags
  const portFlagIndex = process.argv.indexOf('--port');
  const portFromFlag = portFlagIndex !== -1 ? parseInt(process.argv[portFlagIndex + 1], 10) : undefined;
  const idleFlagIndex = process.argv.indexOf('--idle-timeout');
  const idleFromFlag = idleFlagIndex !== -1 ? parseInt(process.argv[idleFlagIndex + 1], 10) : undefined;

  const port = portFromFlag || parseInt(process.env.PORT || '4000', 10);
  const debug = process.env.DEBUG === 'true' || process.argv.includes('--debug');
  const yolo = process.env.YOLO === 'true' || process.argv.includes('--yolo');
  const idleTimeoutMs = (idleFromFlag || parseInt(process.env.SERVER_IDLE_TIMEOUT || '0', 10)) * 1000;

  if (yolo) {
    console.log(chalk.yellow('[WARN] YOLO mode enabled - auto-approving all permissions'));
  }

  const server = new CortexV4Server({ port, debug, yolo, idleTimeoutMs });

  server.start().catch((error) => {
    console.error(chalk.red('Failed to start server:'), error);
    process.exit(1);
  });

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nShutting down...');
    await server.stop();
    process.exit(0);
  });
}
