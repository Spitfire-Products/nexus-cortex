# User Real-Time Viewing System for Sandboxes

**Date**: 2025-11-03
**Status**: DESIGN SPECIFICATION
**Priority**: CRITICAL 🔥

---

## Overview

**THE USER MUST BE ABLE TO SEE WHAT'S HAPPENING IN THE SANDBOX IN REAL-TIME!**

This is absolutely essential. While the model has visual feedback through VisualFeedbackBridge, the user needs:
- Live browser preview of sandbox UIs
- Real-time console logs
- File change notifications
- Screenshot updates
- Process status monitoring
- Network activity viewing

---

## Core Principle

```
MODEL SEES    +    USER SEES    =    TRANSPARENCY & TRUST
   (API)            (UI/Visual)
```

**Both** the model and user should see the same thing, but through different interfaces:
- **Model**: Via tool responses (screenshots, DOM, console as text)
- **User**: Via live UI (embedded browser, streaming logs, visual dashboard)

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                      SANDBOX                             │
│                                                          │
│  ┌────────────────┐         ┌────────────────┐         │
│  │  Node/Python   │◄───────┤  File Watcher  │         │
│  │  Process       │         └────────────────┘         │
│  │  (Port 3000)   │                                     │
│  └────┬───────────┘                                     │
│       │                                                 │
│       │ stdout/stderr                                   │
│       │                                                 │
│       ▼                                                 │
│  ┌─────────────────────────────────────┐               │
│  │    Sandbox Event Broadcaster         │               │
│  │                                      │               │
│  │  • Console logs                     │               │
│  │  • File changes                     │               │
│  │  • Network requests                 │               │
│  │  • Process status                   │               │
│  │  • Screenshot updates               │               │
│  └──────────┬──────────────────────────┘               │
│             │                                           │
└─────────────┼───────────────────────────────────────────┘
              │
              ├──────────────────┬──────────────────┬──────────────
              │                  │                  │
              ▼                  ▼                  ▼
    ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
    │  WebSocket/SSE   │  │  HTTP/REST   │  │  Model API   │
    │  (Real-time)     │  │  (Polling)   │  │  (Tools)     │
    └────────┬─────────┘  └──────┬───────┘  └──────┬───────┘
             │                    │                  │
             ▼                    ▼                  ▼
    ┌──────────────────┐  ┌──────────────┐  ┌──────────────┐
    │  USER UI         │  │  Dashboard   │  │  Model       │
    │  (Live)          │  │  (Metrics)   │  │  (Feedback)  │
    └──────────────────┘  └──────────────┘  └──────────────┘
```

---

## User Viewing Modes

### Mode 1: Embedded Browser Preview (RECOMMENDED)

**Description**: Embed the sandbox UI directly in the user's interface using an iframe or webview.

**Architecture**:
```
User's Terminal/UI
├── Chat Messages
├── Model Responses
└── [LIVE SANDBOX PREVIEW] ← Real-time browser view
    │
    └── iframe: http://localhost:3000
```

**Implementation**:

```typescript
// packages/executors/src/implementations/addon/SandboxViewServer.ts

import express from 'express';
import { Server } from 'socket.io';
import { CreateAddonToolExecutorEnhanced } from './CreateAddonToolEnhanced.js';

export class SandboxViewServer {
  private app: express.Application;
  private io: Server;
  private port: number = 4000; // View server port

  constructor() {
    this.app = express();
    this.io = new Server();
  }

  /**
   * Start the view server
   */
  start(): void {
    // Serve HTML dashboard
    this.app.get('/view/:sandboxId', (req, res) => {
      const sandboxId = req.params.sandboxId;
      const session = CreateAddonToolExecutorEnhanced.getActiveSandbox(sandboxId);

      if (!session) {
        res.status(404).send('Sandbox not found');
        return;
      }

      res.send(this.generateViewHTML(session));
    });

    // WebSocket for live updates
    this.io.on('connection', (socket) => {
      console.log('User connected to view server');

      socket.on('subscribe', (sandboxId: string) => {
        socket.join(`sandbox-${sandboxId}`);
        console.log(`User subscribed to sandbox: ${sandboxId}`);
      });
    });

    this.app.listen(this.port, () => {
      console.log(`📺 View Server running at http://localhost:${this.port}`);
    });
  }

  /**
   * Broadcast event to all subscribers
   */
  broadcast(sandboxId: string, event: string, data: any): void {
    this.io.to(`sandbox-${sandboxId}`).emit(event, data);
  }

  /**
   * Generate HTML for sandbox view
   */
  private generateViewHTML(session: any): string {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Sandbox: ${session.name}</title>
        <script src="/socket.io/socket.io.js"></script>
        <style>
          body {
            margin: 0;
            padding: 0;
            font-family: 'Segoe UI', Arial, sans-serif;
            background: #1a1a1a;
            color: #fff;
          }

          .container {
            display: grid;
            grid-template-rows: 60px 1fr;
            height: 100vh;
          }

          .header {
            background: #2a2a2a;
            padding: 15px 20px;
            border-bottom: 2px solid #4CAF50;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .title {
            font-size: 20px;
            font-weight: bold;
            color: #4CAF50;
          }

          .status {
            display: flex;
            gap: 15px;
            align-items: center;
          }

          .status-badge {
            padding: 5px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
          }

          .status-running {
            background: #4CAF50;
            color: #fff;
          }

          .main-content {
            display: grid;
            grid-template-columns: 1fr 400px;
            gap: 0;
          }

          .preview-pane {
            background: #fff;
            position: relative;
          }

          .preview-iframe {
            width: 100%;
            height: 100%;
            border: none;
          }

          .sidebar {
            background: #2a2a2a;
            border-left: 1px solid #3a3a3a;
            display: flex;
            flex-direction: column;
          }

          .tabs {
            display: flex;
            background: #222;
            border-bottom: 1px solid #3a3a3a;
          }

          .tab {
            flex: 1;
            padding: 12px;
            text-align: center;
            cursor: pointer;
            border-bottom: 2px solid transparent;
            transition: all 0.2s;
          }

          .tab:hover {
            background: #333;
          }

          .tab.active {
            border-bottom-color: #4CAF50;
            background: #2a2a2a;
          }

          .tab-content {
            flex: 1;
            overflow-y: auto;
            padding: 15px;
          }

          .log-entry {
            padding: 8px;
            margin: 4px 0;
            border-radius: 4px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            background: #1a1a1a;
          }

          .log-info { border-left: 3px solid #2196F3; }
          .log-error { border-left: 3px solid #f44336; }
          .log-warn { border-left: 3px solid #ff9800; }

          .file-change {
            padding: 10px;
            margin: 5px 0;
            background: #1a1a1a;
            border-radius: 4px;
            border-left: 3px solid #4CAF50;
          }

          .file-name {
            font-weight: bold;
            color: #4CAF50;
          }

          .timestamp {
            color: #888;
            font-size: 11px;
          }

          .screenshot-preview {
            width: 100%;
            border-radius: 8px;
            margin: 10px 0;
          }

          .refresh-btn {
            position: absolute;
            top: 10px;
            right: 10px;
            padding: 8px 16px;
            background: #4CAF50;
            color: #fff;
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-weight: 600;
            z-index: 1000;
          }

          .refresh-btn:hover {
            background: #45a049;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="title">
              📦 ${session.name}
            </div>
            <div class="status">
              <div class="status-badge status-running">
                ● RUNNING
              </div>
              <div>
                Port: ${session.port}
              </div>
              <div id="uptime">
                Uptime: 0s
              </div>
            </div>
          </div>

          <div class="main-content">
            <div class="preview-pane">
              <button class="refresh-btn" onclick="refreshIframe()">🔄 Refresh</button>
              <iframe
                id="sandbox-iframe"
                class="preview-iframe"
                src="${session.url}"
              ></iframe>
            </div>

            <div class="sidebar">
              <div class="tabs">
                <div class="tab active" onclick="switchTab('console')">
                  Console
                </div>
                <div class="tab" onclick="switchTab('files')">
                  Files
                </div>
                <div class="tab" onclick="switchTab('network')">
                  Network
                </div>
                <div class="tab" onclick="switchTab('screenshots')">
                  Shots
                </div>
              </div>

              <div class="tab-content">
                <div id="console-content" class="tab-pane active"></div>
                <div id="files-content" class="tab-pane" style="display: none;"></div>
                <div id="network-content" class="tab-pane" style="display: none;"></div>
                <div id="screenshots-content" class="tab-pane" style="display: none;"></div>
              </div>
            </div>
          </div>
        </div>

        <script>
          const socket = io();
          const sandboxId = '${session.id}';
          const startTime = Date.now();

          // Subscribe to sandbox events
          socket.emit('subscribe', sandboxId);

          // Update uptime
          setInterval(() => {
            const uptime = Math.floor((Date.now() - startTime) / 1000);
            document.getElementById('uptime').textContent = \`Uptime: \${uptime}s\`;
          }, 1000);

          // Console logs
          socket.on('console-log', (data) => {
            const consoleContent = document.getElementById('console-content');
            const entry = document.createElement('div');
            entry.className = \`log-entry log-\${data.level}\`;
            entry.innerHTML = \`
              <div class="timestamp">\${new Date(data.timestamp).toLocaleTimeString()}</div>
              <div>\${data.message}</div>
            \`;
            consoleContent.appendChild(entry);
            consoleContent.scrollTop = consoleContent.scrollHeight;
          });

          // File changes
          socket.on('file-changed', (data) => {
            const filesContent = document.getElementById('files-content');
            const change = document.createElement('div');
            change.className = 'file-change';
            change.innerHTML = \`
              <div class="file-name">\${data.file}</div>
              <div class="timestamp">\${new Date(data.timestamp).toLocaleTimeString()}</div>
              <div>Size: \${data.size} bytes</div>
            \`;
            filesContent.insertBefore(change, filesContent.firstChild);

            // Auto-reload iframe on file change
            setTimeout(() => {
              refreshIframe();
            }, 1000);
          });

          // Network requests
          socket.on('network-request', (data) => {
            const networkContent = document.getElementById('network-content');
            const request = document.createElement('div');
            request.className = 'log-entry log-info';
            request.innerHTML = \`
              <div class="timestamp">\${new Date(data.timestamp).toLocaleTimeString()}</div>
              <div><strong>\${data.method}</strong> \${data.url}</div>
              <div>Status: \${data.status || 'pending'}</div>
            \`;
            networkContent.appendChild(request);
            networkContent.scrollTop = networkContent.scrollHeight;
          });

          // Screenshot updates
          socket.on('screenshot-updated', (data) => {
            const screenshotsContent = document.getElementById('screenshots-content');
            const img = document.createElement('img');
            img.className = 'screenshot-preview';
            img.src = \`data:image/png;base64,\${data.screenshot}\`;
            screenshotsContent.insertBefore(img, screenshotsContent.firstChild);

            // Keep only last 5 screenshots
            while (screenshotsContent.children.length > 5) {
              screenshotsContent.removeChild(screenshotsContent.lastChild);
            }
          });

          function refreshIframe() {
            const iframe = document.getElementById('sandbox-iframe');
            iframe.src = iframe.src;
          }

          function switchTab(tab) {
            // Update tab buttons
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            event.target.classList.add('active');

            // Update content
            document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');
            document.getElementById(\`\${tab}-content\`).style.display = 'block';
          }
        </script>
      </body>
      </html>
    `;
  }
}

// Singleton instance
export const sandboxViewServer = new SandboxViewServer();
```

**Usage**:

```typescript
// When user asks to create a tool
const result = await createAddonToolEnhanced.execute({
  name: 'my-tool',
  enableVisualFeedback: true,
  mode: 'dev'
}, signal);

// Start view server if not already running
sandboxViewServer.start();

// Return URL to user
console.log(`
  ✅ Sandbox created!

  🔗 View live at: http://localhost:4000/view/${result.metadata.sandboxId}

  The browser will auto-reload when you make changes.
`);
```

---

### Mode 2: Terminal Screenshot Stream

**Description**: For terminal-only environments, stream screenshots as ASCII art or save to file.

**Implementation**:

```typescript
// packages/executors/src/implementations/addon/TerminalViewer.ts

import { visualBridge } from './VisualFeedbackBridge.js';
import { writeFile } from 'fs/promises';

export class TerminalViewer {
  /**
   * Stream screenshots to terminal as saved files
   */
  async streamToFiles(
    sandboxId: string,
    outputDir: string,
    intervalMs: number = 5000
  ): Promise<() => void> {
    const session = CreateAddonToolExecutorEnhanced.getActiveSandbox(sandboxId);

    if (!session || !session.url) {
      throw new Error('Sandbox not found or has no URL');
    }

    let counter = 0;

    const interval = setInterval(async () => {
      try {
        // Capture screenshot
        await visualBridge.initialize();
        const snapshot = await visualBridge.captureSnapshot(session.url!);

        // Save to file
        const filename = `${outputDir}/screenshot-${Date.now()}-${counter++}.png`;
        const buffer = Buffer.from(snapshot.screenshot, 'base64');
        await writeFile(filename, buffer);

        console.log(`📸 Screenshot saved: ${filename}`);
        console.log(`   URL: ${session.url}`);
        console.log(`   Console: ${snapshot.console.length} logs`);
      } catch (error) {
        console.error('Screenshot capture failed:', error);
      }
    }, intervalMs);

    // Return stop function
    return () => {
      clearInterval(interval);
      console.log('Screenshot streaming stopped');
    };
  }

  /**
   * Print console logs to terminal
   */
  streamConsole(sandboxId: string): () => void {
    const session = CreateAddonToolExecutorEnhanced.getActiveSandbox(sandboxId);

    if (!session || !session.process) {
      throw new Error('Sandbox not found');
    }

    // Stream stdout
    session.process.stdout?.on('data', (data) => {
      console.log(`[${session.name}] ${data.toString()}`);
    });

    // Stream stderr
    session.process.stderr?.on('data', (data) => {
      console.error(`[${session.name}] ERROR: ${data.toString()}`);
    });

    return () => {
      console.log('Console streaming stopped');
    };
  }
}
```

**Usage**:

```typescript
const viewer = new TerminalViewer();

// Stream screenshots to folder
const stopScreenshots = await viewer.streamToFiles(
  sandboxId,
  '/tmp/sandbox-screenshots',
  5000 // Every 5 seconds
);

// Stream console logs
const stopConsole = viewer.streamConsole(sandboxId);

// User can view screenshots with:
// $ open /tmp/sandbox-screenshots/screenshot-*.png
// Or in terminal: $ imgcat /tmp/sandbox-screenshots/screenshot-*.png

// Stop when done
stopScreenshots();
stopConsole();
```

---

### Mode 3: WebSocket Live Dashboard

**Description**: Separate web dashboard with real-time metrics, logs, and preview.

**Architecture**:

```
┌──────────────────────────────────────────────────┐
│          Sandbox Dashboard (localhost:4000)      │
│                                                  │
│  ┌─────────────────┐  ┌───────────────────┐    │
│  │  Sandbox List   │  │  Live Metrics      │    │
│  │  ─────────────  │  │  ───────────────   │    │
│  │  ● dashboard    │  │  CPU: 23%          │    │
│  │  ● api-server   │  │  Memory: 45MB      │    │
│  │  ● frontend     │  │  Uptime: 5m 23s    │    │
│  └─────────────────┘  └───────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │          Browser Preview                  │   │
│  │  ┌──────────────────────────────────┐    │   │
│  │  │  [Sandbox UI iframe]             │    │   │
│  │  │                                   │    │   │
│  │  └──────────────────────────────────┘    │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌────────────────────┐  ┌──────────────────┐  │
│  │  Console Logs      │  │  File Changes     │  │
│  │  ──────────────    │  │  ──────────────   │  │
│  │  [log] Server...   │  │  index.js         │  │
│  │  [log] Port...     │  │  styles.css       │  │
│  └────────────────────┘  └──────────────────┘  │
└──────────────────────────────────────────────────┘
```

**Features**:
- Multi-sandbox monitoring
- Real-time metrics
- Live browser preview
- Console log streaming
- File change notifications
- Network activity
- Screenshot history

---

## Event Broadcasting System

### SandboxEventBroadcaster

```typescript
// packages/executors/src/implementations/addon/SandboxEventBroadcaster.ts

import { EventEmitter } from 'events';
import { sandboxViewServer } from './SandboxViewServer.js';

export class SandboxEventBroadcaster extends EventEmitter {
  /**
   * Broadcast console log
   */
  broadcastConsoleLog(
    sandboxId: string,
    level: 'info' | 'error' | 'warn',
    message: string
  ): void {
    const event = {
      timestamp: Date.now(),
      level,
      message
    };

    // Emit to local listeners
    this.emit(`console:${sandboxId}`, event);

    // Broadcast to WebSocket clients
    sandboxViewServer.broadcast(sandboxId, 'console-log', event);
  }

  /**
   * Broadcast file change
   */
  broadcastFileChange(
    sandboxId: string,
    file: string,
    size: number
  ): void {
    const event = {
      timestamp: Date.now(),
      file,
      size
    };

    this.emit(`file:${sandboxId}`, event);
    sandboxViewServer.broadcast(sandboxId, 'file-changed', event);
  }

  /**
   * Broadcast screenshot update
   */
  broadcastScreenshot(
    sandboxId: string,
    screenshot: string
  ): void {
    const event = {
      timestamp: Date.now(),
      screenshot
    };

    this.emit(`screenshot:${sandboxId}`, event);
    sandboxViewServer.broadcast(sandboxId, 'screenshot-updated', event);
  }

  /**
   * Broadcast network request
   */
  broadcastNetworkRequest(
    sandboxId: string,
    method: string,
    url: string,
    status?: number
  ): void {
    const event = {
      timestamp: Date.now(),
      method,
      url,
      status
    };

    this.emit(`network:${sandboxId}`, event);
    sandboxViewServer.broadcast(sandboxId, 'network-request', event);
  }
}

// Singleton
export const sandboxBroadcaster = new SandboxEventBroadcaster();
```

### Integration with Existing Tools

Modify existing tools to broadcast events:

```typescript
// In CreateAddonToolEnhanced.ts

import { sandboxBroadcaster } from './SandboxEventBroadcaster.js';

// When capturing console logs
child.stdout?.on('data', (data) => {
  const message = data.toString();
  console.log(`[${params.name}] ${message}`);

  // Broadcast to users
  sandboxBroadcaster.broadcastConsoleLog(
    sandboxId,
    'info',
    message
  );
});

// When file changes (hot reload)
watch(filePath, async (eventType) => {
  if (eventType === 'change') {
    const stats = await fs.stat(filePath);

    // Broadcast file change
    sandboxBroadcaster.broadcastFileChange(
      session.id,
      fileName,
      stats.size
    );

    // ... rest of hot reload logic
  }
});

// When capturing screenshots
if (params.enableVisualFeedback && session.url) {
  const snapshot = await visualBridge.captureSnapshot(session.url);

  // Broadcast screenshot
  sandboxBroadcaster.broadcastScreenshot(
    session.id,
    snapshot.screenshot
  );

  session.visualSnapshot = snapshot;
}
```

---

## User Experience Flow

### 1. User Asks Model to Create Tool

```
User: "Build me a real-time stock dashboard"
```

### 2. Model Creates Sandbox

```typescript
const result = await createAddonToolEnhanced.execute({
  name: 'stock-dashboard',
  enableVisualFeedback: true,
  mode: 'dev',
  implementation: { /* ... */ }
}, signal);
```

### 3. User Receives View URL

```
Model: "✅ I've created your stock dashboard!

🔗 View live at: http://localhost:4000/view/abc-123-def-456

The dashboard will auto-reload as I make improvements.
You can see:
- Live browser preview
- Console logs
- File changes
- Screenshots

I'm starting with a basic layout..."
```

### 4. User Opens View URL

Browser shows:
- **Left**: Live iframe of dashboard
- **Right**: Console logs streaming in real-time
- **Tabs**: Files, Network, Screenshots

### 5. Model Iterates, User Watches

```
Model: "I see the layout is basic. Let me add charts..."

[User sees in browser]:
- Console: "Adding Chart.js library..."
- Files: "styles.css changed"
- Preview: Dashboard reloads, charts appear!

Model: "Charts are rendering. Let me add real-time data..."

[User sees]:
- Console: "Connecting to stock API..."
- Network: "GET /api/stocks/TSLA"
- Preview: Stock prices updating live!

Model: "Looking good! Let me test the refresh button..."

[User sees]:
- Preview: Model clicks refresh button (via Playwright)
- Console: "Data refreshed successfully"
- Preview: New data loads
```

### 6. Done!

```
Model: "✅ Dashboard is complete and tested!

You can continue using it at:
http://localhost:3000 (direct)
http://localhost:4000/view/abc-123 (with monitoring)

Would you like me to add any features?"
```

---

## Implementation Checklist

### Phase 1: Basic Viewing (2-3 hours)
- ✅ Create SandboxViewServer class
- ✅ Create basic HTML dashboard
- ✅ Add WebSocket support
- ✅ Implement console log streaming
- ✅ Test with simple sandbox

### Phase 2: Event Broadcasting (2-3 hours)
- ✅ Create SandboxEventBroadcaster
- ✅ Integrate with CreateAddonToolEnhanced
- ✅ Integrate with ModifySandbox
- ✅ Integrate with InteractWithSandbox
- ✅ Test all event types

### Phase 3: Advanced Features (3-4 hours)
- ⬜ Add screenshot streaming
- ⬜ Add network monitoring
- ⬜ Add file change tracking
- ⬜ Add performance metrics
- ⬜ Add multi-sandbox dashboard

### Phase 4: Terminal Mode (2 hours)
- ⬜ Create TerminalViewer class
- ⬜ Implement screenshot-to-file streaming
- ⬜ Implement console streaming
- ⬜ Test in terminal-only environment

---

## Status

**Design**: Complete
**Priority**: CRITICAL 🔥
**Est. Time**: 8-12 hours
**Dependencies**: None (ready to implement)

---

**This completes the feedback loop:**

```
MODEL CREATES  →  USER SEES  →  MODEL ITERATES  →  USER VERIFIES
     ↑                                                    ↓
     └────────────────────────────────────────────────────┘
                    COLLABORATION
```

**Now both the AI and the user can work together with FULL VISIBILITY!** 🚀
