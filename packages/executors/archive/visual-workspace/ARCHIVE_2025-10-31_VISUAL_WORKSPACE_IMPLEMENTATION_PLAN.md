# Visual Workspace Implementation Plan

## Overview

Transform the current sandbox system into a **visual development workspace** where the AI model can:
- Choose sandbox type (browser, terminal, or hybrid)
- See visual output (screenshots/screen stream)
- Interact physically (click, type, scroll, zoom)
- Execute code written on client side
- Work like a human developer with eyes and hands

**Scope**: Option B without IDE
- ✅ Browser sandbox enhancements
- ✅ Terminal sandbox
- ✅ Screen streaming
- ✅ Multi-window management
- ❌ IDE sandbox (not needed - model writes code on client)

**Total Estimated Time**: 5-6 hours

---

## Phase 1: Enhanced Browser Sandbox (1 hour)

### Task 1.1: Enable Headed Mode (5 min)

**File**: `src/implementations/addon/VisualFeedbackBridge.ts`

**Current Code** (~line 50):
```typescript
this.browser = await chromium.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
```

**Change To**:
```typescript
async initialize(config: VisualBridgeConfig = {}) {
  this.browser = await chromium.launch({
    headless: config.headless ?? true,
    slowMo: config.slowMo ?? 0,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      ...(config.userDataDir ? [`--user-data-dir=${config.userDataDir}`] : [])
    ]
  });
  // ... rest of initialization
}
```

**Add Interface**:
```typescript
export interface VisualBridgeConfig {
  headless?: boolean;
  slowMo?: number;
  userDataDir?: string;
}
```

**Test**:
```typescript
await visualBridge.initialize({ headless: false });
// Browser window should appear
```

---

### Task 1.2: Add Keyboard Shortcuts Support (30 min)

**File**: `src/implementations/addon/VisualFeedbackBridge.ts`

**Add Method**:
```typescript
async keyPress(key: string, modifiers?: string[]): Promise<void> {
  if (!this.page) {
    throw new Error('Browser not initialized');
  }

  // Map common shortcuts
  const keyMap: Record<string, string> = {
    'Enter': 'Enter',
    'Escape': 'Escape',
    'Tab': 'Tab',
    'Backspace': 'Backspace',
    'Delete': 'Delete',
    'ArrowUp': 'ArrowUp',
    'ArrowDown': 'ArrowDown',
    'ArrowLeft': 'ArrowLeft',
    'ArrowRight': 'ArrowRight',
    'Home': 'Home',
    'End': 'End',
    'PageUp': 'PageUp',
    'PageDown': 'PageDown'
  };

  // Handle Ctrl+Key shortcuts
  if (key.includes('+')) {
    const parts = key.split('+');
    const modifier = parts[0].toLowerCase(); // ctrl, shift, alt, meta
    const actualKey = parts[1];

    await this.page.keyboard.press(`${modifier[0].toUpperCase() + modifier.slice(1)}+${actualKey}`);
  } else {
    const mappedKey = keyMap[key] || key;
    await this.page.keyboard.press(mappedKey);
  }
}
```

**Update InteractionCommand**:
```typescript
export interface InteractionCommand {
  type: 'click' | 'type' | 'navigate' | 'scroll' | 'hover' | 'select' | 'wait' | 'keypress';
  selector?: string;
  value?: string;
  coordinates?: { x: number; y: number };
  duration?: number;
  key?: string;           // NEW
  modifiers?: string[];   // NEW
}
```

**Update interact() method**:
```typescript
async interact(command: InteractionCommand): Promise<void> {
  // ... existing cases

  case 'keypress':
    if (command.key) {
      await this.keyPress(command.key, command.modifiers);
    }
    break;
}
```

**Test**:
```typescript
// Ctrl+S (save)
await visualBridge.interact({ type: 'keypress', key: 'Ctrl+S' });

// Ctrl+V (paste)
await visualBridge.interact({ type: 'keypress', key: 'Ctrl+V' });

// Enter
await visualBridge.interact({ type: 'keypress', key: 'Enter' });
```

---

### Task 1.3: Enhance Scroll and Zoom (15 min)

**File**: `src/implementations/addon/VisualFeedbackBridge.ts`

**Add Methods**:
```typescript
async scroll(delta: { deltaX?: number; deltaY?: number }): Promise<void> {
  if (!this.page) {
    throw new Error('Browser not initialized');
  }

  await this.page.mouse.wheel(delta.deltaX || 0, delta.deltaY || 0);
}

async zoom(level: number): Promise<void> {
  if (!this.page) {
    throw new Error('Browser not initialized');
  }

  // Zoom using CSS zoom property
  await this.page.evaluate((zoomLevel) => {
    document.body.style.zoom = `${zoomLevel * 100}%`;
  }, level);
}
```

**Update InteractionCommand**:
```typescript
export interface InteractionCommand {
  // ... existing fields
  deltaX?: number;  // NEW
  deltaY?: number;  // NEW
  zoomLevel?: number;  // NEW
}
```

**Update interact() method**:
```typescript
case 'scroll':
  await this.scroll({
    deltaX: command.deltaX,
    deltaY: command.deltaY
  });
  break;

case 'zoom':
  if (command.zoomLevel) {
    await this.zoom(command.zoomLevel);
  }
  break;
```

**Test**:
```typescript
// Scroll down 500px
await visualBridge.interact({ type: 'scroll', deltaY: 500 });

// Zoom to 150%
await visualBridge.interact({ type: 'zoom', zoomLevel: 1.5 });
```

---

### Task 1.4: Add Clipboard Support (10 min)

**File**: `src/implementations/addon/VisualFeedbackBridge.ts`

**Add Method**:
```typescript
async copyToClipboard(text: string): Promise<void> {
  if (!this.page) {
    throw new Error('Browser not initialized');
  }

  await this.page.evaluate((textToCopy) => {
    navigator.clipboard.writeText(textToCopy);
  }, text);
}

async getClipboard(): Promise<string> {
  if (!this.page) {
    throw new Error('Browser not initialized');
  }

  return await this.page.evaluate(() => {
    return navigator.clipboard.readText();
  });
}
```

**Usage**:
```typescript
// Model writes code
const code = `console.log('Hello World');`;

// Copy to clipboard
await visualBridge.copyToClipboard(code);

// Click in target location
await visualBridge.interact({ type: 'click', coordinates: { x: 400, y: 300 } });

// Paste
await visualBridge.interact({ type: 'keypress', key: 'Ctrl+V' });
```

---

## Phase 2: Terminal Sandbox (2 hours)

### Task 2.1: Create TerminalSandbox Class (1 hour)

**File**: `src/implementations/addon/TerminalSandbox.ts`

**Implementation**:
```typescript
import { spawn, ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';

export interface TerminalConfig {
  shell?: 'bash' | 'zsh' | 'fish' | 'sh';
  cwd?: string;
  env?: Record<string, string>;
  headed?: boolean;
}

export class TerminalSandbox {
  private shell: ChildProcess | null = null;
  private browser: Browser | null = null;
  private page: Page | null = null;
  private terminalUrl: string = '';

  async initialize(config: TerminalConfig = {}): Promise<void> {
    // Start xterm.js server
    const xtermServer = await this.startXtermServer(config);
    this.terminalUrl = xtermServer.url;

    // Launch browser to show terminal
    this.browser = await chromium.launch({
      headless: config.headed === false,
      slowMo: 50
    });

    this.page = await this.browser.newPage();
    await this.page.goto(this.terminalUrl);
  }

  private async startXtermServer(config: TerminalConfig): Promise<{ url: string; process: ChildProcess }> {
    // Create simple xterm.js server
    const port = 3001;
    const serverCode = `
const express = require('express');
const expressWs = require('express-ws');
const pty = require('node-pty');

const app = express();
expressWs(app);

app.use(express.static('public'));

app.ws('/terminal', (ws, req) => {
  const term = pty.spawn('${config.shell || 'bash'}', [], {
    cwd: '${config.cwd || process.cwd()}',
    env: process.env
  });

  term.on('data', (data) => {
    ws.send(data);
  });

  ws.on('message', (msg) => {
    term.write(msg);
  });

  ws.on('close', () => {
    term.kill();
  });
});

app.listen(${port}, () => console.log('Terminal server on ${port}'));
    `;

    // Write server code and start it
    // ... implementation

    return {
      url: `http://localhost:${port}`,
      process: this.shell!
    };
  }

  async getScreenshot(): Promise<Buffer> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    return await this.page.screenshot({ type: 'png' });
  }

  async type(text: string): Promise<void> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    // Type into terminal
    await this.page.keyboard.type(text);
  }

  async keyPress(key: string): Promise<void> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    await this.page.keyboard.press(key);
  }

  async getOutput(): Promise<string> {
    if (!this.page) {
      throw new Error('Terminal not initialized');
    }

    // Get terminal content
    return await this.page.evaluate(() => {
      const terminal = document.querySelector('.terminal');
      return terminal?.textContent || '';
    });
  }

  async close(): Promise<void> {
    if (this.shell) {
      this.shell.kill();
    }
    if (this.page) {
      await this.page.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }
}
```

**Dependencies Needed**:
```json
{
  "dependencies": {
    "node-pty": "^0.10.1",
    "express-ws": "^5.0.2",
    "xterm": "^5.0.0"
  }
}
```

---

### Task 2.2: Create Terminal HTML/Client (30 min)

**File**: `src/implementations/addon/terminal-client.html`

**Implementation**:
```html
<!DOCTYPE html>
<html>
<head>
  <link rel="stylesheet" href="https://unpkg.com/xterm@5.0.0/css/xterm.css" />
  <style>
    body {
      margin: 0;
      padding: 0;
      background: #000;
    }
    #terminal {
      padding: 10px;
    }
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script src="https://unpkg.com/xterm@5.0.0/lib/xterm.js"></script>
  <script src="https://unpkg.com/xterm-addon-fit@0.6.0/lib/xterm-addon-fit.js"></script>
  <script>
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace'
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    const ws = new WebSocket('ws://localhost:3001/terminal');

    ws.onmessage = (event) => {
      term.write(event.data);
    };

    term.onData((data) => {
      ws.send(data);
    });

    window.addEventListener('resize', () => {
      fitAddon.fit();
    });
  </script>
</body>
</html>
```

---

### Task 2.3: Integrate Terminal into CreateAddonTool (30 min)

**File**: `src/implementations/addon/CreateAddonToolEnhanced.ts`

**Add terminal mode**:
```typescript
export interface CreateAddonToolParamsEnhanced {
  // ... existing params

  mode?: 'oneshot' | 'dev' | 'persistent' | 'browser' | 'terminal';  // Add terminal

  terminalConfig?: {
    shell?: 'bash' | 'zsh' | 'fish';
    cwd?: string;
    headed?: boolean;
    initialCommands?: string[];
  };
}
```

**Add handler**:
```typescript
async execute(params: CreateAddonToolParamsEnhanced, signal: AbortSignal) {
  // ... existing logic

  if (params.mode === 'terminal') {
    return await this.launchTerminalSandbox(params, signal);
  }

  // ... rest
}

private async launchTerminalSandbox(
  params: CreateAddonToolParamsEnhanced,
  signal: AbortSignal
): Promise<ToolResult> {
  const sandboxId = randomUUID();
  const terminal = new TerminalSandbox();

  await terminal.initialize({
    shell: params.terminalConfig?.shell || 'bash',
    cwd: params.terminalConfig?.cwd,
    headed: params.terminalConfig?.headed !== false
  });

  // Run initial commands
  if (params.terminalConfig?.initialCommands) {
    for (const cmd of params.terminalConfig.initialCommands) {
      await terminal.type(cmd + '\n');
      await new Promise(r => setTimeout(r, 500));
    }
  }

  // Get initial screenshot
  const screenshot = await terminal.getScreenshot();

  const session: SandboxSession = {
    id: sandboxId,
    name: params.name,
    mode: 'terminal',
    startTime: new Date(),
    lastActivity: new Date(),
    terminal,
    visualSnapshot: {
      screenshot: screenshot.toString('base64'),
      dom: '',
      console: [],
      network: [],
      performance: { loadTime: 0, renderTime: 0, memoryUsage: 0 },
      accessibility: []
    }
  };

  activeSandboxes.set(sandboxId, session);

  return {
    ...this.createSuccessResult(`
# 💻 Terminal Sandbox Created: ${params.name}

**Sandbox ID**: ${sandboxId}
**Shell**: ${params.terminalConfig?.shell || 'bash'}
**Working Directory**: ${params.terminalConfig?.cwd || process.cwd()}
**Mode**: Terminal (${params.terminalConfig?.headed === false ? 'headless' : 'headed'})

## Terminal Window
${params.terminalConfig?.headed === false ? 'Running in headless mode' : '✅ Terminal window is open and visible'}

## Controls
Use InteractWithSandbox to:
- Type commands
- Press keyboard shortcuts
- View output
- Take screenshots

**View Dashboard**: ${viewServer.getViewUrl(sandboxId)}
    `),
    metadata: {
      sandboxId,
      mode: 'terminal',
      shell: params.terminalConfig?.shell || 'bash'
    }
  };
}
```

---

## Phase 3: Screen Streaming (1 hour)

### Task 3.1: Add ScreenStream Class (30 min)

**File**: `src/implementations/addon/ScreenStream.ts`

**Implementation**:
```typescript
import { EventEmitter } from 'events';

export interface ScreenStreamConfig {
  fps?: number;  // Frames per second (default: 2)
  region?: 'full' | { x: number, y: number, width: number, height: number };
  compression?: 'png' | 'jpeg';
  quality?: number;  // JPEG quality 0-100
}

export class ScreenStream extends EventEmitter {
  private intervalId: NodeJS.Timer | null = null;
  private captureFunction: () => Promise<Buffer>;
  private config: ScreenStreamConfig;

  constructor(captureFunction: () => Promise<Buffer>, config: ScreenStreamConfig = {}) {
    super();
    this.captureFunction = captureFunction;
    this.config = {
      fps: config.fps || 2,
      region: config.region || 'full',
      compression: config.compression || 'png',
      quality: config.quality || 80
    };
  }

  start(): void {
    if (this.intervalId) {
      return;
    }

    const interval = 1000 / (this.config.fps || 2);

    this.intervalId = setInterval(async () => {
      try {
        const screenshot = await this.captureFunction();
        this.emit('frame', screenshot);
      } catch (error) {
        this.emit('error', error);
      }
    }, interval);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  pause(): void {
    this.stop();
  }

  resume(): void {
    this.start();
  }
}
```

---

### Task 3.2: Integrate with VisualFeedbackBridge (15 min)

**File**: `src/implementations/addon/VisualFeedbackBridge.ts`

**Add method**:
```typescript
startScreenStream(config: ScreenStreamConfig = {}): ScreenStream {
  const captureFunction = async () => {
    if (!this.page) {
      throw new Error('Browser not initialized');
    }

    const screenshot = await this.page.screenshot({
      type: config.compression || 'png',
      quality: config.quality
    });

    return screenshot;
  };

  const stream = new ScreenStream(captureFunction, config);
  return stream;
}
```

**Usage**:
```typescript
const stream = visualBridge.startScreenStream({ fps: 2 });

stream.on('frame', (screenshot) => {
  // Broadcast to dashboard
  broadcaster.emitScreenshot(sandboxId, screenshot.toString('base64'), url);
});

stream.start();

// Later...
stream.stop();
```

---

### Task 3.3: Add to Dashboard (15 min)

**File**: `src/implementations/addon/SandboxViewServer.ts`

**Update WebSocket handler**:
```typescript
socket.on('subscribe', (sandboxId: string) => {
  socket.join(sandboxId);

  const session = CreateAddonToolExecutorEnhanced.getActiveSandbox(sandboxId);

  if (session?.screenStream) {
    // Start streaming to this client
    session.screenStream.on('frame', (screenshot) => {
      socket.emit('screen-frame', {
        sandboxId,
        screenshot: screenshot.toString('base64'),
        timestamp: Date.now()
      });
    });
  }
});
```

**Update HTML**:
```html
<!-- In dashboard, add screen stream canvas -->
<canvas id="screen-stream"></canvas>

<script>
socket.on('screen-frame', (data) => {
  const canvas = document.getElementById('screen-stream');
  const ctx = canvas.getContext('2d');
  const img = new Image();

  img.onload = () => {
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  img.src = 'data:image/png;base64,' + data.screenshot;
});
</script>
```

---

## Phase 4: Multi-Window Management (1.5 hours)

### Task 4.1: Create WindowManager Class (1 hour)

**File**: `src/implementations/addon/WindowManager.ts`

**Implementation**:
```typescript
export interface WindowConfig {
  id: string;
  type: 'browser' | 'terminal';
  position?: { x: number, y: number, width: number, height: number };
  browserConfig?: any;
  terminalConfig?: any;
}

export class WindowManager {
  private windows: Map<string, any> = new Map();
  private activeWindowId: string | null = null;

  async createWindow(config: WindowConfig): Promise<any> {
    let window: any;

    if (config.type === 'browser') {
      window = await this.createBrowserWindow(config);
    } else if (config.type === 'terminal') {
      window = await this.createTerminalWindow(config);
    }

    this.windows.set(config.id, window);

    if (!this.activeWindowId) {
      this.activeWindowId = config.id;
    }

    return window;
  }

  private async createBrowserWindow(config: WindowConfig): Promise<any> {
    // Create browser instance with position/size
    const browser = await chromium.launch({
      headless: false,
      args: [
        `--window-position=${config.position?.x || 0},${config.position?.y || 0}`,
        `--window-size=${config.position?.width || 800},${config.position?.height || 600}`
      ]
    });

    const page = await browser.newPage();

    return { type: 'browser', browser, page, config };
  }

  private async createTerminalWindow(config: WindowConfig): Promise<any> {
    const terminal = new TerminalSandbox();
    await terminal.initialize(config.terminalConfig);

    return { type: 'terminal', terminal, config };
  }

  getWindow(id: string): any {
    return this.windows.get(id);
  }

  async focusWindow(id: string): Promise<void> {
    const window = this.windows.get(id);
    if (!window) {
      throw new Error(`Window ${id} not found`);
    }

    this.activeWindowId = id;

    // Bring window to front
    if (window.type === 'browser' && window.page) {
      await window.page.bringToFront();
    }
  }

  getActiveWindow(): any {
    if (!this.activeWindowId) {
      return null;
    }
    return this.windows.get(this.activeWindowId);
  }

  async arrangeWindows(layout: 'tile' | 'cascade' | 'grid'): Promise<void> {
    const windowList = Array.from(this.windows.values());

    if (layout === 'tile') {
      // Tile windows side by side
      const count = windowList.length;
      const width = Math.floor(1920 / count);

      windowList.forEach((window, i) => {
        // Reposition window
        // Implementation depends on window type
      });
    }
    // ... other layouts
  }

  async closeWindow(id: string): Promise<void> {
    const window = this.windows.get(id);
    if (!window) {
      return;
    }

    if (window.type === 'browser' && window.browser) {
      await window.browser.close();
    } else if (window.type === 'terminal' && window.terminal) {
      await window.terminal.close();
    }

    this.windows.delete(id);

    if (this.activeWindowId === id) {
      this.activeWindowId = this.windows.size > 0
        ? Array.from(this.windows.keys())[0]
        : null;
    }
  }

  async closeAll(): Promise<void> {
    for (const id of this.windows.keys()) {
      await this.closeWindow(id);
    }
  }
}
```

---

### Task 4.2: Add Hybrid Mode to CreateAddonTool (30 min)

**File**: `src/implementations/addon/CreateAddonToolEnhanced.ts`

**Add hybrid support**:
```typescript
export interface CreateAddonToolParamsEnhanced {
  // ... existing params

  mode?: 'oneshot' | 'dev' | 'persistent' | 'browser' | 'terminal' | 'hybrid';

  hybridConfig?: {
    windows: WindowConfig[];
    layout?: 'tile' | 'cascade' | 'grid';
  };
}
```

**Add handler**:
```typescript
private async launchHybridSandbox(
  params: CreateAddonToolParamsEnhanced,
  signal: AbortSignal
): Promise<ToolResult> {
  const sandboxId = randomUUID();
  const windowManager = new WindowManager();

  // Create all windows
  for (const windowConfig of params.hybridConfig!.windows) {
    await windowManager.createWindow(windowConfig);
  }

  // Arrange windows
  if (params.hybridConfig?.layout) {
    await windowManager.arrangeWindows(params.hybridConfig.layout);
  }

  const session: SandboxSession = {
    id: sandboxId,
    name: params.name,
    mode: 'hybrid',
    startTime: new Date(),
    lastActivity: new Date(),
    windowManager
  };

  activeSandboxes.set(sandboxId, session);

  return {
    ...this.createSuccessResult(`
# 🪟 Hybrid Sandbox Created: ${params.name}

**Sandbox ID**: ${sandboxId}
**Windows**: ${params.hybridConfig!.windows.length}
**Layout**: ${params.hybridConfig?.layout || 'custom'}

## Windows
${params.hybridConfig!.windows.map(w => `- ${w.id} (${w.type})`).join('\n')}

**View Dashboard**: ${viewServer.getViewUrl(sandboxId)}
    `),
    metadata: {
      sandboxId,
      mode: 'hybrid',
      windowCount: params.hybridConfig!.windows.length
    }
  };
}
```

---

## Phase 5: Update Interaction Tools (30 min)

### Task 5.1: Update InteractWithSandboxTool

**File**: `src/implementations/addon/InteractWithSandboxTool.ts`

**Add support for new action types**:
```typescript
export interface InteractWithSandboxParams {
  sandboxId: string;
  windowId?: string;  // NEW: Target specific window in hybrid mode
  actions: Array<{
    type: 'click' | 'type' | 'navigate' | 'scroll' | 'hover' | 'select' | 'wait'
         | 'keypress' | 'zoom';  // NEW types
    selector?: string;
    value?: string;
    coordinates?: { x: number; y: number };
    duration?: number;
    key?: string;          // NEW
    deltaX?: number;       // NEW
    deltaY?: number;       // NEW
    zoomLevel?: number;    // NEW
  }>;
  captureAfterEachAction?: boolean;
  returnFinalSnapshot?: boolean;
}
```

**Update execution**:
```typescript
async execute(params: InteractWithSandboxParams, signal: AbortSignal): Promise<ToolResult> {
  const session = CreateAddonToolExecutorEnhanced.getActiveSandbox(params.sandboxId);

  // Get target window
  let targetBridge: VisualFeedbackBridge;

  if (session.mode === 'hybrid' && params.windowId) {
    const window = session.windowManager.getWindow(params.windowId);
    targetBridge = window.visualBridge;
  } else {
    targetBridge = visualBridge;
  }

  // Execute actions on target
  for (const action of params.actions) {
    await this.executeAction(action, targetBridge);
  }

  // ... rest
}
```

---

## Testing Plan

### Test 1: Headed Browser
```typescript
const result = await createAddon({
  name: "test-browser",
  mode: "browser",
  browserConfig: {
    initialUrl: "https://example.com",
    headed: true
  },
  enableVisualFeedback: true
});

// Should see browser window appear
// Should get screenshot in result
```

### Test 2: Terminal
```typescript
const result = await createAddon({
  name: "test-terminal",
  mode: "terminal",
  terminalConfig: {
    shell: "bash",
    headed: true,
    initialCommands: ["echo 'Hello World'", "ls -la"]
  }
});

// Should see terminal window
// Should show command output
```

### Test 3: Keyboard Shortcuts
```typescript
await interactWithSandbox({
  sandboxId: 'abc-123',
  actions: [
    { type: 'keypress', key: 'Ctrl+A' },  // Select all
    { type: 'keypress', key: 'Delete' },  // Delete
    { type: 'type', value: 'New text' }
  ]
});
```

### Test 4: Code Paste Workflow
```typescript
// Write code
const code = `console.log('Hello');`;

// Copy to clipboard
await visualBridge.copyToClipboard(code);

// Click target
await interactWithSandbox({
  sandboxId: 'abc-123',
  actions: [
    { type: 'click', coordinates: { x: 400, y: 300 } },
    { type: 'keypress', key: 'Ctrl+V' }
  ]
});
```

### Test 5: Hybrid Mode
```typescript
const result = await createAddon({
  name: "dev-workspace",
  mode: "hybrid",
  hybridConfig: {
    windows: [
      {
        id: "terminal",
        type: "terminal",
        position: { x: 0, y: 0, width: 960, height: 1080 }
      },
      {
        id: "browser",
        type: "browser",
        position: { x: 960, y: 0, width: 960, height: 1080 },
        browserConfig: { initialUrl: "http://localhost:3000" }
      }
    ],
    layout: "tile"
  }
});

// Should show two windows side by side
```

---

## Dependencies to Add

**package.json**:
```json
{
  "dependencies": {
    "node-pty": "^0.10.1",
    "express-ws": "^5.0.2",
    "xterm": "^5.0.0",
    "xterm-addon-fit": "^0.6.0"
  }
}
```

---

## Success Criteria

1. ✅ Browser window appears when headed: true
2. ✅ Keyboard shortcuts work (Ctrl+S, Ctrl+V, etc.)
3. ✅ Scroll and zoom work smoothly
4. ✅ Clipboard paste workflow works
5. ✅ Terminal sandbox shows bash prompt
6. ✅ Can type commands in terminal
7. ✅ Screen streaming captures 2fps
8. ✅ Multiple windows can be created
9. ✅ Windows can be focused/switched
10. ✅ All interactions work in terminal and browser

---

## Time Breakdown

| Phase | Tasks | Time |
|-------|-------|------|
| Phase 1: Browser Enhancements | 4 tasks | 1 hour |
| Phase 2: Terminal Sandbox | 3 tasks | 2 hours |
| Phase 3: Screen Streaming | 3 tasks | 1 hour |
| Phase 4: Multi-Window | 2 tasks | 1.5 hours |
| Phase 5: Update Tools | 1 task | 30 min |
| **Total** | **13 tasks** | **6 hours** |

---

## Priority Order

If time-constrained, implement in this order:

1. **Phase 1** (1 hour) - Gets 70% of value
2. **Phase 3** (1 hour) - Adds screen streaming
3. **Phase 2** (2 hours) - Adds terminal
4. **Phase 4** (1.5 hours) - Adds multi-window
5. **Phase 5** (30 min) - Polish

**Minimum Viable**: Phase 1 only = Fully functional browser sandbox with visual interaction
