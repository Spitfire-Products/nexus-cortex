/**
 * TmuxViewServer - Live web-based tmux session viewer
 *
 * Extends SandboxViewServer to provide real-time tmux session viewing.
 * No headless browser needed - renders in user's browser!
 *
 * Features:
 * - Live terminal rendering with xterm.js
 * - Real-time output streaming via WebSocket
 * - Session list dashboard
 * - Direct attach to tmux sessions
 * - Works in any environment (no Chromium needed!)
 *
 * Architecture:
 * - Piggybacks on SandboxViewServer (port 4001)
 * - Adds /tmux routes alongside /sandbox routes
 * - Uses TerminalSandbox for xterm.js rendering
 * - Connects xterm.js to tmux session via PTY
 *
 * User Flow:
 * 1. User creates tmux session
 * 2. Server returns view URL: http://localhost:4001/tmux/{sessionId}
 * 3. User opens URL in their browser
 * 4. See live terminal with full colors, formatting, updates
 * 5. Can interact if desired (type, scroll, etc.)
 *
 * Example:
 * ```
 * const viewServer = TmuxViewServer.getInstance();
 * await viewServer.start(); // Auto-starts if not running
 *
 * const url = viewServer.getTmuxViewUrl("my-session");
 * // Returns: http://localhost:4001/tmux/my-session
 * ```
 */

import { SandboxViewServer } from '../addon/SandboxViewServer.js';
import { TmuxManager } from '../../utils/TmuxManager.js';
import { SessionPersistence } from '../../utils/SessionPersistence.js';
import type { Express, Request, Response } from 'express';

export class TmuxViewServer {
  private static instance: TmuxViewServer;
  private sandboxViewServer: SandboxViewServer;
  private tmuxManager: TmuxManager;
  private persistence: SessionPersistence;
  private isInitialized: boolean = false;
  private recoveredSessions: Map<string, Date> = new Map();

  private constructor() {
    this.sandboxViewServer = SandboxViewServer.getInstance();
    this.tmuxManager = TmuxManager.getInstance();
    // Use PROJECT_ROOT if set (server sets this to monorepo root), otherwise fallback to cwd
    const projectRoot = process.env.PROJECT_ROOT || process.cwd();
    this.persistence = new SessionPersistence(projectRoot);
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TmuxViewServer {
    if (!TmuxViewServer.instance) {
      TmuxViewServer.instance = new TmuxViewServer();
    }
    return TmuxViewServer.instance;
  }

  /**
   * Initialize tmux viewing routes
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      return;
    }

    // Start SandboxViewServer with dynamic port resolution (starting from 4001)
    // It will automatically find the next available port if 4001 is occupied
    await this.sandboxViewServer.start(4001);

    // Add tmux-specific routes
    this.addTmuxRoutes();

    this.isInitialized = true;
    const actualPort = this.sandboxViewServer.getPort();
    console.log(` Tmux view routes initialized at http://localhost:${actualPort}/tmux`);
  }

  /**
   * Get view URL for a tmux session (uses dynamically assigned port)
   */
  getTmuxViewUrl(sessionId: string): string {
    const port = this.sandboxViewServer.getPort();
    return `http://localhost:${port}/tmux/${sessionId}`;
  }

  /**
   * Get tmux dashboard URL (uses dynamically assigned port)
   */
  getTmuxDashboardUrl(): string {
    const port = this.sandboxViewServer.getPort();
    return `http://localhost:${port}/tmux`;
  }

  /**
   * Get tmux API URL (uses dynamically assigned port)
   */
  getTmuxApiUrl(): string {
    const port = this.sandboxViewServer.getPort();
    return `http://localhost:${port}/api/tmux/sessions`;
  }

  markRecovered(sessionIds: string[]): void {
    const now = new Date();
    for (const id of sessionIds) {
      this.recoveredSessions.set(id, now);
    }
  }

  /**
   * Add tmux-specific routes to the express app
   */
  private addTmuxRoutes(): void {
    const app = this.sandboxViewServer.getApp();
    const io = this.sandboxViewServer.getIO();

    // Tmux dashboard - list all sessions
    app.get('/tmux', async (req: Request, res: Response) => {
      res.send(this.generateTmuxDashboardHTML());
    });

    // Live terminal view for specific session
    app.get('/tmux/:sessionId', async (req: Request, res: Response) => {
      const sessionId = req.params.sessionId as string;

      // Check if session exists
      if (!(await this.tmuxManager.sessionExists(sessionId))) {
        res.status(404).send(this.generateTmux404HTML(sessionId));
        return;
      }

      res.send(this.generateTmuxSessionHTML(sessionId));
    });

    // API: Get session list with metadata (only active sessions)
    app.get('/api/tmux/sessions', async (req: Request, res: Response) => {
      try {
        // Get list of actually running tmux sessions
        const activeSessions = await this.tmuxManager.listSessions();

        // Get metadata for all sessions
        const allMetadata = await this.persistence.listSessions();
        const metadataMap = new Map(allMetadata.map(m => [m.sessionId, m]));

        // Build session list - include ALL active tmux sessions
        const sessions = await Promise.all(
          activeSessions.map(async sessionId => {
            // Use existing metadata if available, otherwise create minimal metadata
            const recovered = this.recoveredSessions.has(sessionId);
            const recoveredAt = this.recoveredSessions.get(sessionId) || null;
            if (metadataMap.has(sessionId)) {
              const meta = metadataMap.get(sessionId)!;
              return {
                sessionId: meta.sessionId,
                workingDirectory: meta.cwd || process.cwd(),
                created: meta.created,
                lastUsed: meta.lastUsed,
                commandCount: 0,
                recovered,
                recoveredAt
              };
            } else {
              return {
                sessionId,
                workingDirectory: process.cwd(),
                created: new Date(),
                lastUsed: new Date(),
                commandCount: 0,
                recovered,
                recoveredAt
              };
            }
          })
        );

        res.json({ sessions, dashboardUrl: this.getTmuxDashboardUrl() });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Setup WebSocket handlers for tmux
    this.setupTmuxWebSocket(io);

    console.log('[OK] Tmux routes registered:');
    console.log(' GET  /tmux              - Tmux dashboard');
    console.log(' GET  /tmux/:sessionId   - Live terminal view');
    console.log(' GET  /api/tmux/sessions - Session list API');
  }

  /**
   * Setup WebSocket handlers for tmux interaction
   */
  private setupTmuxWebSocket(io: any): void {
    io.on('connection', (socket: any) => {
      // Subscribe to tmux session
      socket.on('subscribe-tmux', async (sessionId: string) => {
        console.log(`[WS] Client ${socket.id} subscribed to tmux: ${sessionId}`);
        socket.join(`tmux-${sessionId}`);

        // Send initial capture
        try {
          const output = await this.tmuxManager.capturePane(sessionId);
          socket.emit('tmux-output', { output });
        } catch (error: any) {
          socket.emit('tmux-error', { error: error.message });
        }
      });

      // Handle terminal input from client
      socket.on('tmux-input', async ({ sessionId, input }: { sessionId: string; input: string }) => {
        try {
          await this.tmuxManager.sendKeys(sessionId, input);
        } catch (error: any) {
          socket.emit('tmux-error', { error: error.message });
        }
      });

      // Manual capture request
      socket.on('tmux-capture', async (sessionId: string) => {
        try {
          const output = await this.tmuxManager.capturePane(sessionId);
          socket.emit('tmux-output', { output });
        } catch (error: any) {
          socket.emit('tmux-error', { error: error.message });
        }
      });

      // Unsubscribe from tmux session
      socket.on('unsubscribe-tmux', (sessionId: string) => {
        console.log(`[WS] Client ${socket.id} unsubscribed from tmux: ${sessionId}`);
        socket.leave(`tmux-${sessionId}`);
      });
    });
  }

  /**
   * Generate 404 page for missing tmux session
   */
  private generateTmux404HTML(sessionId: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence // Session Not Found</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Oxygen Mono', monospace; font-size: 12px; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
    .error-container { max-width: 440px; padding: 40px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; }
    h1 { font-size: 14px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 12px; color: #f8fafc; }
    p { color: #94a3b8; font-size: 11px; margin-bottom: 8px; }
    .session-id { background: #253347; padding: 8px 12px; border-radius: 6px; margin: 16px 0; color: #f87171; font-size: 11px; border: 1px solid #283548; }
    a { color: #4a90d9; text-decoration: none; font-size: 11px; letter-spacing: 0.04em; }
    a:hover { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>Tmux Session Not Found</h1>
    <p>The tmux session you're looking for doesn't exist or has been terminated.</p>
    <div class="session-id">${sessionId}</div>
    <p><a href="/tmux">&larr; Back to Tmux Dashboard</a></p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Generate tmux dashboard HTML
   */
  private generateTmuxDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence // Tmux Sessions</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <style>
    :root {
      --cx-primary: #4a90d9; --cx-primary-rgb: 74, 144, 217;
      --cx-positive: #4ade80; --cx-positive-rgb: 74, 222, 128;
      --cx-bg: #0f172a; --cx-bg2: #1e293b; --cx-bg3: #253347;
      --cx-text: #e2e8f0; --cx-text2: #b0b8c4; --cx-muted: #94a3b8; --cx-heading: #f8fafc;
      --cx-border: #334155; --cx-border2: #283548;
      --cx-radius: 6px;
      --cx-font: 'Oxygen Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--cx-font); font-size: 12px; line-height: 1.5; color: var(--cx-text); background: var(--cx-bg); padding: 24px 20px; min-height: 100vh; }
    body::before { content: ''; position: fixed; inset: 0; background: radial-gradient(ellipse at 20% 50%, rgba(var(--cx-primary-rgb), 0.04) 0%, transparent 60%), linear-gradient(180deg, var(--cx-bg) 0%, #080818 100%); pointer-events: none; z-index: 0; }
    .shell { position: relative; z-index: 1; max-width: 1200px; margin: 0 auto; }
    .header-bar { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--cx-bg2); border: 1px solid var(--cx-border); border-radius: var(--cx-radius); margin-bottom: 20px; }
    .header-bar h1 { font-family: 'Orbitron', var(--cx-font); font-size: 14px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cx-heading); }
    .header-bar .badge { font-size: 10px; color: var(--cx-muted); padding: 2px 8px; border: 1px solid var(--cx-border2); border-radius: var(--cx-radius); }
    .nav-link { font-size: 10px; color: var(--cx-primary); text-decoration: none; letter-spacing: 0.04em; transition: color 200ms; }
    .nav-link:hover { color: var(--cx-heading); }
    .sessions { display: grid; gap: 10px; }
    .session-card { background: var(--cx-bg2); border: 1px solid var(--cx-border); border-radius: var(--cx-radius); padding: 14px 16px; transition: all 200ms ease; cursor: pointer; }
    .session-card:hover { border-color: rgba(var(--cx-primary-rgb), 0.5); box-shadow: 0 0 16px rgba(var(--cx-primary-rgb), 0.1); }
    .session-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .session-id { font-size: 12px; color: var(--cx-primary); letter-spacing: 0.04em; }
    .session-status { padding: 2px 8px; border-radius: var(--cx-radius); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--cx-positive); border: 1px solid rgba(var(--cx-positive-rgb), 0.3); }
    .session-recovered { padding: 2px 8px; border-radius: var(--cx-radius); font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: #fbbf24; border: 1px solid rgba(251, 191, 36, 0.3); }
    .session-info { color: var(--cx-muted); font-size: 10px; line-height: 1.8; }
    .session-info strong { color: var(--cx-text2); }
    .no-sessions { text-align: center; padding: 60px 20px; color: var(--cx-muted); font-size: 11px; }
    .refresh-btn { position: fixed; bottom: 20px; right: 20px; font-family: var(--cx-font); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cx-primary); background: var(--cx-bg2); border: 1px solid rgba(var(--cx-primary-rgb), 0.3); border-radius: var(--cx-radius); padding: 8px 16px; cursor: pointer; transition: all 200ms ease; z-index: 10; }
    .refresh-btn:hover { background: rgba(var(--cx-primary-rgb), 0.08); border-color: rgba(var(--cx-primary-rgb), 0.5); box-shadow: 0 0 12px rgba(var(--cx-primary-rgb), 0.15); }
    @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .anim-in { animation: fade-up 400ms ease both; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header-bar anim-in">
      <div style="display: flex; align-items: center; gap: 12px;">
        <h1>Cortex Intelligence // Tmux</h1>
        <span class="badge">TERMINAL</span>
      </div>
      <div style="display: flex; align-items: center; gap: 16px;">
        <a href="/" class="nav-link">Sandbox Dashboard</a>
        <span style="font-size: 11px; color: var(--cx-muted);">Live terminal sessions</span>
      </div>
    </div>

    <div class="sessions" id="sessions">
      <div class="no-sessions">Loading sessions...</div>
    </div>
  </div>

  <button class="refresh-btn" onclick="loadSessions()">Refresh</button>

  <script>
    async function loadSessions() {
      try {
        const response = await fetch('/api/tmux/sessions');
        const data = await response.json();
        const container = document.getElementById('sessions');

        if (data.sessions.length === 0) {
          container.innerHTML = '<div class="no-sessions">No active tmux sessions</div>';
          return;
        }

        container.innerHTML = data.sessions.map((session, i) => \`
          <div class="session-card anim-in" style="animation-delay: \${i * 60}ms" onclick="window.location='/tmux/\${session.sessionId}'">
            <div class="session-header">
              <div class="session-id">\${session.sessionId}</div>
              <div style="display: flex; gap: 6px; align-items: center;">
                \${session.recovered ? '<div class="session-recovered">[RECOVERED]</div>' : ''}
                <div class="session-status">Active</div>
              </div>
            </div>
            <div class="session-info">
              <div><strong>Directory:</strong> \${session.workingDirectory}</div>
              <div><strong>Created:</strong> \${new Date(session.created).toLocaleString()}</div>
              <div><strong>Last Used:</strong> \${new Date(session.lastUsed).toLocaleString()}</div>
              \${session.recovered ? '<div><strong>Recovered:</strong> ' + new Date(session.recoveredAt).toLocaleString() + '</div>' : ''}
            </div>
          </div>
        \`).join('');
      } catch (error) {
        console.error('Failed to load sessions:', error);
        document.getElementById('sessions').innerHTML = '<div class="no-sessions">Failed to load sessions</div>';
      }
    }

    loadSessions();
    setInterval(loadSessions, 5000);
  </script>
</body>
</html>
    `;
  }

  /**
   * Generate live terminal view HTML for a specific session
   */
  private generateTmuxSessionHTML(sessionId: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence // ${sessionId}</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css" />
  <script src="https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/socket.io-client@4.6.0/dist/socket.io.min.js"></script>
  <style>
    :root {
      --cx-primary: #4a90d9; --cx-primary-rgb: 74, 144, 217;
      --cx-positive: #4ade80; --cx-positive-rgb: 74, 222, 128;
      --cx-negative: #f87171;
      --cx-bg: #0f172a; --cx-bg2: #1e293b;
      --cx-text: #e2e8f0; --cx-muted: #94a3b8; --cx-heading: #f8fafc;
      --cx-border: #334155;
      --cx-radius: 6px;
      --cx-font: 'Oxygen Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--cx-font); font-size: 12px; background: var(--cx-bg); color: var(--cx-text); overflow: hidden; }
    #header { background: var(--cx-bg2); padding: 0 16px; height: 44px; border-bottom: 1px solid var(--cx-border); display: flex; justify-content: space-between; align-items: center; }
    #header h1 { font-family: 'Orbitron', var(--cx-font); font-size: 12px; font-weight: 500; color: var(--cx-heading); letter-spacing: 0.1em; text-transform: uppercase; }
    .nav-link { font-size: 10px; color: var(--cx-primary); text-decoration: none; letter-spacing: 0.04em; }
    .nav-link:hover { color: var(--cx-heading); }
    #status { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; }
    .connected { color: var(--cx-positive); }
    .disconnected { color: var(--cx-negative); }
    #terminal-container { position: absolute; top: 44px; left: 0; right: 0; bottom: 0; padding: 8px; background: #0a0f1a; }
  </style>
</head>
<body>
  <div id="header">
    <div style="display: flex; align-items: center; gap: 16px;">
      <a href="/tmux" class="nav-link">&larr; Sessions</a>
      <h1>${sessionId}</h1>
    </div>
    <div id="status" class="disconnected">Connecting...</div>
  </div>
  <div id="terminal-container"></div>

  <script>
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Oxygen Mono', 'Menlo', 'Monaco', monospace",
      theme: {
        background: '#0a0f1a',
        foreground: '#e2e8f0',
        cursor: '#4a90d9',
        selectionBackground: 'rgba(74, 144, 217, 0.3)',
        black: '#0f172a',
        brightBlack: '#334155',
        red: '#f87171',
        brightRed: '#fca5a5',
        green: '#4ade80',
        brightGreen: '#86efac',
        yellow: '#fbbf24',
        brightYellow: '#fde68a',
        blue: '#4a90d9',
        brightBlue: '#93c5fd',
        magenta: '#c084fc',
        brightMagenta: '#d8b4fe',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        white: '#e2e8f0',
        brightWhite: '#f8fafc'
      }
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal-container'));
    fitAddon.fit();
    window.addEventListener('resize', () => fitAddon.fit());

    const statusEl = document.getElementById('status');
    const socket = io({
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity
    });

    socket.on('connect', () => {
      statusEl.textContent = 'Connected';
      statusEl.className = 'connected';
      socket.emit('subscribe-tmux', '${sessionId}');
    });
    socket.on('disconnect', () => {
      statusEl.textContent = 'Disconnected';
      statusEl.className = 'disconnected';
    });
    socket.io.on('reconnect_attempt', (attempt) => {
      statusEl.textContent = 'Reconnecting... (' + attempt + ')';
      statusEl.className = 'disconnected';
    });
    socket.on('tmux-output', (data) => term.write(data.output));
    socket.on('tmux-error', (data) => {
      term.write('\\r\\n[ERROR] ' + data.error + '\\r\\n');
    });
    term.onData((data) => socket.emit('tmux-input', { sessionId: '${sessionId}', input: data }));
  </script>
</body>
</html>
    `;
  }
}
