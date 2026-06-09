/**
 * Terminal Sandbox
 *
 * Provides visual terminal emulation using xterm.js
 * Allows model to see and interact with shell sessions
 *
 * Features:
 * - Visual terminal display (xterm.js in browser)
 * - Full PTY support (bash, zsh, etc.)
 * - Screenshot capture of terminal output
 * - Direct typing/command execution
 * - WebSocket communication
 */

import { chromium, Browser, Page } from 'playwright';
import { spawn, ChildProcess } from 'child_process';
import express from 'express';
import * as http from 'http';
import { WebSocketServer } from 'ws';
import { join, dirname } from 'path';
import { promises as fs } from 'fs';
import { fileURLToPath } from 'url';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface TerminalConfig {
  shell?: string;           // Shell to use (default: bash)
  cwd?: string;            // Working directory
  env?: Record<string, string>; // Environment variables
  headed?: boolean;        // Show browser window (default: false)
  rows?: number;          // Terminal rows (default: 24)
  cols?: number;          // Terminal columns (default: 80)
  executablePath?: string; // Path to browser executable (use system Chromium)
}

export interface TerminalSnapshot {
  screenshot: string;     // Base64 PNG
  output: string;        // Current terminal output
  cwd: string;           // Current working directory
  timestamp: number;
}

/**
 * TerminalSandbox - Visual terminal emulation
 *
 * Combines:
 * - PTY process (actual shell)
 * - xterm.js (visual display in browser)
 * - Playwright (browser automation for screenshots)
 * - WebSocket (real-time communication)
 */
export class TerminalSandbox {
  private shell: ChildProcess | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private terminalUrl: string = '';
  private output: string = '';
  private config: TerminalConfig;

  // Port for WebSocket server
  private wsPort: number = 3001;

  constructor(config: TerminalConfig = {}) {
    this.config = {
      shell: config.shell || process.env.SHELL || '/bin/bash',
      cwd: config.cwd || process.cwd(),
      env: config.env || process.env as Record<string, string>,
      headed: config.headed ?? false,
      rows: config.rows || 24,
      cols: config.cols || 80
    };
  }

  /**
   * Initialize terminal sandbox
   * 1. Start shell process (PTY)
   * 2. Start WebSocket server for communication
   * 3. Launch browser with xterm.js client
   */
  async initialize(): Promise<void> {
    // 1. Start shell process
    await this.startShell();

    // 2. Start WebSocket server
    await this.startWebSocketServer();

    // 3. Launch browser with terminal client
    await this.startBrowser();
  }

  /**
   * Start shell process (PTY emulation)
   */
  private async startShell(): Promise<void> {
    this.shell = spawn(this.config.shell!, [], {
      cwd: this.config.cwd,
      env: this.config.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Capture output
    this.shell.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.output += text;

      // Broadcast to WebSocket clients
      this.broadcastToClients(text);
    });

    this.shell.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.output += text;
      this.broadcastToClients(text);
    });

    this.shell.on('exit', (code: number | null) => {
      console.log(`Shell exited with code: ${code}`);
    });
  }

  /**
   * Start WebSocket server for terminal I/O
   */
  private async startWebSocketServer(): Promise<void> {
    const app = express();

    // Serve static terminal HTML client
    const clientPath = join(__dirname, 'terminal-client.html');
    app.get('/', async (req: any, res: any) => {
      try {
        const html = await fs.readFile(clientPath, 'utf-8');
        res.send(html);
      } catch (error) {
        // If file doesn't exist, serve inline HTML
        res.send(this.getInlineTerminalHTML());
      }
    });

    this.server = http.createServer(app);

    // WebSocket server for terminal communication
    this.wss = new WebSocketServer({ server: this.server });

    this.wss.on('connection', (ws: any) => {
      console.log('Terminal client connected');

      // Send current output to new client
      ws.send(this.output);

      // Handle input from client (user typing)
      ws.on('message', (data: any) => {
        const input = data.toString();

        // Write to shell stdin
        if (this.shell && this.shell.stdin) {
          this.shell.stdin.write(input);
        }
      });

      ws.on('close', () => {
        console.log('Terminal client disconnected');
      });
    });

    // Start server
    await new Promise<void>((resolve) => {
      this.server!.listen(this.wsPort, () => {
        this.terminalUrl = `http://localhost:${this.wsPort}`;
        console.log(`Terminal server running at ${this.terminalUrl}`);
        resolve();
      });
    });
  }

  /**
   * Broadcast output to all connected WebSocket clients
   */
  private broadcastToClients(data: string): void {
    if (!this.wss) return;

    this.wss.clients.forEach((client: any) => {
      if (client.readyState === 1) { // WebSocket.OPEN
        client.send(data);
      }
    });
  }

  /**
   * Start browser to display terminal
   */
  private async startBrowser(): Promise<void> {
    const launchOptions: any = {
      headless: !this.config.headed,
      slowMo: 50,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    if (this.config.executablePath) {
      launchOptions.executablePath = this.config.executablePath;
    }

    this.browser = await chromium.launch(launchOptions);

    this.page = await this.browser.newPage();

    // Navigate to terminal client
    await this.page.goto(this.terminalUrl);

    // Wait for terminal to be ready
    await this.page.waitForTimeout(1000);
  }

  /**
   * Type command into terminal
   * @param text Text to type
   */
  async type(text: string): Promise<void> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    await this.page.keyboard.type(text);
  }

  /**
   * Execute command in terminal
   * @param command Command to execute
   */
  async executeCommand(command: string): Promise<void> {
    await this.type(command);
    await this.page!.keyboard.press('Enter');
  }

  /**
   * Get screenshot of terminal
   */
  async getScreenshot(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    return await this.page.screenshot({ type: 'png' });
  }

  /**
   * Capture current terminal state
   */
  async captureSnapshot(): Promise<TerminalSnapshot> {
    const screenshot = await this.getScreenshot();

    return {
      screenshot: screenshot.toString('base64'),
      output: this.output,
      cwd: this.config.cwd!,
      timestamp: Date.now()
    };
  }

  /**
   * Clear terminal output
   */
  async clear(): Promise<void> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    await this.page.keyboard.press('Control+L');
    this.output = '';
  }

  /**
   * Get current output
   */
  getOutput(): string {
    return this.output;
  }

  /**
   * Cleanup resources
   */
  async close(): Promise<void> {
    // Close shell
    if (this.shell) {
      this.shell.kill();
      this.shell = null;
    }

    // Close browser
    if (this.page) {
      await this.page.close();
      this.page = null;
    }

    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  /**
   * Get inline terminal HTML client (fallback if file doesn't exist)
   */
  private getInlineTerminalHTML(): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Terminal</title>
  <link rel="stylesheet" href="https://unpkg.com/xterm@5.0.0/css/xterm.css" />
  <style>
    body {
      margin: 0;
      padding: 20px;
      background: #000;
      font-family: monospace;
    }
    #terminal {
      width: 100%;
      height: 100vh;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>

  <script src="https://unpkg.com/xterm@5.0.0/lib/xterm.js"></script>
  <script src="https://unpkg.com/xterm-addon-fit@0.6.0/lib/xterm-addon-fit.js"></script>

  <script>
    // Create terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#000000',
        foreground: '#ffffff'
      },
      rows: ${this.config.rows},
      cols: ${this.config.cols}
    });

    // Attach to DOM
    term.open(document.getElementById('terminal'));

    // Fit to window
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    fitAddon.fit();

    // Connect to WebSocket
    const ws = new WebSocket('ws://localhost:${this.wsPort}');

    ws.onopen = () => {
      console.log('Connected to terminal server');
    };

    ws.onmessage = (event) => {
      // Write server output to terminal
      term.write(event.data);
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('Disconnected from terminal server');
    };

    // Send user input to server
    term.onData((data) => {
      ws.send(data);
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      fitAddon.fit();
    });
  </script>
</body>
</html>
    `;
  }
}

/**
 * Singleton instance for convenience
 */
export const terminalSandbox = new TerminalSandbox();
