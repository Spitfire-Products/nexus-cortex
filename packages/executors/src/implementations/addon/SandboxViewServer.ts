import express, { type Express, type Request, type Response } from 'express';
import { Server as HttpServer, createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { broadcaster, type SandboxEvent } from './SandboxEventBroadcaster.js';
import { CreateArtifactToolExecutor } from './CreateArtifactTool.js';
import { ArtifactRegistry } from '../../utils/ArtifactRegistry.js';

/**
 * SandboxViewServer - Real-time sandbox viewing server
 *
 * Provides a web-based dashboard for users to view sandbox operations in real-time.
 * Features:
 * - Embedded iframe showing sandbox UI
 * - Live console logs via WebSocket
 * - File change notifications
 * - Screenshot gallery with timeline
 * - Network request monitoring
 * - Multi-sandbox management
 *
 * Architecture:
 * - Express HTTP server serves HTML dashboard
 * - Socket.io WebSocket server broadcasts events
 * - SandboxEventBroadcaster provides events
 * - Each sandbox gets a unique room for isolated events
 *
 * User Flow:
 * 1. Model creates sandbox → Server auto-starts (if not running)
 * 2. Server emits view URL: http://localhost:4001/sandbox/{sandboxId}
 * 3. User opens URL in browser
 * 4. Dashboard loads with embedded iframe of sandbox UI
 * 5. WebSocket subscribes to sandbox events
 * 6. As model interacts, user sees live updates:
 *    - Console logs appear in sidebar
 *    - Files changed trigger reload notifications
 *    - Screenshots appear in gallery
 *    - Network requests show in timeline
 *
 * Example Usage:
 * ```
 * // Start server
 * const server = SandboxViewServer.getInstance();
 * await server.start(4001);
 *
 * // View URL auto-included in CreateAddon output
 * // User opens: http://localhost:4001/sandbox/abc-123
 *
 * // Server automatically streams events via WebSocket
 * ```
 */
export class SandboxViewServer {
  private static instance: SandboxViewServer;

  private app: Express;
  private httpServer: HttpServer;
  private io: SocketIOServer;
  private port: number = 4001;
  private isRunning: boolean = false;

  private constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    this.setupRoutes();
    this.setupWebSocket();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): SandboxViewServer {
    if (!SandboxViewServer.instance) {
      SandboxViewServer.instance = new SandboxViewServer();
    }
    return SandboxViewServer.instance;
  }

  /**
   * Start the server with dynamic port conflict resolution
   */
  async start(startPort: number = 4001): Promise<void> {
    if (this.isRunning) {
      console.log(` View server already running on http://localhost:${this.port}`);
      return;
    }

    // Try starting on the requested port, with automatic retry on next port if occupied
    let currentPort = startPort;
    const maxAttempts = 10; // Try up to 10 ports
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        await this.tryStartOnPort(currentPort);
        // Success! Server started
        this.port = currentPort;
        this.isRunning = true;
        console.log(` Sandbox View Server started on http://localhost:${currentPort}`);
        console.log(` - Dashboard: http://localhost:${currentPort}/`);
        console.log(` - Sandbox view: http://localhost:${currentPort}/sandbox/{sandboxId}`);
        return;
      } catch (error: any) {
        if (error.code === 'EADDRINUSE') {
          lastError = error;
          console.log(`Port ${currentPort} in use, trying ${currentPort + 1}...`);
          currentPort++;
        } else {
          // Non-port-conflict error, throw immediately
          console.error(`[ERROR] Failed to start view server:`, error);
          throw error;
        }
      }
    }

    // If we get here, we exhausted all attempts
    const errorMsg = `Failed to start view server after ${maxAttempts} attempts (ports ${startPort}-${currentPort - 1})`;
    console.error(`[ERROR] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  /**
   * Try to start server on a specific port
   */
  private async tryStartOnPort(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const onListening = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(error);
      };

      const cleanup = () => {
        this.httpServer.removeListener('listening', onListening);
        this.httpServer.removeListener('error', onError);
      };

      this.httpServer.once('listening', onListening);
      this.httpServer.once('error', onError);
      this.httpServer.listen(port, '0.0.0.0');
    });
  }

  /**
   * Stop the server
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    return new Promise((resolve) => {
      this.io.close();
      this.httpServer.close(() => {
        this.isRunning = false;
        console.log(` View server stopped`);
        resolve();
      });
    });
  }

  /**
   * Get view URL for a sandbox
   */
  getViewUrl(sandboxId: string): string {
    return `http://localhost:${this.port}/sandbox/${sandboxId}`;
  }

  /**
   * Setup HTTP routes
   */
  private setupRoutes(): void {
    // Serve dashboard homepage
    this.app.get('/', (req: Request, res: Response) => {
      res.send(this.generateDashboardHTML());
    });

    // Serve sandbox-specific view
    this.app.get('/sandbox/:sandboxId', (req: Request, res: Response) => {
      const sandboxId = req.params.sandboxId as string;
      const session = CreateArtifactToolExecutor.getActiveSandbox(sandboxId);

      if (!session) {
        res.status(404).send(this.generate404HTML(sandboxId));
        return;
      }

      res.send(this.generateSandboxViewHTML(session));
    });

    // API: Get sandbox list (from persistent registry)
    this.app.get('/api/sandboxes', (req: Request, res: Response) => {
      try {
        const registry = ArtifactRegistry.getInstance(process.env.PROJECT_ROOT || process.cwd());
        const artifacts = registry.getAll();
        res.json({
          sandboxes: artifacts.map(a => ({
            id: a.id,
            name: a.name,
            url: a.url,
            mode: a.mode,
            status: 'running', // Assume running if in registry (could check PID)
            createdAt: a.created,
            lastActivity: a.lastUsed
          }))
        });
      } catch (error: any) {
        console.error('Failed to get artifacts from registry:', error);
        // Fallback to in-memory
        const sessions = CreateArtifactToolExecutor.getActiveSandboxes();
        res.json({
          sandboxes: sessions.map(s => ({
            id: s.id,
            name: s.name,
            url: s.url,
            mode: s.mode,
            status: s.process ? 'running' : 'stopped',
            createdAt: s.startTime,
            lastActivity: s.lastActivity
          }))
        });
      }
    });

    // API: Get event history
    this.app.get('/api/sandbox/:sandboxId/events', (req: Request, res: Response) => {
      const sandboxId = req.params.sandboxId as string;
      const limitParam = req.query.limit as string | undefined;
      const limit = limitParam ? parseInt(limitParam) : undefined;
      const events = broadcaster.getHistory(sandboxId, limit);
      res.json({ events });
    });

    // Artifact lifecycle API endpoints
    this.app.post('/api/artifacts/:id/stop', async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        if (!id) {
          res.status(400).json({ success: false, message: 'Artifact ID is required' });
          return;
        }

        const stopped = CreateArtifactToolExecutor.stopSandbox(id);

        if (stopped) {
          res.json({ success: true, message: 'Artifact stopped successfully' });
        } else {
          res.status(404).json({ success: false, message: 'Artifact not found or already stopped' });
        }
      } catch (error: any) {
        res.status(500).json({ success: false, message: error.message });
      }
    });

    this.app.post('/api/artifacts/:id/restart', async (req: Request, res: Response) => {
      try {
        const id = req.params.id;
        if (!id) {
          res.status(400).json({ success: false, message: 'Artifact ID is required' });
          return;
        }

        // Get artifact metadata from registry
        const registry = ArtifactRegistry.getInstance(process.env.PROJECT_ROOT || process.cwd());
        await registry.initialize();
        const metadata = await registry.get(id);

        if (!metadata) {
          res.status(404).json({ success: false, message: 'Artifact not found in registry' });
          return;
        }

        // Stop the artifact first
        const stopped = CreateArtifactToolExecutor.stopSandbox(id);
        if (!stopped) {
          console.warn(`Artifact ${id} was not running, proceeding with restart anyway`);
        }

        // Wait a moment for cleanup
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Find a new available port dynamically by checking registry
        // Use only ports that have external mappings in .replit configuration
        // Infrastructure ports (reserved): 4000 (server), 4001 (dashboard)
        // Available artifact ports with external mappings:
        const ACCESSIBLE_PORTS = [
          3001,  // → 6800
          3004,  // → 4200
          3005,  // → 8081
          3011,  // → 9000
          4002,  // → 3002
          4003,  // → 3003
          4004,  // → 5173
          4005,  // → 5000
          5000,  // → 80
          8000,  // → 8008
          8080,  // → 8080
          24678, // → 8000
          36655, // → 6000
          46323  // → 8099
        ];
        const usedPorts = new Set(registry.getUsedPorts());

        let newPort: number | null = null;
        for (const port of ACCESSIBLE_PORTS) {
          if (!usedPorts.has(port)) {
            newPort = port;
            break;
          }
        }

        if (newPort === null) {
          res.status(500).json({
            success: false,
            message: `All ${ACCESSIBLE_PORTS.length} accessible ports are currently in use. Stop an artifact first to free up a port.`
          });
          return;
        }

        console.log(` Restarting artifact ${id} on port ${newPort} (was ${metadata.port})`);

        // Restart based on runtime type
        const TmuxManager = (await import('../../utils/TmuxManager.js')).TmuxManager;
        const tmux = TmuxManager.getInstance();

        if (metadata.tmuxSession) {
          console.log(`[Restart] Processing tmux artifact ${id}`);
          console.log(`[Restart] Session name: ${metadata.tmuxSession}`);
          console.log(`[Restart] Workspace: ${metadata.workspaceDir}`);
          console.log(`[Restart] Runtime: ${metadata.runtime}`);
          console.log(`[Restart] Entry point: ${metadata.entryPoint}`);

          // Kill old tmux session if it exists
          const exists = await tmux.sessionExists(metadata.tmuxSession);
          console.log(`[Restart] Session exists: ${exists}`);
          if (exists) {
            console.log(`[Restart] Killing existing session...`);
            await tmux.killSession(metadata.tmuxSession);
            console.log(`[Restart] Session killed`);
          }

          // Create new tmux session
          console.log(`[Restart] Creating new tmux session...`);
          try {
            await tmux.createSession(metadata.tmuxSession, metadata.workspaceDir);
            console.log(`[Restart] [OK] Tmux session created successfully`);
          } catch (err: any) {
            console.error(`[Restart] [ERROR] Failed to create tmux session:`, err.message);
            throw new Error(`Tmux session creation failed: ${err.message}`);
          }

          // Verify session was created
          const sessionCreated = await tmux.sessionExists(metadata.tmuxSession);
          console.log(`[Restart] Session verification: ${sessionCreated}`);
          if (!sessionCreated) {
            throw new Error('Tmux session was not created successfully');
          }

          // Start the appropriate server based on runtime with NEW PORT
          let startCommand = '';
          if (metadata.runtime === 'tmux+http-server') {
            startCommand = `npx http-server -p ${newPort}`;
          } else if (metadata.runtime === 'tmux+node') {
            startCommand = `PORT=${newPort} node ${metadata.entryPoint}`;
          } else if (metadata.runtime === 'tmux+python') {
            startCommand = `PORT=${newPort} python ${metadata.entryPoint}`;
          } else {
            // For tmux+custom, tmux+shell, etc., just start a shell
            startCommand = 'bash';
          }

          console.log(`[Restart] Start command: ${startCommand}`);
          console.log(`[Restart] Sending keys to tmux session...`);
          try {
            await tmux.sendKeys(metadata.tmuxSession, `cd ${metadata.workspaceDir} && ${startCommand}`);
            console.log(`[Restart] [OK] Command sent to tmux`);
          } catch (err: any) {
            console.error(`[Restart] [ERROR] Failed to send keys:`, err.message);
            throw new Error(`Failed to send command to tmux: ${err.message}`);
          }

          // Wait a moment for the process to start
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Update registry with new port and URL
          await registry.update(id, {
            port: newPort,
            url: `http://localhost:${newPort}`,
            lastUsed: new Date().toISOString()
          });

          res.json({
            success: true,
            message: `Artifact "${metadata.name}" restarted on NEW PORT ${newPort} (was ${metadata.port})`
          });
        } else {
          // Non-tmux artifacts (process, docker) - spawn new process
          const { exec } = await import('child_process');
          const { promisify } = await import('util');
          const execAsync = promisify(exec);

          const command = `npx http-server ${metadata.workspaceDir} -p ${newPort} &`;
          await execAsync(command, { cwd: metadata.workspaceDir });

          // Update registry with new port and URL
          await registry.update(id, {
            port: newPort,
            url: `http://localhost:${newPort}`,
            lastUsed: new Date().toISOString()
          });

          res.json({
            success: true,
            message: `Artifact "${metadata.name}" restarted on NEW PORT ${newPort} (was ${metadata.port})`
          });
        }

      } catch (error: any) {
        console.error('Restart error:', error);
        res.status(500).json({ success: false, message: error.message });
      }
    });

    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', uptime: process.uptime() });
    });
  }

  /**
   * Setup WebSocket event streaming
   */
  private setupWebSocket(): void {
    this.io.on('connection', (socket) => {
      console.log(` Client connected: ${socket.id}`);

      // Client subscribes to a specific sandbox
      socket.on('subscribe', (sandboxId: string) => {
        console.log(` Client ${socket.id} subscribed to sandbox: ${sandboxId}`);
        socket.join(sandboxId);

        // Send recent event history
        const history = broadcaster.getHistory(sandboxId, 50);
        socket.emit('history', { events: history });
      });

      // Client unsubscribes
      socket.on('unsubscribe', (sandboxId: string) => {
        console.log(` Client ${socket.id} unsubscribed from sandbox: ${sandboxId}`);
        socket.leave(sandboxId);
      });

      // Disconnect
      socket.on('disconnect', () => {
        console.log(` Client disconnected: ${socket.id}`);
      });
    });

    // Listen to broadcaster events and forward to WebSocket clients
    broadcaster.subscribeToAll((event: SandboxEvent) => {
      // Emit to all clients in the sandbox's room
      this.io.to(event.sandboxId).emit(event.type, event);
    });
  }

  /**
   * Generate multi-sandbox dashboard HTML
   */
  private generateDashboardHTML(): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence // Sandboxes</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <style>
    :root {
      --cx-primary: #4a90d9; --cx-primary-rgb: 74, 144, 217;
      --cx-positive: #4ade80; --cx-positive-rgb: 74, 222, 128;
      --cx-negative: #f87171; --cx-negative-rgb: 248, 113, 113;
      --cx-warning: #fbbf24;
      --cx-bg: #0f172a; --cx-bg2: #1e293b; --cx-bg3: #253347; --cx-bg4: #2d3d53;
      --cx-text: #e2e8f0; --cx-text2: #b0b8c4; --cx-muted: #94a3b8; --cx-heading: #f8fafc;
      --cx-border: #334155; --cx-border2: #283548;
      --cx-radius: 6px;
      --cx-font: 'Oxygen Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--cx-font); font-size: 12px; line-height: 1.5; color: var(--cx-text); background: var(--cx-bg); padding: 24px 20px; min-height: 100vh; }
    body::before { content: ''; position: fixed; inset: 0; background: radial-gradient(ellipse at 20% 50%, rgba(var(--cx-primary-rgb), 0.04) 0%, transparent 60%), linear-gradient(180deg, var(--cx-bg) 0%, #080818 100%); pointer-events: none; z-index: 0; }
    .shell { position: relative; z-index: 1; max-width: 1440px; margin: 0 auto; }
    .header-bar { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--cx-bg2); border: 1px solid var(--cx-border); border-radius: var(--cx-radius); margin-bottom: 20px; }
    .header-bar h1 { font-family: 'Orbitron', var(--cx-font); font-size: 14px; font-weight: 500; letter-spacing: 0.12em; text-transform: uppercase; color: var(--cx-heading); }
    .header-bar .badge { font-size: 10px; color: var(--cx-muted); padding: 2px 8px; border: 1px solid var(--cx-border2); border-radius: var(--cx-radius); }
    .subtitle { font-size: 11px; color: var(--cx-muted); letter-spacing: 0.04em; }
    .sandbox-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 12px; margin-top: 16px; }
    .sandbox-card { background: var(--cx-bg2); border: 1px solid var(--cx-border); border-radius: var(--cx-radius); padding: 16px; transition: all 200ms ease; }
    .sandbox-card:hover { border-color: rgba(var(--cx-primary-rgb), 0.5); box-shadow: 0 0 16px rgba(var(--cx-primary-rgb), 0.1); }
    .sandbox-name { font-size: 13px; font-weight: 400; color: var(--cx-heading); margin-bottom: 10px; letter-spacing: 0.04em; }
    .sandbox-actions { display: flex; gap: 6px; margin-bottom: 10px; }
    .sandbox-btn { flex: 1; padding: 7px 10px; border-radius: var(--cx-radius); font-family: var(--cx-font); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; text-align: center; text-decoration: none; cursor: pointer; transition: all 200ms ease; border: 1px solid var(--cx-border); background: transparent; color: var(--cx-text2); }
    .sandbox-btn.primary { color: var(--cx-positive); border-color: rgba(var(--cx-positive-rgb), 0.3); }
    .sandbox-btn.primary:hover { background: rgba(var(--cx-positive-rgb), 0.08); border-color: rgba(var(--cx-positive-rgb), 0.5); }
    .sandbox-btn.secondary { color: var(--cx-primary); border-color: rgba(var(--cx-primary-rgb), 0.3); }
    .sandbox-btn.secondary:hover { background: rgba(var(--cx-primary-rgb), 0.08); border-color: rgba(var(--cx-primary-rgb), 0.5); }
    .sandbox-btn.danger { color: var(--cx-negative); border-color: rgba(var(--cx-negative-rgb), 0.3); flex: 0.5; }
    .sandbox-btn.danger:hover { background: rgba(var(--cx-negative-rgb), 0.08); }
    .sandbox-btn.warning { color: var(--cx-warning); border-color: rgba(255, 187, 36, 0.3); flex: 0.5; }
    .sandbox-btn.warning:hover { background: rgba(255, 187, 36, 0.08); }
    .sandbox-btn:disabled { opacity: 0.3; cursor: not-allowed; }
    .sandbox-meta { display: flex; gap: 12px; font-size: 10px; color: var(--cx-muted); letter-spacing: 0.04em; }
    .status { display: inline-flex; align-items: center; gap: 5px; }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cx-positive); box-shadow: 0 0 6px rgba(var(--cx-positive-rgb), 0.5); }
    .status-dot.stopped { background: var(--cx-negative); box-shadow: 0 0 6px rgba(var(--cx-negative-rgb), 0.5); }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--cx-muted); }
    .empty-state h2 { font-size: 14px; font-weight: 400; color: var(--cx-text2); margin-bottom: 8px; letter-spacing: 0.06em; }
    .empty-state p { font-size: 11px; }
    .refresh-btn { font-family: var(--cx-font); font-size: 10px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--cx-primary); background: var(--cx-bg2); border: 1px solid rgba(var(--cx-primary-rgb), 0.3); border-radius: var(--cx-radius); padding: 8px 16px; cursor: pointer; transition: all 200ms ease; margin-top: 12px; }
    .refresh-btn:hover { background: rgba(var(--cx-primary-rgb), 0.08); border-color: rgba(var(--cx-primary-rgb), 0.5); }
    .nav-link { font-size: 10px; color: var(--cx-primary); text-decoration: none; letter-spacing: 0.04em; transition: color 200ms; }
    .nav-link:hover { color: var(--cx-heading); }
    @keyframes fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .anim-in { animation: fade-up 400ms ease both; }
  </style>
</head>
<body>
  <div class="shell">
    <div class="header-bar anim-in">
      <div style="display: flex; align-items: center; gap: 12px;">
        <h1>Cortex Intelligence // Sandboxes</h1>
        <span class="badge">ARTIFACTS</span>
      </div>
      <div style="display: flex; align-items: center; gap: 16px;">
        <a href="/tmux" class="nav-link">Tmux Sessions</a>
        <span class="subtitle">Real-time artifact monitoring</span>
      </div>
    </div>

    <div id="sandbox-list" class="sandbox-grid"></div>
  </div>

  <script>
    async function loadSandboxes() {
      try {
        const response = await fetch('/api/sandboxes');
        const data = await response.json();
        const container = document.getElementById('sandbox-list');

        if (data.sandboxes.length === 0) {
          container.innerHTML = \`
            <div class="empty-state anim-in">
              <h2>No Active Sandboxes</h2>
              <p>Create a sandbox using CreateArtifactTool to see it here</p>
              <button class="refresh-btn" onclick="loadSandboxes()">Refresh</button>
            </div>
          \`;
          return;
        }

        container.innerHTML = data.sandboxes.map((sandbox, i) => \`
          <div class="sandbox-card anim-in" style="animation-delay: \${i * 60}ms">
            <div class="sandbox-name">\${sandbox.name}</div>
            <div class="sandbox-actions">
              <a class="sandbox-btn primary" href="\${sandbox.url}" target="_blank">View Artifact</a>
              <a class="sandbox-btn secondary" href="/sandbox/\${sandbox.id}">Console</a>
            </div>
            <div class="sandbox-actions">
              <button class="sandbox-btn danger" onclick="stopArtifact('\${sandbox.id}', '\${sandbox.name}')" \${sandbox.status !== 'running' ? 'disabled' : ''}>Stop</button>
              <button class="sandbox-btn warning" onclick="restartArtifact('\${sandbox.id}', '\${sandbox.name}')" \${sandbox.status !== 'running' ? 'disabled' : ''}>Restart</button>
            </div>
            <div class="sandbox-meta">
              <span class="status">
                <span class="status-dot \${sandbox.status === 'running' ? '' : 'stopped'}"></span>
                \${sandbox.status}
              </span>
              <span>Mode: \${sandbox.mode}</span>
            </div>
          </div>
        \`).join('');
      } catch (error) {
        console.error('Failed to load sandboxes:', error);
      }
    }

    async function stopArtifact(id, name) {
      if (!confirm('Stop artifact "' + name + '"?')) return;
      try {
        const r = await fetch('/api/artifacts/' + id + '/stop', { method: 'POST' });
        const result = await r.json();
        if (result.success) loadSandboxes();
        else alert('Failed: ' + result.message);
      } catch (e) { alert('Error: ' + e.message); }
    }

    async function restartArtifact(id, name) {
      if (!confirm('Restart artifact "' + name + '"?')) return;
      try {
        const r = await fetch('/api/artifacts/' + id + '/restart', { method: 'POST' });
        const result = await r.json();
        if (result.success) loadSandboxes();
        else alert('Failed: ' + result.message);
      } catch (e) { alert('Error: ' + e.message); }
    }

    loadSandboxes();
    setInterval(loadSandboxes, 5000);
  </script>
</body>
</html>
    `;
  }

  /**
   * Generate sandbox-specific view HTML
   */
  private generateSandboxViewHTML(session: any): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence // ${session.name}</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <style>
    :root {
      --cx-primary: #4a90d9; --cx-primary-rgb: 74, 144, 217;
      --cx-positive: #4ade80; --cx-positive-rgb: 74, 222, 128;
      --cx-negative: #f87171; --cx-warning: #fbbf24;
      --cx-bg: #0f172a; --cx-bg2: #1e293b; --cx-bg3: #253347;
      --cx-text: #e2e8f0; --cx-text2: #b0b8c4; --cx-muted: #94a3b8; --cx-heading: #f8fafc;
      --cx-border: #334155; --cx-border2: #283548;
      --cx-radius: 6px;
      --cx-font: 'Oxygen Mono', monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--cx-font); font-size: 12px; color: var(--cx-text); background: var(--cx-bg); overflow: hidden; }
    .container { display: grid; grid-template-rows: 48px 1fr; height: 100vh; }
    .header { background: var(--cx-bg2); border-bottom: 1px solid var(--cx-border); padding: 0 16px; display: flex; align-items: center; justify-content: space-between; }
    .header .title { font-family: 'Orbitron', var(--cx-font); font-size: 13px; font-weight: 500; color: var(--cx-heading); letter-spacing: 0.1em; text-transform: uppercase; }
    .header .nav-link { font-size: 10px; color: var(--cx-primary); text-decoration: none; letter-spacing: 0.04em; }
    .header .nav-link:hover { color: var(--cx-heading); }
    .status { display: flex; align-items: center; gap: 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--cx-positive); }
    .status-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--cx-positive); box-shadow: 0 0 8px rgba(var(--cx-positive-rgb), 0.6); animation: pulse 2s ease-in-out infinite; }
    @keyframes pulse { 0%, 100% { box-shadow: 0 0 8px rgba(var(--cx-positive-rgb), 0.6); } 50% { box-shadow: 0 0 14px rgba(var(--cx-positive-rgb), 0.9); } }
    .main-content { display: grid; grid-template-columns: 1fr 360px; height: 100%; }
    .preview-pane { background: #fff; position: relative; }
    .preview-pane iframe { width: 100%; height: 100%; border: none; }
    .sidebar { background: var(--cx-bg); border-left: 1px solid var(--cx-border); display: flex; flex-direction: column; }
    .tabs { display: flex; background: var(--cx-bg2); border-bottom: 1px solid var(--cx-border); }
    .tab { flex: 1; padding: 10px; text-align: center; cursor: pointer; border-bottom: 2px solid transparent; transition: all 200ms; font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--cx-muted); font-family: var(--cx-font); }
    .tab:hover { background: var(--cx-bg3); color: var(--cx-text2); }
    .tab.active { border-bottom-color: var(--cx-primary); color: var(--cx-primary); }
    .tab-content { flex: 1; overflow-y: auto; padding: 10px; scrollbar-width: thin; scrollbar-color: var(--cx-border) var(--cx-bg); }
    .console-line { font-size: 11px; padding: 3px 8px; border-left: 2px solid transparent; margin-bottom: 1px; }
    .console-log { color: var(--cx-text); border-left-color: var(--cx-primary); }
    .console-error { color: var(--cx-negative); border-left-color: var(--cx-negative); }
    .console-warn { color: var(--cx-warning); border-left-color: var(--cx-warning); }
    .timestamp { color: var(--cx-muted); margin-right: 8px; font-size: 10px; }
    .screenshot-item { margin-bottom: 12px; }
    .screenshot-item img { width: 100%; border-radius: var(--cx-radius); border: 1px solid var(--cx-border); }
    .screenshot-meta { font-size: 10px; color: var(--cx-muted); margin-top: 4px; }
    .network-item { padding: 6px 8px; margin-bottom: 2px; background: var(--cx-bg2); border-radius: var(--cx-radius); font-size: 11px; }
    .network-method { color: var(--cx-primary); font-weight: 400; margin-right: 8px; }
    .network-url { color: var(--cx-text2); }
    .network-status { float: right; color: var(--cx-positive); }
    .reload-notification { position: absolute; top: 16px; left: 50%; transform: translateX(-50%); background: var(--cx-bg2); color: var(--cx-primary); padding: 8px 20px; border-radius: var(--cx-radius); border: 1px solid rgba(var(--cx-primary-rgb), 0.3); box-shadow: 0 4px 12px rgba(0,0,0,0.4); z-index: 1000; display: none; font-family: var(--cx-font); font-size: 11px; letter-spacing: 0.04em; }
    .reload-notification.show { display: block; animation: slideDown 0.3s; }
    @keyframes slideDown { from { transform: translateX(-50%) translateY(-12px); opacity: 0; } to { transform: translateX(-50%) translateY(0); opacity: 1; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div style="display: flex; align-items: center; gap: 16px;">
        <a href="/" class="nav-link">&larr; Dashboard</a>
        <span class="title">${session.name}</span>
      </div>
      <div class="status"><span class="status-dot"></span> Running</div>
    </div>
    <div class="main-content">
      <div class="preview-pane">
        <div class="reload-notification" id="reload-notification">Reloading...</div>
        <iframe id="sandbox-iframe" src="${session.url}"></iframe>
      </div>
      <div class="sidebar">
        <div class="tabs">
          <div class="tab active" onclick="switchTab('console')">Console</div>
          <div class="tab" onclick="switchTab('screenshots')">Screenshots</div>
          <div class="tab" onclick="switchTab('network')">Network</div>
        </div>
        <div class="tab-content" id="console-content"></div>
        <div class="tab-content" id="screenshots-content" style="display:none;"></div>
        <div class="tab-content" id="network-content" style="display:none;"></div>
      </div>
    </div>
  </div>
  <script>
    const socket = io();
    const sandboxId = '${session.id}';
    socket.emit('subscribe', sandboxId);
    socket.on('console-log', (e) => addConsoleLog('log', e.data.message));
    socket.on('console-error', (e) => addConsoleLog('error', e.data.message));
    socket.on('console-warn', (e) => addConsoleLog('warn', e.data.message));
    socket.on('file-changed', () => { showReloadNotification(); setTimeout(() => { document.getElementById('sandbox-iframe').src = '${session.url}?' + Date.now(); }, 1000); });
    socket.on('screenshot-captured', (e) => addScreenshot(e.data.screenshot, e.data.url));
    socket.on('network-request', (e) => addNetworkRequest(e.data.method, e.data.url, e.data.status));
    socket.on('network-response', (e) => addNetworkRequest(e.data.method, e.data.url, e.data.status));
    socket.on('history', (data) => { data.events.forEach(e => { if (e.type.startsWith('console-')) addConsoleLog(e.data.level, e.data.message); else if (e.type === 'screenshot-captured') addScreenshot(e.data.screenshot, e.data.url); else if (e.type.startsWith('network-')) addNetworkRequest(e.data.method, e.data.url, e.data.status); }); });
    function addConsoleLog(level, message) { const c = document.getElementById('console-content'); const l = document.createElement('div'); l.className = 'console-line console-' + level; l.innerHTML = '<span class="timestamp">' + new Date().toLocaleTimeString() + '</span>' + message; c.appendChild(l); c.scrollTop = c.scrollHeight; }
    function addScreenshot(base64, url) { const c = document.getElementById('screenshots-content'); const i = document.createElement('div'); i.className = 'screenshot-item'; i.innerHTML = '<img src="data:image/png;base64,' + base64 + '" alt="Screenshot"><div class="screenshot-meta">' + new Date().toLocaleString() + '</div>'; c.insertBefore(i, c.firstChild); }
    function addNetworkRequest(method, url, status) { const c = document.getElementById('network-content'); const i = document.createElement('div'); i.className = 'network-item'; i.innerHTML = '<span class="network-method">' + method + '</span><span class="network-url">' + url + '</span>' + (status ? '<span class="network-status">' + status + '</span>' : ''); c.insertBefore(i, c.firstChild); }
    function showReloadNotification() { const n = document.getElementById('reload-notification'); n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 2000); }
    function switchTab(tab) { document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); event.target.classList.add('active'); ['console','screenshots','network'].forEach(t => { document.getElementById(t + '-content').style.display = t === tab ? 'block' : 'none'; }); }
    addConsoleLog('log', 'Sandbox viewer connected');
  </script>
</body>
</html>
    `;
  }

  /**
   * Generate 404 page
   */
  private generate404HTML(sandboxId: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Cortex Intelligence // Not Found</title>
  <link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700&family=Oxygen+Mono&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Oxygen Mono', monospace; font-size: 12px; background: #0f172a; color: #e2e8f0; display: flex; align-items: center; justify-content: center; height: 100vh; text-align: center; }
    .error-container { max-width: 440px; padding: 40px; background: #1e293b; border: 1px solid #334155; border-radius: 6px; }
    h1 { font-size: 14px; font-weight: 400; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 12px; color: #f8fafc; }
    p { color: #94a3b8; font-size: 11px; margin-bottom: 8px; }
    .sandbox-id { background: #253347; padding: 8px 12px; border-radius: 6px; margin: 16px 0; color: #f87171; font-size: 11px; border: 1px solid #283548; }
    a { color: #4a90d9; text-decoration: none; font-size: 11px; letter-spacing: 0.04em; }
    a:hover { color: #f8fafc; }
  </style>
</head>
<body>
  <div class="error-container">
    <h1>Sandbox Not Found</h1>
    <p>The sandbox you're looking for doesn't exist or has been stopped.</p>
    <div class="sandbox-id">${sandboxId}</div>
    <p><a href="/">&larr; Back to Dashboard</a></p>
  </div>
</body>
</html>
    `;
  }

  /**
   * Check if server is running
   */
  isServerRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get current port
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get Express app instance for route registration
   * Allows other servers (like TmuxViewServer) to add routes
   */
  getApp(): Express {
    return this.app;
  }

  /**
   * Get Socket.IO server instance for WebSocket handling
   * Allows other servers to register WebSocket event handlers
   */
  getIO(): SocketIOServer {
    return this.io;
  }
}

/**
 * Export singleton instance
 */
export const viewServer = SandboxViewServer.getInstance();
